import type { GatewayBrowserClient } from "../gateway.ts";

export type PmosProjectTodoItem = {
  id: string | null;
  title: string;
  status: string | null;
  dueOn: string | null;
  projectId: string | null;
  projectName: string | null;
  appUrl: string | null;
};

export type PmosProjectCard = {
  id: string;
  name: string;
  status: string;
  appUrl: string | null;
  todoLists: number;
  openTodos: number;
  overdueTodos: number;
  dueTodayTodos: number;
  nextDueOn: string | null;
  health: "at_risk" | "attention" | "on_track" | "quiet";
};

export type PmosProjectsSnapshot = {
  workspaceId: string;
  configured: boolean;
  connected: boolean;
  connectorUrl: string;
  identity: {
    connected: boolean;
    name?: string | null;
    email?: string | null;
    selectedAccountId?: string | null;
    accountsCount?: number;
    message?: string | null;
  } | null;
  totals: {
    projectCount: number;
    syncedProjects: number;
    openTodos: number;
    overdueTodos: number;
    dueTodayTodos: number;
  };
  projects: PmosProjectCard[];
  urgentTodos: PmosProjectTodoItem[];
  dueTodayTodos: PmosProjectTodoItem[];
  errors: string[];
  refreshedAtMs: number;
};

export type PmosProjectsState = {
  connected: boolean;
  client: GatewayBrowserClient | null;
  pmosProjectsLoading: boolean;
  pmosProjectsError: string | null;
  pmosProjectsSnapshot: PmosProjectsSnapshot | null;
};

export async function loadPmosProjectsSnapshot(state: PmosProjectsState) {
  if (!state.client || !state.connected) {
    state.pmosProjectsSnapshot = null;
    state.pmosProjectsError = "Connect to Wicked OS to load your project center.";
    return;
  }

  state.pmosProjectsLoading = true;
  state.pmosProjectsError = null;
  try {
    const snapshot = await state.client.request<PmosProjectsSnapshot>("pmos.projects.snapshot", {});
    state.pmosProjectsSnapshot = snapshot;
  } catch (err) {
    state.pmosProjectsError = String(err);
  } finally {
    state.pmosProjectsLoading = false;
  }
}
