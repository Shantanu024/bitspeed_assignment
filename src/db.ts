import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client:", err.message);
});

pool.on("connect", () => {
  console.log("✅ Database connection established");
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
    // For INSERT, get the lastInsertRowid from RETURNING clause
    const lastID = result.rows[0]?.id || 0;
    return { lastID, changes: result.rowCount || 0 };
  } catch (err) {
    console.error("dbRun error:", err);
    throw err;
  }
}

export default pool;
