// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import http from "http";
import httpProxy from "http-proxy";
import path from "path";
import { fileURLToPath } from "url";

import { handleMCP } from "./mcp.js";
import { basecampFetch as basecampFetchCore, basecampFetchAll as basecampFetchAllCore, getCircuitStatus as getBasecampCircuitStatus } from "./basecamp.js";
import {
  getUserToken,
  setUserToken,
  clearUserToken,
  getUserAuthCache,
  setUserAuthCache,
  clearUserAuthCache,
  getApiKeyForUser,
  createApiKeyForUser,
  getUserByApiKey,
  bindApiKeyToUser,
  getSelectedAccount,
  setSelectedAccount,
  getIndexStats,
  getEntityStats,
  getToolCacheStats,
  listEntityCache,
  searchIndex,
  setToolCache,
  listToolCache,
  getActivepiecesProject,
  setActivepiecesProject,
  clearActivepiecesProject,
  // Wave 1: PM OS Foundation
  saveSessionMemory,
  getSessionMemory,
  cleanSessionMemory,
  saveSnapshot,
  getSnapshots,
  getLatestSnapshot,
  cleanSnapshots,
  logOperation,
  getRecentOperations,
  getOperation,
  markUndone,
  // Wave 2: Intelligence
  saveHealthScore,
  getHealthScore,
  getAllHealthScores,
} from "./db.js";
import { runMining } from "./miner.js";
import { execSync } from "child_process";
import { existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Initialize: Ensure code is synced on startup
async function ensureCodeSynced() {
  try {
    // Only run git pull if in a git repository (not in Docker built context where .git might not exist)
    const hasGit = existsSync(path.join(__dirname, '.git'));
    if (hasGit && process.env.AUTO_GIT_PULL !== 'false') {
      console.log('[INIT] Syncing code from git...');
      try {
        execSync('git fetch origin main 2>&1', { cwd: __dirname, stdio: 'pipe' });
        execSync('git reset --hard origin/main 2>&1', { cwd: __dirname, stdio: 'pipe' });
        console.log('[INIT] ✓ Code synced');
      } catch (gitErr) {
        console.warn('[INIT] Warning: Could not sync code:', gitErr.message);
      }
    }
  } catch (err) {
    console.warn('[INIT] Warning during code sync:', err.message);
  }
}

// Call on startup
await ensureCodeSynced();

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;
const UA = "bcgpt-full-v3";
const BASECAMP_API = "https://3.basecampapi.com";
const ACTIVEPIECES_PROXY_HOST = String(process.env.ACTIVEPIECES_PROXY_HOST || "").trim().toLowerCase();
const ACTIVEPIECES_PROXY_TARGET = process.env.ACTIVEPIECES_PROXY_TARGET || "http://127.0.0.1:4200";
// Explicitly require ACTIVEPIECES_PROXY_ENABLED=true. Having a host set should not implicitly enable proxying.
const ACTIVEPIECES_PROXY_ENABLED = String(process.env.ACTIVEPIECES_PROXY_ENABLED || "").toLowerCase() === "true";
const ACTIVEPIECES_PROXY_ACTIVE = ACTIVEPIECES_PROXY_ENABLED && Boolean(ACTIVEPIECES_PROXY_HOST);

let MINER_RUNNING = false;
let MINER_LAST_RESULT = null;
let MINER_LAST_STARTED_AT = null;

function originBase(req) {
  const inferred = `${req.protocol}://${req.get("host")}`;
  return process.env.APP_BASE_URL || inferred;
}

function deriveUserKey(auth) {
  const email = auth?.identity?.email_address ? String(auth.identity.email_address).trim().toLowerCase() : "";
  if (email) return `email:${email}`;
  const name = auth?.identity?.name ? String(auth.identity.name).trim().toLowerCase() : "";
  if (name) return `name:${name}`;
  return null;
}

function normalizeKey(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function getHeaderValue(req, name) {
  if (!req) return null;
  const direct = req.get?.(name);
  const fallback = req.headers?.[String(name || "").toLowerCase()];
  const value = direct ?? fallback;
  if (Array.isArray(value)) return value[0];
  return value ?? null;
}

function extractApiKey(req) {
  return normalizeKey(
    getHeaderValue(req, "x-bcgpt-api-key") ||
      getHeaderValue(req, "x-api-key") ||
      req?.body?.api_key ||
      req?.query?.api_key ||
      req?.query?.apiKey
  );
}

async function resolveRequestContext(req, { apiKey: forcedApiKey, userKey: forcedUserKey } = {}) {
  const apiKey = normalizeKey(forcedApiKey || extractApiKey(req));
  const explicitUserKey = normalizeKey(forcedUserKey);

  let userKey = explicitUserKey || null;
  if (!userKey && apiKey) {
    userKey = await getUserByApiKey(apiKey);
  }

  let token = null;
  let auth = null;

  if (userKey) {
    token = await getUserToken(userKey);
    auth = await getUserAuthCache(userKey);
  }

  return {
    apiKey,
    userKey,
    token,
    auth,
  };
}

async function fetchAuthorization(token) {
  if (!token?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }

  const r = await fetch("https://launchpad.37signals.com/authorization.json", {
    headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": UA },
  });

  if (!r.ok) {
    const err = new Error("AUTHORIZATION_FAILED");
    err.code = "AUTHORIZATION_FAILED";
    err.status = r.status;
    throw err;
  }

  return r.json();
}

async function ensureAuthorization({ token, userKey, force = false }) {
  if (!token?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }

  if (!force) {
    if (userKey) {
      const cached = await getUserAuthCache(userKey);
      if (cached) return { auth: cached, userKey };
    }
  }

  const auth = await fetchAuthorization(token);
  const derivedUserKey = userKey || deriveUserKey(auth);

  if (derivedUserKey) {
    await setUserAuthCache(auth, derivedUserKey);
    await setUserToken(token, derivedUserKey);
  }

  return { auth, userKey: derivedUserKey };
}

async function pickAccountId(auth, userKey) {
  if (!auth?.accounts?.length) {
    const err = new Error("NO_ACCOUNTS");
    err.code = "NO_ACCOUNTS";
    throw err;
  }

  const accounts = auth.accounts || [];

  // 1) Use persisted selection (if valid)
  const selected = await getSelectedAccount(userKey);
  if (selected) {
    const match = accounts.find((a) => String(a.id) === String(selected));
    if (match) return match.id;

    // Selection no longer valid; clear so we can fall back.
    try {
      await setSelectedAccount(userKey, null);
    } catch {
      // ignore
    }
  }

  // 2) Auto-select default account if configured and authorized
  const defaultAccountId = normalizeKey(process.env.BASECAMP_DEFAULT_ACCOUNT_ID);
  if (defaultAccountId) {
    const match = accounts.find((a) => String(a.id) === String(defaultAccountId));
    if (match) {
      try {
        await setSelectedAccount(userKey, defaultAccountId);
      } catch {
        // ignore
      }
      return match.id;
    }
  }

  // 3) If only one account is authorized, auto-select it
  if (accounts.length === 1 && accounts[0]?.id != null) {
    const id = accounts[0].id;
    try {
      await setSelectedAccount(userKey, String(id));
    } catch {
      // ignore
    }
    return id;
  }

  // 4) Otherwise, require explicit selection via /select_account
  const err = new Error("ACCOUNT_NOT_SELECTED");
  err.code = "ACCOUNT_NOT_SELECTED";
  err.accounts = accounts;
  if (defaultAccountId) err.default_account_id = defaultAccountId;
  throw err;
}

async function requireBasecampContext(req, { apiKey: forcedApiKey, forceAuth = false } = {}) {
  const ctx = await resolveRequestContext(req, { apiKey: forcedApiKey });
  if (!ctx.token?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }

  const authResult = await ensureAuthorization({
    token: ctx.token,
    userKey: ctx.userKey,
    force: forceAuth,
  });

  const accountId = await pickAccountId(authResult.auth, authResult.userKey || ctx.userKey);

  return {
    ...ctx,
    token: ctx.token,
    auth: authResult.auth,
    userKey: authResult.userKey || ctx.userKey,
    accountId,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Basecamp URL rules:
 * - Account-scoped: https://3.basecampapi.com/<account_id>/...
 * - Bucket-scoped:  https://3.basecampapi.com/buckets/<bucket_id>/...
 * - Many endpoints return pagination via Link header rel="next".
 */
function normalizeBasecampUrl(path, accountId) {
  if (!path) {
    const err = new Error("Missing Basecamp path");
    err.code = "BAD_REQUEST";
    throw err;
  }

  const raw = String(path).trim();

  // Full URL passthrough
  if (/^https?:\/\//i.test(raw)) return raw;

  let p = raw.startsWith("/") ? raw : `/${raw}`;

  // Bucket-scoped endpoints MUST NOT be prefixed with account id
  if (p.startsWith("/buckets/")) return `${BASECAMP_API}${p}`;

  // Already account-scoped (starts with "/<digits>/")
  if (/^\/\d+\//.test(p)) return `${BASECAMP_API}${p}`;

  // Otherwise require accountId (account scoped)
  if (!accountId) {
    const err = new Error("ACCOUNT_ID_REQUIRED_FOR_PATH");
    err.code = "ACCOUNT_ID_REQUIRED_FOR_PATH";
    err.path = p;
    throw err;
  }

  // Ensure accountId is a number, not an object
  const aid = String(accountId).trim();
  if (aid === "[object Object]" || !aid || isNaN(aid)) {
    console.error(`[normalizeBasecampUrl] Invalid accountId: ${JSON.stringify(accountId)} (type: ${typeof accountId})`);
    const err = new Error("INVALID_ACCOUNT_ID");
    err.code = "INVALID_ACCOUNT_ID";
    err.accountId = accountId;
    throw err;
  }

  const finalUrl = `${BASECAMP_API}/${aid}${p}`;
  console.log(`[normalizeBasecampUrl] path=${p}, accountId=${aid} => ${finalUrl}`);
  return finalUrl;
}

function parseLinkHeader(link) {
  // Minimal Link parser: <url>; rel="next"
  if (!link) return {};
  const out = {};
  const parts = String(link).split(",").map((s) => s.trim());
  for (const part of parts) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/i);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

/**
 * Hardened Basecamp fetch:
 * - timeout
 * - retry/backoff for 429/502/503/504 (respects Retry-After)
 * - optional pagination aggregation when response is an array
 */
async function basecampFetch(token, path, opts = {}) {
  const {
    method = "GET",
    body = undefined,
    ua = UA,
    accountId = null,
    timeoutMs = 15000,
    retries = 2,
    paginate = false,
    maxPages = 50,
    pageDelayMs = 150,
  } = opts;

  if (!token?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }

  const httpMethod = String(method || "GET").toUpperCase();
  let url = normalizeBasecampUrl(path, accountId);

  // IMPORTANT:
  // For GET/HEAD with no body: do not send Content-Type or payload.
  // Some proxies/APIs can behave badly if a GET has a JSON body.
  const headers = {
    "User-Agent": ua,
    Authorization: `Bearer ${token.access_token}`,
    Accept: "application/json",
  };

  let payload = undefined;
  if (body !== undefined && body !== null && httpMethod !== "GET" && httpMethod !== "HEAD") {
    headers["Content-Type"] = "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }

  async function doOne(requestUrl) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const r = await fetch(requestUrl, {
          method: httpMethod,
          headers,
          body: payload,
          signal: controller.signal,
        });

        clearTimeout(t);

        // Retryable statuses
        if ([429, 502, 503, 504].includes(r.status) && attempt < retries) {
          const retryAfter = Number(r.headers.get("retry-after") || "0");
          const backoff = retryAfter > 0 ? retryAfter * 1000 : 400 * (attempt + 1) ** 2;
          await sleep(backoff);
          continue;
        }

        if (r.status === 204) return { data: null, headers: r.headers };

        const text = await r.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text || null;
        }

        if (!r.ok) {
          const err = new Error(`Basecamp API error (${r.status})`);
          err.code = "BASECAMP_API_ERROR";
          err.status = r.status;
          err.data = data;
          err.url = requestUrl;
          throw err;
        }

        return { data, headers: r.headers };
      } catch (e) {
        clearTimeout(t);
        if (e?.name === "AbortError" && attempt < retries) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }

    const err = new Error("BASECAMP_REQUEST_FAILED");
    err.code = "BASECAMP_REQUEST_FAILED";
    err.url = requestUrl;
    throw err;
  }

  // No pagination: single request
  if (!paginate || httpMethod !== "GET") {
    const { data } = await doOne(url);
    return data;
  }

  // Pagination: aggregate pages when response is an array
  const aggregated = [];
  let page = 0;

  while (url && page < maxPages) {
    const { data, headers: respHeaders } = await doOne(url);

    if (Array.isArray(data)) aggregated.push(...data);
    else return data; // Not an array => stop pagination and return as-is.

    const link = respHeaders?.get?.("link") || null;
    const { next } = parseLinkHeader(link);
    url = next || null;

    page++;
    if (url) await sleep(pageDelayMs);
  }

  return aggregated;
}

/* ============ Launchpad auth ============ */
async function startStatus(req, { apiKey: forcedApiKey } = {}) {
  const apiKey = normalizeKey(forcedApiKey || extractApiKey(req));
  const base = originBase(req);
  const connect_url = `${base}/connect`;
  const stateParam = apiKey ? `?state=${encodeURIComponent(apiKey)}` : "";
  const reauth_url = `${base}/auth/basecamp/start${stateParam}`;
  const logout_url = `${base}/logout`;
  const select_account_url = connect_url;
  const select_account_endpoint = `${base}/select_account`;

  if (!apiKey) {
    return {
      connected: false,
      user: null,
      user_key: null,
      api_key: null,
      selected_account_id: null,
      accounts: [],
      connect_url,
      reauth_url,
      select_account_url,
      select_account_endpoint,
      logout_url,
      message: "No API key provided. Visit the connect page to generate one.",
    };
  }

  const ctx = await resolveRequestContext(req, { apiKey });
  if (!ctx.token?.access_token) {
    return {
      connected: false,
      user: null,
      user_key: ctx.userKey || null,
      api_key: apiKey,
      selected_account_id: null,
      accounts: [],
      connect_url,
      reauth_url,
      select_account_url,
      select_account_endpoint,
      logout_url,
      message: "Not connected. Use the auth link to connect Basecamp.",
    };
  }

  try {
    const authResult = await ensureAuthorization({
      token: ctx.token,
      userKey: ctx.userKey,
      force: true,
    });
    const accounts = authResult.auth?.accounts || [];

    // If no account is selected yet, try to auto-select a sensible default
    // so clients (Activepieces dropdowns) work without a manual selection step.
    let selected = await getSelectedAccount(authResult.userKey || ctx.userKey);
    let selectedMatch = selected ? accounts.find((a) => String(a.id) === String(selected)) : null;
    if (!selectedMatch && accounts.length) {
      try {
        const picked = await pickAccountId(authResult.auth, authResult.userKey || ctx.userKey);
        selected = String(picked);
        selectedMatch = accounts.find((a) => String(a.id) === String(selected)) || null;
      } catch {
        // ignore; selection will be required for multi-account setups
      }
    }

    return {
      connected: true,
      user: {
        name: authResult.auth.identity?.name || null,
        email: authResult.auth.identity?.email_address || null,
      },
      user_key: authResult.userKey || ctx.userKey,
      api_key: apiKey,
      selected_account_id: selectedMatch ? selected : null,
      accounts,
      connect_url,
      reauth_url,
      select_account_url,
      select_account_endpoint,
      logout_url,
      message: selectedMatch
        ? "Connected."
        : "Connected. Select a Basecamp account to continue.",
    };
  } catch {
    return {
      connected: false,
      user: null,
      user_key: ctx.userKey || null,
      api_key: apiKey,
      selected_account_id: null,
      accounts: [],
      connect_url,
      reauth_url,
      select_account_url,
      select_account_endpoint,
      logout_url,
      message: "Token exists but authorization could not be loaded. Re-auth required.",
    };
  }
}

async function runMiningJob({ force = false, apiKey = null, userKey = null } = {}) {
  if (MINER_RUNNING) return { ok: false, message: "Miner already running." };
  MINER_RUNNING = true;
  MINER_LAST_STARTED_AT = new Date().toISOString();
  try {
    const ctx = await resolveRequestContext(null, { apiKey, userKey });
    if (!ctx.token?.access_token) return { ok: false, message: "Not authenticated." };

    const authResult = await ensureAuthorization({
      token: ctx.token,
      userKey: ctx.userKey,
      force: false,
    });
    const accountId = await pickAccountId(authResult.auth, authResult.userKey || ctx.userKey);
    const resolvedUserKey = authResult.userKey || ctx.userKey || "legacy";

    const result = await runMining({
      token: ctx.token,
      accountId,
      ua: UA,
      userKey: resolvedUserKey,
      delayMs: Number(process.env.MINER_DELAY_MS || 150),
      projectsPerRun: Number(process.env.MINER_PROJECTS_PER_RUN || 4),
      projectMinIntervalSec: Number(process.env.MINER_PROJECT_MIN_INTERVAL_SEC || 1800),
      includeCards: String(process.env.MINER_INCLUDE_CARDS || "true").toLowerCase() !== "false",
      includeTodos: String(process.env.MINER_INCLUDE_TODOS || "true").toLowerCase() !== "false",
      includeMessages: String(process.env.MINER_INCLUDE_MESSAGES || "false").toLowerCase() === "true",
      includeDocuments: String(process.env.MINER_INCLUDE_DOCUMENTS || "false").toLowerCase() === "true",
      includeUploads: String(process.env.MINER_INCLUDE_UPLOADS || "false").toLowerCase() === "true",
      maxCardsPerProject: Number(process.env.MINER_MAX_CARDS_PER_PROJECT || 0),
      maxTodosPerProject: Number(process.env.MINER_MAX_TODOS_PER_PROJECT || 0),
      maxMessagesPerProject: Number(process.env.MINER_MAX_MESSAGES_PER_PROJECT || 0),
      maxDocumentsPerProject: Number(process.env.MINER_MAX_DOCUMENTS_PER_PROJECT || 0),
      maxUploadsPerProject: Number(process.env.MINER_MAX_UPLOADS_PER_PROJECT || 0),
    });
    MINER_LAST_RESULT = result;
    return { ok: true, result };
  } catch (e) {
    MINER_LAST_RESULT = { error: e?.message || String(e) };
    return { ok: false, error: e?.message || String(e) };
  } finally {
    MINER_RUNNING = false;
  }
}

/* ================= ACTIVEPIECES FLOW TOOLS ================= */

// Helper: query the Activepieces PostgreSQL database directly
let _apDbPool = null;
async function getAPDbPool() {
  if (!_apDbPool) {
    const pg = await import('pg');
    const Pool = pg.default?.Pool || pg.Pool;
    _apDbPool = new Pool({
      host: process.env.AP_POSTGRES_HOST || 'activepieces-postgres',
      port: parseInt(process.env.AP_POSTGRES_PORT || '5432'),
      user: process.env.AP_POSTGRES_USER || 'ap_user',
      password: process.env.AP_POSTGRES_PASSWORD || 'aCnuAb7TuYK4M8K62yVwYSnZ5EXl16w1',
      database: process.env.AP_POSTGRES_DB || 'activepieces',
      max: 3,
      idleTimeoutMillis: 30000,
    });
  }
  return _apDbPool;
}

async function queryAPDb(sql, params = []) {
  const pool = await getAPDbPool();
  const result = await pool.query(sql, params);
  return result.rows;
}

async function handleFlowTool(name, args, userKey = null) {
  const ACTIVEPIECES_URL = process.env.ACTIVEPIECES_URL || 'https://flow.wickedlab.io';
  const ACTIVEPIECES_API_KEY = process.env.ACTIVEPIECES_API_KEY;

  if (!ACTIVEPIECES_API_KEY) {
    throw new Error('ACTIVEPIECES_API_KEY not configured');
  }

  if (!userKey) {
    throw new Error('User authentication required for flow tools');
  }

  async function apiFetch(endpoint, options = {}) {
    const url = `${ACTIVEPIECES_URL}/api/v1/${endpoint}`;
    const method = (options.method || 'GET').toUpperCase();
    const headers = {
      'Authorization': `Bearer ${ACTIVEPIECES_API_KEY}`,
      ...options.headers
    };
    // Only set Content-Type for requests with a body
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Activepieces API error (${response.status}): ${text}`);
    }
    
    // DELETE may return no content
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return { success: true };
    }
    
    return await response.json();
  }

  // Extract email from userKey
  const userEmail = userKey.startsWith('email:') 
    ? userKey.substring(6) 
    : userKey.startsWith('name:')
    ? null
    : null;

  // Check if user exists in Activepieces (paginate through all users)
  let activepiecesUserId = null;
  if (userEmail) {
    try {
      let cursor = null;
      let found = false;
      do {
        const endpoint = cursor ? `users?cursor=${cursor}` : 'users';
        const users = await apiFetch(endpoint);
        const matchingUser = users.data?.find(u => u.email?.toLowerCase() === userEmail.toLowerCase());
        if (matchingUser) {
          activepiecesUserId = matchingUser.id;
          found = true;
          break;
        }
        cursor = users.next || null;
      } while (cursor && !found);
    } catch (e) {
      console.log(`[handleFlowTool] Could not verify Activepieces user: ${e.message}`);
    }
  }

  // Get or create Activepieces project for this user
  let mapping = await getActivepiecesProject(userKey);
  
  if (!mapping) {
    // No cached project mapping. Try to discover the user's project via sign-in.
    if (!activepiecesUserId) {
      // User needs to sign up first
      const signupUrl = `${ACTIVEPIECES_URL}/signup${userEmail ? `?email=${encodeURIComponent(userEmail)}` : ''}`;
      
      throw {
        code: 'ACTIVEPIECES_ACCOUNT_REQUIRED',
        message: `Before creating flows, please create your Activepieces account:\n\n` +
                 `1. Visit: ${signupUrl}\n` +
                 `${userEmail ? `2. Use email: ${userEmail}\n` : ''}` +
                 `${userEmail ? '3' : '2'}. Create a password\n` +
                 `${userEmail ? '4' : '3'}. Come back and try again!\n\n` +
                 `This is a one-time setup. After signup, all your flows will be automatically managed.`,
        signupUrl,
        userEmail
      };
    }

    // User exists in AP - discover their project via direct DB query
    // (AP CE API doesn't support project listing via platform API key)
    console.log(`[handleFlowTool] Discovering project for user: ${userKey} (AP userId: ${activepiecesUserId})`);
    
    let discoveredProjectId = null;
    let discoveredProjectName = null;
    
    try {
      const rows = await queryAPDb(
        'SELECT id, "displayName" FROM project WHERE "ownerId" = $1 ORDER BY created ASC LIMIT 1',
        [activepiecesUserId]
      );
      if (rows && rows.length > 0) {
        discoveredProjectId = rows[0].id;
        discoveredProjectName = rows[0].displayName;
        console.log(`[handleFlowTool] Found project ${discoveredProjectId} (${discoveredProjectName}) for ${userKey}`);
      }
    } catch (dbErr) {
      console.log(`[handleFlowTool] AP DB project lookup failed: ${dbErr.message}`);
    }
    
    if (!discoveredProjectId) {
      throw {
        code: 'PROJECT_NOT_FOUND',
        message: `Your Activepieces account exists but we could not discover your project. ` +
                 `Please visit ${ACTIVEPIECES_URL} and ensure you have at least one project. ` +
                 `Contact support if this persists.`,
        userEmail
      };
    }

    await setActivepiecesProject(userKey, discoveredProjectId, discoveredProjectName);
    mapping = { projectId: discoveredProjectId, projectName: discoveredProjectName };
    
    console.log(`[handleFlowTool] Mapped project ${discoveredProjectId} for ${userKey}`);
  }

  const userProjectId = mapping.projectId;

  switch(name) {
    case 'flow_status': {
      try {
        // Use DB for project count (API key can't list projects in CE)
        const projectRows = await queryAPDb('SELECT COUNT(*) as count FROM project');
        const flows = await apiFetch(`flows?projectId=${userProjectId}`);
        const connections = await apiFetch(`app-connections?projectId=${userProjectId}`);
        return {
          status: 'operational',
          activepieces: {
            url: ACTIVEPIECES_URL,
            connected: true,
            projectId: userProjectId,
            projectName: mapping.projectName,
            projects: parseInt(projectRows[0]?.count || '0'),
            flows: flows?.data?.length || 0,
            connections: connections?.data?.length || 0
          }
        };
      } catch (error) {
        return {
          status: 'error',
          activepieces: {
            url: ACTIVEPIECES_URL,
            connected: false,
            error: error.message
          }
        };
      }
    }

    case 'flow_list':
      return await apiFetch(`flows?projectId=${userProjectId}`);

    case 'flow_get':
      if (!args.flow_id) throw new Error('flow_id required');
      return await apiFetch(`flows/${args.flow_id}`);

    case 'flow_create':
      return await apiFetch('flows', {
        method: 'POST',
        body: JSON.stringify({
          ...args,
          projectId: userProjectId
        })
      });

    case 'flow_update': {
      if (!args.flow_id) throw new Error('flow_id required');
      // AP CE uses POST /flows/:id with operation objects
      // Determine operation type from args
      let operation;
      if (args.displayName) {
        operation = { type: 'CHANGE_NAME', request: { displayName: args.displayName } };
      } else if (args.status) {
        operation = { type: 'CHANGE_STATUS', request: { status: args.status.toUpperCase() } };
      } else if (args.folderId) {
        operation = { type: 'CHANGE_FOLDER', request: { folderId: args.folderId } };
      } else if (args.metadata) {
        operation = { type: 'UPDATE_METADATA', request: { metadata: args.metadata } };
      } else if (args.operation) {
        // Allow passing raw operation for advanced use
        operation = args.operation;
      } else {
        throw new Error('flow_update requires displayName, status, folderId, metadata, or operation');
      }
      return await apiFetch(`flows/${args.flow_id}`, {
        method: 'POST',
        body: JSON.stringify(operation)
      });
    }

    case 'flow_delete':
      if (!args.flow_id) throw new Error('flow_id required');
      return await apiFetch(`flows/${args.flow_id}`, { method: 'DELETE' });

    case 'flow_trigger': {
      if (!args.flow_id) throw new Error('flow_id required');
      // AP CE doesn't have a generic trigger endpoint. Check if the flow has a webhook trigger.
      const flowDetail = await apiFetch(`flows/${args.flow_id}`);
      const trigger = flowDetail?.version?.trigger;
      if (trigger?.type === 'WEBHOOK' || trigger?.type === 'PIECE_TRIGGER') {
        // Use the webhook URL for this flow
        const webhookUrl = `${ACTIVEPIECES_URL}/api/v1/webhooks/${args.flow_id}`;
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args.payload || {})
        });
        return { triggered: true, webhookUrl, status: resp.status };
      }
      throw new Error(
        `Flow ${args.flow_id} uses trigger type "${trigger?.type || 'EMPTY'}". ` +
        'Only flows with webhook triggers can be manually triggered. ' +
        'Schedule-based or polling flows run automatically on their configured schedule.'
      );
    }

    case 'flow_runs_list':
      if (!args.flow_id) throw new Error('flow_id required');
      const limit = args.limit || 10;
      return await apiFetch(`flow-runs?flowId=${args.flow_id}&projectId=${userProjectId}&limit=${limit}`);

    case 'flow_run_get':
      if (!args.run_id) throw new Error('run_id required');
      return await apiFetch(`flow-runs/${args.run_id}`);

    case 'flow_projects_list': {
      // CE API key can't list projects — use direct DB query
      const projects = await queryAPDb(
        'SELECT id, "displayName", "ownerId", created, updated FROM project ORDER BY created DESC'
      );
      return { data: projects };
    }

    case 'flow_project_create':
      // Project creation not available in Activepieces Community Edition
      // Projects are auto-created when users sign up
      throw new Error(
        'Project creation is not available via API in Activepieces CE. ' +
        `Projects are auto-created on user signup. Visit ${ACTIVEPIECES_URL}/signup to create a new account with its own project.`
      );

    case 'flow_pieces_list':
      return await apiFetch('pieces');

    case 'flow_connections_list':
      return await apiFetch(`app-connections?projectId=${userProjectId}`);

    case 'flow_connection_create':
      return await apiFetch('app-connections', {
        method: 'POST',
        body: JSON.stringify({
          externalId: args.name || args.external_id,
          displayName: args.name || args.display_name,
          pieceName: args.piece_name,
          projectId: userProjectId,
          type: args.type || 'SECRET_TEXT',
          value: args.value
        })
      });

    default:
      throw new Error(`Unknown flow tool: ${name}`);
  }
}

export { handleFlowTool };

/* ================= WAVE 1: PM OS FOUNDATION HANDLER ================= */

/**
 * Parse natural language time references to ISO timestamps.
 * Supports: "yesterday", "last week", "2 hours ago", "Monday", ISO dates
 */
function parseTimeSince(since) {
  if (!since) return new Date().toISOString();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(since)) return new Date(since).toISOString();

  const now = Date.now();
  const lower = since.toLowerCase().trim();

  // Relative: "N hours/minutes/days/weeks ago"
  const relMatch = lower.match(/(\d+)\s*(hour|minute|min|day|week|month)s?\s*ago/);
  if (relMatch) {
    const n = parseInt(relMatch[1]);
    const unit = relMatch[2];
    const ms = { hour: 3600000, minute: 60000, min: 60000, day: 86400000, week: 604800000, month: 2592000000 };
    return new Date(now - n * (ms[unit] || 86400000)).toISOString();
  }

  // Named: yesterday, today, last week, this week
  if (lower === 'yesterday') return new Date(now - 86400000).toISOString();
  if (lower === 'today') { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); }
  if (lower === 'last week') return new Date(now - 7 * 86400000).toISOString();
  if (lower === 'this week') {
    const d = new Date(); const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    d.setHours(0,0,0,0); return d.toISOString();
  }
  if (lower === 'last month') return new Date(now - 30 * 86400000).toISOString();

  // Day names: monday, tuesday, etc.
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayIdx = dayNames.indexOf(lower);
  if (dayIdx >= 0) {
    const d = new Date();
    const diff = ((d.getDay() - dayIdx) + 7) % 7 || 7;
    d.setDate(d.getDate() - diff);
    d.setHours(0,0,0,0);
    return d.toISOString();
  }

  // Fallback: try Date parse
  const parsed = new Date(since);
  return isNaN(parsed.getTime()) ? new Date(now - 86400000).toISOString() : parsed.toISOString();
}

/**
 * Compute JSON diff between two snapshots.
 */
function computeDiff(oldSnap, newSnap) {
  const changes = [];
  if (!oldSnap || !newSnap) return changes;

  const allKeys = new Set([...Object.keys(oldSnap), ...Object.keys(newSnap)]);
  for (const key of allKeys) {
    const oldVal = oldSnap[key];
    const newVal = newSnap[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      if (oldVal === undefined) {
        changes.push({ field: key, old_value: null, new_value: newVal, change_type: 'added' });
      } else if (newVal === undefined) {
        changes.push({ field: key, old_value: oldVal, new_value: null, change_type: 'removed' });
      } else {
        changes.push({ field: key, old_value: oldVal, new_value: newVal, change_type: 'modified' });
      }
    }
  }
  return changes;
}

/**
 * Handle Wave 1 PM OS tools: resolve_reference, what_changed_since, who_did_what, undo_*, list_recent_operations
 */
async function handleWave1Tool(name, args, userKey, sessionId, executeTool) {
  switch (name) {
    case 'resolve_reference': {
      if (!args.ref) throw new Error('ref is required');
      const memories = await getSessionMemory(sessionId || 'default', userKey, args.type || null, 10);
      if (!memories.length) {
        return { resolved: false, message: 'No recent context found. Please mention the entity explicitly.' };
      }
      // Score: most recent of matching type wins
      const refLower = (args.ref || '').toLowerCase();
      let best = null;
      let bestScore = 0;
      for (const mem of memories) {
        let score = 0;
        // Exact name match in reference
        if (mem.entity_name && refLower.includes(mem.entity_name.toLowerCase())) {
          score = 1.0;
        }
        // Type hint match
        else if (args.type && mem.entity_type === args.type) {
          score = 0.8;
        }
        // Generic pronoun ("that", "it", "this") — just use recency
        else if (/^(that|it|this|the)\b/.test(refLower)) {
          score = 0.7;
        } else {
          score = 0.3; // weak fallback
        }
        // Time decay: newer is better (memories already sorted DESC)
        const minutesAgo = (Date.now() - new Date(mem.mentioned_at).getTime()) / 60000;
        score *= Math.max(0.1, 1.0 - minutesAgo / (24 * 60));

        if (score > bestScore) {
          bestScore = score;
          best = mem;
        }
      }
      if (best && bestScore > 0.2) {
        return {
          resolved: true,
          type: best.entity_type,
          id: best.entity_id,
          name: best.entity_name,
          context: best.context,
          confidence: Math.round(bestScore * 100) / 100
        };
      }
      return { resolved: false, message: 'Could not confidently resolve reference. Please be more specific.' };
    }

    case 'what_changed_since': {
      if (!args.entity_type || !args.since) throw new Error('entity_type and since are required');
      const since = parseTimeSince(args.since);
      const until = args.until ? parseTimeSince(args.until) : new Date().toISOString();

      if (args.entity_id) {
        // Specific entity diff
        const oldSnap = await getLatestSnapshot(userKey, args.entity_type, args.entity_id, since);
        const newSnap = await getLatestSnapshot(userKey, args.entity_type, args.entity_id, until);
        if (!oldSnap && !newSnap) {
          return { changes: [], message: 'No snapshots found for this entity in the given time range.' };
        }
        const changes = computeDiff(oldSnap?.snapshot, newSnap?.snapshot);
        return {
          entity: { type: args.entity_type, id: args.entity_id },
          period: { since, until },
          changes,
          summary: changes.length
            ? `${changes.length} field(s) changed: ${changes.map(c => c.field).join(', ')}`
            : 'No changes detected in this period.'
        };
      } else {
        // All entities of type — use operation log instead
        const ops = await getRecentOperations(userKey, 50, since, null);
        const relevant = ops.filter(op => {
          const target = op.target || {};
          return target.type === args.entity_type;
        });
        return {
          entity_type: args.entity_type,
          period: { since, until },
          operations: relevant.map(op => ({
            id: op.id,
            operation: op.operation_type,
            target: op.target,
            when: op.created_at,
            undoable: !!op.undo_operation
          })),
          summary: `${relevant.length} operation(s) on ${args.entity_type} entities since ${since}`
        };
      }
    }

    case 'who_did_what': {
      if (!args.since) throw new Error('since is required');
      const since = parseTimeSince(args.since);
      const until = args.until ? parseTimeSince(args.until) : null;

      // Use the user's own key if no person specified
      const targetKey = args.person || userKey;

      const ops = await getRecentOperations(targetKey, 50, since, null);
      let filtered = ops;
      if (args.project) {
        filtered = ops.filter(op => {
          const target = op.target || {};
          return target.project_id == args.project || target.project_name?.toLowerCase().includes(args.project.toLowerCase());
        });
      }
      if (until) {
        filtered = filtered.filter(op => new Date(op.created_at) <= new Date(until));
      }

      return {
        person: targetKey,
        period: { since, until: until || 'now' },
        activities: filtered.map(op => ({
          id: op.id,
          operation: op.operation_type,
          target: op.target,
          when: op.created_at,
          undoable: !!op.undo_operation
        })),
        summary: `${filtered.length} operation(s) by ${targetKey}`
      };
    }

    case 'undo_last': {
      const count = Math.min(parseInt(args.count) || 1, 5);
      const ops = await getRecentOperations(userKey, count);
      const results = [];

      for (const op of ops) {
        if (!op.undo_operation || op.undone_at) {
          results.push({ id: op.id, operation: op.operation_type, success: false, reason: 'No undo available or already undone' });
          continue;
        }
        try {
          // Execute the reverse tool
          if (executeTool && op.undo_args) {
            await executeTool(op.undo_operation, op.undo_args);
          }
          await markUndone(op.id, userKey);
          results.push({
            id: op.id,
            operation: op.operation_type,
            success: true,
            undo_operation: op.undo_operation,
            undo_args: op.undo_args,
            message: `Undone: ${op.operation_type} on ${op.target?.name || op.target?.type || 'entity'}`
          });
        } catch (err) {
          results.push({ id: op.id, operation: op.operation_type, success: false, reason: err.message });
        }
      }
      return { undone: results.filter(r => r.success).length, total: results.length, results };
    }

    case 'undo_operation': {
      if (!args.operation_id) throw new Error('operation_id is required');
      const op = await getOperation(parseInt(args.operation_id));
      if (!op) throw new Error(`Operation ${args.operation_id} not found`);
      if (op.undone_at) throw new Error('Operation already undone');
      if (!op.undo_operation) throw new Error('This operation has no undo mapping');

      // Execute the reverse tool
      if (executeTool && op.undo_args) {
        await executeTool(op.undo_operation, op.undo_args);
      }
      await markUndone(op.id, userKey);
      return {
        success: true,
        operation: op.operation_type,
        undo_executed: op.undo_operation,
        undo_args: op.undo_args,
        message: `Undone: ${op.operation_type} on ${op.target?.name || op.target?.type || 'entity'}`
      };
    }

    case 'list_recent_operations': {
      const ops = await getRecentOperations(
        userKey,
        parseInt(args.limit) || 20,
        args.since ? parseTimeSince(args.since) : null,
        args.type || null
      );
      return {
        operations: ops.map(op => ({
          id: op.id,
          operation: op.operation_type,
          target: op.target,
          when: op.created_at,
          undoable: !!op.undo_operation && !op.undone_at,
          undone: !!op.undone_at
        })),
        total: ops.length
      };
    }

    default:
      throw new Error(`Unknown Wave 1 tool: ${name}`);
  }
}

export { handleWave1Tool };

/**
 * Wave 2: Intelligence Tools
 * Project Pulse, Focus Mode, Ghost Work Detector, NL Query, Smart Dashboards
 */
async function handleWave2Tool(name, args, userKey, sessionId) {
  switch (name) {

    // ===== PROJECT PULSE =====
    case 'get_project_pulse': {
      if (!args.project) throw new Error('project is required');
      const projects = await listEntityCache('project', { userKey, limit: 200 });
      const match = projects.find(p =>
        p.title?.toLowerCase().includes(args.project.toLowerCase()) ||
        String(p.object_id) === String(args.project)
      );
      if (!match) throw new Error(`Project not found: ${args.project}`);

      const projectId = match.object_id;
      const todos = await listEntityCache('todo', { projectId, userKey, limit: 500 });
      const messages = await listEntityCache('message', { projectId, userKey, limit: 200 });
      const people = await listEntityCache('person', { userKey, limit: 100 });

      // ---- Velocity Score (0-25) ----
      const periodDays = parsePeriodDays(args.period || '2 weeks');
      const cutoff = new Date(Date.now() - periodDays * 86400000);
      const completed = todos.filter(t => t.data?.completed === true && new Date(t.data?.completed_at || t.data?.updated_at) >= cutoff);
      const created = todos.filter(t => new Date(t.data?.created_at) >= cutoff);
      const active = todos.filter(t => !t.data?.completed);
      const completionRate = todos.length > 0 ? completed.length / Math.max(created.length, 1) : 0;
      let velocity = Math.min(25, Math.round(completionRate * 25));
      if (created.length > completed.length * 1.5) velocity = Math.round(velocity * 0.7);

      // ---- Risk Score (0-25) ----
      const now = Date.now();
      const overdue = active.filter(t => t.data?.due_on && new Date(t.data.due_on) < now);
      const staleDays = 7;
      const stale = active.filter(t => {
        const lastAct = t.data?.updated_at || t.data?.created_at;
        return lastAct && (now - new Date(lastAct).getTime()) > staleDays * 86400000;
      });
      const unassigned = active.filter(t => !t.data?.assignee_ids?.length);
      let risk = 25;
      risk -= Math.min(10, overdue.length * 2);
      risk -= Math.min(8, active.length > 0 ? Math.round((stale.length / active.length) * 8) : 0);
      risk -= Math.min(5, active.length > 0 ? Math.round((unassigned.length / active.length) * 5) : 0);
      risk = Math.max(0, risk);

      // ---- Communication Score (0-25) ----
      const recentMsgs = messages.filter(m => new Date(m.data?.created_at) >= cutoff);
      const msgCount = recentMsgs.length;
      let communication = msgCount >= 5 ? 25 : msgCount >= 2 ? 20 : msgCount >= 1 ? 15 : 5;

      // ---- Balance Score (0-25) ----
      const assigneeCounts = {};
      for (const t of active) {
        for (const aid of (t.data?.assignee_ids || [])) {
          assigneeCounts[aid] = (assigneeCounts[aid] || 0) + 1;
        }
      }
      const counts = Object.values(assigneeCounts);
      const balance = counts.length > 1 ? Math.round(25 * (1 - gini(counts))) : (counts.length === 1 ? 15 : 20);

      const score = velocity + risk + communication + balance;
      const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

      // Risks
      const risks = [];
      if (overdue.length > 0) risks.push({ type: 'deadline', severity: overdue.length > 3 ? 'high' : 'medium', description: `${overdue.length} overdue task(s)`, items: overdue.slice(0, 5).map(t => t.title) });
      if (stale.length > 0) risks.push({ type: 'stalled', severity: stale.length > 5 ? 'high' : 'medium', description: `${stale.length} stale task(s) (no activity ${staleDays}+ days)`, items: stale.slice(0, 5).map(t => t.title) });
      if (unassigned.length > 0) risks.push({ type: 'unassigned', severity: 'low', description: `${unassigned.length} unassigned task(s)`, items: unassigned.slice(0, 5).map(t => t.title) });

      // Insights
      const insights = [];
      insights.push(`${completed.length} tasks completed in last ${periodDays} days`);
      insights.push(`${created.length} new tasks created`);
      insights.push(`${active.length} tasks still active`);
      if (msgCount > 0) insights.push(`${msgCount} messages in the period`);

      // Recommendations
      const recommendations = [];
      if (overdue.length > 0) recommendations.push(`Address ${overdue.length} overdue tasks`);
      if (stale.length > 3) recommendations.push(`Review ${stale.length} stale tasks — close or update them`);
      if (unassigned.length > 3) recommendations.push(`Assign ${unassigned.length} orphaned tasks`);
      if (velocity < 10) recommendations.push('Velocity is low — consider reducing scope or unblocking work');
      if (communication < 10) recommendations.push('Communication is quiet — consider a team check-in');

      // Cache the result
      await saveHealthScore(userKey, String(projectId), match.title, score, grade, 'stable',
        { velocity, risk, communication, balance }, risks, insights, recommendations);

      return {
        project: match.title,
        project_id: projectId,
        score, grade, trend: 'stable',
        breakdown: { velocity, risk, communication, balance },
        risks, insights, recommendations,
        period: `${periodDays} days`,
        computed_at: new Date().toISOString()
      };
    }

    case 'get_portfolio_pulse': {
      const projects = await listEntityCache('project', { userKey, limit: 200 });
      const results = [];
      for (const proj of projects.slice(0, 20)) { // cap at 20
        try {
          const pulse = await handleWave2Tool('get_project_pulse', { project: String(proj.object_id), period: args.period || '2 weeks' }, userKey, sessionId);
          results.push(pulse);
        } catch { /* skip projects with errors */ }
      }
      const sortField = args.sort_by || 'score';
      results.sort((a, b) => {
        if (sortField === 'risk') return (a.breakdown?.risk || 0) - (b.breakdown?.risk || 0);
        if (sortField === 'name') return (a.project || '').localeCompare(b.project || '');
        return (a.score || 0) - (b.score || 0);
      });
      const limited = args.limit ? results.slice(0, args.limit) : results;
      return {
        projects: limited.map(p => ({
          project: p.project, score: p.score, grade: p.grade, trend: p.trend,
          breakdown: p.breakdown, top_risk: p.risks?.[0]?.description || 'None'
        })),
        total: limited.length,
        avg_score: limited.length > 0 ? Math.round(limited.reduce((s, p) => s + p.score, 0) / limited.length) : 0
      };
    }

    // ===== FOCUS MODE =====
    case 'my_day': {
      const projects = await listEntityCache('project', { userKey, limit: 50 });
      const allTodos = [];
      for (const proj of projects.slice(0, 10)) {
        const todos = await listEntityCache('todo', { projectId: proj.object_id, userKey, limit: 200 });
        allTodos.push(...todos.map(t => ({ ...t, projectName: proj.title, projectId: proj.object_id })));
      }
      const active = allTodos.filter(t => !t.data?.completed);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

      // Priority tasks: due today/overdue, or recently created
      const dueToday = active.filter(t => {
        if (!t.data?.due_on) return false;
        const d = new Date(t.data.due_on);
        return d <= tomorrow;
      });
      const overdue = active.filter(t => t.data?.due_on && new Date(t.data.due_on) < today);
      const recentlyCreated = active.filter(t => new Date(t.data?.created_at) >= new Date(Date.now() - 86400000));

      // What changed overnight (last 12 hours of operations)
      const ops = await getRecentOperations(userKey, 20, new Date(Date.now() - 12 * 3600000).toISOString(), null);

      return {
        date: today.toISOString().split('T')[0],
        priority_tasks: dueToday.slice(0, 10).map(t => ({
          title: t.title, project: t.projectName,
          due: t.data?.due_on, reason: new Date(t.data?.due_on) < today ? 'Overdue' : 'Due today'
        })),
        overdue_count: overdue.length,
        active_tasks: active.length,
        recently_created: recentlyCreated.length,
        overnight_changes: ops.map(o => ({ operation: o.operation_type, target: o.target, when: o.created_at })),
        suggested_focus: dueToday.length > 0
          ? `Focus on ${dueToday.length} task(s) due today/overdue`
          : active.length > 0
            ? `${active.length} active tasks — pick the most impactful one`
            : 'All caught up! Consider reviewing project health.'
      };
    }

    case 'what_should_i_work_on': {
      const limit = parseInt(args.limit) || 5;
      const projects = await listEntityCache('project', { userKey, limit: 50 });
      let allTodos = [];
      for (const proj of projects.slice(0, 10)) {
        if (args.project && !proj.title?.toLowerCase().includes(args.project.toLowerCase()) && String(proj.object_id) !== args.project) continue;
        const todos = await listEntityCache('todo', { projectId: proj.object_id, userKey, limit: 200 });
        allTodos.push(...todos.map(t => ({ ...t, projectName: proj.title, projectId: proj.object_id })));
      }
      const active = allTodos.filter(t => !t.data?.completed);

      // Score each task
      const scored = active.map(t => {
        const now = Date.now();
        // Urgency (0-25)
        let urgency = 10;
        if (t.data?.due_on) {
          const daysUntil = (new Date(t.data.due_on).getTime() - now) / 86400000;
          urgency = daysUntil < 0 ? 25 : daysUntil < 1 ? 22 : daysUntil < 3 ? 18 : daysUntil < 7 ? 12 : 5;
        }
        // Impact (0-25) — tasks with descriptions suggesting importance
        const desc = (t.data?.description || '').toLowerCase();
        const impact = desc.includes('block') ? 20 : desc.includes('urgent') ? 18 : desc.includes('important') ? 15 : 10;
        // Effort match (0-25) — shorter descriptions = smaller tasks
        const descLen = (t.data?.description || '').length;
        let effort = 15;
        if (args.energy_level === 'low' && descLen < 100) effort = 25;
        else if (args.energy_level === 'high' && descLen > 200) effort = 25;
        else if (args.energy_level === 'medium') effort = 20;
        // Context (0-25) — recency bonus
        const age = (now - new Date(t.data?.created_at || 0).getTime()) / 86400000;
        const context = age < 1 ? 25 : age < 3 ? 20 : age < 7 ? 15 : 10;

        return {
          title: t.title, project: t.projectName, due: t.data?.due_on,
          score: urgency + impact + effort + context,
          factors: { urgency, impact, effort, context },
          reason: urgency >= 22 ? 'Due soon' : impact >= 18 ? 'High impact' : effort >= 22 ? 'Good fit for your energy' : 'Recent'
        };
      });

      scored.sort((a, b) => b.score - a.score);
      return { tasks: scored.slice(0, limit), total_active: active.length };
    }

    case 'end_of_day': {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const ops = await getRecentOperations(userKey, 100, today.toISOString(), null);

      // Group by operation type
      const byType = {};
      const byProject = {};
      for (const op of ops) {
        byType[op.operation_type] = (byType[op.operation_type] || 0) + 1;
        const proj = op.target?.project_name || op.target?.name || 'Unknown';
        byProject[proj] = (byProject[proj] || 0) + 1;
      }

      const creates = ops.filter(o => o.operation_type.includes('create'));
      const completes = ops.filter(o => o.operation_type.includes('complete'));

      return {
        date: today.toISOString().split('T')[0],
        total_operations: ops.length,
        summary: {
          tasks_created: creates.filter(o => o.operation_type.includes('task')).length,
          tasks_completed: completes.length,
          messages_sent: (byType['create_message'] || 0) + (byType['create_comment'] || 0),
          flows_managed: (byType['flow_create'] || 0) + (byType['flow_update'] || 0) + (byType['flow_trigger'] || 0)
        },
        by_project: Object.entries(byProject).map(([name, count]) => ({ project: name, operations: count })),
        activities: ops.slice(0, 20).map(o => ({
          operation: o.operation_type, target: o.target?.name || o.target?.type, when: o.created_at
        })),
        wins: completes.length > 0 ? [`Completed ${completes.length} task(s)`] : [],
        message: ops.length > 0
          ? `Productive day! ${ops.length} operations across ${Object.keys(byProject).length} project(s).`
          : 'Quiet day — no tracked operations.'
      };
    }

    // ===== GHOST WORK DETECTOR =====
    case 'detect_ghost_work': {
      const staleDaysThreshold = args.stale_days || 7;
      const projects = await listEntityCache('project', { userKey, limit: 50 });
      const ghostItems = { stale: [], unassigned: [], overdue: [], blocked: [] };
      const now = Date.now();

      for (const proj of projects.slice(0, 15)) {
        if (args.project && !proj.title?.toLowerCase().includes(args.project.toLowerCase()) && String(proj.object_id) !== args.project) continue;
        const todos = await listEntityCache('todo', { projectId: proj.object_id, userKey, limit: 300 });
        const active = todos.filter(t => !t.data?.completed || args.include_completed);

        for (const t of active) {
          const lastAct = t.data?.updated_at || t.data?.created_at;
          const daysSinceActivity = lastAct ? (now - new Date(lastAct).getTime()) / 86400000 : 999;

          if (daysSinceActivity > staleDaysThreshold) {
            ghostItems.stale.push({ title: t.title, project: proj.title, days_inactive: Math.round(daysSinceActivity), due: t.data?.due_on });
          }
          if (!t.data?.assignee_ids?.length && !t.data?.completed) {
            ghostItems.unassigned.push({ title: t.title, project: proj.title, created: t.data?.created_at });
          }
          if (t.data?.due_on && new Date(t.data.due_on) < now && !t.data?.completed) {
            ghostItems.overdue.push({ title: t.title, project: proj.title, due: t.data.due_on, days_overdue: Math.round((now - new Date(t.data.due_on).getTime()) / 86400000) });
          }
          const desc = (t.data?.description || '').toLowerCase();
          const hasBlockedComment = t.data?.comments_count > 0 && desc.includes('block');
          if (desc.includes('blocked') || hasBlockedComment) {
            ghostItems.blocked.push({ title: t.title, project: proj.title });
          }
        }
      }

      const totalGhosts = ghostItems.stale.length + ghostItems.unassigned.length + ghostItems.overdue.length + ghostItems.blocked.length;
      return {
        total_ghost_items: totalGhosts,
        stale: { count: ghostItems.stale.length, items: ghostItems.stale.slice(0, 15) },
        unassigned: { count: ghostItems.unassigned.length, items: ghostItems.unassigned.slice(0, 15) },
        overdue: { count: ghostItems.overdue.length, items: ghostItems.overdue.slice(0, 15) },
        blocked: { count: ghostItems.blocked.length, items: ghostItems.blocked.slice(0, 10) },
        severity: totalGhosts > 20 ? 'critical' : totalGhosts > 10 ? 'high' : totalGhosts > 5 ? 'medium' : 'low',
        recommendations: [
          ...(ghostItems.overdue.length > 0 ? [`Address ${ghostItems.overdue.length} overdue tasks immediately`] : []),
          ...(ghostItems.stale.length > 5 ? [`Review and close/update ${ghostItems.stale.length} stale tasks`] : []),
          ...(ghostItems.unassigned.length > 3 ? [`Assign ${ghostItems.unassigned.length} orphaned tasks to owners`] : []),
          ...(ghostItems.blocked.length > 0 ? [`Unblock ${ghostItems.blocked.length} stuck task(s)`] : [])
        ]
      };
    }

    // ===== NL QUERY ENGINE =====
    case 'query': {
      if (!args.q) throw new Error('q is required');
      const q = args.q.toLowerCase();

      // Pattern matching for common queries
      if (/how many (tasks?|todos?)/i.test(q)) {
        const projects = await listEntityCache('project', { userKey, limit: 50 });
        let total = 0, completed = 0, active = 0;
        for (const p of projects.slice(0, 10)) {
          if (args.project && !p.title?.toLowerCase().includes(args.project.toLowerCase())) continue;
          const todos = await listEntityCache('todo', { projectId: p.object_id, userKey, limit: 500 });
          total += todos.length;
          completed += todos.filter(t => t.data?.completed).length;
          active += todos.filter(t => !t.data?.completed).length;
        }
        const overdue = /overdue/.test(q);
        if (overdue) {
          const now = Date.now();
          let overdueCount = 0;
          for (const p of projects.slice(0, 10)) {
            if (args.project && !p.title?.toLowerCase().includes(args.project.toLowerCase())) continue;
            const todos = await listEntityCache('todo', { projectId: p.object_id, userKey, limit: 500 });
            overdueCount += todos.filter(t => !t.data?.completed && t.data?.due_on && new Date(t.data.due_on) < now).length;
          }
          return { answer: `${overdueCount} overdue task(s)`, overdue: overdueCount };
        }
        return { answer: `${total} total tasks: ${active} active, ${completed} completed`, total, active, completed };
      }

      if (/who has the most (tasks?|work)/i.test(q)) {
        const projects = await listEntityCache('project', { userKey, limit: 50 });
        const people = await listEntityCache('person', { userKey, limit: 100 });
        const personMap = {};
        for (const p of people) personMap[p.object_id] = p.title || p.data?.name || 'Unknown';
        const workload = {};
        for (const proj of projects.slice(0, 10)) {
          const todos = await listEntityCache('todo', { projectId: proj.object_id, userKey, limit: 300 });
          for (const t of todos.filter(td => !td.data?.completed)) {
            for (const aid of (t.data?.assignee_ids || [])) {
              workload[aid] = (workload[aid] || 0) + 1;
            }
          }
        }
        const sorted = Object.entries(workload).sort((a, b) => b[1] - a[1]);
        const top = sorted.slice(0, 5).map(([id, count]) => ({ person: personMap[id] || id, tasks: count }));
        return { answer: top.length > 0 ? `${top[0].person} has the most with ${top[0].tasks} tasks` : 'No assigned tasks found', workload: top };
      }

      if (/stale|inactive|abandoned/i.test(q)) {
        return handleWave2Tool('detect_ghost_work', { stale_days: 7, ...args }, userKey, sessionId);
      }

      if (/due (this|next) week/i.test(q)) {
        const projects = await listEntityCache('project', { userKey, limit: 50 });
        const now = new Date();
        const weekEnd = new Date(now);
        weekEnd.setDate(weekEnd.getDate() + (/next/.test(q) ? 14 : 7));
        const dueThisWeek = [];
        for (const proj of projects.slice(0, 10)) {
          if (args.project && !proj.title?.toLowerCase().includes(args.project.toLowerCase())) continue;
          const todos = await listEntityCache('todo', { projectId: proj.object_id, userKey, limit: 300 });
          for (const t of todos.filter(td => !td.data?.completed && td.data?.due_on)) {
            const due = new Date(t.data.due_on);
            if (due >= now && due <= weekEnd) {
              dueThisWeek.push({ title: t.title, project: proj.title, due: t.data.due_on });
            }
          }
        }
        return { answer: `${dueThisWeek.length} task(s) due ${/next/.test(q) ? 'next' : 'this'} week`, tasks: dueThisWeek.slice(0, 20) };
      }

      if (/messages?|comments?/i.test(q) && /last|recent|today|yesterday/i.test(q)) {
        const projects = await listEntityCache('project', { userKey, limit: 50 });
        let recentMsgs = [];
        const cutoff = /today/.test(q) ? new Date(new Date().setHours(0, 0, 0, 0)) : new Date(Date.now() - 3 * 86400000);
        for (const proj of projects.slice(0, 10)) {
          const msgs = await listEntityCache('message', { projectId: proj.object_id, userKey, limit: 100 });
          recentMsgs.push(...msgs.filter(m => new Date(m.data?.created_at) >= cutoff).map(m => ({ title: m.title, project: proj.title, created: m.data?.created_at })));
        }
        return { answer: `${recentMsgs.length} recent message(s)`, messages: recentMsgs.slice(0, 20) };
      }

      if (/projects?/i.test(q) && /how many|count|list|all/i.test(q)) {
        const projects = await listEntityCache('project', { userKey, limit: 200 });
        return { answer: `${projects.length} project(s)`, projects: projects.map(p => ({ name: p.title, id: p.object_id })) };
      }

      if (/people|team|members?/i.test(q)) {
        const people = await listEntityCache('person', { userKey, limit: 200 });
        return { answer: `${people.length} team member(s)`, people: people.map(p => ({ name: p.title || p.data?.name, id: p.object_id })) };
      }

      // Fallback: search
      const searchResults = await searchIndex(args.q, { userKey, limit: 20 });
      return {
        answer: `Found ${searchResults.length} matching items for "${args.q}"`,
        results: searchResults.slice(0, 15).map(r => ({ type: r.type, title: r.title, project_id: r.project_id }))
      };
    }

    // ===== SMART DASHBOARDS =====
    case 'generate_dashboard': {
      if (!args.type) throw new Error('type is required');

      switch (args.type) {
        case 'overview': {
          const pulse = await handleWave2Tool('get_portfolio_pulse', { sort_by: 'score', ...args }, userKey, sessionId);
          const ghosts = await handleWave2Tool('detect_ghost_work', {}, userKey, sessionId);
          return {
            dashboard: 'Portfolio Overview',
            portfolio: pulse,
            ghost_work: { total: ghosts.total_ghost_items, severity: ghosts.severity, top_issues: ghosts.recommendations },
            generated_at: new Date().toISOString()
          };
        }
        case 'project': {
          if (!args.project) throw new Error('project is required for project dashboard');
          const pulse = await handleWave2Tool('get_project_pulse', { project: args.project, period: args.period }, userKey, sessionId);
          const ghosts = await handleWave2Tool('detect_ghost_work', { project: args.project }, userKey, sessionId);
          return {
            dashboard: `Project: ${pulse.project}`,
            health: { score: pulse.score, grade: pulse.grade, breakdown: pulse.breakdown },
            risks: pulse.risks,
            ghost_work: ghosts,
            insights: pulse.insights,
            recommendations: pulse.recommendations,
            generated_at: new Date().toISOString()
          };
        }
        case 'team': {
          const people = await listEntityCache('person', { userKey, limit: 100 });
          const projects = await listEntityCache('project', { userKey, limit: 50 });
          const workload = {};
          for (const proj of projects.slice(0, 10)) {
            const todos = await listEntityCache('todo', { projectId: proj.object_id, userKey, limit: 300 });
            for (const t of todos.filter(td => !td.data?.completed)) {
              for (const aid of (t.data?.assignee_ids || [])) {
                if (!workload[aid]) workload[aid] = { tasks: 0, projects: new Set() };
                workload[aid].tasks++;
                workload[aid].projects.add(proj.title);
              }
            }
          }
          const personMap = {};
          for (const p of people) personMap[p.object_id] = p.title || p.data?.name || 'Unknown';
          const team = Object.entries(workload).map(([id, w]) => ({
            person: personMap[id] || id, tasks: w.tasks, projects: w.projects.size
          })).sort((a, b) => b.tasks - a.tasks);

          const taskCounts = team.map(t => t.tasks);
          return {
            dashboard: 'Team Workload',
            members: team,
            balance: { gini: taskCounts.length > 1 ? Math.round(gini(taskCounts) * 100) / 100 : 0, assessment: taskCounts.length > 1 && gini(taskCounts) > 0.4 ? 'Imbalanced' : 'OK' },
            total_people: people.length,
            generated_at: new Date().toISOString()
          };
        }
        case 'velocity': {
          const projects = await listEntityCache('project', { userKey, limit: 20 });
          const velocities = [];
          const periodDays = parsePeriodDays(args.period || '2 weeks');
          const cutoff = new Date(Date.now() - periodDays * 86400000);
          for (const proj of projects.slice(0, 10)) {
            const todos = await listEntityCache('todo', { projectId: proj.object_id, userKey, limit: 300 });
            const completed = todos.filter(t => t.data?.completed && new Date(t.data?.completed_at || t.data?.updated_at) >= cutoff).length;
            const created = todos.filter(t => new Date(t.data?.created_at) >= cutoff).length;
            velocities.push({ project: proj.title, completed, created, net: completed - created, ratio: created > 0 ? Math.round(completed / created * 100) / 100 : 0 });
          }
          velocities.sort((a, b) => b.ratio - a.ratio);
          return {
            dashboard: 'Velocity Trends',
            period: `${periodDays} days`,
            projects: velocities,
            totals: { completed: velocities.reduce((s, v) => s + v.completed, 0), created: velocities.reduce((s, v) => s + v.created, 0) },
            generated_at: new Date().toISOString()
          };
        }
        case 'risk': {
          const ghosts = await handleWave2Tool('detect_ghost_work', {}, userKey, sessionId);
          const pulse = await handleWave2Tool('get_portfolio_pulse', { sort_by: 'risk' }, userKey, sessionId);
          const atRisk = pulse.projects?.filter(p => p.score < 60) || [];
          return {
            dashboard: 'Risk Assessment',
            at_risk_projects: atRisk,
            ghost_work: ghosts,
            overall_severity: ghosts.severity,
            action_items: [...ghosts.recommendations, ...(atRisk.length > 0 ? [`${atRisk.length} project(s) scoring below 60`] : [])],
            generated_at: new Date().toISOString()
          };
        }
        default: throw new Error(`Unknown dashboard type: ${args.type}`);
      }
    }

    default:
      throw new Error(`Unknown Wave 2 tool: ${name}`);
  }
}

// Helper: Gini coefficient for workload balance
function gini(values) {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b);
  if (sorted.length < 2) return 0;
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let numerator = 0;
  for (let i = 0; i < n; i++) numerator += (i + 1) * sorted[i];
  return (2 * numerator) / (n * sum) - (n + 1) / n;
}

// Helper: parse period like "2 weeks", "1 month" to days
function parsePeriodDays(period) {
  const m = String(period).match(/(\d+)\s*(day|week|month)/i);
  if (!m) return 14;
  const num = parseInt(m[1]);
  if (/month/i.test(m[2])) return num * 30;
  if (/week/i.test(m[2])) return num * 7;
  return num;
}

export { handleWave2Tool };

/* ================= MCP CONTEXT BUILDER ================= */

async function buildMcpCtx(req) {
  const ctx = await resolveRequestContext(req);
  let auth = ctx.auth;
  let userKey = ctx.userKey;
  let accountId = null;

  if (ctx.token?.access_token) {
    const authResult = await ensureAuthorization({
      token: ctx.token,
      userKey: ctx.userKey,
      force: false,
    });
    auth = authResult.auth;
    userKey = authResult.userKey || userKey;
    accountId = await pickAccountId(auth, userKey);
  }

  console.log(`[buildMcpCtx] accountId retrieved: ${accountId} (type: ${typeof accountId})`);

  return {
    TOKEN: ctx.token,
    accountId,
    ua: UA,
    userKey,
    apiKey: ctx.apiKey,
    authAccounts: auth?.accounts || [],
    startStatus: async (overrides = {}) =>
      await startStatus(req, { apiKey: overrides.apiKey || ctx.apiKey }),

    // Provide both single-request AND auto-paginated versions to MCP
    basecampFetch: async (path, opts = {}) =>
      basecampFetchCore(ctx.token, path, { ...opts, ua: UA, accountId }),

    basecampFetchAll: async (path, opts = {}) =>
      basecampFetchAllCore(ctx.token, path, (() => {
        const out = { ...opts, ua: UA, accountId };
        // allow overrides, otherwise let basecampFetchAll defaults apply
        if (opts.maxPages != null) out.maxPages = opts.maxPages;
        if (opts.pageDelayMs != null) out.pageDelayMs = opts.pageDelayMs;
        return out;
      })()),
  };
}

async function runTool(op, params, req) {
  const ctx = await buildMcpCtx(req);

  const normalizedParams = params && typeof params === "object" ? { ...params } : {};
  if (normalizedParams.compact === undefined) {
    normalizedParams.compact = true;
  }
  delete normalizedParams.api_key;
  delete normalizedParams.session_key;
  delete normalizedParams.user_key;

  const rpc = {
    jsonrpc: "2.0",
    id: `action-${op}`,
    method: "tools/call",
    params: { name: op, arguments: normalizedParams },
  };

  const out = await handleMCP(rpc, ctx);

  if (out?.error) {
    const err = new Error(out.error.message || out.error.code || "TOOL_ERROR");
    err.code = out.error.code || "TOOL_ERROR";
    err.details = out.error;
    throw err;
  }

  return out?.result;
}

/* ================= Health ================= */
app.get("/health", (req, res) => res.json({ ok: true, build: UA, circuit: getBasecampCircuitStatus() }));

/* ================= Debug Endpoints ================= */
app.get("/debug/tools", async (req, res) => {
  try {
    const { getTools } = await import("./mcp/tools.js");
    const tools = getTools();
    const flowTools = tools.filter(t => t.name.startsWith('flow_'));
    res.json({
      ok: true,
      total_tools: tools.length,
      flow_tools_count: flowTools.length,
      flow_tools: flowTools.map(t => ({ name: t.name, description: t.description })),
      sample_tools: tools.slice(0, 5).map(t => t.name)
    });
  } catch (err) {
    res.json({ ok: false, error: err.message, stack: err.stack });
  }
});

app.post("/debug/restart", async (req, res) => {
  res.json({ ok: true, message: "Restarting in 1 second..." });
  setTimeout(() => process.exit(0), 1000);
});

/* ================= OpenAPI Schema ================= */
app.get("/.well-known/openapi.json", (req, res) => {
  res.sendFile(path.join(__dirname, "openapi.json"));
});

app.get("/openapi.json", (req, res) => {
  res.sendFile(path.join(__dirname, "openapi.json"));
});

app.get("/connect", (req, res) => {
  res.sendFile(path.join(__dirname, "connect.html"));
});

/* ================= OAuth ================= */
app.get("/auth/basecamp/start", (req, res) => {
  const base = originBase(req);
  const redirectUri = `${base}/auth/basecamp/callback`;
  const state = normalizeKey(req.query.state || req.query.api_key || req.query.apiKey || extractApiKey(req));

  const url =
    `https://launchpad.37signals.com/authorization/new` +
    `?type=web_server` +
    `&client_id=${process.env.BASECAMP_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    (state ? `&state=${encodeURIComponent(state)}` : "");

  res.redirect(url);
});

app.get("/auth/basecamp/callback", async (req, res) => {
  try {
    const base = originBase(req);
    const redirectUri = `${base}/auth/basecamp/callback`;
    const apiKeyFromState = normalizeKey(req.query.state || req.query.api_key || req.query.apiKey);

    const r = await fetch("https://launchpad.37signals.com/authorization/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: new URLSearchParams({
        type: "web_server",
        client_id: process.env.BASECAMP_CLIENT_ID,
        client_secret: process.env.BASECAMP_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code: req.query.code,
      }),
    });

    const token = await r.json();
    if (!r.ok) {
      const err = new Error(token?.error_description || token?.error || "OAUTH_TOKEN_FAILED");
      err.code = "OAUTH_TOKEN_FAILED";
      err.status = r.status;
      throw err;
    }
    if (!token?.access_token) {
      const err = new Error("OAUTH_TOKEN_MISSING");
      err.code = "OAUTH_TOKEN_MISSING";
      throw err;
    }

    const auth = await fetchAuthorization(token);
    const derivedUserKey = deriveUserKey(auth);
    if (!derivedUserKey) {
      throw new Error("USER_KEY_REQUIRED");
    }

    await setUserToken(token, derivedUserKey);
    await setUserAuthCache(auth, derivedUserKey);

    const existingKey = await getApiKeyForUser(derivedUserKey);
    let apiKey = existingKey || apiKeyFromState || null;
    if (apiKey && !existingKey) {
      await bindApiKeyToUser(apiKey, derivedUserKey, token);
    } else if (apiKey && existingKey) {
      // Update the stored token on the API key
      await bindApiKeyToUser(apiKey, derivedUserKey, token);
    }
    if (!apiKey) {
      apiKey = await createApiKeyForUser(derivedUserKey, token);
    }

    res.redirect(`${base}/connect?api_key=${encodeURIComponent(apiKey)}`);
  } catch (e) {
    res.status(500).send(`OAuth failed: ${e?.message || e}`);
  }
});

app.get("/startbcgpt", async (req, res) => res.json(await startStatus(req)));

app.post("/logout", async (req, res) => {
  const ctx = await resolveRequestContext(req);
  if (ctx.userKey) {
    // Only clear auth cache, NOT the token — token must persist for API key access
    await clearUserAuthCache(ctx.userKey);
  }
  res.json({ ok: true, connected: false, api_key: ctx.apiKey || null, message: "Logged out. API key still works." });
});

/* ================= Actions ================= */
app.post("/action/startbcgpt", async (req, res) => {
  res.json(await startStatus(req));
});

app.post("/select_account", async (req, res) => {
  try {
    const apiKey = normalizeKey(extractApiKey(req));
    const accountId = normalizeKey(req.body?.account_id || req.query?.account_id);
    const base = originBase(req);
    const connect_url = `${base}/connect`;
    const reauth_url = apiKey ? `${base}/auth/basecamp/start?state=${encodeURIComponent(apiKey)}` : connect_url;

    if (!apiKey) {
      return res.status(400).json({
        ok: false,
        error: "API_KEY_REQUIRED",
        message: "Missing api_key",
        connect_url,
      });
    }

    if (!accountId) {
      return res.status(400).json({
        ok: false,
        error: "ACCOUNT_ID_REQUIRED",
        message: "Missing account_id",
      });
    }

    const ctx = await resolveRequestContext(req, { apiKey });
    if (!ctx.token?.access_token) {
      return res.status(401).json({
        ok: false,
        error: "NOT_AUTHENTICATED",
        message: "Not connected. Use the auth link to connect Basecamp.",
        reauth_url,
        connect_url,
      });
    }

    const authResult = await ensureAuthorization({
      token: ctx.token,
      userKey: ctx.userKey,
      force: true,
    });

    const accounts = authResult.auth?.accounts || [];
    const match = accounts.find((a) => String(a.id) === String(accountId));
    if (!match) {
      return res.status(400).json({
        ok: false,
        error: "ACCOUNT_NOT_FOUND",
        message: "Account ID not found in authorized accounts.",
        accounts,
      });
    }

    const selected = await setSelectedAccount(authResult.userKey || ctx.userKey, accountId);
    return res.json({
      ok: true,
      selected_account_id: selected,
      accounts,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.code || "SERVER_ERROR", message: e?.message || String(e) });
  }
});

app.post("/action/:op", async (req, res) => {
  if (req.params.op === "startbcgpt") {
    return res.status(404).json({ ok: false, error: "Use /action/startbcgpt", code: "BAD_ROUTE" });
  }

  const findChunkRequirement = (value, depth = 0, maxDepth = 6) => {
    if (!value || typeof value !== "object" || depth > maxDepth) return null;
    if (value.chunk_required === true && value.payload_key) {
      return {
        payload_key: value.payload_key,
        chunk_count: value.chunk_count || null,
        partial: value
      };
    }
    for (const key of Object.keys(value)) {
      if (!key.endsWith("_payload_key")) continue;
      const payloadKey = value[key];
      if (!payloadKey) continue;
      const prefix = key.slice(0, -"_payload_key".length);
      const chunkCount = value[`${prefix}_chunk_count`];
      const cached = value[`${prefix}_cached`];
      const chunkRequired = value[`${prefix}_chunk_required`];
      if (chunkRequired === true || cached === true || (Number.isFinite(Number(chunkCount)) && Number(chunkCount) > 1)) {
        return {
          payload_key: payloadKey,
          chunk_count: chunkCount || null,
          partial: value
        };
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findChunkRequirement(item, depth + 1, maxDepth);
        if (found) return found;
      }
      return null;
    }
    for (const key of Object.keys(value)) {
      const found = findChunkRequirement(value[key], depth + 1, maxDepth);
      if (found) return found;
    }
    return null;
  };

  try {
    const result = await runTool(req.params.op, req.body || {}, req);
    const enforceChunks = String(process.env.ACTION_ENFORCE_CHUNK_REQUIRED || "true").toLowerCase() !== "false";
    if (enforceChunks && !["get_cached_payload_chunk", "export_cached_payload"].includes(req.params.op)) {
      const chunk = findChunkRequirement(result);
      if (chunk?.payload_key) {
        return res.json({
          ok: false,
          error: "CHUNK_REQUIRED",
          code: "CHUNK_REQUIRED",
          details: {
            payload_key: chunk.payload_key,
            chunk_count: chunk.chunk_count,
            note: "Call get_cached_payload_chunk (or export_cached_payload) to retrieve remaining data.",
            partial: chunk.partial
          }
        });
      }
    }
    res.json(result);
  } catch (e) {
    // Return 200 for tool errors so ChatGPT doesn't show "connector failed"
    res.json({
      ok: false,
      error: e?.message || String(e),
      code: e?.code || "SERVER_ERROR",
      details: e?.details || { url: e?.url || null, status: e?.status || null, data: e?.data || null },
    });
  }
});

/* ================= Debug REST (optional) ================= */
/* ================= Debug REST (optional) ================= */
app.get("/projects", async (req, res) => {
  try {
    const ctx = await requireBasecampContext(req);
    // paginate true to fetch all pages (fixes the "only 15" issue)
    const data = await basecampFetch(ctx.token, `/${ctx.accountId}/projects.json`, {
      accountId: ctx.accountId,
      paginate: true,
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, url: e.url, data: e.data });
  }
});

app.get("/projects/:projectId", async (req, res) => {
  try {
    const ctx = await requireBasecampContext(req);
    const data = await basecampFetch(
      ctx.token,
      `/${ctx.accountId}/projects/${req.params.projectId}.json`,
      { accountId: ctx.accountId }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, url: e.url, data: e.data });
  }
});

/* ================= MCP ================= */
app.post("/mcp", async (req, res) => {
  try {
    const method = req.body?.method;
    const toolName = req.body?.params?.name;
    
    if ([
      "initialize",
      "tools/list",
      "notifications/initialized",
      "ping",
      "logging/setLevel",
      "resources/list",
      "resources/read",
      "prompts/list",
      "prompts/get"
    ].includes(method)) {
      // For unprotected methods, still resolve API key to token if it exists
      const apiKey = extractApiKey(req);
      const resolvedCtx = await resolveRequestContext(req, { apiKey });
      const ctx = {
        TOKEN: resolvedCtx.token,
        accountId: null,
        ua: UA,
        userKey: resolvedCtx.userKey,
        apiKey: apiKey,
        authAccounts: resolvedCtx.auth?.accounts || [],
        startStatus: async () => await startStatus(req),
        basecampFetch: resolvedCtx.token?.access_token 
          ? async (path, opts = {}) => basecampFetchCore(resolvedCtx.token, path, { ...opts, ua: UA, accountId: null })
          : async () => {
              const err = new Error("NOT_AUTHENTICATED");
              err.code = "NOT_AUTHENTICATED";
              throw err;
            },
        basecampFetchAll: resolvedCtx.token?.access_token
          ? async (path, opts = {}) => basecampFetchAllCore(resolvedCtx.token, path, { ...opts, ua: UA, accountId: null })
          : async () => {
              const err = new Error("NOT_AUTHENTICATED");
              err.code = "NOT_AUTHENTICATED";
              throw err;
            },
      };
      const out = await handleMCP(req.body, ctx);
      return res.json(out);
    }

    // FLOW TOOLS: Can work with just API key (no Basecamp auth required)
    if (method === "tools/call" && toolName && toolName.startsWith("flow_")) {
      const apiKey = extractApiKey(req);
      const resolvedCtx = await resolveRequestContext(req, { apiKey });
      
      const ctx = {
        TOKEN: resolvedCtx.token,
        accountId: null,
        ua: UA,
        userKey: resolvedCtx.userKey,
        apiKey: apiKey,
        authAccounts: resolvedCtx.auth?.accounts || [],
        startStatus: async () => await startStatus(req),
        basecampFetch: async () => {
          const err = new Error("NOT_AUTHENTICATED");
          err.code = "NOT_AUTHENTICATED";
          throw err;
        },
        basecampFetchAll: async () => {
          const err = new Error("NOT_AUTHENTICATED");
          err.code = "NOT_AUTHENTICATED";
          throw err;
        },
      };
      const out = await handleMCP(req.body, ctx);
      return res.json(out);
    }

    const ctx = await buildMcpCtx(req);
    const out = await handleMCP(req.body, ctx);
    res.json(out);
  } catch (e) {
    res.json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: { code: e.code || "ERROR", message: e.message },
    });
  }
});

/* ================= DEV HOMEPAGE FOR LOCAL TESTING ================= */
app.get("/dev", (req, res) => {
  res.sendFile(path.join(__dirname, "dev.html"));
});

app.post("/dev/api", async (req, res) => {
  try {
    const { name, args } = req.body || {};
    if (!name) return res.status(400).json({ error: "Missing tool name" });
    const result = await runTool(name, args, req);
    try {
      const ctx = await resolveRequestContext(req);
      await setToolCache(name, args || {}, result, { userKey: ctx.userKey });
    } catch (e) {
      console.error(`[dev/api] cache error for ${name}:`, e?.message || e);
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e), code: e?.code || "SERVER_ERROR", details: e?.details || null });
  }
});

app.get("/dev/mine/status", async (req, res) => {
  const ctx = await resolveRequestContext(req);
  res.json({
    running: MINER_RUNNING,
    last_started_at: MINER_LAST_STARTED_AT,
    last_result: MINER_LAST_RESULT,
    user_key: ctx.userKey || null,
    api_key: ctx.apiKey || null,
    index_stats: await getIndexStats({ userKey: ctx.userKey }),
    entity_stats: await getEntityStats({ userKey: ctx.userKey }),
    tool_cache_stats: await getToolCacheStats({ userKey: ctx.userKey }),
  });
});

app.post("/dev/mine/run", async (req, res) => {
  const ctx = await resolveRequestContext(req);
  const result = await runMiningJob({ force: true, apiKey: ctx.apiKey, userKey: ctx.userKey });
  res.json(result);
});

app.get("/dev/mine/entities", async (req, res) => {
  const { type, project_id, limit } = req.query || {};
  if (!type) return res.status(400).json({ error: "Missing type" });
  const ctx = await resolveRequestContext(req);
  const items = await listEntityCache(type, {
    projectId: project_id ? Number(project_id) : null,
    limit: limit ? Number(limit) : 200,
    userKey: ctx.userKey,
  });
  res.json({ type, count: items.length, items });
});

app.get("/dev/mine/search", async (req, res) => {
  const { q, type, project_id, limit } = req.query || {};
  if (!q) return res.status(400).json({ error: "Missing q" });
  const ctx = await resolveRequestContext(req);
  const items = await searchIndex(String(q), {
    type: type || undefined,
    projectId: project_id ? Number(project_id) : undefined,
    limit: limit ? Number(limit) : 100,
    userKey: ctx.userKey,
  });
  res.json({ query: q, count: items.length, items });
});

app.get("/dev/cache/tool", async (req, res) => {
  const { name, limit } = req.query || {};
  if (!name) return res.status(400).json({ error: "Missing name" });
  const ctx = await resolveRequestContext(req);
  const items = await listToolCache(String(name), { limit: limit ? Number(limit) : 20, userKey: ctx.userKey });
  res.json({ name, count: items.length, items });
});

/* ================= Database Info ================= */
app.get("/db/info", async (req, res) => {
  try {
    const ctx = await resolveRequestContext(req);
    const indexStats = await getIndexStats({ userKey: ctx.userKey });
    res.json({
      status: "ok",
      database: {
        authenticated: !!ctx.token?.access_token,
        auth_cached: !!ctx.auth,
        index_stats: indexStats,
        user_key: ctx.userKey || null,
        api_key: ctx.apiKey || null,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

let server = null;
if (ACTIVEPIECES_PROXY_ACTIVE) {
  const activepiecesProxy = httpProxy.createProxyServer({
    target: ACTIVEPIECES_PROXY_TARGET,
    ws: true,
    changeOrigin: true,
    xfwd: true,
  });

  activepiecesProxy.on("error", (err, req, res) => {
    console.error(`[activepieces proxy] ${err?.message || err}`);
    if (res?.writeHead && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    if (res?.end) {
      res.end(JSON.stringify({ ok: false, error: "ACTIVEPIECES_PROXY_ERROR" }));
    } else {
      try {
        res?.destroy?.();
      } catch {
        // ignore
      }
    }
  });

  const isActivepiecesHost = (req) => {
    const host = String(req?.headers?.host || "").toLowerCase();
    const hostname = host.split(":")[0];
    return hostname === ACTIVEPIECES_PROXY_HOST;
  };

  server = http.createServer((req, res) => {
    if (isActivepiecesHost(req)) {
      return activepiecesProxy.web(req, res);
    }
    return app(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    if (isActivepiecesHost(req)) {
      activepiecesProxy.ws(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  console.log(`[Startup] activepieces proxy enabled for ${ACTIVEPIECES_PROXY_HOST} -> ${ACTIVEPIECES_PROXY_TARGET}`);
} else {
  server = http.createServer(app);
}

server.listen(PORT, () => console.log(`${UA} running on ${PORT}`));

const minerIntervalMs = Number(process.env.MINER_INTERVAL_MS || 900000);
setInterval(() => {
  runMiningJob().catch(() => {});
}, minerIntervalMs);
