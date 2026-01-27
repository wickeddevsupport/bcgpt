import initSqlJs from "sql.js";

let db;

export async function getDB() {
  if (db) return db;

  const SQL = await initSqlJs({});
  db = new SQL.Database();

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS basecamp_tokens (
      mcp_session_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      mcp_session_id TEXT NOT NULL,
      created_at TEXT
    );
  `);

  return db;
}
