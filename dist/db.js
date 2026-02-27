"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbGet = dbGet;
exports.dbAll = dbAll;
exports.dbRun = dbRun;
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
// Use /data directory on Render (persistent disk), or local path in development
const DB_DIR = process.env.NODE_ENV === "production" ? "/data" : __dirname;
const DB_PATH = process.env.NODE_ENV === "production"
    ? "/data/contacts.db"
    : path_1.default.join(__dirname, "..", "contacts.db");
const db = new sqlite3_1.default.Database(DB_PATH);
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
function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err)
                reject(err);
            else
                resolve(row);
        });
    });
}
// Helper function to promisify db.all
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err)
                reject(err);
            else
                resolve((rows || []));
        });
    });
}
// Helper function to promisify db.run
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err)
                reject(err);
            else
                resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}
exports.default = db;
