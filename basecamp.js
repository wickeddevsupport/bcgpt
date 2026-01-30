// basecamp.js
import fetch from "node-fetch";

/**
 * Basecamp 4 API helper (same domain as "bc3-api" docs):
 *   All URLs are account-scoped: https://3.basecampapi.com/<account_id>/...
 *   Pagination via RFC5988 Link header (rel="next")
 *   Rate limiting via 429 + Retry-After
 *
 * This file provides:
 *  - basecampFetch(): single request (with retries/backoff)
 *  - basecampFetchAll(): auto-pagination (follows Link rel="next")
 */

const BASE = "https://3.basecampapi.com";

// ---- Small global limiter (prevents bursty self-DDOS) ----
// Docs mention 50 requests / 10s per IP as a common limit. We'll stay under it.
let lastRequestAt = 0;
const MIN_GAP_MS = Number(process.env.BC_MIN_GAP_MS || 220); // ~45 req/10s

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, MIN_GAP_MS - (now - lastRequestAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

// ---- Link header parsing for pagination ----
function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  // Example:
  // Link: <https://3.basecampapi.com/999/buckets/123/messages.json?page=4>; rel="next"
  const parts = linkHeader.split(",");
  for (const p of parts) {
    const m = p.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

// ---- URL normalization ----
function normalizeUrl(pathOrUrl, accountId) {
  if (!pathOrUrl) {
    const err = new Error("Missing Basecamp pathOrUrl");
    err.code = "BAD_REQUEST";
    throw err;
  }

  const raw = String(pathOrUrl).trim();

  // Full URL passthrough
  if (/^https?:\/\//i.test(raw)) return raw;

  let p = raw.startsWith("/") ? raw : `/${raw}`;

  // If already starts with "/<digits>/" it already has account prefix
  if (/^\/\d+\//.test(p)) return `${BASE}${p}`;

  // Otherwise we MUST prefix accountId (including for /buckets/... paths)
  if (!accountId) {
    const err = new Error("ACCOUNT_ID_REQUIRED_FOR_PATH");
    err.code = "ACCOUNT_ID_REQUIRED_FOR_PATH";
    err.path = p;
    throw err;
  }

  return `${BASE}/${String(accountId)}${p}`;
}

function extractRetryAfterSeconds(res, data) {
  const ra = res.headers.get("retry-after");
  if (ra && !Number.isNaN(Number(ra))) return Number(ra);

  // Sometimes body contains: "Please wait 1 seconds then retry your request."
  if (typeof data === "string") {
    const m = data.match(/wait\s+(\d+)\s+seconds?/i);
    if (m) return Number(m[1]);
  }
  return null;
}

async function readBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function basecampFetch(
  TOKEN,
  pathOrUrl,
  {
    method = "GET",
    body,
    ua = "bcgpt",
    accountId,
    headers = {},
    timeoutMs = 30000,
    retries = 3,
  } = {}
) {
  if (!TOKEN?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }

  const url = normalizeUrl(pathOrUrl, accountId);
  const httpMethod = String(method || "GET").toUpperCase();

  const h = {
    Authorization: `Bearer ${TOKEN.access_token}`,
    "User-Agent": ua,
    Accept: "application/json",
    ...headers,
  };

  let payload;
  if (body !== undefined && body !== null && httpMethod !== "GET" && httpMethod !== "HEAD") {
    h["Content-Type"] = h["Content-Type"] || "application/json; charset=utf-8";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }

  let attempt = 0;
  while (attempt <= retries) {
    attempt += 1;

    await throttle();

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        method: httpMethod,
        headers: h,
        body: payload,
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (attempt <= retries) {
        // network hiccup — short backoff
        await new Promise((r) => setTimeout(r, 250 * attempt));
        continue;
      }
      const err = new Error(`BASECAMP_FETCH_FAILED: ${e?.message || e}`);
      err.code = "BASECAMP_FETCH_FAILED";
      err.url = url;
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 204) return { data: null, headers: res.headers, status: res.status };

    const data = await readBody(res);

    // Rate limit / transient errors
    if ([429, 502, 503, 504].includes(res.status) && attempt <= retries) {
      const raSec = extractRetryAfterSeconds(res, data);
      const backoffMs =
        raSec != null ? raSec * 1000 : Math.min(5000, 300 * attempt * attempt);
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }

    if (!res.ok) {
      const err = new Error(`Basecamp API error (${res.status})`);
      err.code = "BASECAMP_API_ERROR";
      err.status = res.status;
      err.url = url;
      err.data = data;
      throw err;
    }

    return { data, headers: res.headers, status: res.status };
  }

  const err = new Error("BASECAMP_REQUEST_FAILED");
  err.code = "BASECAMP_REQUEST_FAILED";
  err.url = normalizeUrl(pathOrUrl, accountId);
  throw err;
}

export async function basecampFetchAll(
  TOKEN,
  pathOrUrl,
  opts = {}
) {
  const out = [];
  let next = pathOrUrl;

  while (next) {
    const { data, headers } = await basecampFetch(TOKEN, next, opts);

    if (Array.isArray(data)) out.push(...data);
    else if (data && typeof data === "object" && Array.isArray(data.items)) out.push(...data.items);
    else if (data != null) out.push(data);

    const link = headers?.get?.("link");
    next = parseNextLink(link);
  }

  return out;
}
