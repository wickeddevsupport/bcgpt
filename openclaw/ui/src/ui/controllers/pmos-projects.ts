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
  refreshing?: boolean;
  stale?: boolean;
  staleReason?: string | null;
  cacheAgeMs?: number;
};

export type PmosProjectsState = {
  connected: boolean;
  client: GatewayBrowserClient | null;
  pmosProjectsLoading: boolean;
  pmosProjectsError: string | null;
  pmosProjectsSnapshot: PmosProjectsSnapshot | null;
  pmosProjectsLoadSequence?: number;
};

const PROJECT_SNAPSHOT_TIMEOUT_MS = 18_000;

async function requestProjectsSnapshot(
  client: GatewayBrowserClient,
): Promise<PmosProjectsSnapshot> {
  return await Promise.race([
    client.request<PmosProjectsSnapshot>("pmos.projects.snapshot", {}),
    new Promise<PmosProjectsSnapshot>((_, reject) => {
      globalThis.setTimeout(() => {
        reject(new Error("Project refresh timed out after 18s."));
      }, PROJECT_SNAPSHOT_TIMEOUT_MS);
    }),
  ]);
}

export async function loadPmosProjectsSnapshot(state: PmosProjectsState) {
  if (!state.client || !state.connected) {
    state.pmosProjectsSnapshot = null;
    state.pmosProjectsLoading = false;
    state.pmosProjectsError = "Connect to Wicked OS to load your project center.";
    return;
  }

  const loadSequence = (state.pmosProjectsLoadSequence ?? 0) + 1;
  state.pmosProjectsLoadSequence = loadSequence;
  const previousSnapshot = state.pmosProjectsSnapshot;
  state.pmosProjectsLoading = true;
  state.pmosProjectsError = null;
  if (previousSnapshot) {
    state.pmosProjectsSnapshot = {
      ...previousSnapshot,
      refreshing: true,
      cacheAgeMs: Math.max(0, Date.now() - previousSnapshot.refreshedAtMs),
      staleReason: null,
    };
  }
  try {
    const snapshot = await requestProjectsSnapshot(state.client);
    if (state.pmosProjectsLoadSequence !== loadSequence) {
      return;
    }
    state.pmosProjectsSnapshot = {
      ...snapshot,
      refreshing: false,
      stale: false,
      staleReason: null,
      cacheAgeMs: 0,
    };
  } catch (err) {
    if (state.pmosProjectsLoadSequence !== loadSequence) {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (previousSnapshot) {
      state.pmosProjectsSnapshot = {
        ...previousSnapshot,
        refreshing: false,
        stale: true,
        staleReason: message,
        cacheAgeMs: Math.max(0, Date.now() - previousSnapshot.refreshedAtMs),
      };
      state.pmosProjectsError = `Refresh failed. Showing the last successful snapshot. ${message}`;
    } else {
      state.pmosProjectsError = message;
    }
  } finally {
    if (state.pmosProjectsLoadSequence === loadSequence) {
      state.pmosProjectsLoading = false;
    }
  }
}
