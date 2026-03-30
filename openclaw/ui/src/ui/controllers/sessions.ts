import type { GatewayBrowserClient } from "../gateway.ts";
import type { SessionsListResult } from "../types.ts";
import { toNumber } from "../format.ts";
import { parseAgentSessionKey } from "../../../../src/routing/session-key.js";

export type SessionsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionsLoading: boolean;
  sessionsResult: SessionsListResult | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
  sessionKey?: string;
  chatRunId?: string | null;
  settings?: {
    sessionKey: string;
    lastActiveSessionKey: string;
    [key: string]: unknown;
  };
  agentsSelectedId?: string | null;
  assistantAgentId?: string | null;
  applySettings?: (next: Record<string, unknown>) => void;
  pmosAuthUser?: { role?: string | null } | null;
  agentsList?: { defaultId?: string; agents?: Array<{ id: string }> } | null;
};

function isKnownWorkspaceAgentSession(state: SessionsState, key: string): boolean {
  const parsed = parseAgentSessionKey(key);
  if (!parsed?.agentId) {
    return false;
  }
  const agentId = parsed.agentId.trim();
  if (!agentId) {
    return false;
  }
  return (
    Array.isArray(state.agentsList?.agents) &&
    state.agentsList.agents.some((agent) => agent.id === agentId)
  );
}

function syncSelectedAgentForSession(state: SessionsState, key: string): void {
  const parsedAgentId = parseAgentSessionKey(key)?.agentId?.trim();
  if (parsedAgentId) {
    state.agentsSelectedId = parsedAgentId;
    return;
  }
  const defaultAgentId = state.agentsList?.defaultId?.trim();
  if (defaultAgentId) {
    state.agentsSelectedId = defaultAgentId;
    return;
  }
  const assistantAgentId = state.assistantAgentId?.trim();
  if (assistantAgentId) {
    state.agentsSelectedId = assistantAgentId;
    return;
  }
  const firstAgentId = state.agentsList?.agents?.[0]?.id?.trim();
  if (firstAgentId) {
    state.agentsSelectedId = firstAgentId;
  }
}

export function syncWorkspaceSessionSelection(
  state: SessionsState,
  res: SessionsListResult,
): boolean {
  const role = state.pmosAuthUser?.role ?? null;
  if (!role || role === "super_admin") {
    return false;
  }
  const availableKeys = Array.isArray(res.sessions)
    ? res.sessions
        .map((row) => (typeof row.key === "string" ? row.key.trim() : ""))
        .filter(Boolean)
    : [];
  const currentKey = typeof state.sessionKey === "string" ? state.sessionKey.trim() : "";
  if (
    currentKey &&
    (availableKeys.includes(currentKey) || isKnownWorkspaceAgentSession(state, currentKey))
  ) {
    return false;
  }
  let nextKey = availableKeys[0] ?? "";
  if (!nextKey) {
    const fallbackAgentId =
      (typeof state.agentsList?.defaultId === "string" && state.agentsList.defaultId.trim()) ||
      (Array.isArray(state.agentsList?.agents) &&
        typeof state.agentsList.agents[0]?.id === "string" &&
        state.agentsList.agents[0].id.trim()) ||
      "";
    if (fallbackAgentId) {
      nextKey = `agent:${fallbackAgentId}:main`;
    }
  }
  if (!nextKey || nextKey === currentKey) {
    return false;
  }
  state.sessionKey = nextKey;
  syncSelectedAgentForSession(state, nextKey);
  if (state.settings && typeof state.applySettings === "function") {
    state.applySettings({
      ...state.settings,
      sessionKey: nextKey,
      lastActiveSessionKey: nextKey,
    });
  } else if (state.settings) {
    state.settings = {
      ...state.settings,
      sessionKey: nextKey,
      lastActiveSessionKey: nextKey,
    };
  }
  return true;
}

function syncActiveRunState(
  state: SessionsState,
  res: SessionsListResult,
  options?: {
    preserveLocalRunIfSessionMissing?: boolean;
    sessionSelectionChanged?: boolean;
  },
): void {
  const currentKey = typeof state.sessionKey === "string" ? state.sessionKey.trim() : "";
  if (!currentKey) {
    state.chatRunId = null;
    return;
  }
  const currentSession = Array.isArray(res.sessions)
    ? res.sessions.find((row) => (typeof row.key === "string" ? row.key.trim() : "") === currentKey)
    : undefined;
  if (!currentSession) {
    if (!state.chatRunId || !options?.preserveLocalRunIfSessionMissing) {
      state.chatRunId = null;
    }
    return;
  }
  const remoteActiveRunId =
    typeof currentSession.activeRunId === "string" ? currentSession.activeRunId : null;
  if (remoteActiveRunId) {
    state.chatRunId = remoteActiveRunId;
    return;
  }
  if (options?.sessionSelectionChanged) {
    state.chatRunId = null;
    return;
  }
  if (!state.chatRunId) {
    state.chatRunId = null;
  }
}

export async function loadSessions(
  state: SessionsState,
  overrides?: {
    activeMinutes?: number;
    limit?: number;
    includeGlobal?: boolean;
    includeUnknown?: boolean;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.sessionsLoading) {
    return;
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  try {
    const includeGlobal = overrides?.includeGlobal ?? state.sessionsIncludeGlobal;
    const includeUnknown = overrides?.includeUnknown ?? state.sessionsIncludeUnknown;
    const activeMinutes = overrides?.activeMinutes ?? toNumber(state.sessionsFilterActive, 0);
    const limit = overrides?.limit ?? toNumber(state.sessionsFilterLimit, 0);
    const params: Record<string, unknown> = {
      includeGlobal,
      includeUnknown,
    };
    if (activeMinutes > 0) {
      params.activeMinutes = activeMinutes;
    }
    if (limit > 0) {
      params.limit = limit;
    }
    const res = await state.client.request<SessionsListResult | undefined>("sessions.list", params);
    if (res) {
      state.sessionsResult = res;
      const sessionSelectionChanged = syncWorkspaceSessionSelection(state, res);
      syncActiveRunState(state, res, {
        preserveLocalRunIfSessionMissing: !sessionSelectionChanged,
        sessionSelectionChanged,
      });
    }
  } catch (err) {
    state.sessionsError = String(err);
  } finally {
    state.sessionsLoading = false;
  }
}

export async function patchSession(
  state: SessionsState,
  key: string,
  patch: {
    label?: string | null;
    thinkingLevel?: string | null;
    verboseLevel?: string | null;
    reasoningLevel?: string | null;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const params: Record<string, unknown> = { key };
  if ("label" in patch) {
    params.label = patch.label;
  }
  if ("thinkingLevel" in patch) {
    params.thinkingLevel = patch.thinkingLevel;
  }
  if ("verboseLevel" in patch) {
    params.verboseLevel = patch.verboseLevel;
  }
  if ("reasoningLevel" in patch) {
    params.reasoningLevel = patch.reasoningLevel;
  }
  try {
    await state.client.request("sessions.patch", params);
    await loadSessions(state);
  } catch (err) {
    state.sessionsError = String(err);
  }
}

export async function deleteSession(state: SessionsState, key: string) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.sessionsLoading) {
    return;
  }
  const confirmed = window.confirm(
    `Delete session "${key}"?\n\nDeletes the session entry and archives its transcript.`,
  );
  if (!confirmed) {
    return;
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  try {
    await state.client.request("sessions.delete", { key, deleteTranscript: true });
    await loadSessions(state);
  } catch (err) {
    state.sessionsError = String(err);
  } finally {
    state.sessionsLoading = false;
  }
}
