import Database from "better-sqlite3";
import crypto from "crypto";
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

  CREATE TABLE IF NOT EXISTS entity_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    project_id INTEGER,
    title TEXT,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(type, object_id)
  );

  CREATE INDEX IF NOT EXISTS idx_entity_type ON entity_cache(type);
  CREATE INDEX IF NOT EXISTS idx_entity_project ON entity_cache(project_id);

  CREATE TABLE IF NOT EXISTS tool_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    args_hash TEXT NOT NULL,
    args_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(tool_name, args_hash)
  );

  CREATE INDEX IF NOT EXISTS idx_tool_name ON tool_cache(tool_name);

  CREATE TABLE IF NOT EXISTS mine_state (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER NOT NULL
  );
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

export function upsertEntityCache(type, objectId, { projectId = null, title = null, data } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO entity_cache (type, object_id, project_id, title, data, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(type, object_id) DO UPDATE SET
      project_id = excluded.project_id,
      title = excluded.title,
      data = excluded.data,
      updated_at = excluded.updated_at
  `);
  stmt.run(type, String(objectId), projectId, title, JSON.stringify(data ?? {}), now);
}

export function listEntityCache(type, { projectId = null, limit = 200 } = {}) {
  let sql = "SELECT * FROM entity_cache WHERE type = ?";
  const params = [type];
  if (projectId != null) {
    sql += " AND project_id = ?";
    params.push(projectId);
  }
  sql += " ORDER BY updated_at DESC LIMIT ?";
  params.push(limit);
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);
  return rows.map((row) => ({
    type: row.type,
    object_id: row.object_id,
    project_id: row.project_id,
    title: row.title,
    data: JSON.parse(row.data || "{}"),
    updated_at: row.updated_at,
  }));
}

function hashArgs(args) {
  const json = JSON.stringify(args || {});
  return crypto.createHash("sha256").update(json).digest("hex");
}

export function setToolCache(toolName, args, response) {
  const now = Math.floor(Date.now() / 1000);
  const argsJson = JSON.stringify(args || {});
  const responseJson = JSON.stringify(response ?? null);
  const argsHash = hashArgs(args || {});
  const stmt = db.prepare(`
    INSERT INTO tool_cache (tool_name, args_hash, args_json, response_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tool_name, args_hash) DO UPDATE SET
      args_json = excluded.args_json,
      response_json = excluded.response_json,
      updated_at = excluded.updated_at
  `);
  stmt.run(toolName, argsHash, argsJson, responseJson, now);
}

export function listToolCache(toolName, { limit = 20 } = {}) {
  const stmt = db.prepare(`
    SELECT tool_name, args_json, response_json, updated_at
    FROM tool_cache
    WHERE tool_name = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const rows = stmt.all(toolName, limit);
  return rows.map((row) => ({
    tool_name: row.tool_name,
    args: JSON.parse(row.args_json || "{}"),
    response: JSON.parse(row.response_json || "null"),
    updated_at: row.updated_at,
  }));
}

export function getMineState(key) {
  const stmt = db.prepare("SELECT value, updated_at FROM mine_state WHERE key = ?");
  const row = stmt.get(key);
  if (!row) return null;
  return { value: row.value, updated_at: row.updated_at };
}

export function setMineState(key, value) {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO mine_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  stmt.run(key, value, now);
}

export function getEntityStats() {
  const stmt = db.prepare("SELECT type, COUNT(*) as count FROM entity_cache GROUP BY type");
  return stmt.all();
}

export function getToolCacheStats() {
  const stmt = db.prepare("SELECT tool_name, COUNT(*) as count FROM tool_cache GROUP BY tool_name");
  return stmt.all();
}

export default db;
