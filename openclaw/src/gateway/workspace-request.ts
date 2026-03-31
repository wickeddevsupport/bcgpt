import { loadConfig, type OpenClawConfig } from "../config/config.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  listAgentsForGateway,
  resolveGatewaySessionStoreTarget,
} from "./session-utils.js";
import type { GatewayClient } from "./server-methods/types.js";
import { getClientWorkspaceId, isSuperAdmin } from "./workspace-context.js";
import { loadEffectiveWorkspaceConfig } from "./workspace-config.js";

export type WorkspaceRequestContext = {
  workspaceId?: string;
  isWorkspaceScoped: boolean;
  isSuperAdmin: boolean;
  cfg: OpenClawConfig;
  workspaceAgentIds: Set<string> | null;
  scopeKey: string;
};

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
  const clientWorkspaceId = client ? getClientWorkspaceId(client) : undefined;
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

export function resolveWorkspaceRequestScopeKey(workspaceId?: string | null): string {
  const resolvedWorkspaceId = trimWorkspaceId(workspaceId);
  return resolvedWorkspaceId ? `workspace:${resolvedWorkspaceId}` : "global";
}

function formatWorkspaceContextLoadError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message.trim();
  }
  return String(err);
}

function resolveWorkspaceAgentIds(
  cfg: OpenClawConfig,
  workspaceId?: string,
): Set<string> | null {
  if (!workspaceId) {
    return null;
  }
  const { agents } = listAgentsForGateway(cfg);
  return new Set(
    agents
      .filter((agent) => trimWorkspaceId(agent.workspaceId) === workspaceId)
      .map((agent) => normalizeAgentId(agent.id)),
  );
}

export async function resolveWorkspaceRequestContext(
  client: GatewayClient | null | undefined,
  params: unknown,
  opts?: { configLabel?: string },
): Promise<WorkspaceRequestContext> {
  const workspaceId = resolveEffectiveRequestWorkspaceId(client, params);
  const superAdmin = Boolean(client && isSuperAdmin(client));

  let cfg = loadConfig();
  if (workspaceId) {
    try {
      cfg = (await loadEffectiveWorkspaceConfig(workspaceId)) as OpenClawConfig;
    } catch (err) {
      const label = opts?.configLabel?.trim();
      const prefix = label
        ? `failed to load workspace-scoped ${label} config for ${workspaceId}`
        : `failed to load workspace-scoped config for ${workspaceId}`;
      throw new Error(`${prefix}: ${formatWorkspaceContextLoadError(err)}`);
    }
  }

  return {
    workspaceId,
    isWorkspaceScoped: Boolean(workspaceId),
    isSuperAdmin: superAdmin,
    cfg,
    workspaceAgentIds: resolveWorkspaceAgentIds(cfg, workspaceId),
    scopeKey: resolveWorkspaceRequestScopeKey(workspaceId),
  };
}

export function workspaceRequestCanAccessAgent(
  context: WorkspaceRequestContext,
  agentId: string | null | undefined,
): boolean {
  if (!context.workspaceAgentIds) {
    return true;
  }
  const normalizedAgentId = normalizeAgentId(String(agentId ?? "").trim());
  return Boolean(normalizedAgentId && context.workspaceAgentIds.has(normalizedAgentId));
}

export function workspaceRequestCanAccessSessionKey(
  context: WorkspaceRequestContext,
  sessionKey: string,
): boolean {
  if (!context.workspaceAgentIds) {
    return true;
  }
  const target = resolveGatewaySessionStoreTarget({ cfg: context.cfg, key: sessionKey });
  return workspaceRequestCanAccessAgent(context, target.agentId);
}