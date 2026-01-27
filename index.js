import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import { execSync } from "child_process";
import { db } from "./db.js";

dotenv.config();

// Run migrations on boot (MVP)
try {
  execSync("npx knex migrate:latest --knexfile knexfile.cjs", { stdio: "inherit" });
} catch (e) {
  console.error("Migration failed:", e?.message || e);
}

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const UA = "bcgpt (bcgpt.onrender.com)";

const APP_BASE_URL = process.env.APP_BASE_URL || "https://bcgpt.onrender.com";
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 168); // 7 days
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

const BASECAMP_CLIENT_ID = process.env.BASECAMP_CLIENT_ID;
const BASECAMP_CLIENT_SECRET = process.env.BASECAMP_CLIENT_SECRET;
const BASECAMP_DEFAULT_ACCOUNT_ID = Number(process.env.BASECAMP_DEFAULT_ACCOUNT_ID || 0);

if (!BASECAMP_CLIENT_ID || !BASECAMP_CLIENT_SECRET) {
  console.warn("Missing BASECAMP_CLIENT_ID or BASECAMP_CLIENT_SECRET");
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomDigits(len = 6) {
  let s = "";
  while (s.length < len) s += Math.floor(Math.random() * 10);
  return s.slice(0, len);
}

function randomToken(prefix = "bcgpt") {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

function htmlPage(title, body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;max-width:680px;margin:0 auto;}
    .card{border:1px solid #e6e6e6;border-radius:12px;padding:16px;}
    input,button{font-size:16px;padding:12px;border-radius:10px;border:1px solid #d0d0d0;width:100%;box-sizing:border-box;}
    button{background:#111;color:#fff;border:none;cursor:pointer;margin-top:12px;}
    .muted{color:#666;font-size:13px;margin-top:10px;}
    code{background:#f5f5f5;padding:4px 8px;border-radius:8px;display:inline-block;word-break:break-all;}
    a{color:#116AD0;text-decoration:none;}
    hr{border:none;border-top:1px solid #eee;margin:16px 0;}
  </style>
</head>
<body>
  <h2>${title}</h2>
  <div class="card">${body}</div>
</body>
</html>`;
}

/** Authorization: Bearer <sessionToken> -> user */
async function getUserFromBearer(req) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const token = m[1].trim();
  if (!token) return null;

  const sessionHash = sha256(token);
  const now = new Date();

  const row = await db("sessions")
    .join("users", "users.id", "sessions.user_id")
    .select("users.id", "users.email", "users.name")
    .where("sessions.session_hash", sessionHash)
    .andWhere("sessions.expires_at", ">", now)
    .orderBy("sessions.id", "desc")
    .first();

  return row || null;
}

// -------------------- OTP LOGIN --------------------

app.get("/login", (req, res) => {
  const body = `
    <form method="POST" action="/login">
      <label>Email</label>
      <input name="email" type="email" placeholder="name@company.com" required />
      <button type="submit">Send login code</button>
      <p class="muted">We’ll generate a 6-digit code valid for ${OTP_TTL_MINUTES} minutes.</p>
    </form>
  `;
  res.type("html").send(htmlPage("Login", body));
});

app.post("/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return res.status(400).type("html").send(htmlPage("Login", "<p>Invalid email.</p>"));
    }

    const otp = randomDigits(6);
    const otpHash = sha256(`${email}:${otp}:${process.env.OTP_SECRET || "devsecret"}`);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await db("otps").insert({
      email,
      otp_hash: otpHash,
      expires_at: expiresAt,
      attempts: 0,
      created_at: new Date(),
    });

    // MVP delivery = server logs
    console.log(`[OTP] email=${email} code=${otp} expires=${expiresAt.toISOString()}`);

    res.redirect(`/verify?email=${encodeURIComponent(email)}`);
  } catch (e) {
    console.error(e);
    res.status(500).type("html").send(htmlPage("Login", "<p>Server error.</p>"));
  }
});

app.get("/verify", (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  const body = `
    <form method="POST" action="/verify">
      <input type="hidden" name="email" value="${email.replace(/"/g, "&quot;")}" />
      <label>6-digit code (check server logs)</label>
      <input name="code" inputmode="numeric" pattern="[0-9]{6}" placeholder="123456" required />
      <button type="submit">Verify</button>
      <p class="muted">After verification, you’ll get a Session Code to paste into ChatGPT.</p>
    </form>
  `;
  res.type("html").send(htmlPage("Verify", body));
});

app.post("/verify", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();

    if (!email || !code || code.length !== 6) {
      return res.status(400).type("html").send(htmlPage("Verify", "<p>Invalid email or code.</p>"));
    }

    const now = new Date();

    const otpRow = await db("otps")
      .where({ email })
      .andWhere("expires_at", ">", now)
      .orderBy("id", "desc")
      .first();

    if (!otpRow) {
      return res
        .status(400)
        .type("html")
        .send(htmlPage("Verify", `<p>Code expired. Please <a href="/login">try again</a>.</p>`));
    }

    if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
      return res
        .status(429)
        .type("html")
        .send(htmlPage("Verify", `<p>Too many attempts. Please <a href="/login">request a new code</a>.</p>`));
    }

    const expected = sha256(`${email}:${code}:${process.env.OTP_SECRET || "devsecret"}`);
    if (expected !== otpRow.otp_hash) {
      await db("otps").where({ id: otpRow.id }).update({ attempts: otpRow.attempts + 1 });
      return res.status(400).type("html").send(htmlPage("Verify", "<p>Incorrect code.</p>"));
    }

    // Upsert user (SQLite-friendly)
    let user = await db("users").where({ email }).first();
    if (!user) {
      const id = crypto.randomUUID();
      await db("users").insert({ id, email, created_at: new Date() });
      user = await db("users").where({ email }).first();
    }

    // Create session
    const sessionToken = randomToken("bcgpt");
    const sessionHash = sha256(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

    await db("sessions").insert({
      user_id: user.id,
      session_hash: sessionHash,
      expires_at: expiresAt,
      created_at: new Date(),
    });

    // One-time use OTP
    await db("otps").where({ id: otpRow.id }).del();

    const connectUrl = `${APP_BASE_URL}/connect/basecamp?session=${encodeURIComponent(sessionToken)}`;

    const body = `
      <p>✅ Login successful for <b>${user.email}</b></p>
      <p>Copy this <b>Session Code</b> and paste it into ChatGPT:</p>
      <p><code>${sessionToken}</code></p>
      <p class="muted">Session expires on ${expiresAt.toISOString()}.</p>
      <hr/>
      <p>Next: connect Basecamp:</p>
      <p><a href="${connectUrl}">Connect Basecamp</a></p>
    `;
    res.type("html").send(htmlPage("Session Ready", body));
  } catch (e) {
    console.error(e);
    res.status(500).type("html").send(htmlPage("Verify", "<p>Server error.</p>"));
  }
});

// -------------------- BASECAMP PER-USER CONNECT --------------------

app.get("/connect/basecamp", async (req, res) => {
  try {
    const sessionToken = String(req.query.session || "").trim();
    if (!sessionToken) return res.status(400).type("html").send(htmlPage("Error", "<p>Missing session.</p>"));

    const sessionHash = sha256(sessionToken);
    const now = new Date();

    const sRow = await db("sessions")
      .join("users", "users.id", "sessions.user_id")
      .select("users.id as user_id", "users.email")
      .where("sessions.session_hash", sessionHash)
      .andWhere("sessions.expires_at", ">", now)
      .orderBy("sessions.id", "desc")
      .first();

    if (!sRow) {
      return res.status(401).type("html").send(htmlPage("Error", "<p>Session invalid/expired. Go to /login.</p>"));
    }

    if (!BASECAMP_CLIENT_ID) {
      return res.status(500).type("html").send(htmlPage("Error", "<p>Missing BASECAMP_CLIENT_ID.</p>"));
    }

    const state = "st_" + crypto.randomBytes(20).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db("oauth_states").insert({
      state,
      user_id: sRow.user_id,
      expires_at: expiresAt,
      created_at: new Date(),
    });

    const redirectUri = `${APP_BASE_URL}/auth/basecamp/callback`;

    const authUrl =
      "https://launchpad.37signals.com/authorization/new?type=web_server" +
      `&client_id=${encodeURIComponent(BASECAMP_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`;

    res.redirect(authUrl);
  } catch (e) {
    console.error(e);
    res.status(500).type("html").send(htmlPage("Error", "<p>Server error.</p>"));
  }
});

app.get("/auth/basecamp/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) return res.status(400).type("html").send(htmlPage("OAuth error", `<p>${error}</p>`));
    if (!code || !state) return res.status(400).type("html").send(htmlPage("Error", "<p>Missing code/state.</p>"));

    const now = new Date();
    const st = await db("oauth_states")
      .where({ state: String(state) })
      .andWhere("expires_at", ">", now)
      .first();

    if (!st) return res.status(400).type("html").send(htmlPage("Error", "<p>State invalid/expired.</p>"));

    if (!BASECAMP_CLIENT_SECRET) {
      return res.status(500).type("html").send(htmlPage("Error", "<p>Missing BASECAMP_CLIENT_SECRET.</p>"));
    }

    const redirectUri = `${APP_BASE_URL}/auth/basecamp/callback`;

    const body = new URLSearchParams({
      type: "web_server",
      client_id: BASECAMP_CLIENT_ID,
      client_secret: BASECAMP_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code: String(code),
    });

    const tokenResp = await fetch(
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

    const text = await tokenResp.text();
    if (!tokenResp.ok) {
      return res.status(500).type("html").send(htmlPage("Error", `<p>Token exchange failed.</p><pre>${text}</pre>`));
    }

    const tokenJson = JSON.parse(text);

    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token || null;
    const expiresAt =
      tokenJson.expires_in ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000) : null;

    // Upsert basecamp_tokens row (SQLite: delete/insert or update existing)
    const existing = await db("basecamp_tokens").where({ user_id: st.user_id }).first();
    if (existing) {
      await db("basecamp_tokens")
        .where({ user_id: st.user_id })
        .update({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: expiresAt,
          default_account_id: BASECAMP_DEFAULT_ACCOUNT_ID || null,
          updated_at: new Date(),
        });
    } else {
      await db("basecamp_tokens").insert({
        user_id: st.user_id,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        default_account_id: BASECAMP_DEFAULT_ACCOUNT_ID || null,
        updated_at: new Date(),
      });
    }

    // one-time state
    await db("oauth_states").where({ state: String(state) }).del();

    res
      .type("html")
      .send(htmlPage("Basecamp Connected", `<p>✅ Basecamp connected successfully.</p><p>Return to ChatGPT and run <b>list projects</b>.</p>`));
  } catch (e) {
    console.error(e);
    res.status(500).type("html").send(htmlPage("Error", "<p>Server error.</p>"));
  }
});

// -------------------- MCP (Streamable HTTP) --------------------

const MCP_PROTOCOL_VERSION = "2025-06-18";
const ORIGIN_ALLOWLIST = new Set(["https://chatgpt.com", "https://chat.openai.com", APP_BASE_URL]);

function checkOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!ORIGIN_ALLOWLIST.has(origin)) {
    res.status(403).json({ error: "Origin not allowed" });
    return false;
  }
  return true;
}

const mcpSessions = new Map();
function newMcpSessionId() {
  return "mcp_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function getMcpSession(req) {
  const sid = req.headers["mcp-session-id"];
  if (!sid) return null;
  return mcpSessions.get(sid) ? sid : null;
}

const MCP_TOOLS = [
  {
    name: "list_projects",
    title: "List Basecamp projects",
    description:
      "Lists Basecamp projects for the currently logged-in bcgpt user. Requires Authorization: Bearer <Session Code>.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
];

async function fetchProjectsForUser(userId) {
  const tokenRow = await db("basecamp_tokens").where({ user_id: userId }).first();
  if (!tokenRow?.access_token) {
    return { ok: false, status: 401, error: "Basecamp not connected for this user. Open /connect/basecamp?session=..." };
  }

  const accessToken = tokenRow.access_token;
  const preferredAccountId = Number(tokenRow.default_account_id || BASECAMP_DEFAULT_ACCOUNT_ID || 0);

  const authResp = await fetch("https://launchpad.37signals.com/authorization.json", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": UA },
  });

  if (!authResp.ok) return { ok: false, status: authResp.status, error: await authResp.text() };

  const authJson = await authResp.json();
  const accounts = authJson?.accounts || [];
  if (!accounts.length) return { ok: false, status: 404, error: "No Basecamp accounts found." };

  let account = accounts[0];
  if (preferredAccountId) {
    const match = accounts.find((a) => Number(a.id) === preferredAccountId);
    if (!match) {
      return {
        ok: false,
        status: 404,
        error: `Default account ${preferredAccountId} not found for this user. Available: ${accounts
          .map((a) => a.id)
          .join(", ")}`,
      };
    }
    account = match;
  }

  const accountId = account.id;
  const projectsUrl = `https://3.basecampapi.com/${accountId}/projects.json`;

  const projectsResp = await fetch(projectsUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": UA },
  });

  if (!projectsResp.ok) return { ok: false, status: projectsResp.status, error: await projectsResp.text() };

  const projects = await projectsResp.json();
  return { ok: true, accountId, projects };
}

app.get("/mcp", (req, res) => {
  if (!checkOrigin(req, res)) return;
  const accept = req.headers.accept || "";
  if (!accept.includes("text/event-stream")) return res.status(405).send("Method Not Allowed");

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const interval = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 25000);
  req.on("close", () => clearInterval(interval));
});

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

      if (method !== "initialize") {
        const sid = getMcpSession(req);
        if (!sid) {
          responses.push({ jsonrpc: "2.0", id, error: { code: -32001, message: "Missing or invalid Mcp-Session-Id" } });
          continue;
        }
      }

      if (method === "initialize") {
        const sessionId = newMcpSessionId();
        mcpSessions.set(sessionId, { createdAt: Date.now() });
        res.setHeader("Mcp-Session-Id", sessionId);

        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "bcgpt", title: "Basecamp GPT MCP Server", version: "1.0.0" },
            instructions:
              "Login flow: 1) /login 2) verify OTP 3) copy Session Code 4) /connect/basecamp?session=... 5) call tools with Authorization: Bearer <Session Code>.",
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

        if (name !== "list_projects") {
          responses.push({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } });
          continue;
        }
        if (args && Object.keys(args).length) {
          responses.push({ jsonrpc: "2.0", id, error: { code: -32602, message: "list_projects takes no arguments" } });
          continue;
        }

        const user = await getUserFromBearer(req);
        if (!user) {
          responses.push({
            jsonrpc: "2.0",
            id,
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text:
                    "Not logged in.\n\n1) Open /login\n2) Verify OTP\n3) Copy Session Code\n4) Open /connect/basecamp?session=<Session Code>\n5) Call tools with Authorization: Bearer <Session Code>",
                },
              ],
            },
          });
          continue;
        }

        const data = await fetchProjectsForUser(user.id);
        if (!data.ok) {
          responses.push({
            jsonrpc: "2.0",
            id,
            result: { isError: true, content: [{ type: "text", text: `Failed (${data.status}): ${String(data.error).slice(0, 1500)}` }] },
          });
          continue;
        }

        const projects = Array.isArray(data.projects) ? data.projects : [];
        const summary = projects
          .slice(0, 60)
          .map((p) => `• ${p.name} (id: ${p.id})`)
          .join("\n");

        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            isError: false,
            content: [
              {
                type: "text",
                text: `User: ${user.email}\nAccount: ${data.accountId}\nProjects: ${projects.length}\n\n${summary || "(none)"}`,
              },
            ],
            structuredContent: {
              user: { email: user.email, id: user.id },
              accountId: data.accountId,
              projects: projects.map((p) => ({ id: p.id, name: p.name })),
            },
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

  if (!Array.isArray(payload)) return res.status(200).json(responses[0]);
  return res.status(200).json(responses);
});

// -------------------- DEBUG --------------------

app.get("/debug/whoami", async (req, res) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ logged_in: false });
  res.json({ logged_in: true, user });
});

app.get("/debug/sqlite", async (req, res) => {
  try {
    const r = await db.raw("select datetime('now') as now");
    // knex sqlite returns [ { now: '...' } ] in some versions
    res.json({ ok: true, now: r?.[0]?.now || r });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/", (req, res) => res.send("bcgpt server running (sqlite + otp + basecamp + mcp)"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
