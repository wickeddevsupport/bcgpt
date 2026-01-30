// basecamp.js
import fetch from "node-fetch";

/**
 * Basecamp 3 API helper.
 *
 * Supports:
 *  - Full URL: https://3.basecampapi.com/...
 *  - Account-scoped paths: /<account_id>/projects.json OR /projects.json (auto-prefix)
 *  - Bucket-scoped paths: /buckets/<bucket_id>/...
 *
 * Adds:
 *  - retries + Retry-After for 429/502/503/504
 *  - basecampFetchAll(): follows Link rel="next" and aggregates array pages
 */

const BASE = "https://3.basecampapi.com";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseLinkHeader(link) {
  if (!link) return {};
  const out = {};
  const parts = String(link).split(",").map((s) => s.trim());
  for (const part of parts) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?([^";]+)"?/i);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

function normalizeUrl(raw, accountId) {
  const s = String(raw || "").trim();
  if (!s) {
    const err = new Error("Missing Basecamp pathOrUrl");
    err.code = "BAD_REQUEST";
    throw err;
  }

  // Full URL passthrough
  if (/^https?:\/\//i.test(s)) return s;

  let p = s.startsWith("/") ? s : `/${s}`;

  // Bucket-scoped MUST NOT be prefixed with accountId
  if (p.startsWith("/buckets/")) return `${BASE}${p}`;

  // Already account-scoped ("/<digits>/...")
  if (/^\/\d+\//.test(p)) return `${BASE}${p}`;

  // Otherwise require accountId to build account-scoped URL
  if (!accountId) {
    const err = new Error("Missing accountId for Basecamp account-scoped path call");
    err.code = "NO_ACCOUNT_ID";
    err.path = p;
    throw err;
  }

  return `${BASE}/${accountId}${p}`;
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

  const httpMethod = String(method || "GET").toUpperCase();
  const url = normalizeUrl(pathOrUrl, accountId);

  const h = {
    Authorization: `Bearer ${TOKEN.access_token}`,
    "User-Agent": ua,
    Accept: "application/json",
    ...headers,
  };

  let payload = undefined;
  if (body !== undefined && body !== null && httpMethod !== "GET" && httpMethod !== "HEAD") {
    h["Content-Type"] = h["Content-Type"] || "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: httpMethod,
        headers: h,
        body: payload,
        signal: ac.signal,
      });

      clearTimeout(timer);

      // Retryable statuses
      if ([429, 502, 503, 504].includes(res.status) && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after") || "0");
        const backoff = retryAfter > 0 ? retryAfter * 1000 : 400 * (attempt + 1) ** 2;
        await sleep(backoff);
        continue;
      }

      if (res.status === 204) return null;

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text || null;
      }

      if (!res.ok) {
        const err = new Error(`Basecamp API error (${res.status})`);
        err.code = "BASECAMP_API_ERROR";
        err.status = res.status;
        err.url = url;
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
      if (e?.code === "BASECAMP_API_ERROR") throw e;

      const err = new Error(`BASECAMP_FETCH_FAILED: ${e?.message || e}`);
      err.code = "BASECAMP_FETCH_FAILED";
      err.url = url;
      throw err;
    }
  }

  const err = new Error("BASECAMP_REQUEST_FAILED");
  err.code = "BASECAMP_REQUEST_FAILED";
  err.url = url;
  throw err;
}

/**
 * basecampFetchAll()
 * - GET only
 * - follows Link rel="next"
 * - aggregates array pages
 * - if response isn't an array, returns it as-is
 */
export async function basecampFetchAll(
  TOKEN,
  pathOrUrl,
  {
    ua = "bcgpt",
    accountId,
    headers = {},
    timeoutMs = 30000,
    retries = 3,
    maxPages = 50,
    pageDelayMs = 150,
  } = {}
) {
  let url = normalizeUrl(pathOrUrl, accountId);
  const all = [];
  let pages = 0;

  let pageSizeGuess = null;

  while (url && pages < maxPages) {
    const httpHeaders = {
      Authorization: `Bearer ${TOKEN?.access_token}`,
      "User-Agent": ua,
      Accept: "application/json",
      ...headers,
    };

    // Use fetch directly here so we can read Link header.
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);

      try {
        const res = await fetch(url, { method: "GET", headers: httpHeaders, signal: ac.signal });
        clearTimeout(timer);

        if ([429, 502, 503, 504].includes(res.status) && attempt < retries) {
          const retryAfter = Number(res.headers.get("retry-after") || "0");
          const backoff = retryAfter > 0 ? retryAfter * 1000 : 400 * (attempt + 1) ** 2;
          await sleep(backoff);
          continue;
        }

        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text || null;
        }

        if (!res.ok) {
          const err = new Error(`Basecamp API error (${res.status})`);
          err.code = "BASECAMP_API_ERROR";
          err.status = res.status;
          err.url = url;
          err.data = data;
          throw err;
        }

        // If not an array, don't paginate
        if (!Array.isArray(data)) return data;

        all.push(...data);

        const link = res.headers.get("link") || res.headers.get("Link");
const { next } = parseLinkHeader(link);

if (pageSizeGuess === null) pageSizeGuess = Array.isArray(data) ? data.length : null;

let nextUrl = next || null;
if (!nextUrl && pageSizeGuess && Array.isArray(data) && data.length === pageSizeGuess) {
  try {
    const u = new URL(url);
    const curPage = Number(u.searchParams.get("page") || "1");
    u.searchParams.set("page", String(curPage + 1));
    nextUrl = u.toString();
  } catch {
    // ignore
  }
}

url = nextUrl;

        pages++;
        if (url) await sleep(pageDelayMs);
        break; // success break retry loop
      } catch (e) {
        clearTimeout(timer);
        if (e?.name === "AbortError" && attempt < retries) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }
  }

  return all;
}
