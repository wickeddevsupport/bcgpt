import type { GatewayClient } from "./server-methods/types.js";
import { resolveWorkspaceRequestScopeKey } from "./workspace-request.js";

export const GLOBAL_EVENT_SCOPE_KEY = "global";

export function resolveWorkspaceEventScopeKey(
  clientOrWorkspaceId: GatewayClient | string | null | undefined,
): string {
  if (typeof clientOrWorkspaceId === "string") {
    return resolveWorkspaceRequestScopeKey(clientOrWorkspaceId);
  }
  const workspaceId =
    typeof clientOrWorkspaceId?.pmosWorkspaceId === "string"
      ? clientOrWorkspaceId.pmosWorkspaceId.trim()
      : "";
  return resolveWorkspaceRequestScopeKey(workspaceId);
}

export function matchesWorkspaceEventScope(expectedScopeKey: string, actualScopeKey?: string): boolean {
  if (!actualScopeKey) {
    return expectedScopeKey === GLOBAL_EVENT_SCOPE_KEY;
  }
  return actualScopeKey === expectedScopeKey;
}
