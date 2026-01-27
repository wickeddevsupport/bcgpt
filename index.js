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
    const accountId = accounts[0].id;

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

app.get("/", (req, res) => res.send("bcgpt server running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Listening on", PORT));
