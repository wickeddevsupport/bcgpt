import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import fetch from "node-fetch";
import { db } from "./db.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const APP_BASE_URL = process.env.APP_BASE_URL || "https://bcgpt.onrender.com";
const BASECAMP_CLIENT_ID = process.env.BASECAMP_CLIENT_ID;
const BASECAMP_CLIENT_SECRET = process.env.BASECAMP_CLIENT_SECRET;
const UA = "bcgpt";

if (!BASECAMP_CLIENT_ID || !BASECAMP_CLIENT_SECRET) {
  console.warn("⚠️ Missing Basecamp OAuth env vars");
}

/* ----------------- DB INIT (AUTO) ----------------- */
await db.schema.createTableIfNotExists("basecamp_tokens", (t) => {
  t.string("mcp_session_id").primary();
  t.text("access_token").notNullable();
  t.text("refresh_token");
  t.timestamp("updated_at").defaultTo(db.fn.now());
});

await db.schema.createTableIfNotExists("oauth_states", (t) => {
  t.string("state").primary();
  t.string("mcp_session_id").notNullable();
  t.timestamp("created_at").defaultTo(db.fn.now());
});

/* ----------------- CONNECT BASECAMP ----------------- */
app.get("/connect", async (req, res) => {
  const mcpSessionId = req.query.mcp_session;
  if (!mcpSessionId) {
    return res.send("Missing MCP session. Open this link from ChatGPT.");
  }

  const state = crypto.randomBytes(20).toString("hex");

  await db("oauth_states").insert({
    state,
    mcp_session_id: mcpSessionId
  });

  const redirectUri = `${APP_BASE_URL}/auth/basecamp/callback`;

  const url =
    "https://launchpad.37signals.com/authorization/new" +
    `?type=web_server` +
    `&client_id=${BASECAMP_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  res.redirect(url);
});

/* ----------------- BASECAMP CALLBACK ----------------- */
app.get("/auth/basecamp/callback", async (req, res) => {
  const { code, state } = req.query;

  const row = await db("oauth_states").where({ state }).first();
  if (!row) return res.send("Invalid or expired state.");

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

  await db("basecamp_tokens")
    .insert({
      mcp_session_id: row.mcp_session_id,
      access_token: token.access_token,
      refresh_token: token.refresh_token || null,
      updated_at: new Date()
    })
    .onConflict("mcp_session_id")
    .merge();

  await db("oauth_states").where({ state }).del();

  res.send(`
    <h2>✅ Basecamp connected</h2>
    <p>Return to ChatGPT and type:</p>
    <b>list my projects</b>
  `);
});

/* ----------------- MCP SERVER ----------------- */

const MCP_PROTOCOL_VERSION = "2025-06-18";
const mcpSessions = new Set();

app.post("/mcp", async (req, res) => {
  const msg = req.body;
  res.setHeader("Content-Type", "application/json");

  if (msg.method === "initialize") {
    const sid = "mcp_" + crypto.randomBytes(8).toString("hex");
    mcpSessions.add(sid);
    res.setHeader("Mcp-Session-Id", sid);

    return res.json({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: "bcgpt" },
        capabilities: { tools: {} },
        instructions: `
Type "login to basecamp" to connect.
One click. No tokens. No login codes.
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

  if (msg.method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "list_projects",
            description: "List Basecamp projects",
            inputSchema: { type: "object" }
          }
        ]
      }
    });
  }

  if (msg.method === "tools/call") {
    const tokenRow = await db("basecamp_tokens")
      .where({ mcp_session_id: mcpSessionId })
      .first();

    if (!tokenRow) {
      return res.json({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "Not connected.\n\nClick here:\n" +
                `${APP_BASE_URL}/connect?mcp_session=${mcpSessionId}`
            }
          ]
        }
      });
    }

    const auth = await fetch(
      "https://launchpad.37signals.com/authorization.json",
      {
        headers: {
          Authorization: `Bearer ${tokenRow.access_token}`,
          "User-Agent": UA
        }
      }
    ).then((r) => r.json());

    const accountId = auth.accounts[0].id;

    const projects = await fetch(
      `https://3.basecampapi.com/${accountId}/projects.json`,
      {
        headers: {
          Authorization: `Bearer ${tokenRow.access_token}`,
          "User-Agent": UA
        }
      }
    ).then((r) => r.json());

    return res.json({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        isError: false,
        content: [
          {
            type: "text",
            text: projects.map((p) => `• ${p.name}`).join("\n")
          }
        ]
      }
    });
  }
});

/* ----------------- ROOT ----------------- */
app.get("/", (req, res) => res.send("bcgpt running"));

app.listen(3000, () => console.log("🚀 bcgpt running"));
