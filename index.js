import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const UA = "bcgpt (bcgpt.onrender.com)";

const {
  BASECAMP_CLIENT_ID,
  BASECAMP_CLIENT_SECRET,
  APP_BASE_URL = "https://bcgpt.onrender.com",
} = process.env;
const BASECAMP_DEFAULT_ACCOUNT_ID = Number(process.env.BASECAMP_DEFAULT_ACCOUNT_ID || 0);

if (!BASECAMP_CLIENT_ID || !BASECAMP_CLIENT_SECRET) {
  console.warn("Missing BASECAMP_CLIENT_ID or BASECAMP_CLIENT_SECRET");
}

// Temporary in-memory store (OK for testing; later use DB/Redis)
const tokenStore = new Map();

// expire OAuth state after 10 minutes
const STATE_TTL_MS = 10 * 60 * 1000;

function getToken() {
  return tokenStore.get("basecamp:token");
}

function requireToken(req, res) {
  const t = getToken();
  if (!t?.access_token) {
    res.status(401).json({ error: "Not connected. Visit /auth/basecamp/start first." });
    return null;
  }
  return t;
}

/**
 * Step A: Redirect user to 37signals authorization page
 */
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

/**
 * Step B: Exchange code for access token
 */
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

    // Save tokens (single-user demo)
    tokenStore.set("basecamp:token", tokenJson);

    // cleanup state
    tokenStore.delete(`state:${state}`);

    res.send("✅ Basecamp connected successfully. You can close this tab.");
  } catch (e) {
    console.error(e);
    res.status(500).send("Callback error: " + (e?.message || "unknown"));
  }
});

/**
 * Debug: confirm we have a token saved
 */
app.get("/debug/token", (req, res) => {
  const t = getToken();
  res.json({
    connected: Boolean(t?.access_token),
    tokenKeys: t ? Object.keys(t) : [],
  });
});

/**
 * Debug: get authorization info (lists accounts + API endpoints)
 * This is the key step to discover which account IDs the user has access to.
 */
app.get("/debug/authorization", async (req, res) => {
  try {
    const t = requireToken(req, res);
    if (!t) return;

    const r = await fetch("https://launchpad.37signals.com/authorization.json", {
      headers: {
        Authorization: `Bearer ${t.access_token}`,
        "User-Agent": UA,
      },
    });

    const text = await r.text();
    res.status(r.status).type("application/json").send(text);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e?.message || "unknown" });
  }
});

/**
 * Debug: list projects from the first Basecamp account returned by /authorization.json
 */
app.get("/debug/projects", async (req, res) => {
  try {
    const t = requireToken(req, res);
    if (!t) return;

    // 1) discover accounts
    const authResp = await fetch("https://launchpad.37signals.com/authorization.json", {
      headers: {
        Authorization: `Bearer ${t.access_token}`,
        "User-Agent": UA,
      },
    });

    if (!authResp.ok) {
      const text = await authResp.text();
      return res.status(authResp.status).send(text);
    }

    const authJson = await authResp.json();
    const accounts = authJson?.accounts || [];

    if (!accounts.length) {
      return res.status(404).json({ error: "No Basecamp accounts found for this user." });
    }

    // Choose the first account (you can later let user choose)
    let accountId = accounts[0].id;

if (BASECAMP_DEFAULT_ACCOUNT_ID) {
  const match = accounts.find(a => Number(a.id) === BASECAMP_DEFAULT_ACCOUNT_ID);
  if (!match) {
    return {
      ok: false,
      status: 404,
      error: `Default account ${BASECAMP_DEFAULT_ACCOUNT_ID} not found. Available: ${accounts.map(a => a.id).join(", ")}`
    };
  }
  accountId = match.id;
}

    // Basecamp API base (Basecamp 4 still uses 3.basecampapi.com)
    const projectsUrl = `https://3.basecampapi.com/${accountId}/projects.json`;

    const projectsResp = await fetch(projectsUrl, {
      headers: {
        Authorization: `Bearer ${t.access_token}`,
        "User-Agent": UA,
      },
    });

    const text = await projectsResp.text();
    res.status(projectsResp.status).type("application/json").send(text);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e?.message || "unknown" });
  }
});

// -------------------- MCP (Streamable HTTP) --------------------

const MCP_PROTOCOL_VERSION = "2025-06-18";

// Allowlist origins to reduce DNS rebinding risk (recommended by MCP transport spec).
// If Origin header is missing (server-to-server), we allow it.
const ORIGIN_ALLOWLIST = new Set([
  "https://chatgpt.com",
  "https://chat.openai.com",
  // optionally allow your own origin if you hit it from a browser:
  "https://bcgpt.onrender.com",
]);

function checkOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!ORIGIN_ALLOWLIST.has(origin)) {
    res.status(403).json({ error: "Origin not allowed" });
    return false;
  }
  return true;
}

// Basic session tracking (per MCP transport spec session guidance)
const sessions = new Map(); // sessionId -> { createdAt }
function newSessionId() {
  return "mcp_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function getSession(req) {
  const sid = req.headers["mcp-session-id"];
  if (!sid) return null;
  return sessions.get(sid) ? sid : null;
}

// Tool definition for MCP tools/list
const MCP_TOOLS = [
  {
    name: "list_projects",
    title: "List Basecamp projects",
    description: "Returns the projects you have access to in Basecamp.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    // Optional but helpful for safety/UI hints (clients treat as untrusted)
    annotations: { readOnlyHint: true },
  },
];

// Helper: fetch Basecamp projects (same logic as your /debug/projects)
async function fetchProjectsFromBasecamp() {
  const t = tokenStore.get("basecamp:token");
  if (!t?.access_token) {
    return { ok: false, status: 401, error: "Not connected to Basecamp." };
  }

  // 1) authorization.json to get accounts
  const authResp = await fetch("https://launchpad.37signals.com/authorization.json", {
    headers: {
      Authorization: `Bearer ${t.access_token}`,
      "User-Agent": UA,
    },
  });

  if (!authResp.ok) {
    const text = await authResp.text();
    return { ok: false, status: authResp.status, error: text };
  }

  const authJson = await authResp.json();
  const accounts = authJson?.accounts || [];
  if (!accounts.length) {
    return { ok: false, status: 404, error: "No Basecamp accounts found." };
  }

  let accountId = accounts[0].id;

if (BASECAMP_DEFAULT_ACCOUNT_ID) {
  const match = accounts.find(a => Number(a.id) === BASECAMP_DEFAULT_ACCOUNT_ID);
  if (!match) {
    return {
      ok: false,
      status: 404,
      error: `Default account ${BASECAMP_DEFAULT_ACCOUNT_ID} not found. Available: ${accounts.map(a => a.id).join(", ")}`
    };
  }
  accountId = match.id;
}
  const projectsUrl = `https://3.basecampapi.com/${accountId}/projects.json`;

  const projectsResp = await fetch(projectsUrl, {
    headers: {
      Authorization: `Bearer ${t.access_token}`,
      "User-Agent": UA,
    },
  });

  const text = await projectsResp.text();
  if (!projectsResp.ok) {
    return { ok: false, status: projectsResp.status, error: text };
  }

  let projects;
  try {
    projects = JSON.parse(text);
  } catch {
    projects = text;
  }

  return { ok: true, accountId, projects };
}

// GET /mcp (SSE stream) — optional but supported by Streamable HTTP transport spec :contentReference[oaicite:1]{index=1}
app.get("/mcp", (req, res) => {
  if (!checkOrigin(req, res)) return;

  const accept = req.headers.accept || "";
  if (!accept.includes("text/event-stream")) {
    return res.status(405).send("Method Not Allowed");
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  // Keepalive ping (comments are valid in SSE)
  const interval = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 25000);

  req.on("close", () => clearInterval(interval));
});

// POST /mcp — JSON-RPC handler for initialize, tools/list, tools/call :contentReference[oaicite:2]{index=2}
app.post("/mcp", async (req, res) => {
  if (!checkOrigin(req, res)) return;

  // MCP transport spec: client sends Accept application/json and/or text/event-stream.
  // We'll respond with application/json always for simplicity.
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const payload = req.body;

  // Support batch or single JSON-RPC message
  const msgs = Array.isArray(payload) ? payload : [payload];

  // If it's only notifications (no id), return 202 per spec guidance (optional)
  const hasAnyRequestWithId = msgs.some((m) => m && typeof m.id !== "undefined" && m.id !== null);
  if (!hasAnyRequestWithId) {
    return res.status(202).end();
  }

  const responses = [];

  for (const msg of msgs) {
    try {
      if (!msg || msg.jsonrpc !== "2.0") {
        responses.push({
          jsonrpc: "2.0",
          id: msg?.id ?? null,
          error: { code: -32600, message: "Invalid Request" },
        });
        continue;
      }

      const { id, method, params } = msg;

      // Enforce session after initialize
      if (method !== "initialize") {
        const sid = getSession(req);
        if (!sid) {
          responses.push({
            jsonrpc: "2.0",
            id,
            error: { code: -32001, message: "Missing or invalid Mcp-Session-Id" },
          });
          continue;
        }
      }

      if (method === "initialize") {
        const sessionId = newSessionId();
        sessions.set(sessionId, { createdAt: Date.now() });

        // Include session header per transport spec session management :contentReference[oaicite:3]{index=3}
        res.setHeader("Mcp-Session-Id", sessionId);

        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
            },
            serverInfo: {
              name: "bcgpt",
              title: "Basecamp GPT MCP Server",
              version: "1.0.0",
            },
            instructions:
              "Use tools/list to see available tools. Use tools/call to execute list_projects.",
          },
        });
        continue;
      }

      if (method === "tools/list") {
        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            tools: MCP_TOOLS,
            // nextCursor omitted (no pagination)
          },
        });
        continue;
      }

      if (method === "tools/call") {
        const name = params?.name;
        const args = params?.arguments || {};

        if (name !== "list_projects") {
          responses.push({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: `Unknown tool: ${name}` },
          });
          continue;
        }

        // Validate args (none expected)
        if (args && Object.keys(args).length > 0) {
          responses.push({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "list_projects takes no arguments" },
          });
          continue;
        }

        const data = await fetchProjectsFromBasecamp();
        if (!data.ok) {
          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `Failed to list projects (${data.status}): ${String(data.error).slice(0, 1500)}`,
                },
              ],
              isError: true,
            },
          });
          continue;
        }

        // Create a friendly compact summary
        const projects = Array.isArray(data.projects) ? data.projects : [];
        const summary = projects
          .slice(0, 50)
          .map((p) => `• ${p.name} (id: ${p.id})`)
          .join("\n");

        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text:
                  `Found ${projects.length} project(s) in account ${data.accountId}.\n\n` +
                  (summary || "(No projects returned.)"),
              },
            ],
            structuredContent: {
              accountId: data.accountId,
              projects: projects.map((p) => ({ id: p.id, name: p.name })),
            },
            isError: false,
          },
        });
        continue;
      }

      // Any other method
      responses.push({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    } catch (err) {
      responses.push({
        jsonrpc: "2.0",
        id: msg?.id ?? null,
        error: { code: -32000, message: "Server error", data: String(err?.message || err) },
      });
    }
  }

  // If original was single, respond single
  if (!Array.isArray(payload)) return res.status(200).send(JSON.stringify(responses[0]));
  return res.status(200).send(JSON.stringify(responses));
});


app.get("/", (req, res) => res.send("bcgpt server running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
