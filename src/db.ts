import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Database pool error:", err.message);
});

// Connection event listener for debugging (optional)

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
    
    // Clean up corrupted data: 
    // 1. Delete secondary contacts with null linkedId
    const deleteResult = await pool.query(
      `DELETE FROM Contact WHERE linkPrecedence = 'secondary' AND linkedId IS NULL`
    );
    
    // 2. Convert secondary contacts with non-existent linkedId to primary
    const convertResult = await pool.query(
      `UPDATE Contact SET linkPrecedence = 'primary', linkedId = NULL, updatedAt = NOW()
       WHERE linkPrecedence = 'secondary' AND linkedId NOT IN (SELECT id FROM Contact WHERE deletedAt IS NULL)`
    );
    // Silently handle cleanup
  } catch (err) {
    console.error("Database init error:", err);
  }
}

initDatabase();

// Helper function to get single row
export async function dbGet<T = any>(
  sql: string,
  params: any[] = []
): Promise<T | undefined> {
  try {
    const result = await pool.query(sql, params);
    return result.rows[0] as T | undefined;
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
    const result = await pool.query(sql, params);
    return result.rows as T[];
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
    const result = await pool.query(sql, params);
    
    // For INSERT with RETURNING, get the id from the returned row
    let lastID = 0;
    if (result.rows && result.rows.length > 0) {
      const returnedRow = result.rows[0];
      if (returnedRow && typeof returnedRow === "object") {
        lastID = returnedRow.id || 0;
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
