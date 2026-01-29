
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

let TOKEN = null;
let AUTH_CACHE = null;

function originBase(req) {
  const inferred = `${req.protocol}://${req.get("host")}`;
  return process.env.APP_BASE_URL || inferred;
}

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
  if (!auth.accounts?.length) {
    const err = new Error("NO_ACCOUNTS");
    err.code = "NO_ACCOUNTS";
    throw err;
  }
  return auth.accounts[0].id;
}

async function startStatus(req) {
  const base = originBase(req);
  const reauthUrl = `${base}/auth/basecamp/start`;
  const logoutUrl = `${base}/logout`;

  if (!TOKEN?.access_token) {
    return {
      connected: false,
      user: null,
      reauthUrl,
      logoutUrl,
      authStartPath: "/auth/basecamp/start",
      message: "Not connected. Use the auth link to connect Basecamp."
    };
  }

  try {
    const auth = await getAuthorization(true);
    return {
      connected: true,
      user: { name: auth.identity?.name || null, email: auth.identity?.email_address || null },
      reauthUrl,
      logoutUrl,
      authStartPath: "/auth/basecamp/start",
      message: "Connected. Not you? Log in with another account using the auth link."
    };
  } catch {
    return {
      connected: true,
      user: null,
      reauthUrl,
      logoutUrl,
      authStartPath: "/auth/basecamp/start",
      message: "Connected, but user info could not be loaded. Use the auth link to re-login."
    };
  }
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

  TOKEN = await r.json();
  AUTH_CACHE = null;

  res.send("✅ Basecamp connected. Return to ChatGPT and run /startbcgpt.");
});

app.get("/startbcgpt", async (req, res) => {
  res.json(await startStatus(req));
});

app.post("/logout", (req, res) => {
  TOKEN = null;
  AUTH_CACHE = null;
  res.json({ ok: true, connected: false, message: "Logged out." });
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
    const data = await basecampFetch(TOKEN, `/${accountId}/projects/${req.params.projectId}.json`, { ua: UA });
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
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/todolists/${req.params.todolistId}.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.get("/projects/:projectId/todolists/:todolistId/todos", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/todolists/${req.params.todolistId}/todos.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.post("/projects/:projectId/todolists/:todolistId/todos", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/todolists/${req.params.todolistId}/todos.json`, {
      method: "POST",
      body: req.body,
      ua: UA
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.put("/projects/:projectId/todos/:todoId", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/todos/${req.params.todoId}.json`, {
      method: "PUT",
      body: req.body,
      ua: UA
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.post("/projects/:projectId/todos/:todoId/complete", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/todos/${req.params.todoId}/completion.json`, {
      method: "POST",
      ua: UA
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.delete("/projects/:projectId/todos/:todoId/complete", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/todos/${req.params.todoId}/completion.json`, {
      method: "DELETE",
      ua: UA
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.delete("/projects/:projectId/todos/:todoId", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/todos/${req.params.todoId}.json`, {
      method: "DELETE",
      ua: UA
    });
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
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/message_boards/${req.params.boardId}/messages.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.post("/projects/:projectId/message_boards/:boardId/messages", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/message_boards/${req.params.boardId}/messages.json`, {
      method: "POST",
      body: req.body,
      ua: UA
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.put("/projects/:projectId/messages/:messageId", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/messages/${req.params.messageId}.json`, {
      method: "PUT",
      body: req.body,
      ua: UA
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.delete("/projects/:projectId/messages/:messageId", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/messages/${req.params.messageId}.json`, {
      method: "DELETE",
      ua: UA
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

/* ================= Tier 4 ================= */
app.get("/projects/:projectId/recordings/:recordingId/comments", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/recordings/${req.params.recordingId}/comments.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.post("/projects/:projectId/recordings/:recordingId/comments", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/recordings/${req.params.recordingId}/comments.json`, {
      method: "POST",
      body: req.body,
      ua: UA
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.put("/projects/:projectId/comments/:commentId", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/comments/${req.params.commentId}.json`, {
      method: "PUT",
      body: req.body,
      ua: UA
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.delete("/projects/:projectId/comments/:commentId", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/comments/${req.params.commentId}.json`, {
      method: "DELETE",
      ua: UA
    });
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
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/documents/${req.params.documentId}.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.post("/projects/:projectId/documents", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/documents.json`, {
      method: "POST",
      body: req.body,
      ua: UA
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.put("/projects/:projectId/documents/:documentId", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/documents/${req.params.documentId}.json`, {
      method: "PUT",
      body: req.body,
      ua: UA
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.delete("/projects/:projectId/documents/:documentId", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/documents/${req.params.documentId}.json`, {
      method: "DELETE",
      ua: UA
    });
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
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/campfires/${req.params.campfireId}/lines.json`, { ua: UA });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

app.post("/projects/:projectId/campfires/:campfireId/messages", async (req, res) => {
  try {
    const data = await basecampFetch(TOKEN, `/buckets/${req.params.projectId}/campfires/${req.params.campfireId}/lines.json`, {
      method: "POST",
      body: req.body,
      ua: UA
    });
    res.json(data);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || "ERROR", message: e.message, data: e.data });
  }
});

/* ================= MCP ================= */
app.post("/mcp", async (req, res) => {
  try {
    const auth = await getAuthorization();
    const accountId = await getAccountId();
    const out = await handleMCP(req.body, {
      TOKEN,
      accountId,
      ua: UA,
      authAccounts: auth.accounts || [],
      startStatus: async () => await startStatus(req)
    });
    res.json(out);
  } catch (e) {
    res.json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: e.code || "ERROR", message: e.message } });
  }
});

app.listen(PORT, () => console.log(`bcgpt-full-v2 running on ${PORT}`));
