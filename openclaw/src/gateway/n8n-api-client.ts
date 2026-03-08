/**
 * Workflow Engine API Client (Activepieces compatibility layer)
 *
 * This module keeps the historical `n8n-api-client` exports stable so existing
 * PMOS server-method handlers and chat tools continue to work while the
 * underlying runtime is Activepieces.
 */

import { io, type Socket } from "socket.io-client";
import { loadConfig } from "../config/config.js";
import { readWorkspaceConnectors } from "./workspace-connectors.js";

const DEFAULT_BASE_URL = "https://flow.wickedlab.io";
const ACTIVEPIECES_SOCKET_PATH = "/api/socket.io";
const ACTIVEPIECES_SOCKET_TIMEOUT_MS = 15_000;
const ACTIVEPIECES_BASECAMP_PIECE_NAME = "@activepieces/piece-basecamp";
const ACTIVEPIECES_BASECAMP_EXTERNAL_ID = "openclaw-basecamp";

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

const ACTIVEPIECES_SOCKET_SERVER_EVENT_TEST_FLOW_RUN = "TEST_FLOW_RUN";
const ACTIVEPIECES_SOCKET_SERVER_EVENT_MANUAL_TRIGGER_RUN_STARTED = "MANUAL_TRIGGER_RUN_STARTED";
const ACTIVEPIECES_SOCKET_CLIENT_EVENT_TEST_FLOW_RUN_STARTED = "TEST_FLOW_RUN_STARTED";
const ACTIVEPIECES_SOCKET_CLIENT_EVENT_MANUAL_TRIGGER_RUN_STARTED = "MANUAL_TRIGGER_RUN_STARTED";
type ActivepiecesExecutionMode = "manual" | "test";

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
    credentials?: Record<string, unknown>;
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

type ActivepiecesConnectionSummary = {
  id: string;
  externalId: string;
  displayName: string;
  pieceName: string;
};

type CompatGraphNode = {
  id: string;
  stepName: string;
  displayName: string;
  role: "trigger" | "action";
  rawType: string;
  pieceHint?: string;
  parameters: JsonObject;
  credentials: JsonObject | null;
};

type CompatExpressionContext = {
  upstreamStepName: string;
  stepNamesByRef: Map<string, string>;
};

type PieceDescriptor = {
  name: string;
  version: string;
  triggerNames: string[];
  actionNames: string[];
};

const FLOW_TRIGGER_NAME = "trigger";
const FLOW_TRIGGER_DISPLAY_NAME = "Trigger";
const ACTIVEPIECES_WEBHOOK_PIECE_NAME = "@activepieces/piece-webhook";
const ACTIVEPIECES_HTTP_PIECE_NAME = "@activepieces/piece-http";
const ACTIVEPIECES_SCHEDULE_PIECE_NAME = "@activepieces/piece-schedule";
const ACTIVEPIECES_MANUAL_TRIGGER_PIECE_NAME = "@activepieces/piece-manual-trigger";
const DEFAULT_SCHEDULE_TIMEZONE = "UTC";

const PIECE_VERSION_FALLBACK: Record<string, string> = {
  [ACTIVEPIECES_BASECAMP_PIECE_NAME]: "0.0.1",
  [ACTIVEPIECES_WEBHOOK_PIECE_NAME]: "0.1.0",
  [ACTIVEPIECES_HTTP_PIECE_NAME]: "0.1.0",
  [ACTIVEPIECES_SCHEDULE_PIECE_NAME]: "0.0.2",
  [ACTIVEPIECES_MANUAL_TRIGGER_PIECE_NAME]: "0.0.1",
};

const TRIGGER_PREFERENCE_BY_PIECE: Record<string, string[]> = {
  [ACTIVEPIECES_WEBHOOK_PIECE_NAME]: ["catch_webhook"],
  [ACTIVEPIECES_SCHEDULE_PIECE_NAME]: ["cron_expression", "every_day", "every_hour"],
  [ACTIVEPIECES_MANUAL_TRIGGER_PIECE_NAME]: ["manual_trigger"],
  [ACTIVEPIECES_BASECAMP_PIECE_NAME]: ["new_todo"],
};

const ACTION_PREFERENCE_BY_PIECE: Record<string, string[]> = {
  [ACTIVEPIECES_HTTP_PIECE_NAME]: ["send_request"],
  [ACTIVEPIECES_WEBHOOK_PIECE_NAME]: ["return_response"],
  [ACTIVEPIECES_BASECAMP_PIECE_NAME]: [
    "projects",
    "todos",
    "messages",
    "cards",
    "comments",
    "documents",
    "files",
    "people",
    "reports",
    "admin",
    "schedule",
  ],
  "@activepieces/piece-slack": ["send_message_to_a_channel", "send_message"],
  "@activepieces/piece-gmail": ["send_email"],
  "@activepieces/piece-google-sheets": ["append_values", "update_values"],
};

const BASECAMP_ACTION_BY_RESOURCE: Record<string, string> = {
  project: "projects",
  todo: "todos",
  todolist: "todos",
  message: "messages",
  card: "cards",
  comment: "comments",
  document: "documents",
  file: "files",
  person: "people",
  report: "reports",
  admin: "admin",
  schedule: "schedule",
};

const BASECAMP_OPERATION_BY_RESOURCE: Record<string, Record<string, string>> = {
  project: {
    getAll: "list_projects",
    get: "get_project",
    findByName: "find_project",
    create: "create_project",
    update: "update_project",
    trash: "trash_project",
  },
  todolist: {
    getAll: "list_todolists",
    get: "get_todolist",
    create: "create_todolist",
    update: "update_todolist",
  },
  todo: {
    getAll: "list_todos_for_list",
    get: "get_todo",
    create: "create_todo",
    update: "update_todo_details",
    complete: "complete_todo",
    uncomplete: "uncomplete_todo",
  },
  message: {
    getAll: "list_messages",
    get: "get_message",
    create: "create_message",
    update: "update_message",
  },
};

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

function maybeParseJsonObject(value: unknown): JsonObject | null {
  const objectValue = toObject(value);
  if (objectValue) {
    return objectValue;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return toObject(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

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

function isNonEmptyObject(value: unknown): value is JsonObject {
  const obj = toObject(value);
  return Boolean(obj) && Object.keys(obj).length > 0;
}

function hasCompatGraphDefinition(
  value: Pick<N8nWorkflow, "nodes" | "connections"> | Partial<N8nWorkflow>,
): boolean {
  return Array.isArray(value.nodes) || isNonEmptyObject(value.connections);
}

function parseCompatGraphNodes(rawNodes: unknown): CompatGraphNode[] {
  const rows = Array.isArray(rawNodes) ? rawNodes : [];
  const parsed = rows
    .map((row, index) => {
      const obj = toObject(row);
      if (!obj) {
        return null;
      }
      const id = readId(obj.id) ?? `node_${index + 1}`;
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
        parameters: toObject(obj.parameters) ?? {},
        credentials: toObject(obj.credentials),
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
    const nextKey =
      connectionMap.get(current.displayName) ??
      connectionMap.get(current.id) ??
      connectionMap.get(current.stepName);
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
    return role === "trigger" ? ACTIVEPIECES_WEBHOOK_PIECE_NAME : null;
  }
  if (value.startsWith("@activepieces/piece-")) {
    return value;
  }

  const lowered = value.toLowerCase();
  if (role === "trigger") {
    if (lowered.includes("basecamp")) return ACTIVEPIECES_BASECAMP_PIECE_NAME;
    if (lowered.includes("schedule") || lowered.includes("cron")) {
      return ACTIVEPIECES_SCHEDULE_PIECE_NAME;
    }
    if (lowered.includes("manual")) {
      return ACTIVEPIECES_MANUAL_TRIGGER_PIECE_NAME;
    }
    return ACTIVEPIECES_WEBHOOK_PIECE_NAME;
  }

  if (lowered.includes("basecamp")) return ACTIVEPIECES_BASECAMP_PIECE_NAME;
  if (lowered.includes("slack")) return "@activepieces/piece-slack";
  if (lowered.includes("gmail") || lowered.includes("email")) return "@activepieces/piece-gmail";
  if (lowered.includes("google") && lowered.includes("sheet")) return "@activepieces/piece-google-sheets";
  if (lowered.includes("notion")) return "@activepieces/piece-notion";
  if (lowered.includes("discord")) return "@activepieces/piece-discord";
  if (lowered.includes("telegram")) return "@activepieces/piece-telegram";
  if (lowered.includes("airtable")) return "@activepieces/piece-airtable";
  if (lowered.includes("http")) return ACTIVEPIECES_HTTP_PIECE_NAME;
  if (lowered.includes("webhook")) return ACTIVEPIECES_WEBHOOK_PIECE_NAME;
  if (
    lowered.includes("code") ||
    lowered.includes("set") ||
    lowered.includes(".if") ||
    lowered.includes("switch") ||
    lowered.includes("merge") ||
    lowered.includes("filter")
  ) {
    return null;
  }
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

function buildConnectionExpression(externalId: string): string {
  return `{{connections['${externalId}']}}`;
}

function rewriteCompatExpressionBody(
  expression: string,
  context: CompatExpressionContext,
): string {
  return expression
    .replace(/\$input\.item\.json\b/g, context.upstreamStepName)
    .replace(/\$json\b/g, context.upstreamStepName)
    .replace(/\$node\s*\[\s*["']([^"']+)["']\s*\]\.json\b/g, (_match, rawName: string) => {
      const resolved = context.stepNamesByRef.get(String(rawName).trim());
      return resolved ?? sanitizeStepName(String(rawName), "action", 0);
    })
    .replace(/\$node\s*\[\s*["']([^"']+)["']\s*\]\b/g, (_match, rawName: string) => {
      const resolved = context.stepNamesByRef.get(String(rawName).trim());
      return resolved ?? sanitizeStepName(String(rawName), "action", 0);
    });
}

function normalizeCompatExpressionString(
  value: string,
  context: CompatExpressionContext,
): string {
  if (!value.includes("{{")) {
    return value;
  }

  return value.replace(/=?\{\{\s*([\s\S]*?)\s*\}\}/g, (full, body: string) => {
    const expression = String(body).trim();
    if (!/\$json\b|\$node\b|\$input\.item\.json\b/.test(expression)) {
      return full;
    }
    return `{{${rewriteCompatExpressionBody(expression, context)}}}`;
  });
}

function normalizeCompatValue(
  value: unknown,
  context: CompatExpressionContext,
): unknown {
  if (typeof value === "string") {
    return normalizeCompatExpressionString(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCompatValue(entry, context));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = normalizeCompatValue(entry, context);
  }
  return out;
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
        credentials: toObject(obj?.credentials) ?? undefined,
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
    null;

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
  const tokenCache = userTokenCache.get(workspaceId);
  if (tokenCache?.projectId) {
    ctx.projectId = tokenCache.projectId;
    return tokenCache.projectId;
  }

  try {
    const signedIn = await signInWithWorkspaceUser(workspaceId, ctx);
    if (signedIn?.projectId) {
      ctx.projectId = signedIn.projectId;
      return signedIn.projectId;
    }
  } catch {
    // Fall through to connector/global configuration fallback below.
  }

  if (ctx.userEmail && ctx.userPassword) {
    try {
      const projects = await requestJson({
        workspaceId,
        ctx: { ...ctx, projectId: null },
        endpoint: "projects",
      });
      const obj = toObject(projects);
      const rows = toArrayObjects(obj?.data ?? projects);
      const first = rows[0];
      const projectId = readId(first?.id);
      if (projectId) {
        ctx.projectId = projectId;
        return projectId;
      }
    } catch {
      // Fall through to connector/global configuration fallback below.
    }
  }

  if (ctx.projectId) {
    return ctx.projectId;
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

function getWorkflowTriggerNode(
  workflow: Pick<N8nWorkflow, "nodes"> | null | undefined,
): N8nWorkflow["nodes"][number] | null {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  if (nodes.length === 0) {
    return null;
  }
  return nodes[0] ?? null;
}

function getActivepiecesExecutionMode(
  workflow: Pick<N8nWorkflow, "nodes"> | null | undefined,
): ActivepiecesExecutionMode {
  const trigger = getWorkflowTriggerNode(workflow);
  const type = String(trigger?.type ?? "").trim().toLowerCase();
  if (!type) {
    return "test";
  }
  if (type.includes("manual")) {
    return "manual";
  }
  return "test";
}

function createActivepiecesSocket(params: {
  baseUrl: string;
  token: string;
  projectId: string;
}): Socket {
  return io(params.baseUrl, {
    transports: ["websocket"],
    path: ACTIVEPIECES_SOCKET_PATH,
    autoConnect: false,
    reconnection: false,
    auth: {
      token: params.token,
      projectId: params.projectId,
    },
  });
}

async function connectActivepiecesSocket(socket: Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.off("error", onSocketError);
      fn();
    };
    const onConnect = () => finish(() => resolve());
    const onConnectError = (err: unknown) =>
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    const onSocketError = (err: unknown) =>
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    const timer = setTimeout(() => {
      finish(() => reject(new Error("Timed out connecting to workflow engine socket.")));
    }, ACTIVEPIECES_SOCKET_TIMEOUT_MS);

    socket.once("connect", onConnect);
    socket.once("connect_error", onConnectError);
    socket.once("error", onSocketError);
    socket.connect();
  });
}

async function waitForActivepiecesRunStarted(params: {
  socket: Socket;
  flowVersionId: string;
  event: string;
}): Promise<JsonObject> {
  return await new Promise<JsonObject>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      params.socket.off(params.event, onRunStarted);
      params.socket.off("error", onSocketError);
      fn();
    };
    const onRunStarted = (run: unknown) => {
      const obj = toObject(run);
      if (!obj) {
        return;
      }
      const versionId = readId(obj.flowVersionId);
      if (versionId && versionId !== params.flowVersionId) {
        return;
      }
      finish(() => resolve(obj));
    };
    const onSocketError = (err: unknown) =>
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    const timer = setTimeout(() => {
      finish(() => reject(new Error("Timed out waiting for workflow engine run start event.")));
    }, ACTIVEPIECES_SOCKET_TIMEOUT_MS);

    params.socket.on(params.event, onRunStarted);
    params.socket.once("error", onSocketError);
  });
}

async function executeWorkflowViaSocketRun(params: {
  workspaceId: string;
  ctx: ActivepiecesContext;
  flowVersionId: string;
  mode: ActivepiecesExecutionMode;
}): Promise<{ executionId?: string; error?: string }> {
  const signedIn = await signInWithWorkspaceUser(params.workspaceId, params.ctx);
  if (!signedIn?.token) {
    return {
      error:
        "Workflow execution needs workspace user credentials. Configure ops.user.email and ops.user.password in Integrations first.",
    };
  }

  const projectId = await resolveProjectId(params.workspaceId, params.ctx);
  const socket = createActivepiecesSocket({
    baseUrl: params.ctx.baseUrl,
    token: signedIn.token,
    projectId,
  });

  try {
    await connectActivepiecesSocket(socket);
    const waitForRun = waitForActivepiecesRunStarted({
      socket,
      flowVersionId: params.flowVersionId,
      event:
        params.mode === "manual"
          ? ACTIVEPIECES_SOCKET_CLIENT_EVENT_MANUAL_TRIGGER_RUN_STARTED
          : ACTIVEPIECES_SOCKET_CLIENT_EVENT_TEST_FLOW_RUN_STARTED,
    });
    socket.emit(
      params.mode === "manual"
        ? ACTIVEPIECES_SOCKET_SERVER_EVENT_MANUAL_TRIGGER_RUN_STARTED
        : ACTIVEPIECES_SOCKET_SERVER_EVENT_TEST_FLOW_RUN,
      {
      flowVersionId: params.flowVersionId,
      },
    );
    const started = await waitForRun;
    return { executionId: readId(started.id) ?? undefined };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    socket.disconnect();
  }
}

async function listAppConnectionsRaw(
  workspaceId: string,
  ctx: ActivepiecesContext,
  projectId: string,
): Promise<ActivepiecesConnectionSummary[]> {
  const raw = await requestJson({
    workspaceId,
    ctx,
    endpoint: `app-connections?projectId=${encodeURIComponent(projectId)}&limit=200`,
  });
  const rows = toArrayObjects(toObject(raw)?.data);
  return rows.map((row) => ({
    id: readId(row.id) ?? "",
    externalId: readString(row.externalId) ?? "",
    displayName:
      readString(row.displayName) ??
      readString(row.name) ??
      readString(row.externalId) ??
      "Unnamed Connection",
    pieceName: readString(row.pieceName) ?? readString(row.type) ?? "",
  }));
}

function findConnectionByHint(
  connections: ActivepiecesConnectionSummary[],
  hint: { id?: string | null; name?: string | null; pieceName?: string | null },
): ActivepiecesConnectionSummary | null {
  const normalizedId = String(hint.id ?? "").trim();
  const normalizedName = String(hint.name ?? "").trim().toLowerCase();
  const normalizedPiece = String(hint.pieceName ?? "").trim().toLowerCase();
  for (const connection of connections) {
    if (normalizedId && (connection.id === normalizedId || connection.externalId === normalizedId)) {
      return connection;
    }
    if (
      normalizedName &&
      (connection.displayName.trim().toLowerCase() === normalizedName ||
        connection.externalId.trim().toLowerCase() === normalizedName)
    ) {
      return connection;
    }
    if (
      normalizedPiece &&
      connection.pieceName.trim().toLowerCase() === normalizedPiece &&
      (!normalizedName || connection.displayName.trim().toLowerCase().includes(normalizedName))
    ) {
      return connection;
    }
  }
  return null;
}

function resolveCredentialHint(
  credentials: JsonObject | null | undefined,
  key?: string,
): { id?: string | null; name?: string | null } | null {
  if (!credentials) {
    return null;
  }
  const candidateKeys = key ? [key, ...Object.keys(credentials)] : Object.keys(credentials);
  for (const credentialKey of candidateKeys) {
    const value = toObject(credentials[credentialKey]);
    if (!value) {
      continue;
    }
    const id = readId(value.id);
    const name = readString(value.name);
    if (id || name) {
      return { id, name };
    }
  }
  return null;
}

function resolveNodeConnectionExternalId(
  node: CompatGraphNode,
  pieceName: string,
  connections: ActivepiecesConnectionSummary[],
): string | null {
  if (isBasecampPieceName(pieceName)) {
    const hint = resolveCredentialHint(node.credentials, "basecampApi");
    const match = findConnectionByHint(connections, {
      id: hint?.id ?? null,
      name: hint?.name ?? "basecamp",
      pieceName,
    });
    return match?.externalId ?? ACTIVEPIECES_BASECAMP_EXTERNAL_ID;
  }

  const hint = resolveCredentialHint(node.credentials);
  if (!hint) {
    return null;
  }
  const match = findConnectionByHint(connections, {
    id: hint.id ?? null,
    name: hint.name ?? null,
    pieceName,
  });
  return match?.externalId ?? null;
}

function resolveScheduleCronExpression(parameters: JsonObject): string {
  const direct =
    readString(parameters.cronExpression) ??
    readString(toObject(parameters.rule)?.cronExpression) ??
    readString(toObject(parameters.triggerTimes)?.cronExpression);
  if (direct) {
    return direct;
  }
  const firstInterval = Array.isArray(toObject(parameters.rule)?.interval)
    ? (toObject(parameters.rule)?.interval as unknown[])[0]
    : null;
  const interval = toObject(firstInterval);
  const field = readString(interval?.field)?.toLowerCase();
  if (field === "minutes") {
    const value = Number(interval?.minutesInterval);
    if (Number.isFinite(value) && value > 0) {
      return `*/${Math.trunc(value)} * * * *`;
    }
  }
  if (field === "hours") {
    const value = Number(interval?.hoursInterval);
    if (Number.isFinite(value) && value === 24) {
      return "0 0 * * *";
    }
    if (Number.isFinite(value) && value > 0) {
      return `0 */${Math.trunc(value)} * * *`;
    }
  }
  return "0 * * * *";
}

async function loadPieceDescriptor(params: {
  workspaceId: string;
  ctx: ActivepiecesContext;
  projectId: string;
  pieceName: string;
  cache: Map<string, PieceDescriptor | null>;
}): Promise<PieceDescriptor | null> {
  const cached = params.cache.get(params.pieceName);
  if (cached !== undefined) {
    return cached;
  }

  const payload = await requestJson({
    workspaceId: params.workspaceId,
    ctx: params.ctx,
    endpoint: `pieces/${encodeURIComponent(params.pieceName)}?projectId=${encodeURIComponent(params.projectId)}`,
  }).catch(() => null);
  const obj = toObject(payload) ?? {};
  const piece = toObject(obj.piece) ?? obj;
  const descriptor: PieceDescriptor = {
    name: readString(piece.name) ?? params.pieceName,
    version: readString(piece.version) ?? PIECE_VERSION_FALLBACK[params.pieceName] ?? "0.1.0",
    triggerNames: Object.keys(toObject(piece.triggers) ?? {}),
    actionNames: Object.keys(toObject(piece.actions) ?? {}),
  };
  params.cache.set(params.pieceName, descriptor);
  return descriptor;
}

function createCodeActionStep(
  node: CompatGraphNode,
  nextAction?: Record<string, unknown>,
): Record<string, unknown> {
  const jsCode =
    readString(node.parameters.jsCode) ??
    readString(node.parameters.javascriptCode) ??
    readString(node.parameters.code) ??
    "export const code = async (inputs) => inputs;";
  const action: Record<string, unknown> = {
    name: node.stepName,
    valid: true,
    displayName: node.displayName,
    type: "CODE",
    settings: {
      input: {},
      sourceCode: {
        packageJson: "{}",
        code: jsCode.includes("export const code") ? jsCode : `export const code = async (inputs) => {\n${jsCode}\n};`,
      },
    },
  };
  if (nextAction) {
    action.nextAction = nextAction;
  }
  return action;
}

function createWebhookReturnResponseAction(
  node: CompatGraphNode,
  nextAction?: Record<string, unknown>,
): Record<string, unknown> {
  const responseBody =
    maybeParseJsonObject(node.parameters.responseBodyJson) ??
    maybeParseJsonObject(node.parameters.body) ??
    maybeParseJsonObject(node.parameters.responseBody) ??
    { ok: true };
  const statusCode = Number(node.parameters.statusCode);
  const action: Record<string, unknown> = {
    name: node.stepName,
    valid: true,
    displayName: node.displayName,
    type: "PIECE",
    settings: {
      pieceName: ACTIVEPIECES_WEBHOOK_PIECE_NAME,
      pieceVersion: PIECE_VERSION_FALLBACK[ACTIVEPIECES_WEBHOOK_PIECE_NAME],
      actionName: "return_response",
      input: {
        responseType: "json",
        respond: "stop",
        fields: {
          status: Number.isFinite(statusCode) && statusCode > 0 ? statusCode : 200,
          headers: maybeParseJsonObject(node.parameters.headers) ?? {},
          body: responseBody,
        },
      },
      propertySettings: {},
    },
  };
  if (nextAction) {
    action.nextAction = nextAction;
  }
  return action;
}

function createHttpActionStep(
  node: CompatGraphNode,
  nextAction?: Record<string, unknown>,
): Record<string, unknown> {
  const headers = maybeParseJsonObject(node.parameters.headers) ?? {};
  const queryParams = maybeParseJsonObject(node.parameters.queryParameters) ?? {};
  const body = maybeParseJsonObject(node.parameters.body) ?? maybeParseJsonObject(node.parameters.jsonBody);
  const action: Record<string, unknown> = {
    name: node.stepName,
    valid: true,
    displayName: node.displayName,
    type: "PIECE",
    settings: {
      pieceName: ACTIVEPIECES_HTTP_PIECE_NAME,
      pieceVersion: PIECE_VERSION_FALLBACK[ACTIVEPIECES_HTTP_PIECE_NAME],
      actionName: "send_request",
      input: {
        method: readString(node.parameters.method) ?? "GET",
        url: readString(node.parameters.url) ?? "",
        headers,
        queryParams,
        authType: "NONE",
        authFields: {},
        body_type: body ? "json" : "none",
        body: body ?? {},
      },
      propertySettings: {},
    },
  };
  if (nextAction) {
    action.nextAction = nextAction;
  }
  return action;
}

function createBasecampActionStep(
  node: CompatGraphNode,
  connectionExternalId: string | null,
  nextAction?: Record<string, unknown>,
): Record<string, unknown> | null {
  const resource = readString(node.parameters.resource)?.toLowerCase() ?? "project";
  const operation = readString(node.parameters.operation) ?? "getAll";
  const actionName = BASECAMP_ACTION_BY_RESOURCE[resource];
  const mappedOperation = BASECAMP_OPERATION_BY_RESOURCE[resource]?.[operation];
  if (!actionName || !mappedOperation) {
    return null;
  }

  const input: JsonObject = {
    operation: mappedOperation,
  };
  if (connectionExternalId) {
    input.auth = buildConnectionExpression(connectionExternalId);
  }

  const project =
    readString(node.parameters.projectId) ??
    readString(node.parameters.project) ??
    undefined;
  if (project && operation !== "findByName") {
    input.project = project;
  }

  const inputs: JsonObject = {};
  switch (resource) {
    case "project":
      if (mappedOperation === "list_projects") {
        inputs.archived = Boolean(node.parameters.includeArchived);
      } else if (mappedOperation === "find_project") {
        inputs.name =
          readString(node.parameters.projectName) ??
          readString(node.parameters.name) ??
          "";
      } else if (mappedOperation === "create_project") {
        inputs.body = {
          ...(maybeParseJsonObject(node.parameters.body) ?? {}),
          ...(readString(node.parameters.name) ? { name: readString(node.parameters.name) } : {}),
          ...(readString(node.parameters.description)
            ? { description: readString(node.parameters.description) }
            : {}),
        };
      } else if (mappedOperation === "update_project") {
        inputs.project_id = readString(node.parameters.projectId) ?? undefined;
        inputs.body = {
          ...(maybeParseJsonObject(node.parameters.body) ?? {}),
          ...(readString(node.parameters.name) ? { name: readString(node.parameters.name) } : {}),
          ...(readString(node.parameters.description)
            ? { description: readString(node.parameters.description) }
            : {}),
        };
      } else if (mappedOperation === "trash_project") {
        inputs.project_id = readString(node.parameters.projectId) ?? undefined;
      }
      break;
    case "todolist":
      if (readString(node.parameters.todolistId)) {
        input.todolist = readString(node.parameters.todolistId);
      }
      if (mappedOperation === "create_todolist" || mappedOperation === "update_todolist") {
        const title = readString(node.parameters.todolistTitle) ?? readString(node.parameters.name);
        inputs.body = {
          ...(maybeParseJsonObject(node.parameters.todolistBodyJson) ?? {}),
          ...(title ? { title } : {}),
        };
        if (mappedOperation === "update_todolist") {
          inputs.todolist_id = readString(node.parameters.todolistId) ?? undefined;
        }
        if (title) {
          inputs.name = title;
        }
      } else if (mappedOperation === "get_todolist") {
        inputs.todolist_id = readString(node.parameters.todolistId) ?? undefined;
      }
      break;
    case "todo":
      if (readString(node.parameters.todolistId)) {
        input.todolist = readString(node.parameters.todolistId);
      }
      if (mappedOperation === "get_todo" || mappedOperation === "complete_todo" || mappedOperation === "uncomplete_todo") {
        inputs.todo_id = readString(node.parameters.todoId) ?? undefined;
      } else if (mappedOperation === "create_todo") {
        inputs.task =
          readString(node.parameters.task) ??
          readString(node.parameters.content) ??
          readString(node.parameters.name) ??
          "";
        if (readString(node.parameters.description)) inputs.description = readString(node.parameters.description);
        if (readString(node.parameters.dueOn)) inputs.due_on = readString(node.parameters.dueOn);
      } else if (mappedOperation === "update_todo_details") {
        inputs.todo_id = readString(node.parameters.todoId) ?? undefined;
        if (readString(node.parameters.content)) inputs.content = readString(node.parameters.content);
        if (readString(node.parameters.description)) inputs.description = readString(node.parameters.description);
        if (readString(node.parameters.dueOn)) inputs.due_on = readString(node.parameters.dueOn);
      }
      break;
    case "message":
      if (readString(node.parameters.messageBoardId)) {
        input.board = readString(node.parameters.messageBoardId);
      }
      if (mappedOperation === "get_message" || mappedOperation === "update_message") {
        inputs.message_id = readString(node.parameters.messageId) ?? undefined;
      }
      if (mappedOperation === "create_message" || mappedOperation === "update_message") {
        if (readString(node.parameters.subject)) inputs.subject = readString(node.parameters.subject);
        if (readString(node.parameters.content)) inputs.content = readString(node.parameters.content);
        const body = maybeParseJsonObject(node.parameters.body) ?? {};
        if (Object.keys(body).length > 0) {
          inputs.body = body;
        }
      }
      break;
    default:
      break;
  }

  if (Object.keys(inputs).length > 0) {
    input.inputs = inputs;
  }

  const action: Record<string, unknown> = {
    name: node.stepName,
    valid: true,
    displayName: node.displayName,
    type: "PIECE",
    settings: {
      pieceName: ACTIVEPIECES_BASECAMP_PIECE_NAME,
      pieceVersion: PIECE_VERSION_FALLBACK[ACTIVEPIECES_BASECAMP_PIECE_NAME],
      actionName,
      input,
      propertySettings: {},
    },
  };
  if (nextAction) {
    action.nextAction = nextAction;
  }
  return action;
}

async function buildTriggerStep(params: {
  workspaceId: string;
  ctx: ActivepiecesContext;
  projectId: string;
  triggerNode: CompatGraphNode;
  nextAction?: Record<string, unknown>;
  connections: ActivepiecesConnectionSummary[];
  cache: Map<string, PieceDescriptor | null>;
}): Promise<Record<string, unknown>> {
  const rawTypeLower = (params.triggerNode.rawType || "").toLowerCase();
  let pieceName =
    inferPieceName(params.triggerNode.pieceHint ?? params.triggerNode.rawType, "trigger") ??
    ACTIVEPIECES_WEBHOOK_PIECE_NAME;
  let triggerName = "catch_webhook";
  let input: JsonObject = {};

  if (pieceName === ACTIVEPIECES_SCHEDULE_PIECE_NAME) {
    triggerName = "cron_expression";
    input = {
      cronExpression: resolveScheduleCronExpression(params.triggerNode.parameters),
      timezone: DEFAULT_SCHEDULE_TIMEZONE,
    };
  } else if (pieceName === ACTIVEPIECES_MANUAL_TRIGGER_PIECE_NAME) {
    triggerName = "manual_trigger";
  } else if (pieceName === ACTIVEPIECES_BASECAMP_PIECE_NAME && rawTypeLower.includes("trigger")) {
    triggerName = "new_todo";
    const projectId = readString(params.triggerNode.parameters.projectId) ?? readString(params.triggerNode.parameters.project);
    const connectionExternalId = resolveNodeConnectionExternalId(
      params.triggerNode,
      pieceName,
      params.connections,
    );
    if (connectionExternalId) {
      input.auth = buildConnectionExpression(connectionExternalId);
    }
    if (projectId) {
      input.project = projectId;
    }
  } else {
    pieceName = ACTIVEPIECES_WEBHOOK_PIECE_NAME;
    triggerName = "catch_webhook";
    input = {
      authType: "none",
      authFields: {},
    };
  }

  const descriptor = await loadPieceDescriptor({
    workspaceId: params.workspaceId,
    ctx: params.ctx,
    projectId: params.projectId,
    pieceName,
    cache: params.cache,
  });
  triggerName =
    pickPreferredName(descriptor?.triggerNames ?? [], TRIGGER_PREFERENCE_BY_PIECE[pieceName] ?? [triggerName]) ??
    triggerName;

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
      input,
    },
  };
  if (params.nextAction) {
    trigger.nextAction = params.nextAction;
  }
  return trigger;
}

async function buildActionStep(params: {
  workspaceId: string;
  ctx: ActivepiecesContext;
  projectId: string;
  node: CompatGraphNode;
  expressionContext: CompatExpressionContext;
  nextAction?: Record<string, unknown>;
  connections: ActivepiecesConnectionSummary[];
  cache: Map<string, PieceDescriptor | null>;
}): Promise<Record<string, unknown>> {
  const rawTypeLower = (params.node.rawType || "").toLowerCase();
  const pieceName = inferPieceName(params.node.pieceHint ?? params.node.rawType, "action");
  if (!pieceName) {
    return createCodeActionStep(params.node, params.nextAction);
  }

  const normalizedNode: CompatGraphNode = {
    ...params.node,
    parameters: (normalizeCompatValue(
      params.node.parameters,
      params.expressionContext,
    ) as JsonObject | null) ?? {},
  };

  if (pieceName === ACTIVEPIECES_BASECAMP_PIECE_NAME) {
    const step = createBasecampActionStep(
      normalizedNode,
      resolveNodeConnectionExternalId(normalizedNode, pieceName, params.connections),
      params.nextAction,
    );
    if (step) {
      return step;
    }
  }

  if (pieceName === ACTIVEPIECES_WEBHOOK_PIECE_NAME && rawTypeLower.includes("respond")) {
    return createWebhookReturnResponseAction(normalizedNode, params.nextAction);
  }

  if (pieceName === ACTIVEPIECES_HTTP_PIECE_NAME) {
    return createHttpActionStep(normalizedNode, params.nextAction);
  }

  if (
    rawTypeLower.includes("code") ||
    rawTypeLower.includes("set") ||
    rawTypeLower.includes(".if") ||
    rawTypeLower.includes("switch") ||
    rawTypeLower.includes("merge") ||
    rawTypeLower.includes("filter")
  ) {
    return createCodeActionStep(params.node, params.nextAction);
  }

  const descriptor = await loadPieceDescriptor({
    workspaceId: params.workspaceId,
    ctx: params.ctx,
    projectId: params.projectId,
    pieceName,
    cache: params.cache,
  });
  const actionName = pickPreferredName(
    descriptor?.actionNames ?? [],
    ACTION_PREFERENCE_BY_PIECE[pieceName] ?? [],
  );
  if (!actionName) {
    return createCodeActionStep(params.node, params.nextAction);
  }

  const input: JsonObject = {};
  const connectionExternalId = resolveNodeConnectionExternalId(normalizedNode, pieceName, params.connections);
  if (connectionExternalId) {
    input.auth = buildConnectionExpression(connectionExternalId);
  }
  const action: Record<string, unknown> = {
    name: normalizedNode.stepName,
    valid: true,
    displayName: normalizedNode.displayName,
    type: "PIECE",
    settings: {
      propertySettings: {},
      pieceName,
      pieceVersion: descriptor?.version ?? PIECE_VERSION_FALLBACK[pieceName] ?? "0.1.0",
      actionName,
      input,
    },
  };
  if (params.nextAction) {
    action.nextAction = params.nextAction;
  }
  return action;
}

async function applyCompatGraphToFlow(params: {
  workspaceId: string;
  ctx: ActivepiecesContext;
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
  const stepNamesByRef = new Map<string, string>();
  for (const node of nodes) {
    stepNamesByRef.set(node.id, node.stepName);
    stepNamesByRef.set(node.displayName, node.stepName);
    stepNamesByRef.set(node.stepName, node.stepName);
  }
  const connections = await listAppConnectionsRaw(params.workspaceId, params.ctx, params.projectId).catch(
    () => [],
  );
  const cache = new Map<string, PieceDescriptor | null>();
  let nextAction: Record<string, unknown> | undefined;
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    nextAction = await buildActionStep({
      workspaceId: params.workspaceId,
      ctx: params.ctx,
      projectId: params.projectId,
      node: actions[index],
      expressionContext: {
        upstreamStepName: index === 0 ? FLOW_TRIGGER_NAME : actions[index - 1].stepName,
        stepNamesByRef,
      },
      nextAction,
      connections,
      cache,
    });
  }

  const triggerStep = await buildTriggerStep({
    workspaceId: params.workspaceId,
    ctx: params.ctx,
    projectId: params.projectId,
    triggerNode: trigger,
    nextAction,
    connections,
    cache,
  });

  await requestJson({
    workspaceId: params.workspaceId,
    ctx: params.ctx,
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

    if (hasCompatGraphDefinition(workflow)) {
      await applyCompatGraphToFlow({
        workspaceId,
        ctx,
        projectId,
        workflowId,
        displayName: workflow.name,
        rawNodes: workflow.nodes,
        rawConnections: workflow.connections,
      });
    }

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

    if (hasCompatGraphDefinition(updates)) {
      const projectId = await resolveProjectId(workspaceId, ctx);
      const currentFlow = await requestJson({
        workspaceId,
        ctx,
        endpoint: `flows/${encodeURIComponent(workflowId)}`,
      });
      const currentName =
        readString(toObject(currentFlow)?.displayName) ??
        readString(toObject(currentFlow)?.name) ??
        workflowId;
      await applyCompatGraphToFlow({
        workspaceId,
        ctx,
        projectId,
        workflowId,
        displayName: typeof updates.name === "string" && updates.name.trim() ? updates.name.trim() : currentName,
        rawNodes: updates.nodes,
        rawConnections: updates.connections,
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

    const workflowResult = await getN8nWorkflow(workspaceId, workflowId);
    const workflow = workflowResult.ok ? workflowResult.workflow ?? null : null;
    const executionMode = getActivepiecesExecutionMode(workflow);

    if (workflow?.versionId) {
      const socketExecution = await executeWorkflowViaSocketRun({
        workspaceId,
        ctx,
        flowVersionId: workflow.versionId,
        mode: executionMode,
      });
      if (socketExecution.executionId) {
        return { ok: true, executionId: socketExecution.executionId };
      }
      if (!socketExecution.error) {
        return { ok: true };
      }
      const projectId = await resolveProjectId(workspaceId, ctx);
      const latestRuns = await requestJson({
        workspaceId,
        ctx,
        endpoint: `flow-runs?projectId=${encodeURIComponent(projectId)}&flowId=${encodeURIComponent(workflowId)}&limit=1`,
      }).catch(() => null);
      const latestObj = toObject(latestRuns);
      const first = toArrayObjects(latestObj?.data)[0];
      const executionId = readId(first?.id) ?? undefined;
      if (executionId) {
        return { ok: true, executionId };
      }
      return { ok: false, error: socketExecution.error };
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
    if (isBasecampPieceName(pieceName)) {
      return {
        type: "CUSTOM_AUTH",
        props: {
          api_key: apiKey,
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
  bcgptApiKey: string,
): Promise<{ ok: boolean; credentialId?: string; error?: string }> {
  return createN8nCredential(workspaceId, "Basecamp", ACTIVEPIECES_BASECAMP_PIECE_NAME, {
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

export const __test = {
  hasCompatGraphDefinition,
  parseCompatGraphNodes,
  parseCompatConnections,
  orderCompatActionNodes,
  inferPieceName,
  resolveScheduleCronExpression,
  createBasecampActionStep,
  normalizeCompatExpressionString,
};

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
