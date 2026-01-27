/**
 * bcgpt index.js — Basecamp OAuth + MCP Server (Streamable HTTP)
 * Node >=18, ESM ("type":"module")
 *
 * Routes:
 *  - GET  /auth/basecamp/start
 *  - GET  /auth/basecamp/callback
 *  - GET  /startbcgpt     (ALWAYS returns reauthUrl; minimal user info)
 *  - POST /logout         (clears token + cached auth)
 *  - GET  /logout         (same as POST, but browser friendly)
 *  - GET  /health
 *
 * MCP:
 *  - GET  /mcp (SSE keepalive)
 *  - POST /mcp (JSON-RPC: initialize, tools/list, tools/call)
 *
 * MCP Tools:
 *  - startbcgpt (minimal status + reauthUrl)
 *  - logout
 *  - list_accounts
 *  - list_projects
 *  - get_project
 *  - list_people
 *  - list_todolists
 *  - list_todos
 *  - create_todo
 *  - complete_todo
 *  - create_comment
 *  - list_message_boards
 *  - create_message
 *  - basecamp_request (generic do-anything tool)
 *
 * NOTE: token storage is in-memory. For persistence on Render, use Redis/DB.
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const UA = "bcgpt (bcgpt.onrender.com)";

const {
  BASECAMP_CLIENT_ID,
  BASECAMP_CLIENT_SECRET,
  APP_BASE_URL = "https://bcgpt.onrender.com",
  BASECAMP_DEFAULT_ACCOUNT_ID = "0",
} = process.env;

const DEFAULT_ACCOUNT_ID = Number(BASECAMP_DEFAULT_ACCOUNT_ID || 0);

if (!BASECAMP_CLIENT_ID || !BASECAMP_CLIENT_SECRET) {
  console.warn("Missing BASECAMP_CLIENT_ID or BASECAMP_CLIENT_SECRET");
}

// -------------------- In-memory store (swap to Redis/DB for production) --------------------
const tokenStore = new Map(); // basecamp:token, basecamp:authorization, state:<...>
const STATE_TTL_MS = 10 * 60 * 1000;

// -------------------- MCP protocol + security + sessions (DECLARE ONCE) --------------------
const MCP_PROTOCOL_VERSION = "2025-06-18";

// DNS rebinding protection (Origin allowlist)
const ORIGIN_ALLOWLIST = new Set([
  "https://chatgpt.com",
  "https://chat.openai.com",
  APP_BASE_URL,
]);

function checkOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true; // server-to-server
  if (!ORIGIN_ALLOWLIST.has(origin)) {
    res.status(403).json({ error: "Origin not allowed" });
    return false;
  }
  return true;
}

// Session tracking
const sessions = new Map(); // sessionId -> { createdAt }

function newSessionId() {
  return "mcp_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getSessionId(req) {
  const sid = req.headers["mcp-session-id"];
  if (!sid) return null;
  return sessions.has(sid) ? sid : null;
}

// -------------------- Token + auth cache helpers --------------------
function getToken() {
  return tokenStore.get("basecamp:token");
}

function setToken(tokenJson) {
  tokenStore.set("basecamp:token", tokenJson);
}

function clearAuth() {
  tokenStore.delete("basecamp:token");
  tokenStore.delete("basecamp:authorization");
}

function getCachedAuthorization() {
  return tokenStore.get("basecamp:authorization");
}

function setCachedAuthorization(authJson) {
  tokenStore.set("basecamp:authorization", { cachedAt: Date.now(), data: authJson });
}

function isTokenExpiredSoon(token, skewSeconds = 60) {
  if (!token?.expires_in || !token?.created_at) return false;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Number(token.created_at) + Number(token.expires_in);
  return now >= expiresAt - skewSeconds;
}

async function refreshAccessTokenIfNeeded() {
  const t = getToken();
  if (!t?.access_token) return { ok: false, status: 401, error: "Not connected." };

  // If refresh metadata missing, proceed without refresh
  if (!t.refresh_token || !t.expires_in || !t.created_at) {
    return { ok: true, token: t, refreshed: false };
  }

  if (!isTokenExpiredSoon(t)) {
    return { ok: true, token: t, refreshed: false };
  }

  // Best-effort refresh (if it fails, user can reauth)
  try {
    const body = new URLSearchParams({
      type: "refresh_token",
      refresh_token: String(t.refresh_token),
      client_id: BASECAMP_CLIENT_ID,
      client_secret: BASECAMP_CLIENT_SECRET,
    });

    const resp = await fetch("https://launchpad.37signals.com/authorization/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
      },
      body,
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { ok: false, status: resp.status, error: `Refresh failed: ${text}` };
    }

    const newToken = await resp.json();
    if (!newToken.refresh_token && t.refresh_token) newToken.refresh_token = t.refresh_token;

    setToken(newToken);
    tokenStore.delete("basecamp:authorization");
    return { ok: true, token: newToken, refreshed: true };
  } catch (e) {
    return { ok: false, status: 500, error: e?.message || "Refresh error" };
  }
}

async function fetchAuthorizationJson({ force = false } = {}) {
  const cached = getCachedAuthorization();
  // short cache for identity reliability
  if (!force && cached?.data && Date.now() - cached.cachedAt < 60 * 1000) {
    return { ok: true, data: cached.data, cached: true };
  }

  const tr = await refreshAccessTokenIfNeeded();
  if (!tr.ok) return tr;

  const t = tr.token;
  const r = await fetch("https://launchpad.37signals.com/authorization.json", {
    headers: {
      Authorization: `Bearer ${t.access_token}`,
      "User-Agent": UA,
    },
  });

  if (!r.ok) {
    const text = await r.text();
    return { ok: false, status: r.status, error: text };
  }

  const authJson = await r.json();
  setCachedAuthorization(authJson);
  return { ok: true, data: authJson, cached: false };
}

async function getIdentityAndAccounts({ force = false } = {}) {
  const auth = await fetchAuthorizationJson({ force });
  if (!auth.ok) return auth;
  return {
    ok: true,
    identity: auth.data?.identity || null,
    accounts: auth.data?.accounts || [],
  };
}

function pickAccountId(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  if (DEFAULT_ACCOUNT_ID) {
    const m = accounts.find((a) => Number(a.id) === DEFAULT_ACCOUNT_ID);
    if (m) return m.id;
  }
  return accounts[0].id;
}

// -------------------- Fetch wrappers --------------------
const HOSTS = {
  launchpad: "https://launchpad.37signals.com",
  basecamp: "https://3.basecampapi.com",
};

function normalizePath(p) {
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

async function launchpadFetch(path, { method = "GET", headers = {}, body } = {}) {
  const tr = await refreshAccessTokenIfNeeded();
  if (!tr.ok) return { ok: false, status: tr.status, error: tr.error };

  const t = tr.token;
  const url = HOSTS.launchpad + normalizePath(path);

  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${t.access_token}`,
      "User-Agent": UA,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}

  return { ok: resp.ok, status: resp.status, data };
}

async function basecampFetch(path, { method = "GET", headers = {}, body } = {}) {
  const tr = await refreshAccessTokenIfNeeded();
  if (!tr.ok) return { ok: false, status: tr.status, error: tr.error };

  const t = tr.token;
  const url = HOSTS.basecamp + normalizePath(path);

  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${t.access_token}`,
      "User-Agent": UA,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}

  if (resp.status === 401) tokenStore.delete("basecamp:authorization");
  return { ok: resp.ok, status: resp.status, data };
}

// -------------------- Minimal /startbcgpt payload --------------------
async function buildStartBcPayload(req) {
  // Fallback base URL even if APP_BASE_URL env is missing/wrong
  const inferredBase =
    (req.headers["x-forwarded-proto"] ? `${req.headers["x-forwarded-proto"]}://${req.headers.host}` : null) ||
    `${req.protocol}://${req.get("host")}`;

  const base = APP_BASE_URL && APP_BASE_URL.startsWith("http") ? APP_BASE_URL : inferredBase;

  const reauthUrl = `${base}/auth/basecamp/start`;
  const logoutUrl = `${base}/logout`;

  const t = getToken();
  const connected = Boolean(t?.access_token);

  if (!connected) {
    return {
      ok: true,
      connected: false,
      user: null,
      reauthUrl,
      logoutUrl,
      message: "Not connected.",
      hint: "Not you? Login with another account using reauthUrl."
    };
  }

  const idAcc = await getIdentityAndAccounts({ force: true });
  if (!idAcc.ok) {
    return {
      ok: false,
      connected: true,
      user: null,
      reauthUrl,
      logoutUrl,
      message: "Token exists but identity could not be loaded. Re-login if needed.",
      hint: "Not you? Login with another account using reauthUrl.",
      status: idAcc.status || 500,
      error: idAcc.error || "authorization.json failed"
    };
  }

  const identity = idAcc.identity || {};
  const name =
    identity?.name ||
    identity?.email_address ||
    (identity?.id != null ? String(identity.id) : "Unknown");
  const email = identity?.email_address || null;

  return {
    ok: true,
    connected: true,
    user: { name, email },
    reauthUrl,
    logoutUrl,
    message: "Connected.",
    hint: "Not you? Login with another account using reauthUrl."
  };
}


// -------------------- Convenience functions --------------------
async function listProjects({ accountId } = {}) {
  const idAcc = await getIdentityAndAccounts();
  if (!idAcc.ok) return idAcc;

  const chosenAccountId = accountId || pickAccountId(idAcc.accounts || []);
  if (!chosenAccountId) return { ok: false, status: 404, error: "No Basecamp accounts found." };

  const r = await basecampFetch(`/${chosenAccountId}/projects.json`);
  if (!r.ok) return { ok: false, status: r.status, error: r.data };
  return { ok: true, accountId: chosenAccountId, projects: r.data };
}

async function getProject({ accountId, projectId }) {
  if (!projectId) return { ok: false, status: 400, error: "projectId is required" };

  const idAcc = await getIdentityAndAccounts();
  if (!idAcc.ok) return idAcc;

  const chosenAccountId = accountId || pickAccountId(idAcc.accounts || []);
  if (!chosenAccountId) return { ok: false, status: 404, error: "No Basecamp accounts found." };

  const r = await basecampFetch(`/${chosenAccountId}/projects/${projectId}.json`);
  if (!r.ok) return { ok: false, status: r.status, error: r.data };
  return { ok: true, accountId: chosenAccountId, project: r.data };
}

// -------------------- OAuth Routes --------------------
app.get("/auth/basecamp/start", (req, res) => {
  const redirectUri = `${APP_BASE_URL}/auth/basecamp/callback`;
  const state = Math.random().toString(36).slice(2);

  tokenStore.set(`state:${state}`, { createdAt: Date.now() });

  const authUrl =
    "https://launchpad.37signals.com/authorization/new?type=web_server" +
    `&client_id=${encodeURIComponent(BASECAMP_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  res.redirect(authUrl);
});

app.get("/auth/basecamp/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) return res.status(400).send(`OAuth error: ${error}`);
    if (!code || !state) return res.status(400).send("Missing code/state");

    const saved = tokenStore.get(`state:${state}`);
    if (!saved) return res.status(400).send("Invalid state");

    if (Date.now() - saved.createdAt > STATE_TTL_MS) {
      tokenStore.delete(`state:${state}`);
      return res.status(400).send("State expired. Please try again.");
    }

    const redirectUri = `${APP_BASE_URL}/auth/basecamp/callback`;

    const body = new URLSearchParams({
      type: "web_server",
      client_id: BASECAMP_CLIENT_ID,
      client_secret: BASECAMP_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code: String(code),
    });

    const resp = await fetch(
      "https://launchpad.37signals.com/authorization/token?type=web_server",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": UA,
        },
        body,
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(500).send(`Token exchange failed: ${text}`);
    }

    const tokenJson = await resp.json();
    setToken(tokenJson);

    tokenStore.delete(`state:${state}`);
    tokenStore.delete("basecamp:authorization");

    res.send("✅ Basecamp connected. Return to ChatGPT and call /startbcgpt.");
  } catch (e) {
    console.error(e);
    res.status(500).send("Callback error: " + (e?.message || "unknown"));
  }
});

// -------------------- Status / start endpoint --------------------
app.get("/startbcgpt", async (req, res) => {
  try {
    const payload = await buildStartBcPayload();
    res.status(payload.ok ? 200 : (payload.status || 500)).json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({
      ok: false,
      connected: Boolean(getToken()?.access_token),
      user: null,
      reauthUrl: `${APP_BASE_URL}/auth/basecamp/start`,
      logoutUrl: `${APP_BASE_URL}/logout`,
      message: "Server error.",
      hint: "Not you? Login with another account using reauthUrl.",
      error: e?.message || "unknown",
    });
  }
});

// -------------------- Logout --------------------
app.post("/logout", (req, res) => {
  clearAuth();
  res.json({
    ok: true,
    connected: false,
    message: "Logged out.",
    reauthUrl: `${APP_BASE_URL}/auth/basecamp/start`,
  });
});

app.get("/logout", (req, res) => {
  clearAuth();
  res.send(
    `✅ Logged out. <a href="${APP_BASE_URL}/auth/basecamp/start">Login again</a>. You can close this tab.`
  );
});

// -------------------- Root / help --------------------
app.get("/", (req, res) => {
  res.type("text/plain").send(
    [
      "bcgpt server running",
      "",
      "Quick start:",
      `1) Authenticate: ${APP_BASE_URL}/auth/basecamp/start`,
      `2) Status:       ${APP_BASE_URL}/startbcgpt`,
      `3) MCP:          POST ${APP_BASE_URL}/mcp (initialize -> tools/list -> tools/call)`,
      "",
      "Logout:",
      `- POST ${APP_BASE_URL}/logout`,
      `- GET  ${APP_BASE_URL}/logout`,
    ].join("\n")
  );
});

app.get("/health", (req, res) => {
  const t = getToken();
  res.json({
    ok: true,
    service: "bcgpt",
    connected: Boolean(t?.access_token),
    time: new Date().toISOString(),
  });
});

// -------------------- MCP Tools (FULL SET) --------------------
const MCP_TOOLS = [
  {
    name: "startbcgpt",
    title: "Get Basecamp connection status (minimal)",
    description:
      "Returns whether Basecamp is connected, logged-in user name/email (if available), and reauthUrl. Always provides reauthUrl.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "logout",
    title: "Logout from Basecamp",
    description: "Clears stored token and cached authorization. After this, user must re-auth.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_accounts",
    title: "List Basecamp accounts",
    description: "Lists Basecamp accounts available to the authenticated user (useful for accountId).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_projects",
    title: "List Basecamp projects",
    description: "Lists projects for an account (default if omitted).",
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "integer" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_project",
    title: "Get project details",
    description: "Gets project details (includes dock with tool IDs like message_board).",
    inputSchema: {
      type: "object",
      properties: { accountId: { type: "integer" }, projectId: { type: "integer" } },
      required: ["projectId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_people",
    title: "List people on a project",
    description: "Lists people for a project (bucket).",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "integer" } },
      required: ["projectId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_todolists",
    title: "List to-do lists",
    description: "Lists to-do lists in a project (bucket).",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "integer" } },
      required: ["projectId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_todos",
    title: "List to-dos in a to-do list",
    description: "Lists to-dos for a to-do list in a project (bucket).",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "integer" }, todolistId: { type: "integer" } },
      required: ["projectId", "todolistId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_todo",
    title: "Create a to-do",
    description: "Creates a to-do in a to-do list.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "integer" },
        todolistId: { type: "integer" },
        content: { type: "string" },
        description: { type: "string" },
        assigneeId: { type: "integer" },
        dueOn: { type: "string", description: "YYYY-MM-DD" },
        notify: { type: "boolean" },
      },
      required: ["projectId", "todolistId", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_todo",
    title: "Complete a to-do",
    description: "Marks a to-do as complete.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "integer" }, todoId: { type: "integer" } },
      required: ["projectId", "todoId"],
      additionalProperties: false,
    },
  },
  {
    name: "create_comment",
    title: "Create a comment",
    description:
      "Creates a comment on a recordable. Provide commentsUrl path like /buckets/{bucket}/recordings/{id}/comments.json",
    inputSchema: {
      type: "object",
      properties: { commentsUrl: { type: "string" }, content: { type: "string" } },
      required: ["commentsUrl", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "list_message_boards",
    title: "List message board(s) via project dock",
    description: "Reads project dock and returns message board id(s) and URLs.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "integer" }, accountId: { type: "integer" } },
      required: ["projectId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_message",
    title: "Create a message",
    description:
      "Creates a message in a project's message board. If you don't know messageBoardId, call get_project and find dock item name=message_board.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "integer" },
        messageBoardId: { type: "integer" },
        subject: { type: "string" },
        content: { type: "string" },
        status: { type: "string", enum: ["draft", "active"] },
      },
      required: ["projectId", "messageBoardId", "subject", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "basecamp_request",
    title: "Generic Basecamp API request (do anything)",
    description:
      "Arbitrary request to Launchpad or Basecamp API. Path only (no full URLs). Use for anything not covered by convenience tools.",
    inputSchema: {
      type: "object",
      properties: {
        api: { type: "string", enum: ["basecamp", "launchpad"] },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
        path: { type: "string", description: "Path only, e.g. /authorization.json or /{accountId}/projects.json" },
        body: { type: "object" },
      },
      required: ["api", "method", "path"],
      additionalProperties: false,
    },
  },
];

// -------------------- MCP Tool Implementations --------------------
async function tool_startbcgpt() {
  return await buildStartBcPayload();
}

async function tool_logout() {
  clearAuth();
  return {
    ok: true,
    connected: false,
    message: "Logged out.",
    reauthUrl: `${APP_BASE_URL}/auth/basecamp/start`,
  };
}

async function tool_list_accounts() {
  const idAcc = await getIdentityAndAccounts({ force: true });
  if (!idAcc.ok) return { ok: false, status: idAcc.status, error: idAcc.error };
  return { ok: true, accounts: idAcc.accounts || [] };
}

async function tool_list_projects(args) {
  const data = await listProjects({ accountId: args?.accountId });
  if (!data.ok) return { ok: false, status: data.status, error: data.error };
  return data;
}

async function tool_get_project(args) {
  const data = await getProject({ accountId: args?.accountId, projectId: args?.projectId });
  if (!data.ok) return { ok: false, status: data.status, error: data.error };
  return data;
}

async function tool_list_people(args) {
  const { projectId } = args || {};
  const r = await basecampFetch(`/buckets/${projectId}/people.json`);
  if (!r.ok) return { ok: false, status: r.status, error: r.data };
  return { ok: true, projectId, people: r.data };
}

async function tool_list_todolists(args) {
  const { projectId } = args || {};
  const r = await basecampFetch(`/buckets/${projectId}/todolists.json`);
  if (!r.ok) return { ok: false, status: r.status, error: r.data };
  return { ok: true, projectId, todolists: r.data };
}

async function tool_list_todos(args) {
  const { projectId, todolistId } = args || {};
  const r = await basecampFetch(`/buckets/${projectId}/todolists/${todolistId}/todos.json`);
  if (!r.ok) return { ok: false, status: r.status, error: r.data };
  return { ok: true, projectId, todolistId, todos: r.data };
}

async function tool_create_todo(args) {
  const { projectId, todolistId, content, description, assigneeId, dueOn, notify } = args || {};
  const body = {
    content,
    ...(description ? { description } : {}),
    ...(assigneeId ? { assignee_ids: [assigneeId] } : {}),
    ...(dueOn ? { due_on: dueOn } : {}),
    ...(typeof notify === "boolean" ? { notify } : {}),
  };

  const r = await basecampFetch(`/buckets/${projectId}/todolists/${todolistId}/todos.json`, {
    method: "POST",
    body,
  });

  if (!r.ok) return { ok: false, status: r.status, error: r.data };
  return { ok: true, created: r.data };
}

async function tool_complete_todo(args) {
  const { projectId, todoId } = args || {};
  const r = await basecampFetch(`/buckets/${projectId}/todos/${todoId}/completion.json`, {
    method: "POST",
    body: {},
  });
  if (!r.ok) return { ok: false, status: r.status, error: r.data };
  return { ok: true, completed: r.data };
}

async function tool_create_comment(args) {
  const { commentsUrl, content } = args || {};
  const p = normalizePath(commentsUrl || "");
  if (!p.startsWith("/buckets/")) {
    return { ok: false, status: 400, error: "commentsUrl must start with /buckets/..." };
  }
  const r = await basecampFetch(p, { method: "POST", body: { content } });
  if (!r.ok) return { ok: false, status: r.status, error: r.data };
  return { ok: true, comment: r.data };
}

async function tool_list_message_boards(args) {
  const { projectId, accountId } = args || {};
  const proj = await getProject({ accountId, projectId });
  if (!proj.ok) return { ok: false, status: proj.status, error: proj.error };

  const boards = (proj.project?.dock || [])
    .filter((d) => d?.name === "message_board" || String(d?.title || "").toLowerCase().includes("message"))
    .map((d) => ({ id: d.id, title: d.title, name: d.name, url: d.url }));

  return { ok: true, projectId, messageBoards: boards };
}

async function tool_create_message(args) {
  const { projectId, messageBoardId, subject, content, status } = args || {};
  const body = { subject, content, status: status || "active" };

  const r = await basecampFetch(`/buckets/${projectId}/message_boards/${messageBoardId}/messages.json`, {
    method: "POST",
    body,
  });

  if (!r.ok) return { ok: false, status: r.status, error: r.data };
  return { ok: true, message: r.data };
}

async function tool_basecamp_request(args) {
  const { api, method, path, body } = args || {};
  const p = normalizePath(path || "");

  if (p.includes("://")) return { ok: false, status: 400, error: "path must be a path only, not a full URL" };
  if (p.includes("..")) return { ok: false, status: 400, error: "invalid path" };

  if (api === "launchpad") {
    const r = await launchpadFetch(p, { method, body });
    if (!r.ok) return { ok: false, status: r.status, error: r.data };
    return { ok: true, status: r.status, data: r.data };
  }

  if (api === "basecamp") {
    const r = await basecampFetch(p, { method, body });
    if (!r.ok) return { ok: false, status: r.status, error: r.data };
    return { ok: true, status: r.status, data: r.data };
  }

  return { ok: false, status: 400, error: "api must be 'basecamp' or 'launchpad'" };
}

// -------------------- MCP: SSE endpoint --------------------
app.get("/mcp", (req, res) => {
  if (!checkOrigin(req, res)) return;

  const accept = req.headers.accept || "";
  if (!accept.includes("text/event-stream")) {
    return res.status(405).send("Method Not Allowed");
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const interval = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 25000);

  req.on("close", () => clearInterval(interval));
});

// -------------------- MCP: JSON-RPC handler --------------------
app.post("/mcp", async (req, res) => {
  if (!checkOrigin(req, res)) return;

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const payload = req.body;
  const msgs = Array.isArray(payload) ? payload : [payload];

  const hasAnyRequestWithId = msgs.some((m) => m && typeof m.id !== "undefined" && m.id !== null);
  if (!hasAnyRequestWithId) return res.status(202).end();

  const responses = [];

  for (const msg of msgs) {
    try {
      if (!msg || msg.jsonrpc !== "2.0") {
        responses.push({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "Invalid Request" } });
        continue;
      }

      const { id, method, params } = msg;

      // Session required after initialize
      if (method !== "initialize") {
        const sid = getSessionId(req);
        if (!sid) {
          responses.push({ jsonrpc: "2.0", id, error: { code: -32001, message: "Missing or invalid Mcp-Session-Id" } });
          continue;
        }
      }

      if (method === "initialize") {
        const sessionId = newSessionId();
        sessions.set(sessionId, { createdAt: Date.now() });
        res.setHeader("Mcp-Session-Id", sessionId);

        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "bcgpt", title: "Basecamp GPT MCP Server", version: "3.0.1" },
            instructions: [
              "Start here:",
              "1) Call tool startbcgpt to check login status and get reauthUrl.",
              "2) If not connected: open reauthUrl in browser and authenticate.",
              "3) Use tools/list then tools/call for Basecamp operations.",
              "",
              "Common flow:",
              "- list_accounts (if needed) -> list_projects -> get_project",
              "- list_todolists -> list_todos -> create_todo / complete_todo",
              "- list_message_boards -> create_message -> create_comment",
              "",
              "Fallback:",
              "- Use basecamp_request for endpoints not covered by tools.",
              "",
              "Wrong account?",
              "- Call logout or open reauthUrl (Not you? login with another account).",
            ].join("\n"),
          },
        });
        continue;
      }

      if (method === "tools/list") {
        responses.push({ jsonrpc: "2.0", id, result: { tools: MCP_TOOLS } });
        continue;
      }

      if (method === "tools/call") {
        const name = params?.name;
        const args = params?.arguments || {};

        let out;
        if (name === "startbcgpt") out = await tool_startbcgpt();
        else if (name === "logout") out = await tool_logout();
        else if (name === "list_accounts") out = await tool_list_accounts();
        else if (name === "list_projects") out = await tool_list_projects(args);
        else if (name === "get_project") out = await tool_get_project(args);
        else if (name === "list_people") out = await tool_list_people(args);
        else if (name === "list_todolists") out = await tool_list_todolists(args);
        else if (name === "list_todos") out = await tool_list_todos(args);
        else if (name === "create_todo") out = await tool_create_todo(args);
        else if (name === "complete_todo") out = await tool_complete_todo(args);
        else if (name === "create_comment") out = await tool_create_comment(args);
        else if (name === "list_message_boards") out = await tool_list_message_boards(args);
        else if (name === "create_message") out = await tool_create_message(args);
        else if (name === "basecamp_request") out = await tool_basecamp_request(args);
        else {
          responses.push({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } });
          continue;
        }

        const isError = out && out.ok === false;
        const safeJson = JSON.stringify(out, null, 2);
        const text = safeJson.length > 12000 ? safeJson.slice(0, 12000) + "\n... (truncated)" : safeJson;

        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text }],
            structuredContent: out,
            isError,
          },
        });
        continue;
      }

      responses.push({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (err) {
      responses.push({
        jsonrpc: "2.0",
        id: msg?.id ?? null,
        error: { code: -32000, message: "Server error", data: String(err?.message || err) },
      });
    }
  }

  if (!Array.isArray(payload)) return res.status(200).send(JSON.stringify(responses[0]));
  return res.status(200).send(JSON.stringify(responses));
});

// -------------------- Start server --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
