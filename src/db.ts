import { Pool } from "pg";

/**
 * PostgreSQL connection pool with optimized settings for identity reconciliation API
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : false,
  max: 20,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
});

/**
 * Maps PostgreSQL lowercase column names to camelCase equivalents
 */
const COLUMN_MAP: Record<string, string> = {
  phonenumber: "phoneNumber",
  linkedid: "linkedId",
  linkprecedence: "linkPrecedence",
  createdat: "createdAt",
  updatedat: "updatedAt",
  deletedat: "deletedAt",
};

/**
 * Converts object keys from snake_case/lowercase to camelCase using the COLUMN_MAP
 * @param obj - The object to convert
 * @returns Converted object with camelCase keys
 */
function toCamelCase<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;
  
  const result: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const camelKey = COLUMN_MAP[lowerKey] || key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

/**
 * Handle unexpected errors from the database pool
 */
pool.on("error", (err: Error) => {
  console.error("Database pool error:", err.message);
});

/**
 * Initialize database schema and create necessary indexes
 * Cleans up corrupted data during initialization
 */
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
    
    // Add indexes for frequently queried columns
    await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_contact_email ON Contact(email) WHERE deletedAt IS NULL`);
    await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_contact_phone ON Contact(phoneNumber) WHERE deletedAt IS NULL`);
    await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_contact_linkedid ON Contact(linkedId) WHERE deletedAt IS NULL`);
    await queryWithRetry(`CREATE INDEX IF NOT EXISTS idx_contact_precedence ON Contact(linkPrecedence) WHERE deletedAt IS NULL`);
    
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

/**
 * Execute a query with automatic retry on connection errors
 * @param sql - SQL query string
 * @param params - Query parameters (prevents SQL injection)
 * @param retries - Number of retry attempts for connection failures
 * @returns Query result from the database
 */
async function queryWithRetry(sql: string, params: (string | number | null)[] = [], retries: number = 2): Promise<any> {
  try {
    return await pool.query(sql, params);
  } catch (err: any) {
    // Retry on connection errors
    if (retries > 0 && (err.message?.includes("ECONNREFUSED") || err.message?.includes("connection") || err.message?.includes("timeout"))) {
      console.warn(`Query failed, retrying... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, 100));
      return queryWithRetry(sql, params, retries - 1);
    }
    throw err;
  }
}

// Export a promise that resolves when database is ready
/**
 * Promise that resolves when the database is fully initialized
 */
export const dbReady = initDatabase();

/**
 * Fetch a single row from the database
 * @param sql - SQL query string
 * @param params - Query parameters
 * @returns Single row converted to camelCase or undefined if not found
 */
export async function dbGet<T = any>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T | undefined> {
  try {
    const result = await queryWithRetry(sql, params);
    return result.rows[0] ? (toCamelCase(result.rows[0]) as T) : undefined;
  } catch (err) {
    console.error("dbGet error:", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Fetch all matching rows from the database
 * @param sql - SQL query string
 * @param params - Query parameters
 * @returns Array of rows converted to camelCase
 */
export async function dbAll<T = any>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  try {
    const result = await queryWithRetry(sql, params);
    return result.rows.map((row: any) => toCamelCase(row) as T);
  } catch (err) {
    console.error("dbAll error:", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Execute an insert/update/delete query
 * @param sql - SQL query string
 * @param params - Query parameters
 * @returns Object with lastID from RETURNING clause and affected row count
 */
export async function dbRun(
  sql: string,
  params: (string | number | null)[] = []
): Promise<{ lastID: number; changes: number }> {
  try {
    const result = await queryWithRetry(sql, params);
    
    // For INSERT with RETURNING, get the id from the returned row
    let lastID = 0;
    if (result.rows && result.rows.length > 0) {
      const returnedRow = result.rows[0];
      if (returnedRow && typeof returnedRow === "object") {
        lastID = returnedRow.id || returnedRow.ID || 0;
      }
    }
    
    if (sql.toUpperCase().includes("RETURNING") && (!lastID || lastID === 0)) {
      throw new Error("Failed to get returned id");
    }
    
    return { lastID, changes: result.rowCount || 0 };
  } catch (err) {
    console.error("dbRun error:", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export default pool;
