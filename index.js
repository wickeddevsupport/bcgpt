import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

import { handleMCP } from "./mcp.js";

dotenv.config();

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;
const UA = "bcgpt-full-v3";
const BASECAMP_API = "https://3.basecampapi.com";
const DEFAULT_ACCOUNT_ID = process.env.BASECAMP_DEFAULT_ACCOUNT_ID || null;

let TOKEN = null;       // single-user token
let AUTH_CACHE = null;  // cached authorization.json

function originBase(req) {
  const inferred = `${req.protocol}://${req.get("host")}`;
  return process.env.APP_BASE_URL || inferred;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Normalize Basecamp paths:
 * - Ensure leading slash
 * - Ensure account-scoped endpoints include /3/<accountId>/...
 * - Allow passing full URLs as well
 */
function normalizeBasecampUrl(path, accountId) {
  if (!path) throw new Error("Missing Basecamp path");
  // Full URL passthrough
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  let p = path.startsWith("/") ? path : `/${path}`;

  // If already correct: /3/<accountId>/...
  if (/^\/3\/\d+\//.test(p)) return `${BASECAMP_API}${p}`;

  // If starts with /<digits>/... it is account-scoped but missing /3
  // e.g. /123456/projects.json  -> /3/123456/projects.json
  if (/^\/\d+\//.test(p)) return `${BASECAMP_API}/3${p}`;

  // If caller used /projects.json etc, that’s ambiguous; require accountId for those
  // We'll leave it alone, but this is usually a bug.
  if (accountId && p.startsWith("/projects")) {
    return `${BASECAMP_API}/3/${accountId}${p}`;
  }

  // For bucket-scoped endpoints Basecamp uses /buckets/<bucketId>/...
  // Those are correct as-is (not under /3/<accountId>).
  // Example: /buckets/999/todolists.json
  return `${BASECAMP_API}${p}`;
}

/**
 * Hardened Basecamp fetch:
 * - timeouts
 * - retry/backoff
 * - better errors
 */
async function basecampFetch(token, path, opts = {}) {
  const {
    method = "GET",
    body = undefined,
    ua = UA,
    accountId = null,
    timeoutMs = 15000,
    retries = 2
  } = opts;

  if (!token?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }

  const url = normalizeBasecampUrl(path, accountId);

  const headers = {
    "User-Agent": ua,
    "Authorization": `Bearer ${token.access_token}`,
    "Accept": "application/json"
  };

  let payload = undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let attempt = 0;
  let lastErr = null;

  while (attempt <= retries) {
    attempt += 1;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const r = await fetch(url, {
        method,
        headers,
        body: payload,
        signal: controller.signal
      });

      clearTimeout(t);

      // Retryable statuses
      if ([429, 502, 503, 504].includes(r.status) && attempt <= retries) {
        const retryAfter = Number(r.headers.get("retry-after") || "0");
        const backoff = retryAfter > 0 ? retryAfter * 1000 : 400 * attempt * attempt;
        await sleep(backoff);
        continue;
      }

      // Parse JSON if possible (Basecamp usually returns JSON)
      let data = null;
      const text = await r.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }

      if (!r.ok) {
        const err = new Error(`Basecamp API error (${r.status})`);
        err.code = "BASECAMP_API_ERROR";
        err.status = r.status;
        err.data = data;
        err.url = url;
        throw err;
      }

      return data;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;

      // AbortError retry
      if ((e?.name === "AbortError") && attempt <= retries) {
        await sleep(250 * attempt);
        continue;
      }

      throw e;
    }
  }

  throw lastErr || new Error("BASECAMP_REQUEST_FAILED");
}

/**
 * Launchpad auth
 */
async function getAuthorization(force = false) {
  if (!TOKEN?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }
  if (AUTH_CACHE && !force) return AUTH_CACHE;

  const r = await fetch("https://launchpad.37signals.com/authorization.json", {
    headers: { Authorization: `Bearer ${TOKEN.access_token}`, "User-Agent": UA }
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
    const match = (auth.accounts || []).find(a => String(a.id) === String(DEFAULT_ACCOUNT_ID));
    if (!match) {
      const err = new Error(`BASECAMP_DEFAULT_ACCOUNT_ID (${DEFAULT_ACCOUNT_ID}) not found in authorized accounts`);
      err.code = "DEFAULT_ACCOUNT_NOT_FOUND";
      throw err;
    }
    return match.id;
  }

  if (!auth.accounts?.length) {
    const err = new Error("NO_ACCOUNTS");
    err.code = "NO_ACCOUNTS";
    throw err;
  }

  return auth.accounts[0].id;
}

/**
 * Always returns auth link, never throws outward.
 * Uses snake_case keys to match Actions schema.
 */
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
      message: "Not connected. Use the auth link to connect Basecamp."
    };
  }

  try {
    const auth = await getAuthorization(true);
    const name =
      auth.identity?.name ||
      `${auth.identity?.first_name || ""} ${auth.identity?.last_name || ""}`.trim() ||
      null;

    return {
      connected: true,
      user: { name, email: auth.identity?.email_address || null },
      reauth_url,
      logout_url,
      message: "Connected. Not you? Use the auth link to re-login."
    };
  } catch {
    return {
      connected: false,
      user: null,
      reauth_url,
      logout_url,
      message: "Token exists but authorization could not be loaded. Re-auth required."
    };
  }
}

/**
 * MCP ctx builder (shared by /mcp and /action tools)
 */
async function buildMcpCtx(req) {
  // Only resolve auth/accounts if token exists
  const auth = TOKEN?.access_token ? await getAuthorization() : null;
  const accountId = TOKEN?.access_token ? await getAccountId() : null;

  return {
    TOKEN,
    accountId,
    ua: UA,
    authAccounts: auth?.accounts || [],
    startStatus: async () => await startStatus(req),
    // expose basecampFetch to MCP tools if your mcp.js uses it via ctx
    basecampFetch: async (path, opts = {}) =>
      basecampFetch(TOKEN, path, { ...opts, ua: UA, accountId })
  };
}

/**
 * Actions REST -> MCP tools bridge
 */
async function runTool(op, params, req) {
  const ctx = await buildMcpCtx(req);
  const rpc = {
    jsonrpc: "2.0",
    id: `action-${op}`,
    method: "tools/call",
    params: { name: op, arguments: params || {} }
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
        code: req.query.code
      })
    });

    const token = await r.json();
    TOKEN = token;
    AUTH_CACHE = null;

    res.send("✅ Basecamp connected. Return to ChatGPT and run /startbcgpt.");
  } catch (e) {
    res.status(500).send(`❌ OAuth failed: ${e?.message || e}`);
  }
});

app.get("/startbcgpt", async (req, res) => {
  res.json(await startStatus(req));
});

app.post("/logout", (req, res) => {
  TOKEN = null;
  AUTH_CACHE = null;
  res.json({ ok: true, connected: false, message: "Logged out." });
});

/* ================= Actions ================= */
/**
 * Must never fail: always gives auth link.
 */
app.post("/action/startbcgpt", async (req, res) => {
  res.json(await startStatus(req));
});

/**
 * Generic tool execution endpoint for Actions.
 * NOTE: For read operations, we return 200 with ok:false on predictable errors
 * to avoid "Error talking to connector" UX.
 */
app.post("/action/:op", async (req, res) => {
  if (req.params.op === "startbcgpt") {
    return res.status(404).json({ error: "Use /action/startbcgpt" });
  }

  try {
    const result = await runTool(req.params.op, req.body || {}, req);
    res.json(result);
  } catch (e) {
    // Return 200 for common tool errors so ChatGPT can render the message nicely
    const code = e?.code || "SERVER_ERROR";
    const payload = {
      ok: false,
      error: e?.message || String(e),
      code,
      details: e?.details || {
        url: e?.url || null,
        status: e?.status || null,
        data: e?.data || null
      }
    };

    // Still use 500 only for unexpected server failures (no code)
    if (!e?.code) return res.status(500).json(payload);
    return res.json(payload);
  }
});

/* ================= Minimal REST helpers (optional) ================= */
/**
 * These are still handy for manual debugging in browser/Postman.
 * They are fixed to use the correct /3/<accountId>/... paths.
 */
app.get("/accounts", async (req, res) => {
  try {
    const auth = await getAuthorization();
    res.json(auth.accounts);
  } catch (e) {
    res.status(401).json({ error: e.code || "ERROR", message: e.message });
  }
});

app.get("/projects", async (req, res) => {
  try {
    const accountId = await getAccountId();
    const data = await basecampFetch(TOKEN, `/${accountId}/projects.json`, { ua: UA, accountId });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, url: e.url, data: e.data });
  }
});

app.get("/projects/:projectId", async (req, res) => {
  try {
    const accountId = await getAccountId();
    // Correct Basecamp 3 project endpoint (account-scoped)
    const data = await basecampFetch(
      TOKEN,
      `/3/${accountId}/projects/${req.params.projectId}.json`,
      { ua: UA, accountId }
    );
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
      error: { code: e.code || "ERROR", message: e.message }
    });
  }
});

app.listen(PORT, () => console.log(`${UA} running on ${PORT}`));
