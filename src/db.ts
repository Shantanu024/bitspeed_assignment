import sqlite3 from "sqlite3";
import path from "path";

// Use /data directory on Render (persistent disk), or local path in development
const DB_DIR = process.env.NODE_ENV === "production" ? "/data" : __dirname;
const DB_PATH = path.join(DB_DIR, "..", "contacts.db");

const db = new sqlite3.Database(DB_PATH);

// Enabled WAL mode for better performance
db.run("PRAGMA journal_mode = WAL");

// Created Contact table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS Contact (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    phoneNumber     TEXT,
    email           TEXT,
    linkedId        INTEGER,
    linkPrecedence  TEXT NOT NULL CHECK(linkPrecedence IN ('primary', 'secondary')),
    createdAt       DATETIME NOT NULL DEFAULT (datetime('now')),
    updatedAt       DATETIME NOT NULL DEFAULT (datetime('now')),
    deletedAt       DATETIME,
    FOREIGN KEY (linkedId) REFERENCES Contact(id)
  );
`, (err) => {
  if (err) {
    console.error("Failed to create table:", err);
  }
});

// Helper function to promisify db.get
export function dbGet<T = any>(
  sql: string,
  params: any[] = []
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
}

// Helper function to promisify db.all
export function dbAll<T = any>(
  sql: string,
  params: any[] = []
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve((rows || []) as T[]);
    });
  });
}

// Helper function to promisify db.run
export function dbRun(
  sql: string,
  params: any[] = []
): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

export default db;
