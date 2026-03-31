import type { GatewayClient } from "./server-methods/types.js";
import { isSuperAdmin } from "./workspace-context.js";

function trimWorkspaceId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function resolveRequestedWorkspaceId(params: unknown): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  return trimWorkspaceId((params as { workspaceId?: unknown }).workspaceId);
}

export function resolveEffectiveRequestWorkspaceId(
  client: GatewayClient | null | undefined,
  params: unknown,
): string | undefined {
  const requestedWorkspaceId = resolveRequestedWorkspaceId(params);
  const clientWorkspaceId = trimWorkspaceId(client?.pmosWorkspaceId);
  if (!client) {
    return requestedWorkspaceId;
  }
  const hasPmosContext = Boolean(clientWorkspaceId || client.pmosRole);
  if (!hasPmosContext) {
    return requestedWorkspaceId;
  }
  if (isSuperAdmin(client)) {
    return requestedWorkspaceId;
  }
  return clientWorkspaceId;
}