import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveAgentRoute, type ResolveAgentRouteInput } from "../routing/resolve-route.js";
import { CONFIG_DIR, isRecord } from "../utils.js";
import { loadEffectiveWorkspaceConfig, readWorkspaceConfig } from "./workspace-config.js";

export type WorkspaceRouteResolution = {
  workspaceId: string | null;
  cfg: OpenClawConfig;
  route: ReturnType<typeof resolveAgentRoute>;
};

const MATCH_PRIORITY: Record<ReturnType<typeof resolveAgentRoute>["matchedBy"], number> = {
  "binding.peer": 6,
  "binding.peer.parent": 5,
  "binding.guild": 4,
  "binding.team": 4,
  "binding.account": 3,
  "binding.channel": 2,
  default: 1,
};

function asWorkspaceConfig(value: unknown): OpenClawConfig | null {
  return isRecord(value) ? (value as OpenClawConfig) : null;
}

async function listWorkspaceIds(): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(CONFIG_DIR, "workspaces"), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.trim())
      .map((entry) => entry.name.trim())
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function buildWorkspaceRouteInput(
  cfg: OpenClawConfig,
  input: Omit<ResolveAgentRouteInput, "cfg">,
): ReturnType<typeof resolveAgentRoute> {
  return resolveAgentRoute({ ...input, cfg });
}

export async function resolveWorkspaceRoute(
  input: ResolveAgentRouteInput,
): Promise<WorkspaceRouteResolution> {
  const fallbackRoute = buildWorkspaceRouteInput(input.cfg, input);
  let bestWorkspaceId: string | null = null;
  let bestScore = 0;

  for (const workspaceId of await listWorkspaceIds()) {
    const rawWorkspaceCfg = asWorkspaceConfig(await readWorkspaceConfig(workspaceId));
    if (!rawWorkspaceCfg || !Array.isArray(rawWorkspaceCfg.bindings) || rawWorkspaceCfg.bindings.length === 0) {
      continue;
    }
    const candidateRoute = buildWorkspaceRouteInput(rawWorkspaceCfg, input);
    if (candidateRoute.matchedBy === "default") {
      continue;
    }
    const score = MATCH_PRIORITY[candidateRoute.matchedBy];
    if (score > bestScore) {
      bestWorkspaceId = workspaceId;
      bestScore = score;
    }
  }

  if (!bestWorkspaceId) {
    return {
      workspaceId: null,
      cfg: input.cfg,
      route: fallbackRoute,
    };
  }

  const effectiveCfg = (await loadEffectiveWorkspaceConfig(bestWorkspaceId)) as OpenClawConfig;
  return {
    workspaceId: bestWorkspaceId,
    cfg: effectiveCfg,
    route: buildWorkspaceRouteInput(effectiveCfg, input),
  };
}
