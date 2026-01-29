import fetch from "node-fetch";

const LAUNCHPAD_AUTH_URL = "https://launchpad.37signals.com/authorization.json";
const UA_DEFAULT = "bcgpt";

/* =========================
   Internal caches (safe for single-user app)
========================= */
let AUTHZ_CACHE = null;
let AUTHZ_CACHE_AT = 0;
let BASE_URL_CACHE = null;

const AUTHZ_TTL_MS = 60 * 1000; // 1 min

function ensureAuth(TOKEN) {
  if (!TOKEN?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* =========================
   Load authorization.json
========================= */
async function loadAuthorization(TOKEN, ua, force = false) {
  ensureAuth(TOKEN);

  const now = Date.now();
  if (!force && AUTHZ_CACHE && now - AUTHZ_CACHE_AT < AUTHZ_TTL_MS) {
    return AUTHZ_CACHE;
  }

  const r = await fetch(LAUNCHPAD_AUTH_URL, {
    headers: {
      Authorization: `Bearer ${TOKEN.access_token}`,
      "User-Agent": ua || UA_DEFAULT,
      Accept: "application/json"
    }
  });

  if (!r.ok) {
    const text = await r.text().catch(() => null);
    const err = new Error(`AUTHORIZATION_FAILED (${r.status})`);
    err.code = "AUTHORIZATION_FAILED";
    err.status = r.status;
    err.data = text;
    throw err;
  }

  AUTHZ_CACHE = await r.json();
  AUTHZ_CACHE_AT = now;
  return AUTHZ_CACHE;
}

/* =========================
   Resolve Basecamp API base URL
   STRICTLY using BASECAMP_DEFAULT_ACCOUNT_ID
========================= */
async function getBasecampBaseUrl(TOKEN, ua) {
  if (BASE_URL_CACHE) return BASE_URL_CACHE;

  const DEFAULT_ID = process.env.BASECAMP_DEFAULT_ACCOUNT_ID;
  if (!DEFAULT_ID) {
    const err = new Error("BASECAMP_DEFAULT_ACCOUNT_ID is not set");
    err.code = "MISSING_DEFAULT_ACCOUNT_ID";
    throw err;
  }

  const authz = await loadAuthorization(TOKEN, ua);
  const accounts = authz?.accounts || [];

  const account = accounts.find(a => String(a.id) === String(DEFAULT_ID));
  if (!account) {
    const err = new Error(`Default account ${DEFAULT_ID} not found in authorization.json`);
    err.code = "DEFAULT_ACCOUNT_NOT_FOUND";
    err.accounts = accounts.map(a => a.id);
    throw err;
  }

  if (!account.href) {
    const err = new Error(`Account ${DEFAULT_ID} has no href`);
    err.code = "ACCOUNT_HREF_MISSING";
    throw err;
  }

  // href example: https://3.basecampapi.com/123456789
  const u = new URL(account.href);
  BASE_URL_CACHE = `${u.protocol}//${u.host}`;
  return BASE_URL_CACHE;
}

/* =========================
   Build full Basecamp URL
========================= */
async function toBasecampUrl(TOKEN, path, { ua, accountId }) {
  const baseUrl = await getBasecampBaseUrl(TOKEN, ua);

  if (!path) throw new Error("Missing Basecamp path");

  // Full URL passthrough
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  let p = path.startsWith("/") ? path : `/${path}`;

  // Bucket endpoints are already absolute to API host
  if (p.startsWith("/buckets/")) {
    return `${baseUrl}${p}`;
  }

  // Already account-scoped
  if (/^\/\d+\//.test(p)) {
    return `${baseUrl}${p}`;
  }

  // Otherwise require accountId
  if (!accountId) {
    const err = new Error("ACCOUNT_ID_REQUIRED_FOR_PATH");
    err.code = "ACCOUNT_ID_REQUIRED_FOR_PATH";
    err.path = p;
    throw err;
  }

  return `${baseUrl}/${accountId}${p}`;
}

/* =========================
   Main exported fetch helper
========================= */
export async function basecampFetch(
  TOKEN,
  path,
  {
    method = "GET",
    body,
    ua = UA_DEFAULT,
    accountId = process.env.BASECAMP_DEFAULT_ACCOUNT_ID,
    timeoutMs = 15000,
    retries = 2
  } = {}
) {
  ensureAuth(TOKEN);

  const url = await toBasecampUrl(TOKEN, path, { ua, accountId });

  const headers = {
    Authorization: `Bearer ${TOKEN.access_token}`,
    "User-Agent": ua,
    Accept: "application/json"
  };

  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const r = await fetch(url, {
        method,
        headers,
        body: payload,
        signal: controller.signal
      });

      clearTimeout(timer);

      if ([429, 502, 503, 504].includes(r.status) && attempt < retries) {
        const retryAfter = Number(r.headers.get("retry-after") || "0");
        const backoff = retryAfter > 0 ? retryAfter * 1000 : 400 * (attempt + 1) ** 2;
        await sleep(backoff);
        continue;
      }

      const text = await r.text().catch(() => "");
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!r.ok) {
        const err = new Error(`Basecamp API error (${r.status})`);
        err.code = "BASECAMP_API_ERROR";
        err.status = r.status;
        err.url = url;
        err.method = method;
        err.data = data;
        throw err;
      }

      return data;
    } catch (e) {
      clearTimeout(timer);

      if (e?.name === "AbortError" && attempt < retries) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }

  const err = new Error("BASECAMP_REQUEST_FAILED");
  err.code = "BASECAMP_REQUEST_FAILED";
  err.url = url;
  throw err;
}

/* =========================
   Optional: reset caches on logout
========================= */
export function resetBasecampCaches() {
  AUTHZ_CACHE = null;
  AUTHZ_CACHE_AT = 0;
  BASE_URL_CACHE = null;
}
