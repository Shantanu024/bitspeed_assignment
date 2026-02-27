"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbReady = void 0;
exports.dbGet = dbGet;
exports.dbAll = dbAll;
exports.dbRun = dbRun;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    max: 5,
    min: 0,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 5000,
});
// Convert PostgreSQL lowercase column names to camelCase
function toCamelCase(obj) {
    if (!obj || typeof obj !== "object")
        return obj;
    const result = {};
    const columnMap = {
        // Map lowercase PostgreSQL columns to camelCase
        phonenumber: "phoneNumber",
        linkedid: "linkedId",
        linkprecedence: "linkPrecedence",
        createdat: "createdAt",
        updatedat: "updatedAt",
        deletedat: "deletedAt",
    };
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        // Use mapping if available, otherwise try snake_case conversion, else use original
        const camelKey = columnMap[lowerKey] || key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        result[camelKey] = value;
    }
    return result;
}
pool.on("error", (err) => {
    console.error("Database pool error:", err.message);
});
// Initialize database schema
async function initDatabase() {
    try {
        await queryWithRetry(`
      CREATE TABLE IF NOT EXISTS Contact (
        id              SERIAL PRIMARY KEY,
        phoneNumber     TEXT,
        email           TEXT,
        linkedId        INTEGER,
        linkPrecedence  TEXT NOT NULL CHECK(linkPrecedence IN ('primary', 'secondary')),
        createdAt       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deletedAt       TIMESTAMP,
        FOREIGN KEY (linkedId) REFERENCES Contact(id)
      );
    `);
        console.log("✅ Database schema initialized");
        // Clean up corrupted data: 
        // 1. Delete secondary contacts with null linkedId
        await queryWithRetry(`DELETE FROM Contact WHERE linkPrecedence = 'secondary' AND linkedId IS NULL`);
        // 2. Convert secondary contacts with non-existent linkedId to primary
        await queryWithRetry(`UPDATE Contact SET linkPrecedence = 'primary', linkedId = NULL, updatedAt = NOW()
       WHERE linkPrecedence = 'secondary' AND linkedId NOT IN (SELECT id FROM Contact WHERE deletedAt IS NULL)`);
    }
    catch (err) {
        console.error("Database init error:", err);
    }
}
// Wrapper for pool queries with automatic reconnection
async function queryWithRetry(sql, params = [], retries = 2) {
    try {
        return await pool.query(sql, params);
    }
    catch (err) {
        // Retry on connection errors
        if (retries > 0 && (err.message.includes("ECONNREFUSED") || err.message.includes("connection") || err.message.includes("timeout"))) {
            console.warn(`Query failed, retrying... (${retries} retries left)`, err.message);
            await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay before retry
            return queryWithRetry(sql, params, retries - 1);
        }
        throw err;
    }
}
// Export a promise that resolves when database is ready
exports.dbReady = initDatabase();
// Helper function to get single row
async function dbGet(sql, params = []) {
    try {
        const result = await queryWithRetry(sql, params);
        return result.rows[0] ? toCamelCase(result.rows[0]) : undefined;
    }
    catch (err) {
        console.error("dbGet error:", err);
        throw err;
    }
}
// Helper function to get all rows
async function dbAll(sql, params = []) {
    try {
        const result = await queryWithRetry(sql, params);
        return result.rows.map((row) => toCamelCase(row));
    }
    catch (err) {
        console.error("dbAll error:", err);
        throw err;
    }
}
// Helper function to run insert/update/delete
async function dbRun(sql, params = []) {
    try {
        const result = await queryWithRetry(sql, params);
        // For INSERT with RETURNING, get the id from the returned row
        let lastID = 0;
        if (result.rows && result.rows.length > 0) {
            const returnedRow = result.rows[0];
            if (returnedRow && typeof returnedRow === "object") {
                // Handle both camelCase and lowercase 'id'
                lastID = returnedRow.id || returnedRow.ID || 0;
            }
        }
        if (sql.toUpperCase().includes("RETURNING") && (!lastID || lastID === 0)) {
            throw new Error("Failed to get returned id");
        }
        return { lastID, changes: result.rowCount || 0 };
    }
    catch (err) {
        console.error("dbRun error:", err);
        throw err;
    }
}
exports.default = pool;
