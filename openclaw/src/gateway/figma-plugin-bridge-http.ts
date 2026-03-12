import type { IncomingMessage, ServerResponse } from "node:http";
import { resolvePmosSessionFromRequest } from "./pmos-auth.js";
import {
  prepareWorkspaceFigmaPluginBridge,
  readWorkspaceFigmaPluginBridgeStatus,
  syncWorkspaceFigmaPluginBridgeSnapshot,
} from "./figma-plugin-bridge.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function withCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += String(chunk);
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function extractBearerToken(req: IncomingMessage): string | null {
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header || typeof header !== "string") {
    return null;
  }
  const match = header.trim().match(/^bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function resolveRequestOrigin(req: IncomingMessage): string {
  const forwardedProto = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : req.headers["x-forwarded-proto"];
  const forwardedHost = Array.isArray(req.headers["x-forwarded-host"])
    ? req.headers["x-forwarded-host"][0]
    : req.headers["x-forwarded-host"];
  const host = forwardedHost || req.headers.host || "localhost";
  const protocol = forwardedProto || (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function handleFigmaPluginBridgeHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/figma/plugin-bridge/sync") {
    withCors(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return true;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }

    const bridgeToken = extractBearerToken(req);
    if (!bridgeToken) {
      sendJson(res, 401, { error: "Bearer token required" });
      return true;
    }

    const body = await readBody(req);
    if (!body) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return true;
    }

    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
    if (!workspaceId) {
      sendJson(res, 400, { error: "workspaceId is required" });
      return true;
    }

    try {
      const result = await syncWorkspaceFigmaPluginBridgeSnapshot({
        workspaceId,
        bridgeToken,
        payload: body,
      });
      sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(
        res,
        message === "FIGMA_PLUGIN_BRIDGE_AUTH_FAILED" ? 401 : 400,
        { error: message },
      );
    }
    return true;
  }

  if (
    url.pathname === "/api/pmos/figma/plugin-bridge/prepare" ||
    url.pathname === "/api/pmos/figma/plugin-bridge/status"
  ) {
    const session = await resolvePmosSessionFromRequest(req);
    if (!session.ok) {
      sendJson(res, session.status, { error: session.error });
      return true;
    }
    const workspaceId = session.user.workspaceId;
    if (!workspaceId) {
      sendJson(res, 403, { error: "No workspaceId for session user" });
      return true;
    }

    if (url.pathname.endsWith("/status")) {
      const status = await readWorkspaceFigmaPluginBridgeStatus(workspaceId);
      sendJson(res, 200, {
        workspaceId,
        syncUrl: `${resolveRequestOrigin(req)}/figma/plugin-bridge/sync`,
        status,
      });
      return true;
    }

    if (req.method !== "GET" && req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }

    const prepared = await prepareWorkspaceFigmaPluginBridge(workspaceId);
    sendJson(res, 200, {
      workspaceId,
      bridgeToken: prepared.bridgeToken,
      syncUrl: `${resolveRequestOrigin(req)}/figma/plugin-bridge/sync`,
      status: prepared.status,
      recommendedTool: "figma.get_annotations",
    });
    return true;
  }

  return false;
}
