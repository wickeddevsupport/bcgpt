import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { executeWorkflowEngineWorkflow } from "../../src/gateway/workflow-api-client.js";
import { readWorkspaceConnectors } from "../../src/gateway/workspace-connectors.js";

const DEFAULT_BASE_URL = "https://flow.wickedlab.io";

type OpsConfig = {
  baseUrl?: string;
  apiKey?: string;
  projectId?: string;
};

type ResolvedOpsConfig = {
  baseUrl: string;
  apiKey: string | null;
  projectId?: string;
  userEmail?: string;
  userPassword?: string;
  workspaceKey: string;
};

type CachedUserToken = {
  token: string;
  expiresAt: number;
};

const userTokenCache = new Map<string, CachedUserToken>();

type MaybeObject = Record<string, unknown> | null;

type OpsRequestParams = {
  api: OpenClawPluginApi;
  endpoint: string;
  workspaceId?: string | null;
  method?: string;
  body?: unknown;
};

function normalizeUrl(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return DEFAULT_BASE_URL;
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
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

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readOptionalString(params: unknown, key: string): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  return readString((params as Record<string, unknown>)[key]);
}

function readOptionalNumber(params: unknown, key: string): number | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  const value = (params as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resolveToolParams(toolCallIdOrParams: unknown, maybeParams?: unknown): unknown {
  return maybeParams === undefined ? toolCallIdOrParams : maybeParams;
}

function toObject(value: unknown): MaybeObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function jsonToolResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

async function resolveOpsConfig(
  api: OpenClawPluginApi,
  workspaceId?: string | null,
): Promise<ResolvedOpsConfig> {
  const pluginCfg = (api.pluginConfig ?? {}) as OpsConfig;
  const rootCfg = api.config as unknown;

  let workspaceOps: Record<string, unknown> | null = null;
  let workspaceActivepieces: Record<string, unknown> | null = null;
  if (workspaceId) {
    const wc = await readWorkspaceConnectors(String(workspaceId)).catch(() => null);
    const ops = wc?.ops;
    const activepieces = wc?.activepieces;
    if (ops && typeof ops === "object" && !Array.isArray(ops)) {
      workspaceOps = ops as Record<string, unknown>;
    }
    if (activepieces && typeof activepieces === "object" && !Array.isArray(activepieces)) {
      workspaceActivepieces = activepieces as Record<string, unknown>;
    }
  }

  const pmosConnectors = (() => {
    if (!rootCfg || typeof rootCfg !== "object" || Array.isArray(rootCfg)) {
      return null;
    }
    const pmos = (rootCfg as Record<string, unknown>).pmos;
    if (!pmos || typeof pmos !== "object" || Array.isArray(pmos)) {
      return null;
    }
    const connectors = (pmos as Record<string, unknown>).connectors;
    if (!connectors || typeof connectors !== "object" || Array.isArray(connectors)) {
      return null;
    }
    return connectors as Record<string, unknown>;
  })();
  const pmosOps = toObject(pmosConnectors?.ops);
  const pmosActivepieces = toObject(pmosConnectors?.activepieces);
  const workspaceOpsUrlRaw = readString(workspaceOps?.url) ?? undefined;
  const workspaceOpsLooksLegacy = isLikelyLegacyN8nUrl(workspaceOpsUrlRaw);

  const baseUrl = normalizeUrl(
    readString(workspaceActivepieces?.url) ??
      (workspaceOpsLooksLegacy ? undefined : workspaceOpsUrlRaw) ??
      readString(pmosActivepieces?.url) ??
      process.env.ACTIVEPIECES_URL ??
      process.env.FLOW_URL ??
      readString(pmosOps?.url) ??
      readString(pluginCfg.baseUrl) ??
      process.env.OPS_URL ??
      DEFAULT_BASE_URL,
  );

  const apiKey =
    readString(workspaceActivepieces?.apiKey) ??
    (workspaceOpsLooksLegacy ? undefined : readString(workspaceOps?.apiKey)) ??
    readString(pmosActivepieces?.apiKey) ??
    readString(process.env.ACTIVEPIECES_API_KEY) ??
    readString(pmosOps?.apiKey) ??
    readString(pluginCfg.apiKey) ??
    readString(process.env.OPS_API_KEY) ??
    null;

  const projectId =
    readString(workspaceActivepieces?.projectId) ??
    (workspaceOpsLooksLegacy ? undefined : readString(workspaceOps?.projectId)) ??
    readString(pmosActivepieces?.projectId) ??
    readString(process.env.ACTIVEPIECES_PROJECT_ID) ??
    readString(pmosOps?.projectId) ??
    readString(pluginCfg.projectId) ??
    readString(process.env.OPS_PROJECT_ID);

  const workspaceUser = toObject(workspaceOps?.user);
  const workspaceActivepiecesUser = toObject(workspaceActivepieces?.user);
  const userEmail =
    readString(workspaceActivepiecesUser?.email) ??
    readString(workspaceUser?.email) ??
    undefined;
  const userPassword =
    readString(workspaceActivepiecesUser?.password) ??
    readString(workspaceUser?.password) ??
    undefined;

  if (!apiKey && !(userEmail && userPassword)) {
    throw new Error(
      "Workflow engine authentication is not configured. Set workspace user credentials or an Activepieces API key.",
    );
  }

  return {
    baseUrl,
    apiKey,
    projectId: projectId || undefined,
    userEmail,
    userPassword,
    workspaceKey: workspaceId ? String(workspaceId) : "global",
  };
}

async function signInWithWorkspaceUser(cfg: ResolvedOpsConfig): Promise<string | null> {
  if (!cfg.userEmail || !cfg.userPassword) {
    return null;
  }

  const cacheKey = `${cfg.workspaceKey}:${cfg.baseUrl}:${cfg.userEmail}`;
  const cached = userTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const endpoints = [
    "/api/v1/authentication/sign-in",
    "/api/v1/users/sign-in",
    "/api/v1/users/login",
  ];
  const payloads = [
    { email: cfg.userEmail, password: cfg.userPassword },
    { emailOrLdapLoginId: cfg.userEmail, password: cfg.userPassword },
  ];

  for (const endpoint of endpoints) {
    for (const payload of payloads) {
      const res = await fetch(`${cfg.baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      }).catch(() => null);
      if (!res || !res.ok) {
        continue;
      }
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const token = readString(body?.token);
      if (!token) {
        continue;
      }
      userTokenCache.set(cacheKey, {
        token,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      return token;
    }
  }
  return null;
}

async function resolveAuthHeader(cfg: ResolvedOpsConfig): Promise<string> {
  const userToken = await signInWithWorkspaceUser(cfg);
  if (userToken) {
    return `Bearer ${userToken}`;
  }
  if (cfg.apiKey) {
    return `Bearer ${cfg.apiKey}`;
  }
  throw new Error("Workflow engine authentication failed: no usable user token or API key.");
}

async function opsRequest(params: OpsRequestParams): Promise<unknown> {
  const cfg = await resolveOpsConfig(params.api, params.workspaceId ?? null);
  const endpoint = params.endpoint.replace(/^\/+/, "");
  const url = `${cfg.baseUrl}/api/v1/${endpoint}`;
  const method = (params.method ?? "GET").toUpperCase();
  const hasBody = params.body !== undefined;
  const authHeader = await resolveAuthHeader(cfg);

  const headers: Record<string, string> = {
    authorization: authHeader,
    accept: "application/json",
  };
  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(params.body) : undefined,
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

async function resolveProjectIdOrThrow(api: OpenClawPluginApi, workspaceId?: string | null): Promise<string> {
  const cfg = await resolveOpsConfig(api, workspaceId ?? null);
  if (cfg.projectId) {
    return cfg.projectId;
  }

  const projectsPayload = await opsRequest({ api, workspaceId, endpoint: "projects" });
  const projectsObj = toObject(projectsPayload);
  const projectsData = Array.isArray(projectsObj?.data)
    ? projectsObj?.data
    : Array.isArray(projectsPayload)
      ? projectsPayload
      : [];

  const firstProject = projectsData.find(
    (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
  ) as Record<string, unknown> | undefined;
  const projectId = readString(firstProject?.id);
  if (!projectId) {
    throw new Error(
      "No projectId configured for workflow engine. Set PMOS ops.projectId in Integrations.",
    );
  }
  return projectId;
}

function toWorkflowSummary(entry: Record<string, unknown>): Record<string, unknown> {
  const id = readString(entry.id) ?? "";
  const displayName = readString(entry.displayName) ?? readString(entry.name) ?? id;
  const status = readString(entry.status) ?? "DISABLED";
  return {
    id,
    name: displayName,
    displayName,
    active: status.toUpperCase() === "ENABLED",
    status,
    createdAt: readString(entry.created) ?? readString(entry.createdAt),
    updatedAt: readString(entry.updated) ?? readString(entry.updatedAt),
    projectId: readString(entry.projectId),
  };
}

function getCompatNodes(flow: Record<string, unknown>): unknown[] {
  const metadata = toObject(flow.metadata);
  const compat = toObject(metadata?.n8nCompat);
  return Array.isArray(compat?.nodes) ? compat.nodes : [];
}

function getCompatConnections(flow: Record<string, unknown>): Record<string, unknown> {
  const metadata = toObject(flow.metadata);
  const compat = toObject(metadata?.n8nCompat);
  const value = toObject(compat?.connections);
  return value ?? {};
}

function toWorkflowDetails(entry: Record<string, unknown>): Record<string, unknown> {
  const base = toWorkflowSummary(entry);
  return {
    ...base,
    nodes: getCompatNodes(entry),
    connections: getCompatConnections(entry),
    settings: toObject(toObject(toObject(entry.metadata)?.n8nCompat)?.settings) ?? {},
    raw: entry,
  };
}

function toExecutionSummary(entry: Record<string, unknown>): Record<string, unknown> {
  const id = readString(entry.id) ?? "";
  const statusRaw = readString(entry.status) ?? "RUNNING";
  const lowered = statusRaw.toLowerCase();
  const status = lowered.includes("success")
    ? "success"
    : lowered.includes("fail") || lowered.includes("error")
      ? "failed"
      : lowered.includes("cancel")
        ? "canceled"
        : lowered.includes("wait")
          ? "waiting"
          : "running";
  const workflowId = readString(entry.flowId) ?? readString(toObject(entry.flowVersion)?.flowId);
  return {
    id,
    workflowId,
    flowId: workflowId,
    status,
    mode: readString(entry.environment) ?? "manual",
    finished: status !== "running" && status !== "waiting",
    startedAt: readString(entry.created) ?? readString(entry.createdAt),
    stoppedAt: readString(entry.finishTime) ?? readString(entry.updatedAt),
    raw: entry,
  };
}

async function setWorkflowStatus(params: {
  api: OpenClawPluginApi;
  workspaceId?: string | null;
  workflowId: string;
  enabled: boolean;
}): Promise<unknown> {
  return opsRequest({
    api: params.api,
    workspaceId: params.workspaceId,
    endpoint: `flows/${encodeURIComponent(params.workflowId)}`,
    method: "POST",
    body: {
      type: "CHANGE_STATUS",
      request: { status: params.enabled ? "ENABLED" : "DISABLED" },
    },
  });
}

async function updateCompatMetadata(params: {
  api: OpenClawPluginApi;
  workspaceId?: string | null;
  workflowId: string;
  metadataPatch: Record<string, unknown>;
}): Promise<unknown> {
  const current = await opsRequest({
    api: params.api,
    workspaceId: params.workspaceId,
    endpoint: `flows/${encodeURIComponent(params.workflowId)}`,
    method: "GET",
  });
  const currentObj = toObject(current) ?? {};
  const currentMetadata = toObject(currentObj.metadata) ?? {};
  const merged = {
    ...currentMetadata,
    ...params.metadataPatch,
  };

  return opsRequest({
    api: params.api,
    workspaceId: params.workspaceId,
    endpoint: `flows/${encodeURIComponent(params.workflowId)}`,
    method: "POST",
    body: {
      type: "UPDATE_METADATA",
      request: { metadata: merged },
    },
  });
}

type CompatGraphNode = {
  id: string;
  stepName: string;
  displayName: string;
  role: "trigger" | "action";
  rawType: string;
  pieceHint?: string;
};

type PieceDescriptor = {
  name: string;
  version: string;
  triggerNames: string[];
  actionNames: string[];
};

const FLOW_TRIGGER_NAME = "trigger";
const FLOW_TRIGGER_DISPLAY_NAME = "Webhook Trigger";
const TRIGGER_PREFERENCE_BY_PIECE: Record<string, string[]> = {
  "@activepieces/piece-webhook": ["catch_webhook", "catch_raw_webhook", "catch_request"],
  "@activepieces/piece-schedule": ["cron_expression", "every_day", "every_hour"],
  "@activepieces/piece-manual-trigger": ["manual_trigger"],
};
const ACTION_PREFERENCE_BY_PIECE: Record<string, string[]> = {
  "@activepieces/piece-basecamp": ["create_todo", "create_message", "create_comment", "get_projects"],
  "@activepieces/piece-slack": ["send_message_to_a_channel", "send_message", "send-message-to-channel"],
  "@activepieces/piece-gmail": ["send_email", "send_email_action", "send-email"],
  "@activepieces/piece-notion": ["create_page", "update_page"],
  "@activepieces/piece-airtable": ["create_record", "update_record"],
  "@activepieces/piece-discord": ["send_message", "send_message_to_channel"],
  "@activepieces/piece-telegram": ["send_message"],
  "@activepieces/piece-google-sheets": ["append_values", "update_values", "create_spreadsheet"],
  "@activepieces/piece-http": ["send_request", "http_request", "call_api"],
};
const PIECE_VERSION_FALLBACK: Record<string, string> = {
  "@activepieces/piece-webhook": "0.1.0",
  "@activepieces/piece-schedule": "0.0.2",
  "@activepieces/piece-http": "0.1.0",
  "@activepieces/piece-basecamp": "0.0.1",
};

function sanitizeStepName(raw: string, fallbackPrefix: string, index: number): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (cleaned) {
    return cleaned;
  }
  return `${fallbackPrefix}_${index + 1}`;
}

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  const obj = toObject(value);
  return Boolean(obj) && Object.keys(obj).length > 0;
}

function hasCompatGraph(params: Record<string, unknown>): boolean {
  return Array.isArray(params.nodes) || isNonEmptyObject(params.connections);
}

function parseCompatGraphNodes(rawNodes: unknown): CompatGraphNode[] {
  const rows = Array.isArray(rawNodes) ? rawNodes : [];
  const parsed = rows
    .map((row, index) => {
      const obj = toObject(row);
      if (!obj) {
        return null;
      }
      const id = readString(obj.id) ?? `node_${index + 1}`;
      const displayName = readString(obj.name) ?? readString(obj.label) ?? id;
      const rawType = readString(obj.type) ?? "";
      const explicitRole = readString(obj.role) ?? readString(obj.kind) ?? readString(obj.nodeType);
      const pieceHint = readString(obj.piece) ?? (rawType || undefined);
      const lowered = `${explicitRole ?? ""} ${rawType} ${pieceHint ?? ""}`.toLowerCase();
      const role: "trigger" | "action" =
        lowered.includes("trigger") || lowered.includes("webhook") || lowered.includes("schedule")
          ? "trigger"
          : "action";
      return {
        id,
        stepName: sanitizeStepName(id || displayName, role === "trigger" ? "trigger" : "action", index),
        displayName,
        role,
        rawType,
        pieceHint,
      } satisfies CompatGraphNode;
    })
    .filter((row): row is CompatGraphNode => Boolean(row));

  if (parsed.length === 0) {
    return [];
  }
  if (parsed.some((row) => row.role === "trigger")) {
    return parsed;
  }

  const first = parsed[0];
  parsed[0] = {
    ...first,
    role: "trigger",
    stepName: sanitizeStepName(first.stepName || first.id, "trigger", 0),
  };
  return parsed;
}

function parseCompatConnections(rawConnections: unknown): Map<string, string> {
  const edges = new Map<string, string>();
  const connections = toObject(rawConnections);
  if (!connections) {
    return edges;
  }
  for (const [from, value] of Object.entries(connections)) {
    const obj = toObject(value);
    const main = Array.isArray(obj?.main) ? obj.main : [];
    const firstLane = Array.isArray(main[0]) ? main[0] : [];
    const firstTarget = firstLane.find(
      (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
    ) as Record<string, unknown> | undefined;
    const target = readString(firstTarget?.node);
    if (target) {
      edges.set(from, target);
    }
  }
  return edges;
}

function orderCompatActionNodes(
  nodes: CompatGraphNode[],
  rawConnections: unknown,
): { trigger: CompatGraphNode; actions: CompatGraphNode[] } {
  const trigger = nodes.find((node) => node.role === "trigger") ?? nodes[0];
  const byKey = new Map<string, CompatGraphNode>();
  for (const node of nodes) {
    byKey.set(node.id, node);
    byKey.set(node.displayName, node);
    byKey.set(node.stepName, node);
  }

  const connectionMap = parseCompatConnections(rawConnections);
  const ordered: CompatGraphNode[] = [];
  const visited = new Set<string>();
  let current: CompatGraphNode | undefined = trigger;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.role === "action") {
      ordered.push(current);
    }
    const nextKey = connectionMap.get(current.displayName) ?? connectionMap.get(current.id) ?? connectionMap.get(current.stepName);
    if (!nextKey) {
      break;
    }
    const next = byKey.get(nextKey);
    if (!next || next.role !== "action") {
      break;
    }
    current = next;
  }

  for (const node of nodes) {
    if (node.role === "action" && !visited.has(node.id)) {
      ordered.push(node);
      visited.add(node.id);
    }
  }

  return { trigger, actions: ordered };
}

function inferPieceName(raw: string | undefined, role: "trigger" | "action"): string | null {
  const value = (raw ?? "").trim();
  if (!value) {
    return role === "trigger" ? "@activepieces/piece-webhook" : null;
  }
  if (value.startsWith("@activepieces/piece-")) {
    return value;
  }

  const lowered = value.toLowerCase();
  if (role === "trigger") {
    if (lowered.includes("schedule") || lowered.includes("cron")) {
      return "@activepieces/piece-schedule";
    }
    if (lowered.includes("manual")) {
      return "@activepieces/piece-manual-trigger";
    }
    return "@activepieces/piece-webhook";
  }

  if (lowered.includes("basecamp")) return "@activepieces/piece-basecamp";
  if (lowered.includes("slack")) return "@activepieces/piece-slack";
  if (lowered.includes("gmail") || lowered.includes("email")) return "@activepieces/piece-gmail";
  if (lowered.includes("google") && lowered.includes("sheet")) return "@activepieces/piece-google-sheets";
  if (lowered.includes("notion")) return "@activepieces/piece-notion";
  if (lowered.includes("discord")) return "@activepieces/piece-discord";
  if (lowered.includes("telegram")) return "@activepieces/piece-telegram";
  if (lowered.includes("airtable")) return "@activepieces/piece-airtable";
  if (lowered.includes("http")) return "@activepieces/piece-http";
  if (lowered.includes("code")) return null;
  if (lowered.includes("activepieces.action.code")) return null;
  return null;
}

function pickPreferredName(candidates: string[], preferred: string[]): string | null {
  if (candidates.length === 0) {
    return null;
  }
  for (const pref of preferred) {
    const hit = candidates.find((candidate) => candidate === pref);
    if (hit) {
      return hit;
    }
  }
  return candidates[0] ?? null;
}

async function loadPieceDescriptor(params: {
  api: OpenClawPluginApi;
  workspaceId?: string | null;
  projectId: string;
  pieceName: string;
  cache: Map<string, PieceDescriptor | null>;
}): Promise<PieceDescriptor | null> {
  const cached = params.cache.get(params.pieceName);
  if (cached !== undefined) {
    return cached;
  }

  const query = new URLSearchParams();
  query.set("projectId", params.projectId);
  const payload = await opsRequest({
    api: params.api,
    workspaceId: params.workspaceId,
    endpoint: `pieces/${encodeURIComponent(params.pieceName)}?${query.toString()}`,
  }).catch(() => null);

  const obj = toObject(payload) ?? {};
  const piece = toObject(obj.piece) ?? obj;
  const triggersObj = toObject(piece.triggers) ?? {};
  const actionsObj = toObject(piece.actions) ?? {};
  const descriptor: PieceDescriptor = {
    name: readString(piece.name) ?? params.pieceName,
    version:
      readString(piece.version) ??
      PIECE_VERSION_FALLBACK[params.pieceName] ??
      "0.1.0",
    triggerNames: Object.keys(triggersObj),
    actionNames: Object.keys(actionsObj),
  };
  params.cache.set(params.pieceName, descriptor);
  return descriptor;
}

async function buildTriggerStep(params: {
  api: OpenClawPluginApi;
  workspaceId?: string | null;
  projectId: string;
  triggerNode: CompatGraphNode;
  nextAction?: Record<string, unknown>;
  cache: Map<string, PieceDescriptor | null>;
}): Promise<Record<string, unknown>> {
  const pieceName = inferPieceName(params.triggerNode.pieceHint ?? params.triggerNode.rawType, "trigger")
    ?? "@activepieces/piece-webhook";
  const descriptor = await loadPieceDescriptor({
    api: params.api,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    pieceName,
    cache: params.cache,
  });

  const triggerName = pickPreferredName(
    descriptor?.triggerNames ?? [],
    TRIGGER_PREFERENCE_BY_PIECE[pieceName] ?? [],
  ) ?? "catch_webhook";
  const triggerInput =
    pieceName === "@activepieces/piece-schedule"
      ? { cronExpression: "0 * * * *" }
      : {};

  const trigger: Record<string, unknown> = {
    name: FLOW_TRIGGER_NAME,
    valid: true,
    displayName: params.triggerNode.displayName || FLOW_TRIGGER_DISPLAY_NAME,
    type: "PIECE_TRIGGER",
    settings: {
      propertySettings: {},
      pieceName,
      pieceVersion: descriptor?.version ?? PIECE_VERSION_FALLBACK[pieceName] ?? "0.1.0",
      triggerName,
      input: triggerInput,
    },
  };
  if (params.nextAction) {
    trigger.nextAction = params.nextAction;
  }
  return trigger;
}

function buildCodeActionStep(node: CompatGraphNode, nextAction?: Record<string, unknown>): Record<string, unknown> {
  const action: Record<string, unknown> = {
    name: node.stepName,
    valid: true,
    displayName: node.displayName,
    type: "CODE",
    settings: {
      input: {},
      sourceCode: {
        packageJson: "{}",
        code: "export const code = async (inputs) => inputs;",
      },
    },
  };
  if (nextAction) {
    action.nextAction = nextAction;
  }
  return action;
}

async function buildActionStep(params: {
  api: OpenClawPluginApi;
  workspaceId?: string | null;
  projectId: string;
  node: CompatGraphNode;
  nextAction?: Record<string, unknown>;
  cache: Map<string, PieceDescriptor | null>;
}): Promise<Record<string, unknown>> {
  const pieceName = inferPieceName(params.node.pieceHint ?? params.node.rawType, "action");
  if (!pieceName) {
    return buildCodeActionStep(params.node, params.nextAction);
  }

  const descriptor = await loadPieceDescriptor({
    api: params.api,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    pieceName,
    cache: params.cache,
  });

  const actionName = pickPreferredName(
    descriptor?.actionNames ?? [],
    ACTION_PREFERENCE_BY_PIECE[pieceName] ?? [],
  );
  if (!actionName) {
    return buildCodeActionStep(params.node, params.nextAction);
  }

  const action: Record<string, unknown> = {
    name: params.node.stepName,
    valid: true,
    displayName: params.node.displayName,
    type: "PIECE",
    settings: {
      propertySettings: {},
      pieceName,
      pieceVersion: descriptor?.version ?? PIECE_VERSION_FALLBACK[pieceName] ?? "0.1.0",
      actionName,
      input: {},
    },
  };
  if (params.nextAction) {
    action.nextAction = params.nextAction;
  }
  return action;
}

async function applyCompatGraphToWorkflow(params: {
  api: OpenClawPluginApi;
  workspaceId?: string | null;
  projectId: string;
  workflowId: string;
  displayName: string;
  rawNodes: unknown;
  rawConnections: unknown;
}): Promise<void> {
  const nodes = parseCompatGraphNodes(params.rawNodes);
  if (nodes.length === 0) {
    return;
  }

  const { trigger, actions } = orderCompatActionNodes(nodes, params.rawConnections);
  const cache = new Map<string, PieceDescriptor | null>();
  let nextAction: Record<string, unknown> | undefined = undefined;
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const actionNode = actions[index];
    nextAction = await buildActionStep({
      api: params.api,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      node: actionNode,
      nextAction,
      cache,
    });
  }

  const triggerStep = await buildTriggerStep({
    api: params.api,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    triggerNode: trigger,
    nextAction,
    cache,
  });

  await opsRequest({
    api: params.api,
    workspaceId: params.workspaceId,
    endpoint: `flows/${encodeURIComponent(params.workflowId)}`,
    method: "POST",
    body: {
      type: "IMPORT_FLOW",
      request: {
        displayName: params.displayName,
        trigger: triggerStep,
        schemaVersion: null,
        notes: [],
      },
    },
  });
}

export default {
  id: "wicked-ops",
  name: "Wicked Ops (Activepieces)",
  register(api: OpenClawPluginApi) {
    api.logger.info("[wicked-ops] registering Activepieces-backed tools");

    const registerTool = (tool: unknown, opts?: Parameters<OpenClawPluginApi['registerTool']>[1]) => {
      api.registerTool(tool as Parameters<OpenClawPluginApi["registerTool"]>[0], opts);
    };

    registerTool({
      name: "ops_workflows_list",
      description: "List workflows in the workspace workflow engine.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          active: { type: "boolean" },
          tags: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
          name: { type: "string" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId = readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        const limit = readOptionalNumber(params, "limit");
        const cursor = readOptionalString(params, "cursor");
        const name = readOptionalString(params, "name");
        const active =
          params && typeof params === "object" && !Array.isArray(params)
            ? ((params as Record<string, unknown>).active as boolean | undefined)
            : undefined;

        const query = new URLSearchParams();
        query.set("projectId", projectId);
        if (cursor) query.set("cursor", cursor);
        if (name) query.set("name", name);
        if (limit && limit > 0) query.set("limit", String(Math.trunc(limit)));

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flows?${query.toString()}`,
        });

        const obj = toObject(payload);
        const rows = Array.isArray(obj?.data) ? obj.data : [];
        const mapped = rows
          .filter((row) => row && typeof row === "object" && !Array.isArray(row))
          .map((row) => toWorkflowSummary(row as Record<string, unknown>))
          .filter((row) => (typeof active === "boolean" ? Boolean(row.active) === active : true));

        return jsonToolResult({
          data: mapped,
          next: readString(obj?.next),
          previous: readString(obj?.previous),
        });
      },
    });

    registerTool({
      name: "ops_workflow_get",
      description: "Get details of a workflow by ID.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) throw new Error("workflowId is required");

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flows/${encodeURIComponent(workflowId)}`,
        });

        return jsonToolResult(toWorkflowDetails(toObject(payload) ?? {}));
      },
    });

    registerTool({
      name: "ops_workflow_create",
      description: "Create a new workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string" },
          nodes: { type: "array" },
          connections: { type: "object" },
          settings: { type: "object" },
          tags: { type: "array" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const name = readOptionalString(params, "name");
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId = readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        if (!name) throw new Error("name is required");

        const created = await opsRequest({
          api,
          workspaceId,
          endpoint: "flows",
          method: "POST",
          body: {
            displayName: name,
            projectId,
          },
        });
        const flow = toObject(created);
        const flowId = readString(flow?.id);

        if (flowId && params && typeof params === "object" && !Array.isArray(params)) {
          const rawParams = params as Record<string, unknown>;
          if (Array.isArray(rawParams.nodes) || toObject(rawParams.connections) || toObject(rawParams.settings)) {
            await updateCompatMetadata({
              api,
              workspaceId,
              workflowId: flowId,
              metadataPatch: {
                n8nCompat: {
                  nodes: Array.isArray(rawParams.nodes) ? rawParams.nodes : [],
                  connections: toObject(rawParams.connections) ?? {},
                  settings: toObject(rawParams.settings) ?? {},
                  tags: Array.isArray(rawParams.tags) ? rawParams.tags : [],
                },
              },
            });
          }
          if (hasCompatGraph(rawParams)) {
            await applyCompatGraphToWorkflow({
              api,
              workspaceId,
              projectId,
              workflowId: flowId,
              displayName: name,
              rawNodes: rawParams.nodes,
              rawConnections: rawParams.connections,
            });
          }
        }

        const refreshed = flowId
          ? await opsRequest({
              api,
              workspaceId,
              endpoint: `flows/${encodeURIComponent(flowId)}`,
            })
          : flow;
        return jsonToolResult(toWorkflowDetails(toObject(refreshed) ?? flow ?? {}));
      },
    });

    registerTool({
      name: "ops_workflow_generate",
      description: "Create a starter workflow from a short description.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const name = readOptionalString(params, "name");
        const description = readOptionalString(params, "description");
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId = readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        if (!name || !description) throw new Error("name and description are required");

        const created = await opsRequest({
          api,
          workspaceId,
          endpoint: "flows",
          method: "POST",
          body: { displayName: name, projectId },
        });
        const flow = toObject(created);
        const flowId = readString(flow?.id);
        if (flowId) {
          await updateCompatMetadata({
            api,
            workspaceId,
            workflowId: flowId,
            metadataPatch: { description },
          });
        }
        return jsonToolResult(toWorkflowDetails(flow ?? {}));
      },
    });

    registerTool({
      name: "ops_workflow_update",
      description: "Update workflow properties or apply workflow-engine operations.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string" },
          name: { type: "string" },
          nodes: { type: "array" },
          connections: { type: "object" },
          settings: { type: "object" },
          tags: { type: "array" },
          active: { type: "boolean" },
          type: { type: "string" },
          request: { type: "object" },
          operations: { type: "array" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) throw new Error("workflowId is required");
        const currentFlowPayload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flows/${encodeURIComponent(workflowId)}`,
        });
        const currentFlow = toObject(currentFlowPayload) ?? {};
        const currentDisplayName = readString(currentFlow.displayName) ?? readString(currentFlow.name) ?? "Workflow";
        const projectId = readOptionalString(params, "projectId") ?? readString(currentFlow.projectId) ?? (await resolveProjectIdOrThrow(api, workspaceId));

        if (params && typeof params === "object" && !Array.isArray(params)) {
          const obj = params as Record<string, unknown>;
          const name = readString(obj.name);
          if (name) {
            await opsRequest({
              api,
              workspaceId,
              endpoint: `flows/${encodeURIComponent(workflowId)}`,
              method: "POST",
              body: { type: "CHANGE_NAME", request: { displayName: name } },
            });
          }
          if (typeof obj.active === "boolean") {
            await setWorkflowStatus({
              api,
              workspaceId,
              workflowId,
              enabled: obj.active,
            });
          }

          const operations: Array<{ type: string; request: Record<string, unknown> }> = [];
          const directType = readString(obj.type);
          if (directType) {
            operations.push({
              type: directType,
              request: toObject(obj.request) ?? {},
            });
          }
          if (Array.isArray(obj.operations)) {
            for (const rawOp of obj.operations) {
              const opObj = toObject(rawOp);
              const opType = readString(opObj?.type);
              if (!opType) {
                continue;
              }
              operations.push({
                type: opType,
                request: toObject(opObj?.request) ?? {},
              });
            }
          }
          for (const operation of operations) {
            await opsRequest({
              api,
              workspaceId,
              endpoint: `flows/${encodeURIComponent(workflowId)}`,
              method: "POST",
              body: {
                type: operation.type,
                request: operation.request,
              },
            });
          }

          if (Array.isArray(obj.nodes) || toObject(obj.connections) || toObject(obj.settings) || Array.isArray(obj.tags)) {
            await updateCompatMetadata({
              api,
              workspaceId,
              workflowId,
              metadataPatch: {
                n8nCompat: {
                  nodes: Array.isArray(obj.nodes) ? obj.nodes : [],
                  connections: toObject(obj.connections) ?? {},
                  settings: toObject(obj.settings) ?? {},
                  tags: Array.isArray(obj.tags) ? obj.tags : [],
                },
              },
            });
          }

          if (hasCompatGraph(obj)) {
            await applyCompatGraphToWorkflow({
              api,
              workspaceId,
              projectId,
              workflowId,
              displayName: name ?? currentDisplayName,
              rawNodes: obj.nodes,
              rawConnections: obj.connections,
            });
          }
        }

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flows/${encodeURIComponent(workflowId)}`,
        });
        return jsonToolResult(toWorkflowDetails(toObject(payload) ?? {}));
      },
    });

    registerTool({
      name: "ops_workflow_delete",
      description: "Delete a workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) throw new Error("workflowId is required");

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flows/${encodeURIComponent(workflowId)}`,
          method: "DELETE",
        });
        return jsonToolResult(payload);
      },
    });

    registerTool({
      name: "ops_workflow_activate",
      description: "Activate a workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) throw new Error("workflowId is required");
        const payload = await setWorkflowStatus({ api, workspaceId, workflowId, enabled: true });
        return jsonToolResult(payload);
      },
    });

    registerTool({
      name: "ops_workflow_deactivate",
      description: "Deactivate a workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) throw new Error("workflowId is required");
        const payload = await setWorkflowStatus({ api, workspaceId, workflowId, enabled: false });
        return jsonToolResult(payload);
      },
    });

    registerTool({
      name: "ops_executions_list",
      description: "List workflow runs.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          workflowId: { type: "string" },
          status: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId = readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        const workflowId = readOptionalString(params, "workflowId");
        const status = readOptionalString(params, "status");
        const limit = readOptionalNumber(params, "limit");
        const cursor = readOptionalString(params, "cursor");

        const query = new URLSearchParams();
        query.set("projectId", projectId);
        if (workflowId) query.set("flowId", workflowId);
        if (status) query.set("status", status);
        if (cursor) query.set("cursor", cursor);
        if (limit && limit > 0) query.set("limit", String(Math.trunc(limit)));

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flow-runs?${query.toString()}`,
        });
        const obj = toObject(payload);
        const rows = Array.isArray(obj?.data) ? obj.data : [];
        const mapped = rows
          .filter((row) => row && typeof row === "object" && !Array.isArray(row))
          .map((row) => toExecutionSummary(row as Record<string, unknown>));

        return jsonToolResult({
          data: mapped,
          next: readString(obj?.next),
          previous: readString(obj?.previous),
        });
      },
    });

    registerTool({
      name: "ops_execution_get",
      description: "Get details of a workflow run.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["executionId"],
        properties: {
          executionId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const executionId = readOptionalString(params, "executionId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!executionId) throw new Error("executionId is required");

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flow-runs/${encodeURIComponent(executionId)}`,
        });
        return jsonToolResult(toExecutionSummary(toObject(payload) ?? {}));
      },
    });

    registerTool({
      name: "ops_workflow_execute",
      description: "Execute a workflow, retry a run, or trigger a webhook workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string" },
          data: { type: "object" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) throw new Error("workflowId is required");

        const input =
          params && typeof params === "object" && !Array.isArray(params)
            ? (toObject((params as Record<string, unknown>).data) ?? {})
            : {};

        const draft = Boolean(input.__draft);
        const sync = Boolean(input.__sync);
        const retryExecutionId = readString(input.__retryExecutionId);
        const retryStrategy = readString(input.__retryStrategy) ?? "ON_LATEST_VERSION";
        delete input.__draft;
        delete input.__sync;
        delete input.__retryExecutionId;
        delete input.__retryStrategy;

        if (retryExecutionId) {
          const projectId = await resolveProjectIdOrThrow(api, workspaceId);
          const payload = await opsRequest({
            api,
            workspaceId,
            endpoint: `flow-runs/${encodeURIComponent(retryExecutionId)}/retry`,
            method: "POST",
            body: {
              projectId,
              strategy: retryStrategy,
            },
          });
          return jsonToolResult(toExecutionSummary(toObject(payload) ?? {}));
        }

        const hasStructuredPayload = Object.keys(input).length > 0;
        if (!draft && !sync && !hasStructuredPayload && workspaceId) {
          const execution = await executeWorkflowEngineWorkflow(workspaceId, workflowId);
          if (!execution.ok) {
            throw new Error(execution.error ?? "Workflow execution failed.");
          }
          if (!execution.executionId) {
            return jsonToolResult({ ok: true });
          }
          const payload = await opsRequest({
            api,
            workspaceId,
            endpoint: `flow-runs/${encodeURIComponent(execution.executionId)}`,
          });
          return jsonToolResult(toExecutionSummary(toObject(payload) ?? {}));
        }

        const suffix = draft && sync ? "draft/sync" : draft ? "draft" : sync ? "sync" : "";
        const endpoint = suffix
          ? `webhooks/${encodeURIComponent(workflowId)}/${suffix}`
          : `webhooks/${encodeURIComponent(workflowId)}`;

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint,
          method: "POST",
          body: input,
        });

        return jsonToolResult(payload);
      },
    });

    registerTool({
      name: "ops_pieces_list",
      description: "List workflow-engine pieces (integrations).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
          cursor: { type: "string" },
          search: { type: "string" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId =
          readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        const limit = readOptionalNumber(params, "limit");
        const cursor = readOptionalString(params, "cursor");
        const search = readOptionalString(params, "search")?.toLowerCase();

        const query = new URLSearchParams();
        query.set("projectId", projectId);
        if (cursor) query.set("cursor", cursor);
        if (limit && limit > 0) query.set("limit", String(Math.trunc(limit)));

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `pieces?${query.toString()}`,
        });

        const obj = toObject(payload);
        const rows = Array.isArray(obj?.data)
          ? obj.data
          : Array.isArray(payload)
            ? payload
            : [];
        const mapped = rows
          .filter((row) => row && typeof row === "object" && !Array.isArray(row))
          .map((row) => {
            const entry = row as Record<string, unknown>;
            const name = readString(entry.name) ?? "";
            const displayName = readString(entry.displayName) ?? name;
            const description = readString(entry.description) ?? readString(entry.summary);
            return {
              name,
              displayName,
              description,
              version: readString(entry.version),
              logoUrl: readString(entry.logoUrl),
              releaseStage: readString(entry.releaseStage),
              minimumSupportedRelease: readString(entry.minimumSupportedRelease),
              raw: entry,
            };
          })
          .filter((entry) => {
            if (!search) return true;
            const haystack = `${entry.name} ${entry.displayName ?? ""} ${entry.description ?? ""}`.toLowerCase();
            return haystack.includes(search);
          });

        return jsonToolResult({
          data: mapped,
          next: readString(obj?.next),
          previous: readString(obj?.previous),
        });
      },
    });

    registerTool({
      name: "ops_piece_get",
      description: "Get workflow-engine piece details by piece name.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["pieceName"],
        properties: {
          pieceName: { type: "string" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const pieceName = readOptionalString(params, "pieceName");
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId =
          readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        if (!pieceName) throw new Error("pieceName is required");

        const query = new URLSearchParams();
        query.set("projectId", projectId);
        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `pieces/${encodeURIComponent(pieceName)}?${query.toString()}`,
        });
        return jsonToolResult(payload);
      },
    });

    registerTool({
      name: "ops_credentials_list",
      description: "List workflow-engine credentials (app connections).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string" },
          pieceName: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId = readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        const typeFilter = readOptionalString(params, "type");
        const pieceName = readOptionalString(params, "pieceName");
        const limit = readOptionalNumber(params, "limit");
        const cursor = readOptionalString(params, "cursor");

        const query = new URLSearchParams();
        query.set("projectId", projectId);
        if (pieceName) query.set("pieceName", pieceName);
        if (cursor) query.set("cursor", cursor);
        if (limit && limit > 0) query.set("limit", String(Math.trunc(limit)));

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `app-connections?${query.toString()}`,
        });

        const obj = toObject(payload);
        const rows = Array.isArray(obj?.data) ? obj.data : [];
        const mapped = rows
          .filter((row) => row && typeof row === "object" && !Array.isArray(row))
          .map((row) => {
            const entry = row as Record<string, unknown>;
            return {
              id: readString(entry.id) ?? "",
              name: readString(entry.displayName) ?? readString(entry.externalId) ?? "",
              displayName: readString(entry.displayName),
              type: readString(entry.pieceName) ?? readString(entry.type) ?? "",
              pieceName: readString(entry.pieceName),
              status: readString(entry.status),
              createdAt: readString(entry.created),
            };
          })
          .filter((entry) => {
            if (!typeFilter) return true;
            const check = typeFilter.toLowerCase();
            return (
              entry.type.toLowerCase().includes(check) ||
              String(entry.pieceName ?? "").toLowerCase().includes(check)
            );
          });

        return jsonToolResult({
          data: mapped,
          next: readString(obj?.next),
          previous: readString(obj?.previous),
        });
      },
    });

    registerTool({
      name: "ops_test_connection",
      description: "Test workflow engine API connectivity.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          workspaceId: { type: "string" },
          projectId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId = readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        const query = new URLSearchParams();
        query.set("projectId", projectId);
        query.set("limit", "1");

        const data = await opsRequest({
          api,
          workspaceId,
          endpoint: `flows?${query.toString()}`,
        });

        return jsonToolResult({
          success: true,
          message: "Connected to workflow engine",
          data,
        });
      },
    });

    api.logger.info("[wicked-ops] Activepieces compatibility tools registered");
  },
};
