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
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ACTIVEPIECES_API_KEY}`,
      ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Activepieces API error (${response.status}): ${text}`);
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

    case 'flow_update':
      if (!args.flow_id) throw new Error('flow_id required');
      const { flow_id, ...updateData } = args;
      return await apiFetch(`flows/${flow_id}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData)
      });

    case 'flow_delete':
      if (!args.flow_id) throw new Error('flow_id required');
      return await apiFetch(`flows/${args.flow_id}`, { method: 'DELETE' });

    case 'flow_trigger':
      if (!args.flow_id) throw new Error('flow_id required');
      return await apiFetch(`flows/${args.flow_id}/trigger`, {
        method: 'POST',
        body: JSON.stringify(args.payload || {})
      });

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
