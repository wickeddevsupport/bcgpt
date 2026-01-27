import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const UA = "bcgpt (bcgpt.onrender.com)";
const BUILD_ID = "v4-mcp-authbasecampstart";

const {
  BASECAMP_CLIENT_ID,
  BASECAMP_CLIENT_SECRET,
  APP_BASE_URL = "https://bcgpt.onrender.com",
} = process.env;

if (!BASECAMP_CLIENT_ID || !BASECAMP_CLIENT_SECRET) {
  console.warn("Missing BASECAMP_CLIENT_ID or BASECAMP_CLIENT_SECRET");
}

/* ------------------------------------------------------------------
   EXISTING WORKING LOGIC (UNCHANGED)
------------------------------------------------------------------ */

// Temporary in-memory store (OK for testing)
const tokenStore = new Map();

// expire OAuth state after 10 minutes
const STATE_TTL_MS = 10 * 60 * 1000;

function getToken() {
  return tokenStore.get("basecamp:token");
}

function requireToken(req, res) {
  const t = getToken();
  if (!t?.access_token) {
    res
      .status(401)
      .json({ error: "Not connected. Visit /auth/basecamp/start first." });
    return null;
  }
  return t;
}

/* -------------------- HEALTH / DEBUG -------------------- */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    build: BUILD_ID,
    node: process.version,
    hasClientId: Boolean(BASECAMP_CLIENT_ID),
    hasClientSecret: Boolean(BASECAMP_CLIENT_SECRET),
  });
});

app.get("/debug/routes", (req, res) => {
  const routes = [];
  const stack = app?._router?.stack || [];
  for (const layer of stack) {
    if (layer?.route?.path) {
      const methods = Object.keys(layer.route.methods)
        .join(",")
        .toUpperCase();
      routes.push(`${methods} ${layer.route.path}`);
    }
  }
  res.type("text/plain").send(routes.join("\n"));
});

/* -------------------- AUTH BASECAMP (WORKING FLOW) -------------------- */

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

    tokenStore.set("basecamp:token", tokenJson);
    tokenStore.delete(`state:${state}`);

    res.send("✅ Basecamp connected successfully. You can return to ChatGPT.");
  } catch (e) {
    console.error(e);
    res.status(500).send("Callback error: " + (e?.message || "unknown"));
  }
});

/* -------------------- DEBUG DATA -------------------- */

app.get("/debug/token", (req, res) => {
  const t = getToken();
  res.json({
    connected: Boolean(t?.access_token),
    tokenKeys: t ? Object.keys(t) : [],
  });
});

app.get("/debug/projects", async (req, res) => {
  try {
    const t = requireToken(req, res);
    if (!t) return;

    const authResp = await fetch(
      "https://launchpad.37signals.com/authorization.json",
      {
        headers: {
          Authorization: `Bearer ${t.access_token}`,
          "User-Agent": UA,
        },
      }
    );

    const authJson = await authResp.json();
    const accountId = authJson.accounts[0].id;

    const projectsResp = await fetch(
      `https://3.basecampapi.com/${accountId}/projects.json`,
      {
        headers: {
          Authorization: `Bearer ${t.access_token}`,
          "User-Agent": UA,
        },
      }
    );

    const text = await projectsResp.text();
    res.type("application/json").send(text);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e?.message || "unknown" });
  }
});

/* ------------------------------------------------------------------
   MCP SERVER (ADDED — DOES NOT BREAK EXISTING FLOW)
------------------------------------------------------------------ */

const MCP_PROTOCOL_VERSION = "2025-06-18";

app.post("/mcp", async (req, res) => {
  const msg = req.body;
  res.setHeader("Content-Type", "application/json");

  /* -------- INIT -------- */
  if (msg.method === "initialize") {
    return res.json({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: "bcgpt" },
        instructions: `
Use /authbasecampstart to begin Basecamp login.
After approval, you can use list_projects.
`,
      },
    });
  }

  /* -------- TOOLS LIST -------- */
  if (msg.method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "/authbasecampstart",
            description: "Start Basecamp authentication",
            inputSchema: { type: "object" },
          },
          {
            name: "list_projects",
            description: "List Basecamp projects",
            inputSchema: { type: "object" },
          },
        ],
      },
    });
  }

  /* -------- TOOLS CALL -------- */
  if (msg.method === "tools/call") {
    const tool = msg.params.name;

    /* ---- AUTH START TOOL ---- */
    if (tool === "/authbasecampstart") {
      return res.json({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [
            {
              type: "text",
              text:
                "🔐 Click to connect Basecamp:\n" +
                `${APP_BASE_URL}/auth/basecamp/start`,
            },
          ],
        },
      });
    }

    /* ---- LIST PROJECTS TOOL ---- */
    if (tool === "list_projects") {
      const t = getToken();
      if (!t?.access_token) {
        return res.json({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [
              {
                type: "text",
                text:
                  "❌ Not connected.\nType:\n/authbasecampstart",
              },
            ],
          },
        });
      }

      const r = await fetch(`${APP_BASE_URL}/debug/projects`);
      const text = await r.text();

      return res.json({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text }],
        },
      });
    }
  }
});

/* -------------------- ROOT -------------------- */
app.get("/", (req, res) =>
  res.send(`bcgpt server running :: ${BUILD_ID}`)
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Listening on", PORT, BUILD_ID)
);
