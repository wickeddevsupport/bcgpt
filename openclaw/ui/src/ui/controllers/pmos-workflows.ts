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

export type WorkflowPieceSummary = {
  name?: string;
  displayName?: string;
  description?: string;
  logoUrl?: string;
  version?: string;
};

export type WorkflowSummary = {
  id: string;
  displayName?: string;
  status?: string;
  updated?: string;
  created?: string;
};

export type WorkflowRunSummary = {
  id: string;
  flowId?: string;
  projectId?: string;
  status?: string;
  created?: string;
};

export type WorkflowConnectionSummary = {
  id: string;
  displayName?: string;
  pieceName?: string;
  type?: string;
  status?: string;
  created?: string;
};

export type PmosWorkflowsState = {
  settings: UiSettings;
  basePath: string;
  connected: boolean;
  sessionKey: string;

  // Kept for compatibility with older saved UI state.
  pmosOpsProjectId: string;

  // Pieces
  apPiecesLoading: boolean;
  apPiecesError: string | null;
  apPiecesQuery: string;
  apPieces: WorkflowPieceSummary[];
  apPieceSelectedName: string | null;
  apPieceDetailsLoading: boolean;
  apPieceDetailsError: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apPieceDetails: any | null;

  // Connections
  apConnectionsLoading: boolean;
  apConnectionsError: string | null;
  apConnections: WorkflowConnectionSummary[];
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
  apFlows: WorkflowSummary[];
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
  apRuns: WorkflowRunSummary[];
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
  state: Pick<PmosWorkflowsState, "settings" | "basePath" | "sessionKey">,
  tool: string,
  args: Record<string, unknown>,
): Promise<T> {
  const token = state.settings.token?.trim() ?? "";
  if (!token) {
    throw new Error("Wicked OS access key missing. Go to Dashboard -> System -> paste key -> Connect.");
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

function normalizeWorkflowSummary(entry: Record<string, unknown>): WorkflowSummary | null {
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

function normalizeExecutionSummary(entry: Record<string, unknown>): WorkflowRunSummary | null {
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

function normalizeCredentialSummary(entry: Record<string, unknown>): WorkflowConnectionSummary | null {
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

export async function loadWorkflowPieces(state: PmosWorkflowsState) {
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

export async function loadWorkflowPieceDetails(state: PmosWorkflowsState, pieceName: string) {
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

export async function loadWorkflowConnections(state: PmosWorkflowsState) {
  state.apConnectionsLoading = true;
  state.apConnectionsError = null;
  try {
    const details = await invokeTool<unknown>(state, "ops_credentials_list", {});
    const items = toItems(details, ["data", "credentials"]);
    state.apConnections = items
      .map((entry) => normalizeCredentialSummary(entry))
      .filter((entry): entry is WorkflowConnectionSummary => Boolean(entry));
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

export async function createWorkflowConnection(state: PmosWorkflowsState) {
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

export async function deleteWorkflowConnection(
  state: PmosWorkflowsState,
  _connectionId: string,
) {
  state.apConnectionsError = "Delete credential is managed inside the embedded n8n editor.";
}

export async function loadWorkflows(state: PmosWorkflowsState) {
  state.apFlowsLoading = true;
  state.apFlowsError = null;
  try {
    const details = await invokeTool<unknown>(state, "ops_workflows_list", {});
    const items = toItems(details, ["data", "workflows"]);
    const normalized = items
      .map((entry) => normalizeWorkflowSummary(entry))
      .filter((entry): entry is WorkflowSummary => Boolean(entry));

    const toTs = (value?: string) => {
      if (!value) return 0;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    normalized.sort((a, b) => toTs(b.updated ?? b.created) - toTs(a.updated ?? a.created));

    // Keep the raw list in state and apply local filtering in the view for instant search.
    state.apFlows = normalized;
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

export async function createWorkflow(state: PmosWorkflowsState) {
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
    await loadWorkflows(state);
    if (flowId) {
      await loadWorkflowDetails(state, flowId);
    }
  } catch (err) {
    state.apFlowCreateError = String(err);
  } finally {
    state.apFlowCreateSaving = false;
  }
}

export async function loadWorkflowDetails(state: PmosWorkflowsState, flowId: string) {
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

export async function renameWorkflow(state: PmosWorkflowsState) {
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
    await loadWorkflowDetails(state, state.apFlowSelectedId);
    await loadWorkflows(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function setWorkflowStatus(
  state: PmosWorkflowsState,
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
    await loadWorkflowDetails(state, state.apFlowSelectedId);
    await loadWorkflows(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function publishWorkflow(state: PmosWorkflowsState) {
  if (!state.apFlowSelectedId) {
    return;
  }
  state.apFlowMutating = true;
  state.apFlowMutateError = null;
  try {
    // n8n applies updates directly; no publish/lock step is required.
    await loadWorkflowDetails(state, state.apFlowSelectedId);
    await loadWorkflows(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function deleteWorkflow(state: PmosWorkflowsState) {
  if (!state.apFlowSelectedId) {
    return;
  }
  state.apFlowMutating = true;
  state.apFlowMutateError = null;
  try {
    await invokeTool(state, "ops_workflow_delete", { workflowId: state.apFlowSelectedId });
    state.apFlowSelectedId = null;
    state.apFlowDetails = null;
    await loadWorkflows(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function applyWorkflowOperationDraft(state: PmosWorkflowsState) {
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
    await loadWorkflowDetails(state, state.apFlowSelectedId);
    await loadWorkflows(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function triggerWorkflowWebhook(
  state: PmosWorkflowsState,
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
    await loadWorkflowRuns(state);
  } catch (err) {
    state.apFlowMutateError = String(err);
  } finally {
    state.apFlowMutating = false;
  }
}

export async function loadWorkflowRuns(state: PmosWorkflowsState) {
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
      .filter((entry): entry is WorkflowRunSummary => Boolean(entry));
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

export async function loadWorkflowRunDetails(state: PmosWorkflowsState, runId: string) {
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

export async function retryWorkflowRun(
  state: PmosWorkflowsState,
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
    await loadWorkflowRunDetails(state, state.apRunSelectedId);
    await loadWorkflowRuns(state);
  } catch (err) {
    state.apRunRetryError = String(err);
  } finally {
    state.apRunRetrying = false;
  }
}
