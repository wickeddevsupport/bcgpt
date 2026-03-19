function appendQueryParams(pathOrUrl, query) {
  if (query == null || query === "") {
    return pathOrUrl;
  }

  const isAbsolute = /^https?:\/\//i.test(pathOrUrl);
  const url = new URL(pathOrUrl, isAbsolute ? undefined : "https://example.invalid");
  const params = new URLSearchParams(url.search);

  if (typeof query === "string") {
    const extra = new URLSearchParams(query.replace(/^\?/, ""));
    for (const [key, value] of extra.entries()) {
      params.set(key, value);
    }
  } else if (query && typeof query === "object" && !Array.isArray(query)) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === "") {
        continue;
      }
      if (Array.isArray(value)) {
        params.delete(key);
        for (const item of value) {
          if (item == null || item === "") continue;
          params.append(key, String(item));
        }
        continue;
      }
      params.set(key, String(value));
    }
  }

  const search = params.toString();
  url.search = search ? `?${search}` : "";
  return isAbsolute ? url.toString() : `${url.pathname}${url.search}`;
}

function ensureJsonSuffix(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const url = new URL(pathOrUrl, "https://example.invalid");
  const pathname =
    url.pathname !== "/" && url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;
  if (!pathname || pathname.endsWith(".json") || /\.[a-z0-9]+$/i.test(pathname)) {
    return `${pathname}${url.search}`;
  }

  url.pathname = `${pathname}.json`;
  return `${url.pathname}${url.search}`;
}

export function normalizeBasecampRequestPath(raw, { query } = {}) {
  let value = String(raw || "").trim();
  if (!value) {
    return "";
  }

  value = value.replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+/i, "").trim();
  if (!/^https?:\/\//i.test(value)) {
    value = value.startsWith("/") ? value : `/${value}`;
    value = ensureJsonSuffix(value);
  }

  return appendQueryParams(value, query);
}
