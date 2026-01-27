import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import fetch from "node-fetch";
import initSqlJs from "sql.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const APP_BASE_URL = process.env.APP_BASE_URL || "https://bcgpt.onrender.com";
const BASECAMP_CLIENT_ID = process.env.BASECAMP_CLIENT_ID;
const BASECAMP_CLIENT_SECRET = process.env.BASECAMP_CLIENT_SECRET;
const UA = "bcgpt";

/* -------------------- SQLITE (IN-MEMORY) -------------------- */
let db;

async function getDB() {
  if (db) return db;

  const SQL = await initSqlJs({});
  db = new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS basecamp_tokens (
      mcp_session_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      mcp_session_id TEXT NOT NULL
    );
  `);

  return db;
}

/* -------------------- MCP SESSION TRACKING -------------------- */
const mcpSessions = new Set();

/* -------------------- BASECAMP CONNECT -------------------- */
app.get("/connect", async (req, res) => {
  const mcpSessionId = req.query.mcp_session;
  if (!mcpSessionId) {
    return res.send("Missing MCP session. Open this link from ChatGPT.");
  }

  const db = await getDB();
  const state = crypto.randomBytes(16).toString("hex");

  db.run(
    "INSERT INTO oauth_states VALUES (?, ?)",
    [state, mcpSessionId]
  );

  const redirectUri = `${APP_BASE_URL}/auth/basecamp/callback`;

  const url =
    "https://launchpad.37signals.com/authorization/new" +
    `?type=web_server` +
    `&client_id=${BASECAMP_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  res.redirect(url);
});

/* -------------------- BASECAMP CALLBACK -------------------- */
app.get("/auth/basecamp/callback", async (req, res) => {
  const { code, state } = req.query;
  const db = await getDB();

  const row = db.exec(
    "SELECT mcp_session_id FROM oauth_states WHERE state = ?",
    [state]
  )[0];

  if (!row) return res.send("Invalid or expired OAuth state.");

  const mcpSessionId = row.values[0][0];

  const tokenRes = await fetch(
    "https://launchpad.37signals.com/authorization/token?type=web_server",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        type: "web_server",
        client_id: BASECAMP_CLIENT_ID,
        client_secret: BASECAMP_CLIENT_SECRET,
        redirect_uri: `${APP_BASE_URL}/auth/basecamp/callback`,
        code
      })
    }
  );

  const token = await tokenRes.json();

  db.run(
    "INSERT OR REPLACE INTO basecamp_tokens VALUES (?, ?, ?)",
    [mcpSessionId, token.access_token, new Date().toISOString()]
  );

  db.run("DELETE FROM oauth_states WHERE state = ?", [state]);

  res.send(`
    <h2>✅ Basecamp connected</h2>
    <p>Return to ChatGPT and type:</p>
    <b>list my projects</b>
  `);
});

/* -------------------- MCP SERVER -------------------- */
app.post("/mcp", async (req, res) => {
  const msg = req.body;
  res.setHeader("Content-Type", "application/json");

  /* ---------- INIT ---------- */
  if (msg.method === "initialize") {
    const sid = "mcp_" + crypto.randomBytes(8).toString("hex");
    mcpSessions.add(sid);
    res.setHeader("Mcp-Session-Id", sid);

    return res.json({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "bcgpt" },
        capabilities: { tools: {} },
        instructions: `
When the user says "login to basecamp", ALWAYS call tool "login_to_basecamp".
Never respond in plain text for login.

When the user asks for projects, call "list_projects".
`
      }
    });
  }

  const mcpSessionId = req.headers["mcp-session-id"];
  if (!mcpSessions.has(mcpSessionId)) {
    return res.json({
      jsonrpc: "2.0",
      id: msg.id,
      error: { message: "Invalid MCP session" }
    });
  }

  /* ---------- LIST TOOLS ---------- */
  if (msg.method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "login_to_basecamp",
            description: "Login or check Basecamp connection status",
            inputSchema: { type: "object" }
          },
          {
            name: "list_projects",
            description: "List Basecamp projects",
            inputSchema: { type: "object" }
          }
        ]
      }
    });
  }

  /* ---------- CALL TOOLS ---------- */
  if (msg.method === "tools/call") {
    const tool = msg.params.name;
    const db = await getDB();

    /* ----- LOGIN TOOL ----- */
    if (tool === "login_to_basecamp") {
      const row = db.exec(
        "SELECT access_token FROM basecamp_tokens WHERE mcp_session_id = ?",
        [mcpSessionId]
      )[0];

      if (row) {
        return res.json({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            isError: false,
            content: [
              {
                type: "text",
                text:
                  "✅ Basecamp is already connected.\n\nYou can now type:\nlist my projects"
              }
            ]
          }
        });
      }

      return res.json({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          isError: false,
          content: [
            {
              type: "text",
              text:
                "🔐 Click here to connect Basecamp:\n" +
                `${APP_BASE_URL}/connect?mcp_session=${mcpSessionId}`
            }
          ]
        }
      });
    }

    /* ----- LIST PROJECTS TOOL ----- */
    if (tool === "list_projects") {
      const row = db.exec(
        "SELECT access_token FROM basecamp_tokens WHERE mcp_session_id = ?",
        [mcpSessionId]
      )[0];

      if (!row) {
        return res.json({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: "❌ Not connected. Type:\nlogin to basecamp"
              }
            ]
          }
        });
      }

      const accessToken = row.values[0][0];

      const auth = await fetch(
        "https://launchpad.37signals.com/authorization.json",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": UA
          }
        }
      ).then(r => r.json());

      const accountId = auth.accounts[0].id;

      const projects = await fetch(
        `https://3.basecampapi.com/${accountId}/projects.json`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": UA
          }
        }
      ).then(r => r.json());

      return res.json({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          isError: false,
          content: [
            {
              type: "text",
              text: projects.map(p => `• ${p.name}`).join("\n")
            }
          ]
        }
      });
    }
  }
});

/* -------------------- ROOT -------------------- */
app.get("/", (_, res) => res.send("bcgpt running"));

app.listen(3000, () => console.log("🚀 bcgpt running"));
