import crypto from "crypto";
import pg from "pg";

export const DB_KIND = "postgres";

const { Pool } = pg;

let DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const BCGPT_POSTGRES_PASSWORD = String(process.env.BCGPT_POSTGRES_PASSWORD || "").trim();
if (DATABASE_URL && BCGPT_POSTGRES_PASSWORD) {
  try {
    const parsed = new URL(DATABASE_URL);
    const protocol = String(parsed.protocol || "").toLowerCase();
    if ((protocol === "postgres:" || protocol === "postgresql:") && !parsed.password) {
      parsed.password = BCGPT_POSTGRES_PASSWORD;
      DATABASE_URL = parsed.toString();
      console.warn("[db.postgres] DATABASE_URL had empty password; repaired from BCGPT_POSTGRES_PASSWORD");
    }
  } catch {
    // Ignore malformed DATABASE_URL here and let the existing validation/error path handle it.
  }
}
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required to use the Postgres DB backend.");
}

const poolMaxRaw = process.env.DATABASE_POOL_MAX;
const poolMax = poolMaxRaw != null && String(poolMaxRaw).trim() !== "" ? Number(poolMaxRaw) : null;
const DB_CONNECTION_TIMEOUT_MS = Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000);
const DB_QUERY_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT_MS || 10000);
const DB_STATEMENT_TIMEOUT_MS = Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15000);
const DB_IDLE_TX_TIMEOUT_MS = Number(process.env.DB_IDLE_TX_TIMEOUT_MS || 15000);

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
  connectionTimeoutMillis: Number.isFinite(DB_CONNECTION_TIMEOUT_MS) ? DB_CONNECTION_TIMEOUT_MS : 5000,
  query_timeout: Number.isFinite(DB_QUERY_TIMEOUT_MS) ? DB_QUERY_TIMEOUT_MS : 10000,
  statement_timeout: Number.isFinite(DB_STATEMENT_TIMEOUT_MS) ? DB_STATEMENT_TIMEOUT_MS : 15000,
  idle_in_transaction_session_timeout: Number.isFinite(DB_IDLE_TX_TIMEOUT_MS) ? DB_IDLE_TX_TIMEOUT_MS : 15000,
});
const rawPoolQuery = pool.query.bind(pool);

function isPgScramPasswordTypeBug(error) {
  const msg = String(error?.message || "");
  return msg.includes("SCRAM-SERVER-FIRST-MESSAGE: client password must be a string");
}

// Defensive retry for an intermittent pg/connection handshake failure observed in production.
// This error happens before the SQL is executed, so one retry is safe.
pool.query = async (...args) => {
  try {
    return await rawPoolQuery(...args);
  } catch (error) {
    if (!isPgScramPasswordTypeBug(error)) {
      throw error;
    }
    try {
      const sql = typeof args[0] === "string" ? args[0].replace(/\s+/g, " ").trim().slice(0, 80) : "<non-sql>";
      console.warn("[db.postgres] retrying query after pg SCRAM password-type error:", sql);
    } catch {
      console.warn("[db.postgres] retrying query after pg SCRAM password-type error");
    }
    return rawPoolQuery(...args);
  }
};
const SCHEMA_LOCK_ID = 904624001;
const SCHEMA_LOCK_TIMEOUT_MS = Number(process.env.DB_SCHEMA_LOCK_TIMEOUT_MS || 5000);
const SCHEMA_STATEMENT_TIMEOUT_MS = Number(process.env.DB_SCHEMA_STATEMENT_TIMEOUT_MS || 60000);

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

function parseJsonSafe(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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
  const client = await pool.connect();
  try {
    await client.query(`SET lock_timeout TO '${SCHEMA_LOCK_TIMEOUT_MS}ms'`);
    await client.query(`SET statement_timeout TO '${SCHEMA_STATEMENT_TIMEOUT_MS}ms'`);
    const lock = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [SCHEMA_LOCK_ID]);
    if (!lock.rows?.[0]?.locked) {
      console.warn("[db.postgres] ensureSchema skipped: migration lock already held");
      return;
    }

    try {
      await client.query(`
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

    -- Migration: add access_token / refresh_token columns if missing (existing installs)
    DO $$ BEGIN
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS access_token TEXT;
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'Bearer';
      ALTER TABLE user_api_keys ADD COLUMN IF NOT EXISTS refresh_token TEXT;
      ALTER TABLE user_token ADD COLUMN IF NOT EXISTS refresh_token TEXT;
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

    CREATE TABLE IF NOT EXISTS basecamp_sync_state (
      user_key TEXT NOT NULL,
      account_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'workspace',
      status TEXT NOT NULL,
      last_started_at BIGINT,
      last_completed_at BIGINT,
      last_success_at BIGINT,
      last_error TEXT,
      stats_json TEXT,
      PRIMARY KEY(user_key, account_id, scope)
    );

    CREATE TABLE IF NOT EXISTS basecamp_sync_runs (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      account_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'workspace',
      status TEXT NOT NULL,
      started_at BIGINT NOT NULL,
      completed_at BIGINT,
      fetched_at BIGINT,
      stats_json TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_basecamp_sync_runs_user_account
      ON basecamp_sync_runs(user_key, account_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS basecamp_workspace_snapshots (
      user_key TEXT NOT NULL,
      account_id TEXT NOT NULL,
      fetched_at BIGINT NOT NULL,
      snapshot_json TEXT NOT NULL,
      PRIMARY KEY(user_key, account_id)
    );

    CREATE TABLE IF NOT EXISTS basecamp_project_snapshots (
      user_key TEXT NOT NULL,
      account_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT,
      app_url TEXT,
      todo_lists_count INTEGER NOT NULL DEFAULT 0,
      open_todos_count INTEGER NOT NULL DEFAULT 0,
      assigned_todos_count INTEGER NOT NULL DEFAULT 0,
      overdue_todos_count INTEGER NOT NULL DEFAULT 0,
      due_today_todos_count INTEGER NOT NULL DEFAULT 0,
      future_todos_count INTEGER NOT NULL DEFAULT 0,
      no_due_date_todos_count INTEGER NOT NULL DEFAULT 0,
      next_due_on TEXT,
      health TEXT,
      preview_todos_json TEXT NOT NULL DEFAULT '[]',
      fetched_at BIGINT NOT NULL,
      source_updated_at BIGINT,
      PRIMARY KEY(user_key, account_id, project_id)
    );
    CREATE INDEX IF NOT EXISTS idx_basecamp_project_snapshots_user_account
      ON basecamp_project_snapshots(user_key, account_id);

    CREATE TABLE IF NOT EXISTS basecamp_todo_snapshots (
      user_key TEXT NOT NULL,
      account_id TEXT NOT NULL,
      todo_id TEXT NOT NULL,
      project_id TEXT,
      project_name TEXT,
      todolist_id TEXT,
      todolist_name TEXT,
      title TEXT NOT NULL,
      status TEXT,
      due_on TEXT,
      app_url TEXT,
      assignee_ids_json TEXT NOT NULL DEFAULT '[]',
      assigned_to_current_user BOOLEAN NOT NULL DEFAULT FALSE,
      fetched_at BIGINT NOT NULL,
      source_updated_at BIGINT,
      PRIMARY KEY(user_key, account_id, todo_id)
    );
    CREATE INDEX IF NOT EXISTS idx_basecamp_todo_snapshots_user_account_project
      ON basecamp_todo_snapshots(user_key, account_id, project_id);
    CREATE INDEX IF NOT EXISTS idx_basecamp_todo_snapshots_user_account_due
      ON basecamp_todo_snapshots(user_key, account_id, due_on);

    CREATE TABLE IF NOT EXISTS basecamp_raw_records (
      user_key TEXT NOT NULL,
      account_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      project_id TEXT,
      parent_type TEXT,
      parent_id TEXT,
      source_path TEXT,
      source_updated_at BIGINT,
      fetched_at BIGINT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(user_key, account_id, resource_type, resource_id)
    );
    CREATE INDEX IF NOT EXISTS idx_basecamp_raw_records_user_account_type
      ON basecamp_raw_records(user_key, account_id, resource_type);
    CREATE INDEX IF NOT EXISTS idx_basecamp_raw_records_user_account_project
      ON basecamp_raw_records(user_key, account_id, project_id);

    -- ============ Full Dock Snapshot Tables ============

    CREATE TABLE IF NOT EXISTS basecamp_message_snapshots (
      user_key TEXT NOT NULL,
      account_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      project_id TEXT,
      project_name TEXT,
      board_id TEXT,
      subject TEXT NOT NULL,
      status TEXT,
      content_preview TEXT,
      created_at TEXT,
      updated_at TEXT,
      creator_id TEXT,
      creator_name TEXT,
      app_url TEXT,
      fetched_at BIGINT NOT NULL,
      source_updated_at BIGINT,
      PRIMARY KEY(user_key, account_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bc_message_snap_proj
      ON basecamp_message_snapshots(user_key, account_id, project_id);

    CREATE TABLE IF NOT EXISTS basecamp_schedule_entry_snapshots (
      user_key TEXT NOT NULL,
      account_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      project_id TEXT,
      project_name TEXT,
      schedule_id TEXT,
      summary TEXT NOT NULL,
      description TEXT,
      starts_at TEXT,
      ends_at TEXT,
      all_day BOOLEAN DEFAULT FALSE,
      created_at TEXT,
      updated_at TEXT,
      creator_id TEXT,
      creator_name TEXT,
      app_url TEXT,
      fetched_at BIGINT NOT NULL,
      source_updated_at BIGINT,
      PRIMARY KEY(user_key, account_id, entry_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bc_schedule_snap_proj
      ON basecamp_schedule_entry_snapshots(user_key, account_id, project_id);
    CREATE INDEX IF NOT EXISTS idx_bc_schedule_snap_date
      ON basecamp_schedule_entry_snapshots(user_key, account_id, starts_at);

    CREATE TABLE IF NOT EXISTS basecamp_card_snapshots (
      user_key TEXT NOT NULL,
      account_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      project_id TEXT,
      project_name TEXT,
      card_table_id TEXT,
      card_table_name TEXT,
      column_id TEXT,
      column_name TEXT,
      title TEXT NOT NULL,
      content_preview TEXT,
      due_on TEXT,
      assignee_ids_json TEXT DEFAULT '[]',
      position INTEGER,
      app_url TEXT,
      fetched_at BIGINT NOT NULL,
      source_updated_at BIGINT,
      PRIMARY KEY(user_key, account_id, card_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bc_card_snap_proj
      ON basecamp_card_snapshots(user_key, account_id, project_id);

    CREATE TABLE IF NOT EXISTS basecamp_document_snapshots (
      user_key TEXT NOT NULL,
      account_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      project_id TEXT,
      project_name TEXT,
      vault_id TEXT,
      title TEXT NOT NULL,
      content_preview TEXT,
      created_at TEXT,
      updated_at TEXT,
      creator_id TEXT,
      creator_name TEXT,
      app_url TEXT,
      fetched_at BIGINT NOT NULL,
      source_updated_at BIGINT,
      PRIMARY KEY(user_key, account_id, document_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bc_document_snap_proj
      ON basecamp_document_snapshots(user_key, account_id, project_id);

    CREATE TABLE IF NOT EXISTS basecamp_person_snapshots (
      user_key TEXT NOT NULL,
      account_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email_address TEXT,
      admin BOOLEAN DEFAULT FALSE,
      company TEXT,
      avatar_url TEXT,
      project_ids_json TEXT DEFAULT '[]',
      fetched_at BIGINT NOT NULL,
      PRIMARY KEY(user_key, account_id, person_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bc_person_snap_user
      ON basecamp_person_snapshots(user_key, account_id);

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

    -- ============ Wave 5: Knowledge ============

    CREATE TABLE IF NOT EXISTS decision_log (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      project_id TEXT,
      project_name TEXT,
      type TEXT NOT NULL DEFAULT 'decision',
      content TEXT NOT NULL,
      source_type TEXT,
      source_id TEXT,
      extracted_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_decision_log_user ON decision_log(user_key, project_id, type);

    -- ============ Wave 6: Enterprise ============

    CREATE TABLE IF NOT EXISTS policies (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      name TEXT NOT NULL,
      rule TEXT NOT NULL,
      type TEXT DEFAULT 'custom',
      severity TEXT DEFAULT 'warn',
      active BOOLEAN DEFAULT TRUE,
      violation_count INTEGER DEFAULT 0,
      last_checked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_policies_user ON policies(user_key, active);

    CREATE TABLE IF NOT EXISTS budgets (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_name TEXT,
      total_budget NUMERIC DEFAULT 0,
      spent NUMERIC DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_unique ON budgets(user_key, project_id);

    CREATE TABLE IF NOT EXISTS expenses (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      budget_id BIGINT REFERENCES budgets(id) ON DELETE CASCADE,
      amount NUMERIC NOT NULL,
      category TEXT DEFAULT 'other',
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_budget ON expenses(budget_id, created_at DESC);

    -- ============ Wave 7: Platform ============

    CREATE TABLE IF NOT EXISTS templates (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      source_type TEXT NOT NULL,
      content JSONB NOT NULL DEFAULT '{}',
      tags JSONB DEFAULT '[]',
      installs INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_key, source_type);

    CREATE TABLE IF NOT EXISTS plugins (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      name TEXT,
      description TEXT,
      config JSONB DEFAULT '{}',
      status TEXT DEFAULT 'installed',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plugins_unique ON plugins(user_key, plugin_id);

    -- ============ Wave 8: Expansion ============

    CREATE TABLE IF NOT EXISTS platform_connections (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      platform TEXT NOT NULL,
      config JSONB DEFAULT '{}',
      status TEXT DEFAULT 'connected',
      last_sync_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_conn_unique ON platform_connections(user_key, platform);

    CREATE TABLE IF NOT EXISTS personas (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      name TEXT NOT NULL,
      traits JSONB DEFAULT '{}',
      active BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_personas_unique ON personas(user_key, name);

    -- ============ PMOS: Chat & AI ============

    CREATE TABLE IF NOT EXISTS pmos_chat_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_key TEXT NOT NULL,
      title TEXT,
      project_id TEXT,
      persona_id BIGINT REFERENCES personas(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pmos_sessions_user ON pmos_chat_sessions(user_key, updated_at DESC);

    CREATE TABLE IF NOT EXISTS pmos_chat_messages (
      id BIGSERIAL PRIMARY KEY,
      session_id BIGINT REFERENCES pmos_chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls JSONB,
      tool_results JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pmos_messages_session ON pmos_chat_messages(session_id, created_at);

    CREATE TABLE IF NOT EXISTS pmos_user_config (
      user_key TEXT PRIMARY KEY,
      llm_provider TEXT DEFAULT 'gemini',
      llm_api_key TEXT,
      preferences JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_ID]);
      } catch {
        // ignore unlock failures during shutdown race
      }
    }
  } finally {
    client.release();
  }
}

try {
  await ensureSchema();
} catch (err) {
  console.warn(`[db.postgres] ensureSchema failed, continuing startup: ${err?.message || err}`);
}

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
    "SELECT access_token, refresh_token, token_type, expires_in, created_at, user_key FROM user_token WHERE user_key = $1",
    [key]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    access_token: row.access_token,
    refresh_token: row.refresh_token || null,
    token_type: row.token_type,
    expires_in: row.expires_in,
    created_at: typeof row.created_at === 'number' ? row.created_at : Math.floor(new Date(row.created_at || 0).getTime() / 1000),
    user_key: row.user_key,
  };
}

export async function setUserToken(token, userKey) {
  const key = normalizeUserKey(userKey);
  if (!key || !token?.access_token) return;
  const now = nowSec();
  await pool.query(
    `
      INSERT INTO user_token (user_key, access_token, refresh_token, token_type, expires_in, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $6)
      ON CONFLICT (user_key) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, user_token.refresh_token),
        token_type = EXCLUDED.token_type,
        expires_in = EXCLUDED.expires_in,
        updated_at = EXCLUDED.updated_at,
        created_at = EXCLUDED.created_at
    `,
    [key, token.access_token, token.refresh_token || null, token.token_type || "Bearer", token.expires_in, now]
  );

  // Also sync to user_api_keys so the token is never lost
  try {
    await pool.query(
      "UPDATE user_api_keys SET access_token = $1, refresh_token = COALESCE($2, refresh_token), token_type = $3 WHERE user_key = $4",
      [token.access_token, token.refresh_token || null, token.token_type || "Bearer", key]
    );
  } catch { /* ignore — api key may not exist yet */ }
}

export async function clearUserToken(userKey) {
  const key = normalizeUserKey(userKey);
  if (!key) return;
  await pool.query("DELETE FROM user_token WHERE user_key = $1", [key]);
}

export async function listUserTokenCandidates(limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
  const res = await pool.query(
    `
      SELECT user_key, access_token, refresh_token, token_type, expires_in, updated_at
      FROM user_token
      WHERE access_token IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT $1
    `,
    [safeLimit]
  );
  return (res.rows || []).map((row) => ({
    user_key: row.user_key,
    access_token: row.access_token,
    refresh_token: row.refresh_token || null,
    token_type: row.token_type || "Bearer",
    expires_in: row.expires_in ?? null,
    updated_at: row.updated_at ?? null,
  }));
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
        "UPDATE user_api_keys SET access_token = $1, refresh_token = COALESCE($2, refresh_token), token_type = $3 WHERE api_key = $4",
        [token.access_token, token.refresh_token || null, token.token_type || "Bearer", existing]
      );
    }
    return existing;
  }

  const accessToken = token?.access_token || null;
  const refreshToken = token?.refresh_token || null;
  const tokenType = token?.token_type || "Bearer";
  const now = nowSec();
  for (let attempt = 0; attempt < 5; attempt++) {
    const apiKey = generateApiKey();
    try {
      await pool.query(
        "INSERT INTO user_api_keys (api_key, user_key, access_token, refresh_token, token_type, created_at, last_used_at) VALUES ($1, $2, $3, $4, $5, $6, $6)",
        [apiKey, key, accessToken, refreshToken, tokenType, now]
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
  const res = await pool.query("SELECT user_key, access_token, refresh_token, token_type FROM user_api_keys WHERE api_key = $1", [key]);
  const row = res.rows[0];
  const userKey = row?.user_key || null;
  if (!userKey) return null;
  if (touch) {
    await pool.query("UPDATE user_api_keys SET last_used_at = $1 WHERE api_key = $2", [nowSec(), key]);
  }

  // Auto-heal: if user_token is missing or stale but api_key has the token, restore/sync it
  if (row.access_token) {
    const existing = await pool.query("SELECT user_key, access_token FROM user_token WHERE user_key = $1", [userKey]);
    const needsInsert = !existing.rows.length;
    const needsUpdate = !needsInsert && existing.rows[0]?.access_token !== row.access_token;
    if (needsInsert || needsUpdate) {
      const now = nowSec();
      await pool.query(
        `INSERT INTO user_token (user_key, access_token, refresh_token, token_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (user_key) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           refresh_token = COALESCE(EXCLUDED.refresh_token, user_token.refresh_token),
           token_type = EXCLUDED.token_type,
           updated_at = EXCLUDED.updated_at`,
        [userKey, row.access_token, row.refresh_token || null, row.token_type || "Bearer", now]
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
  const refreshToken = token?.refresh_token || null;
  const now = nowSec();
  await pool.query(
    `
      INSERT INTO user_api_keys (api_key, user_key, access_token, refresh_token, token_type, created_at, last_used_at)
      VALUES ($1, $2, $3, $4, $5, $6, $6)
      ON CONFLICT (api_key) DO UPDATE SET
        user_key = EXCLUDED.user_key,
        access_token = COALESCE(EXCLUDED.access_token, user_api_keys.access_token),
        refresh_token = COALESCE(EXCLUDED.refresh_token, user_api_keys.refresh_token),
        token_type = COALESCE(EXCLUDED.token_type, user_api_keys.token_type),
        last_used_at = EXCLUDED.last_used_at
    `,
    [key, ukey, accessToken, refreshToken, tokenType, now]
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

export async function listBasecampSyncTargets() {
  const res = await pool.query(`
    SELECT
      ut.user_key AS user_key,
      up.selected_account_id AS selected_account_id,
      uac.accounts AS accounts,
      uac.identity_email AS identity_email,
      uac.identity_name AS identity_name
    FROM user_token ut
    LEFT JOIN user_preferences up ON up.user_key = ut.user_key
    LEFT JOIN user_auth_cache uac ON uac.user_key = ut.user_key
    ORDER BY ut.updated_at DESC
  `);

  return res.rows
    .map((row) => {
      const accountsRaw = Array.isArray(parseJsonSafe(row.accounts || "[]", []))
        ? parseJsonSafe(row.accounts || "[]", [])
        : [];
      const accountId =
        row.selected_account_id != null && String(row.selected_account_id).trim()
          ? String(row.selected_account_id).trim()
          : accountsRaw[0]?.id != null
            ? String(accountsRaw[0].id)
            : null;
      return {
        userKey: row.user_key,
        accountId,
        identityEmail: row.identity_email ?? null,
        identityName: row.identity_name ?? null,
        accounts: accountsRaw,
      };
    })
    .filter((row) => row.userKey && row.accountId);
}

export async function getBasecampSyncState(userKey, accountId, scope = "workspace") {
  const key = normalizeUserKey(userKey);
  const acct = accountId == null ? null : String(accountId).trim();
  if (!key || !acct) return null;
  const res = await pool.query(`
    SELECT status, last_started_at, last_completed_at, last_success_at, last_error, stats_json
    FROM basecamp_sync_state
    WHERE user_key = $1 AND account_id = $2 AND scope = $3
  `, [key, acct, scope]);
  const row = res.rows[0];
  if (!row) return null;
  return {
    status: row.status,
    lastStartedAt: row.last_started_at ?? null,
    lastCompletedAt: row.last_completed_at ?? null,
    lastSuccessAt: row.last_success_at ?? null,
    lastError: row.last_error ?? null,
    stats: row.stats_json ? parseJsonSafe(row.stats_json, null) : null,
  };
}

export async function upsertBasecampSyncState(userKey, accountId, {
  scope = "workspace",
  status,
  lastStartedAt = null,
  lastCompletedAt = null,
  lastSuccessAt = null,
  lastError = null,
  stats = null,
} = {}) {
  const key = normalizeUserKey(userKey);
  const acct = accountId == null ? null : String(accountId).trim();
  if (!key || !acct || !status) return null;
  await pool.query(`
    INSERT INTO basecamp_sync_state (
      user_key, account_id, scope, status, last_started_at, last_completed_at, last_success_at, last_error, stats_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (user_key, account_id, scope) DO UPDATE SET
      status = EXCLUDED.status,
      last_started_at = EXCLUDED.last_started_at,
      last_completed_at = EXCLUDED.last_completed_at,
      last_success_at = EXCLUDED.last_success_at,
      last_error = EXCLUDED.last_error,
      stats_json = EXCLUDED.stats_json
  `, [
    key,
    acct,
    scope,
    status,
    lastStartedAt,
    lastCompletedAt,
    lastSuccessAt,
    lastError,
    stats == null ? null : JSON.stringify(stats),
  ]);
  return await getBasecampSyncState(key, acct, scope);
}

export async function createBasecampSyncRun(userKey, accountId, {
  scope = "workspace",
  status = "running",
  startedAt = nowSec(),
  stats = null,
  error = null,
} = {}) {
  const key = normalizeUserKey(userKey);
  const acct = accountId == null ? null : String(accountId).trim();
  if (!key || !acct) return null;
  const res = await pool.query(`
    INSERT INTO basecamp_sync_runs (user_key, account_id, scope, status, started_at, stats_json, error)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [
    key,
    acct,
    scope,
    status,
    startedAt,
    stats == null ? null : JSON.stringify(stats),
    error,
  ]);
  return res.rows[0]?.id ?? null;
}

export async function finishBasecampSyncRun(runId, {
  status,
  completedAt = nowSec(),
  fetchedAt = null,
  stats = null,
  error = null,
} = {}) {
  if (!runId || !status) return null;
  await pool.query(`
    UPDATE basecamp_sync_runs
    SET status = $2, completed_at = $3, fetched_at = $4, stats_json = $5, error = $6
    WHERE id = $1
  `, [
    runId,
    status,
    completedAt,
    fetchedAt,
    stats == null ? null : JSON.stringify(stats),
    error,
  ]);
  return runId;
}

export async function getLatestBasecampSyncRun(userKey, accountId, scope = "workspace") {
  const key = normalizeUserKey(userKey);
  const acct = accountId == null ? null : String(accountId).trim();
  if (!key || !acct) return null;
  const res = await pool.query(`
    SELECT id, status, started_at, completed_at, fetched_at, stats_json, error
    FROM basecamp_sync_runs
    WHERE user_key = $1 AND account_id = $2 AND scope = $3
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `, [key, acct, scope]);
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    fetchedAt: row.fetched_at ?? null,
    stats: row.stats_json ? parseJsonSafe(row.stats_json, null) : null,
    error: row.error ?? null,
  };
}

export async function getBasecampWorkspaceSnapshot(userKey, accountId) {
  const key = normalizeUserKey(userKey);
  const acct = accountId == null ? null : String(accountId).trim();
  if (!key || !acct) return null;
  const res = await pool.query(`
    SELECT fetched_at, snapshot_json
    FROM basecamp_workspace_snapshots
    WHERE user_key = $1 AND account_id = $2
  `, [key, acct]);
  const row = res.rows[0];
  if (!row) return null;
  const snapshot = parseJsonSafe(row.snapshot_json || "null", null);
  if (!snapshot || typeof snapshot !== "object") return null;
  return {
    ...snapshot,
    fetchedAt: snapshot.fetchedAt ?? row.fetched_at ?? null,
  };
}

export async function replaceBasecampWorkspaceSnapshot(userKey, accountId, {
  fetchedAt = nowSec(),
  snapshot,
  projects = [],
  todos = [],
  messages = [],
  scheduleEntries = [],
  cards = [],
  documents = [],
  people = [],
  rawRecords = [],
} = {}) {
  const key = normalizeUserKey(userKey);
  const acct = accountId == null ? null : String(accountId).trim();
  if (!key || !acct || !snapshot) return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM basecamp_project_snapshots WHERE user_key = $1 AND account_id = $2", [key, acct]);
    await client.query("DELETE FROM basecamp_todo_snapshots WHERE user_key = $1 AND account_id = $2", [key, acct]);
    await client.query("DELETE FROM basecamp_message_snapshots WHERE user_key = $1 AND account_id = $2", [key, acct]);
    await client.query("DELETE FROM basecamp_schedule_entry_snapshots WHERE user_key = $1 AND account_id = $2", [key, acct]);
    await client.query("DELETE FROM basecamp_card_snapshots WHERE user_key = $1 AND account_id = $2", [key, acct]);
    await client.query("DELETE FROM basecamp_document_snapshots WHERE user_key = $1 AND account_id = $2", [key, acct]);
    await client.query("DELETE FROM basecamp_person_snapshots WHERE user_key = $1 AND account_id = $2", [key, acct]);
    await client.query("DELETE FROM basecamp_raw_records WHERE user_key = $1 AND account_id = $2", [key, acct]);

    await client.query(`
      INSERT INTO basecamp_workspace_snapshots (user_key, account_id, fetched_at, snapshot_json)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_key, account_id) DO UPDATE SET
        fetched_at = EXCLUDED.fetched_at,
        snapshot_json = EXCLUDED.snapshot_json
    `, [key, acct, fetchedAt, JSON.stringify(snapshot)]);

    for (const project of projects) {
      await client.query(`
        INSERT INTO basecamp_project_snapshots (
          user_key, account_id, project_id, name, status, app_url, todo_lists_count, open_todos_count,
          assigned_todos_count, overdue_todos_count, due_today_todos_count, future_todos_count,
          no_due_date_todos_count, next_due_on, health, preview_todos_json, fetched_at, source_updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `, [
        key,
        acct,
        String(project.projectId),
        project.name,
        project.status ?? null,
        project.appUrl ?? null,
        Number(project.todoListsCount ?? 0),
        Number(project.openTodosCount ?? 0),
        Number(project.assignedTodosCount ?? 0),
        Number(project.overdueTodosCount ?? 0),
        Number(project.dueTodayTodosCount ?? 0),
        Number(project.futureTodosCount ?? 0),
        Number(project.noDueDateTodosCount ?? 0),
        project.nextDueOn ?? null,
        project.health ?? null,
        JSON.stringify(project.previewTodos ?? []),
        fetchedAt,
        project.sourceUpdatedAt ?? null,
      ]);
    }

    for (const todo of todos) {
      await client.query(`
        INSERT INTO basecamp_todo_snapshots (
          user_key, account_id, todo_id, project_id, project_name, todolist_id, todolist_name, title,
          status, due_on, app_url, assignee_ids_json, assigned_to_current_user, fetched_at, source_updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [
        key,
        acct,
        String(todo.todoId),
        todo.projectId == null ? null : String(todo.projectId),
        todo.projectName ?? null,
        todo.todolistId == null ? null : String(todo.todolistId),
        todo.todolistName ?? null,
        todo.title,
        todo.status ?? null,
        todo.dueOn ?? null,
        todo.appUrl ?? null,
        JSON.stringify(Array.isArray(todo.assigneeIds) ? todo.assigneeIds : []),
        Boolean(todo.assignedToCurrentUser),
        fetchedAt,
        todo.sourceUpdatedAt ?? null,
      ]);
    }

    for (const msg of messages) {
      await client.query(`
        INSERT INTO basecamp_message_snapshots (
          user_key, account_id, message_id, project_id, project_name, board_id, subject,
          status, content_preview, created_at, updated_at, creator_id, creator_name, app_url, fetched_at, source_updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `, [
        key, acct, String(msg.messageId), msg.projectId == null ? null : String(msg.projectId),
        msg.projectName ?? null, msg.boardId == null ? null : String(msg.boardId),
        msg.subject, msg.status ?? null, msg.contentPreview ?? null,
        msg.createdAt ?? null, msg.updatedAt ?? null,
        msg.creatorId == null ? null : String(msg.creatorId), msg.creatorName ?? null,
        msg.appUrl ?? null, fetchedAt, msg.sourceUpdatedAt ?? null,
      ]);
    }

    for (const entry of scheduleEntries) {
      await client.query(`
        INSERT INTO basecamp_schedule_entry_snapshots (
          user_key, account_id, entry_id, project_id, project_name, schedule_id, summary,
          description, starts_at, ends_at, all_day, created_at, updated_at, creator_id, creator_name,
          app_url, fetched_at, source_updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `, [
        key, acct, String(entry.entryId), entry.projectId == null ? null : String(entry.projectId),
        entry.projectName ?? null, entry.scheduleId == null ? null : String(entry.scheduleId),
        entry.summary, entry.description ?? null,
        entry.startsAt ?? null, entry.endsAt ?? null, Boolean(entry.allDay),
        entry.createdAt ?? null, entry.updatedAt ?? null,
        entry.creatorId == null ? null : String(entry.creatorId), entry.creatorName ?? null,
        entry.appUrl ?? null, fetchedAt, entry.sourceUpdatedAt ?? null,
      ]);
    }

    for (const card of cards) {
      await client.query(`
        INSERT INTO basecamp_card_snapshots (
          user_key, account_id, card_id, project_id, project_name, card_table_id, card_table_name,
          column_id, column_name, title, content_preview, due_on, assignee_ids_json, position,
          app_url, fetched_at, source_updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, [
        key, acct, String(card.cardId), card.projectId == null ? null : String(card.projectId),
        card.projectName ?? null, card.cardTableId == null ? null : String(card.cardTableId),
        card.cardTableName ?? null, card.columnId == null ? null : String(card.columnId),
        card.columnName ?? null, card.title, card.contentPreview ?? null,
        card.dueOn ?? null, JSON.stringify(Array.isArray(card.assigneeIds) ? card.assigneeIds : []),
        card.position ?? null, card.appUrl ?? null, fetchedAt, card.sourceUpdatedAt ?? null,
      ]);
    }

    for (const doc of documents) {
      await client.query(`
        INSERT INTO basecamp_document_snapshots (
          user_key, account_id, document_id, project_id, project_name, vault_id, title,
          content_preview, created_at, updated_at, creator_id, creator_name, app_url, fetched_at, source_updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [
        key, acct, String(doc.documentId), doc.projectId == null ? null : String(doc.projectId),
        doc.projectName ?? null, doc.vaultId == null ? null : String(doc.vaultId),
        doc.title, doc.contentPreview ?? null,
        doc.createdAt ?? null, doc.updatedAt ?? null,
        doc.creatorId == null ? null : String(doc.creatorId), doc.creatorName ?? null,
        doc.appUrl ?? null, fetchedAt, doc.sourceUpdatedAt ?? null,
      ]);
    }

    for (const person of people) {
      await client.query(`
        INSERT INTO basecamp_person_snapshots (
          user_key, account_id, person_id, name, email_address, admin, company, avatar_url,
          project_ids_json, fetched_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        key, acct, String(person.personId), person.name,
        person.emailAddress ?? null, Boolean(person.admin),
        person.company ?? null, person.avatarUrl ?? null,
        JSON.stringify(Array.isArray(person.projectIds) ? person.projectIds : []),
        fetchedAt,
      ]);
    }

    for (const record of rawRecords) {
      await client.query(`
        INSERT INTO basecamp_raw_records (
          user_key, account_id, resource_type, resource_id, project_id, parent_type, parent_id,
          source_path, source_updated_at, fetched_at, payload_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        key,
        acct,
        record.resourceType,
        String(record.resourceId),
        record.projectId == null ? null : String(record.projectId),
        record.parentType ?? null,
        record.parentId == null ? null : String(record.parentId),
        record.sourcePath ?? null,
        record.sourceUpdatedAt ?? null,
        fetchedAt,
        JSON.stringify(record.payload ?? {}),
      ]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return await getBasecampWorkspaceSnapshot(key, acct);
}

// ============ Local Query Functions (Full Dock) ============

export async function queryBasecampMessages(userKey, accountId, { projectId, limit = 50 } = {}) {
  const key = normalizeUserKey(userKey);
  const acct = String(accountId).trim();
  const params = [key, acct];
  let where = "WHERE user_key = $1 AND account_id = $2";
  if (projectId) { params.push(String(projectId)); where += ` AND project_id = $${params.length}`; }
  const res = await pool.query(`SELECT * FROM basecamp_message_snapshots ${where} ORDER BY created_at DESC LIMIT ${Math.min(limit, 200)}`, params);
  return res.rows;
}

export async function queryBasecampScheduleEntries(userKey, accountId, { projectId, fromDate, toDate, limit = 50 } = {}) {
  const key = normalizeUserKey(userKey);
  const acct = String(accountId).trim();
  const params = [key, acct];
  let where = "WHERE user_key = $1 AND account_id = $2";
  if (projectId) { params.push(String(projectId)); where += ` AND project_id = $${params.length}`; }
  if (fromDate) { params.push(fromDate); where += ` AND (ends_at >= $${params.length} OR ends_at IS NULL)`; }
  if (toDate) { params.push(toDate); where += ` AND starts_at <= $${params.length}`; }
  const res = await pool.query(`SELECT * FROM basecamp_schedule_entry_snapshots ${where} ORDER BY starts_at ASC LIMIT ${Math.min(limit, 200)}`, params);
  return res.rows;
}

export async function queryBasecampCards(userKey, accountId, { projectId, columnName, limit = 100 } = {}) {
  const key = normalizeUserKey(userKey);
  const acct = String(accountId).trim();
  const params = [key, acct];
  let where = "WHERE user_key = $1 AND account_id = $2";
  if (projectId) { params.push(String(projectId)); where += ` AND project_id = $${params.length}`; }
  if (columnName) { params.push(columnName); where += ` AND LOWER(column_name) = LOWER($${params.length})`; }
  const res = await pool.query(`SELECT * FROM basecamp_card_snapshots ${where} ORDER BY position ASC, title ASC LIMIT ${Math.min(limit, 200)}`, params);
  return res.rows;
}

export async function queryBasecampDocuments(userKey, accountId, { projectId, limit = 50 } = {}) {
  const key = normalizeUserKey(userKey);
  const acct = String(accountId).trim();
  const params = [key, acct];
  let where = "WHERE user_key = $1 AND account_id = $2";
  if (projectId) { params.push(String(projectId)); where += ` AND project_id = $${params.length}`; }
  const res = await pool.query(`SELECT * FROM basecamp_document_snapshots ${where} ORDER BY updated_at DESC LIMIT ${Math.min(limit, 200)}`, params);
  return res.rows;
}

export async function queryBasecampPeople(userKey, accountId, { projectId, limit = 100 } = {}) {
  const key = normalizeUserKey(userKey);
  const acct = String(accountId).trim();
  const params = [key, acct];
  let where = "WHERE user_key = $1 AND account_id = $2";
  if (projectId) {
    params.push(`%${String(projectId)}%`);
    where += ` AND project_ids_json LIKE $${params.length}`;
  }
  const res = await pool.query(`SELECT * FROM basecamp_person_snapshots ${where} ORDER BY name ASC LIMIT ${Math.min(limit, 200)}`, params);
  return res.rows;
}

export async function queryBasecampTodos(userKey, accountId, { projectId, overdue, dueOn, assignedToMe, limit = 100 } = {}) {
  const key = normalizeUserKey(userKey);
  const acct = String(accountId).trim();
  const params = [key, acct];
  let where = "WHERE user_key = $1 AND account_id = $2";
  if (projectId) { params.push(String(projectId)); where += ` AND project_id = $${params.length}`; }
  if (assignedToMe) { where += " AND assigned_to_current_user = TRUE"; }
  if (overdue) {
    const todayIso = new Date().toISOString().slice(0, 10);
    params.push(todayIso);
    where += ` AND due_on IS NOT NULL AND due_on < $${params.length}`;
  }
  if (dueOn) { params.push(dueOn); where += ` AND due_on = $${params.length}`; }
  const res = await pool.query(`SELECT * FROM basecamp_todo_snapshots ${where} ORDER BY due_on ASC NULLS LAST LIMIT ${Math.min(limit, 200)}`, params);
  return res.rows;
}

export async function getBasecampSnapshotAge(userKey, accountId) {
  const key = normalizeUserKey(userKey);
  const acct = String(accountId).trim();
  const res = await pool.query(`SELECT fetched_at FROM basecamp_workspace_snapshots WHERE user_key = $1 AND account_id = $2`, [key, acct]);
  const row = res.rows[0];
  if (!row?.fetched_at) return null;
  return Math.max(0, Math.floor(Date.now() / 1000) - Number(row.fetched_at));
}

export async function upsertBasecampResource(userKey, accountId, table, idColumn, record) {
  const key = normalizeUserKey(userKey);
  const acct = String(accountId).trim();
  const cols = Object.keys(record);
  const vals = Object.values(record);
  const placeholders = cols.map((_, i) => `$${i + 3}`);
  const updates = cols.filter(c => c !== idColumn).map(c => `${c} = EXCLUDED.${c}`).join(", ");
  await pool.query(`
    INSERT INTO ${table} (user_key, account_id, ${cols.join(", ")})
    VALUES ($1, $2, ${placeholders.join(", ")})
    ON CONFLICT (user_key, account_id, ${idColumn}) DO UPDATE SET ${updates}
  `, [key, acct, ...vals]);
}

export async function deleteBasecampResource(userKey, accountId, table, idColumn, resourceId) {
  const key = normalizeUserKey(userKey);
  const acct = String(accountId).trim();
  await pool.query(`DELETE FROM ${table} WHERE user_key = $1 AND account_id = $2 AND ${idColumn} = $3`, [key, acct, String(resourceId)]);
}

export async function getBasecampResourceCounts(userKey, accountId) {
  const key = normalizeUserKey(userKey);
  const acct = String(accountId).trim();
  const tables = [
    { name: "messages", table: "basecamp_message_snapshots" },
    { name: "scheduleEntries", table: "basecamp_schedule_entry_snapshots" },
    { name: "cards", table: "basecamp_card_snapshots" },
    { name: "documents", table: "basecamp_document_snapshots" },
    { name: "people", table: "basecamp_person_snapshots" },
  ];
  const counts = {};
  for (const { name, table } of tables) {
    try {
      const res = await pool.query(`SELECT COUNT(*) as count FROM ${table} WHERE user_key = $1 AND account_id = $2`, [key, acct]);
      counts[name] = Number(res.rows[0]?.count ?? 0);
    } catch {
      counts[name] = 0;
    }
  }
  return counts;
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

// ========== Wave 5: Knowledge ==========

export async function saveDecision(userKey, { projectId, projectName, type, content, sourceType, sourceId }) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !content) return null;
  const res = await pool.query(
    `INSERT INTO decision_log (user_key, project_id, project_name, type, content, source_type, source_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [userKey, projectId || null, projectName || null, type || 'decision', content, sourceType || null, sourceId || null]
  );
  return res.rows[0];
}

export async function listDecisions(userKey, { projectId, type, limit } = {}) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return [];
  let sql = `SELECT * FROM decision_log WHERE user_key = $1`;
  const params = [userKey];
  let idx = 2;
  if (projectId) { sql += ` AND project_id = $${idx}`; params.push(projectId); idx++; }
  if (type && type !== 'all') { sql += ` AND type = $${idx}`; params.push(type); idx++; }
  sql += ` ORDER BY extracted_at DESC LIMIT $${idx}`;
  params.push(limit || 50);
  const res = await pool.query(sql, params);
  return res.rows;
}

// ========== Wave 6: Enterprise ==========

export async function createPolicy(userKey, { name, rule, type, severity, active }) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !name || !rule) return null;
  const res = await pool.query(
    `INSERT INTO policies (user_key, name, rule, type, severity, active)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userKey, name, rule, type || 'custom', severity || 'warn', active !== false]
  );
  return res.rows[0];
}

export async function listPolicies(userKey, activeOnly = true) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return [];
  const where = activeOnly ? `WHERE user_key = $1 AND active = TRUE` : `WHERE user_key = $1`;
  const res = await pool.query(`SELECT * FROM policies ${where} ORDER BY created_at DESC`, [userKey]);
  return res.rows;
}

export async function getPolicy(userKey, policyId) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !policyId) return null;
  const res = await pool.query(`SELECT * FROM policies WHERE user_key = $1 AND id = $2`, [userKey, policyId]);
  return res.rows[0] || null;
}

export async function updatePolicyViolations(policyId, count) {
  await pool.query(
    `UPDATE policies SET violation_count = $2, last_checked_at = NOW() WHERE id = $1`,
    [policyId, count]
  );
}

export async function setBudget(userKey, projectId, projectName, totalBudget) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !projectId) return null;
  const res = await pool.query(
    `INSERT INTO budgets (user_key, project_id, project_name, total_budget)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_key, project_id)
     DO UPDATE SET total_budget = $4, project_name = COALESCE($3, budgets.project_name), updated_at = NOW()
     RETURNING *`,
    [userKey, projectId, projectName || null, totalBudget || 0]
  );
  return res.rows[0];
}

export async function getBudget(userKey, projectId) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !projectId) return null;
  const res = await pool.query(
    `SELECT b.*, COALESCE(SUM(e.amount), 0) as total_spent
     FROM budgets b LEFT JOIN expenses e ON e.budget_id = b.id
     WHERE b.user_key = $1 AND b.project_id = $2
     GROUP BY b.id`,
    [userKey, projectId]
  );
  return res.rows[0] || null;
}

export async function logExpense(userKey, budgetId, amount, category, description) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !budgetId || !amount) return null;
  const res = await pool.query(
    `INSERT INTO expenses (user_key, budget_id, amount, category, description)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userKey, budgetId, amount, category || 'other', description || null]
  );
  // Update spent total
  await pool.query(
    `UPDATE budgets SET spent = spent + $1, updated_at = NOW() WHERE id = $2`,
    [amount, budgetId]
  );
  return res.rows[0];
}

export async function getExpenses(budgetId, limit = 20) {
  const res = await pool.query(
    `SELECT * FROM expenses WHERE budget_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [budgetId, limit]
  );
  return res.rows;
}

// ========== Wave 7: Platform ==========

export async function createTemplate(userKey, { name, description, sourceType, content, tags }) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !name) return null;
  const res = await pool.query(
    `INSERT INTO templates (user_key, name, description, source_type, content, tags)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userKey, name, description || null, sourceType || 'project', JSON.stringify(content || {}), JSON.stringify(tags || [])]
  );
  return res.rows[0];
}

export async function listTemplates(userKey, { category, search, limit } = {}) {
  userKey = normalizeUserKey(userKey);
  let sql = `SELECT * FROM templates WHERE 1=1`;
  const params = [];
  let idx = 1;
  if (userKey) { sql += ` AND (user_key = $${idx} OR user_key = 'system')`; params.push(userKey); idx++; }
  if (category && category !== 'all') { sql += ` AND source_type = $${idx}`; params.push(category); idx++; }
  if (search) { sql += ` AND (LOWER(name) LIKE $${idx} OR LOWER(description) LIKE $${idx})`; params.push(`%${search.toLowerCase()}%`); idx++; }
  sql += ` ORDER BY installs DESC, created_at DESC LIMIT $${idx}`;
  params.push(limit || 50);
  const res = await pool.query(sql, params);
  return res.rows;
}

export async function getTemplate(userKey, templateId) {
  userKey = normalizeUserKey(userKey);
  const res = await pool.query(`SELECT * FROM templates WHERE id = $1`, [templateId]);
  return res.rows[0] || null;
}

export async function incrementTemplateInstalls(templateId) {
  await pool.query(`UPDATE templates SET installs = installs + 1 WHERE id = $1`, [templateId]);
}

export async function managePlugin(userKey, pluginId, action, config = {}) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !pluginId) return null;
  if (action === 'install') {
    const res = await pool.query(
      `INSERT INTO plugins (user_key, plugin_id, name, description, config, status)
       VALUES ($1, $2, $3, $4, $5, 'installed')
       ON CONFLICT (user_key, plugin_id) DO UPDATE SET status = 'installed', config = $5
       RETURNING *`,
      [userKey, pluginId, config.name || pluginId, config.description || null, JSON.stringify(config)]
    );
    return res.rows[0];
  }
  if (action === 'uninstall') {
    await pool.query(`DELETE FROM plugins WHERE user_key = $1 AND plugin_id = $2`, [userKey, pluginId]);
    return { removed: true };
  }
  if (action === 'enable' || action === 'disable') {
    const res = await pool.query(
      `UPDATE plugins SET status = $3 WHERE user_key = $1 AND plugin_id = $2 RETURNING *`,
      [userKey, pluginId, action === 'enable' ? 'installed' : 'disabled']
    );
    return res.rows[0];
  }
  if (action === 'configure') {
    const res = await pool.query(
      `UPDATE plugins SET config = $3 WHERE user_key = $1 AND plugin_id = $2 RETURNING *`,
      [userKey, pluginId, JSON.stringify(config)]
    );
    return res.rows[0];
  }
  return null;
}

export async function listPlugins(userKey, status = 'all') {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return [];
  let sql = `SELECT * FROM plugins WHERE user_key = $1`;
  const params = [userKey];
  if (status === 'installed') { sql += ` AND status = 'installed'`; }
  else if (status === 'disabled') { sql += ` AND status = 'disabled'`; }
  sql += ` ORDER BY created_at DESC`;
  const res = await pool.query(sql, params);
  return res.rows;
}

// ========== Wave 8: Expansion ==========

export async function managePlatformConnection(userKey, platform, action, config = {}) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !platform) return null;
  if (action === 'connect') {
    const res = await pool.query(
      `INSERT INTO platform_connections (user_key, platform, config, status)
       VALUES ($1, $2, $3, 'connected')
       ON CONFLICT (user_key, platform) DO UPDATE SET config = $3, status = 'connected', last_sync_at = NOW()
       RETURNING *`,
      [userKey, platform, JSON.stringify(config)]
    );
    return res.rows[0];
  }
  if (action === 'disconnect') {
    await pool.query(
      `UPDATE platform_connections SET status = 'disconnected' WHERE user_key = $1 AND platform = $2`,
      [userKey, platform]
    );
    return { disconnected: true };
  }
  if (action === 'status') {
    const res = await pool.query(
      `SELECT * FROM platform_connections WHERE user_key = $1 AND platform = $2`,
      [userKey, platform]
    );
    return res.rows[0] || { platform, status: 'not_connected' };
  }
  if (action === 'sync') {
    await pool.query(
      `UPDATE platform_connections SET last_sync_at = NOW() WHERE user_key = $1 AND platform = $2`,
      [userKey, platform]
    );
    return { synced: true };
  }
  return null;
}

export async function listPlatformConnections(userKey) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return [];
  const res = await pool.query(
    `SELECT * FROM platform_connections WHERE user_key = $1 ORDER BY created_at DESC`,
    [userKey]
  );
  return res.rows;
}

export async function managePersona(userKey, name, action, traits = {}) {
  userKey = normalizeUserKey(userKey);
  if (!userKey || !name) return null;
  if (action === 'set') {
    // Deactivate all other personas first
    await pool.query(`UPDATE personas SET active = FALSE WHERE user_key = $1`, [userKey]);
    const res = await pool.query(
      `INSERT INTO personas (user_key, name, traits, active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (user_key, name) DO UPDATE SET traits = $3, active = TRUE
       RETURNING *`,
      [userKey, name, JSON.stringify(traits)]
    );
    return res.rows[0];
  }
  if (action === 'get') {
    const res = await pool.query(
      `SELECT * FROM personas WHERE user_key = $1 AND (name = $2 OR active = TRUE) ORDER BY active DESC LIMIT 1`,
      [userKey, name]
    );
    return res.rows[0] || null;
  }
  if (action === 'list') {
    const res = await pool.query(`SELECT * FROM personas WHERE user_key = $1 ORDER BY active DESC, name`, [userKey]);
    return res.rows;
  }
  if (action === 'delete') {
    await pool.query(`DELETE FROM personas WHERE user_key = $1 AND name = $2`, [userKey, name]);
    return { deleted: true };
  }
  return null;
}

// ============ PMOS Chat Functions ============

export async function createChatSession(userKey, { title, projectId, personaId } = {}) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return null;
  const res = await pool.query(
    `INSERT INTO pmos_chat_sessions (user_key, title, project_id, persona_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userKey, title || 'New Chat', projectId || null, personaId || null]
  );
  return res.rows[0];
}

export async function listChatSessions(userKey, limit = 20) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return [];
  const res = await pool.query(
    `SELECT * FROM pmos_chat_sessions 
     WHERE user_key = $1 
     ORDER BY updated_at DESC 
     LIMIT $2`,
    [userKey, limit]
  );
  return res.rows;
}

export async function getChatSession(sessionId) {
  const res = await pool.query(
    `SELECT s.*, 
            (SELECT COUNT(*) FROM pmos_chat_messages WHERE session_id = s.id) as message_count
     FROM pmos_chat_sessions s
     WHERE s.id = $1`,
    [sessionId]
  );
  return res.rows[0] || null;
}

export async function updateChatSessionTitle(sessionId, title) {
  await pool.query(
    `UPDATE pmos_chat_sessions SET title = $2, updated_at = NOW() WHERE id = $1`,
    [sessionId, title]
  );
}

export async function deleteChatSession(sessionId) {
  await pool.query(`DELETE FROM pmos_chat_sessions WHERE id = $1`, [sessionId]);
  return { deleted: true };
}

export async function addChatMessage(sessionId, { role, content, toolCalls, toolResults }) {
  const res = await pool.query(
    `INSERT INTO pmos_chat_messages (session_id, role, content, tool_calls, tool_results)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      sessionId,
      role,
      content,
      toolCalls ? JSON.stringify(toolCalls) : null,
      toolResults ? JSON.stringify(toolResults) : null
    ]
  );
  // Update session's updated_at
  await pool.query(
    `UPDATE pmos_chat_sessions SET updated_at = NOW() WHERE id = $1`,
    [sessionId]
  );
  return res.rows[0];
}

export async function getChatMessages(sessionId, limit = 100) {
  const res = await pool.query(
    `SELECT * FROM pmos_chat_messages 
     WHERE session_id = $1 
     ORDER BY created_at ASC 
     LIMIT $2`,
    [sessionId, limit]
  );
  return res.rows;
}

export async function getPmosUserConfig(userKey) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return null;
  const res = await pool.query(
    `SELECT * FROM pmos_user_config WHERE user_key = $1`,
    [userKey]
  );
  if (res.rows[0]) return res.rows[0];
  // Return default config
  return { user_key: userKey, llm_provider: 'gemini', llm_api_key: null, preferences: {} };
}

export async function setPmosUserConfig(userKey, { llmProvider, llmApiKey, preferences }) {
  userKey = normalizeUserKey(userKey);
  if (!userKey) return null;
  const res = await pool.query(
    `INSERT INTO pmos_user_config (user_key, llm_provider, llm_api_key, preferences)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_key) DO UPDATE SET
       llm_provider = COALESCE($2, pmos_user_config.llm_provider),
       llm_api_key = COALESCE($3, pmos_user_config.llm_api_key),
       preferences = COALESCE($4, pmos_user_config.preferences),
       updated_at = NOW()
     RETURNING *`,
    [
      userKey,
      llmProvider || null,
      llmApiKey || null,
      preferences ? JSON.stringify(preferences) : null
    ]
  );
  return res.rows[0];
}

export default pool;

