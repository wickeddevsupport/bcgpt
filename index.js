import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

import { basecampFetch } from "./basecamp.js";
import { handleMCP } from "./mcp.js";

dotenv.config();

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;
const UA = "bcgpt-full-v2";
const DEFAULT_ACCOUNT_ID = process.env.BASECAMP_DEFAULT_ACCOUNT_ID || null;

/**
 * Single-user memory
 */
let TOKEN = null;       // { access_token, ... }
let AUTH_CACHE = null;  // authorization.json cache

function originBase(req) {
  const inferred = `${req.protocol}://${req.get("host")}`;
  return process.env.APP_BASE_URL || inferred;
}

/**
 * Authorization object from Launchpad
 * https://launchpad.37signals.com/authorization.json
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
    const match = (auth.accounts || []).find(
      a => String(a.id) === String(DEFAULT_ACCOUNT_ID)
    );
    if (!match) {
      const err = new Error(
        `BASECAMP_DEFAULT_ACCOUNT_ID (${DEFAULT_ACCOUNT_ID}) not found in authorized accounts`
      );
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
 * /startbcgpt output should ALWAYS return an auth link,
 * even when not authenticated.
 *
 * IMPORTANT: use snake_case keys for Actions consistency.
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
  } catch (e) {
    // Token exists but identity fetch failed (expired/invalid)
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
 * Build ctx object for handleMCP, identical for /mcp and /action routes.
 */
async function buildMcpCtx(req) {
  const auth = TOKEN?.access_token ? await getAuthorization() : null;
  const accountId = TOKEN?.access_token ? await getAccountId() : null;

  return {
    TOKEN,
    accountId,
    ua: UA,
    authAccounts: auth?.accounts || [],
    startStatus: async () => await startStatus(req)
  };
}

/**
 * REST -> MCP Tools bridge for Actions
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

/* ================= Tier 0 ================= */
app.get("/health", (req, res) => res.json({ ok: true }));

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

/* ================= Actions endpoints ================= */
/**
 * startbcgpt must never throw NOT_AUTHENTICATED.
 * Always return reauth_url.
 */
app.post("/action/startbcgpt", async (req, res) => {
  res.json(await startStatus(req));
});

/**
 * Generic action executor:
 * POST /action/<operationId>
 */
app.post("/action/:op", async (req, res) => {
  if (req.params.op === "startbcgpt") {
    // handled above; never hang
    return res.status(404).json({ error: "Use /action/startbcgpt" });
  }

  try {
    const result = await runTool(req.params.op, req.body || {}, req);
    res.json(result);
  } catch (e) {
    res.status(500).json({
      error: e?.message || String(e),
      code: e?.code || "SERVER_ERROR",
      details: e?.details || null
    });
  }
});

/* ================= Tier 1 ================= */
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
    const data = await basecampFetch(TOKEN, `/${accountId}/projects.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.get("/projects/:projectId", async (req, res) => {
  try {
    const accountId = await getAccountId();
    const data = await basecampFetch(TOKEN, `/projects/${req.params.projectId}.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.get("/projects/:projectId/people", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/people.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

/* ================= Tier 2 ================= */
app.get("/projects/:projectId/todolists", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/todolists.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.get("/projects/:projectId/todolists/:todolistId", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/todolists/${req.params.todolistId}.json`,
      { ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.get("/projects/:projectId/todolists/:todolistId/todos", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/todolists/${req.params.todolistId}/todos.json`,
      { ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.post("/projects/:projectId/todolists/:todolistId/todos", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/todolists/${req.params.todolistId}/todos.json`,
      { method: "POST", body: req.body, ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.put("/projects/:projectId/todos/:todoId", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/todos/${req.params.todoId}.json`,
      { method: "PUT", body: req.body, ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.post("/projects/:projectId/todos/:todoId/complete", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/todos/${req.params.todoId}/completion.json`,
      { method: "POST", ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.delete("/projects/:projectId/todos/:todoId/complete", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/todos/${req.params.todoId}/completion.json`,
      { method: "DELETE", ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.delete("/projects/:projectId/todos/:todoId", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/todos/${req.params.todoId}.json`,
      { method: "DELETE", ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

/* ================= Tier 3 ================= */
app.get("/projects/:projectId/message_boards", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/message_boards.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.get("/projects/:projectId/message_boards/:boardId/messages", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/message_boards/${req.params.boardId}/messages.json`,
      { ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.post("/projects/:projectId/message_boards/:boardId/messages", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/message_boards/${req.params.boardId}/messages.json`,
      { method: "POST", body: req.body, ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.put("/projects/:projectId/messages/:messageId", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/messages/${req.params.messageId}.json`,
      { method: "PUT", body: req.body, ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.delete("/projects/:projectId/messages/:messageId", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/messages/${req.params.messageId}.json`,
      { method: "DELETE", ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

/* ================= Tier 4 ================= */
app.get("/projects/:projectId/recordings/:recordingId/comments", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/recordings/${req.params.recordingId}/comments.json`,
      { ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.post("/projects/:projectId/recordings/:recordingId/comments", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/recordings/${req.params.recordingId}/comments.json`,
      { method: "POST", body: req.body, ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.put("/projects/:projectId/comments/:commentId", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/comments/${req.params.commentId}.json`,
      { method: "PUT", body: req.body, ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.delete("/projects/:projectId/comments/:commentId", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/comments/${req.params.commentId}.json`,
      { method: "DELETE", ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

/* ================= Tier 5 ================= */
app.get("/projects/:projectId/documents", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/documents.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.get("/projects/:projectId/documents/:documentId", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/documents/${req.params.documentId}.json`,
      { ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.post("/projects/:projectId/documents", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/documents.json`,
      { method: "POST", body: req.body, ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.put("/projects/:projectId/documents/:documentId", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/documents/${req.params.documentId}.json`,
      { method: "PUT", body: req.body, ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.delete("/projects/:projectId/documents/:documentId", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/documents/${req.params.documentId}.json`,
      { method: "DELETE", ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.get("/projects/:projectId/attachments", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/attachments.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

/* ================= Tier 6 ================= */
app.get("/projects/:projectId/campfires", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/campfires.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.get("/projects/:projectId/campfires/:campfireId/messages", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/campfires/${req.params.campfireId}/lines.json`,
      { ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.post("/projects/:projectId/campfires/:campfireId/messages", async (req, res) => {
  try {
    const data = await basecampFetch(
      TOKEN,
      `/buckets/${req.params.projectId}/campfires/${req.params.campfireId}/lines.json`,
      { method: "POST", body: req.body, ua: UA }
    );
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
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

app.listen(PORT, () => console.log(`bcgpt-full-v2 running on ${PORT}`));
