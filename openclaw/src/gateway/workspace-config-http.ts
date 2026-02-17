import type { IncomingMessage, ServerResponse } from "node:http";
import { resolvePmosSessionFromRequest } from "./pmos-auth.js";
import { readJsonBody } from "./hooks.js";
import {
  loadEffectiveWorkspaceConfig,
  patchWorkspaceConfig,
  readWorkspaceConfig,
  writeWorkspaceConfig,
} from "./workspace-config.js";

const MAX_BODY_BYTES = 128 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function resolveTargetWorkspaceId(url: URL, fallback: string): string {
  const target = url.searchParams.get("workspaceId")?.trim();
  return target || fallback;
}

export async function handleWorkspaceConfigHttp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/pmos/config" && url.pathname !== "/api/pmos/config/") {
    return false;
  }

  const method = (req.method ?? "GET").toUpperCase();
  if (!["GET", "POST"].includes(method)) {
    sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
    return true;
  }

  const session = await resolvePmosSessionFromRequest(req);
  if (!session.ok) {
    sendJson(res, 401, { ok: false, error: "Authentication required" });
    return true;
  }

  const targetWorkspaceId = resolveTargetWorkspaceId(url, session.user.workspaceId);
  if (targetWorkspaceId !== session.user.workspaceId && session.user.role !== "super_admin") {
    sendJson(res, 403, { ok: false, error: "Access denied" });
    return true;
  }

  try {
    if (method === "GET") {
      const workspaceConfig = (await readWorkspaceConfig(targetWorkspaceId)) ?? {};
      const effectiveConfig = await loadEffectiveWorkspaceConfig(targetWorkspaceId);
      sendJson(res, 200, {
        ok: true,
        workspaceId: targetWorkspaceId,
        workspaceConfig,
        effectiveConfig,
      });
      return true;
    }

    const body = await readJsonBody(req, MAX_BODY_BYTES);
    if (!body.ok || !body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
      sendJson(res, 400, { ok: false, error: "Expected JSON object body" });
      return true;
    }
    const payload = body.value as Record<string, unknown>;
    const replace = payload.replace === true;
    const patch = payload.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      sendJson(res, 400, { ok: false, error: "patch object is required" });
      return true;
    }

    let workspaceConfig: Record<string, unknown>;
    if (replace) {
      workspaceConfig = patch as Record<string, unknown>;
      await writeWorkspaceConfig(targetWorkspaceId, workspaceConfig);
    } else {
      workspaceConfig = await patchWorkspaceConfig(
        targetWorkspaceId,
        patch as Record<string, unknown>,
      );
    }
    const effectiveConfig = await loadEffectiveWorkspaceConfig(targetWorkspaceId);
    sendJson(res, 200, { ok: true, workspaceId: targetWorkspaceId, workspaceConfig, effectiveConfig });
    return true;
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err) });
    return true;
  }
}
