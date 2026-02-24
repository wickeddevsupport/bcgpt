import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsListResult } from "../types.ts";

export type AgentsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  agentsSelectedId: string | null;
};

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
