
import fetch from "node-fetch";

export function ensureAuth(TOKEN) {
  if (!TOKEN?.access_token) {
    const err = new Error("NOT_AUTHENTICATED");
    err.code = "NOT_AUTHENTICATED";
    throw err;
  }
}

export async function basecampFetch(TOKEN, path, { method = "GET", body, ua = "bcgpt-full" } = {}) {
  ensureAuth(TOKEN);
  const url = path.startsWith("http") ? path : `https://3.basecampapi.com${path}`;

  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN.access_token}`,
      "Content-Type": "application/json",
      "User-Agent": ua
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const txt = await r.text();
  let data = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = txt;
  }

  if (!r.ok) {
    const err = new Error("BASECAMP_API_ERROR");
    err.code = "BASECAMP_API_ERROR";
    err.status = r.status;
    err.data = data;
    throw err;
  }

  return data;
}
