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
    
    // Clean up any corrupted data: delete secondary contacts with null linkedId
    const cleanupResult = await pool.query(
      `DELETE FROM Contact WHERE linkPrecedence = 'secondary' AND linkedId IS NULL AND deletedAt IS NULL`
    );
    if (cleanupResult.rowCount && cleanupResult.rowCount > 0) {
      console.log(`⚠️  Cleaned up ${cleanupResult.rowCount} corrupted secondary contact(s)`);
    }
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
    console.log("dbRun query result:", {
      rowCount: result.rowCount,
      rows: result.rows,
      command: result.command,
    });
    
    // For INSERT with RETURNING, get the id from the returned row
    let lastID = 0;
    if (result.rows && result.rows.length > 0) {
      const returnedRow = result.rows[0];
      console.log("First returned row:", returnedRow);
      
      // Try to get id from the returned row
      if (returnedRow && typeof returnedRow === "object") {
        // Check various possible column names
        lastID = returnedRow.id || returnedRow.ID || returnedRow.lastID || 0;
        console.log("Extracted lastID:", lastID, "from row:", returnedRow);
      }
    }
    
    if (sql.toUpperCase().includes("RETURNING") && (!lastID || lastID === 0)) {
      console.error("dbRun error: RETURNING failed to extract ID. Full result:", {
        rowCount: result.rowCount,
        rows: result.rows,
        command: result.command,
      });
      throw new Error(`Failed to get returned id. Result: ${JSON.stringify(result.rows)}`);
    }
    
    return { lastID, changes: result.rowCount || 0 };
  } catch (err) {
    console.error("dbRun error:", err);
    throw err;
  }
}

export default pool;
