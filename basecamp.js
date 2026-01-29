import fetch from "node-fetch";

export function ensureAuth(TOKEN) {
  if (!TOKEN?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function basecampFetch(
  TOKEN,
  path,
  { method = "GET", body, ua = "bcgpt-full", timeoutMs = 12000, retries = 2 } = {}
) {
  ensureAuth(TOKEN);
  const url = path.startsWith("http") ? path : `https://3.basecampapi.com${path}`;

  let attempt = 0;
  while (true) {
    attempt += 1;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const r = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${TOKEN.access_token}`,
          "Content-Type": "application/json",
          "User-Agent": ua
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal
      });

      // Handle throttling / transient errors
      if ((r.status === 429 || r.status === 503) && attempt <= (retries + 1)) {
        const ra = Number(r.headers.get("Retry-After") || 1);
        clearTimeout(t);
        await sleep(Math.min(4000, Math.max(750, ra * 1000)));
        continue;
      }

      const txt = await r.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }

      if (!r.ok) {
        const err = new Error("BASECAMP_API_ERROR");
        err.code = "BASECAMP_API_ERROR";
        err.status = r.status;
        err.data = data;
        throw err;
      }

      clearTimeout(t);
      return data;
    } catch (e) {
      clearTimeout(t);

      // Retry timeouts / network blips a couple times
      const transient = (e?.name === "AbortError") || /network|ECONNRESET|ETIMEDOUT/i.test(String(e?.message || ""));
      if (transient && attempt <= (retries + 1)) {
        await sleep(500 * attempt);
        continue;
      }
      throw e;
    }
  }
}
