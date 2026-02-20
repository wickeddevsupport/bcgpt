/**
 * HTTP endpoints for BYOK (Bring Your Own Keys) management.
 *
 * Routes:
 *   GET  /api/pmos/byok           → list keys (no decrypted values)
 *   POST /api/pmos/byok           → set/update a key
 *   DELETE /api/pmos/byok/:provider → remove a key
 *   POST /api/pmos/byok/validate  → validate a key
 *
 * All routes require a valid pmos_session cookie.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { resolvePmosSessionFromRequest } from "./pmos-auth.js";
import { readJsonBody } from "./hooks.js";
import {
  type AIProvider,
  listKeys,
  setKey,
  removeKey,
  getKey,
  validateKey,
  markValidated,
} from "./byok-store.js";
import { syncByokToN8n } from "./credential-sync.js";

const MAX_BODY_BYTES = 32 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function resolveByokRoute(
  pathname: string,
  method: string,
): { action: string; provider?: string } | null {
  const prefix = "/api/pmos/byok";

  if (pathname === prefix || pathname === `${prefix}/`) {
    if (method === "GET") return { action: "list" };
    if (method === "POST") return { action: "set" };
  }

  if (pathname === `${prefix}/validate` && method === "POST") {
    return { action: "validate" };
  }

  // DELETE /api/pmos/byok/:provider
  if (method === "DELETE" && pathname.startsWith(`${prefix}/`)) {
    const provider = pathname.slice(prefix.length + 1).split("/")[0];
    if (provider && provider !== "validate") {
      return { action: "remove", provider };
    }
  }

  return null;
}

export async function handleByokHttp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = resolveByokRoute(url.pathname, req.method ?? "GET");
  if (!route) return false;

  // Require authenticated session
  const session = await resolvePmosSessionFromRequest(req);
  if (!session || !session.ok) {
    sendJson(res, 401, { ok: false, error: "Authentication required" });
    return true;
  }
  const workspaceId = session.user.workspaceId;
  if (!workspaceId) {
    sendJson(res, 403, { ok: false, error: "Workspace not assigned" });
    return true;
  }

  try {
    switch (route.action) {
      case "list": {
        const keys = await listKeys(workspaceId);
        sendJson(res, 200, { ok: true, workspaceId, keys });
        return true;
      }

      case "set": {
        const body = (await readJsonBody(req, MAX_BODY_BYTES)) as Record<string, unknown> | null;
        const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
        const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
        if (!provider || !apiKey) {
          sendJson(res, 400, { ok: false, error: "provider and apiKey are required" });
          return true;
        }
        const label = typeof body?.label === "string" ? body.label.trim() : undefined;
        const defaultModel = typeof body?.defaultModel === "string" ? body.defaultModel.trim() : undefined;
        await setKey(workspaceId, provider as AIProvider, apiKey, { label, defaultModel });
        // Async: sync key to n8n credentials (best-effort, don't block response)
        void syncByokToN8n(workspaceId, provider).catch(() => undefined);
        sendJson(res, 200, { ok: true, workspaceId, provider });
        return true;
      }

      case "remove": {
        const provider = route.provider ?? "";
        if (!provider) {
          sendJson(res, 400, { ok: false, error: "provider is required" });
          return true;
        }
        const removed = await removeKey(workspaceId, provider as AIProvider);
        sendJson(res, 200, { ok: true, removed, workspaceId, provider });
        return true;
      }

      case "validate": {
        const body = (await readJsonBody(req, MAX_BODY_BYTES)) as Record<string, unknown> | null;
        const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
        if (!provider) {
          sendJson(res, 400, { ok: false, error: "provider is required" });
          return true;
        }
        let apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
        if (!apiKey) {
          const stored = await getKey(workspaceId, provider as AIProvider);
          if (!stored) {
            sendJson(res, 400, { ok: false, error: `No key stored for provider "${provider}"` });
            return true;
          }
          apiKey = stored;
        }
        const result = await validateKey(provider as AIProvider, apiKey);
        if (!body?.apiKey) {
          await markValidated(workspaceId, provider as AIProvider, result.valid);
        }
        sendJson(res, 200, { ...result, provider, workspaceId });
        return true;
      }

      default:
        return false;
    }
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err) });
    return true;
  }
}
