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

const APP_BASE_URL = process.env.APP_BASE_URL || "https://bcgpt.onrender.com";
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 168); // 7 days
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

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
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;max-width:520px;margin:0 auto;}
    .card{border:1px solid #e6e6e6;border-radius:12px;padding:16px;}
    input,button{font-size:16px;padding:12px;border-radius:10px;border:1px solid #d0d0d0;width:100%;box-sizing:border-box;}
    button{background:#111;color:#fff;border:none;cursor:pointer;margin-top:12px;}
    .muted{color:#666;font-size:13px;margin-top:10px;}
    code{background:#f5f5f5;padding:2px 6px;border-radius:6px;}
    a{color:#116AD0;text-decoration:none;}
  </style>
</head>
<body>
  <h2>${title}</h2>
  <div class="card">${body}</div>
</body>
</html>`;
}

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

// -------------------- LOGIN PAGES --------------------

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

    // Create OTP
    const otp = randomDigits(6);
    const otpHash = sha256(`${emailRaw}:${otp}:${process.env.OTP_SECRET || "devsecret"}`);

    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    // Store OTP
    await q(
      `INSERT INTO otps (email, otp_hash, expires_at) VALUES ($1,$2,$3)`,
      [emailRaw, otpHash, expiresAt]
    );

    // MVP delivery: log OTP in server logs
    console.log(`[OTP] email=${emailRaw} code=${otp} expires=${expiresAt.toISOString()}`);

    // Redirect to verify page
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
      <p class="muted">After verification, you’ll get a <b>Session Code</b> to paste into ChatGPT.</p>
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

    // Find latest unexpired OTP for this email
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
    const ok = expectedHash === otpRow.otp_hash;

    if (!ok) {
      await q(`UPDATE otps SET attempts = attempts + 1 WHERE id = $1`, [otpRow.id]);
      return res
        .status(400)
        .type("html")
        .send(htmlPage("Verify", `<p>Incorrect code. Try again.</p>`));
    }

    // OTP is correct -> upsert user
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

    // Create session token
    const sessionToken = randomToken("bcgpt");
    const sessionHash = sha256(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

    await q(
      `INSERT INTO sessions (user_id, session_hash, expires_at) VALUES ($1,$2,$3)`,
      [user.id, sessionHash, expiresAt]
    );

    // Optional: delete OTP row (one-time use)
    await q(`DELETE FROM otps WHERE id = $1`, [otpRow.id]);

    const connectUrl = `${APP_BASE_URL}/connect/basecamp?session=${encodeURIComponent(sessionToken)}`;

    const body = `
      <p>✅ Login successful for <b>${user.email}</b></p>
      <p>Copy this <b>Session Code</b> and paste it into ChatGPT:</p>
      <p><code>${sessionToken}</code></p>
      <p class="muted">This expires on ${expiresAt.toISOString()}.</p>
      <hr/>
      <p>Next step: connect your Basecamp account:</p>
      <p><a href="${connectUrl}">Connect Basecamp</a></p>
      <p class="muted">After connecting, return to ChatGPT and run “list projects”.</p>
    `;
    res.type("html").send(htmlPage("Session Ready", body));
  } catch (e) {
    console.error(e);
    res.status(500).type("html").send(htmlPage("Verify", `<p>Server error.</p>`));
  }
});

// -------------------- SESSION DEBUG --------------------

app.get("/debug/whoami", async (req, res) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ logged_in: false });
  res.json({ logged_in: true, user });
});

app.get("/debug/basecamp-status", async (req, res) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ error: "Not logged in" });

  const r = await q(`SELECT user_id, updated_at, default_account_id FROM basecamp_tokens WHERE user_id=$1`, [
    user.id,
  ]);

  res.json({ user: { id: user.id, email: user.email }, basecamp_connected: r.rows.length > 0, token: r.rows[0] || null });
});

// -------------------- PLACEHOLDERS FOR NEXT STEP --------------------
// Next you will add:
// GET /connect/basecamp?session=...  -> redirects to Basecamp OAuth using that session's user_id
// GET /auth/basecamp/callback        -> stores tokens in basecamp_tokens for that user_id

app.get("/", (req, res) => res.send("bcgpt server running (otp mvp)"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
