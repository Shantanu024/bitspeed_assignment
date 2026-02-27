import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 3,
  min: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

// Convert snake_case column names to camelCase
function toCamelCase(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
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
    await queryWithRetry(
      `DELETE FROM Contact WHERE linkPrecedence = 'secondary' AND linkedId IS NULL`
    );
    
    // 2. Convert secondary contacts with non-existent linkedId to primary
    await queryWithRetry(
      `UPDATE Contact SET linkPrecedence = 'primary', linkedId = NULL, updatedAt = NOW()
       WHERE linkPrecedence = 'secondary' AND linkedId NOT IN (SELECT id FROM Contact WHERE deletedAt IS NULL)`
    );
  } catch (err) {
    console.error("Database init error:", err);
  }
}

// Wrapper for pool queries with automatic reconnection
async function queryWithRetry(sql: string, params: any[] = [], retries: number = 2): Promise<any> {
  try {
    return await pool.query(sql, params);
  } catch (err: any) {
    // Retry on connection errors
    if (retries > 0 && (err.message.includes("ECONNREFUSED") || err.message.includes("connection") || err.message.includes("timeout"))) {
      console.warn(`Query failed, retrying... (${retries} retries left)`, err.message);
      await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay before retry
      return queryWithRetry(sql, params, retries - 1);
    }
    throw err;
  }
}

initDatabase();

// Helper function to get single row
export async function dbGet<T = any>(
  sql: string,
  params: any[] = []
): Promise<T | undefined> {
  try {
    const result = await queryWithRetry(sql, params);
    return result.rows[0] ? (toCamelCase(result.rows[0]) as T) : undefined;
  } catch (err) {
    console.error("dbGet error:", err);
    throw err;
  }
}

// Helper function to get all rows
export async function dbAll<T = any>(
  sql: string,
  params: any[] = []
): Promise<T[]> {
  try {
    const result = await queryWithRetry(sql, params);
    return result.rows.map(row => toCamelCase(row) as T);
  } catch (err) {
    console.error("dbAll error:", err);
    throw err;
  }
}

// Helper function to run insert/update/delete
export async function dbRun(
  sql: string,
  params: any[] = []
): Promise<{ lastID: number; changes: number }> {
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
  } catch (err) {
    console.error("dbRun error:", err);
    throw err;
  }
}

export default pool;
