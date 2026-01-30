import fetch from "node-fetch";

/**
 * Basecamp API helper for https://3.basecampapi.com/{account_id}/...
 *
 * - basecampFetch(): one request with 429 retry/backoff
 * - basecampFetchAll(): follows Link rel="next" pagination (GET only)
 */

export function ensureAuth(TOKEN) {
  if (!TOKEN?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseNextLink(linkHeader) {
  // Link: <url>; rel="next", <url>; rel="prev"
  if (!linkHeader) return null;
  const parts = String(linkHeader).split(",");
  for (const p of parts) {
    const m = p.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (m) return m[1];
  }
  return null;
}

export function normalizeBasecampUrl(pathOrUrl, accountId) {
  const raw = String(pathOrUrl || "").trim();
  if (!raw) {
    const err = new Error("Missing pathOrUrl");
    err.code = "BAD_REQUEST";
    throw err;
  }

  // Full URL
  if (/^https?:\/\//i.test(raw)) return raw;

  if (!accountId) {
    const err = new Error("Missing accountId for Basecamp API path call");
    err.code = "NO_ACCOUNT_ID";
    throw err;
  }

  let path = raw.startsWith("/") ? raw : `/${raw}`;

  // Ensure /{accountId}/ prefix for ANY API path.
  const prefix = `/${String(accountId)}`;
  if (!path.startsWith(prefix + "/")) {
    path = `${prefix}${path}`;
  }

  return `https://3.basecampapi.com${path}`;
}

function retryAfterMs(res, data) {
  const ra = res.headers.get("retry-after");
  if (ra && !isNaN(Number(ra))) return Math.max(0, Number(ra)) * 1000;

  const msg =
    (typeof data === "string" ? data : null) ||
    data?.message ||
    data?.error ||
    "";

  const m = String(msg).match(/wait\s+(\d+)\s+seconds?/i);
  if (m) return Number(m[1]) * 1000;

  return 1000;
}

async function fetchOnce(url, { method, headers, body, timeoutMs }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(url, { method, headers, body, signal: ac.signal });
    const text = await res.text();
    const data = safeJson(text);
    return { res, data };
  } finally {
    clearTimeout(timer);
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
    maxRetries = 4,
  } = {}
) {
  ensureAuth(TOKEN);

  const httpMethod = String(method || "GET").toUpperCase();
  const url = normalizeBasecampUrl(pathOrUrl, accountId);

  const h = {
    Authorization: `Bearer ${TOKEN.access_token}`,
    "User-Agent": ua,
    ...headers,
  };

  let payload;
  if (body !== undefined && body !== null && httpMethod !== "GET" && httpMethod !== "HEAD") {
    if (!h["Content-Type"] && !h["content-type"]) h["Content-Type"] = "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }

  let attempt = 0;
  while (true) {
    const { res, data } = await fetchOnce(url, {
      method: httpMethod,
      headers: h,
      body: payload,
      timeoutMs,
    });

    if (res.status === 204) return null;

    if (res.status === 429 && attempt < maxRetries) {
      const waitMs = retryAfterMs(res, data);
      await sleep(waitMs + Math.floor(Math.random() * 250));
      attempt += 1;
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

    return data;
  }
}

/**
 * Fetch all pages for a paginated GET endpoint (Link rel="next").
 * If the endpoint returns arrays per page, this returns a single concatenated array.
 * If it returns an object, it returns the object (no pagination assumed).
 */
export async function basecampFetchAll(
  TOKEN,
  pathOrUrl,
  {
    ua = "bcgpt",
    accountId,
    headers = {},
    timeoutMs = 30000,
    maxPages = 50,
  } = {}
) {
  ensureAuth(TOKEN);

  let url = normalizeBasecampUrl(pathOrUrl, accountId);
  let page = 0;

  let out = [];
  let sawArray = false;

  while (url) {
    page += 1;
    if (page > maxPages) {
      const err = new Error(`PAGINATION_LIMIT: exceeded ${maxPages} pages`);
      err.code = "PAGINATION_LIMIT";
      err.url = url;
      throw err;
    }

    const { res, data } = await fetchOnce(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TOKEN.access_token}`,
        "User-Agent": ua,
        ...headers,
      },
      body: undefined,
      timeoutMs,
    });

    if (res.status === 429) {
      const waitMs = retryAfterMs(res, data);
      await sleep(waitMs + Math.floor(Math.random() * 250));
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

    if (Array.isArray(data)) {
      sawArray = true;
      out = out.concat(data);
    } else if (!sawArray) {
      return data;
    }

    url = parseNextLink(res.headers.get("link"));
  }

  return out;
}
