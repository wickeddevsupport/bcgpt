import crypto from "crypto";
import pg from "pg";

export const DB_KIND = "postgres";

const { Pool } = pg;

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required to use the Postgres DB backend.");
}

const poolMaxRaw = process.env.DATABASE_POOL_MAX;
const poolMax = poolMaxRaw != null && String(poolMaxRaw).trim() !== "" ? Number(poolMaxRaw) : null;

const sslRequired = (() => {
  const mode = String(process.env.PGSSLMODE || "").trim().toLowerCase();
  if (["require", "verify-ca", "verify-full"].includes(mode)) return true;
  if (String(process.env.PGSSL || "").trim().toLowerCase() === "true") return true;
  return /sslmode=require/i.test(DATABASE_URL);
})();

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : undefined,
  ssl: sslRequired ? { rejectUnauthorized: false } : undefined,
});

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

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

function normalizeApiKey(apiKey) {
  if (!apiKey) return null;
  const trimmed = String(apiKey).trim();
  return trimmed ? trimmed : null;
}

function generateSessionKey() {
  return crypto.randomBytes(18).toString("hex");
}

function generateApiKey() {
  return crypto.randomBytes(24).toString("hex");
}

function hashArgs(args) {
  const json = JSON.stringify(args || {});
  return crypto.createHash("sha256").update(json).digest("hex");
}

async function ensureSchema() {
  // Ensure the connection is usable.
  await pool.query("SELECT 1");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS token (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      token_type TEXT DEFAULT 'Bearer',
      expires_in INTEGER,
      user_key TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      identity_name TEXT,
      identity_email TEXT,
      user_key TEXT,
      accounts TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_token (
      user_key TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      token_type TEXT DEFAULT 'Bearer',
      expires_in INTEGER,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_auth_cache (
      user_key TEXT PRIMARY KEY,
      identity_name TEXT,
      identity_email TEXT,
      accounts TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      session_key TEXT PRIMARY KEY,
      user_key TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_key ON user_sessions(user_key);

    CREATE TABLE IF NOT EXISTS user_api_keys (
      api_key TEXT PRIMARY KEY,
      user_key TEXT UNIQUE,
      access_token TEXT,
      token_type TEXT DEFAULT 'Bearer',
      created_at BIGINT NOT NULL,
      last_used_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_user_api_keys_user_key ON user_api_keys(user_key);

    -- Migration: add access_token column if missing (existing installs)
    DO $$ BEGIN
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS access_token TEXT;
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'Bearer';
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_key TEXT PRIMARY KEY,
      selected_account_id TEXT,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS search_index (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL DEFAULT 'legacy',
      type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      project_id INTEGER,
      title TEXT,
      content TEXT,
      url TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(user_key, type, object_id)
    );
    CREATE INDEX IF NOT EXISTS idx_search_user_type ON search_index(user_key, type);
    CREATE INDEX IF NOT EXISTS idx_search_user_project ON search_index(user_key, project_id);

    CREATE TABLE IF NOT EXISTS entity_cache (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL DEFAULT 'legacy',
      type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      project_id INTEGER,
      title TEXT,
      data TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(user_key, type, object_id)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_user_type ON entity_cache(user_key, type);
    CREATE INDEX IF NOT EXISTS idx_entity_user_project ON entity_cache(user_key, project_id);

    CREATE TABLE IF NOT EXISTS tool_cache (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL DEFAULT 'legacy',
      tool_name TEXT NOT NULL,
      args_hash TEXT NOT NULL,
      args_json TEXT NOT NULL,
      response_json TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(user_key, tool_name, args_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_tool_user_name ON tool_cache(user_key, tool_name);

    CREATE TABLE IF NOT EXISTS mine_state (
      user_key TEXT NOT NULL DEFAULT 'legacy',
      key TEXT NOT NULL,
      value TEXT,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(user_key, key)
    );

    CREATE TABLE IF NOT EXISTS idempotency_cache (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL DEFAULT 'legacy',
      idempotency_key TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE(user_key, idempotency_key, method, path)
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_user_key ON idempotency_cache(user_key, idempotency_key);

    CREATE TABLE IF NOT EXISTS activepieces_user_projects (
      user_key TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ap_user_project ON activepieces_user_projects(project_id);

    -- ============ Wave 1: PM OS Foundation ============

    CREATE TABLE IF NOT EXISTS session_memory (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_key TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      entity_name TEXT,
      context TEXT,
      mentioned_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_session_mem_session ON session_memory(session_id, user_key);
    CREATE INDEX IF NOT EXISTS idx_session_mem_entity ON session_memory(entity_type, entity_id);

    CREATE TABLE IF NOT EXISTS snapshots (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_snap_entity_time ON snapshots(entity_type, entity_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_snap_user_time ON snapshots(user_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS operation_log (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      session_id TEXT,
      agent_id TEXT,
      operation_type TEXT NOT NULL,
      target JSONB NOT NULL,
      args JSONB NOT NULL,
      result JSONB,
      undo_operation TEXT,
      undo_args JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      undone_at TIMESTAMPTZ,
      undone_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_oplog_user_time ON operation_log(user_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_oplog_session ON operation_log(session_id);

    -- Extend user_preferences with Wave 1 columns
    DO $$ BEGIN
      ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS timezone TEXT;
      ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS work_hours JSONB;
      ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS notification_style TEXT;
      ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS preferences JSONB;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;

    -- ============ Wave 2: Intelligence ============

    CREATE TABLE IF NOT EXISTS health_scores (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_name TEXT,
      score INTEGER NOT NULL,
      grade TEXT NOT NULL,
      trend TEXT DEFAULT 'stable',
      breakdown JSONB NOT NULL,
      risks JSONB DEFAULT '[]',
      insights JSONB DEFAULT '[]',
      recommendations JSONB DEFAULT '[]',
      computed_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_health_unique ON health_scores(user_key, project_id);
    CREATE INDEX IF NOT EXISTS idx_health_user ON health_scores(user_key, computed_at DESC);

    -- ============ Wave 3: Construction ============

    CREATE TABLE IF NOT EXISTS recipes (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      operations JSONB NOT NULL DEFAULT '[]',
      variables JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_key, created_at DESC);

    -- ============ Wave 4: Autonomy ============

    CREATE TABLE IF NOT EXISTS agents (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      name TEXT NOT NULL,
      goal TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'custom',
      strategy TEXT,
      auto_execute BOOLEAN DEFAULT FALSE,
      schedule TEXT DEFAULT 'on_demand',
      status TEXT DEFAULT 'active',
      last_run_at TIMESTAMPTZ,
      run_count INTEGER DEFAULT 0,
      action_count INTEGER DEFAULT 0,
      last_result JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_key, status);

    CREATE TABLE IF NOT EXISTS agent_runs (
      id BIGSERIAL PRIMARY KEY,
      agent_id BIGINT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      user_key TEXT NOT NULL,
      phase TEXT NOT NULL,
      observations JSONB,
      analysis JSONB,
      decisions JSONB,
      actions JSONB,
      actions_taken INTEGER DEFAULT 0,
      dry_run BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS event_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      event TEXT NOT NULL,
      project_filter TEXT,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_event_subs_user ON event_subscriptions(user_key, active);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_event_subs_unique ON event_subscriptions(user_key, event, COALESCE(project_filter, ''));
  `);
}

await ensureSchema();

// Token operations (legacy single-user)
export async function getToken() {
  const res = await pool.query("SELECT access_token, token_type, expires_in, user_key FROM token WHERE id = 1");
  const row = res.rows[0];
  if (!row) return null;
  return {
    access_token: row.access_token,
    token_type: row.token_type,
    expires_in: row.expires_in,
    user_key: row.user_key || null,
  };
}

export async function setToken(token, userKey = null) {
  const now = nowSec();
  const key = normalizeUserKey(userKey);
  await pool.query(
    `
      INSERT INTO token (id, access_token, token_type, expires_in, user_key, created_at, updated_at)
      VALUES (1, $1, $2, $3, $4, $5, $5)
      ON CONFLICT (id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        token_type = EXCLUDED.token_type,
        expires_in = EXCLUDED.expires_in,
        user_key = EXCLUDED.user_key,
        updated_at = EXCLUDED.updated_at
    `,
    [token.access_token, token.token_type || "Bearer", token.expires_in, key, now]
  );
}

export async function clearToken() {
  await pool.query("DELETE FROM token WHERE id = 1");
}

// Auth cache operations (legacy single-user)
export async function getAuthCache() {
  const res = await pool.query(
    "SELECT identity_name, identity_email, accounts, user_key FROM auth_cache WHERE id = 1"
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    identity: { name: row.identity_name, email_address: row.identity_email },
    accounts: JSON.parse(row.accounts || "[]"),
    user_key: row.user_key || null,
  };
}

export async function setAuthCache(auth, userKey = null) {
  const now = nowSec();
  const key = normalizeUserKey(userKey);
  await pool.query(
    `
      INSERT INTO auth_cache (id, identity_name, identity_email, user_key, accounts, updated_at)
      VALUES (1, $1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        identity_name = EXCLUDED.identity_name,
        identity_email = EXCLUDED.identity_email,
        user_key = EXCLUDED.user_key,
        accounts = EXCLUDED.accounts,
        updated_at = EXCLUDED.updated_at
    `,
    [
      auth?.identity?.name || null,
      auth?.identity?.email_address || null,
      key,
      JSON.stringify(auth?.accounts || []),
      now,
    ]
  );
}

export async function clearAuthCache() {
  await pool.query("DELETE FROM auth_cache WHERE id = 1");
}

// User-scoped token operations
export async function getUserToken(userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return null;
  const res = await pool.query(
    "SELECT access_token, token_type, expires_in, user_key FROM user_token WHERE user_key = $1",
    [key]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    access_token: row.access_token,
    token_type: row.token_type,
    expires_in: row.expires_in,
    user_key: row.user_key,
  };
}

export async function setUserToken(token, userKey) {
  const key = normalizeUserKey(userKey);
  if (!key || !token?.access_token) return;
  const now = nowSec();
  await pool.query(
    `
      INSERT INTO user_token (user_key, access_token, token_type, expires_in, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $5)
      ON CONFLICT (user_key) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        token_type = EXCLUDED.token_type,
        expires_in = EXCLUDED.expires_in,
        updated_at = EXCLUDED.updated_at
    `,
    [key, token.access_token, token.token_type || "Bearer", token.expires_in, now]
  );

  // Also sync to user_api_keys so the token is never lost
  try {
    await pool.query(
      "UPDATE user_api_keys SET access_token = $1, token_type = $2 WHERE user_key = $3",
      [token.access_token, token.token_type || "Bearer", key]
    );
  } catch { /* ignore — api key may not exist yet */ }
}

export async function clearUserToken(userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return;
  await pool.query("DELETE FROM user_token WHERE user_key = $1", [key]);
}

// User-scoped auth cache operations
export async function getUserAuthCache(userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return null;
  const res = await pool.query(
    "SELECT identity_name, identity_email, accounts, user_key FROM user_auth_cache WHERE user_key = $1",
    [key]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    identity: { name: row.identity_name, email_address: row.identity_email },
    accounts: JSON.parse(row.accounts || "[]"),
    user_key: row.user_key || null,
  };
}

export async function setUserAuthCache(auth, userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return;
  const now = nowSec();
  await pool.query(
    `
      INSERT INTO user_auth_cache (user_key, identity_name, identity_email, accounts, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_key) DO UPDATE SET
        identity_name = EXCLUDED.identity_name,
        identity_email = EXCLUDED.identity_email,
        accounts = EXCLUDED.accounts,
        updated_at = EXCLUDED.updated_at
    `,
    [
      key,
      auth?.identity?.name || null,
      auth?.identity?.email_address || null,
      JSON.stringify(auth?.accounts || []),
      now,
    ]
  );
}

export async function clearUserAuthCache(userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return;
  await pool.query("DELETE FROM user_auth_cache WHERE user_key = $1", [key]);
}

// Session operations
export async function createSession(sessionKey = null, userKey = null) {
  const key = normalizeSessionKey(sessionKey) || generateSessionKey();
  const ukey = normalizeUserKey(userKey);
  const now = nowSec();
  await pool.query(
    `
      INSERT INTO user_sessions (session_key, user_key, created_at, updated_at)
      VALUES ($1, $2, $3, $3)
      ON CONFLICT (session_key) DO UPDATE SET
        user_key = COALESCE(EXCLUDED.user_key, user_sessions.user_key),
        updated_at = EXCLUDED.updated_at
    `,
    [key, ukey, now]
  );
  return key;
}

export async function bindSession(sessionKey, userKey) {
  const key = normalizeSessionKey(sessionKey);
  const ukey = normalizeUserKey(userKey);
  if (!key) return null;
  const now = nowSec();
  await pool.query(
    `
      INSERT INTO user_sessions (session_key, user_key, created_at, updated_at)
      VALUES ($1, $2, $3, $3)
      ON CONFLICT (session_key) DO UPDATE SET
        user_key = EXCLUDED.user_key,
        updated_at = EXCLUDED.updated_at
    `,
    [key, ukey, now]
  );
  return key;
}

export async function getSessionUser(sessionKey) {
  const key = normalizeSessionKey(sessionKey);
  if (!key) return null;
  const res = await pool.query("SELECT user_key FROM user_sessions WHERE session_key = $1", [key]);
  return res.rows[0]?.user_key || null;
}

export async function deleteSession(sessionKey) {
  const key = normalizeSessionKey(sessionKey);
  if (!key) return;
  await pool.query("DELETE FROM user_sessions WHERE session_key = $1", [key]);
}

// API key operations
export async function getApiKeyForUser(userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return null;
  const res = await pool.query("SELECT api_key FROM user_api_keys WHERE user_key = $1", [key]);
  return res.rows[0]?.api_key || null;
}

export async function createApiKeyForUser(userKey, token = null) {
  const key = normalizeUserKey(userKey);
  if (!key) return null;

  // If key already exists, update the token and return existing key
  const existing = await getApiKeyForUser(key);
  if (existing) {
    if (token?.access_token) {
      await pool.query(
        "UPDATE user_api_keys SET access_token = $1, token_type = $2 WHERE api_key = $3",
        [token.access_token, token.token_type || "Bearer", existing]
      );
    }
    return existing;
  }

  const accessToken = token?.access_token || null;
  const tokenType = token?.token_type || "Bearer";
  const now = nowSec();
  for (let attempt = 0; attempt < 5; attempt++) {
    const apiKey = generateApiKey();
    try {
      await pool.query(
        "INSERT INTO user_api_keys (api_key, user_key, access_token, token_type, created_at, last_used_at) VALUES ($1, $2, $3, $4, $5, $5)",
        [apiKey, key, accessToken, tokenType, now]
      );
      return apiKey;
    } catch (e) {
      // Unique violation (collision or user_key already has a key)
      if (e?.code === "23505") {
        const already = await getApiKeyForUser(key);
        if (already) return already;
        continue;
      }
      throw e;
    }
  }
  throw new Error("API_KEY_CREATE_FAILED");
}

export async function getUserByApiKey(apiKey, { touch = true } = {}) {
  const key = normalizeApiKey(apiKey);
  if (!key) return null;
  const res = await pool.query("SELECT user_key, access_token, token_type FROM user_api_keys WHERE api_key = $1", [key]);
  const row = res.rows[0];
  const userKey = row?.user_key || null;
  if (!userKey) return null;
  if (touch) {
    await pool.query("UPDATE user_api_keys SET last_used_at = $1 WHERE api_key = $2", [nowSec(), key]);
  }

  // Auto-heal: if user_token is missing but api_key has the token, restore it
  if (row.access_token) {
    const existing = await pool.query("SELECT user_key FROM user_token WHERE user_key = $1", [userKey]);
    if (!existing.rows.length) {
      const now = nowSec();
      await pool.query(
        `INSERT INTO user_token (user_key, access_token, token_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (user_key) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           token_type = EXCLUDED.token_type,
           updated_at = EXCLUDED.updated_at`,
        [userKey, row.access_token, row.token_type || "Bearer", now]
      );
    }
  }
  return userKey;
}

export async function bindApiKeyToUser(apiKey, userKey, token = null) {
  const key = normalizeApiKey(apiKey);
  const ukey = normalizeUserKey(userKey);
  if (!key || !ukey) return null;

  const existing = await pool.query("SELECT user_key FROM user_api_keys WHERE api_key = $1", [key]);
  const existingUser = existing.rows[0]?.user_key || null;
  if (existingUser && existingUser !== ukey) {
    const err = new Error("API_KEY_IN_USE");
    err.code = "API_KEY_IN_USE";
    throw err;
  }

  const accessToken = token?.access_token || null;
  const tokenType = token?.token_type || "Bearer";
  const now = nowSec();
  await pool.query(
    `
      INSERT INTO user_api_keys (api_key, user_key, access_token, token_type, created_at, last_used_at)
      VALUES ($1, $2, $3, $4, $5, $5)
      ON CONFLICT (api_key) DO UPDATE SET
        user_key = EXCLUDED.user_key,
        access_token = COALESCE(EXCLUDED.access_token, user_api_keys.access_token),
        token_type = COALESCE(EXCLUDED.token_type, user_api_keys.token_type),
        last_used_at = EXCLUDED.last_used_at
    `,
    [key, ukey, accessToken, tokenType, now]
  );
  return key;
}

// User preference operations
export async function getSelectedAccount(userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return null;
  const res = await pool.query(
    "SELECT selected_account_id FROM user_preferences WHERE user_key = $1",
    [key]
  );
  const v = res.rows[0]?.selected_account_id;
  return v != null && String(v).trim() ? String(v) : null;
}

export async function setSelectedAccount(userKey, accountId) {
  const key = normalizeUserKey(userKey);
  if (!key) return null;
  const value = accountId == null ? null : String(accountId);
  const now = nowSec();
  await pool.query(
    `
      INSERT INTO user_preferences (user_key, selected_account_id, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_key) DO UPDATE SET
        selected_account_id = EXCLUDED.selected_account_id,
        updated_at = EXCLUDED.updated_at
    `,
    [key, value, now]
  );
  return value;
}

// Search index operations
export async function indexSearchItem(type, objectId, { projectId, title, content, url, userKey } = {}) {
  const now = nowSec();
  const key = normalizeUserKey(userKey) || "legacy";
  await pool.query(
    `
      INSERT INTO search_index (user_key, type, object_id, project_id, title, content, url, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      ON CONFLICT (user_key, type, object_id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        url = EXCLUDED.url,
        updated_at = EXCLUDED.updated_at
    `,
    [key, type, String(objectId), projectId, title || null, content || null, url || null, now]
  );
}

export async function clearSearchIndex(type, { userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  await pool.query("DELETE FROM search_index WHERE user_key = $1 AND type = $2", [key, type]);
}

export async function searchIndex(query, { type, projectId, limit = 100, userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  const q = `%${String(query || "").toLowerCase()}%`;
  const params = [key, q, q];
  let sql =
    "SELECT * FROM search_index WHERE user_key = $1 AND (LOWER(title) LIKE $2 OR LOWER(content) LIKE $3)";
  let idx = params.length;
  if (type) {
    idx++;
    sql += ` AND type = $${idx}`;
    params.push(type);
  }
  if (projectId != null) {
    idx++;
    sql += ` AND project_id = $${idx}`;
    params.push(projectId);
  }
  idx++;
  sql += ` ORDER BY updated_at DESC LIMIT $${idx}`;
  params.push(limit);
  const res = await pool.query(sql, params);
  return res.rows;
}

export async function getIndexStats({ userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  const res = await pool.query(
    "SELECT type, COUNT(*)::int as count FROM search_index WHERE user_key = $1 GROUP BY type",
    [key]
  );
  return res.rows;
}

// Entity cache operations
export async function upsertEntityCache(type, objectId, { projectId = null, title = null, data, userKey } = {}) {
  const now = nowSec();
  const key = normalizeUserKey(userKey) || "legacy";
  await pool.query(
    `
      INSERT INTO entity_cache (user_key, type, object_id, project_id, title, data, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (user_key, type, object_id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        title = EXCLUDED.title,
        data = EXCLUDED.data,
        updated_at = EXCLUDED.updated_at
    `,
    [key, type, String(objectId), projectId, title, JSON.stringify(data ?? {}), now]
  );
}

export async function listEntityCache(type, { projectId = null, limit = 200, userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  const params = [key, type];
  let sql = "SELECT * FROM entity_cache WHERE user_key = $1 AND type = $2";
  let idx = params.length;
  if (projectId != null) {
    idx++;
    sql += ` AND project_id = $${idx}`;
    params.push(projectId);
  }
  idx++;
  sql += ` ORDER BY updated_at DESC LIMIT $${idx}`;
  params.push(limit);
  const res = await pool.query(sql, params);
  return res.rows.map((row) => ({
    type: row.type,
    object_id: row.object_id,
    project_id: row.project_id,
    title: row.title,
    data: (() => {
      try {
        return JSON.parse(row.data || "{}");
      } catch {
        return {};
      }
    })(),
    updated_at: Number(row.updated_at) || row.updated_at,
  }));
}

// Idempotency cache
export async function getIdempotencyResponse(
  idempotencyKey,
  { method, path, userKey = null, maxAgeSec = 86400 } = {}
) {
  if (!idempotencyKey || !method || !path) return null;
  const key = normalizeUserKey(userKey) || "legacy";
  const res = await pool.query(
    `
      SELECT response_json, updated_at
      FROM idempotency_cache
      WHERE user_key = $1 AND idempotency_key = $2 AND method = $3 AND path = $4
    `,
    [key, idempotencyKey, method, path]
  );
  const row = res.rows[0];
  if (!row) return null;

  const now = nowSec();
  const updated = Number(row.updated_at) || 0;
  if (Number.isFinite(maxAgeSec) && maxAgeSec > 0 && updated < now - maxAgeSec) {
    try {
      await pool.query(
        `
          DELETE FROM idempotency_cache
          WHERE user_key = $1 AND idempotency_key = $2 AND method = $3 AND path = $4
        `,
        [key, idempotencyKey, method, path]
      );
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

export async function setIdempotencyResponse(idempotencyKey, response, { method, path, userKey = null } = {}) {
  if (!idempotencyKey || !method || !path) return;
  const key = normalizeUserKey(userKey) || "legacy";
  const now = nowSec();
  await pool.query(
    `
      INSERT INTO idempotency_cache (user_key, idempotency_key, method, path, response_json, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $6)
      ON CONFLICT (user_key, idempotency_key, method, path) DO UPDATE SET
        response_json = EXCLUDED.response_json,
        updated_at = EXCLUDED.updated_at
    `,
    [key, idempotencyKey, method, path, JSON.stringify(response ?? {}), now]
  );
}

// Tool cache
export async function setToolCache(toolName, args, response, { userKey = null } = {}) {
  const now = nowSec();
  const key = normalizeUserKey(userKey) || "legacy";
  const argsJson = JSON.stringify(args || {});
  const responseJson = JSON.stringify(response ?? null);
  const argsHash = hashArgs(args || {});
  await pool.query(
    `
      INSERT INTO tool_cache (user_key, tool_name, args_hash, args_json, response_json, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_key, tool_name, args_hash) DO UPDATE SET
        args_json = EXCLUDED.args_json,
        response_json = EXCLUDED.response_json,
        updated_at = EXCLUDED.updated_at
    `,
    [key, toolName, argsHash, argsJson, responseJson, now]
  );
}

export async function listToolCache(toolName, { limit = 20, userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  const res = await pool.query(
    `
      SELECT tool_name, args_json, response_json, updated_at
      FROM tool_cache
      WHERE user_key = $1 AND tool_name = $2
      ORDER BY updated_at DESC
      LIMIT $3
    `,
    [key, toolName, limit]
  );
  return res.rows.map((row) => ({
    tool_name: row.tool_name,
    args: (() => {
      try {
        return JSON.parse(row.args_json || "{}");
      } catch {
        return {};
      }
    })(),
    response: (() => {
      try {
        return JSON.parse(row.response_json || "null");
      } catch {
        return null;
      }
    })(),
    updated_at: Number(row.updated_at) || row.updated_at,
  }));
}

export async function getMineState(key, { userKey = null } = {}) {
  const ukey = normalizeUserKey(userKey) || "legacy";
  const res = await pool.query("SELECT value, updated_at FROM mine_state WHERE user_key = $1 AND key = $2", [
    ukey,
    key,
  ]);
  const row = res.rows[0];
  if (!row) return null;
  return { value: row.value, updated_at: Number(row.updated_at) || row.updated_at };
}

export async function setMineState(key, value, { userKey = null } = {}) {
  const now = nowSec();
  const ukey = normalizeUserKey(userKey) || "legacy";
  await pool.query(
    `
      INSERT INTO mine_state (user_key, key, value, updated_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_key, key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at
    `,
    [ukey, key, value, now]
  );
}

export async function getEntityStats({ userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  const res = await pool.query(
    "SELECT type, COUNT(*)::int as count FROM entity_cache WHERE user_key = $1 GROUP BY type",
    [key]
  );
  return res.rows;
}

export async function getToolCacheStats({ userKey = null } = {}) {
  const key = normalizeUserKey(userKey) || "legacy";
  const res = await pool.query(
    "SELECT tool_name, COUNT(*)::int as count FROM tool_cache WHERE user_key = $1 GROUP BY tool_name",
    [key]
  );
  return res.rows;
}

/* ================= ACTIVEPIECES USER PROJECT MAPPING ================= */

export async function getActivepiecesProject(userKey) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return null;

  const result = await pool.query(
    "SELECT project_id, project_name, updated_at FROM activepieces_user_projects WHERE user_key = $1",
    [userKey]
  );

  if (result.rows.length === 0) return null;

  return {
    projectId: result.rows[0].project_id,
    projectName: result.rows[0].project_name,
    updatedAt: result.rows[0].updated_at
  };
}

export async function setActivepiecesProject(userKey, projectId, projectName) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !projectId) return;

  const now = nowSec();

  await pool.query(
    `INSERT INTO activepieces_user_projects (user_key, project_id, project_name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_key)
     DO UPDATE SET project_id = $2, project_name = $3, updated_at = $5`,
    [userKey, projectId, projectName || null, now, now]
  );

  return { projectId, projectName };
}

export async function clearActivepiecesProject(userKey) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return;
  await pool.query("DELETE FROM activepieces_user_projects WHERE user_key = $1", [userKey]);
}

/* ================= WAVE 1: SESSION MEMORY ================= */

export async function saveSessionMemory(sessionId, userKey, entityType, entityId, entityName, context) {
  userKey = normalizeUserKey(userKey);
  if (!sessionId || !userKey) return;
  await pool.query(
    `INSERT INTO session_memory (session_id, user_key, entity_type, entity_id, entity_name, context)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, userKey, entityType || null, entityId || null, entityName || null, context || null]
  );
}

export async function getSessionMemory(sessionId, userKey, entityType = null, limit = 10) {
  userKey = normalizeUserKey(userKey);
  if (!sessionId || !userKey) return [];
  let sql = `SELECT entity_type, entity_id, entity_name, context, mentioned_at
             FROM session_memory
             WHERE session_id = $1 AND user_key = $2`;
  const params = [sessionId, userKey];
  if (entityType) {
    sql += ` AND entity_type = $3`;
    params.push(entityType);
  }
  sql += ` ORDER BY mentioned_at DESC LIMIT ${parseInt(limit) || 10}`;
  const res = await pool.query(sql, params);
  return res.rows;
}

export async function cleanSessionMemory(sessionId, ttlHours = 24) {
  const cutoff = new Date(Date.now() - ttlHours * 3600 * 1000).toISOString();
  if (sessionId) {
    await pool.query(`DELETE FROM session_memory WHERE session_id = $1 AND mentioned_at < $2`, [sessionId, cutoff]);
  } else {
    await pool.query(`DELETE FROM session_memory WHERE mentioned_at < $1`, [cutoff]);
  }
}

/* ================= WAVE 1: SNAPSHOTS ================= */

export async function saveSnapshot(userKey, entityType, entityId, snapshot) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !entityType || !entityId) return;
  await pool.query(
    `INSERT INTO snapshots (user_key, entity_type, entity_id, snapshot)
     VALUES ($1, $2, $3, $4)`,
    [userKey, entityType, entityId, JSON.stringify(snapshot)]
  );
}

export async function getSnapshots(userKey, entityType, entityId, since, until = null) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !entityType || !entityId) return [];
  let sql = `SELECT id, snapshot, created_at FROM snapshots
             WHERE user_key = $1 AND entity_type = $2 AND entity_id = $3 AND created_at >= $4`;
  const params = [userKey, entityType, entityId, new Date(since).toISOString()];
  if (until) {
    sql += ` AND created_at <= $5`;
    params.push(new Date(until).toISOString());
  }
  sql += ` ORDER BY created_at ASC`;
  const res = await pool.query(sql, params);
  return res.rows;
}

export async function getLatestSnapshot(userKey, entityType, entityId, beforeDate = null) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !entityType || !entityId) return null;
  let sql = `SELECT id, snapshot, created_at FROM snapshots
             WHERE user_key = $1 AND entity_type = $2 AND entity_id = $3`;
  const params = [userKey, entityType, entityId];
  if (beforeDate) {
    sql += ` AND created_at <= $4`;
    params.push(new Date(beforeDate).toISOString());
  }
  sql += ` ORDER BY created_at DESC LIMIT 1`;
  const res = await pool.query(sql, params);
  return res.rows[0] || null;
}

export async function cleanSnapshots(retentionDays = 90) {
  const cutoff = new Date(Date.now() - retentionDays * 86400 * 1000).toISOString();
  const res = await pool.query(`DELETE FROM snapshots WHERE created_at < $1`, [cutoff]);
  return res.rowCount;
}

/* ================= WAVE 1: OPERATION LOG ================= */

export async function logOperation(userKey, sessionId, operationType, target, args, result, undoOperation = null, undoArgs = null) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !operationType) return null;
  const res = await pool.query(
    `INSERT INTO operation_log (user_key, session_id, operation_type, target, args, result, undo_operation, undo_args)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, created_at`,
    [
      userKey,
      sessionId || null,
      operationType,
      JSON.stringify(target || {}),
      JSON.stringify(args || {}),
      result ? JSON.stringify(result) : null,
      undoOperation || null,
      undoArgs ? JSON.stringify(undoArgs) : null
    ]
  );
  return res.rows[0];
}

export async function getRecentOperations(userKey, limit = 20, since = null, operationType = null) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return [];
  let sql = `SELECT id, session_id, agent_id, operation_type, target, args, result,
                    undo_operation, undo_args, created_at, undone_at, undone_by
             FROM operation_log
             WHERE user_key = $1 AND undone_at IS NULL`;
  const params = [userKey];
  let paramIdx = 2;
  if (since) {
    sql += ` AND created_at >= $${paramIdx}`;
    params.push(new Date(since).toISOString());
    paramIdx++;
  }
  if (operationType) {
    sql += ` AND operation_type = $${paramIdx}`;
    params.push(operationType);
    paramIdx++;
  }
  sql += ` ORDER BY created_at DESC LIMIT ${parseInt(limit) || 20}`;
  const res = await pool.query(sql, params);
  return res.rows;
}

export async function getOperation(operationId) {
  const res = await pool.query(
    `SELECT id, user_key, session_id, agent_id, operation_type, target, args, result,
            undo_operation, undo_args, created_at, undone_at, undone_by
     FROM operation_log WHERE id = $1`,
    [operationId]
  );
  return res.rows[0] || null;
}

export async function markUndone(operationId, undoneBy) {
  await pool.query(
    `UPDATE operation_log SET undone_at = NOW(), undone_by = $2 WHERE id = $1`,
    [operationId, undoneBy || null]
  );
}

/* ================= WAVE 2: HEALTH SCORES CACHE ================= */

export async function saveHealthScore(userKey, projectId, projectName, score, grade, trend, breakdown, risks, insights, recommendations) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !projectId) return null;
  const res = await pool.query(
    `INSERT INTO health_scores (user_key, project_id, project_name, score, grade, trend, breakdown, risks, insights, recommendations, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (user_key, project_id)
     DO UPDATE SET project_name = $3, score = $4, grade = $5, trend = $6, breakdown = $7,
                   risks = $8, insights = $9, recommendations = $10, computed_at = NOW()
     RETURNING id, computed_at`,
    [userKey, projectId, projectName || null, score, grade, trend || 'stable',
     JSON.stringify(breakdown), JSON.stringify(risks || []),
     JSON.stringify(insights || []), JSON.stringify(recommendations || [])]
  );
  return res.rows[0];
}

export async function getHealthScore(userKey, projectId) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !projectId) return null;
  const res = await pool.query(
    `SELECT * FROM health_scores WHERE user_key = $1 AND project_id = $2`,
    [userKey, projectId]
  );
  return res.rows[0] || null;
}

export async function getAllHealthScores(userKey) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return [];
  const res = await pool.query(
    `SELECT * FROM health_scores WHERE user_key = $1 ORDER BY score ASC`,
    [userKey]
  );
  return res.rows;
}

/* ================= WAVE 3: RECIPES ================= */

export async function saveRecipe(userKey, name, description, operations, variables) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !name) return null;
  const res = await pool.query(
    `INSERT INTO recipes (user_key, name, description, operations, variables)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [userKey, name, description || null, JSON.stringify(operations || []), JSON.stringify(variables || [])]
  );
  return res.rows[0];
}

export async function listRecipes(userKey, limit = 20) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return [];
  const res = await pool.query(
    `SELECT id, name, description, variables, created_at, updated_at,
            jsonb_array_length(operations) as operation_count
     FROM recipes WHERE user_key = $1 ORDER BY updated_at DESC LIMIT $2`,
    [userKey, limit]
  );
  return res.rows;
}

export async function getRecipe(userKey, recipeIdOrName) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return null;
  // Try by ID first, then by name
  const byId = await pool.query(
    `SELECT * FROM recipes WHERE user_key = $1 AND id = $2`,
    [userKey, parseInt(recipeIdOrName) || 0]
  );
  if (byId.rows[0]) return byId.rows[0];
  const byName = await pool.query(
    `SELECT * FROM recipes WHERE user_key = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [userKey, recipeIdOrName]
  );
  return byName.rows[0] || null;
}

export async function deleteRecipe(userKey, recipeIdOrName) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return false;
  const recipe = await getRecipe(userKey, recipeIdOrName);
  if (!recipe) return false;
  await pool.query(`DELETE FROM recipes WHERE id = $1`, [recipe.id]);
  return true;
}

// ========== Wave 4: Autonomy ==========

export async function createAgent(userKey, { name, goal, type, strategy, auto_execute, schedule }) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !name || !goal) return null;
  const res = await pool.query(
    `INSERT INTO agents (user_key, name, goal, type, strategy, auto_execute, schedule)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userKey, name, goal, type || 'custom', strategy || null, auto_execute || false, schedule || 'on_demand']
  );
  return res.rows[0];
}

export async function listAgents(userKey, status = 'all') {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return [];
  const where = status === 'all'
    ? `WHERE user_key = $1`
    : `WHERE user_key = $1 AND status = $2`;
  const params = status === 'all' ? [userKey] : [userKey, status];
  const res = await pool.query(
    `SELECT * FROM agents ${where} ORDER BY created_at DESC`,
    params
  );
  return res.rows;
}

export async function getAgent(userKey, agentIdOrName) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !agentIdOrName) return null;
  const res = await pool.query(
    `SELECT * FROM agents WHERE user_key = $1 AND (id = $2 OR LOWER(name) = LOWER($3))`,
    [userKey, isNaN(agentIdOrName) ? -1 : Number(agentIdOrName), String(agentIdOrName)]
  );
  return res.rows[0] || null;
}

export async function updateAgent(userKey, agentId, updates) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !agentId) return null;
  const fields = [];
  const vals = [userKey, agentId];
  let idx = 3;
  for (const [key, val] of Object.entries(updates)) {
    if (['status', 'last_run_at', 'run_count', 'action_count', 'last_result', 'strategy', 'auto_execute', 'schedule'].includes(key)) {
      fields.push(`${key} = $${idx}`);
      vals.push(key === 'last_result' ? JSON.stringify(val) : val);
      idx++;
    }
  }
  if (!fields.length) return null;
  fields.push(`updated_at = NOW()`);
  const res = await pool.query(
    `UPDATE agents SET ${fields.join(', ')} WHERE user_key = $1 AND id = $2 RETURNING *`,
    vals
  );
  return res.rows[0] || null;
}

export async function deleteAgent(userKey, agentIdOrName) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return false;
  const agent = await getAgent(userKey, agentIdOrName);
  if (!agent) return false;
  await pool.query(`DELETE FROM agents WHERE id = $1`, [agent.id]);
  return true;
}

export async function saveAgentRun(agentId, userKey, runData) {
  userKey = normalizeUserKey(userKey);
  const res = await pool.query(
    `INSERT INTO agent_runs (agent_id, user_key, phase, observations, analysis, decisions, actions, actions_taken, dry_run)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, created_at`,
    [agentId, userKey, runData.phase || 'complete',
     JSON.stringify(runData.observations || null),
     JSON.stringify(runData.analysis || null),
     JSON.stringify(runData.decisions || null),
     JSON.stringify(runData.actions || null),
     runData.actions_taken || 0,
     runData.dry_run || false]
  );
  return res.rows[0];
}

export async function getAgentRuns(agentId, limit = 10) {
  const res = await pool.query(
    `SELECT * FROM agent_runs WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [agentId, limit]
  );
  return res.rows;
}

export async function subscribeEvent(userKey, event, projectFilter = null) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !event) return null;
  const res = await pool.query(
    `INSERT INTO event_subscriptions (user_key, event, project_filter)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_key, event, COALESCE(project_filter, ''))
     DO UPDATE SET active = TRUE
     RETURNING *`,
    [userKey, event, projectFilter || null]
  );
  return res.rows[0];
}

export async function unsubscribeEvent(userKey, event, projectFilter = null) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !event) return false;
  const res = await pool.query(
    `UPDATE event_subscriptions SET active = FALSE
     WHERE user_key = $1 AND event = $2 AND COALESCE(project_filter, '') = COALESCE($3, '')`,
    [userKey, event, projectFilter || null]
  );
  return res.rowCount > 0;
}

export async function listSubscriptions(userKey) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return [];
  const res = await pool.query(
    `SELECT * FROM event_subscriptions WHERE user_key = $1 AND active = TRUE ORDER BY created_at DESC`,
    [userKey]
  );
  return res.rows;
}

export default pool;

