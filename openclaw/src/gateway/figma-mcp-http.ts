import type { IncomingMessage, ServerResponse } from "node:http";
import { resolvePmosSessionFromToken } from "./pmos-auth.js";
import { dispatchWorkspaceFigmaMcpRpc } from "./figma-mcp-service.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += String(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function handleFigmaMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/figma/mcp") {
    return false;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return true;
  }

  const sessionKeyRaw = req.headers["x-session-key"];
  const sessionKey = Array.isArray(sessionKeyRaw) ? sessionKeyRaw[0] : sessionKeyRaw;
  if (!sessionKey || typeof sessionKey !== "string" || !sessionKey.trim()) {
    sendJson(res, 401, jsonRpcError(null, -32001, "x-session-key header required"));
    return true;
  }

  const sessionResult = await resolvePmosSessionFromToken(sessionKey.trim());
  if (!sessionResult.ok) {
    sendJson(res, 401, jsonRpcError(null, -32001, sessionResult.error));
    return true;
  }

  const workspaceId = sessionResult.user.workspaceId;
  if (!workspaceId) {
    sendJson(res, 403, jsonRpcError(null, -32002, "No workspaceId for session user"));
    return true;
  }

  const body = await readBody(req);
  if (!body) {
    sendJson(res, 400, jsonRpcError(null, -32700, "Invalid JSON body"));
    return true;
  }

  const response = await dispatchWorkspaceFigmaMcpRpc({
    workspaceId,
    id: body.id ?? null,
    method: body.method,
    rpcParams: body.params,
  });
  sendJson(res, 200, response);
  return true;
}
