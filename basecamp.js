import fetch from "node-fetch";

const UA_DEFAULT = "bcgpt";
const LAUNCHPAD_AUTH_URL = "https://launchpad.37signals.com/authorization.json";

// Cache base URL per access token (single-user app → simple cache is fine)
let BASE_URL_CACHE = null;     // e.g. "https://3.basecampapi.com"
let AUTHZ_CACHE = null;        // parsed authorization.json
let AUTHZ_CACHE_AT = 0;
const AUTHZ_TTL_MS = 60 * 1000; // 1 minute is enough

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

/**
 * Basecamp docs flow:
 * 1) OAuth token
 * 2) GET https://launchpad.37signals.com/authorization.json
 * 3) Use accounts[].href to find the correct Basecamp API host + account id. 
 */
async function loadAuthorization(TOKEN, ua, force = false) {
  ensureAuth(TOKEN);

  const now = Date.now();
  if (!force && AUTHZ_CACHE && (now - AUTHZ_CACHE_AT) < AUTHZ_TTL_MS) return AUTHZ_CACHE;

  const r = await fetch(LAUNCHPAD_AUTH_URL, {
    headers: {
      Authorization: `Bearer ${TOKEN.access_token}`,
      "User-Agent": ua || UA_DEFAULT,
      Accept: "application/json",
    },
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    const err = new Error(`AUTHORIZATION_FAILED (${r.status})`);
    err.code = "AUTHORIZATION_FAILED";
    err.status = r.status;
    err.data = text || null;
    throw err;
  }

  AUTHZ_CACHE = await r.json();
  AUTHZ_CACHE_AT = now;
  return AUTHZ_CACHE;
}

/**
 * Determine Basecamp API base URL from authorization.json accounts[].href
 * - Prefer the account matching BASECAMP_DEFAULT_ACCOUNT_ID if set
 * - Otherwise prefer href that points at 3.basecampapi.com
 * - Fallback to first account href host
 */
async function getBasecampBaseUrl(TOKEN, ua) {
  if (BASE_URL_CACHE) return BASE_URL_CACHE;

  const authz = await loadAuthorization(TOKEN, ua);
  const accounts = authz?.accounts || [];
  if (!accounts.length) {
    const err = new Error("NO_ACCOUNTS");
    err.code = "NO_ACCOUNTS";
    throw err;
  }

  const defaultId = process.env.BASECAMP_DEFAULT_ACCOUNT_ID || null;

  let chosen =
    (defaultId ? accounts.find(a => String(a.id) === String(defaultId)) : null) ||
    accounts.find(a => typeof a.href === "string" && a.href.includes("3.basecampapi.com")) ||
    accounts.find(a => typeof a.href === "string") ||
    accounts[0];

  // account.href is like "https://3.basecampapi.com/999999999"
  // We only want protocol+host: "https://3.basecampapi.com"
  const href = String(chosen?.href || "https://3.basecampapi.com");
  let u;
  try {
    u = new URL(href);
  } catch {
    // very defensive fallback
    BASE_URL_CACHE = "https://3.basecampapi.com";
    return BASE_URL_CACHE;
  }

  BASE_URL_CACHE = `${u.protocol}//${u.host}`;
  return BASE_URL_CACHE;
}

/**
 * Normalize a Basecamp path into a full URL.
 * Rules (Basecamp 3 API):
 * - account-scoped: /<accountId>/projects.json etc
 * - bucket-scoped:  /buckets/<bucketId>/...
 * - allow full URLs passthrough
 */
async function toBasecampUrl(TOKEN, path, { ua, accountId } = {}) {
  const baseUrl = await getBasecampBaseUrl(TOKEN, ua);

  if (!path) throw new Error("Missing Basecamp path");

  // Full URL passthrough
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  let p = path.startsWith("/") ? path : `/${path}`;

  // Bucket endpoints are already correct as /buckets/...
  if (p.startsWith("/buckets/")) return `${baseUrl}${p}`;

  // If already account-scoped /<digits>/..., keep as-is
  if (/^\/\d+\//.test(p)) return `${baseUrl}${p}`;

  // If caller passed "/projects.json" style, prefix with accountId (required)
  if (!accountId) {
    const err = new Error("ACCOUNT_ID_REQUIRED_FOR_PATH");
    err.code = "ACCOUNT_ID_REQUIRED_FOR_PATH";
    err.path = p;
    throw err;
  }

  return `${baseUrl}/${accountId}${p}`;
}

/**
 * Exported fetch helper used by the rest of your app.
 * - Handles base URL correctly (from authorization.json)
 * - Retries on 429/502/503/504
 * - Provides useful error detail: url/status/data
 */
export async function basecampFetch(
  TOKEN,
  path,
  {
    method = "GET",
    body,
    ua = UA_DEFAULT,
    accountId = null,
    timeoutMs = 15000,
    retries = 2,
  } = {}
) {
  ensureAuth(TOKEN);

  const url = await toBasecampUrl(TOKEN, path, { ua, accountId });

  const headers = {
    Authorization: `Bearer ${TOKEN.access_token}`,
    "User-Agent": ua,
    Accept: "application/json",
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
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Retryable statuses
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
        data = text || null;
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

      // Retry on timeouts
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

/**
 * Optional: clear caches (useful after /logout)
 */
export function resetBasecampCaches() {
  BASE_URL_CACHE = null;
  AUTHZ_CACHE = null;
  AUTHZ_CACHE_AT = 0;
}
