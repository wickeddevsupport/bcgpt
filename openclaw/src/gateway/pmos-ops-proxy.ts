import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { loadConfig } from "../config/config.js";
import { resolvePmosSessionFromRequest } from "./pmos-auth.js";
import { readWorkspaceConnectors } from "./workspace-connectors.js";

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
      body: body.length > 0 ? body : undefined,
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
 * Handles:
 *   /api/ops/*          → proxy to ops.wickedlab.io/api/v1/* with workspace API key injected
 *   /webhook/*          → transparent passthrough to ops.wickedlab.io/webhook/*
 *   /webhook-test/*     → transparent passthrough to ops.wickedlab.io/webhook-test/*
 *   /webhook-waiting/*  → transparent passthrough to ops.wickedlab.io/webhook-waiting/*
 *
 * Returns true if the request was handled.
 */
export async function handleOpsProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  // Transparent webhook passthrough — no auth needed (webhooks are public by design)
  const webhookPrefixes = ["/webhook-waiting/", "/webhook-test/", "/webhook/"];
  for (const prefix of webhookPrefixes) {
    const bare = prefix.slice(0, -1); // without trailing slash
    if (pathname === bare || pathname.startsWith(prefix)) {
      const { url: opsUrl } = readGlobalOpsConfig();
      const subPath = pathname.slice(bare.length);
      const targetUrl = `${opsUrl}${bare}${subPath}${url.search}`;
      await proxyUpstream({ req, res, targetUrl });
      return true;
    }
  }

  // API proxy — requires PMOS session, injects workspace-scoped ops API key
  if (pathname === "/api/ops" || pathname.startsWith("/api/ops/")) {
    const session = await resolvePmosSessionFromRequest(req);
    if (!session.ok) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "Authentication required." }));
      return true;
    }

    const { workspaceId } = session.user;
    const global = readGlobalOpsConfig();
    const wc = await readWorkspaceConnectors(workspaceId);

    const opsUrl = ((wc?.ops?.url?.trim() ?? "") || global.url).replace(/\/+$/, "");
    const opsKey = wc?.ops?.apiKey?.trim() || global.apiKey;

    if (!opsKey) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: false,
          error: "Wicked Ops not configured for this workspace. Visit Dashboard to provision.",
        }),
      );
      return true;
    }

    // /api/ops/workflows → /api/v1/workflows
    const apiPath = pathname.slice("/api/ops".length) || "/";
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
