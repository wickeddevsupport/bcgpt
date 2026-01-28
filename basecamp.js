
import fetch from "node-fetch";

export function ensureAuth(TOKEN) {
  if (!TOKEN?.access_token) throw new Error("NOT_AUTHENTICATED");
}

export async function basecampFetch(TOKEN, path, { method="GET", body } = {}) {
  ensureAuth(TOKEN);
  const url = `https://3.basecampapi.com${path}`;
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN.access_token}`,
      "Content-Type": "application/json",
      "User-Agent": "bcgpt-full"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await r.text();
  const data = txt ? JSON.parse(txt) : null;
  if (!r.ok) throw { status: r.status, data };
  return data;
}
