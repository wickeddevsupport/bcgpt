import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsListResult, GatewayAgentRow } from "../types.ts";

export type AgentsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  agentsSelectedId: string | null;
};

type AgentRowDraft = {
  id: string;
  name?: string;
  identity?: GatewayAgentRow["identity"];
};

function mergeAgentRow(existing: GatewayAgentRow | undefined, next: GatewayAgentRow): GatewayAgentRow {
  return {
    ...(existing ?? {}),
    ...next,
    identity:
      existing?.identity || next.identity
        ? {
            ...(existing?.identity ?? {}),
            ...(next.identity ?? {}),
          }
        : undefined,
  };
}

export function createAgentListRow(agent: AgentRowDraft): GatewayAgentRow {
  const next: GatewayAgentRow = {
    id: agent.id,
  };
  const trimmedName = agent.name?.trim();
  if (trimmedName) {
    next.name = trimmedName;
  }
  const identity = agent.identity;
  if (identity) {
    const nextIdentity: NonNullable<GatewayAgentRow["identity"]> = {};
    const identityName = identity.name?.trim();
    const identityTheme = identity.theme?.trim();
    const identityEmoji = identity.emoji?.trim();
    const identityAvatar = identity.avatar?.trim();
    const identityAvatarUrl = identity.avatarUrl?.trim();
    if (identityName) {
      nextIdentity.name = identityName;
    }
    if (identityTheme) {
      nextIdentity.theme = identityTheme;
    }
    if (identityEmoji) {
      nextIdentity.emoji = identityEmoji;
    }
    if (identityAvatar) {
      nextIdentity.avatar = identityAvatar;
    }
    if (identityAvatarUrl) {
      nextIdentity.avatarUrl = identityAvatarUrl;
    }
    if (Object.keys(nextIdentity).length > 0) {
      next.identity = nextIdentity;
    }
  }
  return next;
}

export function upsertAgentsListResult(
  snapshot: AgentsListResult | null,
  row: GatewayAgentRow,
): AgentsListResult {
  const existingAgents = snapshot?.agents ?? [];
  const previous = existingAgents.find((entry) => entry.id === row.id);
  const merged = mergeAgentRow(previous, row);
  return {
    defaultId: snapshot?.defaultId || merged.id,
    mainKey: snapshot?.mainKey || "main",
    scope: snapshot?.scope || "",
    agents: [merged, ...existingAgents.filter((entry) => entry.id !== merged.id)],
  };
}

export async function loadAgents(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.agentsLoading) {
    return;
  }
  state.agentsLoading = true;
  state.agentsError = null;
  try {
    const res = await state.client.request<AgentsListResult>("agents.list", {});
    if (res) {
      const defaultId =
        typeof res.defaultId === "string" && res.agents.some((entry) => entry.id === res.defaultId)
          ? res.defaultId
          : (res.agents[0]?.id ?? res.defaultId);
      const normalized = { ...res, defaultId };
      state.agentsList = normalized;
      const selected = state.agentsSelectedId;
      const known = normalized.agents.some((entry) => entry.id === selected);
      if (!selected || !known) {
        state.agentsSelectedId = normalized.defaultId ?? normalized.agents[0]?.id ?? null;
      }
    }
  } catch (err) {
    state.agentsError = String(err);
  } finally {
    state.agentsLoading = false;
  }
}
