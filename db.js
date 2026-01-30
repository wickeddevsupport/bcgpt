import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "bcgpt.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS token (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_token TEXT NOT NULL,
    token_type TEXT DEFAULT 'Bearer',
    expires_in INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    identity_name TEXT,
    identity_email TEXT,
    accounts TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS search_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    project_id INTEGER,
    title TEXT,
    content TEXT,
    url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(type, object_id)
  );

  CREATE INDEX IF NOT EXISTS idx_search_type ON search_index(type);
  CREATE INDEX IF NOT EXISTS idx_search_project ON search_index(project_id);
  CREATE INDEX IF NOT EXISTS idx_search_content ON search_index(content);
`);

// Token operations
export function getToken() {
  const stmt = db.prepare("SELECT access_token, token_type, expires_in FROM token WHERE id = 1");
  const row = stmt.get();
  if (!row) return null;
  return {
    access_token: row.access_token,
    token_type: row.token_type,
    expires_in: row.expires_in,
  };
}

export function setToken(token) {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO token (id, access_token, token_type, expires_in, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      token_type = excluded.token_type,
      expires_in = excluded.expires_in,
      updated_at = excluded.updated_at
  `);
  stmt.run(token.access_token, token.token_type || "Bearer", token.expires_in, now, now);
  console.log(`[DB] Token stored/updated`);
}

export function clearToken() {
  const stmt = db.prepare("DELETE FROM token WHERE id = 1");
  stmt.run();
  console.log(`[DB] Token cleared`);
}

// Auth cache operations
export function getAuthCache() {
  const stmt = db.prepare("SELECT identity_name, identity_email, accounts FROM auth_cache WHERE id = 1");
  const row = stmt.get();
  if (!row) return null;
  return {
    identity: { name: row.identity_name, email_address: row.identity_email },
    accounts: JSON.parse(row.accounts),
  };
}

export function setAuthCache(auth) {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO auth_cache (id, identity_name, identity_email, accounts, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      identity_name = excluded.identity_name,
      identity_email = excluded.identity_email,
      accounts = excluded.accounts,
      updated_at = excluded.updated_at
  `);
  stmt.run(
    auth.identity?.name || null,
    auth.identity?.email_address || null,
    JSON.stringify(auth.accounts || []),
    now
  );
  console.log(`[DB] Auth cache updated`);
}

// Search index operations
export function indexSearchItem(type, objectId, { projectId, title, content, url }) {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO search_index (type, object_id, project_id, title, content, url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(type, object_id) DO UPDATE SET
      project_id = excluded.project_id,
      title = excluded.title,
      content = excluded.content,
      url = excluded.url,
      updated_at = excluded.updated_at
  `);
  stmt.run(type, objectId, projectId, title, content, url, now, now);
}

export function clearSearchIndex(type) {
  const stmt = db.prepare("DELETE FROM search_index WHERE type = ?");
  stmt.run(type);
  console.log(`[DB] Cleared search index for type: ${type}`);
}

export function searchIndex(query, { type, projectId, limit = 100 } = {}) {
  const q = `%${query.toLowerCase()}%`;
  let sql = "SELECT * FROM search_index WHERE (LOWER(title) LIKE ? OR LOWER(content) LIKE ?)";
  const params = [q, q];

  if (type) {
    sql += " AND type = ?";
    params.push(type);
  }

  if (projectId) {
    sql += " AND project_id = ?";
    params.push(projectId);
  }

  sql += " ORDER BY updated_at DESC LIMIT ?";
  params.push(limit);

  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

export function getIndexStats() {
  const stmt = db.prepare("SELECT type, COUNT(*) as count FROM search_index GROUP BY type");
  return stmt.all();
}

export default db;
