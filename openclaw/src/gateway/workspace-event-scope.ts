import type { GatewayClient } from "./server-methods/types.js";

export const GLOBAL_EVENT_SCOPE_KEY = "global";

export function resolveWorkspaceEventScopeKey(client: GatewayClient | null | undefined): string {
  const workspaceId =
    typeof client?.pmosWorkspaceId === "string" ? client.pmosWorkspaceId.trim() : "";
  return workspaceId ? `workspace:${workspaceId}` : GLOBAL_EVENT_SCOPE_KEY;
}

export function matchesWorkspaceEventScope(expectedScopeKey: string, actualScopeKey?: string): boolean {
  if (!actualScopeKey) {
    return expectedScopeKey === GLOBAL_EVENT_SCOPE_KEY;
  }
  return actualScopeKey === expectedScopeKey;
}
