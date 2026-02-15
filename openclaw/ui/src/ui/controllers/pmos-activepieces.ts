import type { UiSettings } from "../storage.ts";

type ToolInvokeOk = {
  ok: true;
  // Tool result shape comes from the gateway tool executor.
  // We rely on the `details` field we attach in the tool plugin for structured access.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
};

type ToolInvokeErr = {
  ok: false;
  error?: { type?: string; message?: string };
};

type SeekPage<T> = {
  data: T[];
  next: string | null;
  previous: string | null;
};

export type ActivepiecesPieceSummary = {
  name?: string;
  displayName?: string;
  description?: string;
  logoUrl?: string;
  version?: string;
};

export type ActivepiecesFlowSummary = {
  id: string;
  displayName?: string;
  status?: string;
  updated?: string;
  created?: string;
};

export type ActivepiecesRunSummary = {
  id: string;
  flowId?: string;
  projectId?: string;
  status?: string;
  created?: string;
};

export type ActivepiecesConnectionSummary = {
  id: string;
  displayName?: string;
  pieceName?: string;
  type?: string;
  status?: string;
  created?: string;
};

export type PmosActivepiecesState = {
  settings: UiSettings;
  basePath: string;
  connected: boolean;
  sessionKey: string;

  // Connector config drafts (Phase 1)
  pmosActivepiecesProjectId: string;

  // Pieces
  apPiecesLoading: boolean;
  apPiecesError: string | null;
  apPiecesQuery: string;
  apPieces: ActivepiecesPieceSummary[];
  apPieceSelectedName: string | null;
  apPieceDetailsLoading: boolean;
  apPieceDetailsError: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apPieceDetails: any | null;

  // Connections
  apConnectionsLoading: boolean;
  apConnectionsError: string | null;
  apConnections: ActivepiecesConnectionSummary[];
  apConnectionsCursor: string | null;
  apConnectionsHasNext: boolean;
  apConnectionCreateSaving: boolean;
  apConnectionCreateError: string | null;
  apConnectionCreatePieceName: string;
  apConnectionCreateDisplayName: string;
  apConnectionCreateType: "secret_text" | "basic_auth" | "no_auth";
  apConnectionCreateSecretText: string;
  apConnectionCreateBasicUser: string;
  apConnectionCreateBasicPass: string;

  // Flows
  apFlowsLoading: boolean;
  apFlowsError: string | null;
  apFlowsQuery: string;
  apFlows: ActivepiecesFlowSummary[];
  apFlowsCursor: string | null;
  apFlowsHasNext: boolean;
  apFlowCreateName: string;
  apFlowCreateSaving: boolean;
  apFlowCreateError: string | null;
  apFlowSelectedId: string | null;
  apFlowDetailsLoading: boolean;
  apFlowDetailsError: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apFlowDetails: any | null;
  apFlowRenameDraft: string;
  apFlowOperationDraft: string;
  apFlowTriggerPayloadDraft: string;
  apFlowMutating: boolean;
  apFlowMutateError: string | null;

  // Runs
  apRunsLoading: boolean;
  apRunsError: string | null;
  apRuns: ActivepiecesRunSummary[];
  apRunsCursor: string | null;
  apRunsHasNext: boolean;
  apRunSelectedId: string | null;
  apRunDetailsLoading: boolean;
  apRunDetailsError: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apRunDetails: any | null;
  apRunRetrying: boolean;
  apRunRetryError: string | null;
};

function normalizeBasePath(basePath: string): string {
  const trimmed = (basePath ?? "").trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function resolveToolsInvokeUrl(state: { basePath: string }): string {
  const base = normalizeBasePath(state.basePath);
  return base ? `${base}/tools/invoke` : "/tools/invoke";
}

async function invokeTool<T = unknown>(
  state: Pick<PmosActivepiecesState, "settings" | "basePath" | "sessionKey">,
  tool: string,
  args: Record<string, unknown>,
): Promise<T> {
  const token = state.settings.token?.trim() ?? "";
  if (!token) {
    throw new Error("PMOS access key missing. Go to Dashboard -> System -> paste key -> Connect.");
  }

  const res = await fetch(resolveToolsInvokeUrl(state), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      tool,
      args,
      sessionKey: state.sessionKey || "main",
    }),
  });

  const data = (await res.json().catch(() => null)) as ToolInvokeOk | ToolInvokeErr | null;
  if (!data) {
    throw new Error(`Tool invoke failed (${res.status}): empty response`);
  }
  if (!data.ok) {
    const message = data.error?.message ?? `Tool invoke failed (${res.status})`;
    throw new Error(message);
  }

  // Our Activepieces tools return `{ details, content }` payloads; prefer the structured `details`.
  const details = (data.result as { details?: unknown } | null)?.details;
  return (details ?? data.result) as T;
}

function resolveProjectId(state: Pick<PmosActivepiecesState, "pmosActivepiecesProjectId">): string | null {
  const projectId = state.pmosActivepiecesProjectId?.trim() ?? "";
  return projectId ? projectId : null;
}

function coerceArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function coerceSeekPage<T>(value: unknown): SeekPage<T> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const obj = value as Partial<SeekPage<T>>;
  const data = Array.isArray(obj.data) ? obj.data : [];
  const next = typeof obj.next === "string" ? obj.next : null;
  const previous = typeof obj.previous === "string" ? obj.previous : null;
  return { data, next, previous };
}

export async function loadActivepiecesPieces(state: PmosActivepiecesState) {
  state.apPiecesLoading = true;
  state.apPiecesError = null;
  try {
    const details = await invokeTool<unknown>(state, "flow_pieces_list", {
      searchQuery: state.apPiecesQuery?.trim() || undefined,
      // Prefer configured projectId when present (some installs scope pieces by project).
      projectId: resolveProjectId(state) ?? undefined,
      includeTags: true,
    });
    const list = coerceArray<ActivepiecesPieceSummary>(details);
    state.apPieces = list;
  } catch (err) {
    state.apPiecesError = String(err);
    state.apPieces = [];
  } finally {
    state.apPiecesLoading = false;
  }
}

export async function loadActivepiecesPieceDetails(state: PmosActivepiecesState, pieceName: string) {
  const name = pieceName.trim();
  if (!name) {
    return;
  }
  state.apPieceSelectedName = name;
  state.apPieceDetailsLoading = true;
  state.apPieceDetailsError = null;
  try {
    // /api/v1/pieces/:name is supported, but we currently rely on list data for summaries.
    // For deep details we use a generic request via flow_api? (not implemented).
    // For now, we load the piece by listing and selecting; keep placeholder for later.
    state.apPieceDetails = null;
  } catch (err) {
    state.apPieceDetailsError = String(err);
    state.apPieceDetails = null;
  } finally {
    state.apPieceDetailsLoading = false;
  }
}

export async function loadActivepiecesConnections(state: PmosActivepiecesState, opts?: { cursor?: string | null }) {
  const projectId = resolveProjectId(state);
  if (!projectId) {
    state.apConnectionsError =
      "Activepieces Project ID is required. Set it in Integrations -> Activepieces -> Project ID, then Save.";
    state.apConnections = [];
    return;
  }
  state.apConnectionsLoading = true;
  state.apConnectionsError = null;
  try {
    const details = await invokeTool<unknown>(state, "flow_connections_list", {
      projectId,
      cursor: opts?.cursor ?? null,
      limit: 25,
    });
    const page = coerceSeekPage<ActivepiecesConnectionSummary>(details);
    if (!page) {
      state.apConnections = [];
      state.apConnectionsCursor = null;
      state.apConnectionsHasNext = false;
      return;
    }
    state.apConnections = page.data ?? [];
    state.apConnectionsCursor = page.next;
    state.apConnectionsHasNext = Boolean(page.next);
  } catch (err) {
    state.apConnectionsError = String(err);
    state.apConnections = [];
    state.apConnectionsCursor = null;
    state.apConnectionsHasNext = false;
  } finally {
    state.apConnectionsLoading = false;
  }
}

export async function createActivepiecesConnection(state: PmosActivepiecesState) {
  const projectId = resolveProjectId(state);
  if (!projectId) {
    state.apConnectionCreateError =
      "Activepieces Project ID is required. Set it in Integrations -> Activepieces -> Project ID, then Save.";
    return;
  }
  const pieceName = state.apConnectionCreatePieceName.trim();
  const displayName = state.apConnectionCreateDisplayName.trim();
  if (!pieceName || !displayName) {
    state.apConnectionCreateError = "pieceName and displayName are required.";
    return;
  }
  state.apConnectionCreateSaving = true;
  state.apConnectionCreateError = null;
  try {
    const type = state.apConnectionCreateType;
    let connection: Record<string, unknown>;
    if (type === "secret_text") {
      const secret = state.apConnectionCreateSecretText.trim();
      if (!secret) {
        throw new Error("secret_text value is required for Secret Text connections.");
      }
      connection = {
        type: "SECRET_TEXT",
        projectId,
        externalId: `${pieceName}-${Date.now()}`,
        displayName,
        pieceName,
        value: { type: "SECRET_TEXT", secret_text: secret },
      };
    } else if (type === "basic_auth") {
      const username = state.apConnectionCreateBasicUser.trim();
      const password = state.apConnectionCreateBasicPass;
      if (!username || !password) {
        throw new Error("username and password are required for Basic Auth connections.");
      }
      connection = {
        type: "BASIC_AUTH",
        projectId,
        externalId: `${pieceName}-${Date.now()}`,
        displayName,
        pieceName,
        value: { type: "BASIC_AUTH", username, password },
      };
    } else {
      connection = {
        type: "NO_AUTH",
        projectId,
        externalId: `${pieceName}-${Date.now()}`,
        displayName,
        pieceName,
        value: { type: "NO_AUTH" },
      };
    }
    await invokeTool(state, "flow_connection_upsert", { connection });
    // Reset drafts that may contain secrets.
    state.apConnectionCreateSecretText = "";
    state.apConnectionCreateBasicPass = "";
    await loadActivepiecesConnections(state);
  } catch (err) {
    state.apConnectionCreateError = String(err);
  } finally {
    state.apConnectionCreateSaving = false;
  }
}

export async function deleteActivepiecesConnection(state: PmosActivepiecesState, connectionId: string) {
  const id = connectionId.trim();
  if (!id) {
    return;
  }
  state.apConnectionsError = null;
  try {
    await invokeTool(state, "flow_connection_delete", { connectionId: id });
    await loadActivepiecesConnections(state);
  } catch (err) {
    state.apConnectionsError = String(err);
  }
}

export async function loadActivepiecesFlows(state: PmosActivepiecesState, opts?: { cursor?: string | null }) {
  const projectId = resolveProjectId(state);
  if (!projectId) {
    state.apFlowsError =
      "Activepieces Project ID is required. Set it in Integrations -> Activepieces -> Project ID, then Save.";
    state.apFlows = [];
    return;
  }
  state.apFlowsLoading = true;
  state.apFlowsError = null;
  try {
    const details = await invokeTool<unknown>(state, "flow_flows_list", {
      projectId,
      cursor: opts?.cursor ?? null,
      limit: 25,
      name: state.apFlowsQuery?.trim() || undefined,
    });
    const page = coerceSeekPage<ActivepiecesFlowSummary>(details);
    if (!page) {
      state.apFlows = [];
      state.apFlowsCursor = null;
      state.apFlowsHasNext = false;
      return;
    }
    // Activepieces flow summaries often nest the human name under `version.displayName`.
    // Normalize so the UI can display `flow.displayName` consistently.
    const flows = (page.data ?? []) as unknown[];
    state.apFlows = flows.map((flowUnknown) => {
      if (!flowUnknown || typeof flowUnknown !== "object" || Array.isArray(flowUnknown)) {
        return flowUnknown as ActivepiecesFlowSummary;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const flow: any = flowUnknown;
      const rawTop = typeof flow.displayName === "string" ? flow.displayName.trim() : "";
      const rawNested =
        typeof flow?.version?.displayName === "string" ? String(flow.version.displayName).trim() : "";
      const displayName = rawTop || rawNested || undefined;
      return displayName ? ({ ...flow, displayName } as ActivepiecesFlowSummary) : (flow as ActivepiecesFlowSummary);
    });
    state.apFlowsCursor = page.next;
    state.apFlowsHasNext = Boolean(page.next);
  } catch (err) {
    state.apFlowsError = String(err);
    state.apFlows = [];
    state.apFlowsCursor = null;
    state.apFlowsHasNext = false;
  } finally {
    state.apFlowsLoading = false;
  }
}

export async function createActivepiecesFlow(state: PmosActivepiecesState) {
  const projectId = resolveProjectId(state);
  if (!projectId) {
    state.apFlowCreateError =
      "Activepieces Project ID is required. Set it in Integrations -> Activepieces -> Project ID, then Save.";
    return;
  }
  const name = state.apFlowCreateName.trim();
  if (!name) {
    state.apFlowCreateError = "Flow name is required.";
    return;
  }
  state.apFlowCreateSaving = true;
  state.apFlowCreateError = null;
  try {
    const created = await invokeTool<Record<string, unknown>>(state, "flow_flow_create", {
      projectId,
      displayName: name,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flowId = (created as any)?.id;
    state.apFlowCreateName = "";
    await loadActivepiecesFlows(state);
    if (typeof flowId === "string" && flowId.trim()) {
      await loadActivepiecesFlowDetails(state, flowId);
    }
  } catch (err) {
    state.apFlowCreateError = String(err);
  } finally {
    state.apFlowCreateSaving = false;
  }
}

export async function loadActivepiecesFlowDetails(state: PmosActivepiecesState, flowId: string) {
  const id = flowId.trim();
  if (!id) {
    return;
  }
  state.apFlowSelectedId = id;
  state.apFlowDetailsLoading = true;
  state.apFlowDetailsError = null;
  state.apFlowMutateError = null;
  try {
    const details = await invokeTool<unknown>(state, "flow_flow_get", { flowId: id });
    state.apFlowDetails = details;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const displayName = (details as any)?.version?.displayName ?? (details as any)?.displayName;
    state.apFlowRenameDraft = typeof displayName === "string" ? displayName : "";
    state.apFlowOperationDraft = "";
    state.apFlowTriggerPayloadDraft = "{\n  \n}\n";
  } catch (err) {
    state.apFlowDetailsError = String(err);
    state.apFlowDetails = null;
  } finally {
    state.apFlowDetailsLoading = false;
  }
}

export async function renameActivepiecesFlow(state: PmosActivepiecesState) {
  if (!state.apFlowSelectedId) {
    return;
  }
  const name = state.apFlowRenameDraft.trim();
  if (!name) {
    state.apFlowMutateError = "Name cannot be empty.";
    return;
  }
  state.apFlowMutating = true;
  state.apFlowMutateError = null;
  try {
    await invokeTool(state, "flow_flow_operation", {
      flowId: state.apFlowSelectedId,
      operation: {
        type: "CHANGE_NAME",
        request: { displayName: name },
      },
    });
    await loadActivepiecesFlowDetails(state, state.apFlowSelectedId);
    await loadActivepiecesFlows(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function setActivepiecesFlowStatus(
  state: PmosActivepiecesState,
  status: "ENABLED" | "DISABLED",
) {
  if (!state.apFlowSelectedId) {
    return;
  }
  state.apFlowMutating = true;
  state.apFlowMutateError = null;
  try {
    await invokeTool(state, "flow_flow_operation", {
      flowId: state.apFlowSelectedId,
      operation: { type: "CHANGE_STATUS", request: { status } },
    });
    await loadActivepiecesFlowDetails(state, state.apFlowSelectedId);
    await loadActivepiecesFlows(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function publishActivepiecesFlow(state: PmosActivepiecesState) {
  if (!state.apFlowSelectedId) {
    return;
  }
  state.apFlowMutating = true;
  state.apFlowMutateError = null;
  try {
    await invokeTool(state, "flow_flow_operation", {
      flowId: state.apFlowSelectedId,
      operation: { type: "LOCK_AND_PUBLISH", request: {} },
    });
    await loadActivepiecesFlowDetails(state, state.apFlowSelectedId);
    await loadActivepiecesFlows(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function deleteActivepiecesFlow(state: PmosActivepiecesState) {
  if (!state.apFlowSelectedId) {
    return;
  }
  state.apFlowMutating = true;
  state.apFlowMutateError = null;
  try {
    await invokeTool(state, "flow_flow_delete", { flowId: state.apFlowSelectedId });
    state.apFlowSelectedId = null;
    state.apFlowDetails = null;
    await loadActivepiecesFlows(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function applyActivepiecesFlowOperationDraft(state: PmosActivepiecesState) {
  if (!state.apFlowSelectedId) {
    return;
  }
  const raw = state.apFlowOperationDraft.trim();
  if (!raw) {
    state.apFlowMutateError = "Operation JSON is empty.";
    return;
  }
  state.apFlowMutating = true;
  state.apFlowMutateError = null;
  try {
    const operation = JSON.parse(raw) as Record<string, unknown>;
    await invokeTool(state, "flow_flow_operation", { flowId: state.apFlowSelectedId, operation });
    await loadActivepiecesFlowDetails(state, state.apFlowSelectedId);
    await loadActivepiecesFlows(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function triggerActivepiecesFlowWebhook(state: PmosActivepiecesState, opts?: { draft?: boolean; sync?: boolean }) {
  if (!state.apFlowSelectedId) {
    return;
  }
  state.apFlowMutating = true;
  state.apFlowMutateError = null;
  try {
    const payloadRaw = state.apFlowTriggerPayloadDraft?.trim() || "{}";
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    await invokeTool(state, "flow_flow_trigger", {
      flowId: state.apFlowSelectedId,
      payload,
      draft: Boolean(opts?.draft),
      sync: Boolean(opts?.sync),
    });
    // runs feed will show it once refreshed; keep this lightweight.
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function loadActivepiecesRuns(state: PmosActivepiecesState, opts?: { cursor?: string | null }) {
  const projectId = resolveProjectId(state);
  if (!projectId) {
    state.apRunsError =
      "Activepieces Project ID is required. Set it in Integrations -> Activepieces -> Project ID, then Save.";
    state.apRuns = [];
    return;
  }
  state.apRunsLoading = true;
  state.apRunsError = null;
  try {
    const details = await invokeTool<unknown>(state, "flow_flow_runs_list", {
      projectId,
      limit: 25,
      cursor: opts?.cursor ?? null,
      flowId: state.apFlowSelectedId ?? undefined,
    });
    const page = coerceSeekPage<ActivepiecesRunSummary>(details);
    if (!page) {
      state.apRuns = [];
      state.apRunsCursor = null;
      state.apRunsHasNext = false;
      return;
    }
    state.apRuns = page.data ?? [];
    state.apRunsCursor = page.next;
    state.apRunsHasNext = Boolean(page.next);
  } catch (err) {
    state.apRunsError = String(err);
    state.apRuns = [];
    state.apRunsCursor = null;
    state.apRunsHasNext = false;
  } finally {
    state.apRunsLoading = false;
  }
}

export async function loadActivepiecesRunDetails(state: PmosActivepiecesState, runId: string) {
  const id = runId.trim();
  if (!id) {
    return;
  }
  state.apRunSelectedId = id;
  state.apRunDetailsLoading = true;
  state.apRunDetailsError = null;
  state.apRunRetryError = null;
  try {
    const details = await invokeTool<unknown>(state, "flow_flow_run_get", { runId: id });
    state.apRunDetails = details;
  } catch (err) {
    state.apRunDetailsError = String(err);
    state.apRunDetails = null;
  } finally {
    state.apRunDetailsLoading = false;
  }
}

export async function retryActivepiecesRun(
  state: PmosActivepiecesState,
  strategy: "FROM_FAILED_STEP" | "ON_LATEST_VERSION",
) {
  const projectId = resolveProjectId(state);
  if (!state.apRunSelectedId || !projectId) {
    return;
  }
  state.apRunRetrying = true;
  state.apRunRetryError = null;
  try {
    await invokeTool(state, "flow_flow_run_retry", {
      runId: state.apRunSelectedId,
      projectId,
      strategy,
    });
    await loadActivepiecesRunDetails(state, state.apRunSelectedId);
    await loadActivepiecesRuns(state);
  } catch (err) {
    state.apRunRetryError = String(err);
  } finally {
    state.apRunRetrying = false;
  }
}
