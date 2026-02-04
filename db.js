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
    user_key TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    identity_name TEXT,
    identity_email TEXT,
    user_key TEXT,
    accounts TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_token (
    user_key TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    token_type TEXT DEFAULT 'Bearer',
    expires_in INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_auth_cache (
    user_key TEXT PRIMARY KEY,
    identity_name TEXT,
    identity_email TEXT,
    accounts TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    session_key TEXT PRIMARY KEY,
    user_key TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_user_sessions_user_key ON user_sessions(user_key);

  CREATE TABLE IF NOT EXISTS search_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key TEXT NOT NULL DEFAULT 'legacy',
    type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    project_id INTEGER,
    title TEXT,
    content TEXT,
    url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_key, type, object_id)
  );

  CREATE INDEX IF NOT EXISTS idx_search_user_type ON search_index(user_key, type);
  CREATE INDEX IF NOT EXISTS idx_search_user_project ON search_index(user_key, project_id);
  CREATE INDEX IF NOT EXISTS idx_search_content ON search_index(content);

  CREATE TABLE IF NOT EXISTS entity_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key TEXT NOT NULL DEFAULT 'legacy',
    type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    project_id INTEGER,
    title TEXT,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_key, type, object_id)
  );

  CREATE INDEX IF NOT EXISTS idx_entity_user_type ON entity_cache(user_key, type);
  CREATE INDEX IF NOT EXISTS idx_entity_user_project ON entity_cache(user_key, project_id);

  CREATE TABLE IF NOT EXISTS tool_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key TEXT NOT NULL DEFAULT 'legacy',
    tool_name TEXT NOT NULL,
    args_hash TEXT NOT NULL,
    args_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_key, tool_name, args_hash)
  );

  CREATE INDEX IF NOT EXISTS idx_tool_user_name ON tool_cache(user_key, tool_name);

  CREATE TABLE IF NOT EXISTS mine_state (
    user_key TEXT NOT NULL DEFAULT 'legacy',
    key TEXT NOT NULL,
    value TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_key, key)
  );

  CREATE TABLE IF NOT EXISTS idempotency_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key TEXT NOT NULL DEFAULT 'legacy',
    idempotency_key TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_key, idempotency_key, method, path)
  );

  CREATE INDEX IF NOT EXISTS idx_idempotency_user_key ON idempotency_cache(user_key, idempotency_key);
`);

function normalizeUserKey(userKey) {
  if (!userKey) return null;
  const trimmed = String(userKey).trim();
  return trimmed ? trimmed : null;
}

function normalizeSessionKey(sessionKey) {
  if (!sessionKey) return null;
  const trimmed = String(sessionKey).trim();
  return trimmed ? trimmed : null;
}

function tableHasColumn(table, column) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r.name === column);
  } catch {
    return false;
  }
}

function getLegacyUserKey() {
  try {
    const row = db.prepare("SELECT identity_email, identity_name FROM auth_cache WHERE id = 1").get();
    const email = row?.identity_email ? String(row.identity_email).trim().toLowerCase() : "";
    if (email) return `email:${email}`;
    const name = row?.identity_name ? String(row.identity_name).trim().toLowerCase() : "";
    if (name) return `name:${name}`;
  } catch {
    return null;
  }
  return null;
}

function rebuildSearchIndex(legacyUserKey) {
  const key = normalizeUserKey(legacyUserKey) || "legacy";
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE search_index_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key TEXT NOT NULL DEFAULT 'legacy',
        type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        project_id INTEGER,
        title TEXT,
        content TEXT,
        url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_key, type, object_id)
      );
    `);
    const insert = db.prepare(`
      INSERT INTO search_index_new (user_key, type, object_id, project_id, title, content, url, created_at, updated_at)
      SELECT ?, type, object_id, project_id, title, content, url, created_at, updated_at
      FROM search_index;
    `);
    insert.run(key);
    db.exec("DROP TABLE search_index;");
    db.exec("ALTER TABLE search_index_new RENAME TO search_index;");
    db.exec("CREATE INDEX IF NOT EXISTS idx_search_user_type ON search_index(user_key, type);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_search_user_project ON search_index(user_key, project_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_search_content ON search_index(content);");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function rebuildEntityCache(legacyUserKey) {
  const key = normalizeUserKey(legacyUserKey) || "legacy";
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE entity_cache_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key TEXT NOT NULL DEFAULT 'legacy',
        type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        project_id INTEGER,
        title TEXT,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_key, type, object_id)
      );
    `);
    const insert = db.prepare(`
      INSERT INTO entity_cache_new (user_key, type, object_id, project_id, title, data, updated_at)
      SELECT ?, type, object_id, project_id, title, data, updated_at
      FROM entity_cache;
    `);
    insert.run(key);
    db.exec("DROP TABLE entity_cache;");
    db.exec("ALTER TABLE entity_cache_new RENAME TO entity_cache;");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entity_user_type ON entity_cache(user_key, type);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_entity_user_project ON entity_cache(user_key, project_id);");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function rebuildToolCache(legacyUserKey) {
  const key = normalizeUserKey(legacyUserKey) || "legacy";
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE tool_cache_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key TEXT NOT NULL DEFAULT 'legacy',
        tool_name TEXT NOT NULL,
        args_hash TEXT NOT NULL,
        args_json TEXT NOT NULL,
        response_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_key, tool_name, args_hash)
      );
    `);
    const insert = db.prepare(`
      INSERT INTO tool_cache_new (user_key, tool_name, args_hash, args_json, response_json, updated_at)
      SELECT ?, tool_name, args_hash, args_json, response_json, updated_at
      FROM tool_cache;
    `);
    insert.run(key);
    db.exec("DROP TABLE tool_cache;");
    db.exec("ALTER TABLE tool_cache_new RENAME TO tool_cache;");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tool_user_name ON tool_cache(user_key, tool_name);");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function rebuildMineState(legacyUserKey) {
  const key = normalizeUserKey(legacyUserKey) || "legacy";
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE mine_state_new (
        user_key TEXT NOT NULL DEFAULT 'legacy',
        key TEXT NOT NULL,
        value TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_key, key)
      );
    `);
    const insert = db.prepare(`
      INSERT INTO mine_state_new (user_key, key, value, updated_at)
      SELECT ?, key, value, updated_at
      FROM mine_state;
    `);
    insert.run(key);
    db.exec("DROP TABLE mine_state;");
    db.exec("ALTER TABLE mine_state_new RENAME TO mine_state;");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const legacyUserKey = getLegacyUserKey();

if (!tableHasColumn("token", "user_key")) {
  db.exec("ALTER TABLE token ADD COLUMN user_key TEXT;");
  if (legacyUserKey) {
    db.prepare("UPDATE token SET user_key = ? WHERE user_key IS NULL").run(legacyUserKey);
  }
}

if (!tableHasColumn("auth_cache", "user_key")) {
  db.exec("ALTER TABLE auth_cache ADD COLUMN user_key TEXT;");
  if (legacyUserKey) {
    db.prepare("UPDATE auth_cache SET user_key = ? WHERE user_key IS NULL").run(legacyUserKey);
  }
}

if (!tableHasColumn("search_index", "user_key")) {
  rebuildSearchIndex(legacyUserKey);
}

if (!tableHasColumn("entity_cache", "user_key")) {
  rebuildEntityCache(legacyUserKey);
}

if (!tableHasColumn("tool_cache", "user_key")) {
  rebuildToolCache(legacyUserKey);
}

if (!tableHasColumn("mine_state", "user_key")) {
  rebuildMineState(legacyUserKey);
}

// Token operations
export function getToken() {
  const stmt = db.prepare("SELECT access_token, token_type, expires_in, user_key FROM token WHERE id = 1");
  const row = stmt.get();
  if (!row) return null;
  return {
    access_token: row.access_token,
    token_type: row.token_type,
    expires_in: row.expires_in,
    user_key: row.user_key || null,
  };
}

export function setToken(token, userKey = null) {
  const now = Math.floor(Date.now() / 1000);
  const key = normalizeUserKey(userKey);
  const stmt = db.prepare(`
    INSERT INTO token (id, access_token, token_type, expires_in, user_key, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      token_type = excluded.token_type,
      expires_in = excluded.expires_in,
      user_key = excluded.user_key,
      updated_at = excluded.updated_at
  `);
  stmt.run(token.access_token, token.token_type || "Bearer", token.expires_in, key, now, now);
  console.log(`[DB] Token stored/updated`);
}

export function clearToken() {
  const stmt = db.prepare("DELETE FROM token WHERE id = 1");
  stmt.run();
  console.log(`[DB] Token cleared`);
}

// Auth cache operations
export function getAuthCache() {
  const stmt = db.prepare("SELECT identity_name, identity_email, accounts, user_key FROM auth_cache WHERE id = 1");
  const row = stmt.get();
  if (!row) return null;
  return {
    identity: { name: row.identity_name, email_address: row.identity_email },
    accounts: JSON.parse(row.accounts),
    user_key: row.user_key || null,
  };
}

export function setAuthCache(auth, userKey = null) {
  const now = Math.floor(Date.now() / 1000);
  const key = normalizeUserKey(userKey);
  const stmt = db.prepare(`
    INSERT INTO auth_cache (id, identity_name, identity_email, user_key, accounts, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      identity_name = excluded.identity_name,
      identity_email = excluded.identity_email,
      user_key = excluded.user_key,
      accounts = excluded.accounts,
      updated_at = excluded.updated_at
  `);
  stmt.run(
    auth.identity?.name || null,
    auth.identity?.email_address || null,
    key,
    JSON.stringify(auth.accounts || []),
    now
  );
  console.log(`[DB] Auth cache updated`);
}

export function clearAuthCache() {
  const stmt = db.prepare("DELETE FROM auth_cache WHERE id = 1");
  stmt.run();
  console.log(`[DB] Auth cache cleared`);
}

// User-scoped token operations
export function getUserToken(userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return null;
  const stmt = db.prepare("SELECT access_token, token_type, expires_in, user_key FROM user_token WHERE user_key = ?");
  const row = stmt.get(key);
  if (!row) return null;
  return {
    access_token: row.access_token,
    token_type: row.token_type,
    expires_in: row.expires_in,
    user_key: row.user_key,
  };
}

export function setUserToken(token, userKey) {
  const key = normalizeUserKey(userKey);
  if (!key || !token?.access_token) return;
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO user_token (user_key, access_token, token_type, expires_in, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_key) DO UPDATE SET
      access_token = excluded.access_token,
      token_type = excluded.token_type,
      expires_in = excluded.expires_in,
      updated_at = excluded.updated_at
  `);
  stmt.run(key, token.access_token, token.token_type || "Bearer", token.expires_in, now, now);
  console.log(`[DB] User token stored/updated`);
}

export function clearUserToken(userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return;
  const stmt = db.prepare("DELETE FROM user_token WHERE user_key = ?");
  stmt.run(key);
  console.log(`[DB] User token cleared`);
}

// User-scoped auth cache operations
export function getUserAuthCache(userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return null;
  const stmt = db.prepare("SELECT identity_name, identity_email, accounts, user_key FROM user_auth_cache WHERE user_key = ?");
  const row = stmt.get(key);
  if (!row) return null;
  return {
    identity: { name: row.identity_name, email_address: row.identity_email },
    accounts: JSON.parse(row.accounts || "[]"),
    user_key: row.user_key || null,
  };
}

export function setUserAuthCache(auth, userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return;
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO user_auth_cache (user_key, identity_name, identity_email, accounts, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_key) DO UPDATE SET
      identity_name = excluded.identity_name,
      identity_email = excluded.identity_email,
      accounts = excluded.accounts,
      updated_at = excluded.updated_at
  `);
  stmt.run(
    key,
    auth.identity?.name || null,
    auth.identity?.email_address || null,
    JSON.stringify(auth.accounts || []),
    now
  );
  console.log(`[DB] User auth cache updated`);
}

export function clearUserAuthCache(userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return;
  const stmt = db.prepare("DELETE FROM user_auth_cache WHERE user_key = ?");
  stmt.run(key);
  console.log(`[DB] User auth cache cleared`);
}

function generateSessionKey() {
  return crypto.randomBytes(18).toString("hex");
}

// Session operations
export function createSession(sessionKey = null, userKey = null) {
  const key = normalizeSessionKey(sessionKey) || generateSessionKey();
  const ukey = normalizeUserKey(userKey);
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO user_sessions (session_key, user_key, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET
      user_key = COALESCE(excluded.user_key, user_key),
      updated_at = excluded.updated_at
  `);
  stmt.run(key, ukey, now, now);
  return key;
}

export function bindSession(sessionKey, userKey) {
  const key = normalizeSessionKey(sessionKey);
  const ukey = normalizeUserKey(userKey);
  if (!key) return null;
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO user_sessions (session_key, user_key, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET
      user_key = excluded.user_key,
      updated_at = excluded.updated_at
  `);
  stmt.run(key, ukey, now, now);
  return key;
}

export function getSessionUser(sessionKey) {
  const key = normalizeSessionKey(sessionKey);
  if (!key) return null;
  const stmt = db.prepare("SELECT user_key FROM user_sessions WHERE session_key = ?");
  const row = stmt.get(key);
  return row?.user_key || null;
}

export function deleteSession(sessionKey) {
  const key = normalizeSessionKey(sessionKey);
  if (!key) return;
  const stmt = db.prepare("DELETE FROM user_sessions WHERE session_key = ?");
  stmt.run(key);
}

// Search index operations
export function indexSearchItem(type, objectId, { projectId, title, content, url, userKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const key = normalizeUserKey(userKey) || "legacy";
  const stmt = db.prepare(`
    INSERT INTO search_index (user_key, type, object_id, project_id, title, content, url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_key, type, object_id) DO UPDATE SET
      project_id = excluded.project_id,
      title = excluded.title,
      content = excluded.content,
      url = excluded.url,
      updated_at = excluded.updated_at
  `);
  stmt.run(key, type, objectId, projectId, title, content, url, now, now);
}

export function clearSearchIndex(type, { userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  const stmt = db.prepare("DELETE FROM search_index WHERE user_key = ? AND type = ?");
  stmt.run(key, type);
  console.log(`[DB] Cleared search index for type: ${type}`);
}

export function searchIndex(query, { type, projectId, limit = 100, userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  const q = `%${query.toLowerCase()}%`;
  let sql = "SELECT * FROM search_index WHERE user_key = ? AND (LOWER(title) LIKE ? OR LOWER(content) LIKE ?)";
  const params = [key, q, q];

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

export function getIndexStats({ userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  const stmt = db.prepare("SELECT type, COUNT(*) as count FROM search_index WHERE user_key = ? GROUP BY type");
  return stmt.all(key);
}

export function upsertEntityCache(type, objectId, { projectId = null, title = null, data, userKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const key = normalizeUserKey(userKey) || "legacy";
  const stmt = db.prepare(`
    INSERT INTO entity_cache (user_key, type, object_id, project_id, title, data, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_key, type, object_id) DO UPDATE SET
      project_id = excluded.project_id,
      title = excluded.title,
      data = excluded.data,
      updated_at = excluded.updated_at
  `);
  stmt.run(key, type, String(objectId), projectId, title, JSON.stringify(data ?? {}), now);
}

export function listEntityCache(type, { projectId = null, limit = 200, userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  let sql = "SELECT * FROM entity_cache WHERE user_key = ? AND type = ?";
  const params = [key, type];
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

// Idempotency cache
export function getIdempotencyResponse(idempotencyKey, { method, path, userKey = null, maxAgeSec = 86400 } = {}) {
  if (!idempotencyKey || !method || !path) return null;
  const key = normalizeUserKey(userKey) || "legacy";
  const stmt = db.prepare(`
    SELECT response_json, updated_at
    FROM idempotency_cache
    WHERE user_key = ? AND idempotency_key = ? AND method = ? AND path = ?
  `);
  const row = stmt.get(key, idempotencyKey, method, path);
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Number.isFinite(maxAgeSec) && maxAgeSec > 0 && row.updated_at < now - maxAgeSec) {
    try {
      const del = db.prepare(`
        DELETE FROM idempotency_cache
        WHERE user_key = ? AND idempotency_key = ? AND method = ? AND path = ?
      `);
      del.run(key, idempotencyKey, method, path);
    } catch {
      // ignore cleanup errors
    }
    return null;
  }
  try {
    return JSON.parse(row.response_json);
  } catch {
    return null;
  }
}

export function setIdempotencyResponse(idempotencyKey, response, { method, path, userKey = null } = {}) {
  if (!idempotencyKey || !method || !path) return;
  const key = normalizeUserKey(userKey) || "legacy";
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    INSERT INTO idempotency_cache (user_key, idempotency_key, method, path, response_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_key, idempotency_key, method, path) DO UPDATE SET
      response_json = excluded.response_json,
      updated_at = excluded.updated_at
  `);
  stmt.run(key, idempotencyKey, method, path, JSON.stringify(response ?? {}), now, now);
}

function hashArgs(args) {
  const json = JSON.stringify(args || {});
  return crypto.createHash("sha256").update(json).digest("hex");
}

export function setToolCache(toolName, args, response, { userKey = null } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const key = normalizeUserKey(userKey) || "legacy";
  const argsJson = JSON.stringify(args || {});
  const responseJson = JSON.stringify(response ?? null);
  const argsHash = hashArgs(args || {});
  const stmt = db.prepare(`
    INSERT INTO tool_cache (user_key, tool_name, args_hash, args_json, response_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_key, tool_name, args_hash) DO UPDATE SET
      args_json = excluded.args_json,
      response_json = excluded.response_json,
      updated_at = excluded.updated_at
  `);
  stmt.run(key, toolName, argsHash, argsJson, responseJson, now);
}

export function listToolCache(toolName, { limit = 20, userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  const stmt = db.prepare(`
    SELECT tool_name, args_json, response_json, updated_at
    FROM tool_cache
    WHERE user_key = ? AND tool_name = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const rows = stmt.all(key, toolName, limit);
  return rows.map((row) => ({
    tool_name: row.tool_name,
    args: JSON.parse(row.args_json || "{}"),
    response: JSON.parse(row.response_json || "null"),
    updated_at: row.updated_at,
  }));
}

export function getMineState(key, { userKey = null } = {}) {
  const ukey = normalizeUserKey(userKey) || "legacy";
  const stmt = db.prepare("SELECT value, updated_at FROM mine_state WHERE user_key = ? AND key = ?");
  const row = stmt.get(ukey, key);
  if (!row) return null;
  return { value: row.value, updated_at: row.updated_at };
}

export function setMineState(key, value, { userKey = null } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const ukey = normalizeUserKey(userKey) || "legacy";
  const stmt = db.prepare(`
    INSERT INTO mine_state (user_key, key, value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_key, key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  stmt.run(ukey, key, value, now);
}

export function getEntityStats({ userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  const stmt = db.prepare("SELECT type, COUNT(*) as count FROM entity_cache WHERE user_key = ? GROUP BY type");
  return stmt.all(key);
}

export function getToolCacheStats({ userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  const stmt = db.prepare("SELECT tool_name, COUNT(*) as count FROM tool_cache WHERE user_key = ? GROUP BY tool_name");
  return stmt.all(key);
}

function migrateLegacyUserData() {
  if (!legacyUserKey) return;
  try {
    const hasUserToken = db.prepare("SELECT 1 FROM user_token WHERE user_key = ?").get(legacyUserKey);
    if (!hasUserToken) {
      const legacyToken = getToken();
      if (legacyToken?.access_token) {
        setUserToken(legacyToken, legacyUserKey);
      }
    }

    const hasUserAuth = db.prepare("SELECT 1 FROM user_auth_cache WHERE user_key = ?").get(legacyUserKey);
    if (!hasUserAuth) {
      const legacyAuth = getAuthCache();
      if (legacyAuth?.accounts) {
        setUserAuthCache(legacyAuth, legacyUserKey);
      }
    }
  } catch (e) {
    console.warn(`[DB] Legacy migration skipped: ${e?.message || e}`);
  }
}

migrateLegacyUserData();

export default db;
