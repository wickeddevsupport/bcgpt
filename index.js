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

/* ---------------- SQLITE (IN-MEMORY) ---------------- */
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

/* ---------------- MCP SESSION TRACKING ---------------- */
const mcpSessions = new Set();

/* ---------------- BASECAMP CONNECT ---------------- */
app.get("/connect", async (req, res) => {
  const mcpSessionId = req.query.mcp_session;
  if (!mcpSessionId) return res.send("Missing MCP session.");

  const db = await getDB();
  const state = crypto.randomBytes(16).toString("hex");

  db.run("INSERT INTO oauth_states VALUES (?, ?)", [state, mcpSessionId]);

  const redirectUri = `${APP_BASE_URL}/auth/basecamp/callback`;
  const url =
    "https://launchpad.37signals.com/authorization/new" +
    `?type=web_server` +
    `&client_id=${BASECAMP_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  res.redirect(url);
});

/* ---------------- BASECAMP CALLBACK ---------------- */
app.get("/auth/basecamp/callback", async (req, res) => {
  const { code, state } = req.query;
  const db = await getDB();

  const row = db.exec(
    "SELECT mcp_session_id FROM oauth_states WHERE state = ?",
    [state]
  )[0];

  if (!row) return res.send("Invalid OAuth state.");

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

/* ---------------- MCP SERVER ---------------- */
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
        instructions: `
Use commands:
• /login — connect Basecamp
• /status — connection status
• /logout — disconnect
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

  /* ---------- TOOL LIST ---------- */
  if (msg.method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          { name: "/login", description: "Connect Basecamp" },
          { name: "/status", description: "Check Basecamp status" },
          { name: "/logout", description: "Disconnect Basecamp" },
          { name: "list_projects", description: "List Basecamp projects" }
        ]
      }
    });
  }

  /* ---------- TOOL CALL ---------- */
  if (msg.method === "tools/call") {
    const tool = msg.params.name;
    const db = await getDB();

    /* /login */
    if (tool === "/login") {
      const row = db.exec(
        "SELECT 1 FROM basecamp_tokens WHERE mcp_session_id = ?",
        [mcpSessionId]
      )[0];

      if (row) {
        return res.json({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [{ type: "text", text: "✅ Already connected." }]
          }
        });
      }

      return res.json({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{
            type: "text",
            text: `Click to connect:\n${APP_BASE_URL}/connect?mcp_session=${mcpSessionId}`
          }]
        }
      });
    }

    /* /status */
    if (tool === "/status") {
      const row = db.exec(
        "SELECT updated_at FROM basecamp_tokens WHERE mcp_session_id = ?",
        [mcpSessionId]
      )[0];

      return res.json({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{
            type: "text",
            text: row
              ? `✅ Connected (since ${row.values[0][0]})`
              : "❌ Not connected. Type /login"
          }]
        }
      });
    }

    /* /logout */
    if (tool === "/logout") {
      db.run(
        "DELETE FROM basecamp_tokens WHERE mcp_session_id = ?",
        [mcpSessionId]
      );

      return res.json({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: "👋 Logged out. Type /login to reconnect." }]
        }
      });
    }

    /* list_projects */
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
            content: [{ type: "text", text: "❌ Not connected. Type /login" }]
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
          content: [{
            type: "text",
            text: projects.map(p => `• ${p.name}`).join("\n")
          }]
        }
      });
    }
  }
});

/* ---------------- ROOT ---------------- */
app.get("/", (_, res) => res.send("bcgpt running"));
app.listen(3000, () => console.log("🚀 bcgpt running"));
