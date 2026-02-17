import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { loadConfig } from "../config/config.js";
import { resolvePmosSessionFromRequest } from "./pmos-auth.js";
import { readWorkspaceConnectors } from "./workspace-connectors.js";
import { buildN8nAuthHeaders } from "./n8n-auth-bridge.js";

function uniqResolved(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const resolved = path.resolve(item);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function findOpenclawRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    try {
      if (fs.existsSync(path.join(dir, "openclaw.mjs"))) {
        return dir;
      }
    } catch {
      // ignore
    }
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return null;
}

// Path to the pre-built ops-ui bundle (openclaw/ops-ui/dist/)
// Prefer resolving from the OpenClaw root (works with flattened build outputs where
// import.meta.url lives directly under dist/).
function resolveOpsUiDistDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = findOpenclawRoot(here) ?? findOpenclawRoot(process.cwd());
  const candidates = uniqResolved([
    // Typical package layout
    root ? path.join(root, "ops-ui", "dist") : "",
    // Monorepo layout (repo-root/openclaw/ops-ui/dist)
    root ? path.join(root, "openclaw", "ops-ui", "dist") : "",
    // Legacy relative path (when gateway output lived under dist/gateway)
    path.resolve(here, "..", "..", "ops-ui", "dist"),
    // CWD fallbacks (local dev)
    path.resolve(process.cwd(), "ops-ui", "dist"),
    path.resolve(process.cwd(), "openclaw", "ops-ui", "dist"),
  ].filter(Boolean));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // ignore
    }
  }

  // If nothing exists, return the best guess for better error messaging.
  return candidates[0] ?? path.resolve(process.cwd(), "ops-ui", "dist");
}

const OPS_UI_DIST = resolveOpsUiDistDir();

const OPS_UI_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

// Hop-by-hop headers that must not be forwarded
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "te",
  "trailers",
]);
const STRIP_RESPONSE_HEADERS = new Set([
  "connection",
  "transfer-encoding",
  "keep-alive",
  // Web Fetch API auto-decompresses; strip so downstream doesn't try to decompress again
  "content-encoding",
]);

function readGlobalOpsConfig(): { url: string; apiKey: string | null } {
  const cfg = loadConfig() as unknown;
  const pmos = (cfg as Record<string, unknown>)?.pmos as Record<string, unknown> | undefined;
  const connectors = pmos?.connectors as Record<string, unknown> | undefined;
  const ops = connectors?.ops as Record<string, unknown> | undefined;
  const url =
    (typeof ops?.url === "string" && ops.url.trim()) ||
    process.env.OPS_URL?.trim() ||
    "https://ops.wickedlab.io";
  const apiKey =
    (typeof ops?.apiKey === "string" && ops.apiKey.trim()) ||
    process.env.OPS_API_KEY?.trim() ||
    null;
  return { url: url.replace(/\/+$/, ""), apiKey };
}

function allowRemoteOpsFallback(): boolean {
  const raw = (process.env.PMOS_ALLOW_REMOTE_OPS_FALLBACK ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function buildForwardHeaders(
  req: IncomingMessage,
  extra: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) {
      out[key] = value.join(", ");
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return { ...out, ...extra };
}

async function proxyUpstream(params: {
  req: IncomingMessage;
  res: ServerResponse;
  targetUrl: string;
  extraHeaders?: Record<string, string>;
}): Promise<void> {
  const { req, res, targetUrl, extraHeaders } = params;
  const headers = buildForwardHeaders(req, extraHeaders);
  const body = await readBody(req);

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body.length > 0 ? (body as unknown as BodyInit) : undefined,
    });
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: `Upstream unreachable: ${String(err)}` }));
    return;
  }

  res.statusCode = upstream.status;
  for (const [key, value] of upstream.headers.entries()) {
    if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    res.setHeader(key, value);
  }

  if (upstream.body) {
    // Convert Web ReadableStream → Node Readable and pipe to response
    Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
  } else {
    res.end();
  }
}

/**
 * Reads the locally-running n8n config from openclaw config / env vars.
 * Returns null when no local n8n is configured.
 *
 * Config (openclaw.json):
 *   pmos.n8n.localUrl = "http://localhost:5678"
 *
 * Env vars:
 *   N8N_LOCAL_URL=http://localhost:5678
 */
export function readLocalN8nConfig(): { url: string; host: string; port: number } | null {
  const cfg = loadConfig() as unknown;
  const pmos = (cfg as Record<string, unknown>)?.pmos as Record<string, unknown> | undefined;
  const n8n = pmos?.n8n as Record<string, unknown> | undefined;
  const rawUrl =
    (typeof n8n?.localUrl === "string" && n8n.localUrl.trim()) ||
    process.env.N8N_LOCAL_URL?.trim() ||
    null;
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl.endsWith("/") ? rawUrl.slice(0, -1) : rawUrl);
    const port = parsed.port ? parseInt(parsed.port, 10) : parsed.protocol === "https:" ? 443 : 80;
    return { url: parsed.origin, host: parsed.hostname, port };
  } catch {
    return null;
  }
}

// Best-effort server-side login helper: POSTs credentials to n8n and returns Set-Cookie when available.
async function attemptN8nLogin(targetBase: string, email: string, password: string) {
  const endpoints = [
    `${targetBase.replace(/\/+$/, "")}/rest/users/login`,
    `${targetBase.replace(/\/+$/, "")}/api/v1/users/login`,
    `${targetBase.replace(/\/+$/, "")}/users/login`,
  ];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        redirect: "manual",
      });
      const sc = res.headers.get("set-cookie");
      if (sc) return sc;
      if (res.ok) return null;
    } catch (err) {
      // ignore and try next
    }
  }
  return null;
}

// If workspace has ops.user creds, attempt server-side login and forward Set-Cookie to client (best-effort).
async function attemptAutoLoginForRequest(req: IncomingMessage, res: ServerResponse, targetN8nBase: string) {
  try {
    const session = await resolvePmosSessionFromRequest(req);
    if (!session.ok) return;
    const wc = await readWorkspaceConnectors(session.user.workspaceId);
    const u = wc?.ops?.user as { email?: string; password?: string } | undefined;
    if (!u?.email || !u?.password) return;
    const cookie = await attemptN8nLogin(targetN8nBase, u.email, u.password);
    if (cookie) {
      res.setHeader("Set-Cookie", cookie);
    }
  } catch (err) {
    // best-effort only
    console.warn("[pmos] auto-login attempt failed:", String(err));
  }
}

/**
 * Transparent HTTP proxy for local n8n.
 *
 * Routes handled:
 *   /ops-ui/*   → local n8n frontend (requires N8N_PATH=ops-ui on the n8n side)
 *               fallback: serve pre-built static files from openclaw/ops-ui/dist/
 *   /rest/*     → local n8n REST API (editor's internal API)
 *   /form/*     → local n8n form submissions
 *
 * Returns true if handled.
 */
export async function handleLocalN8nRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  const isOpsUi = pathname === "/ops-ui" || pathname.startsWith("/ops-ui/");
  const isRestApi = pathname === "/rest" || pathname.startsWith("/rest/");
  const isFormPath = pathname === "/form" || pathname.startsWith("/form/");
  if (!isOpsUi && !isRestApi && !isFormPath) {
    return false;
  }

  const n8n = readLocalN8nConfig();
  if (n8n) {
    // Use auth bridge for workspace-scoped n8n auth (cached session cookies + API keys)
    const authHeaders = await buildN8nAuthHeaders(req, n8n.url);
    // Fall back to legacy auto-login if bridge returns no headers
    if (!authHeaders.Cookie && !authHeaders["X-N8N-API-KEY"]) {
      await attemptAutoLoginForRequest(req, res, n8n.url);
    }
    // Proxy everything transparently to local n8n
    const targetUrl = `${n8n.url}${pathname}${url.search}`;
    await proxyUpstream({ req, res, targetUrl, extraHeaders: authHeaders });
    return true;
  }

  // No local n8n running — for /rest/* and /form/*, don't intercept
  if (isRestApi || isFormPath) return false;

  // For /ops-ui/*, try serving pre-built static bundle
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return true;
  }

  const subPath = pathname.slice("/ops-ui".length) || "/";
  // Prevent directory traversal
  const normalized = path.posix.normalize(subPath);
  if (normalized.includes("..") || normalized.includes("\0")) {
    res.statusCode = 400;
    res.end("Bad Request");
    return true;
  }

  // Try exact path, then index.html fallback for SPA routing
  const candidates = [
    path.join(OPS_UI_DIST, normalized),
    path.join(OPS_UI_DIST, normalized, "index.html"),
    path.join(OPS_UI_DIST, "index.html"),
  ];

  // If the workspace has ops.user credentials stored, attempt a server-side login so the
  // editor opens without showing n8n's login/setup screen (best-effort).
  await attemptAutoLoginForRequest(req, res, "http://127.0.0.1:5678");

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext = path.extname(candidate).toLowerCase();
      const contentType = OPS_UI_CONTENT_TYPES[ext] ?? "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable");
      if (req.method === "HEAD") {
        res.statusCode = 200;
        res.end();
      } else {
        res.statusCode = 200;
        res.end(fs.readFileSync(candidate));
      }
      return true;
    }
  }

  // Neither local n8n nor pre-built bundle found
  res.statusCode = 503;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem">` +
      `<h2>Embedded n8n unavailable</h2>` +
      `<p>To enable the workflow editor:</p>` +
      `<ul>` +
      `<li>Ensure vendored n8n starts with OpenClaw gateway.</li>` +
      `<li>Or set <code>N8N_LOCAL_URL=http://localhost:5678</code> for a local n8n process.</li>` +
      `</ul>` +
      `</body></html>`,
  );
  return true;
}

/**
 * Tunnels a WebSocket upgrade to the local n8n instance.
 * Used for n8n's push connection (/push) and any other WS endpoints.
 *
 * Returns true if the upgrade was handled.
 */
export function tunnelN8nWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  const isN8nWs =
    pathname === "/push" ||
    pathname.startsWith("/push/") ||
    pathname === "/rest/push" ||
    pathname.startsWith("/rest/push/");

  if (!isN8nWs) return false;

  const n8n = readLocalN8nConfig();
  if (!n8n) return false;

  const upstream = net.connect(n8n.port, n8n.host, () => {
    // Reconstruct the HTTP upgrade request to forward to n8n
    const headers = Object.entries(req.headers)
      .filter(([k]) => !["connection", "upgrade"].includes(k.toLowerCase()))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : (v ?? "")}`)
      .join("\r\n");
    upstream.write(
      `GET ${pathname}${url.search} HTTP/1.1\r\n` +
        `Host: ${n8n.host}:${n8n.port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `${headers}\r\n\r\n`,
    );
    if (head.length > 0) {
      upstream.write(head);
    }
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on("error", () => {
    socket.destroy();
  });
  socket.on("error", () => {
    upstream.destroy();
  });

  return true;
}

/**
 * Handles:
 *   /api/ops/*          -> embedded n8n /rest/* API
 *   /webhook/*          -> embedded n8n webhook passthrough
 *   /webhook-test/*     -> embedded n8n webhook-test passthrough
 *   /webhook-waiting/*  -> embedded n8n webhook-waiting passthrough
 *
 * Remote fallback is disabled by default and can be explicitly enabled with
 * PMOS_ALLOW_REMOTE_OPS_FALLBACK=1.
 *
 * Returns true if the request was handled.
 */
export async function handleOpsProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  // Transparent webhook passthrough - embedded n8n by default.
  const webhookPrefixes = ["/webhook-waiting/", "/webhook-test/", "/webhook/"];
  for (const prefix of webhookPrefixes) {
    const bare = prefix.slice(0, -1); // without trailing slash
    if (pathname === bare || pathname.startsWith(prefix)) {
      const localN8n = readLocalN8nConfig();
      if (!localN8n && !allowRemoteOpsFallback()) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            ok: false,
            error: "Embedded n8n is unavailable for webhook handling.",
          }),
        );
        return true;
      }
      const baseUrl = localN8n ? localN8n.url : readGlobalOpsConfig().url;
      const subPath = pathname.slice(bare.length);
      const targetUrl = `${baseUrl}${bare}${subPath}${url.search}`;
      await proxyUpstream({ req, res, targetUrl });
      return true;
    }
  }

  // API proxy - requires PMOS session.
  if (pathname === "/api/ops" || pathname.startsWith("/api/ops/")) {
    const session = await resolvePmosSessionFromRequest(req);
    if (!session.ok) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "Authentication required." }));
      return true;
    }

    const localN8n = readLocalN8nConfig();
    const { workspaceId } = session.user;
    const apiPath = pathname.slice("/api/ops".length) || "/";

    if (localN8n) {
      const authHeaders = await buildN8nAuthHeaders(req, localN8n.url);
      if (!authHeaders.Cookie && !authHeaders["X-N8N-API-KEY"]) {
        await attemptAutoLoginForRequest(req, res, localN8n.url);
      }
      const targetUrl = `${localN8n.url}/rest${apiPath}${url.search}`;
      await proxyUpstream({ req, res, targetUrl, extraHeaders: authHeaders });
      return true;
    }

    if (!allowRemoteOpsFallback()) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: false,
          error: "Embedded n8n is unavailable. Start gateway with vendored n8n enabled.",
        }),
      );
      return true;
    }

    // Legacy remote fallback (explicit opt-in)
    const global = readGlobalOpsConfig();
    const wc = await readWorkspaceConnectors(workspaceId);
    const opsUrl = ((wc?.ops?.url?.trim() ?? "") || global.url).replace(/\/+$/, "");
    const allowGlobalKeyFallback = session.user.role === "super_admin";
    const opsKey = wc?.ops?.apiKey?.trim() || (allowGlobalKeyFallback ? global.apiKey : null);

    if (!opsKey) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: false,
          error: "Remote ops fallback enabled, but no workspace API key is configured.",
        }),
      );
      return true;
    }

    const targetUrl = `${opsUrl}/api/v1${apiPath}${url.search}`;
    await proxyUpstream({
      req,
      res,
      targetUrl,
      extraHeaders: { "X-N8N-API-KEY": opsKey },
    });
    return true;
  }

  return false;
}
