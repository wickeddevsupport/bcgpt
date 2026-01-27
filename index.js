import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import { q } from "./db.js";

dotenv.config();

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
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;max-width:620px;margin:0 auto;}
    .card{border:1px solid #e6e6e6;border-radius:12px;padding:16px;}
    input,button{font-size:16px;padding:12px;border-radius:10px;border:1px solid #d0d0d0;width:100%;box-sizing:border-box;}
    button{background:#111;color:#fff;border:none;cursor:pointer;margin-top:12px;}
    .muted{color:#666;font-size:13px;margin-top:10px;}
    code{background:#f5f5f5;padding:4px 8px;border-radius:8px;display:inline-block;}
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

/** Reads Authorization: Bearer <sessionToken> and returns user row or null */
async function getUserFromBearer(req) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const token = m[1].trim();
  if (!token) return null;

  const sessionHash = sha256(token);
  const now = new Date();

  const res = await q(
    `
    SELECT u.id, u.email, u.name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.session_hash = $1 AND s.expires_at > $2
    ORDER BY s.id DESC
    LIMIT 1
    `,
    [sessionHash, now]
  );

  return res.rows[0] || null;
}

function requireUser(req, res) {
  return getUserFromBearer(req).then((user) => {
    if (!user) {
      res.status(401).json({
        error:
          "Not logged in. Go to /login, verify OTP, then use Authorization: Bearer <Session Code>.",
      });
      return null;
    }
    return user;
  });
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
    const emailRaw = String(req.body.email || "").trim().toLowerCase();
    if (!emailRaw || !emailRaw.includes("@")) {
      return res.status(400).type("html").send(htmlPage("Login", `<p>Invalid email.</p>`));
    }

    const otp = randomDigits(6);
    const otpHash = sha256(`${emailRaw}:${otp}:${process.env.OTP_SECRET || "devsecret"}`);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await q(`INSERT INTO otps (email, otp_hash, expires_at) VALUES ($1,$2,$3)`, [
      emailRaw,
      otpHash,
      expiresAt,
    ]);

    // MVP: OTP in logs
    console.log(`[OTP] email=${emailRaw} code=${otp} expires=${expiresAt.toISOString()}`);

    res.redirect(`/verify?email=${encodeURIComponent(emailRaw)}`);
  } catch (e) {
    console.error(e);
    res.status(500).type("html").send(htmlPage("Login", `<p>Server error.</p>`));
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
    const emailRaw = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();

    if (!emailRaw || !code || code.length !== 6) {
      return res.status(400).type("html").send(htmlPage("Verify", `<p>Invalid email or code.</p>`));
    }

    const now = new Date();
    const otpRows = await q(
      `
      SELECT id, otp_hash, expires_at, attempts
      FROM otps
      WHERE email = $1 AND expires_at > $2
      ORDER BY id DESC
      LIMIT 1
      `,
      [emailRaw, now]
    );

    const otpRow = otpRows.rows[0];
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

    const expectedHash = sha256(`${emailRaw}:${code}:${process.env.OTP_SECRET || "devsecret"}`);
    if (expectedHash !== otpRow.otp_hash) {
      await q(`UPDATE otps SET attempts = attempts + 1 WHERE id = $1`, [otpRow.id]);
      return res.status(400).type("html").send(htmlPage("Verify", `<p>Incorrect code.</p>`));
    }

    // Upsert user
    const userRes = await q(
      `
      INSERT INTO users (email)
      VALUES ($1)
      ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
      RETURNING id, email, name
      `,
      [emailRaw]
    );
    const user = userRes.rows[0];

    // Create session
    const sessionToken = randomToken("bcgpt");
    const sessionHash = sha256(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

    await q(`INSERT INTO sessions (user_id, session_hash, expires_at) VALUES ($1,$2,$3)`, [
      user.id,
      sessionHash,
      expiresAt,
    ]);

    await q(`DELETE FROM otps WHERE id = $1`, [otpRow.id]);

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
    res.status(500).type("html").send(htmlPage("Verify", `<p>Server error.</p>`));
  }
});

// -------------------- BASECAMP PER-USER CONNECT --------------------

/**
 * Starts Basecamp OAuth for the user identified by session token in query param.
 * User opens this link from the "Session Ready" page.
 */
app.get("/connect/basecamp", async (req, res) => {
  try {
    const sessionToken = String(req.query.session || "").trim();
    if (!sessionToken) return res.status(400).type("html").send(htmlPage("Error", "<p>Missing session.</p>"));

    // Validate session token -> user
    const sessionHash = sha256(sessionToken);
    const now = new Date();
    const s = await q(
      `
      SELECT u.id, u.email
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.session_hash = $1 AND s.expires_at > $2
      ORDER BY s.id DESC
      LIMIT 1
      `,
      [sessionHash, now]
    );

    const user = s.rows[0];
    if (!user) {
      return res
        .status(401)
        .type("html")
        .send(htmlPage("Error", "<p>Session invalid/expired. Go to /login again.</p>"));
    }

    // Create oauth state linked to user
    const state = "st_" + crypto.randomBytes(20).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await q(`INSERT INTO oauth_states (state, user_id, expires_at) VALUES ($1,$2,$3)`, [
      state,
      user.id,
      expiresAt,
    ]);

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

/**
 * Basecamp OAuth callback: stores tokens under the user from oauth_states.
 */
app.get("/auth/basecamp/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) return res.status(400).type("html").send(htmlPage("OAuth error", `<p>${error}</p>`));
    if (!code || !state) return res.status(400).type("html").send(htmlPage("Error", "<p>Missing code/state.</p>"));

    // Resolve state -> user
    const now = new Date();
    const st = await q(
      `SELECT user_id, expires_at FROM oauth_states WHERE state = $1 AND expires_at > $2 LIMIT 1`,
      [String(state), now]
    );

    const row = st.rows[0];
    if (!row) return res.status(400).type("html").send(htmlPage("Error", "<p>State invalid/expired.</p>"));

    const userId = row.user_id;

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

    // Store per user in DB
    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token || null;

    // Some providers return expires_in (seconds). If not present, store null.
    const expiresAt =
      tokenJson.expires_in
        ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000)
        : null;

    await q(
      `
      INSERT INTO basecamp_tokens (user_id, access_token, refresh_token, expires_at, default_account_id, updated_at)
      VALUES ($1,$2,$3,$4,$5, now())
      ON CONFLICT (user_id)
      DO UPDATE SET access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
                    expires_at=EXCLUDED.expires_at, default_account_id=EXCLUDED.default_account_id,
                    updated_at=now()
      `,
      [userId, accessToken, refreshToken, expiresAt, BASECAMP_DEFAULT_ACCOUNT_ID || null]
    );

    // Cleanup state (one-time use)
    await q(`DELETE FROM oauth_states WHERE state = $1`, [String(state)]);

    res.type("html").send(
      htmlPage(
        "Basecamp Connected",
        `<p>✅ Basecamp connected successfully.</p>
         <p>Return to ChatGPT and run <b>list projects</b>.</p>`
      )
    );
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

const sessions = new Map();
function newMcpSessionId() {
  return "mcp_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function getMcpSession(req) {
  const sid = req.headers["mcp-session-id"];
  if (!sid) return null;
  return sessions.get(sid) ? sid : null;
}

const MCP_TOOLS = [
  {
    name: "list_projects",
    title: "List Basecamp projects",
    description:
      "Lists Basecamp projects for the currently logged-in bcgpt user (Authorization: Bearer <Session Code>).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
];

async function fetchProjectsForUser(userId) {
  const tRes = await q(
    `SELECT access_token, default_account_id FROM basecamp_tokens WHERE user_id=$1 LIMIT 1`,
    [userId]
  );
  const tRow = tRes.rows[0];
  if (!tRow?.access_token) {
    return { ok: false, status: 401, error: "Basecamp not connected for this user." };
  }

  const accessToken = tRow.access_token;
  const preferredAccountId = Number(tRow.default_account_id || BASECAMP_DEFAULT_ACCOUNT_ID || 0);

  // 1) Get accounts
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

// GET /mcp SSE keepalive (optional)
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

// POST /mcp JSON-RPC
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
        responses.push({
          jsonrpc: "2.0",
          id: msg?.id ?? null,
          error: { code: -32600, message: "Invalid Request" },
        });
        continue;
      }

      const { id, method, params } = msg;

      if (method !== "initialize") {
        const sid = getMcpSession(req);
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
        const sessionId = newMcpSessionId();
        sessions.set(sessionId, { createdAt: Date.now() });
        res.setHeader("Mcp-Session-Id", sessionId);

        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "bcgpt", title: "Basecamp GPT MCP Server", version: "1.0.0" },
            instructions:
              "Provide Authorization: Bearer <bcgpt_session_code> to access per-user Basecamp data.",
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

        // IMPORTANT: identify user from Authorization header
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
                    "Not logged in.\n\n1) Open /login\n2) Verify OTP\n3) Copy Session Code\n4) Use Authorization: Bearer <Session Code>\n5) Open /connect/basecamp?session=<Session Code>",
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
            result: {
              isError: true,
              content: [{ type: "text", text: `Failed: (${data.status}) ${String(data.error).slice(0, 1500)}` }],
            },
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

app.get("/debug/db", async (req, res) => {
  try {
    const r = await q("select now() as now");
    res.json({ ok: true, now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/", (req, res) => res.send("bcgpt server running (otp + basecamp + mcp)"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
