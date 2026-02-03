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

const CIRCUIT_THRESHOLD = Number(process.env.BASECAMP_CIRCUIT_THRESHOLD || 5);
const CIRCUIT_COOLDOWN_MS = Number(process.env.BASECAMP_CIRCUIT_COOLDOWN_MS || 15000);
const DEFAULT_MAX_PAGES = Number(process.env.BASECAMP_MAX_PAGES || 50);
const DEFAULT_PAGE_DELAY_MS = Number(process.env.BASECAMP_PAGE_DELAY_MS || 150);

const circuitState = {
  state: "closed",
  failures: 0,
  openedAt: null,
  openUntil: null,
  lastError: null,
};

function getCircuitConfig() {
  return { threshold: CIRCUIT_THRESHOLD, cooldown_ms: CIRCUIT_COOLDOWN_MS };
}

function noteSuccess() {
  circuitState.state = "closed";
  circuitState.failures = 0;
  circuitState.openedAt = null;
  circuitState.openUntil = null;
  circuitState.lastError = null;
}

function noteFailure(err) {
  circuitState.failures += 1;
  circuitState.lastError = {
    message: err?.message || String(err),
    code: err?.code,
    status: err?.status,
    at: Date.now(),
  };
  if (circuitState.failures >= CIRCUIT_THRESHOLD) {
    circuitState.state = "open";
    circuitState.openedAt = Date.now();
    circuitState.openUntil = circuitState.openedAt + CIRCUIT_COOLDOWN_MS;
  }
}

function assertCircuit() {
  if (circuitState.state === "open") {
    const now = Date.now();
    if (circuitState.openUntil && now < circuitState.openUntil) {
      const err = new Error("Circuit breaker open");
      err.code = "CIRCUIT_OPEN";
      err.retry_after_ms = circuitState.openUntil - now;
      throw err;
    }
    circuitState.state = "half-open";
  }
}

export function getCircuitStatus() {
  return { ...circuitState, ...getCircuitConfig() };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseLinkHeader(link) {
  if (!link) return {};
  const out = {};
  const parts = link.split(",").map((s) => s.trim());
  for (const part of parts) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/i);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

function toRelativePath(urlOrPath, accountId) {
  // Convert absolute Link URLs into the relative path used by basecampFetch.
  if (!urlOrPath) return urlOrPath;
  if (!urlOrPath.startsWith("http")) return urlOrPath;

  try {
    const u = new URL(urlOrPath);
    // Expected: https://3.basecampapi.com/{accountId}/.../something.json
    const prefix = `/${accountId}`;
    const path = u.pathname.startsWith(prefix) ? u.pathname.slice(prefix.length) : u.pathname;
    return path + (u.search || "");
  } catch {
    return urlOrPath;
  }
}

function getParamInt(urlOrPath, key) {
  try {
    const base = urlOrPath.startsWith("http") ? undefined : "https://example.invalid";
    const u = new URL(urlOrPath, base);
    const v = u.searchParams.get(key);
    if (v == null) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function setParam(urlOrPath, key, value) {
  const base = urlOrPath.startsWith("http") ? undefined : "https://example.invalid";
  const u = new URL(urlOrPath, base);
  u.searchParams.set(key, String(value));
  if (base) return u.pathname + (u.search || "");
  return u.toString();
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

  assertCircuit();

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
    const isBinary = (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) || body instanceof Uint8Array;
    if (isBinary) {
      payload = body;
    } else {
      h["Content-Type"] = h["Content-Type"] || "application/json";
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }
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

      if (res.status === 204) {
        noteSuccess();
        return null;
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
        // Don't trip circuit breaker for expected 404s (used in fallbacks)
        if (res.status !== 404) {
          noteFailure(err);
        }
        throw err;
      }

      noteSuccess();
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
      noteFailure(err);
      throw err;
    }
  }

  const err = new Error("BASECAMP_REQUEST_FAILED");
  err.code = "BASECAMP_REQUEST_FAILED";
  err.url = url;
  noteFailure(err);
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
    maxPages = DEFAULT_MAX_PAGES,
    pageDelayMs = DEFAULT_PAGE_DELAY_MS,
    includeMeta = false,
    fallbackPaging = true,
  } = {}
) {
  let url = normalizeUrl(pathOrUrl, accountId);
  const all = [];
  let pages = 0;
  let pagingMode = null;
  const seenPageSignatures = new Set();

  assertCircuit();

  // Encourage deterministic pagination. Many Basecamp collection endpoints
  // default to 15 items/page. Adding per_page + page=1 typically reduces
  // requests and makes it more likely the API returns a Link: rel="next" header.
  const perPage = getParamInt(url, "per_page") ?? 100;
  url = setParam(url, "per_page", perPage);
  if (getParamInt(url, "page") == null) url = setParam(url, "page", 1);

  while (url && pages < maxPages) {
    const requestUrl = url;
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
        // Debug: log the URL being fetched
        if (process?.env?.DEBUG) {
          console.log(`[BasecampFetchAll] Fetching page: ${url}`);
        }
        const res = await fetch(url, { method: "GET", headers: httpHeaders, signal: ac.signal });
        clearTimeout(timer);

        // Debug: log the Link header
        const linkHeader = res.headers.get("link");
        if (process?.env?.DEBUG) {
          console.log(`[BasecampFetchAll] Link header: ${linkHeader}`);
        }

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
        if (!Array.isArray(data)) {
          if (includeMeta) {
            noteSuccess();
            return {
              items: data,
              _meta: {
                pages: 1,
                per_page: perPage,
                max_pages: maxPages,
                truncated: false,
                next_url: null,
                non_array: true,
              },
            };
          }
          noteSuccess();
          return data;
        }

        all.push(...data);

        const { next } = parseLinkHeader(linkHeader);
        if (next) {
          url = next;
          pagingMode = pagingMode || "link";
        } else {
          // Fallback pagination when Link header is missing but page-size suggests more data
          const currentPage = getParamInt(requestUrl, "page") ?? 1;
          const signature = `${data.length}:${data?.[0]?.id ?? ""}:${data?.[data.length - 1]?.id ?? ""}`;
          const looksPaged = Array.isArray(data) && data.length >= perPage;
          const canAdvance = fallbackPaging && looksPaged && currentPage < maxPages;
          if (canAdvance && !seenPageSignatures.has(signature)) {
            seenPageSignatures.add(signature);
            url = setParam(requestUrl, "page", currentPage + 1);
            pagingMode = pagingMode || "page";
          } else {
            url = null;
          }
        }

        pages++;
        if (url) await sleep(pageDelayMs);
        break; // success break retry loop
      } catch (e) {
        clearTimeout(timer);
        if (e?.name === "AbortError" && attempt < retries) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        if (!(e?.code === "BASECAMP_API_ERROR" && e?.status === 404)) {
          noteFailure(e);
        }
        throw e;
      }
    }
  }

  // Debug: log total items fetched
  if (process?.env?.DEBUG) {
    console.log(`[BasecampFetchAll] Total items fetched: ${all.length}`);
  }

  if (includeMeta) {
    noteSuccess();
    return {
      items: all,
      _meta: {
        pages,
        per_page: perPage,
        max_pages: maxPages,
        truncated: Boolean(url),
        next_url: url || null,
        total_items: all.length,
        paging_mode: pagingMode,
      },
    };
  }
  noteSuccess();
  return all;
}
