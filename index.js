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
  getToken,
  setToken,
  clearToken,
  getAuthCache,
  setAuthCache,
  clearAuthCache,
  getUserToken,
  setUserToken,
  clearUserToken,
  getUserAuthCache,
  setUserAuthCache,
  clearUserAuthCache,
  createSession,
  bindSession,
  getSessionUser,
  getIndexStats,
  getEntityStats,
  getToolCacheStats,
  listEntityCache,
  searchIndex,
  setToolCache,
  listToolCache,
} from "./db.js";
import { runMining } from "./miner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;
const UA = "bcgpt-full-v3";
const BASECAMP_API = "https://3.basecampapi.com";
const DEFAULT_ACCOUNT_ID = process.env.BASECAMP_DEFAULT_ACCOUNT_ID || null;
const N8N_PROXY_HOST = String(process.env.N8N_PROXY_HOST || "").trim().toLowerCase();
const N8N_PROXY_TARGET = process.env.N8N_PROXY_TARGET || "http://127.0.0.1:5678";
const N8N_PROXY_ENABLED =
  String(process.env.N8N_PROXY_ENABLED || "").toLowerCase() === "true" || Boolean(N8N_PROXY_HOST);
const N8N_PROXY_ACTIVE = N8N_PROXY_ENABLED && Boolean(N8N_PROXY_HOST);

// Log the account ID being used on startup
console.log(`[Startup] DEFAULT_ACCOUNT_ID from env: ${DEFAULT_ACCOUNT_ID}`);

let MINER_RUNNING = false;
let MINER_LAST_RESULT = null;
let MINER_LAST_STARTED_AT = null;

// Load legacy token from database on startup, fallback to environment
const legacyToken = getToken();
if (!legacyToken && process.env.BASECAMP_TOKEN) {
  try {
    const parsed = JSON.parse(process.env.BASECAMP_TOKEN);
    setToken(parsed);
    console.log(`[Startup] Loaded legacy token from BASECAMP_TOKEN env var and saved to database`);
  } catch (e) {
    console.error(`[Startup] Failed to parse BASECAMP_TOKEN from env:`, e.message);
  }
} else if (legacyToken) {
  console.log(`[Startup] Loaded legacy token from database`);
}

const legacyAuth = getAuthCache();
if (legacyAuth) {
  console.log(`[Startup] Loaded legacy auth cache from database`);
}

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

function extractSessionKey(req) {
  return normalizeKey(
    getHeaderValue(req, "x-bcgpt-session") ||
      getHeaderValue(req, "x-session-key") ||
      req?.body?.session_key ||
      req?.query?.session_key ||
      req?.query?.sessionKey
  );
}

function extractUserKey(req) {
  return normalizeKey(
    getHeaderValue(req, "x-bcgpt-user") ||
      getHeaderValue(req, "x-user-key") ||
      req?.body?.user_key ||
      req?.query?.user_key
  );
}

async function resolveRequestContext(req, { sessionKey: forcedSessionKey, userKey: forcedUserKey } = {}) {
  const sessionKey = normalizeKey(forcedSessionKey || extractSessionKey(req));
  const explicitUserKey = normalizeKey(forcedUserKey || extractUserKey(req));

  if (sessionKey) {
    createSession(sessionKey);
  }

  const sessionUserKey = sessionKey ? getSessionUser(sessionKey) : null;
  let userKey = sessionUserKey || explicitUserKey || null;
  const isLegacyContext = !sessionKey && !explicitUserKey;

  let token = null;
  let auth = null;

  if (userKey) {
    token = getUserToken(userKey);
    auth = getUserAuthCache(userKey);
  } else if (isLegacyContext) {
    token = getToken();
    auth = getAuthCache();
    userKey = auth?.user_key || deriveUserKey(auth) || token?.user_key || null;
  }

  return {
    sessionKey,
    explicitUserKey,
    userKey,
    isLegacyContext,
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

async function ensureAuthorization({ token, userKey, sessionKey, isLegacyContext, force = false }) {
  if (!token?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }

  const useLegacy = Boolean(isLegacyContext) && !userKey && !sessionKey;

  if (!force) {
    if (userKey) {
      const cached = getUserAuthCache(userKey);
      if (cached) return { auth: cached, userKey };
    } else if (useLegacy) {
      const cached = getAuthCache();
      if (cached) {
        const derived = cached.user_key || deriveUserKey(cached);
        return { auth: cached, userKey: derived || null };
      }
    }
  }

  const auth = await fetchAuthorization(token);
  let derivedUserKey = userKey || deriveUserKey(auth);
  if (!derivedUserKey && sessionKey) {
    derivedUserKey = `session:${sessionKey}`;
  }

  if (derivedUserKey) {
    if (useLegacy) {
      setAuthCache(auth, derivedUserKey);
      setToken(token, derivedUserKey);
    } else {
      setUserAuthCache(auth, derivedUserKey);
      setUserToken(token, derivedUserKey);
    }
    if (sessionKey) {
      bindSession(sessionKey, derivedUserKey);
    }
  }

  return { auth, userKey: derivedUserKey };
}

function pickAccountId(auth) {
  if (!auth?.accounts?.length) {
    const err = new Error("NO_ACCOUNTS");
    err.code = "NO_ACCOUNTS";
    throw err;
  }

  if (DEFAULT_ACCOUNT_ID) {
    console.log(`[getAccountId] Using DEFAULT_ACCOUNT_ID: ${DEFAULT_ACCOUNT_ID}`);
    const match = (auth.accounts || []).find((a) => String(a.id) === String(DEFAULT_ACCOUNT_ID));
    if (!match) {
      console.error(`[getAccountId] DEFAULT_ACCOUNT_ID not found. Available accounts:`, auth.accounts?.map((a) => a.id));
      const err = new Error(
        `BASECAMP_DEFAULT_ACCOUNT_ID (${DEFAULT_ACCOUNT_ID}) not found in authorized accounts`
      );
      err.code = "DEFAULT_ACCOUNT_NOT_FOUND";
      throw err;
    }
    console.log(`[getAccountId] Matched account: ${match.id}`);
    return match.id;
  }

  console.log(`[getAccountId] Using first account: ${auth.accounts[0].id}`);
  return auth.accounts[0].id;
}

async function requireBasecampContext(req, { sessionKey: forcedSessionKey, forceAuth = false } = {}) {
  const ctx = await resolveRequestContext(req, { sessionKey: forcedSessionKey });
  if (!ctx.token?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }

  const authResult = await ensureAuthorization({
    token: ctx.token,
    userKey: ctx.userKey,
    sessionKey: ctx.sessionKey,
    isLegacyContext: ctx.isLegacyContext,
    force: forceAuth,
  });

  const accountId = pickAccountId(authResult.auth);

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
async function startStatus(req, { sessionKey: forcedSessionKey } = {}) {
  const incomingSession = normalizeKey(forcedSessionKey || extractSessionKey(req));
  const sessionKey = incomingSession || createSession();

  if (incomingSession) {
    createSession(incomingSession);
  }

  const base = originBase(req);
  const stateParam = sessionKey ? `?state=${encodeURIComponent(sessionKey)}` : "";
  const reauth_url = `${base}/auth/basecamp/start${stateParam}`;
  const logout_url = `${base}/logout`;

  const ctx = await resolveRequestContext(req, { sessionKey });
  if (!ctx.token?.access_token) {
    return {
      connected: false,
      user: null,
      user_key: ctx.userKey || null,
      session_key: sessionKey,
      reauth_url,
      logout_url,
      message: "Not connected. Use the auth link to connect Basecamp.",
    };
  }

  try {
    const authResult = await ensureAuthorization({
      token: ctx.token,
      userKey: ctx.userKey,
      sessionKey,
      isLegacyContext: ctx.isLegacyContext,
      force: true,
    });
    return {
      connected: true,
      user: {
        name: authResult.auth.identity?.name || null,
        email: authResult.auth.identity?.email_address || null,
      },
      user_key: authResult.userKey || ctx.userKey,
      session_key: sessionKey,
      reauth_url,
      logout_url,
      message: "Connected. Not you? Use the auth link to re-login.",
    };
  } catch {
    return {
      connected: false,
      user: null,
      user_key: ctx.userKey || null,
      session_key: sessionKey,
      reauth_url,
      logout_url,
      message: "Token exists but authorization could not be loaded. Re-auth required.",
    };
  }
}

async function runMiningJob({ force = false, sessionKey = null, userKey = null } = {}) {
  if (MINER_RUNNING) return { ok: false, message: "Miner already running." };
  MINER_RUNNING = true;
  MINER_LAST_STARTED_AT = new Date().toISOString();
  try {
    const ctx = await resolveRequestContext(null, { sessionKey, userKey });
    if (!ctx.token?.access_token) return { ok: false, message: "Not authenticated." };

    const authResult = await ensureAuthorization({
      token: ctx.token,
      userKey: ctx.userKey,
      sessionKey: ctx.sessionKey,
      isLegacyContext: ctx.isLegacyContext,
      force: false,
    });
    const accountId = pickAccountId(authResult.auth);
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

async function buildMcpCtx(req) {
  const ctx = await resolveRequestContext(req);
  let auth = ctx.auth;
  let userKey = ctx.userKey;
  let accountId = null;

  if (ctx.token?.access_token) {
    const authResult = await ensureAuthorization({
      token: ctx.token,
      userKey: ctx.userKey,
      sessionKey: ctx.sessionKey,
      isLegacyContext: ctx.isLegacyContext,
      force: false,
    });
    auth = authResult.auth;
    userKey = authResult.userKey || userKey;
    accountId = pickAccountId(auth);
  }

  console.log(`[buildMcpCtx] accountId retrieved: ${accountId} (type: ${typeof accountId})`);

  return {
    TOKEN: ctx.token,
    accountId,
    ua: UA,
    userKey,
    sessionKey: ctx.sessionKey,
    authAccounts: auth?.accounts || [],
    startStatus: async () => await startStatus(req, { sessionKey: ctx.sessionKey }),

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

/* ================= OpenAPI Schema ================= */
app.get("/.well-known/openapi.json", (req, res) => {
  res.sendFile(path.join(__dirname, "openapi.json"));
});

app.get("/openapi.json", (req, res) => {
  res.sendFile(path.join(__dirname, "openapi.json"));
});

/* ================= OAuth ================= */
app.get("/auth/basecamp/start", (req, res) => {
  const base = originBase(req);
  const redirectUri = `${base}/auth/basecamp/callback`;
  const state = normalizeKey(req.query.state || req.query.session_key || req.query.sessionKey || extractSessionKey(req));
  if (state) {
    createSession(state);
  }

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
    const sessionKey = normalizeKey(req.query.state || req.query.session_key || req.query.sessionKey);

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
    let derivedUserKey = deriveUserKey(auth);
    if (!derivedUserKey && sessionKey) {
      derivedUserKey = `session:${sessionKey}`;
    }

    if (sessionKey) {
      if (!derivedUserKey) {
        throw new Error("USER_KEY_REQUIRED");
      }
      setUserToken(token, derivedUserKey);
      setUserAuthCache(auth, derivedUserKey);
      bindSession(sessionKey, derivedUserKey);
    } else {
      const legacyKey = derivedUserKey || "legacy";
      setToken(token, legacyKey);
      setAuthCache(auth, legacyKey);
    }

    res.send("✅ Basecamp connected. Return to ChatGPT and run /startbcgpt.");
  } catch (e) {
    res.status(500).send(`❌ OAuth failed: ${e?.message || e}`);
  }
});

app.get("/startbcgpt", async (req, res) => res.json(await startStatus(req)));

app.post("/logout", async (req, res) => {
  const ctx = await resolveRequestContext(req);
  if (ctx.userKey) {
    clearUserToken(ctx.userKey);
    clearUserAuthCache(ctx.userKey);
  } else if (ctx.isLegacyContext) {
    clearToken();
    clearAuthCache();
  }
  res.json({ ok: true, connected: false, session_key: ctx.sessionKey || null, message: "Logged out." });
});

/* ================= Actions ================= */
app.post("/action/startbcgpt", async (req, res) => {
  res.json(await startStatus(req));
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
    if (method === "initialize" || method === "tools/list" || method === "notifications/initialized") {
      const ctx = {
        TOKEN: null,
        accountId: null,
        ua: UA,
        userKey: null,
        sessionKey: extractSessionKey(req),
        authAccounts: [],
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
      setToolCache(name, args || {}, result, { userKey: ctx.userKey });
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
    session_key: ctx.sessionKey || null,
    index_stats: getIndexStats({ userKey: ctx.userKey }),
    entity_stats: getEntityStats({ userKey: ctx.userKey }),
    tool_cache_stats: getToolCacheStats({ userKey: ctx.userKey }),
  });
});

app.post("/dev/mine/run", async (req, res) => {
  const ctx = await resolveRequestContext(req);
  const result = await runMiningJob({ force: true, sessionKey: ctx.sessionKey, userKey: ctx.userKey });
  res.json(result);
});

app.get("/dev/mine/entities", async (req, res) => {
  const { type, project_id, limit } = req.query || {};
  if (!type) return res.status(400).json({ error: "Missing type" });
  const ctx = await resolveRequestContext(req);
  const items = listEntityCache(type, {
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
  const items = searchIndex(String(q), {
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
  const items = listToolCache(String(name), { limit: limit ? Number(limit) : 20, userKey: ctx.userKey });
  res.json({ name, count: items.length, items });
});

/* ================= Database Info ================= */
app.get("/db/info", async (req, res) => {
  try {
    const ctx = await resolveRequestContext(req);
    const indexStats = getIndexStats({ userKey: ctx.userKey });
    res.json({
      status: "ok",
      database: {
        authenticated: !!ctx.token?.access_token,
        auth_cached: !!ctx.auth,
        index_stats: indexStats,
        user_key: ctx.userKey || null,
        session_key: ctx.sessionKey || null,
        legacy_context: ctx.isLegacyContext,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

let server = null;
if (N8N_PROXY_ACTIVE) {
  const n8nProxy = httpProxy.createProxyServer({
    target: N8N_PROXY_TARGET,
    ws: true,
    changeOrigin: true,
    xfwd: true,
  });

  n8nProxy.on("error", (err, req, res) => {
    console.error(`[n8n proxy] ${err?.message || err}`);
    if (res?.writeHead && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    if (res?.end) {
      res.end(JSON.stringify({ ok: false, error: "N8N_PROXY_ERROR" }));
    } else {
      try {
        res?.destroy?.();
      } catch {
        // ignore
      }
    }
  });

  const isN8nHost = (req) => {
    const host = String(req?.headers?.host || "").toLowerCase();
    const hostname = host.split(":")[0];
    return hostname === N8N_PROXY_HOST;
  };

  server = http.createServer((req, res) => {
    if (isN8nHost(req)) {
      return n8nProxy.web(req, res);
    }
    return app(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    if (isN8nHost(req)) {
      n8nProxy.ws(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  console.log(`[Startup] n8n proxy enabled for ${N8N_PROXY_HOST} -> ${N8N_PROXY_TARGET}`);
} else {
  server = http.createServer(app);
}

server.listen(PORT, () => console.log(`${UA} running on ${PORT}`));

const minerIntervalMs = Number(process.env.MINER_INTERVAL_MS || 900000);
setInterval(() => {
  runMiningJob().catch(() => {});
}, minerIntervalMs);
