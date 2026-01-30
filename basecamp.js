import fetch from "node-fetch";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterSeconds(res, data) {
  // Prefer Retry-After header if present
  const ra = res?.headers?.get?.("retry-after");
  if (ra && !Number.isNaN(Number(ra))) return Math.max(1, Number(ra));

  // Basecamp sometimes returns: "API rate limit exceeded. Please wait 1 seconds then retry your request."
  const msg =
    typeof data === "string"
      ? data
      : (data?.error || data?.message || data?.response_data || "");

  const m = String(msg).match(/wait\s+(\d+)\s+seconds?/i);
  if (m) return Math.max(1, Number(m[1]));

  return 2; // safe default if no hint
}

function isTransientStatus(status) {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

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
 *
 * Adds:
 *  - 429 backoff + retry (Basecamp throttling)
 *  - small pacing to reduce bursts
 *  - limited transient retries
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

    // NEW (safe defaults)
    maxRetries = 5,          // total retries for transient errors (incl 429)
    minDelayMs = 150,        // pacing between calls (prevents bursts)
    jitterMs = 250,          // random jitter to spread bursts
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

  // Gentle pacing to avoid burst-limiting.
  // (This is tiny, but dramatically reduces 429 when you do many calls.)
  if (minDelayMs > 0) {
    const j = Math.floor(Math.random() * Math.max(0, jitterMs));
    await sleep(minDelayMs + j);
  }

  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    let res;
    let data = null;

    try {
      res = await fetch(url, {
        method: httpMethod,
        headers: h,
        body: payload,
        signal: ac.signal,
      });
      clearTimeout(timer);

      if (res.status === 204) return null;

      const text = await res.text();
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text || null;
      }

      // ✅ 429: backoff and retry
      if (res.status === 429 && attempt < maxRetries) {
        const waitS = parseRetryAfterSeconds(res, data);
        const extraJitter = Math.floor(Math.random() * Math.max(0, jitterMs));
        const backoffMs = waitS * 1000 + attempt * 200 + extraJitter;
        await sleep(backoffMs);
        continue;
      }

      // Other transient statuses: retry with backoff
      if (!res.ok) {
        const err = new Error(`Basecamp API error (${res.status})`);
        err.code = "BASECAMP_API_ERROR";
        err.status = res.status;
        err.url = url;
        err.data = data;

        // retry transient errors (but not forever)
        if (isTransientStatus(res.status) && attempt < maxRetries) {
          const extraJitter = Math.floor(Math.random() * Math.max(0, jitterMs));
          const backoffMs = 500 + attempt * 750 + extraJitter;
          await sleep(backoffMs);
          continue;
        }

        throw err;
      }

      return data;
    } catch (e) {
      clearTimeout(timer);

      // Abort/timeout/network: retry a few times
      lastErr = e;

      const msg = String(e?.message || e);
      const isAbort = e?.name === "AbortError" || /aborted|timeout/i.test(msg);
      const isNetwork = /ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|fetch failed/i.test(msg);

      if ((isAbort || isNetwork) && attempt < maxRetries) {
        const extraJitter = Math.floor(Math.random() * Math.max(0, jitterMs));
        const backoffMs = 500 + attempt * 750 + extraJitter;
        await sleep(backoffMs);
        continue;
      }

      // If we get here, we’re done retrying
      if (e?.code) throw e;

      const err = new Error(`BASECAMP_FETCH_FAILED: ${msg}`);
      err.code = "BASECAMP_FETCH_FAILED";
      err.url = url;
      err.details = e;
      throw err;
    }
  }

  // Should not be reached, but just in case:
  if (lastErr) throw lastErr;
  const err = new Error("BASECAMP_FETCH_FAILED");
  err.code = "BASECAMP_FETCH_FAILED";
  err.url = url;
  throw err;
}
