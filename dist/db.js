"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbGet = dbGet;
exports.dbAll = dbAll;
exports.dbRun = dbRun;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});
pool.on("error", (err) => {
    console.error("Unexpected error on idle client", err);
});
// Initialize database schema
async function initDatabase() {
    try {
        await pool.query(`
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
    }
    catch (err) {
        console.error("Database init error:", err);
    }
}
initDatabase();
// Helper function to get single row
async function dbGet(sql, params = []) {
    try {
        const result = await pool.query(sql, params);
        return result.rows[0];
    }
    catch (err) {
        console.error("dbGet error:", err);
        throw err;
    }
}
// Helper function to get all rows
async function dbAll(sql, params = []) {
    try {
        const result = await pool.query(sql, params);
        return result.rows;
    }
    catch (err) {
        console.error("dbAll error:", err);
        throw err;
    }
}
// Helper function to run insert/update/delete
async function dbRun(sql, params = []) {
    try {
        const result = await pool.query(sql, params);
        // For INSERT, get the lastInsertRowid from RETURNING clause
        const lastID = result.rows[0]?.id || 0;
        return { lastID, changes: result.rowCount || 0 };
    }
    catch (err) {
        console.error("dbRun error:", err);
        throw err;
    }
}
exports.default = pool;
