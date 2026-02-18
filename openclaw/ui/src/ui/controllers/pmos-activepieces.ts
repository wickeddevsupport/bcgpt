import type { UiSettings } from "../storage.ts";

type ToolInvokeOk = {
  ok: true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
};

type ToolInvokeErr = {
  ok: false;
  error?: { type?: string; message?: string };
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

  // Kept for compatibility with older saved UI state.
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
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Prefer bearer token when present (remote gateway/operator mode), otherwise rely on PMOS session cookie.
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const res = await fetch(resolveToolsInvokeUrl(state), {
    method: "POST",
    credentials: "include",
    headers,
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

  const details = (data.result as { details?: unknown } | null)?.details;
  return (details ?? data.result) as T;
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function unwrapData(value: unknown): unknown {
  const obj = toObject(value);
  if (!obj) {
    return value;
  }
  if ("data" in obj) {
    return obj.data;
  }
  return value;
}

function toItems(value: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => Boolean(toObject(entry)));
  }
  const obj = toObject(value);
  if (!obj) {
    return [];
  }
  for (const key of keys) {
    const bucket = obj[key];
    if (Array.isArray(bucket)) {
      return bucket.filter((entry): entry is Record<string, unknown> => Boolean(toObject(entry)));
    }
  }
  if (obj.data) {
    return toItems(obj.data, keys);
  }
  return [];
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readId(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function normalizeWorkflowSummary(entry: Record<string, unknown>): ActivepiecesFlowSummary | null {
  const id =
    readId(entry.id) ??
    readId(entry.workflowId) ??
    readId(entry.uuid);
  if (!id) {
    return null;
  }
  const displayName = readString(entry.name) ?? readString(entry.displayName);
  const active = typeof entry.active === "boolean" ? entry.active : null;
  const status =
    readString(entry.status) ??
    (active === null ? undefined : active ? "ENABLED" : "DISABLED");
  return {
    id,
    displayName,
    status,
    updated: readString(entry.updatedAt) ?? readString(entry.updated),
    created: readString(entry.createdAt) ?? readString(entry.created),
  };
}

function normalizeExecutionSummary(entry: Record<string, unknown>): ActivepiecesRunSummary | null {
  const id = readId(entry.id) ?? readId(entry.executionId);
  if (!id) {
    return null;
  }
  const status =
    readString(entry.status) ??
    (typeof entry.finished === "boolean" ? (entry.finished ? "SUCCESS" : "RUNNING") : undefined);
  return {
    id,
    flowId: readId(entry.workflowId) ?? readId(entry.flowId),
    status,
    created: readString(entry.startedAt) ?? readString(entry.createdAt) ?? readString(entry.created),
  };
}

function normalizeCredentialSummary(entry: Record<string, unknown>): ActivepiecesConnectionSummary | null {
  const id = readId(entry.id);
  if (!id) {
    return null;
  }
  return {
    id,
    displayName: readString(entry.name) ?? readString(entry.displayName),
    pieceName: readString(entry.type),
    type: readString(entry.type),
    status: "configured",
    created: readString(entry.createdAt),
  };
}

function normalizeFlowDetails(value: unknown): unknown {
  const obj = toObject(unwrapData(value));
  if (!obj) {
    return value;
  }
  const active = typeof obj.active === "boolean" ? obj.active : null;
  const status =
    readString(obj.status) ??
    (active === null ? undefined : active ? "ENABLED" : "DISABLED");
  if (!status) {
    return obj;
  }
  return { ...obj, status };
}

export async function loadActivepiecesPieces(state: PmosActivepiecesState) {
  state.apPiecesLoading = true;
  state.apPiecesError = null;
  try {
    // n8n does not expose a "pieces" catalog endpoint in the same shape.
    state.apPieces = [];
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
  state.apPieceDetails = null;
  state.apPieceDetailsLoading = false;
}

export async function loadActivepiecesConnections(state: PmosActivepiecesState) {
  state.apConnectionsLoading = true;
  state.apConnectionsError = null;
  try {
    const details = await invokeTool<unknown>(state, "ops_credentials_list", {});
    const items = toItems(details, ["data", "credentials"]);
    state.apConnections = items
      .map((entry) => normalizeCredentialSummary(entry))
      .filter((entry): entry is ActivepiecesConnectionSummary => Boolean(entry));
    state.apConnectionsCursor = null;
    state.apConnectionsHasNext = false;
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
  state.apConnectionCreateSaving = true;
  state.apConnectionCreateError = null;
  try {
    throw new Error("Create credential is managed inside the embedded n8n editor.");
  } catch (err) {
    state.apConnectionCreateError = String(err);
  } finally {
    state.apConnectionCreateSaving = false;
  }
}

export async function deleteActivepiecesConnection(
  state: PmosActivepiecesState,
  _connectionId: string,
) {
  state.apConnectionsError = "Delete credential is managed inside the embedded n8n editor.";
}

export async function loadActivepiecesFlows(state: PmosActivepiecesState) {
  state.apFlowsLoading = true;
  state.apFlowsError = null;
  try {
    const details = await invokeTool<unknown>(state, "ops_workflows_list", {});
    const items = toItems(details, ["data", "workflows"]);
    const normalized = items
      .map((entry) => normalizeWorkflowSummary(entry))
      .filter((entry): entry is ActivepiecesFlowSummary => Boolean(entry));
    const query = state.apFlowsQuery.trim().toLowerCase();
    state.apFlows = query
      ? normalized.filter((flow) => {
          const haystack = `${flow.displayName ?? ""} ${flow.id}`.toLowerCase();
          return haystack.includes(query);
        })
      : normalized;
    state.apFlowsCursor = null;
    state.apFlowsHasNext = false;
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
  const name = state.apFlowCreateName.trim();
  if (!name) {
    state.apFlowCreateError = "Workflow name is required.";
    return;
  }
  state.apFlowCreateSaving = true;
  state.apFlowCreateError = null;
  try {
    const created = await invokeTool<unknown>(state, "ops_workflow_create", { name });
    const details = toObject(unwrapData(created)) ?? {};
    const flowId = readId(details.id);
    state.apFlowCreateName = "";
    await loadActivepiecesFlows(state);
    if (flowId) {
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
    const details = await invokeTool<unknown>(state, "ops_workflow_get", { workflowId: id });
    const normalized = normalizeFlowDetails(details);
    state.apFlowDetails = normalized;
    const obj = toObject(unwrapData(normalized));
    const displayName = readString(obj?.name) ?? readString(obj?.displayName);
    state.apFlowRenameDraft = displayName ?? "";
    state.apFlowOperationDraft = "";
    state.apFlowTriggerPayloadDraft = "{\n}\n";
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
    await invokeTool(state, "ops_workflow_update", {
      workflowId: state.apFlowSelectedId,
      name,
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
    if (status === "ENABLED") {
      await invokeTool(state, "ops_workflow_activate", { workflowId: state.apFlowSelectedId });
    } else {
      await invokeTool(state, "ops_workflow_deactivate", { workflowId: state.apFlowSelectedId });
    }
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
    // n8n applies updates directly; no publish/lock step is required.
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
    await invokeTool(state, "ops_workflow_delete", { workflowId: state.apFlowSelectedId });
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
    const patch = JSON.parse(raw) as Record<string, unknown>;
    await invokeTool(state, "ops_workflow_update", {
      workflowId: state.apFlowSelectedId,
      ...patch,
    });
    await loadActivepiecesFlowDetails(state, state.apFlowSelectedId);
    await loadActivepiecesFlows(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function triggerActivepiecesFlowWebhook(
  state: PmosActivepiecesState,
  opts?: { draft?: boolean; sync?: boolean },
) {
  if (!state.apFlowSelectedId) {
    return;
  }
  state.apFlowMutating = true;
  state.apFlowMutateError = null;
  try {
    const payloadRaw = state.apFlowTriggerPayloadDraft?.trim() || "{}";
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    await invokeTool(state, "ops_workflow_execute", {
      workflowId: state.apFlowSelectedId,
      data: {
        ...payload,
        __draft: Boolean(opts?.draft),
        __sync: Boolean(opts?.sync),
      },
    });
    await loadActivepiecesRuns(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function loadActivepiecesRuns(state: PmosActivepiecesState) {
  state.apRunsLoading = true;
  state.apRunsError = null;
  try {
    const details = await invokeTool<unknown>(state, "ops_executions_list", {
      workflowId: state.apFlowSelectedId ?? undefined,
      limit: 25,
    });
    const items = toItems(details, ["data", "executions"]);
    state.apRuns = items
      .map((entry) => normalizeExecutionSummary(entry))
      .filter((entry): entry is ActivepiecesRunSummary => Boolean(entry));
    state.apRunsCursor = null;
    state.apRunsHasNext = false;
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
    const details = await invokeTool<unknown>(state, "ops_execution_get", { executionId: id });
    state.apRunDetails = unwrapData(details);
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
  if (!state.apRunSelectedId) {
    return;
  }
  state.apRunRetrying = true;
  state.apRunRetryError = null;
  try {
    const currentDetails =
      state.apRunDetails ??
      (await invokeTool<unknown>(state, "ops_execution_get", {
        executionId: state.apRunSelectedId,
      }));
    const detailObj = toObject(unwrapData(currentDetails));
    const workflowId =
      readId(detailObj?.workflowId) ??
      readId(toObject(detailObj?.workflowData)?.id);
    if (!workflowId) {
      throw new Error("Cannot retry execution: workflowId missing from execution details.");
    }
    await invokeTool(state, "ops_workflow_execute", {
      workflowId,
      data: {
        __retryExecutionId: state.apRunSelectedId,
        __retryStrategy: strategy,
      },
    });
    await loadActivepiecesRunDetails(state, state.apRunSelectedId);
    await loadActivepiecesRuns(state);
  } catch (err) {
    state.apRunRetryError = String(err);
  } finally {
    state.apRunRetrying = false;
  }
}
