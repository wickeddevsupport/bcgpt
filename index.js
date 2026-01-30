// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

import { handleMCP } from "./mcp.js";

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

// Log the account ID being used on startup
console.log(`[Startup] DEFAULT_ACCOUNT_ID from env: ${DEFAULT_ACCOUNT_ID}`);

let TOKEN = null;      // single-user token
let AUTH_CACHE = null; // cached authorization.json

// Try to load TOKEN from environment on startup
if (process.env.BASECAMP_TOKEN) {
  try {
    TOKEN = JSON.parse(process.env.BASECAMP_TOKEN);
    console.log(`[Startup] Loaded TOKEN from BASECAMP_TOKEN env var`);
  } catch (e) {
    console.error(`[Startup] Failed to parse BASECAMP_TOKEN from env:`, e.message);
  }
}

function originBase(req) {
  const inferred = `${req.protocol}://${req.get("host")}`;
  return process.env.APP_BASE_URL || inferred;
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
async function getAuthorization(force = false) {
  if (!TOKEN?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }
  if (AUTH_CACHE && !force) return AUTH_CACHE;

  const r = await fetch("https://launchpad.37signals.com/authorization.json", {
    headers: { Authorization: `Bearer ${TOKEN.access_token}`, "User-Agent": UA },
  });

  if (!r.ok) {
    const err = new Error("AUTHORIZATION_FAILED");
    err.code = "AUTHORIZATION_FAILED";
    err.status = r.status;
    throw err;
  }

  AUTH_CACHE = await r.json();
  return AUTH_CACHE;
}

async function getAccountId() {
  const auth = await getAuthorization();

  if (DEFAULT_ACCOUNT_ID) {
    console.log(`[getAccountId] Using DEFAULT_ACCOUNT_ID: ${DEFAULT_ACCOUNT_ID}`);
    const match = (auth.accounts || []).find((a) => String(a.id) === String(DEFAULT_ACCOUNT_ID));
    if (!match) {
      console.error(`[getAccountId] DEFAULT_ACCOUNT_ID not found. Available accounts:`, auth.accounts?.map(a => a.id));
      const err = new Error(
        `BASECAMP_DEFAULT_ACCOUNT_ID (${DEFAULT_ACCOUNT_ID}) not found in authorized accounts`
      );
      err.code = "DEFAULT_ACCOUNT_NOT_FOUND";
      throw err;
    }
    console.log(`[getAccountId] Matched account: ${match.id}`);
    return match.id;
  }

  if (!auth.accounts?.length) {
    const err = new Error("NO_ACCOUNTS");
    err.code = "NO_ACCOUNTS";
    throw err;
  }

  console.log(`[getAccountId] Using first account: ${auth.accounts[0].id}`);
  return auth.accounts[0].id;
}

async function startStatus(req) {
  const base = originBase(req);
  const reauth_url = `${base}/auth/basecamp/start`;
  const logout_url = `${base}/logout`;

  if (!TOKEN?.access_token) {
    return {
      connected: false,
      user: null,
      reauth_url,
      logout_url,
      message: "Not connected. Use the auth link to connect Basecamp.",
    };
  }

  try {
    const auth = await getAuthorization(true);
    return {
      connected: true,
      user: { name: auth.identity?.name || null, email: auth.identity?.email_address || null },
      reauth_url,
      logout_url,
      message: "Connected. Not you? Use the auth link to re-login.",
    };
  } catch {
    return {
      connected: false,
      user: null,
      reauth_url,
      logout_url,
      message: "Token exists but authorization could not be loaded. Re-auth required.",
    };
  }
}

async function buildMcpCtx(req) {
  const auth = TOKEN?.access_token ? await getAuthorization() : null;
  const accountId = TOKEN?.access_token ? await getAccountId() : null;
  
  console.log(`[buildMcpCtx] accountId retrieved: ${accountId} (type: ${typeof accountId})`);

  return {
    TOKEN,
    accountId,
    ua: UA,
    authAccounts: auth?.accounts || [],
    startStatus: async () => await startStatus(req),

    // ✅ Provide both single-request AND auto-paginated versions to MCP
    basecampFetch: async (path, opts = {}) =>
      basecampFetch(TOKEN, path, { ...opts, ua: UA, accountId, paginate: false }),

    basecampFetchAll: async (path, opts = {}) =>
      basecampFetch(TOKEN, path, {
        ...opts,
        ua: UA,
        accountId,
        paginate: true,
        // allow overrides, but keep sane defaults to avoid 429s
        maxPages: opts.maxPages ?? 50,
        pageDelayMs: opts.pageDelayMs ?? 150,
      }),
  };
}

async function runTool(op, params, req) {
  const ctx = await buildMcpCtx(req);

  const rpc = {
    jsonrpc: "2.0",
    id: `action-${op}`,
    method: "tools/call",
    params: { name: op, arguments: params || {} },
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
app.get("/health", (req, res) => res.json({ ok: true, build: UA }));

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

  const url =
    `https://launchpad.37signals.com/authorization/new` +
    `?type=web_server` +
    `&client_id=${process.env.BASECAMP_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(url);
});

app.get("/auth/basecamp/callback", async (req, res) => {
  try {
    const base = originBase(req);
    const redirectUri = `${base}/auth/basecamp/callback`;

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

    TOKEN = await r.json();
    AUTH_CACHE = null;

    res.send("✅ Basecamp connected. Return to ChatGPT and run /startbcgpt.");
  } catch (e) {
    res.status(500).send(`❌ OAuth failed: ${e?.message || e}`);
  }
});

app.get("/startbcgpt", async (req, res) => res.json(await startStatus(req)));

app.post("/logout", (req, res) => {
  TOKEN = null;
  AUTH_CACHE = null;
  res.json({ ok: true, connected: false, message: "Logged out." });
});

/* ================= Actions ================= */
app.post("/action/startbcgpt", async (req, res) => {
  res.json(await startStatus(req));
});

app.post("/action/:op", async (req, res) => {
  if (req.params.op === "startbcgpt") {
    return res.status(404).json({ ok: false, error: "Use /action/startbcgpt", code: "BAD_ROUTE" });
  }

  try {
    const result = await runTool(req.params.op, req.body || {}, req);
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
app.get("/projects", async (req, res) => {
  try {
    const accountId = await getAccountId();
    // ✅ paginate true to fetch all pages (fixes the "only 15" issue)
    const data = await basecampFetch(TOKEN, `/${accountId}/projects.json`, { accountId, paginate: true });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, url: e.url, data: e.data });
  }
});

app.get("/projects/:projectId", async (req, res) => {
  try {
    const accountId = await getAccountId();
    const data = await basecampFetch(TOKEN, `/${accountId}/projects/${req.params.projectId}.json`, { accountId });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, url: e.url, data: e.data });
  }
});

/* ================= MCP ================= */
app.post("/mcp", async (req, res) => {
  try {
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
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e), code: e?.code || "SERVER_ERROR", details: e?.details || null });
  }
});

app.listen(PORT, () => console.log(`${UA} running on ${PORT}`));
