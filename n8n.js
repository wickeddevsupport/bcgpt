import fetch from "node-fetch";

const DEFAULT_TIMEOUT_MS = Number(process.env.N8N_TIMEOUT_MS || 15000);
const DEFAULT_RETRIES = Number(process.env.N8N_RETRIES || 2);

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function buildUrl(baseUrl, path, query) {
  if (!path) {
    const err = new Error("MISSING_PATH");
    err.code = "MISSING_PATH";
    throw err;
  }

  if (/^https?:\/\//i.test(String(path))) {
    const url = new URL(String(path));
    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  const base = trimTrailingSlash(baseUrl);
  const safePath = String(path).startsWith("/") ? String(path) : `/${path}`;
  const url = new URL(`${base}${safePath}`);
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export function getN8nApiBase() {
  const explicit = process.env.N8N_API_BASE_URL;
  if (explicit) return trimTrailingSlash(explicit);

  const internal = process.env.N8N_INTERNAL_URL || process.env.N8N_PROXY_TARGET || "http://127.0.0.1:5678";
  const versionRaw = String(process.env.N8N_API_VERSION || "1").trim();
  const version = versionRaw.toLowerCase().startsWith("v") ? versionRaw.slice(1) : versionRaw;
  return `${trimTrailingSlash(internal)}/api/v${version}`;
}

export async function n8nRequest({
  path,
  method = "GET",
  body = undefined,
  headers = {},
  query = undefined,
  apiKey = null,
  baseUrl = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
} = {}) {
  const base = baseUrl || getN8nApiBase();
  const url = buildUrl(base, path, query);

  const httpMethod = String(method || "GET").toUpperCase();
  const h = {
    Accept: "application/json",
    ...headers,
  };

  if (apiKey && !h["X-N8N-API-KEY"]) {
    h["X-N8N-API-KEY"] = String(apiKey);
  }

  let payload = undefined;
  if (body !== undefined && body !== null && httpMethod !== "GET" && httpMethod !== "HEAD") {
    h["Content-Type"] = h["Content-Type"] || "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: httpMethod,
        headers: h,
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if ([429, 502, 503, 504].includes(res.status) && attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after") || "0");
        const backoff = retryAfter > 0 ? retryAfter * 1000 : 400 * (attempt + 1) ** 2;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      if (res.status === 204) {
        return { data: null, status: res.status, headers: res.headers };
      }

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text || null;
      }

      if (!res.ok) {
        const err = new Error(`n8n API error (${res.status})`);
        err.code = "N8N_API_ERROR";
        err.status = res.status;
        err.data = data;
        err.url = url;
        throw err;
      }

      return { data, status: res.status, headers: res.headers };
    } catch (e) {
      clearTimeout(timer);
      if (e?.name === "AbortError" && attempt < retries) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }

  const err = new Error("N8N_REQUEST_FAILED");
  err.code = "N8N_REQUEST_FAILED";
  err.url = url;
  throw err;
}
