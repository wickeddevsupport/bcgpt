import fetch from "node-fetch";

/**
 * Basecamp 3 API helper.
 *
 * Correct API base:
 *   https://3.basecampapi.com/{account_id}/...
 *
 * Accepts:
 *  - Full URL (https://3.basecampapi.com/...)
 *  - Path (/projects.json, /buckets/123/..., etc)
 *
 * Always ensures accountId is present when using paths.
 */
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
  } = {}
) {
  if (!TOKEN?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }

  if (!pathOrUrl) {
    const err = new Error("Missing Basecamp pathOrUrl");
    err.code = "BAD_REQUEST";
    throw err;
  }

  const raw = String(pathOrUrl).trim();
  const isFullUrl = /^https?:\/\//i.test(raw);
  const httpMethod = String(method || "GET").toUpperCase();

  let url = raw;

  if (!isFullUrl) {
    if (!accountId) {
      const err = new Error("Missing accountId for Basecamp API path call");
      err.code = "NO_ACCOUNT_ID";
      throw err;
    }

    // Ensure leading slash
    if (!url.startsWith("/")) url = `/${url}`;

    // Inject /{accountId}/ prefix if missing
    const prefix = `/${String(accountId)}`;
    if (!url.startsWith(prefix + "/")) {
      url = `${prefix}${url}`;
    }

    url = `https://3.basecampapi.com${url}`;
  }

  const h = {
    Authorization: `Bearer ${TOKEN.access_token}`,
    "User-Agent": ua,
    ...headers,
  };

  let payload = undefined;
  if (body !== undefined && body !== null && httpMethod !== "GET" && httpMethod !== "HEAD") {
    h["Content-Type"] = h["Content-Type"] || "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }

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
    const err = new Error(`BASECAMP_FETCH_FAILED: ${e?.message || e}`);
    err.code = "BASECAMP_FETCH_FAILED";
    err.url = url;
    throw err;
  } finally {
    clearTimeout(timer);
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
}
