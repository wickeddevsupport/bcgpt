import fetch from "node-fetch";

export function assertAuth(token) {
  if (!token?.access_token) {
    const e = new Error("NOT_AUTHENTICATED");
    e.code = "NOT_AUTHENTICATED";
    throw e;
  }
}

export async function bcFetch(token, path, { method="GET", body=null, ua="bcgpt-agent" } = {}) {
  assertAuth(token);
  const url = path.startsWith("http") ? path : `https://3.basecampapi.com${path}`;

  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "User-Agent": ua,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!r.ok) {
    const e = new Error("BASECAMP_ERROR");
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}
