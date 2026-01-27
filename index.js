import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const {
  BASECAMP_CLIENT_ID,
  BASECAMP_CLIENT_SECRET,
  APP_BASE_URL = "https://bcgpt.onrender.com",
} = process.env;

if (!BASECAMP_CLIENT_ID || !BASECAMP_CLIENT_SECRET) {
  console.warn("Missing BASECAMP_CLIENT_ID or BASECAMP_CLIENT_SECRET");
}

// Temporary in-memory store (OK for testing; later use DB/Redis)
const tokenStore = new Map();

/**
 * Step A: Redirect user to 37signals authorization page
 */
app.get("/auth/basecamp/start", (req, res) => {
  const redirectUri = `${APP_BASE_URL}/auth/basecamp/callback`;

  // For now we use a simple state; later tie this to a logged-in user/session
  const state = Math.random().toString(36).slice(2);
  tokenStore.set(`state:${state}`, { createdAt: Date.now() });

  const authUrl =
    "https://launchpad.37signals.com/authorization/new" +
    "?type=web_server" +
    `&client_id=${encodeURIComponent(BASECAMP_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  res.redirect(authUrl);
});

/**
 * Step B: Exchange code for access token
 */
app.get("/auth/basecamp/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.status(400).send(`OAuth error: ${error}`);
  if (!code || !state) return res.status(400).send("Missing code/state");

  const saved = tokenStore.get(`state:${state}`);
  if (!saved) return res.status(400).send("Invalid state");

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
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    return res.status(500).send(`Token exchange failed: ${text}`);
  }

  const tokenJson = await resp.json();

  // Save tokens (for now, single user demo)
  tokenStore.set("basecamp:token", tokenJson);

  res.send(
    "✅ Basecamp connected successfully. You can close this tab and return to ChatGPT."
  );
});

/**
 * Test endpoint: confirm we have a token saved
 */
app.get("/debug/token", (req, res) => {
  const t = tokenStore.get("basecamp:token");
  res.json({ connected: Boolean(t), tokenKeys: t ? Object.keys(t) : [] });
});

app.get("/", (req, res) => res.send("bcgpt server running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
