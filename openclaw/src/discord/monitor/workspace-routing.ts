import type { ResolveAgentRouteInput } from "../../routing/resolve-route.js";
import { resolveWorkspaceRoute, type WorkspaceRouteResolution } from "../../gateway/workspace-routing.js";

export async function resolveDiscordWorkspaceRoute(
  input: ResolveAgentRouteInput,
): Promise<WorkspaceRouteResolution> {
  return resolveWorkspaceRoute(input);
}
