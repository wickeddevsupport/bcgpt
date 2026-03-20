import type { GatewayBrowserClient } from "../gateway.ts";

export type PmosProjectDetailTab =
  | "overview"
  | "todos"
  | "messages"
  | "people"
  | "schedule"
  | "campfire"
  | "files"
  | "card_tables";

export type PmosProjectSectionResult = {
  loading: boolean;
  error: string | null;
  data: unknown;
};

export type PmosProjectTodoItem = {
  id: string | null;
  title: string;
  status: string | null;
  dueOn: string | null;
  projectId: string | null;
  projectName: string | null;
  appUrl: string | null;
};

export type PmosProjectDockCapability = {
  id: string | null;
  name: string | null;
  title: string | null;
  enabled: boolean;
  position: number | null;
  url: string | null;
  appUrl: string | null;
};

export type PmosProjectCard = {
  id: string;
  name: string;
  status: string;
  appUrl: string | null;
  description: string | null;
  updatedAt: string | null;
  dockCapabilities: PmosProjectDockCapability[];
  todoLists: number;
  openTodos: number;
  assignedTodos: number;
  overdueTodos: number;
  dueTodayTodos: number;
  futureTodos: number;
  noDueDateTodos: number;
  nextDueOn: string | null;
  health: "at_risk" | "attention" | "on_track" | "quiet";
  previewTodos: PmosProjectTodoItem[];
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
    assignedTodos: number;
    overdueTodos: number;
    dueTodayTodos: number;
    futureTodos: number;
    noDueDateTodos: number;
  };
  projects: PmosProjectCard[];
  assignedTodos: PmosProjectTodoItem[];
  urgentTodos: PmosProjectTodoItem[];
  dueTodayTodos: PmosProjectTodoItem[];
  futureTodos: PmosProjectTodoItem[];
  noDueDateTodos: PmosProjectTodoItem[];
  errors: string[];
  refreshedAtMs: number;
  refreshing?: boolean;
  stale?: boolean;
  staleReason?: string | null;
  cacheAgeMs?: number;
};

export type PmosEntityReference = {
  type: string;
  id: string | null;
  projectId: string | null;
  url: string | null;
  label?: string | null;
};

export type PmosEntityComment = {
  id: string | null;
  author: string | null;
  createdAt: string | null;
  content: string | null;
  appUrl: string | null;
};

export type PmosEntityEvent = {
  id: string | null;
  action: string | null;
  createdAt: string | null;
  actor: string | null;
  summary: string | null;
};

export type PmosEntityDetail = {
  reference: PmosEntityReference;
  project: { id: string | null; name: string | null; appUrl: string | null } | null;
  title: string;
  status: string | null;
  appUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  creator: string | null;
  assignee: string | null;
  summary: string | null;
  raw: unknown;
  comments: PmosEntityComment[];
  events: PmosEntityEvent[];
  subscription: unknown;
};

export type PmosCreateTodoInput = {
  projectName: string;
  title: string;
  description?: string | null;
  todolist?: string | null;
  dueOn?: string | null;
};

export type PmosTodoMutationInput = {
  projectName: string;
  todoId: string;
};

export type PmosCreateCommentInput = {
  projectName: string;
  reference: PmosEntityReference;
  content: string;
};

export type PmosMutationResult = {
  ok: boolean;
  message: string;
  detail?: unknown;
};

export type PmosProjectsState = {
  connected: boolean;
  client: GatewayBrowserClient | null;
  pmosProjectsLoading: boolean;
  pmosProjectsError: string | null;
  pmosProjectsSnapshot: PmosProjectsSnapshot | null;
  pmosProjectsLoadSequence?: number;
};

async function requestProjectsSnapshot(
  client: GatewayBrowserClient,
): Promise<PmosProjectsSnapshot> {
  // No client-side timeout — server-side tool timeouts (12-15s each) handle it.
  return await client.request<PmosProjectsSnapshot>("pmos.projects.snapshot", {});
}

export async function loadPmosProjectsSnapshot(state: PmosProjectsState) {
  if (!state.client || !state.connected) {
    // Keep previous snapshot visible (stale data is better than empty)
    state.pmosProjectsLoading = false;
    state.pmosProjectsError = state.pmosProjectsSnapshot
      ? "Reconnect to Wicked OS to refresh projects."
      : "Connect to Wicked OS to load your project center.";
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

export async function fetchProjectSection(
  client: GatewayBrowserClient,
  projectName: string,
  section: PmosProjectDetailTab,
): Promise<unknown> {
  if (section === "overview") return null;
  return await client.request<{ ok: boolean; section: string; projectName: string; data: unknown }>(
    "pmos.project.fetch",
    { projectName, section },
  ).then((r) => r.data);
}

export async function fetchProjectEntityDetail(
  client: GatewayBrowserClient,
  reference: PmosEntityReference,
): Promise<PmosEntityDetail> {
  return await client.request<PmosEntityDetail>("pmos.entity.detail", {
    type: reference.type,
    id: reference.id,
    projectId: reference.projectId,
    url: reference.url,
  });
}

export async function createProjectTodo(
  client: GatewayBrowserClient,
  input: PmosCreateTodoInput,
): Promise<PmosMutationResult> {
  return await client.request<PmosMutationResult>("pmos.todo.create", {
    projectName: input.projectName,
    title: input.title,
    description: input.description ?? null,
    todolist: input.todolist ?? null,
    dueOn: input.dueOn ?? null,
  });
}

export async function completeProjectTodo(
  client: GatewayBrowserClient,
  input: PmosTodoMutationInput,
): Promise<PmosMutationResult> {
  return await client.request<PmosMutationResult>("pmos.todo.complete", {
    projectName: input.projectName,
    todoId: input.todoId,
  });
}

export async function reopenProjectTodo(
  client: GatewayBrowserClient,
  input: PmosTodoMutationInput,
): Promise<PmosMutationResult> {
  return await client.request<PmosMutationResult>("pmos.todo.uncomplete", {
    projectName: input.projectName,
    todoId: input.todoId,
  });
}

export async function createProjectComment(
  client: GatewayBrowserClient,
  input: PmosCreateCommentInput,
): Promise<PmosMutationResult> {
  return await client.request<PmosMutationResult>("pmos.comment.create", {
    projectName: input.projectName,
    type: input.reference.type,
    id: input.reference.id,
    projectId: input.reference.projectId,
    url: input.reference.url,
    content: input.content,
  });
}
