/**
 * Workflow Engine API Client (Activepieces compatibility layer)
 *
 * This module keeps the historical `n8n-api-client` exports stable so existing
 * PMOS server-method handlers and chat tools continue to work while the
 * underlying runtime is Activepieces.
 */

import { loadConfig } from "../config/config.js";
import { readWorkspaceConnectors } from "./workspace-connectors.js";

const DEFAULT_BASE_URL = "https://flow.wickedlab.io";
const ACTIVEPIECES_BASECAMP_PIECE_NAME = "@activepieces/piece-basecamp";
const ACTIVEPIECES_BASECAMP_EXTERNAL_ID = "openclaw-basecamp";
const ACTIVEPIECES_BASECAMP_DEFAULT_URL = "https://bcgpt.wickedlab.io";

type JsonObject = Record<string, unknown>;

type ActivepiecesContext = {
  baseUrl: string;
  apiKey: string | null;
  projectId: string | null;
  userEmail: string | null;
  userPassword: string | null;
  hasWorkspaceCredentials: boolean;
};

type CachedUserToken = {
  token: string;
  projectId: string | null;
  expiresAt: number;
};

const userTokenCache = new Map<string, CachedUserToken>();

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    typeVersion: number;
    position: [number, number];
    parameters?: Record<string, unknown>;
  }>;
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  staticData?: unknown;
  tags?: Array<string | { id: string; name?: string }>;
  triggerCount?: number;
  updatedAt?: string;
  versionId?: string;
}

export interface N8nExecution {
  id: string;
  finished: boolean;
  mode: string;
  retryOf?: string;
  retrySuccessId?: string;
  startedAt: string;
  stoppedAt?: string;
  workflowId: string;
  workflowName?: string;
  status: "running" | "success" | "failed" | "canceled" | "crashed" | "waiting";
  data?: {
    resultData?: {
      runData?: Record<string, unknown>;
      lastNodeExecuted?: string;
      error?: unknown;
    };
  };
}

export interface N8nTag {
  id: string;
  name: string;
}

export interface N8nNodeType {
  name: string;
  displayName?: string;
  description?: string;
}

function readConfigString(cfg: unknown, path: string[]): string | null {
  let current: unknown = cfg;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== "string") {
    return null;
  }
  const trimmed = current.trim();
  return trimmed ? trimmed : null;
}

function normalizeBaseUrl(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim();
  if (!value) {
    return DEFAULT_BASE_URL;
  }
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isLikelyLegacyN8nUrl(raw: string | null | undefined): boolean {
  const normalized = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return false;
  }
  const lower = normalized.toLowerCase();
  if (lower.includes("://ops.wickedlab.io")) {
    return true;
  }
  if (lower.includes("n8n")) {
    return true;
  }
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (host === "ops.wickedlab.io") {
      return true;
    }
    if ((host === "127.0.0.1" || host === "localhost") && parsed.port === "5678") {
      return true;
    }
    const pathLower = parsed.pathname.toLowerCase();
    if (pathLower.includes("/rest") || pathLower.includes("/webhook")) {
      return true;
    }
  } catch {
    // best effort
  }
  return false;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function readId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function toArrayObjects(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is JsonObject => Boolean(toObject(entry)));
}

function isBasecampPieceName(pieceName: string | null | undefined): boolean {
  const lowered = String(pieceName ?? "").trim().toLowerCase();
  if (!lowered) {
    return false;
  }
  return (
    lowered === "basecamp" ||
    lowered === "basecampapi" ||
    lowered === ACTIVEPIECES_BASECAMP_PIECE_NAME.toLowerCase() ||
    lowered.endsWith("/piece-basecamp") ||
    lowered.includes("piece-basecamp")
  );
}

function normalizeConnectionTypeForCompat(pieceName: string | null | undefined): string {
  if (isBasecampPieceName(pieceName)) {
    return "basecampApi";
  }
  return String(pieceName ?? "").trim() || "connection";
}

function mapRunStatus(statusRaw: string | null): N8nExecution["status"] {
  const status = String(statusRaw ?? "").toLowerCase();
  if (status.includes("success")) return "success";
  if (status.includes("fail") || status.includes("error")) return "failed";
  if (status.includes("cancel")) return "canceled";
  if (status.includes("crash")) return "crashed";
  if (status.includes("wait")) return "waiting";
  return "running";
}

function getCompatMetadata(flow: JsonObject): JsonObject {
  const metadata = toObject(flow.metadata);
  const compat = toObject(metadata?.n8nCompat);
  return compat ?? {};
}

function toWorkflow(entry: JsonObject): N8nWorkflow {
  const compat = getCompatMetadata(entry);
  const nodes = Array.isArray(compat.nodes) ? compat.nodes : [];
  const mappedNodes: N8nWorkflow["nodes"] = nodes
    .map((node, index) => {
      const obj = toObject(node);
      const fallbackId = `node-${index + 1}`;
      const id = readId(obj?.id) ?? fallbackId;
      const name = readString(obj?.name) ?? id;
      const type = readString(obj?.type) ?? "activepieces.step";
      const typeVersionRaw = obj?.typeVersion;
      const typeVersion =
        typeof typeVersionRaw === "number" && Number.isFinite(typeVersionRaw)
          ? typeVersionRaw
          : 1;
      const positionRaw = Array.isArray(obj?.position) ? obj?.position : null;
      const position: [number, number] =
        positionRaw && positionRaw.length >= 2
          ? [Number(positionRaw[0]) || 0, Number(positionRaw[1]) || 0]
          : [250 + index * 220, 300];
      return {
        id,
        name,
        type,
        typeVersion,
        position,
        parameters: toObject(obj?.parameters) ?? {},
      };
    })
    .filter(Boolean);

  const status = readString(entry.status) ?? "DISABLED";
  return {
    id: readId(entry.id) ?? "",
    name:
      readString(entry.displayName) ??
      readString(entry.name) ??
      readId(entry.id) ??
      "Untitled Workflow",
    active: status.toUpperCase() === "ENABLED",
    nodes: mappedNodes,
    connections: toObject(compat.connections) ?? {},
    settings: toObject(compat.settings) ?? {},
    tags: Array.isArray(compat.tags)
      ? compat.tags.map((tag) => {
          const tagId = readId(tag);
          if (tagId) return tagId;
          const tagObj = toObject(tag);
          return readString(tagObj?.name) ?? String(tag);
        })
      : [],
    triggerCount: typeof entry.scheduleCount === "number" ? entry.scheduleCount : undefined,
    updatedAt: readString(entry.updated) ?? readString(entry.updatedAt) ?? undefined,
    versionId: readId(toObject(entry.version)?.id) ?? undefined,
  };
}

function toExecution(entry: JsonObject): N8nExecution {
  const workflowId =
    readId(entry.flowId) ??
    readId(toObject(entry.flowVersion)?.flowId) ??
    readId(toObject(entry.flowVersion)?.id) ??
    "";
  const status = mapRunStatus(readString(entry.status));
  return {
    id: readId(entry.id) ?? "",
    finished: status !== "running" && status !== "waiting",
    mode: readString(entry.environment) ?? "manual",
    startedAt: readString(entry.startTime) ?? readString(entry.created) ?? new Date().toISOString(),
    stoppedAt: readString(entry.finishTime) ?? readString(entry.updatedAt) ?? undefined,
    workflowId,
    workflowName: readString(toObject(entry.flowVersion)?.displayName) ?? undefined,
    status,
    data: {
      resultData: {
        runData: toObject(entry.steps) ?? {},
        error: toObject(entry.error) ?? undefined,
      },
    },
  };
}

async function requestJson(params: {
  ctx: ActivepiecesContext;
  workspaceId: string;
  endpoint: string;
  method?: string;
  body?: unknown;
}): Promise<unknown> {
  const { ctx, workspaceId } = params;
  const method = (params.method ?? "GET").toUpperCase();
  const endpoint = params.endpoint.replace(/^\/+/, "");
  const url = `${ctx.baseUrl}/api/v1/${endpoint}`;

  const authHeader = await getAuthorizationHeader(workspaceId, ctx);
  if (!authHeader) {
    throw new Error("No workflow-engine authentication configured for this workspace.");
  }

  const headers: Record<string, string> = {
    authorization: authHeader,
    accept: "application/json",
  };
  if (params.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
  });

  const text = await res.text().catch(() => "");
  const parsed = (() => {
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  })();

  if (!res.ok) {
    const detail = typeof parsed === "string" ? parsed : text;
    throw new Error(`Workflow engine API ${res.status} ${res.statusText}: ${detail}`.trim());
  }

  return parsed ?? { ok: true };
}

async function signInWithWorkspaceUser(
  workspaceId: string,
  ctx: ActivepiecesContext,
): Promise<CachedUserToken | null> {
  if (!ctx.userEmail || !ctx.userPassword) {
    return null;
  }

  const cached = userTokenCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached;
  }

  const endpoint = `${ctx.baseUrl}/api/v1/authentication/sign-in`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      email: ctx.userEmail,
      password: ctx.userPassword,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Workflow engine sign-in failed (${res.status}): ${text}`.trim());
  }

  const payload = (await res.json().catch(() => null)) as JsonObject | null;
  const token = readString(payload?.token);
  if (!token) {
    return null;
  }

  const next: CachedUserToken = {
    token,
    projectId: readId(payload?.projectId),
    // JWT expiry isn't decoded here; use a short cache window and re-auth often.
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  userTokenCache.set(workspaceId, next);
  return next;
}

async function getAuthorizationHeader(
  workspaceId: string,
  ctx: ActivepiecesContext,
): Promise<string | null> {
  let userSignInError: unknown = null;
  if (ctx.userEmail && ctx.userPassword) {
    try {
      const userToken = await signInWithWorkspaceUser(workspaceId, ctx);
      if (userToken?.token) {
        return `Bearer ${userToken.token}`;
      }
    } catch (err) {
      userSignInError = err;
    }
  }
  if (ctx.apiKey) {
    return `Bearer ${ctx.apiKey}`;
  }
  if (userSignInError) {
    throw userSignInError;
  }
  return null;
}

async function getContext(workspaceId: string): Promise<ActivepiecesContext> {
  const wc = await readWorkspaceConnectors(workspaceId).catch(() => null);
  const cfg = loadConfig() as unknown;
  const workspaceOps = toObject(wc?.ops);
  const workspaceActivepieces = toObject(wc?.activepieces);
  const workspaceOpsUrlRaw = readString(workspaceOps?.url) ?? null;
  const workspaceOpsLooksLegacy = isLikelyLegacyN8nUrl(workspaceOpsUrlRaw);

  const baseUrl = normalizeBaseUrl(
    readString(workspaceActivepieces?.url) ??
      (workspaceOpsLooksLegacy ? null : workspaceOpsUrlRaw) ??
      readConfigString(cfg, ["pmos", "connectors", "activepieces", "url"]) ??
      process.env.ACTIVEPIECES_URL ??
      process.env.FLOW_URL ??
      readConfigString(cfg, ["pmos", "connectors", "ops", "url"]) ??
      process.env.OPS_URL ??
      DEFAULT_BASE_URL,
  );

  const apiKey =
    readString(workspaceActivepieces?.apiKey) ??
    (workspaceOpsLooksLegacy ? null : readString(workspaceOps?.apiKey)) ??
    readConfigString(cfg, ["pmos", "connectors", "activepieces", "apiKey"]) ??
    readString(process.env.ACTIVEPIECES_API_KEY) ??
    readConfigString(cfg, ["pmos", "connectors", "ops", "apiKey"]) ??
    readString(process.env.OPS_API_KEY);

  const projectId =
    readString(workspaceActivepieces?.projectId) ??
    (workspaceOpsLooksLegacy ? null : readString(workspaceOps?.projectId)) ??
    readConfigString(cfg, ["pmos", "connectors", "activepieces", "projectId"]) ??
    readString(process.env.ACTIVEPIECES_PROJECT_ID) ??
    readConfigString(cfg, ["pmos", "connectors", "ops", "projectId"]) ??
    readString(process.env.OPS_PROJECT_ID);

  const opsUser = toObject(workspaceOps?.user);
  const activepiecesUser = toObject(workspaceActivepieces?.user);
  const userEmail =
    readString(activepiecesUser?.email) ??
    readString(opsUser?.email) ??
    null;
  const userPassword =
    readString(activepiecesUser?.password) ??
    readString(opsUser?.password) ??
    null;

  return {
    baseUrl,
    apiKey,
    projectId,
    userEmail,
    userPassword,
    hasWorkspaceCredentials: Boolean(apiKey || (userEmail && userPassword)),
  };
}

async function resolveProjectId(
  workspaceId: string,
  ctx: ActivepiecesContext,
): Promise<string> {
  if (ctx.projectId) {
    return ctx.projectId;
  }

  const tokenCache = userTokenCache.get(workspaceId);
  if (tokenCache?.projectId) {
    ctx.projectId = tokenCache.projectId;
    return tokenCache.projectId;
  }

  const projects = await requestJson({
    workspaceId,
    ctx,
    endpoint: "projects",
  });
  const obj = toObject(projects);
  const rows = toArrayObjects(obj?.data ?? projects);
  const first = rows[0];
  const projectId = readId(first?.id);
  if (!projectId) {
    throw new Error("No workflow project found. Configure ops.projectId in workspace connectors.");
  }
  ctx.projectId = projectId;
  return projectId;
}

async function updateFlowMetadata(params: {
  workspaceId: string;
  ctx: ActivepiecesContext;
  workflowId: string;
  metadataPatch: JsonObject;
}): Promise<void> {
  const flowRaw = await requestJson({
    workspaceId: params.workspaceId,
    ctx: params.ctx,
    endpoint: `flows/${encodeURIComponent(params.workflowId)}`,
  });
  const flow = toObject(flowRaw) ?? {};
  const currentMetadata = toObject(flow.metadata) ?? {};
  const merged = { ...currentMetadata, ...params.metadataPatch };

  await requestJson({
    workspaceId: params.workspaceId,
    ctx: params.ctx,
    endpoint: `flows/${encodeURIComponent(params.workflowId)}`,
    method: "POST",
    body: {
      type: "UPDATE_METADATA",
      request: { metadata: merged },
    },
  });
}

async function changeFlowStatus(params: {
  workspaceId: string;
  ctx: ActivepiecesContext;
  workflowId: string;
  active: boolean;
}): Promise<void> {
  await requestJson({
    workspaceId: params.workspaceId,
    ctx: params.ctx,
    endpoint: `flows/${encodeURIComponent(params.workflowId)}`,
    method: "POST",
    body: {
      type: "CHANGE_STATUS",
      request: { status: params.active ? "ENABLED" : "DISABLED" },
    },
  });
}

/**
 * Create a workflow in the workflow engine
 */
export async function createN8nWorkflow(
  workspaceId: string,
  workflow: Omit<N8nWorkflow, "id">,
): Promise<{ ok: boolean; workflow?: N8nWorkflow; error?: string }> {
  try {
    const ctx = await getContext(workspaceId);
    if (!ctx.hasWorkspaceCredentials) {
      return {
        ok: false,
        error:
          "No workflow-engine credentials configured for your workspace. Configure Activepieces URL/key in Integrations first.",
      };
    }

    const projectId = await resolveProjectId(workspaceId, ctx);
    const createdRaw = await requestJson({
      workspaceId,
      ctx,
      endpoint: "flows",
      method: "POST",
      body: {
        displayName: workflow.name,
        projectId,
      },
    });

    const created = toObject(createdRaw) ?? {};
    const workflowId = readId(created.id);
    if (!workflowId) {
      return { ok: false, error: "Workflow engine did not return flow id." };
    }

    await updateFlowMetadata({
      workspaceId,
      ctx,
      workflowId,
      metadataPatch: {
        n8nCompat: {
          nodes: workflow.nodes,
          connections: workflow.connections,
          settings: workflow.settings ?? {},
          tags: workflow.tags ?? [],
        },
      },
    });

    if (workflow.active) {
      await changeFlowStatus({ workspaceId, ctx, workflowId, active: true });
    }

    const fullRaw = await requestJson({
      workspaceId,
      ctx,
      endpoint: `flows/${encodeURIComponent(workflowId)}`,
    });

    return { ok: true, workflow: toWorkflow(toObject(fullRaw) ?? {}) };
  } catch (err) {
    return { ok: false, error: `Failed to create workflow: ${String(err)}` };
  }
}

/**
 * Update a workflow in the workflow engine
 */
export async function updateN8nWorkflow(
  workspaceId: string,
  workflowId: string,
  updates: Partial<N8nWorkflow>,
): Promise<{ ok: boolean; workflow?: N8nWorkflow; error?: string }> {
  try {
    const ctx = await getContext(workspaceId);
    if (!ctx.hasWorkspaceCredentials) {
      return {
        ok: false,
        error:
          "No workflow-engine credentials configured for your workspace. Configure Activepieces URL/key in Integrations first.",
      };
    }

    if (typeof updates.name === "string" && updates.name.trim()) {
      await requestJson({
        workspaceId,
        ctx,
        endpoint: `flows/${encodeURIComponent(workflowId)}`,
        method: "POST",
        body: {
          type: "CHANGE_NAME",
          request: { displayName: updates.name.trim() },
        },
      });
    }

    if (typeof updates.active === "boolean") {
      await changeFlowStatus({
        workspaceId,
        ctx,
        workflowId,
        active: updates.active,
      });
    }

    if (Array.isArray(updates.nodes) || toObject(updates.connections) || toObject(updates.settings)) {
      await updateFlowMetadata({
        workspaceId,
        ctx,
        workflowId,
        metadataPatch: {
          n8nCompat: {
            nodes: Array.isArray(updates.nodes) ? updates.nodes : [],
            connections: toObject(updates.connections) ?? {},
            settings: toObject(updates.settings) ?? {},
            tags: Array.isArray(updates.tags) ? updates.tags : [],
          },
        },
      });
    }

    const raw = await requestJson({
      workspaceId,
      ctx,
      endpoint: `flows/${encodeURIComponent(workflowId)}`,
    });

    return { ok: true, workflow: toWorkflow(toObject(raw) ?? {}) };
  } catch (err) {
    return { ok: false, error: `Failed to update workflow: ${String(err)}` };
  }
}

/**
 * Get a workflow
 */
export async function getN8nWorkflow(
  workspaceId: string,
  workflowId: string,
): Promise<{ ok: boolean; workflow?: N8nWorkflow; error?: string }> {
  try {
    const ctx = await getContext(workspaceId);
    if (!ctx.hasWorkspaceCredentials) {
      return {
        ok: false,
        error:
          "No workflow-engine credentials configured for your workspace. Configure Activepieces URL/key in Integrations first.",
      };
    }

    const raw = await requestJson({
      workspaceId,
      ctx,
      endpoint: `flows/${encodeURIComponent(workflowId)}`,
    });

    return { ok: true, workflow: toWorkflow(toObject(raw) ?? {}) };
  } catch (err) {
    return { ok: false, error: `Failed to get workflow: ${String(err)}` };
  }
}

/**
 * Delete a workflow
 */
export async function deleteN8nWorkflow(
  workspaceId: string,
  workflowId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await getContext(workspaceId);
    if (!ctx.hasWorkspaceCredentials) {
      return {
        ok: false,
        error:
          "No workflow-engine credentials configured for your workspace. Configure Activepieces URL/key in Integrations first.",
      };
    }

    await requestJson({
      workspaceId,
      ctx,
      endpoint: `flows/${encodeURIComponent(workflowId)}`,
      method: "DELETE",
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Failed to delete workflow: ${String(err)}` };
  }
}

/**
 * Activate or deactivate a workflow
 */
export async function setWorkflowActive(
  workspaceId: string,
  workflowId: string,
  active: boolean,
): Promise<{ ok: boolean; workflow?: N8nWorkflow; error?: string }> {
  return updateN8nWorkflow(workspaceId, workflowId, { active });
}

/**
 * Execute a workflow (webhook trigger path)
 */
export async function executeN8nWorkflow(
  workspaceId: string,
  workflowId: string,
): Promise<{ ok: boolean; executionId?: string; error?: string }> {
  try {
    const ctx = await getContext(workspaceId);
    if (!ctx.hasWorkspaceCredentials) {
      return {
        ok: false,
        error:
          "No workflow-engine credentials configured for your workspace. Configure Activepieces URL/key in Integrations first.",
      };
    }

    const response = await requestJson({
      workspaceId,
      ctx,
      endpoint: `webhooks/${encodeURIComponent(workflowId)}/sync`,
      method: "POST",
      body: {},
    }).catch(async () => {
      return requestJson({
        workspaceId,
        ctx,
        endpoint: `webhooks/${encodeURIComponent(workflowId)}`,
        method: "POST",
        body: {},
      });
    });

    const runId = readId(toObject(response)?.id) ?? readId(toObject(response)?.flowRunId);
    if (runId) {
      return { ok: true, executionId: runId };
    }

    const projectId = await resolveProjectId(workspaceId, ctx);
    const latestRuns = await requestJson({
      workspaceId,
      ctx,
      endpoint: `flow-runs?projectId=${encodeURIComponent(projectId)}&flowId=${encodeURIComponent(workflowId)}&limit=1`,
    });
    const latestObj = toObject(latestRuns);
    const first = toArrayObjects(latestObj?.data)[0];
    return { ok: true, executionId: readId(first?.id) ?? undefined };
  } catch (err) {
    return { ok: false, error: `Failed to execute workflow: ${String(err)}` };
  }
}

/**
 * Get execution details
 */
export async function getN8nExecution(
  workspaceId: string,
  executionId: string,
): Promise<{ ok: boolean; execution?: N8nExecution; error?: string }> {
  try {
    const ctx = await getContext(workspaceId);
    if (!ctx.hasWorkspaceCredentials) {
      return {
        ok: false,
        error:
          "No workflow-engine credentials configured for your workspace. Configure Activepieces URL/key in Integrations first.",
      };
    }

    const raw = await requestJson({
      workspaceId,
      ctx,
      endpoint: `flow-runs/${encodeURIComponent(executionId)}`,
    });

    return { ok: true, execution: toExecution(toObject(raw) ?? {}) };
  } catch (err) {
    return { ok: false, error: `Failed to get execution: ${String(err)}` };
  }
}

/**
 * List workflows for a workspace
 */
export async function listN8nWorkflows(
  workspaceId: string,
): Promise<{ ok: boolean; workflows?: N8nWorkflow[]; error?: string }> {
  try {
    const ctx = await getContext(workspaceId);
    if (!ctx.hasWorkspaceCredentials) {
      return {
        ok: false,
        error:
          "No workflow-engine credentials configured for your workspace. Configure Activepieces URL/key in Integrations first.",
      };
    }

    const projectId = await resolveProjectId(workspaceId, ctx);
    const raw = await requestJson({
      workspaceId,
      ctx,
      endpoint: `flows?projectId=${encodeURIComponent(projectId)}&limit=200`,
    });

    const rows = toArrayObjects(toObject(raw)?.data);
    return {
      ok: true,
      workflows: rows.map((row) => toWorkflow(row)),
    };
  } catch (err) {
    return { ok: false, error: `Failed to list workflows: ${String(err)}` };
  }
}

/**
 * List available node/piece types
 */
export async function listN8nNodeTypes(
  workspaceId: string,
): Promise<{ ok: boolean; nodeTypes?: N8nNodeType[]; error?: string }> {
  try {
    const ctx = await getContext(workspaceId);
    if (!ctx.hasWorkspaceCredentials) {
      return {
        ok: false,
        error:
          "No workflow-engine credentials configured for your workspace. Configure Activepieces URL/key in Integrations first.",
      };
    }

    const projectId = await resolveProjectId(workspaceId, ctx);
    const raw = await requestJson({
      workspaceId,
      ctx,
      endpoint: `pieces?projectId=${encodeURIComponent(projectId)}&limit=200`,
    });

    const rows = toArrayObjects(toObject(raw)?.data);

    const coreCompat: N8nNodeType[] = [
      {
        name: "n8n-nodes-basecamp.basecamp",
        displayName: "Basecamp (BCgpt Custom Node)",
        description: "Basecamp automation via BCgpt compatibility layer.",
      },
      { name: "activepieces.trigger.webhook", displayName: "Webhook Trigger", description: "HTTP webhook trigger" },
      { name: "activepieces.action.http", displayName: "HTTP Request", description: "Send HTTP request" },
      { name: "activepieces.action.code", displayName: "Code", description: "Run custom code" },
    ];

    const pieceTypes: N8nNodeType[] = rows
      .map((piece) => {
        const name = readString(piece.name);
        if (!name) return null;
        const displayName = readString(piece.displayName) ?? name;
        const description = readString(piece.description) ?? readString(piece.summary) ?? undefined;
        return {
          name: `activepieces.${name}`,
          displayName,
          description,
        } as N8nNodeType;
      })
      .filter((entry): entry is N8nNodeType => Boolean(entry));

    const merged = [...coreCompat, ...pieceTypes].filter(
      (item, idx, arr) => arr.findIndex((x) => x.name === item.name) === idx,
    );

    return { ok: true, nodeTypes: merged };
  } catch (err) {
    return { ok: false, error: `Failed to list node types: ${String(err)}` };
  }
}

/**
 * Cancel a running execution
 */
export async function cancelN8nExecution(
  workspaceId: string,
  executionId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await getContext(workspaceId);
    if (!ctx.hasWorkspaceCredentials) {
      return {
        ok: false,
        error:
          "No workflow-engine credentials configured for your workspace. Configure Activepieces URL/key in Integrations first.",
      };
    }
    const projectId = await resolveProjectId(workspaceId, ctx);

    await requestJson({
      workspaceId,
      ctx,
      endpoint: "flow-runs/cancel",
      method: "POST",
      body: {
        projectId,
        flowRunIds: [executionId],
      },
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Failed to cancel execution: ${String(err)}` };
  }
}

function credentialTypeFromInput(type: string, data: Record<string, unknown>) {
  const lowered = type.trim().toLowerCase();
  if (isBasecampPieceName(type)) {
    return "CUSTOM_AUTH" as const;
  }
  if (lowered.includes("basic") || (readString(data.username) && readString(data.password))) {
    return "BASIC_AUTH" as const;
  }
  if (lowered.includes("no_auth") || lowered === "none" || lowered === "noauth") {
    return "NO_AUTH" as const;
  }
  return "SECRET_TEXT" as const;
}

function buildCredentialValue(
  connType: "SECRET_TEXT" | "BASIC_AUTH" | "NO_AUTH" | "CUSTOM_AUTH",
  pieceName: string,
  data: Record<string, unknown>,
) {
  if (connType === "CUSTOM_AUTH") {
    const apiKey =
      readString(data.api_key) ??
      readString(data.apiKey) ??
      readString(data.token) ??
      readString(data.secret_text) ??
      "";
    const rawBaseUrl = readString(data.base_url) ?? readString(data.bcgptUrl);
    const baseUrl =
      rawBaseUrl && rawBaseUrl.trim()
        ? rawBaseUrl.trim().replace(/\/+$/, "")
        : ACTIVEPIECES_BASECAMP_DEFAULT_URL;
    if (isBasecampPieceName(pieceName)) {
      return {
        type: "CUSTOM_AUTH",
        props: {
          api_key: apiKey,
          base_url: baseUrl,
        },
      };
    }
    return {
      type: "CUSTOM_AUTH",
      props: { ...data },
    };
  }
  if (connType === "BASIC_AUTH") {
    return {
      type: "BASIC_AUTH",
      username: readString(data.username) ?? "",
      password: readString(data.password) ?? "",
    };
  }
  if (connType === "NO_AUTH") {
    return { type: "NO_AUTH" };
  }

  const secretText =
    readString(data.secret_text) ??
    readString(data.apiKey) ??
    readString(data.token) ??
    readString(data.password) ??
    JSON.stringify(data);
  return {
    type: "SECRET_TEXT",
    secret_text: secretText,
  };
}

/**
 * Upsert Basecamp credential in workflow engine
 */
export async function upsertBasecampCredential(
  workspaceId: string,
  bcgptUrl: string,
  bcgptApiKey: string,
): Promise<{ ok: boolean; credentialId?: string; error?: string }> {
  return createN8nCredential(workspaceId, "Basecamp", ACTIVEPIECES_BASECAMP_PIECE_NAME, {
    base_url: bcgptUrl || ACTIVEPIECES_BASECAMP_DEFAULT_URL,
    api_key: bcgptApiKey,
  });
}

/**
 * List credentials (app connections)
 */
export async function listN8nCredentials(
  workspaceId: string,
): Promise<{ ok: boolean; credentials?: Array<{ id: string; name: string; type: string }>; error?: string }> {
  try {
    const ctx = await getContext(workspaceId);
    if (!ctx.hasWorkspaceCredentials) {
      return {
        ok: false,
        error:
          "No workflow-engine credentials configured for your workspace. Configure Activepieces URL/key in Integrations first.",
      };
    }

    const projectId = await resolveProjectId(workspaceId, ctx);
    const raw = await requestJson({
      workspaceId,
      ctx,
      endpoint: `app-connections?projectId=${encodeURIComponent(projectId)}&limit=200`,
    });

    const rows = toArrayObjects(toObject(raw)?.data);
    const credentials = rows.map((row) => ({
      id: readId(row.id) ?? "",
      name: readString(row.displayName) ?? readString(row.externalId) ?? "Unnamed Connection",
      type: normalizeConnectionTypeForCompat(
        readString(row.pieceName) ?? readString(row.type) ?? "connection",
      ),
    }));

    return { ok: true, credentials };
  } catch (err) {
    return { ok: false, error: `Failed to list credentials: ${String(err)}` };
  }
}

/**
 * Create/upsert a credential (app connection)
 */
export async function createN8nCredential(
  workspaceId: string,
  name: string,
  type: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; credentialId?: string; error?: string }> {
  try {
    const ctx = await getContext(workspaceId);
    if (!ctx.hasWorkspaceCredentials) {
      return {
        ok: false,
        error:
          "No workflow-engine credentials configured for your workspace. Configure Activepieces URL/key in Integrations first.",
      };
    }

    const projectId = await resolveProjectId(workspaceId, ctx);
    const pieceName = isBasecampPieceName(type) ? ACTIVEPIECES_BASECAMP_PIECE_NAME : type;
    const connType = credentialTypeFromInput(pieceName, data);
    const externalId = isBasecampPieceName(pieceName)
      ? ACTIVEPIECES_BASECAMP_EXTERNAL_ID
      : `openclaw-${String(pieceName || "connection").toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}-${String(name || "conn").toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;

    const payload = await requestJson({
      workspaceId,
      ctx,
      endpoint: "app-connections",
      method: "POST",
      body: {
        projectId,
        externalId,
        displayName: name,
        pieceName,
        type: connType,
        value: buildCredentialValue(connType, pieceName, data),
      },
    });

    const credentialId = readId(toObject(payload)?.id);
    return { ok: true, credentialId: credentialId ?? undefined };
  } catch (err) {
    return { ok: false, error: `Failed to create credential: ${String(err)}` };
  }
}

/**
 * Delete a credential
 */
export async function deleteN8nCredential(
  workspaceId: string,
  credentialId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await getContext(workspaceId);
    if (!ctx.hasWorkspaceCredentials) {
      return {
        ok: false,
        error:
          "No workflow-engine credentials configured for your workspace. Configure Activepieces URL/key in Integrations first.",
      };
    }

    await requestJson({
      workspaceId,
      ctx,
      endpoint: `app-connections/${encodeURIComponent(credentialId)}`,
      method: "DELETE",
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Failed to delete credential: ${String(err)}` };
  }
}

export default {
  createN8nWorkflow,
  updateN8nWorkflow,
  getN8nWorkflow,
  deleteN8nWorkflow,
  setWorkflowActive,
  executeN8nWorkflow,
  getN8nExecution,
  listN8nWorkflows,
  listN8nNodeTypes,
  cancelN8nExecution,
  upsertBasecampCredential,
  listN8nCredentials,
  createN8nCredential,
  deleteN8nCredential,
};
