import type { GatewayClient, GatewayRequestHandlers } from "./types.js";
import { loadConfig, writeConfigFile, type OpenClawConfig } from "../../config/config.js";
import { redactConfigObject, restoreRedactedValues } from "../../config/redact-snapshot.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import { filterByWorkspace, requireWorkspaceId, isSuperAdmin } from "../workspace-context.js";
import { buildFigmaRestAuditReport, parseFigmaFileKey } from "../figma-rest-audit.js";
import {
  buildWorkspaceFigmaMcpFailurePayload,
  callWorkspaceFigmaMcpServiceTool,
  listWorkspaceFigmaMcpServiceTools,
  normalizeFigmaMcpToolListResult,
  normalizeFigmaMcpToolName,
  probeWorkspaceFigmaMcpServiceStatus,
} from "../figma-mcp-service.js";
import {
  inferDirectBasecampChatShortcut,
  type DirectBasecampChatShortcut,
} from "../basecamp-chat-shortcuts.js";
import type { ChatToolDefinition } from "../workflow-ai.js";
import { inspectWorkspaceChatUrls } from "../url-routing.js";
import { emitAgentEvent, registerAgentRunContext } from "../../infra/agent-events.js";
import fs from "node:fs/promises";
import path from "node:path";

type ConnectorResult = {
  url: string | null;
  projectId?: string | null;
  configured: boolean;
  reachable: boolean | null;
  authOk: boolean | null;
  error: string | null;
  flagsUrl?: string | null;
  authUrl?: string | null;
  healthUrl?: string | null;
  mcpUrl?: string | null;
  editorUrl?: string | null;
  mode?: "embedded" | "remote";
  vendoredRepo?: string | null;
  identity?: {
    connected: boolean;
    basecampConnected?: boolean;
    name?: string | null;
    email?: string | null;
    handle?: string | null;
    activeConnectionId?: string | null;
    activeConnectionName?: string | null;
    activeTeamId?: string | null;
    lastSyncedAt?: string | null;
    selectedFileUrl?: string | null;
    selectedFileId?: string | null;
    selectedFileName?: string | null;
    updatedAt?: string | null;
    selectedAccountId?: string | null;
    accountsCount?: number;
    totalConnections?: number;
    message?: string | null;
  };
  mcp?: {
    url: string | null;
    configured: boolean;
    reachable: boolean | null;
    authOk: boolean | null;
    authRequired?: boolean;
    configPath?: string | null;
    transport?: string | null;
    source?: string | null;
    hasPersonalAccessToken?: boolean;
    fallbackAvailable?: boolean;
    authCommand?: string | null;
    error: string | null;
  };
};

async function fetchJson(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; json: unknown | null; error: string | null }> {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        ...(opts.headers ?? {}),
        // Always request JSON; caller may override content-type.
        accept: "application/json",
      },
    });
    const text = await res.text().catch(() => "");
    const json = (() => {
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    })();
    return { ok: res.ok, status: res.status, json, error: res.ok ? null : text || res.statusText };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, json: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBaseUrl(raw: unknown, fallback: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  const normalized = value || fallback;
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function readConfigString(cfg: unknown, path: string[]): string | null {
  let cur: unknown = cfg;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
      return null;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  if (typeof cur !== "string") {
    return null;
  }
  const trimmed = cur.trim();
  return trimmed ? trimmed : null;
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function isReachableStatus(code: number): boolean {
  // 401/403/404 still prove the upstream is alive.
  return code === 401 || code === 403 || code === 404;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function deepMergeJson(base: unknown, patch: unknown): unknown {
  if (!isJsonObject(base) || !isJsonObject(patch)) {
    return patch;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = deepMergeJson(out[key], value);
  }
  return out;
}

function sanitizeWorkspaceConfigResponse(
  client: GatewayClient | null | undefined,
  cfg: unknown,
  opts?: {
    filterAgents?: boolean;
    workspaceConfig?: unknown;
    filterSharedProvidersOnly?: boolean;
    stripInheritedWorkspaceClones?: boolean;
  },
): Record<string, unknown> {
  let candidate = cfg;
  if (opts?.stripInheritedWorkspaceClones && client && !isSuperAdmin(client)) {
    candidate = stripLikelyInheritedWorkspaceOverlayClones(candidate, loadConfig());
  }
  if (opts?.filterSharedProvidersOnly && client && !isSuperAdmin(client)) {
    candidate = filterEffectiveConfigForWorkspaceUi(candidate, opts.workspaceConfig);
  }
  const redactedCandidate = redactConfigObject(candidate);
  const redacted = isJsonObject(redactedCandidate)
    ? (redactedCandidate as Record<string, unknown>)
    : {};
  if (!opts?.filterAgents || !client || isSuperAdmin(client)) {
    return redacted;
  }
  const agents = redacted.agents;
  if (!isJsonObject(agents) || !Array.isArray(agents.list)) {
    return redacted;
  }
  return {
    ...redacted,
    agents: {
      ...agents,
      list: filterByWorkspace(agents.list as Array<{ workspaceId?: string }>, client),
    },
  };
}

const PMOS_SHARED_PROVIDER_ALLOWLIST = new Set(["local-ollama", "ollama", "kilo", "ollama-cloud"]);

function deepCloneJson<T>(value: T): T {
  return value && typeof value === "object" ? (JSON.parse(JSON.stringify(value)) as T) : value;
}

function parseModelRefProvider(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;
  const provider = trimmed.slice(0, slash).trim().toLowerCase();
  return provider || null;
}

function isSharedProviderConfigEntry(entry: unknown): boolean {
  if (!isJsonObject(entry)) {
    return false;
  }
  return entry.sharedForWorkspaces === true || entry.shared === true;
}

function isSharedProviderName(name: string, providerEntry?: unknown): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  if (PMOS_SHARED_PROVIDER_ALLOWLIST.has(normalized)) return true;
  return isSharedProviderConfigEntry(providerEntry);
}

function filterEffectiveConfigForWorkspaceUi(
  effectiveCfg: unknown,
  workspaceCfg: unknown,
): unknown {
  if (!isJsonObject(effectiveCfg)) {
    return effectiveCfg;
  }
  const next = deepCloneJson(effectiveCfg) as Record<string, unknown>;
  const effectiveModels = isJsonObject(next.models) ? (next.models as Record<string, unknown>) : null;
  const effectiveProviders = effectiveModels && isJsonObject(effectiveModels.providers)
    ? (effectiveModels.providers as Record<string, unknown>)
    : null;
  const workspaceProviders = isJsonObject(workspaceCfg)
    ? getPath(workspaceCfg, ["models", "providers"])
    : undefined;
  const workspaceProvidersObj = isJsonObject(workspaceProviders)
    ? (workspaceProviders as Record<string, unknown>)
    : null;

  if (effectiveProviders) {
    const filteredProviders: Record<string, unknown> = {};
    for (const [providerName, providerValue] of Object.entries(effectiveProviders)) {
      if (
        (workspaceProvidersObj && Object.prototype.hasOwnProperty.call(workspaceProvidersObj, providerName)) ||
        isSharedProviderName(providerName, providerValue)
      ) {
        filteredProviders[providerName] = providerValue;
      }
    }
    next.models = {
      ...effectiveModels,
      providers: filteredProviders,
    };
  }

  const workspaceDefaultsModels = isJsonObject(workspaceCfg)
    ? getPath(workspaceCfg, ["agents", "defaults", "models"])
    : undefined;
  const workspaceDefaultsModelsObj = isJsonObject(workspaceDefaultsModels)
    ? (workspaceDefaultsModels as Record<string, unknown>)
    : null;
  const agents = isJsonObject(next.agents) ? (next.agents as Record<string, unknown>) : null;
  const defaults = agents && isJsonObject(agents.defaults)
    ? (agents.defaults as Record<string, unknown>)
    : null;
  if (defaults) {
    const filteredDefaults = { ...defaults } as Record<string, unknown>;
    const defaultsModels = isJsonObject(defaults.models) ? (defaults.models as Record<string, unknown>) : null;
    if (defaultsModels) {
      const keepModels: Record<string, unknown> = {};
      for (const [modelRef, modelMeta] of Object.entries(defaultsModels)) {
        const provider = parseModelRefProvider(modelRef);
        const keepBecauseWorkspace =
          workspaceDefaultsModelsObj && Object.prototype.hasOwnProperty.call(workspaceDefaultsModelsObj, modelRef);
        const keepBecauseShared =
          Boolean(provider) &&
          effectiveProviders &&
          isSharedProviderName(provider!, effectiveProviders[provider!]);
        if (keepBecauseWorkspace || keepBecauseShared) {
          keepModels[modelRef] = modelMeta;
        }
      }
      filteredDefaults.models = keepModels;
    }

    const workspacePrimary = isJsonObject(workspaceCfg)
      ? getPath(workspaceCfg, ["agents", "defaults", "model", "primary"])
      : undefined;
    const primary = getPath(defaults, ["model", "primary"]);
    const primaryProvider = parseModelRefProvider(primary);
    const sharedPrimary =
      typeof workspacePrimary === "string" && workspacePrimary.trim()
        ? workspacePrimary
        : typeof primary === "string" &&
            primary.trim() &&
            primaryProvider &&
            effectiveProviders &&
            isSharedProviderName(primaryProvider, effectiveProviders[primaryProvider])
          ? primary
          : null;
    if (sharedPrimary) {
      if (isJsonObject(filteredDefaults.model)) {
        filteredDefaults.model = {
          ...(filteredDefaults.model as Record<string, unknown>),
          primary: sharedPrimary,
        };
      } else {
        filteredDefaults.model = { primary: sharedPrimary };
      }
    } else if (isJsonObject(filteredDefaults.model)) {
      const modelObj = { ...(filteredDefaults.model as Record<string, unknown>) };
      delete modelObj.primary;
      filteredDefaults.model = modelObj;
    }

    next.agents = {
      ...agents,
      defaults: filteredDefaults,
    };
  }

  return next;
}

export const __test = {
  filterEffectiveConfigForWorkspaceUi,
  stripSensitiveUserCredentialsFromConnectors,
  isFigmaDeepContextRequest,
  shouldDeferFigmaPatAudit,
  normalizeFigmaMcpToolName,
  normalizeFigmaMcpToolListResult,
  detectChatIntents,
  filterToolDefinitionsByIntents,
  inferPreferredBasecampNamedTool,
};

/**
 * Redact workflow-engine user passwords before returning connectors to the UI.
 * Keep lightweight metadata (email + hasPassword) so users can manage
 * provisioning without exposing stored secrets.
 */
function stripSensitiveUserCredentialsFromConnectors(
  connectors: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...connectors };
  for (const connectorKey of ["ops", "activepieces"]) {
    const connector = next[connectorKey];
    if (!isJsonObject(connector) || !("user" in connector)) {
      continue;
    }
    const rawUser = (connector as Record<string, unknown>).user;
    const user = isJsonObject(rawUser) ? (rawUser as Record<string, unknown>) : null;
    const email =
      user && typeof user.email === "string" && user.email.trim() ? user.email.trim() : null;
    const hasPassword = Boolean(
      user && typeof user.password === "string" && (user.password as string).length > 0,
    );
    const { user: _user, ...connectorWithoutUser } = connector as Record<string, unknown>;
    const safeUser: Record<string, unknown> = {};
    if (email) {
      safeUser.email = email;
    }
    if (email || hasPassword) {
      safeUser.hasPassword = hasPassword;
    }
    next[connectorKey] = {
      ...connectorWithoutUser,
      ...(Object.keys(safeUser).length > 0 ? { user: safeUser } : {}),
    };
  }

  const figmaConnector = next.figma;
  if (isJsonObject(figmaConnector)) {
    const figma = { ...(figmaConnector as Record<string, unknown>) };
    const identity = isJsonObject(figma.identity)
      ? ({ ...(figma.identity as Record<string, unknown>) } as Record<string, unknown>)
      : null;
    const auth = isJsonObject(figma.auth)
      ? ({ ...(figma.auth as Record<string, unknown>) } as Record<string, unknown>)
      : null;

    if (auth) {
      const token = typeof auth.personalAccessToken === "string" ? auth.personalAccessToken.trim() : "";
      delete auth.personalAccessToken;
      delete auth.mcpOAuth;
      const hasPersonalAccessToken = auth.hasPersonalAccessToken === true || Boolean(token);
      auth.hasPersonalAccessToken = hasPersonalAccessToken;
      if (identity) {
        identity.hasPersonalAccessToken = hasPersonalAccessToken;
      }
      figma.auth = auth;
    }

    if (identity) {
      figma.identity = identity;
    }
    next.figma = figma;
  }

  return next;
}

function deepJsonEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function stripLikelyInheritedWorkspaceOverlayClones(
  workspaceCfg: unknown,
  globalCfg: unknown,
): unknown {
  if (!isJsonObject(workspaceCfg) || !isJsonObject(globalCfg)) {
    return workspaceCfg;
  }
  const next = deepCloneJson(workspaceCfg) as Record<string, unknown>;
  const globalModels = isJsonObject(globalCfg.models) ? (globalCfg.models as Record<string, unknown>) : null;
  const globalProviders = globalModels && isJsonObject(globalModels.providers)
    ? (globalModels.providers as Record<string, unknown>)
    : null;
  const nextModels = isJsonObject(next.models) ? (next.models as Record<string, unknown>) : null;
  const nextProviders = nextModels && isJsonObject(nextModels.providers)
    ? (nextModels.providers as Record<string, unknown>)
    : null;

  const removedProviderNames = new Set<string>();
  if (nextProviders && globalProviders) {
    for (const [providerName, providerValue] of Object.entries(nextProviders)) {
      const normalized = providerName.trim().toLowerCase();
      if (!normalized || isSharedProviderName(normalized, providerValue)) {
        continue;
      }
      const globalProvider = globalProviders[providerName];
      if (!isJsonObject(globalProvider)) {
        continue;
      }
      if (!deepJsonEqual(providerValue, globalProvider)) {
        continue;
      }
      delete nextProviders[providerName];
      removedProviderNames.add(normalized);
    }
    next.models = {
      ...nextModels,
      providers: nextProviders,
    };
  }

  if (removedProviderNames.size === 0) {
    return next;
  }

  const nextAgents = isJsonObject(next.agents) ? (next.agents as Record<string, unknown>) : null;
  const nextDefaults = nextAgents && isJsonObject(nextAgents.defaults)
    ? (nextAgents.defaults as Record<string, unknown>)
    : null;
  const globalAgents = isJsonObject(globalCfg.agents) ? (globalCfg.agents as Record<string, unknown>) : null;
  const globalDefaults = globalAgents && isJsonObject(globalAgents.defaults)
    ? (globalAgents.defaults as Record<string, unknown>)
    : null;
  if (!nextDefaults) {
    return next;
  }

  const filteredDefaults = { ...nextDefaults } as Record<string, unknown>;
  const defaultsModels = isJsonObject(nextDefaults.models) ? (nextDefaults.models as Record<string, unknown>) : null;
  if (defaultsModels) {
    const keepModels: Record<string, unknown> = {};
    for (const [modelRef, modelMeta] of Object.entries(defaultsModels)) {
      const provider = parseModelRefProvider(modelRef);
      if (!provider || !removedProviderNames.has(provider)) {
        keepModels[modelRef] = modelMeta;
        continue;
      }
      const globalModelMeta = isJsonObject(globalDefaults?.models)
        ? (globalDefaults!.models as Record<string, unknown>)[modelRef]
        : undefined;
      if (!deepJsonEqual(modelMeta, globalModelMeta)) {
        // Keep explicit workspace overrides even if the provider name matches a removed clone.
        keepModels[modelRef] = modelMeta;
      }
    }
    filteredDefaults.models = keepModels;
  }

  if (isJsonObject(filteredDefaults.model)) {
    const modelNode = { ...(filteredDefaults.model as Record<string, unknown>) };
    const primaryProvider = parseModelRefProvider(modelNode.primary);
    if (primaryProvider && removedProviderNames.has(primaryProvider)) {
      const globalPrimary = isJsonObject(globalDefaults?.model)
        ? (globalDefaults!.model as Record<string, unknown>).primary
        : undefined;
      if (deepJsonEqual(modelNode.primary, globalPrimary)) {
        delete modelNode.primary;
      }
    }
    filteredDefaults.model = modelNode;
  }

  if (
    typeof filteredDefaults.workspace === "string" &&
    typeof globalDefaults?.workspace === "string" &&
    filteredDefaults.workspace.trim() === globalDefaults.workspace.trim()
  ) {
    delete filteredDefaults.workspace;
  }
  if (
    typeof filteredDefaults.agentDir === "string" &&
    typeof globalDefaults?.agentDir === "string" &&
    filteredDefaults.agentDir.trim() === globalDefaults.agentDir.trim()
  ) {
    delete filteredDefaults.agentDir;
  }

  next.agents = {
    ...nextAgents,
    defaults: filteredDefaults,
  };
  return next;
}

type PmosProjectHealth = "at_risk" | "attention" | "on_track" | "quiet";

type PmosProjectTodoItem = {
  id: string | null;
  title: string;
  status: string | null;
  dueOn: string | null;
  projectId: string | null;
  projectName: string | null;
  appUrl: string | null;
};

type PmosProjectDockCapability = {
  id: string | null;
  name: string | null;
  title: string | null;
  enabled: boolean;
  position: number | null;
  url: string | null;
  appUrl: string | null;
};

type PmosProjectCard = {
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
  health: PmosProjectHealth;
  previewTodos: PmosProjectTodoItem[];
};

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function countDistinctAbsoluteUrls(value: string): number {
  const matches = value.match(/https?:\/\/[^\s)>\]"']+/gi) ?? [];
  return new Set(matches.map((entry) => entry.trim())).size;
}

function isFigmaDeepContextRequest(value: string): boolean {
  return /\bcomment(?:s)?\b|\bannotation(?:s)?\b|\bfeedback\b|\bthread(?:s)?\b|\bnote(?:s)?\b|\bpin(?:ned)?\b|\bvariable(?:s)?\b|\btoken(?:s)?\b|\bscreenshot(?:s)?\b|\bmetadata\b|\bnode(?:s)?\b|\binspect\b|\bimplement(?:ation)?\b/i.test(
    value,
  );
}

function shouldDeferFigmaPatAudit(params: {
  latestUserMessage: string;
  figmaMcpCallAttempted: boolean;
  figmaMcpFailureSeen: boolean;
}): boolean {
  return (
    isFigmaDeepContextRequest(params.latestUserMessage) &&
    !params.figmaMcpCallAttempted &&
    !params.figmaMcpFailureSeen
  );
}

function numberStringOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return stringOrNull(value);
}

function parseProjectIdFromAppUrl(appUrl: string | null): string | null {
  if (!appUrl) return null;
  const bucketMatch = appUrl.match(/\/buckets\/(\d+)/i);
  if (bucketMatch?.[1]) return bucketMatch[1];
  const projectMatch = appUrl.match(/\/projects\/(\d+)/i);
  if (projectMatch?.[1]) return projectMatch[1];
  return null;
}

function normalizeBcgptToolResult(result: unknown): unknown {
  if (!isJsonObject(result)) {
    return result;
  }
  const content = result.content;
  if (!Array.isArray(content)) {
    return result;
  }
  const textBlocks: string[] = [];
  const parsedBlocks: unknown[] = [];
  for (const item of content) {
    if (!isJsonObject(item)) continue;
    const text = stringOrNull(item.text);
    if (!text) continue;
    textBlocks.push(text);
    try {
      parsedBlocks.push(JSON.parse(text) as unknown);
    } catch {
      // Keep scanning; some content entries are plain text.
    }
  }
  if (parsedBlocks.length === 1 && textBlocks.length === 1) {
    return parsedBlocks[0];
  }
  if (!parsedBlocks.length && !textBlocks.length) {
    return result;
  }
  return {
    ...result,
    contentText: textBlocks.length ? textBlocks.join("\n\n") : undefined,
    parsedContent:
      parsedBlocks.length > 1 ? parsedBlocks : parsedBlocks.length === 1 ? parsedBlocks[0] : undefined,
  };
}

type BcgptToolDescriptor = {
  name: string;
  description: string | null;
};

function parseBcgptToolCatalog(result: unknown): BcgptToolDescriptor[] {
  const toolsRaw = (() => {
    if (isJsonObject(result) && Array.isArray(result.tools)) return result.tools;
    if (isJsonObject(result) && isJsonObject(result.result) && Array.isArray(result.result.tools)) {
      return result.result.tools;
    }
    return [];
  })();

  return toolsRaw
    .filter((item): item is Record<string, unknown> => isJsonObject(item))
    .map((item) => ({
      name: stringOrNull(item.name) ?? "",
      description: stringOrNull(item.description),
    }))
    .filter((item) => item.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function summarizeBcgptToolCatalog(tools: BcgptToolDescriptor[]): string {
  if (!tools.length) {
    return "No Basecamp MCP tools were returned by bcgpt.";
  }
  const top = tools.slice(0, 8).map((tool) => tool.name);
  return `Basecamp MCP tools available (${tools.length}): ${top.join(", ")}${tools.length > top.length ? ", ..." : ""}.`;
}

async function callBcgptTool(params: {
  bcgptUrl: string;
  apiKey: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ ok: boolean; result: unknown | null; error: string | null }> {
  const body = {
    jsonrpc: "2.0",
    id: `pmos-${params.toolName}-${Date.now()}`,
    method: "tools/call",
    params: {
      name: params.toolName,
      arguments: params.toolArgs ?? {},
    },
  };
  const rpc = await fetchJson(`${params.bcgptUrl}/mcp`, {
    method: "POST",
    timeoutMs: params.timeoutMs ?? 45_000,
    headers: {
      "content-type": "application/json",
      "x-bcgpt-api-key": params.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!rpc.ok || !isJsonObject(rpc.json)) {
    return { ok: false, result: null, error: rpc.error || `${params.toolName} request failed` };
  }

  const payload = rpc.json as Record<string, unknown>;
  if (isJsonObject(payload.error)) {
    const code = stringOrNull(payload.error.code);
    const message = stringOrNull(payload.error.message);
    return {
      ok: false,
      result: null,
      error: [code, message].filter(Boolean).join(": ") || `${params.toolName} failed`,
    };
  }

  const rawResult = payload.result ?? null;
  return { ok: true, result: normalizeBcgptToolResult(rawResult), error: null };
}

async function listBcgptTools(params: {
  bcgptUrl: string;
  apiKey: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; result: unknown | null; error: string | null }> {
  const rpc = await fetchJson(`${params.bcgptUrl}/mcp`, {
    method: "POST",
    timeoutMs: params.timeoutMs ?? 30_000,
    headers: {
      "content-type": "application/json",
      "x-bcgpt-api-key": params.apiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `pmos-bcgpt-tools-list-${Date.now()}`,
      method: "tools/list",
      params: {},
    }),
  });

  if (!rpc.ok || !isJsonObject(rpc.json)) {
    return { ok: false, result: null, error: rpc.error || "tools/list request failed" };
  }

  const payload = rpc.json as Record<string, unknown>;
  if (isJsonObject(payload.error)) {
    const code = stringOrNull(payload.error.code);
    const message = stringOrNull(payload.error.message);
    return {
      ok: false,
      result: null,
      error: [code, message].filter(Boolean).join(": ") || "tools/list failed",
    };
  }

  return { ok: true, result: payload.result ?? null, error: null };
}

async function resolveWorkspaceBcgptAccess(params: {
  workspaceId: string;
  allowGlobalSecrets: boolean;
}): Promise<{ bcgptUrl: string; apiKey: string | null }> {
  const cfg = loadConfig() as unknown;
  const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
  const workspaceConnectors = await readWorkspaceConnectors(params.workspaceId);
  const bcgptUrl = normalizeBaseUrl(
    (workspaceConnectors?.bcgpt?.url as string | undefined) ??
      readConfigString(cfg, ["pmos", "connectors", "bcgpt", "url"]) ??
      process.env.BCGPT_URL ??
      null,
    "https://bcgpt.wickedlab.io",
  );
  const apiKey =
    (workspaceConnectors?.bcgpt?.apiKey as string | undefined)?.trim() ??
    (params.allowGlobalSecrets
      ? readConfigString(cfg, ["pmos", "connectors", "bcgpt", "apiKey"]) ??
        (process.env.BCGPT_API_KEY?.trim() || null)
      : null);
  return { bcgptUrl, apiKey };
}

type WorkspaceFigmaContext = {
  figmaUrl: string;
  connected: boolean;
  hasPersonalAccessToken: boolean;
  mcpServerUrl: string | null;
  patSource: string | null;
  handle: string | null;
  email: string | null;
  activeConnectionId: string | null;
  activeConnectionName: string | null;
  activeTeamId: string | null;
  selectedFileName: string | null;
  selectedFileUrl: string | null;
  selectedFileId: string | null;
  totalConnections: number | null;
  lastSyncedAt: string | null;
  updatedAt: string | null;
};

type WorkspaceFigmaMcpAuth = {
  personalAccessToken: string | null;
  hasPersonalAccessToken: boolean;
  source: string | null;
  mcpServerUrl: string;
};

type FigmaOfficialMcpStatus = {
  url: string | null;
  configured: boolean;
  reachable: boolean | null;
  authOk: boolean | null;
  authRequired: boolean;
  configPath: string | null;
  transport: string | null;
  source: string | null;
  hasPersonalAccessToken: boolean;
  fallbackAvailable: boolean;
  authCommand: string | null;
  error: string | null;
};

function buildFigmaPatMissingPayload(mcpAuth: WorkspaceFigmaMcpAuth): Record<string, unknown> {
  if (mcpAuth.hasPersonalAccessToken) {
    return {
      error: "Figma PAT appears to exist in FM, but the raw token was not passed into PMOS connector sync.",
      code: "FIGMA_PAT_NOT_SYNCED_FROM_FM",
      hasPersonalAccessToken: true,
      source: mcpAuth.source,
      mcpServerUrl: mcpAuth.mcpServerUrl,
    };
  }
  return {
    error: "Figma personal access token is missing from workspace connector sync.",
    code: "FIGMA_PAT_MISSING",
    hasPersonalAccessToken: false,
    source: mcpAuth.source,
    mcpServerUrl: mcpAuth.mcpServerUrl,
  };
}

function readWorkspaceFigmaMcpAuthFromConnectors(connectors: unknown): WorkspaceFigmaMcpAuth {
  const figma = isJsonObject(connectors) && isJsonObject(connectors.figma)
    ? (connectors.figma as Record<string, unknown>)
    : {};
  const auth = isJsonObject(figma.auth) ? (figma.auth as Record<string, unknown>) : {};
  const identity = isJsonObject(figma.identity) ? (figma.identity as Record<string, unknown>) : {};
  const personalAccessToken = stringOrNull(auth.personalAccessToken);
  const hasPersonalAccessToken =
    Boolean(personalAccessToken) ||
    auth.hasPersonalAccessToken === true ||
    identity.hasPersonalAccessToken === true;
  const mcpServerUrl = stringOrNull(auth.mcpServerUrl) ?? "https://mcp.figma.com/mcp";
  const source = stringOrNull(auth.source);

  return {
    personalAccessToken,
    hasPersonalAccessToken,
    source,
    mcpServerUrl,
  };
}

async function readWorkspaceFigmaContext(workspaceId: string): Promise<WorkspaceFigmaContext> {
  const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
  const connectors = await readWorkspaceConnectors(workspaceId);
  const figma = (connectors?.figma ?? {}) as Record<string, unknown>;
  const identity = (figma.identity as Record<string, unknown> | undefined) ?? {};
  const mcpAuth = readWorkspaceFigmaMcpAuthFromConnectors(connectors);
  const figmaUrl = String(figma.url ?? "https://fm.wickedlab.io");
  return {
    figmaUrl,
    connected: identity.connected === true,
    hasPersonalAccessToken: mcpAuth.hasPersonalAccessToken,
    mcpServerUrl: mcpAuth.mcpServerUrl,
    patSource: mcpAuth.source,
    handle: typeof identity.handle === "string" ? identity.handle : null,
    email: typeof identity.email === "string" ? identity.email : null,
    activeConnectionId:
      typeof identity.activeConnectionId === "string" || typeof identity.activeConnectionId === "number"
        ? String(identity.activeConnectionId)
        : null,
    activeConnectionName: typeof identity.activeConnectionName === "string" ? identity.activeConnectionName : null,
    activeTeamId: typeof identity.activeTeamId === "string" ? identity.activeTeamId : null,
    selectedFileName: typeof identity.selectedFileName === "string" ? identity.selectedFileName : null,
    selectedFileUrl: typeof identity.selectedFileUrl === "string" ? identity.selectedFileUrl : null,
    selectedFileId: typeof identity.selectedFileId === "string" ? identity.selectedFileId : null,
    totalConnections: typeof identity.totalConnections === "number" ? identity.totalConnections : null,
    lastSyncedAt: typeof identity.lastSyncedAt === "string" ? identity.lastSyncedAt : null,
    updatedAt: typeof identity.updatedAt === "string" ? identity.updatedAt : null,
  };
}

async function readWorkspaceFigmaMcpAuth(workspaceId: string): Promise<WorkspaceFigmaMcpAuth> {
  const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
  const connectors = await readWorkspaceConnectors(workspaceId);
  return readWorkspaceFigmaMcpAuthFromConnectors(connectors);
}

async function readWorkspaceFigmaOfficialMcpStatus(workspaceId: string): Promise<FigmaOfficialMcpStatus> {
  const status = await probeWorkspaceFigmaMcpServiceStatus(workspaceId);
  return {
    url: status.url,
    configured: status.configured,
    reachable: status.reachable,
    authOk: status.authOk,
    authRequired: status.authRequired,
    configPath: null,
    transport: status.transport,
    source: status.source,
    hasPersonalAccessToken: status.hasPersonalAccessToken,
    fallbackAvailable: status.fallbackAvailable,
    authCommand: null,
    error: status.error,
  };
}

type WorkspaceFmMcpAuth = {
  fmMcpUrl: string | null;
  fmMcpApiToken: string | null;
};

async function readWorkspaceFmMcpAuth(workspaceId: string): Promise<WorkspaceFmMcpAuth> {
  const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
  const connectors = await readWorkspaceConnectors(workspaceId);
  const figma = isJsonObject(connectors) && isJsonObject(connectors.figma)
    ? (connectors.figma as Record<string, unknown>)
    : {};
  const auth = isJsonObject(figma.auth) ? (figma.auth as Record<string, unknown>) : {};
  return {
    fmMcpUrl: stringOrNull(auth.fmMcpUrl),
    fmMcpApiToken: stringOrNull(auth.fmMcpApiToken),
  };
}

async function callFmMcp(
  fmMcpUrl: string,
  fmMcpApiToken: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const resp = await fetch(fmMcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fmMcpApiToken}`,
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    throw new Error(`FM MCP HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as {
    result?: unknown;
    tools?: unknown;
    content?: unknown;
    error?: { message?: string };
  };
  if (json.error) {
    throw new Error(json.error.message ?? "FM MCP error");
  }
  if (json.result !== undefined) {
    return json.result;
  }
  if (json.tools !== undefined) {
    return json.tools;
  }
  return normalizeBcgptToolResult(json);
}

async function runWorkspaceFigmaRestAudit(
  workspaceId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const mcpAuth = await readWorkspaceFigmaMcpAuth(workspaceId);
  if (!mcpAuth.personalAccessToken) {
    return buildFigmaPatMissingPayload(mcpAuth);
  }

  const figmaContext = await readWorkspaceFigmaContext(workspaceId);
  const requestedFileKey =
    stringOrNull(args.file_key) ??
    stringOrNull(args.fileKey) ??
    stringOrNull(args.selected_file_id) ??
    stringOrNull(args.selectedFileId) ??
    stringOrNull(args.url);
  const fileKey =
    parseFigmaFileKey(requestedFileKey) ??
    parseFigmaFileKey(figmaContext.selectedFileId) ??
    parseFigmaFileKey(figmaContext.selectedFileUrl);

  if (!fileKey) {
    return {
      error: "No Figma file is selected in workspace context, and no file_key was provided.",
      code: "FIGMA_FILE_CONTEXT_MISSING",
      hasPersonalAccessToken: true,
      source: mcpAuth.source,
      mcpServerUrl: mcpAuth.mcpServerUrl,
      fallbackSuggested: "Select a file in the Figma panel, click Sync Now, then retry the audit.",
    };
  }

  const focus = stringOrNull(args.focus);
  const requestedDepth = Number(args.depth);
  const depth =
    Number.isFinite(requestedDepth) && requestedDepth >= 1 && requestedDepth <= 8
      ? Math.trunc(requestedDepth)
      : 2;
  const query = new URLSearchParams({
    branch_data: "true",
    depth: String(depth),
  });
  const fileResponse = await fetchJson(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?${query.toString()}`, {
    method: "GET",
    timeoutMs: 25_000,
    headers: {
      "X-Figma-Token": mcpAuth.personalAccessToken,
    },
  });

  if (!fileResponse.ok || !isJsonObject(fileResponse.json)) {
    return {
      error: fileResponse.error ?? `Figma REST file fetch failed with status ${String(fileResponse.status)}`,
      code: "FIGMA_REST_FILE_FETCH_FAILED",
      status: fileResponse.status,
      fileKey,
      selectedFileId: figmaContext.selectedFileId,
      selectedFileName: figmaContext.selectedFileName,
      selectedFileUrl: figmaContext.selectedFileUrl,
    };
  }

  return {
    ...buildFigmaRestAuditReport(fileResponse.json, { focus, fileKey }),
    requestDepth: depth,
    selectedFileId: figmaContext.selectedFileId,
    selectedFileName: figmaContext.selectedFileName,
    selectedFileUrl: figmaContext.selectedFileUrl,
    activeConnectionId: figmaContext.activeConnectionId,
    activeConnectionName: figmaContext.activeConnectionName,
    activeTeamId: figmaContext.activeTeamId,
    connected: figmaContext.connected,
    mcpServerUrl: mcpAuth.mcpServerUrl,
    patSource: mcpAuth.source,
  };
}

function fillFigmaContextValue(
  args: Record<string, unknown>,
  keys: string[],
  value: string | null,
): void {
  if (!value) return;
  for (const key of keys) {
    if (!(key in args)) continue;
    const current = args[key];
    if (current === null || current === undefined || (typeof current === "string" && current.trim() === "")) {
      args[key] = value;
    }
  }
}

function hydrateKnownFigmaContextArguments(
  rawArgs: Record<string, unknown>,
  context: WorkspaceFigmaContext,
): Record<string, unknown> {
  const next = { ...rawArgs };
  fillFigmaContextValue(next, ["fileId", "file_id", "selectedFileId", "selected_file_id"], context.selectedFileId);
  fillFigmaContextValue(next, ["teamId", "team_id", "figmaTeamId", "figma_team_id"], context.activeTeamId);
  fillFigmaContextValue(next, ["connectionId", "connection_id", "activeConnectionId", "active_connection_id"], context.activeConnectionId);
  return next;
}

function parseProjectList(result: unknown): Array<{ id: string; name: string; status: string; appUrl: string | null }> {
  const listRaw = (() => {
    if (isJsonObject(result) && Array.isArray(result.projects)) return result.projects;
    if (isJsonObject(result) && Array.isArray(result.items)) return result.items;
    if (isJsonObject(result) && Array.isArray(result.data)) return result.data;
    if (isJsonObject(result) && isJsonObject(result.result) && Array.isArray(result.result.projects)) {
      return result.result.projects;
    }
    if (Array.isArray(result)) return result;
    return [];
  })();

  const out: Array<{ id: string; name: string; status: string; appUrl: string | null }> = [];
  for (const item of listRaw) {
    if (!isJsonObject(item)) continue;
    const id = numberStringOrNull(item.id);
    const name = stringOrNull(item.name);
    if (!id || !name) continue;
    out.push({
      id,
      name,
      status: stringOrNull(item.status) ?? "active",
      appUrl: stringOrNull(item.app_url) ?? stringOrNull(item.appUrl),
    });
  }
  return out;
}

function summarizeBasecampProjectList(
  projects: Array<{ id: string; name: string; status: string; appUrl: string | null }>,
): string {
  if (!projects.length) {
    return "No Basecamp projects were found for this workspace.";
  }
  const top = projects.slice(0, 5).map((project) => `${project.name} (${project.status})`);
  return `Basecamp projects (${projects.length}): ${top.join(", ")}${projects.length > top.length ? ", ..." : ""}.`;
}

function summarizeBcgptNarrative(text: string, maxChars = 420): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trimEnd()}...`;
}

function extractBcgptNarrative(result: unknown): string | null {
  if (typeof result === "string") {
    const normalized = summarizeBcgptNarrative(result);
    return normalized || null;
  }
  if (!isJsonObject(result)) {
    return null;
  }
  const direct =
    stringOrNull(result.summary) ??
    stringOrNull(result.note) ??
    stringOrNull(result.message);
  if (direct) {
    return summarizeBcgptNarrative(direct);
  }
  const parsedContent = result.parsedContent;
  if (Array.isArray(parsedContent)) {
    for (const item of parsedContent) {
      const nested = extractBcgptNarrative(item);
      if (nested) {
        return nested;
      }
    }
  } else if (parsedContent !== undefined) {
    const nested = extractBcgptNarrative(parsedContent);
    if (nested) {
      return nested;
    }
  }
  const nestedResult = isJsonObject(result.result) ? result.result : null;
  if (nestedResult) {
    const nested = extractBcgptNarrative(nestedResult);
    if (nested) {
      return nested;
    }
  }
  const contentText = stringOrNull(result.contentText);
  if (contentText) {
    return summarizeBcgptNarrative(contentText);
  }
  return null;
}

function summarizeBcgptSmartActionResult(
  query: string,
  projectHint: string | null,
  result: unknown,
): string {
  const narrative = extractBcgptNarrative(result);
  if (narrative) {
    return narrative;
  }
  if (!isJsonObject(result)) {
    return `Completed Basecamp request: ${query}`;
  }

  const action = stringOrNull(result.action);
  const summary = stringOrNull(result.summary) ?? stringOrNull(result.note);
  if (summary) {
    return summary;
  }

  const projects = parseProjectList(result);
  if (projects.length) {
    return summarizeBasecampProjectList(projects);
  }

  const nestedResult = isJsonObject(result.result) ? result.result : null;
  if (nestedResult) {
    const nestedSummary =
      stringOrNull(nestedResult.summary) ??
      stringOrNull(nestedResult.note);
    if (nestedSummary) {
      return nestedSummary;
    }
    const nestedProjects = parseProjectList(nestedResult);
    if (nestedProjects.length) {
      return summarizeBasecampProjectList(nestedProjects);
    }
    const todoSummary = isJsonObject(nestedResult.todo_summary) ? nestedResult.todo_summary : null;
    const totalOpen = typeof todoSummary?.total_open === "number" ? todoSummary.total_open : null;
    const projectName =
      stringOrNull(isJsonObject(result.project) ? result.project.name : null) ??
      stringOrNull(projectHint);
    if (projectName && totalOpen != null) {
      return `${projectName}: ${totalOpen} open Basecamp tasks${action ? ` via ${action.replace(/_/g, " ")}` : ""}.`;
    }
  }

  const projectName =
    stringOrNull(isJsonObject(result.project) ? result.project.name : null) ??
    stringOrNull(projectHint);
  if (projectName && action) {
    return `${projectName}: Basecamp ${action.replace(/_/g, " ")} completed.`;
  }
  if (action) {
    return `Basecamp ${action.replace(/_/g, " ")} completed.`;
  }
  return `Completed Basecamp request: ${query}`;
}

function summarizeBcgptRawResult(
  method: string,
  path: string,
  result: unknown,
): string {
  const narrative = extractBcgptNarrative(result);
  if (narrative) {
    return narrative;
  }
  return `Basecamp raw ${method.toUpperCase()} ${path} completed.`;
}

function parseCompletedRatio(value: string | null): { completed: number; total: number; open: number } | null {
  if (!value) return null;
  const match = value.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const completed = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total < completed) {
    return null;
  }
  return {
    completed,
    total,
    open: total - completed,
  };
}

function summarizeBcgptTodoLists(result: unknown): string | null {
  const payload = isJsonObject(result) ? result : null;
  const root = isJsonObject(payload?.result) ? payload.result : payload;
  const lists = Array.isArray(root?.todolists)
    ? root.todolists
        .filter((entry): entry is Record<string, unknown> => isJsonObject(entry))
        .map((entry) => ({
          name: stringOrNull(entry.name) ?? stringOrNull(entry.title) ?? "",
          open: parseCompletedRatio(stringOrNull(entry.completed_ratio))?.open ?? null,
        }))
        .filter((entry) => entry.name)
    : [];
  if (!lists.length) {
    return null;
  }
  const projectName =
    stringOrNull(isJsonObject(root?.project) ? root.project.name : null) ??
    "the project";
  const top = lists
    .slice(0, 5)
    .map((entry) => `${entry.name}${typeof entry.open === "number" ? ` (${entry.open} open)` : ""}`);
  return `${projectName} todo lists (${lists.length}): ${top.join(", ")}${lists.length > top.length ? ", ..." : ""}.`;
}

function summarizeBcgptTodoGroups(result: unknown): string | null {
  const payload = isJsonObject(result) ? result : null;
  const root = isJsonObject(payload?.result) ? payload.result : payload;
  const groups = Array.isArray(root?.groups)
    ? root.groups
        .filter((entry): entry is Record<string, unknown> => isJsonObject(entry))
        .map((entry) => ({
          name: stringOrNull(entry.todolist) ?? stringOrNull(entry.name) ?? "",
          count:
            typeof entry.todos_count === "number"
              ? entry.todos_count
              : typeof entry.count === "number"
                ? entry.count
                : null,
        }))
        .filter((entry) => entry.name)
    : [];
  if (!groups.length) {
    return null;
  }
  const projectName =
    stringOrNull(isJsonObject(root?.project) ? root.project.name : null) ??
    "the project";
  const top = groups
    .slice(0, 5)
    .map((entry) => `${entry.name}${typeof entry.count === "number" ? ` (${entry.count} open)` : ""}`);
  return `${projectName} todo groups (${groups.length}): ${top.join(", ")}${groups.length > top.length ? ", ..." : ""}.`;
}

function summarizeBcgptDirectToolResult(requestedTool: string, result: unknown): string {
  const narrative = extractBcgptNarrative(result);
  if (narrative) {
    return narrative;
  }

  if (requestedTool === "list_projects") {
    const projects = parseProjectList(result);
    if (projects.length) {
      return summarizeBasecampProjectList(projects);
    }
  }
  if (requestedTool === "list_todolists") {
    const summary = summarizeBcgptTodoLists(result);
    if (summary) return summary;
  }
  if (requestedTool === "list_todos_for_project") {
    const summary = summarizeBcgptTodoGroups(result);
    if (summary) return summary;
  }

  const payload = isJsonObject(result) ? result : null;
  const root = isJsonObject(payload?.result) ? payload.result : payload;
  const count =
    typeof root?.count === "number"
      ? root.count
      : typeof payload?.count === "number"
        ? payload.count
        : null;
  if (typeof count === "number") {
    return `Basecamp ${requestedTool} returned ${count} item${count === 1 ? "" : "s"}.`;
  }
  return `Basecamp ${requestedTool} completed.`;
}

function isGreetingOnlyMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.length > 80) {
    return false;
  }
  return /^(hi|hello|hey|yo|sup|good (morning|afternoon|evening)|start|new session|test|ping|hola|namaste)([!. ,].*)?$/i.test(
    normalized,
  );
}

// ── Intent-based tool/context filtering ──────────────────────────────────────
type ChatIntent = "basecamp" | "workflow" | "figma" | "general";
type WorkspaceChatUrlHints = ReturnType<typeof inspectWorkspaceChatUrls>;
type PmosChatExecutionMode =
  | "general"
  | "basecamp_lookup"
  | "basecamp_manager"
  | "workflow"
  | "figma"
  | "cross_system";

export type PmosChatExecutionPlan = {
  mode: PmosChatExecutionMode;
  intents: ChatIntent[];
  needsLiveData: boolean;
  includeWorkspaceMemory: boolean;
  includeCredentials: boolean;
  includeScreenContext: boolean;
  includeUrlHints: boolean;
  responseStyle: "concise" | "project_manager" | "workflow_operator" | "design_analyst" | "orchestrator";
  plannerSummary: string;
  thinkingNote: string;
  guidance: string[];
};

function detectChatIntents(
  message: string,
  urlHints: { basecampUrl?: string | null; figmaUrl?: string | null },
): Set<ChatIntent> {
  if (isGreetingOnlyMessage(message)) {
    return new Set<ChatIntent>(["general"]);
  }

  const intents = new Set<ChatIntent>();
  const msg = message.toLowerCase();

  if (
    urlHints.basecampUrl ||
    /\bbasecamp\b|\bbcgpt\b|\bproject(?:s)?\b|\btodo(?:s)?\b|\bschedule\b|\bcampfire\b|\bmessage(?:s)?\b|\bkanban\b|\bcard(?:s)?\b|\bpeople\b|\bperson\b|\bassignment(?:s)?\b|\bbucket(?:s)?\b|\brecording(?:s)?\b|\/buckets\/\d+|\/projects\/\d+/i.test(
      msg,
    )
  ) {
    intents.add("basecamp");
  }

  if (
    urlHints.figmaUrl ||
    /\bfigma\b|\bauto[\s-]?layout\b|\bdesign\s+(?:file|system|token|audit|review|asset|spec)\b|\bcomponent\s+(?:library|set)\b/i.test(msg)
  ) {
    intents.add("figma");
  }

  if (intents.size === 0) {
    intents.add("general");
  }

  return intents;
}

function isWorkspaceOpsRequest(message: string): boolean {
  return /\bworkspace\b|\bcommand center\b|\bwhat can you access\b|\bwhat do you know about this workspace\b/i.test(
    message,
  );
}

function isBasecampManagerRequest(message: string): boolean {
  return /\b(assigned to me|my todos|my tasks|overdue|due today|due tomorrow|today|tomorrow|blocked|at risk|priority|priorities|focus on|what should i do|what should i focus on|what needs attention|status update|project pulse|project health|what changed)\b/i.test(
    message,
  );
}

function buildPmosPlannerGuidance(params: {
  mode: PmosChatExecutionMode;
  latestUserMessage: string;
  intents: Set<ChatIntent>;
  urlHints: WorkspaceChatUrlHints;
  pastedUrlCount: number;
  shouldPreferProjectList: boolean;
  preferredBasecampNamedTool: BasecampNamedToolHint | null;
  shouldPreferFigmaMcpDiscovery: boolean;
  shouldPreferExplicitFigmaFileRouting: boolean;
}): string[] {
  const guidance: string[] = [
    "- Start with the user's actual goal, not the workspace configuration.",
    "- Pull only the context needed to answer or act. Avoid broad setup chatter.",
    "- Do not mention hidden routing, prompt, or tool-selection logic in the user-facing reply.",
  ];

  if (params.pastedUrlCount >= 2) {
    guidance.push(
      "- Multiple explicit resources were supplied. Treat this as a narrow cross-resource job and consider parallel subtasks only if the probes are truly independent.",
    );
  }

  if (params.urlHints.basecampUrl) {
    guidance.push(
      `- A Basecamp URL was pasted: ${params.urlHints.basecampUrl}. Treat it as the exact resource to inspect.`,
    );
  }

  if (params.urlHints.figmaUrl) {
    guidance.push(
      `- A Figma URL was pasted: ${params.urlHints.figmaUrl}. Anchor to that exact file instead of the selected panel file.`,
    );
  }

  switch (params.mode) {
    case "basecamp_lookup":
      guidance.push(
        "- Use deterministic Basecamp tools for exact reads whenever possible.",
      );
      if (params.shouldPreferProjectList) {
        guidance.push("- Prefer `bcgpt_list_projects` first because the user appears to want exact project names or a raw list.");
      } else if (params.preferredBasecampNamedTool) {
        guidance.push(
          `- Prefer \`bcgpt_mcp_call\` with \`${params.preferredBasecampNamedTool.tool}\` first because ${params.preferredBasecampNamedTool.reason}.`,
        );
      } else {
        guidance.push(
          "- If the right named Basecamp MCP tool is unclear, call `bcgpt_list_tools` once and then `bcgpt_mcp_call`. Use `bcgpt_smart_action` only for ambiguous or URL-driven requests.",
        );
      }
      break;
    case "basecamp_manager":
      guidance.push(
        "- Think like a world-class project manager: identify what matters now, what is blocked, what is overdue, and the next best action.",
      );
      guidance.push(
        "- Do not just dump queues. Triage, prioritize, and explain why the top items matter.",
      );
      if (params.preferredBasecampNamedTool) {
        guidance.push(
          `- Start with \`bcgpt_mcp_call\` using \`${params.preferredBasecampNamedTool.tool}\` when it gives the cleanest queue.`,
        );
      }
      break;
    case "workflow":
      guidance.push(
        "- Check connected credentials only when the task truly involves automations or workflow changes.",
      );
      guidance.push(
        "- When creating or updating workflows, act directly through the workflow tools instead of emitting import JSON for the user.",
      );
      break;
    case "figma":
      guidance.push(
        "- Prefer the live Figma MCP surface for context-first reads such as design context, metadata, screenshots, variables, or annotations.",
      );
      if (params.shouldPreferFigmaMcpDiscovery) {
        guidance.push(
          "- Discover the exact Figma MCP capability first with `figma_mcp_list_tools`, then call the matching MCP tool.",
        );
      }
      if (params.shouldPreferExplicitFigmaFileRouting) {
        guidance.push(
          "- Stay anchored to the explicit Figma file URL rather than the selected workspace file.",
        );
      }
      break;
    case "cross_system":
      guidance.push(
        "- This request spans multiple systems. Plan the smallest viable chain and do not stop after the first tool result if synthesis or follow-up actions are still needed.",
      );
      break;
    case "general":
      guidance.push(
        "- Answer like native OpenClaw first. Do not inspect Basecamp, Figma, workflows, connectors, or credentials unless the task clearly requires live workspace data.",
      );
      break;
  }

  if (params.intents.has("basecamp")) {
    guidance.push(
      "- Never answer Basecamp-specific questions from stale memory when live tools are available.",
    );
  }

  return guidance;
}

export function buildPmosChatExecutionPlan(params: {
  latestUserMessage: string;
  urlHints: WorkspaceChatUrlHints;
  pastedUrlCount: number;
  hasScreenContext: boolean;
}): PmosChatExecutionPlan {
  const latestUserMessage = params.latestUserMessage.trim();
  const intents = detectChatIntents(latestUserMessage, params.urlHints);
  const specialistIntents = [...intents].filter((intent) => intent !== "general");
  const hasMixedWorkspaceUrls = Boolean(params.urlHints.basecampUrl && params.urlHints.figmaUrl);
  const shouldPreferProjectList =
    intents.has("basecamp") &&
    !params.urlHints.basecampUrl &&
    /\b(list|show|what|which|give|display|name)\b[\s\w-]{0,40}\bprojects?\b|\bprojects?\b[\s\w-]{0,30}\b(names?|ids?|list)\b/i.test(
      latestUserMessage,
    );
  const preferredBasecampNamedTool =
    intents.has("basecamp") && !shouldPreferProjectList && !params.urlHints.basecampUrl
      ? inferPreferredBasecampNamedTool(latestUserMessage)
      : null;
  const shouldPreferFigmaMcpDiscovery =
    intents.has("figma") && isFigmaDeepContextRequest(latestUserMessage);
  const shouldPreferExplicitFigmaFileRouting =
    Boolean(params.urlHints.figmaUrl) && !hasMixedWorkspaceUrls;
  const workflowWithBasecampTarget =
    intents.has("workflow") &&
    intents.has("basecamp") &&
    !intents.has("figma") &&
    !params.urlHints.basecampUrl &&
    specialistIntents.length === 2;

  let mode: PmosChatExecutionMode = "general";
  if (hasMixedWorkspaceUrls || (specialistIntents.length > 1 && !workflowWithBasecampTarget)) {
    mode = "cross_system";
  } else if (intents.has("workflow")) {
    mode = "workflow";
  } else if (intents.has("figma")) {
    mode = "figma";
  } else if (intents.has("basecamp")) {
    mode = isBasecampManagerRequest(latestUserMessage) ? "basecamp_manager" : "basecamp_lookup";
  }

  const includeWorkspaceMemory =
    isWorkspaceOpsRequest(latestUserMessage) ||
    /(\bworkspace\b|\bcommand center\b|\bavailable tools\b|\bwhat can you access\b)/i.test(
      latestUserMessage,
    );
  const includeCredentials = mode === "workflow" || (mode === "cross_system" && intents.has("workflow"));
  // Always include screen context when it's present — the user has a project or tab
  // open and the AI should always be aware of it, regardless of message content.
  const includeScreenContext = params.hasScreenContext;
  const includeUrlHints = params.pastedUrlCount > 0;
  const needsLiveData =
    specialistIntents.length > 0 || includeWorkspaceMemory || includeCredentials || includeUrlHints;

  const responseStyle =
    mode === "basecamp_manager"
      ? "project_manager"
      : mode === "workflow"
        ? "workflow_operator"
        : mode === "figma"
          ? "design_analyst"
          : mode === "cross_system"
            ? "orchestrator"
            : "concise";

  const plannerSummaryMap: Record<PmosChatExecutionMode, string> = {
    general: "Native chat turn. Keep context minimal and only escalate into workspace tools if the request truly needs live data.",
    basecamp_lookup: "Deterministic Basecamp lookup. Use exact tools and keep the reply focused on the requested project-management object or queue.",
    basecamp_manager: "Project-manager briefing. Pull the necessary Basecamp data, triage it, and answer like a strong operator rather than a raw reporter.",
    workflow: "Workflow operator turn. Inspect only the automation/credential context needed to complete the requested workflow task.",
    figma: "Design-context turn. Anchor to the relevant Figma file and use the smallest matching MCP capability surface.",
    cross_system: "Cross-system orchestration turn. Plan the narrowest multi-tool sequence before gathering live data.",
  };
  const thinkingNoteMap: Record<PmosChatExecutionMode, string> = {
    general: "Focusing on the user's request and keeping context tight.",
    basecamp_lookup: "Pulling only the exact Basecamp data needed for this lookup.",
    basecamp_manager: "Building a focused project-manager brief from live Basecamp data.",
    workflow: "Checking only the workflow connections and actions relevant to this request.",
    figma: "Anchoring to the right design context before inspecting the file.",
    cross_system: "Planning the smallest cross-system probe before gathering live data.",
  };

  return {
    mode,
    intents: [...intents],
    needsLiveData,
    includeWorkspaceMemory,
    includeCredentials,
    includeScreenContext,
    includeUrlHints,
    responseStyle,
    plannerSummary: plannerSummaryMap[mode],
    thinkingNote: thinkingNoteMap[mode],
    guidance: buildPmosPlannerGuidance({
      mode,
      latestUserMessage,
      intents,
      urlHints: params.urlHints,
      pastedUrlCount: params.pastedUrlCount,
      shouldPreferProjectList,
      preferredBasecampNamedTool,
      shouldPreferFigmaMcpDiscovery,
      shouldPreferExplicitFigmaFileRouting,
    }),
  };
}

const BASECAMP_CORE_TOOL_NAMES = new Set([
  "bcgpt_smart_action", "bcgpt_list_projects", "bcgpt_mcp_call", "bcgpt_search_basecamp",
]);
const BASECAMP_DISCOVERY_TOOL_NAMES = new Set([
  "bcgpt_list_tools",
]);
const BASECAMP_RAW_TOOL_NAMES = new Set([
  "bcgpt_basecamp_raw",
]);
const WORKFLOW_TOOL_NAMES = new Set([
  "pmos_ops_list_credentials", "pmos_ops_list_workflows", "pmos_ops_list_node_types",
  "pmos_ops_create_workflow", "pmos_ops_get_workflow", "pmos_ops_execute_workflow",
  "pmos_ops_update_workflow",
]);
const FIGMA_TOOL_NAMES = new Set([
  "figma_get_context", "figma_mcp_list_tools", "figma_mcp_call", "figma_pat_audit_file",
]);
const GENERAL_TOOL_NAMES = new Set([
  "pmos_parallel_subtasks", "web_search", "web_fetch",
]);

function addToolNames(target: Set<string>, source: Set<string>): void {
  source.forEach((name) => target.add(name));
}

function shouldExposeBasecampDiscoveryTools(message: string): boolean {
  return /\b(list|show|what|which|available)\b[\s\w-]{0,16}\btools?\b|\btool catalog\b|\btool schema\b|\bcapabilit(?:y|ies)\b|\bwhich bcgpt tool\b/i.test(
    message,
  );
}

function shouldExposeBasecampRawTool(
  message: string,
  urlHints: { basecampUrl?: string | null; basecampCardPath?: string | null },
): boolean {
  return (
    Boolean(urlHints.basecampCardPath) ||
    /\b(raw|api|endpoint(?:s)?|json|curl|payload|request body|response body)\b|(?:^|\s)(get|post|put|patch|delete)\s+\/\S+|\/buckets\/\d+\/\S+/i.test(
      message,
    )
  );
}

function filterToolDefinitionsByIntents(
  tools: ChatToolDefinition[],
  intents: Set<ChatIntent>,
  options: {
    disableBasecampTools?: boolean;
    latestUserMessage?: string;
    urlHints?: { basecampUrl?: string | null; basecampCardPath?: string | null };
  } = {},
): ChatToolDefinition[] {
  const disableBasecampTools = options.disableBasecampTools === true;
  const allowed = new Set<string>();
  addToolNames(allowed, GENERAL_TOOL_NAMES);

  const effectiveIntents = new Set(intents);
  if (disableBasecampTools) {
    effectiveIntents.delete("basecamp");
  }

  if (effectiveIntents.has("basecamp")) {
    addToolNames(allowed, BASECAMP_CORE_TOOL_NAMES);
    if (shouldExposeBasecampDiscoveryTools(options.latestUserMessage ?? "")) {
      addToolNames(allowed, BASECAMP_DISCOVERY_TOOL_NAMES);
    }
    if (shouldExposeBasecampRawTool(options.latestUserMessage ?? "", options.urlHints ?? {})) {
      addToolNames(allowed, BASECAMP_RAW_TOOL_NAMES);
    }
  }
  if (effectiveIntents.has("workflow")) {
    addToolNames(allowed, WORKFLOW_TOOL_NAMES);
  }
  if (effectiveIntents.has("figma")) {
    addToolNames(allowed, FIGMA_TOOL_NAMES);
  }

  if (allowed.size === 0) {
    return tools;
  }

  return tools.filter((tool) => {
    const name = tool?.type === "function" ? tool.function?.name ?? "" : "";
    return !name || allowed.has(name);
  });
}

type BasecampNamedToolHint = {
  tool: string;
  reason: string;
};

function normalizeBcgptNamedToolName(tool: string): string {
  return tool.trim().replace(/^bcgpt[.:/]/i, "");
}

function inferPreferredBasecampNamedTool(message: string): BasecampNamedToolHint | null {
  const lower = message.toLowerCase();
  if (/\b(overdue|past due|late)\b/.test(lower) && /\b(todo|task)s?\b/.test(lower) && !/\b(my|mine|assigned to me)\b/.test(lower)) {
    return {
      tool: "report_todos_overdue",
      reason: "the user wants the exact overdue todo queue rather than a broad Basecamp summary",
    };
  }
  if (/\b(today|tomorrow|\d{4}-\d{2}-\d{2})\b/.test(lower) && /\b(todo|task)s?\b/.test(lower) && !/\b(my|mine|assigned to me)\b/.test(lower)) {
    return {
      tool: "list_todos_due",
      reason: "the user is asking for an exact due-date todo list",
    };
  }
  if (/\b(todo lists?|todolists?)\b/.test(lower) && /\b(open|count|counts|how many)\b/.test(lower)) {
    return {
      tool: "list_todos_for_project",
      reason: "the user wants open todo counts grouped by list, which is an exact project todo query",
    };
  }
  if (/\b(todo lists?|todolists?)\b/.test(lower) || /\ball list names\b/.test(lower)) {
    return {
      tool: "list_todolists",
      reason: "the user wants the exact todo-list catalog for a project",
    };
  }
  if (/\b(my todos|assigned to me)\b/.test(lower)) {
    return {
      tool: "list_assigned_to_me",
      reason: "the user wants assigned todos, not a fuzzy Basecamp search",
    };
  }
  if (/\b(open todos?|open tasks?|todos? in project|tasks? in project)\b/.test(lower)) {
    return {
      tool: "list_todos_for_project",
      reason: "the user wants exact project todo data rather than a broad narrative summary",
    };
  }
  if (/\bmessage board\b/.test(lower) || (/\bmessages?\b/.test(lower) && !/\bcomments?\b/.test(lower))) {
    return {
      tool: "list_messages",
      reason: "the user wants exact message-board data",
    };
  }
  if (/\bpeople\b|\bteam\b|\bwho is\b|\bwho's\b/.test(lower)) {
    return {
      tool: "list_project_people",
      reason: "the user wants exact roster or people data",
    };
  }
  if (/\bschedule\b|\bcalendar\b|\bevents?\b/.test(lower)) {
    return {
      tool: "list_schedule_entries",
      reason: "the user wants exact schedule entries",
    };
  }
  if (/\bkanban\b|\bcard table\b|\bcard tables\b|\bcards?\b|\bboards?\b|\bcolumns?\b/.test(lower)) {
    return {
      tool: "list_card_tables",
      reason: "the user wants exact card-table data",
    };
  }
  if (/\bdocuments?\b|\bdocs?\b|\buploads?\b|\bfiles?\b/.test(lower)) {
    return {
      tool: "list_documents",
      reason: "the user wants exact document or upload data",
    };
  }
  return null;
}

function parseTodoItems(
  result: unknown,
  key: string,
  projectNameById: Map<string, string>,
): PmosProjectTodoItem[] {
  const todos = (() => {
    if (!isJsonObject(result)) return null;
    const keyed = result[key];
    if (Array.isArray(keyed)) return keyed;
    if (Array.isArray(result.items)) return result.items;
    if (Array.isArray(result.data)) return result.data;
    if (isJsonObject(result.result) && Array.isArray(result.result[key])) return result.result[key];
    return null;
  })();
  if (!todos) return [];

  const items: PmosProjectTodoItem[] = [];
  for (const raw of todos) {
    if (!isJsonObject(raw)) continue;
    const title = stringOrNull(raw.title);
    if (!title) continue;
    const appUrl = stringOrNull(raw.app_url) ?? stringOrNull(raw.appUrl);
    const project = isJsonObject(raw.project) ? raw.project : null;
    const projectId =
      numberStringOrNull(project?.id) ??
      numberStringOrNull(raw.projectId) ??
      numberStringOrNull(raw.project_id) ??
      parseProjectIdFromAppUrl(appUrl);
    const projectName =
      stringOrNull(project?.name) ??
      stringOrNull(raw.projectName) ??
      stringOrNull(raw.project_name) ??
      (projectId ? projectNameById.get(projectId) ?? null : null);
    items.push({
      id: numberStringOrNull(raw.id) ?? numberStringOrNull(raw.todoId) ?? numberStringOrNull(raw.todo_id),
      title,
      status: stringOrNull(raw.status),
      dueOn: stringOrNull(raw.due_on) ?? stringOrNull(raw.dueOn),
      projectId,
      projectName,
      appUrl,
    });
  }
  return items;
}

function parseTodoPreviewItems(
  result: unknown,
  project: { id: string; name: string },
): PmosProjectTodoItem[] {
  if (!isJsonObject(result)) return [];
  const groups = Array.isArray(result.groups)
    ? result.groups
    : isJsonObject(result.result) && Array.isArray(result.result.groups)
      ? result.result.groups
      : [];
  const items: PmosProjectTodoItem[] = [];
  for (const groupRaw of groups) {
    if (!isJsonObject(groupRaw)) continue;
    const preview = Array.isArray(groupRaw.todos_preview)
      ? groupRaw.todos_preview
      : Array.isArray(groupRaw.todos)
        ? groupRaw.todos
        : [];
    for (const todoRaw of preview) {
      if (!isJsonObject(todoRaw)) continue;
      const title = stringOrNull(todoRaw.title);
      if (!title) continue;
      items.push({
        id: numberStringOrNull(todoRaw.id),
        title,
        status: stringOrNull(todoRaw.status),
        dueOn: stringOrNull(todoRaw.due_on),
        projectId: project.id,
        projectName: project.name,
        appUrl: stringOrNull(todoRaw.app_url) ?? stringOrNull(todoRaw.appUrl),
      });
    }
  }
  return items;
}

function parseDailyReportPerProject(
  result: unknown,
): Map<string, { openTodos: number; overdueTodos: number; dueTodayTodos: number }> {
  const payload = isJsonObject(result) ? result : null;
  const root = isJsonObject(payload?.result) ? payload.result : payload;
  const perProject = Array.isArray(root?.perProject)
    ? root.perProject
    : Array.isArray(root?.per_project)
      ? root.per_project
      : Array.isArray(payload?.perProject)
        ? payload.perProject
        : [];
  const rows = new Map<string, { openTodos: number; overdueTodos: number; dueTodayTodos: number }>();
  for (const entry of perProject) {
    if (!isJsonObject(entry)) continue;
    const projectId = numberStringOrNull(entry.projectId) ?? numberStringOrNull(entry.project_id);
    if (!projectId) continue;
    const openTodos = typeof entry.openTodos === "number"
      ? entry.openTodos
      : typeof entry.open_todos === "number"
        ? entry.open_todos
        : 0;
    const overdueTodos = typeof entry.overdue === "number"
      ? entry.overdue
      : typeof entry.overdueTodos === "number"
        ? entry.overdueTodos
        : typeof entry.overdue_todos === "number"
          ? entry.overdue_todos
          : 0;
    const dueTodayTodos = typeof entry.dueToday === "number"
      ? entry.dueToday
      : typeof entry.dueTodayTodos === "number"
        ? entry.dueTodayTodos
        : typeof entry.due_today === "number"
          ? entry.due_today
          : 0;
    rows.set(projectId, {
      openTodos,
      overdueTodos,
      dueTodayTodos,
    });
  }
  return rows;
}

function dedupeTodoItems(items: PmosProjectTodoItem[]): PmosProjectTodoItem[] {
  const deduped = new Map<string, PmosProjectTodoItem>();
  for (const item of items) {
    const key =
      item.id ??
      `${item.projectId ?? ""}:${item.title}:${item.dueOn ?? ""}:${item.appUrl ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
      continue;
    }
    const current = deduped.get(key)!;
    deduped.set(key, {
      ...current,
      status: current.status ?? item.status,
      dueOn: current.dueOn ?? item.dueOn,
      projectId: current.projectId ?? item.projectId,
      projectName: current.projectName ?? item.projectName,
      appUrl: current.appUrl ?? item.appUrl,
    });
  }
  return Array.from(deduped.values());
}

function isIsoDate(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function classifyTodoDueBucket(
  dueOn: string | null,
  todayIso: string,
): "past" | "today" | "future" | "none" {
  if (!isIsoDate(dueOn)) return "none";
  if (dueOn < todayIso) return "past";
  if (dueOn > todayIso) return "future";
  return "today";
}

function sortTodoItems(items: PmosProjectTodoItem[], todayIso: string): PmosProjectTodoItem[] {
  const bucketRank = (item: PmosProjectTodoItem) => {
    switch (classifyTodoDueBucket(item.dueOn, todayIso)) {
      case "past":
        return 0;
      case "today":
        return 1;
      case "future":
        return 2;
      default:
        return 3;
    }
  };
  return [...items].sort((a, b) => {
    const bucketDelta = bucketRank(a) - bucketRank(b);
    if (bucketDelta !== 0) return bucketDelta;
    if (isIsoDate(a.dueOn) && isIsoDate(b.dueOn) && a.dueOn !== b.dueOn) {
      return a.dueOn.localeCompare(b.dueOn);
    }
    if (a.projectName !== b.projectName) {
      return (a.projectName ?? "").localeCompare(b.projectName ?? "");
    }
    return a.title.localeCompare(b.title);
  });
}

function countTodosByProject(items: PmosProjectTodoItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.projectId) continue;
    counts.set(item.projectId, (counts.get(item.projectId) ?? 0) + 1);
  }
  return counts;
}

function isAbortLikeError(error: string | null | undefined): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return lower.includes("aborted") || lower.includes("aborterror") || lower.includes("timed out");
}

function rankProjectDetailCandidates(
  projects: Array<{ id: string; name: string; status: string; appUrl: string | null }>,
  aggregates: Map<string, { openTodos: number; overdueTodos: number; dueTodayTodos: number }>,
  assignedByProject: Map<string, number>,
  limit: number,
): Array<{ id: string; name: string; status: string; appUrl: string | null }> {
  return [...projects]
    .sort((a, b) => {
      const aAgg = aggregates.get(a.id) ?? { openTodos: 0, overdueTodos: 0, dueTodayTodos: 0 };
      const bAgg = aggregates.get(b.id) ?? { openTodos: 0, overdueTodos: 0, dueTodayTodos: 0 };
      const aAssigned = assignedByProject.get(a.id) ?? 0;
      const bAssigned = assignedByProject.get(b.id) ?? 0;
      if (bAssigned !== aAssigned) return bAssigned - aAssigned;
      if (bAgg.overdueTodos !== aAgg.overdueTodos) return bAgg.overdueTodos - aAgg.overdueTodos;
      if (bAgg.dueTodayTodos !== aAgg.dueTodayTodos) return bAgg.dueTodayTodos - aAgg.dueTodayTodos;
      if (bAgg.openTodos !== aAgg.openTodos) return bAgg.openTodos - aAgg.openTodos;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

function projectHealthFromCounts(counts: {
  openTodos: number;
  overdueTodos: number;
  dueTodayTodos: number;
}): PmosProjectHealth {
  if (counts.overdueTodos > 0) return "at_risk";
  if (counts.dueTodayTodos > 0 || counts.openTodos >= 12) return "attention";
  if (counts.openTodos === 0) return "quiet";
  return "on_track";
}

function mapWorkspaceSnapshotTodoItems(items: unknown): PmosProjectTodoItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => isJsonObject(item))
    .map((item) => ({
      id: numberStringOrNull(item.id) ?? numberStringOrNull(item.todoId),
      title: stringOrNull(item.title) ?? "Untitled todo",
      status: stringOrNull(item.status),
      dueOn: stringOrNull(item.dueOn) ?? stringOrNull(item.due_on),
      projectId: numberStringOrNull(item.projectId),
      projectName: stringOrNull(item.projectName),
      appUrl: stringOrNull(item.appUrl) ?? stringOrNull(item.app_url),
    }))
    .filter((item) => item.title);
}

function mapWorkspaceSnapshotProjectCards(items: unknown): PmosProjectCard[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => isJsonObject(item))
    .map((item) => {
      const projectId = numberStringOrNull(item.projectId) ?? numberStringOrNull(item.id) ?? "";
      const projectName = stringOrNull(item.name) ?? "Unnamed project";
      const openTodos = typeof item.openTodosCount === "number"
        ? item.openTodosCount
        : typeof item.openTodos === "number"
          ? item.openTodos
          : 0;
      const overdueTodos = typeof item.overdueTodosCount === "number"
        ? item.overdueTodosCount
        : typeof item.overdueTodos === "number"
          ? item.overdueTodos
          : 0;
      const dueTodayTodos = typeof item.dueTodayTodosCount === "number"
        ? item.dueTodayTodosCount
        : typeof item.dueTodayTodos === "number"
          ? item.dueTodayTodos
          : 0;
      return {
        id: projectId,
        name: projectName,
        status: stringOrNull(item.status) ?? "active",
        appUrl: stringOrNull(item.appUrl) ?? stringOrNull(item.app_url),
        description: stringOrNull(item.description),
        updatedAt: stringOrNull(item.updatedAt) ?? stringOrNull(item.updated_at),
        dockCapabilities: Array.isArray(item.dock_capabilities)
          ? item.dock_capabilities
              .filter((entry): entry is Record<string, unknown> => isJsonObject(entry))
              .map((entry) => ({
                id: numberStringOrNull(entry.id),
                name: stringOrNull(entry.name),
                title: stringOrNull(entry.title),
                enabled: entry.enabled !== false,
                position: typeof entry.position === "number" ? entry.position : null,
                url: stringOrNull(entry.url),
                appUrl: stringOrNull(entry.app_url) ?? stringOrNull(entry.appUrl),
              }))
          : [],
        todoLists: typeof item.todoListsCount === "number"
          ? item.todoListsCount
          : typeof item.todoLists === "number"
            ? item.todoLists
            : 0,
        openTodos,
        assignedTodos: typeof item.assignedTodosCount === "number"
          ? item.assignedTodosCount
          : typeof item.assignedTodos === "number"
            ? item.assignedTodos
            : 0,
        overdueTodos,
        dueTodayTodos,
        futureTodos: typeof item.futureTodosCount === "number"
          ? item.futureTodosCount
          : typeof item.futureTodos === "number"
            ? item.futureTodos
            : 0,
        noDueDateTodos: typeof item.noDueDateTodosCount === "number"
          ? item.noDueDateTodosCount
          : typeof item.noDueDateTodos === "number"
            ? item.noDueDateTodos
            : 0,
        nextDueOn: stringOrNull(item.nextDueOn) ?? stringOrNull(item.next_due_on),
        health: (() => {
          const value = stringOrNull(item.health);
          if (value === "at_risk" || value === "attention" || value === "on_track" || value === "quiet") {
            return value;
          }
          return projectHealthFromCounts({ openTodos, overdueTodos, dueTodayTodos });
        })(),
        previewTodos: mapWorkspaceSnapshotTodoItems(item.previewTodos).map((todo) => ({
          ...todo,
          projectId: todo.projectId ?? projectId,
          projectName: todo.projectName ?? projectName,
        })),
      };
    })
    .filter((item) => item.id && item.name);
}

function mergeWorkspaceSnapshotProjectCards(
  summaryCards: PmosProjectCard[],
  detailCards: PmosProjectCard[],
): PmosProjectCard[] {
  if (!detailCards.length) return summaryCards;
  const summaryById = new Map(summaryCards.map((card) => [card.id, card]));
  const merged = detailCards.map((detail) => {
    const summary = summaryById.get(detail.id);
    if (!summary) return detail;
    return {
      ...summary,
      ...detail,
      todoLists: summary.todoLists,
      openTodos: summary.openTodos,
      assignedTodos: summary.assignedTodos,
      overdueTodos: summary.overdueTodos,
      dueTodayTodos: summary.dueTodayTodos,
      futureTodos: summary.futureTodos,
      noDueDateTodos: summary.noDueDateTodos,
      nextDueOn: summary.nextDueOn,
      health: summary.health,
      previewTodos: summary.previewTodos,
      description: detail.description ?? summary.description,
      updatedAt: detail.updatedAt ?? summary.updatedAt,
      dockCapabilities: detail.dockCapabilities.length ? detail.dockCapabilities : summary.dockCapabilities,
    };
  });
  summaryCards.forEach((summary) => {
    if (!merged.some((card) => card.id === summary.id)) merged.push(summary);
  });
  return merged;
}

function pickEntitySummary(detail: Record<string, unknown>) {
  return stringOrNull(detail.title)
    ?? stringOrNull(detail.name)
    ?? stringOrNull(detail.subject)
    ?? stringOrNull(detail.content)
    ?? stringOrNull(detail.description)
    ?? "(untitled)";
}

function pickEntitySnippet(detail: Record<string, unknown>) {
  return stringOrNull(detail.content)
    ?? stringOrNull(detail.description)
    ?? stringOrNull(detail.excerpt)
    ?? stringOrNull(detail.summary)
    ?? stringOrNull(detail.content_preview)
    ?? stringOrNull(detail.contentPreview);
}

function formatTodoDueLabel(todo: PmosProjectTodoItem, todayIso: string): string {
  if (!todo.dueOn) return "no due date";
  if (todo.dueOn < todayIso) return `overdue ${todo.dueOn}`;
  if (todo.dueOn === todayIso) return "due today";
  return `due ${todo.dueOn}`;
}

function todoProjectLabelForReply(todo: PmosProjectTodoItem): string {
  return todo.projectName || (todo.projectId ? `Project ${todo.projectId}` : "Unknown project");
}

function formatTodoBullet(todo: PmosProjectTodoItem, todayIso: string): string {
  return `- ${todoProjectLabelForReply(todo)}: ${todo.title} (${formatTodoDueLabel(todo, todayIso)})`;
}

function renderTodoDigest(params: {
  title: string;
  items: PmosProjectTodoItem[];
  emptyMessage: string;
  nextStep: string;
  todayIso: string;
  limit?: number;
}): string {
  const sorted = sortTodoItems(params.items, params.todayIso);
  const lines = [`${params.title}: ${sorted.length}.`, ""];
  if (!sorted.length) {
    lines.push(params.emptyMessage);
  } else {
    lines.push(...sorted.slice(0, params.limit ?? 8).map((todo) => formatTodoBullet(todo, params.todayIso)));
  }
  lines.push("", `Next step: ${params.nextStep}`);
  return lines.join("\n");
}

function renderAssignedTodoReply(
  shortcut: Extract<DirectBasecampChatShortcut, { kind: "assigned" }>,
  items: PmosProjectTodoItem[],
): string {
  const todayIso = new Date().toISOString().slice(0, 10);
  const overdue = items.filter((todo) => classifyTodoDueBucket(todo.dueOn, todayIso) === "past");
  const dueToday = items.filter((todo) => classifyTodoDueBucket(todo.dueOn, todayIso) === "today");
  const future = items.filter((todo) => classifyTodoDueBucket(todo.dueOn, todayIso) === "future");
  const noDueDate = items.filter((todo) => classifyTodoDueBucket(todo.dueOn, todayIso) === "none");

  if (shortcut.filter === "overdue") {
    return renderTodoDigest({
      title: "Your overdue Basecamp todos",
      items: overdue,
      emptyMessage: "Nothing assigned to you is overdue right now.",
      nextStep: "Open the first overdue item and either finish it or move the due date today.",
      todayIso,
    });
  }

  if (shortcut.filter === "date" && shortcut.filterDate) {
    const matching = items.filter((todo) => todo.dueOn === shortcut.filterDate);
    const label = shortcut.filterLabel ?? shortcut.filterDate;
    return renderTodoDigest({
      title: `Your Basecamp todos for ${label}`,
      items: matching,
      emptyMessage: `You do not have any assigned todos due ${label}.`,
      nextStep: `Open the first item due ${label} and confirm it is still realistic.`,
      todayIso,
    });
  }

  const priority = [...sortTodoItems(overdue, todayIso), ...sortTodoItems(dueToday, todayIso)]
    .concat(sortTodoItems(future, todayIso))
    .concat(sortTodoItems(noDueDate, todayIso))
    .slice(0, 8);

  const lines = [`Your Basecamp queue at a glance: ${items.length} open assigned todos.`, ""];
  lines.push(`- Overdue: ${overdue.length}`);
  lines.push(`- Due today: ${dueToday.length}`);
  lines.push(`- Upcoming: ${future.length}`);
  lines.push(`- No due date: ${noDueDate.length}`);
  if (priority.length) {
    lines.push("", "Start with:");
    lines.push(...priority.map((todo) => formatTodoBullet(todo, todayIso)));
  }
  lines.push(
    "",
    "Next step: Open the first overdue item, then clear today's due list before pulling future work forward.",
  );
  return lines.join("\n");
}

function parseTodoListRows(result: unknown): {
  projectName: string | null;
  rows: Array<{ name: string; openCount: number | null }>;
} {
  const payload = isJsonObject(result) ? result : null;
  const root = isJsonObject(payload?.result) ? payload.result : payload;
  const rows = Array.isArray(root?.todolists)
    ? root.todolists
        .filter((item): item is Record<string, unknown> => isJsonObject(item))
        .map((item) => ({
          name: stringOrNull(item.name) ?? stringOrNull(item.title) ?? "",
          openCount:
            parseCompletedRatio(stringOrNull(item.completed_ratio))?.open ??
            (typeof item.todos_count === "number" ? item.todos_count : null),
        }))
        .filter((item) => item.name)
    : [];
  return {
    projectName: stringOrNull(isJsonObject(root?.project) ? root.project.name : null),
    rows,
  };
}

function renderTodoListReply(result: unknown): string {
  const parsed = parseTodoListRows(result);
  const projectName = parsed.projectName ?? "This project";
  const lines = [`${projectName} has ${parsed.rows.length} todo list${parsed.rows.length === 1 ? "" : "s"}.`, ""];
  if (!parsed.rows.length) {
    lines.push("No todo lists were returned for this project.");
  } else {
    lines.push(
      ...parsed.rows
        .slice(0, 12)
        .map((row) => `- ${row.name}${typeof row.openCount === "number" ? `: ${row.openCount} open` : ""}`),
    );
  }
  lines.push("", "Next step: Open the list with the highest open count and clear the first stuck item.");
  return lines.join("\n");
}

function renderProjectTodoGroupsReply(result: unknown): string {
  const payload = isJsonObject(result) ? result : null;
  const root = isJsonObject(payload?.result) ? payload.result : payload;
  const projectName = stringOrNull(isJsonObject(root?.project) ? root.project.name : null) ?? "This project";
  const groups = Array.isArray(root?.groups)
    ? root.groups
        .filter((item): item is Record<string, unknown> => isJsonObject(item))
        .map((item) => ({
          name: stringOrNull(item.todolist) ?? stringOrNull(item.name) ?? "",
          openCount:
            typeof item.todos_count === "number"
              ? item.todos_count
              : typeof item.count === "number"
                ? item.count
                : 0,
        }))
        .filter((item) => item.name)
    : [];
  const totalOpen = groups.reduce((sum, group) => sum + group.openCount, 0);
  const lines = [`${projectName} has ${totalOpen} open todo${totalOpen === 1 ? "" : "s"} across ${groups.length} list${groups.length === 1 ? "" : "s"}.`, ""];
  if (!groups.length) {
    lines.push("No open todo groups were returned for this project.");
  } else {
    lines.push(...groups.slice(0, 12).map((group) => `- ${group.name}: ${group.openCount} open`));
  }
  lines.push("", "Next step: Open the busiest list first and clear the oldest blocked item.");
  return lines.join("\n");
}

function renderProjectPeopleReply(result: unknown): string {
  const payload = isJsonObject(result) ? result : null;
  const root = isJsonObject(payload?.result) ? payload.result : payload;
  const projectName = stringOrNull(isJsonObject(root?.project) ? root.project.name : null) ?? "This project";
  const people = Array.isArray(root?.people)
    ? root.people
        .filter((item): item is Record<string, unknown> => isJsonObject(item))
        .map((item) => ({
          name: stringOrNull(item.name) ?? "(unknown)",
          email: stringOrNull(item.email) ?? stringOrNull(item.email_address),
        }))
    : [];
  const lines = [`${projectName} team (${people.length}):`, ""];
  if (!people.length) {
    lines.push("No project people were returned.");
  } else {
    lines.push(
      ...people
        .slice(0, 16)
        .map((person) => `- ${person.name}${person.email ? ` - ${person.email}` : ""}`),
    );
  }
  lines.push("", "Next step: Tell me which teammate you want to inspect and I'll pull their tasks or recent activity.");
  return lines.join("\n");
}

function renderScheduleReply(result: unknown): string {
  const payload = isJsonObject(result) ? result : null;
  const root = isJsonObject(payload?.result) ? payload.result : payload;
  const projectName = stringOrNull(isJsonObject(root?.project) ? root.project.name : null) ?? "This project";
  const entries = Array.isArray(root?.schedule_entries)
    ? root.schedule_entries
        .filter((item): item is Record<string, unknown> => isJsonObject(item))
        .map((item) => ({
          title: stringOrNull(item.title) ?? "(untitled)",
          startsAt: stringOrNull(item.starts_at) ?? stringOrNull(item.startsAt),
          appUrl: stringOrNull(item.app_url) ?? stringOrNull(item.appUrl),
        }))
        .sort((left, right) => (left.startsAt ?? "9999").localeCompare(right.startsAt ?? "9999"))
    : [];
  const lines = [`${projectName} upcoming schedule (${entries.length}):`, ""];
  if (!entries.length) {
    lines.push("No schedule entries were returned.");
  } else {
    lines.push(
      ...entries
        .slice(0, 10)
        .map((entry) => `- ${entry.title}${entry.startsAt ? ` - ${entry.startsAt}` : ""}`),
    );
  }
  lines.push("", "Next step: Open the next event and confirm the owner, date, and any prep work.");
  return lines.join("\n");
}

function renderProjectListReply(result: unknown): string {
  const projects = parseProjectList(result);
  const lines = [`You have ${projects.length} Basecamp project${projects.length === 1 ? "" : "s"} available.`, ""];
  if (!projects.length) {
    lines.push("No live Basecamp projects were returned.");
  } else {
    lines.push(...projects.slice(0, 12).map((project) => `- ${project.name} (${project.status})`));
  }
  lines.push("", "Next step: Tell me which project you want to inspect and I'll drill into its tasks, people, messages, or schedule.");
  return lines.join("\n");
}

function renderWorkspaceSnapshotReply(result: unknown): string {
  const payload = isJsonObject(result) ? result : null;
  const root = isJsonObject(payload?.result) ? payload.result : payload;
  const totals = isJsonObject(root?.totals) ? root.totals : null;
  const projects = mapWorkspaceSnapshotProjectCards(root?.projects);
  const urgentTodos = mapWorkspaceSnapshotTodoItems(root?.urgentTodos);
  const dueTodayTodos = mapWorkspaceSnapshotTodoItems(root?.dueTodayTodos);
  const lines = [
    `Basecamp workspace pulse: ${typeof totals?.openTodos === "number" ? totals.openTodos : 0} open todos across ${typeof totals?.projectCount === "number" ? totals.projectCount : projects.length} projects.`,
    "",
    `- Assigned to you: ${typeof totals?.assignedTodos === "number" ? totals.assignedTodos : 0}`,
    `- Overdue: ${typeof totals?.overdueTodos === "number" ? totals.overdueTodos : urgentTodos.length}`,
    `- Due today: ${typeof totals?.dueTodayTodos === "number" ? totals.dueTodayTodos : dueTodayTodos.length}`,
  ];
  if (projects.length) {
    lines.push("", "Needs attention:");
    lines.push(
      ...projects
        .slice(0, 5)
        .map(
          (project) =>
            `- ${project.name}: ${project.overdueTodos} overdue, ${project.dueTodayTodos} due today, ${project.openTodos} open`,
        ),
    );
  }
  const priority = [...urgentTodos, ...dueTodayTodos].slice(0, 6);
  if (priority.length) {
    const todayIso = new Date().toISOString().slice(0, 10);
    lines.push("", "Priority items:");
    lines.push(...priority.map((todo) => formatTodoBullet(todo, todayIso)));
  }
  // Resource counts from the full dock sync
  const rc = isJsonObject(root?.resourceCounts) ? root.resourceCounts : null;
  if (rc) {
    const parts: string[] = [];
    if (typeof rc.messages === "number" && rc.messages > 0) parts.push(`${rc.messages} messages`);
    if (typeof rc.scheduleEntries === "number" && rc.scheduleEntries > 0) parts.push(`${rc.scheduleEntries} schedule entries`);
    if (typeof rc.cards === "number" && rc.cards > 0) parts.push(`${rc.cards} cards`);
    if (typeof rc.documents === "number" && rc.documents > 0) parts.push(`${rc.documents} documents`);
    if (typeof rc.people === "number" && rc.people > 0) parts.push(`${rc.people} people`);
    if (parts.length) {
      lines.push("", `Also synced: ${parts.join(", ")}.`);
    }
  }
  lines.push("", "Next step: Start with the first at-risk project and clear its oldest overdue item.");
  return lines.join("\n");
}

function renderMessagesReply(result: unknown): string {
  const payload = isJsonObject(result) ? result : null;
  const root = isJsonObject(payload?.result) ? payload.result : payload;
  const projectName = stringOrNull(isJsonObject(root?.project) ? root.project.name : null) ?? "This project";
  const messages = Array.isArray(root?.messages) ? root.messages : [];
  const items = messages
    .filter((m): m is Record<string, unknown> => isJsonObject(m))
    .map((m) => ({
      subject: stringOrNull(m.subject) ?? stringOrNull(m.title) ?? "(no subject)",
      creator: stringOrNull(m.creator_name) ?? (isJsonObject(m.creator) ? stringOrNull(m.creator.name) : null) ?? "",
      date: stringOrNull(m.created_at)?.slice(0, 10) ?? "",
    }));
  const lines = [`${projectName} messages (${items.length}):`, ""];
  if (!items.length) {
    lines.push("No messages found on the message board.");
  } else {
    lines.push(
      ...items.slice(0, 15).map((m) => `- ${m.subject}${m.creator ? ` (${m.creator})` : ""}${m.date ? ` -- ${m.date}` : ""}`),
    );
    if (items.length > 15) lines.push(`... and ${items.length - 15} more`);
  }
  lines.push("", "Next step: Tell me which message you want to read in full, or ask to create a new message.");
  return lines.join("\n");
}

function renderCardsReply(result: unknown): string {
  const payload = isJsonObject(result) ? result : null;
  const root = isJsonObject(payload?.result) ? payload.result : payload;
  const projectName = stringOrNull(isJsonObject(root?.project) ? root.project.name : null) ?? "This project";
  const tables = Array.isArray(root?.card_tables) ? root.card_tables : [];
  const lines = [`${projectName} card tables (${tables.length}):`, ""];
  if (!tables.length) {
    lines.push("No card tables (kanban boards) found.");
  } else {
    for (const t of tables.slice(0, 5)) {
      if (!isJsonObject(t)) continue;
      const title = stringOrNull(t.title) ?? "(untitled)";
      const columns = Array.isArray(t.lists) ? t.lists : [];
      const cardCount = columns.reduce((sum: number, col: unknown) => {
        if (!isJsonObject(col)) return sum;
        return sum + (Array.isArray(col.cards) ? col.cards.length : 0);
      }, 0);
      lines.push(`## ${title} (${cardCount} cards)`);
      for (const col of columns.slice(0, 8)) {
        if (!isJsonObject(col)) continue;
        const colName = stringOrNull(col.title) ?? stringOrNull(col.name) ?? "Column";
        const colCards = Array.isArray(col.cards) ? col.cards.length : 0;
        lines.push(`  - ${colName}: ${colCards} cards`);
      }
    }
  }
  lines.push("", "Next step: Tell me which column or card you want details on, or ask to create or move a card.");
  return lines.join("\n");
}

function renderDocumentsReply(result: unknown): string {
  const payload = isJsonObject(result) ? result : null;
  const root = isJsonObject(payload?.result) ? payload.result : payload;
  const projectName = stringOrNull(isJsonObject(root?.project) ? root.project.name : null) ?? "This project";
  const docs = Array.isArray(root?.documents) ? root.documents : [];
  const items = docs
    .filter((d): d is Record<string, unknown> => isJsonObject(d))
    .map((d) => ({
      title: stringOrNull(d.title) ?? "(untitled)",
      updatedAt: stringOrNull(d.updated_at)?.slice(0, 10) ?? "",
    }));
  const lines = [`${projectName} documents (${items.length}):`, ""];
  if (!items.length) {
    lines.push("No documents found in the vault.");
  } else {
    lines.push(
      ...items.slice(0, 15).map((d) => `- ${d.title}${d.updatedAt ? ` (updated ${d.updatedAt})` : ""}`),
    );
    if (items.length > 15) lines.push(`... and ${items.length - 15} more`);
  }
  lines.push("", "Next step: Tell me which document you want to read, or ask to create a new one.");
  return lines.join("\n");
}

function renderDirectBasecampShortcutReply(
  shortcut: DirectBasecampChatShortcut,
  result: unknown,
  latestUserMessage: string,
): string {
  switch (shortcut.kind) {
    case "assigned": {
      const items = parseTodoItems(result, "todos", new Map<string, string>());
      return renderAssignedTodoReply(shortcut, items);
    }
    case "due_date": {
      const items = parseTodoItems(result, "todos", new Map<string, string>());
      const todayIso = new Date().toISOString().slice(0, 10);
      const label = shortcut.filterLabel ?? shortcut.filterDate;
      return renderTodoDigest({
        title: `Basecamp todos for ${label}`,
        items,
        emptyMessage: `No todos are due ${label}.`,
        nextStep: `Open the first item due ${label} and confirm the owner and status.`,
        todayIso,
      });
    }
    case "overdue": {
      const todayIso = shortcut.anchorDate;
      const primaryKey = shortcut.toolName === "report_todos_overdue" ? "overdue" : "todos";
      let items = parseTodoItems(result, primaryKey, new Map<string, string>());
      // Fallback: older MCP versions may use "todos" key even for overdue reports
      if (items.length === 0 && primaryKey !== "todos") {
        items = parseTodoItems(result, "todos", new Map<string, string>());
      }
      items = items.filter((todo) => classifyTodoDueBucket(todo.dueOn, todayIso) === "past");
      return renderTodoDigest({
        title: shortcut.projectName
          ? `${shortcut.projectName} overdue Basecamp todos`
          : "Overdue Basecamp todos",
        items,
        emptyMessage: shortcut.projectName
          ? `Nothing is overdue in ${shortcut.projectName} right now.`
          : "Nothing is overdue in Basecamp right now.",
        nextStep: "Open the oldest overdue item first and either finish it or move the date.",
        todayIso,
      });
    }
    case "project_list":
      return renderProjectListReply(result);
    case "project_todolists":
      return renderTodoListReply(result);
    case "project_todos":
      return renderProjectTodoGroupsReply(result);
    case "project_people":
      return renderProjectPeopleReply(result);
    case "project_schedule":
      return renderScheduleReply(result);
    case "project_messages":
      return renderMessagesReply(result);
    case "project_cards":
      return renderCardsReply(result);
    case "project_documents":
      return renderDocumentsReply(result);
    case "workspace_snapshot":
      return renderWorkspaceSnapshotReply(result);
    case "inspect_url":
    case "project_summary": {
      const summary = summarizeBcgptSmartActionResult(
        latestUserMessage,
        "projectName" in shortcut ? shortcut.projectName ?? null : null,
        result,
      );
      return `${summary}\n\nNext step: Tell me if you want the raw item details, comments, or related tasks next.`;
    }
  }

  return summarizeBcgptDirectToolResult("smart_action", result);
}

async function maybeHandleDirectBasecampShortcut(params: {
  workspaceId: string;
  latestUserMessage: string;
  shortcut: DirectBasecampChatShortcut;
}): Promise<string | null> {
  const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
    workspaceId: params.workspaceId,
    allowGlobalSecrets: true,
  });
  if (!apiKey) {
    return "Basecamp integration is not configured for this workspace.\n\nNext step: Open Integrations and save the workspace Basecamp connection key.";
  }

  const primary = await callBcgptTool({
    bcgptUrl,
    apiKey,
    toolName: params.shortcut.toolName,
    toolArgs: params.shortcut.toolArgs,
    timeoutMs: 45_000,
  });
  if (primary.ok) {
    return renderDirectBasecampShortcutReply(
      params.shortcut,
      primary.result,
      params.latestUserMessage,
    );
  }

  if (params.shortcut.toolName === "smart_action") {
    return null;
  }

  const fallbackToolArgs: Record<string, unknown> = {
    query: params.latestUserMessage,
  };
  if ("projectName" in params.shortcut && params.shortcut.projectName) {
    fallbackToolArgs.project = params.shortcut.projectName;
  }
  const fallback = await callBcgptTool({
    bcgptUrl,
    apiKey,
    toolName: "smart_action",
    toolArgs: fallbackToolArgs,
    timeoutMs: 45_000,
  });
  if (!fallback.ok) {
    return null;
  }

  const smartShortcut: DirectBasecampChatShortcut =
    "projectName" in params.shortcut && params.shortcut.projectName
      ? {
          kind: "project_summary",
          toolName: "smart_action",
          toolArgs: {
            query: params.latestUserMessage,
            project: params.shortcut.projectName,
          },
          projectName: params.shortcut.projectName,
        }
      : {
          kind: "inspect_url",
          toolName: "smart_action",
          toolArgs: { query: params.latestUserMessage },
        };

  return renderDirectBasecampShortcutReply(
    smartShortcut,
    fallback.result,
    params.latestUserMessage,
  );
}

export const pmosHandlers: GatewayRequestHandlers = {
  "pmos.connectors.status": async ({ respond, client }) => {
    try {
      const cfg = loadConfig() as unknown;

      // --- lookup workspace-scoped connectors (override global config when present)
      // workspace connectors live at: ~/.openclaw/workspaces/{workspaceId}/connectors.json
      // readWorkspaceConnectors returns null when not present.
      // NOTE: prefer workspace-specific entries when available.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
      const workspaceId = client?.pmosWorkspaceId ?? undefined;
      const workspaceConnectors = workspaceId ? await readWorkspaceConnectors(workspaceId) : null;

      const allowGlobalSecrets = Boolean(client && isSuperAdmin(client));
      const opsUrlRaw =
        (workspaceConnectors?.ops?.url as string | undefined) ??
        readConfigString(cfg, ["pmos", "connectors", "ops", "url"]) ??
        process.env.ACTIVEPIECES_URL ??
        process.env.FLOW_URL ??
        process.env.OPS_URL ??
        null;
      const opsUrl = normalizeBaseUrl(opsUrlRaw, "https://flow.wickedlab.io");
      const opsProjectId =
        (workspaceConnectors?.ops?.projectId as string | undefined) ??
        (allowGlobalSecrets ? readConfigString(cfg, ["pmos", "connectors", "ops", "projectId"]) : null) ??
        process.env.ACTIVEPIECES_PROJECT_ID ??
        null;
      const workspaceOpsApiKey = (workspaceConnectors?.ops?.apiKey as string | undefined)?.trim() || null;
      const globalOpsApiKey =
        readConfigString(cfg, ["pmos", "connectors", "ops", "apiKey"])?.trim() ??
        (process.env.ACTIVEPIECES_API_KEY?.trim() || process.env.OPS_API_KEY?.trim() || null);
      const opsApiKey = workspaceOpsApiKey ?? (allowGlobalSecrets ? globalOpsApiKey : null);

      const bcgptUrl = normalizeBaseUrl(
        (workspaceConnectors?.bcgpt?.url as string | undefined) ??
          readConfigString(cfg, ["pmos", "connectors", "bcgpt", "url"]) ??
          process.env.BCGPT_URL ??
          null,
        "https://bcgpt.wickedlab.io",
      );
      // Resolve bcgpt key: workspace-scoped first, then global shared key (env / global config).
      // Every workspace gets the shared key for connection-check purposes; the key value
      // is NEVER sent back to the client in the response.
      const workspaceBcgptKey = (workspaceConnectors?.bcgpt?.apiKey as string | undefined)?.trim() || null;
      const globalBcgptKey =
        readConfigString(cfg, ["pmos", "connectors", "bcgpt", "apiKey"])?.trim() ??
        (process.env.BCGPT_API_KEY?.trim() || null);
      const bcgptKey = workspaceBcgptKey ?? globalBcgptKey;
      const bcgptKeyIsShared = !workspaceBcgptKey && Boolean(globalBcgptKey);

      // Keep Basecamp app-connection provisioned automatically for workspace keys.
      // This is best-effort and should never fail connector status.
      if (workspaceId && workspaceBcgptKey) {
        const { ensureWorkspaceBasecampCredential } = await import("../credential-sync.js");
        await ensureWorkspaceBasecampCredential(workspaceId).catch(() => undefined);
      }

      const ops: ConnectorResult = {
        url: opsUrl,
        projectId: opsProjectId,
        configured: Boolean((opsUrlRaw && opsUrlRaw.trim()) || opsApiKey),
        reachable: null,
        authOk: null,
        mode: "remote",
        editorUrl: "/ops-ui/",
        vendoredRepo: null,
        healthUrl: `${opsUrl}/api/v1/flags`,
        error: null,
      };

      const bcgpt: ConnectorResult & { shared?: boolean } = {
        url: bcgptUrl,
        configured: Boolean(bcgptKey),
        reachable: null,
        authOk: bcgptKey ? null : false,
        healthUrl: `${bcgptUrl}/health`,
        mcpUrl: `${bcgptUrl}/mcp`,
        error: null,
        // shared=true means connection is via server-wide key, not workspace-scoped
        ...(bcgptKeyIsShared ? { shared: true } : {}),
      };
      const figmaConnector = isJsonObject(workspaceConnectors?.figma)
        ? (workspaceConnectors?.figma as Record<string, unknown>)
        : {};
      const figmaIdentity = isJsonObject(figmaConnector.identity)
        ? (figmaConnector.identity as Record<string, unknown>)
        : {};
      const figmaUrlRaw =
        (typeof figmaConnector.url === "string" ? figmaConnector.url : null) ??
        readConfigString(cfg, ["pmos", "connectors", "figma", "url"]);
      const figmaUrl = normalizeBaseUrl(figmaUrlRaw, "https://fm.wickedlab.io");
      const figma: ConnectorResult = {
        url: figmaUrl,
        configured: Boolean(figmaUrlRaw && figmaUrlRaw.trim()),
        reachable: null,
        authOk: typeof figmaIdentity.connected === "boolean" ? figmaIdentity.connected : null,
        healthUrl: `${figmaUrl}/api/pmos/health`,
        editorUrl: figmaUrl,
        error: null,
        identity:
          Object.keys(figmaIdentity).length > 0
            ? {
                connected: figmaIdentity.connected === true,
                handle: typeof figmaIdentity.handle === "string" ? figmaIdentity.handle : null,
                email: typeof figmaIdentity.email === "string" ? figmaIdentity.email : null,
                activeConnectionId:
                  typeof figmaIdentity.activeConnectionId === "string"
                    ? figmaIdentity.activeConnectionId
                    : typeof figmaIdentity.activeConnectionId === "number"
                      ? String(figmaIdentity.activeConnectionId)
                      : null,
                activeConnectionName:
                  typeof figmaIdentity.activeConnectionName === "string"
                    ? figmaIdentity.activeConnectionName
                    : null,
                activeTeamId:
                  typeof figmaIdentity.activeTeamId === "string" ? figmaIdentity.activeTeamId : null,
                totalConnections:
                  typeof figmaIdentity.totalConnections === "number"
                    ? figmaIdentity.totalConnections
                    : undefined,
                lastSyncedAt:
                  typeof figmaIdentity.lastSyncedAt === "string" ? figmaIdentity.lastSyncedAt : null,
                selectedFileUrl:
                  typeof figmaIdentity.selectedFileUrl === "string"
                    ? figmaIdentity.selectedFileUrl
                    : null,
                selectedFileId:
                  typeof figmaIdentity.selectedFileId === "string" ? figmaIdentity.selectedFileId : null,
                selectedFileName:
                  typeof figmaIdentity.selectedFileName === "string"
                    ? figmaIdentity.selectedFileName
                    : null,
                updatedAt:
                  typeof figmaIdentity.updatedAt === "string" ? figmaIdentity.updatedAt : null,
                message:
                  typeof figmaIdentity.message === "string"
                    ? figmaIdentity.message
                    : figmaIdentity.connected === true
                      ? "Synced from Figma File Manager."
                      : null,
              }
            : undefined,
      };
      const figmaMcp =
        workspaceId && (figma.configured || Object.keys(figmaIdentity).length > 0 || isJsonObject(figmaConnector.auth))
          ? await readWorkspaceFigmaOfficialMcpStatus(workspaceId)
          : ({
              url: stringOrNull(
                isJsonObject(figmaConnector.auth) ? figmaConnector.auth.mcpServerUrl : null,
              ) ?? "https://mcp.figma.com/mcp",
              configured: true,
              reachable: null,
              authOk: false,
              authRequired: true,
              configPath: null,
              transport: "streamable_http",
              source: stringOrNull(
                isJsonObject(figmaConnector.auth) ? figmaConnector.auth.source : null,
              ),
              hasPersonalAccessToken: false,
              fallbackAvailable: false,
              authCommand: null,
              error: "Official Figma MCP is ready to connect, but PMOS OAuth has not been completed yet.",
            } satisfies FigmaOfficialMcpStatus);
      figma.mcp = figmaMcp;

      if (opsUrlRaw && opsUrlRaw.trim()) {
        const remoteHealth = await fetchJson(`${opsUrl}/api/v1/flags`, { method: "GET", timeoutMs: 3500 });
        ops.reachable = remoteHealth.ok || isReachableStatus(remoteHealth.status);
        if (!ops.reachable) {
          ops.error = remoteHealth.error || "ACTIVEPIECES_UNREACHABLE";
        }
      }

      if (opsApiKey) {
        const authProbeQuery = new URLSearchParams();
        if (opsProjectId) {
          authProbeQuery.set("projectId", opsProjectId);
          authProbeQuery.set("limit", "1");
        }
        const authProbeEndpoint = opsProjectId
          ? `${opsUrl}/api/v1/flows?${authProbeQuery.toString()}`
          : `${opsUrl}/api/v1/projects`;
        const authProbe = await fetchJson(authProbeEndpoint, {
          method: "GET",
          timeoutMs: 5000,
          headers: {
            authorization: `Bearer ${opsApiKey}`,
          },
        });
        ops.authOk = authProbe.ok;
        if (!authProbe.ok && !ops.error) {
          ops.error = authProbe.error || "ACTIVEPIECES_AUTH_FAILED";
        }
      } else {
        ops.authOk = false;
      }

      // BCGPT reachability
      const bcgptHealth = await fetchJson(bcgpt.healthUrl!, { method: "GET" });
      bcgpt.reachable = bcgptHealth.ok;
      if (!bcgptHealth.ok) {
        bcgpt.error = bcgptHealth.error || "BCGPT_UNREACHABLE";
      }

      // BCGPT API key check (MCP tools/list is the lightest auth probe)
      if (bcgptKey) {
        const bcgptAuth = await fetchJson(bcgpt.mcpUrl!, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bcgpt-api-key": bcgptKey,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "pmos-connectors-status",
            method: "tools/list",
            params: {},
          }),
        });
        const json = bcgptAuth.json as { error?: unknown } | null;
        const hasError = Boolean(json && typeof json === "object" && "error" in json && json.error);
        bcgpt.authOk = bcgptAuth.ok && !hasError;
        if ((!bcgptAuth.ok || hasError) && !bcgpt.error) {
          bcgpt.error = bcgptAuth.error || "BCGPT_AUTH_FAILED";
        }

        // Fetch Basecamp identity/account status for richer UI cards.
        const bcgptIdentity = await fetchJson(`${bcgptUrl}/action/startbcgpt`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bcgpt-api-key": bcgptKey,
          },
          body: JSON.stringify({}),
        });
        if (bcgptIdentity.ok && isJsonObject(bcgptIdentity.json)) {
          const payload = bcgptIdentity.json as Record<string, unknown>;
          const user = isJsonObject(payload.user) ? payload.user : null;
          const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
          // connected=true means API key is valid; basecamp_connected=true means OAuth is also linked.
          // We report connected=true when the API key is recognized (payload.connected).
          const apiKeyOk = payload.connected === true;
          const basecampOk = payload.basecamp_connected === true;
          bcgpt.identity = {
            connected: apiKeyOk,
            basecampConnected: basecampOk,
            name: typeof user?.name === "string" ? user.name : null,
            email: typeof user?.email === "string" ? user.email : null,
            selectedAccountId:
              typeof payload.selected_account_id === "string" ||
              typeof payload.selected_account_id === "number"
                ? String(payload.selected_account_id)
                : null,
            accountsCount: accounts.length,
            message: typeof payload.message === "string" ? payload.message : null,
          };
        }
      }

      if (figma.configured) {
        const figmaHealth = await fetchJson(figma.healthUrl!, { method: "GET", timeoutMs: 3500 });
        figma.reachable = figmaHealth.ok || isReachableStatus(figmaHealth.status);
        if (!figma.reachable) {
          figma.error = figmaHealth.error || "FIGMA_MANAGER_UNREACHABLE";
        }
      }

      respond(
        true,
        {
          checkedAtMs: Date.now(),
          ops,
          bcgpt,
          figma,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  "pmos.figma.mcp.prepare": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const status = await readWorkspaceFigmaOfficialMcpStatus(workspaceId);
      respond(
        true,
        {
          ok: true,
          workspaceId,
          changed: false,
          configPath: null,
          status,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // Legacy compatibility hook. Startup auto-connect is intentionally disabled so
  // fresh sessions do not generate background Basecamp traffic.
  "pmos.bcgpt.autoconnect": async ({ respond, client }) => {
    respond(
      true,
      {
        ok: true,
        skipped: true,
        workspaceId: client?.pmosWorkspaceId ?? null,
        reason: "startup_autoconnect_disabled",
      },
      undefined,
    );
  },

  "pmos.config.global.get": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      if (!isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "super_admin role required"));
        return;
      }
      const config = loadConfig() as unknown;
      respond(
        true,
        { config: isJsonObject(config) ? config : {} },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.config.global.set": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      if (!isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "super_admin role required"));
        return;
      }
      const p = params as Record<string, unknown> | undefined;
      const patch = p?.patch;
      if (!isJsonObject(patch)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "patch must be an object"));
        return;
      }
      const replace = p?.replace === true;
      const current = loadConfig() as unknown;
      const base = isJsonObject(current) ? current : {};
      const merged = replace ? patch : deepMergeJson(base, patch);
      if (!isJsonObject(merged)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid config payload"));
        return;
      }
      await writeConfigFile(merged as OpenClawConfig);
      const next = loadConfig() as unknown;
      respond(
        true,
        { ok: true, config: isJsonObject(next) ? next : {} },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.config.workspace.get": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const target =
        typeof params?.workspaceId === "string" ? params.workspaceId.trim() : undefined;
      if (target && !isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "access denied"));
        return;
      }
      const workspaceId = target ?? requireWorkspaceId(client);
      const { readWorkspaceConfig, loadEffectiveWorkspaceConfig } = await import(
        "../workspace-config.js"
      );
      const workspaceConfig = (await readWorkspaceConfig(workspaceId)) ?? {};
      const effectiveConfig = await loadEffectiveWorkspaceConfig(workspaceId);
      const workspaceConfigForUi =
        client && !isSuperAdmin(client)
          ? stripLikelyInheritedWorkspaceOverlayClones(workspaceConfig, loadConfig())
          : workspaceConfig;
      respond(
        true,
        {
          workspaceId,
          workspaceConfig: sanitizeWorkspaceConfigResponse(client, workspaceConfigForUi, {
            filterAgents: true,
          }),
          // Use the raw (unstripped) workspaceConfig when filtering effectiveConfig so that
          // providers identical to global config are not incorrectly removed from the
          // effective config returned to the UI (stripping them would hide configured models).
          effectiveConfig: sanitizeWorkspaceConfigResponse(client, effectiveConfig, {
            filterAgents: true,
            workspaceConfig: workspaceConfig,
            filterSharedProvidersOnly: true,
          }),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.config.workspace.set": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const p = params as Record<string, unknown> | undefined;
      const target = typeof p?.workspaceId === "string" ? p.workspaceId.trim() : undefined;
      if (target && !isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "access denied"));
        return;
      }
      const workspaceId = target ?? requireWorkspaceId(client);
      const patch = p?.patch;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "patch must be an object"));
        return;
      }
      const replace = p?.replace === true;
      const { patchWorkspaceConfig, readWorkspaceConfig, writeWorkspaceConfig, loadEffectiveWorkspaceConfig } =
        await import("../workspace-config.js");
      const existingWorkspaceConfig = (await readWorkspaceConfig(workspaceId)) ?? {};
      let nextPatch: Record<string, unknown>;
      try {
        nextPatch = restoreRedactedValues(
          patch as Record<string, unknown>,
          existingWorkspaceConfig,
        ) as Record<string, unknown>;
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
        return;
      }
      const workspaceConfig = replace
        ? nextPatch
        : await patchWorkspaceConfig(workspaceId, nextPatch);
      if (replace) {
        await writeWorkspaceConfig(workspaceId, workspaceConfig);
      }
      const effectiveConfig = await loadEffectiveWorkspaceConfig(workspaceId);
      const workspaceConfigForUi =
        client && !isSuperAdmin(client)
          ? stripLikelyInheritedWorkspaceOverlayClones(workspaceConfig, loadConfig())
          : workspaceConfig;
      respond(
        true,
        {
          ok: true,
          workspaceId,
          workspaceConfig: sanitizeWorkspaceConfigResponse(client, workspaceConfigForUi, {
            filterAgents: true,
          }),
          // Use the raw (unstripped) workspaceConfig when filtering effectiveConfig so that
          // providers identical to global config are not incorrectly removed from the
          // effective config returned to the UI (stripping them would hide configured models).
          effectiveConfig: sanitizeWorkspaceConfigResponse(client, effectiveConfig, {
            filterAgents: true,
            workspaceConfig: workspaceConfig,
            filterSharedProvidersOnly: true,
          }),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.context.workspace.get": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const target = typeof params?.workspaceId === "string" ? params.workspaceId.trim() : undefined;
      if (target && !isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "access denied"));
        return;
      }
      const workspaceId = target ?? requireWorkspaceId(client);
      const { readWorkspaceAiContext, workspaceAiContextPath } = await import(
        "../workspace-ai-context.js"
      );
      const contextMarkdown = (await readWorkspaceAiContext(workspaceId)) ?? "";
      respond(
        true,
        {
          workspaceId,
          path: workspaceAiContextPath(workspaceId),
          context: contextMarkdown,
          exists: Boolean(contextMarkdown.trim()),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.context.workspace.refresh": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const target = typeof params?.workspaceId === "string" ? params.workspaceId.trim() : undefined;
      if (target && !isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "access denied"));
        return;
      }
      const workspaceId = target ?? requireWorkspaceId(client);
      const { refreshWorkspaceAiContext } = await import("../workspace-ai-context.js");
      const refreshed = await refreshWorkspaceAiContext(workspaceId, {
        includeLiveCredentials: true,
      });
      respond(
        true,
        {
          ok: true,
          workspaceId: refreshed.workspaceId,
          path: refreshed.path,
          generatedAt: refreshed.generatedAt,
          context: refreshed.markdown,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // Persist or read per-workspace connectors (workspace-admins can set for their workspace)
  "pmos.connectors.workspace.set": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      if (!params || typeof params !== "object") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params"));
        return;
      }
      // Accept a `connectors` object (partial). Merge with existing.
      const connectors = (params as Record<string, unknown>).connectors as Record<string, unknown> | undefined;
      if (!connectors || typeof connectors !== "object") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "connectors must be an object"));
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { readWorkspaceConnectors, writeWorkspaceConnectors } = await import("../workspace-connectors.js");
      const existing = (await readWorkspaceConnectors(workspaceId)) ?? {};
      const merged = deepMergeJson(existing, connectors as Record<string, unknown>);
      let next = isJsonObject(merged) ? merged : existing;

      const readTrimmed = (value: unknown): string | null => {
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed || null;
      };

      const existingObj = isJsonObject(existing) ? existing : {};
      const existingOpsConnector = isJsonObject(existingObj.ops)
        ? (existingObj.ops as Record<string, unknown>)
        : {};
      const existingActivepiecesConnector = isJsonObject(existingObj.activepieces)
        ? (existingObj.activepieces as Record<string, unknown>)
        : {};
      const existingOpsUser = isJsonObject(existingOpsConnector.user)
        ? (existingOpsConnector.user as Record<string, unknown>)
        : {};
      const existingActivepiecesUser = isJsonObject(existingActivepiecesConnector.user)
        ? (existingActivepiecesConnector.user as Record<string, unknown>)
        : {};
      const previousIdentityPassword =
        readTrimmed(existingActivepiecesUser.password) ?? readTrimmed(existingOpsUser.password) ?? "";

      const nextObj = isJsonObject(next) ? next : {};
      const opsConnector = isJsonObject(nextObj.ops) ? (nextObj.ops as Record<string, unknown>) : {};
      const activepiecesConnector = isJsonObject(nextObj.activepieces)
        ? (nextObj.activepieces as Record<string, unknown>)
        : {};
      const opsUser = isJsonObject(opsConnector.user) ? (opsConnector.user as Record<string, unknown>) : {};
      const activepiecesUser = isJsonObject(activepiecesConnector.user)
        ? (activepiecesConnector.user as Record<string, unknown>)
        : {};

      const identityEmail =
        (readTrimmed(activepiecesUser.email) ?? readTrimmed(opsUser.email) ?? "").toLowerCase();
      const identityPassword = readTrimmed(activepiecesUser.password) ?? readTrimmed(opsUser.password) ?? "";
      const activepiecesUrl =
        readTrimmed(activepiecesConnector.url) ??
        readTrimmed(opsConnector.url) ??
        "https://flow.wickedlab.io";

      if (identityEmail && identityPassword) {
        const mirrored = deepMergeJson(next, {
          ops: {
            url: activepiecesUrl,
            user: {
              email: identityEmail,
              password: identityPassword,
            },
          },
          activepieces: {
            url: activepiecesUrl,
            user: {
              email: identityEmail,
              password: identityPassword,
            },
          },
        });
        if (isJsonObject(mirrored)) {
          next = mirrored;
        }
      }

      await writeWorkspaceConnectors(workspaceId, next);
      if (identityEmail && identityPassword) {
        const { ensureActivepiecesCredentialParity } = await import("../pmos-auth-http.js");
        await ensureActivepiecesCredentialParity({
          baseUrl: activepiecesUrl,
          email: identityEmail,
          password: identityPassword,
          previousPassword: previousIdentityPassword || null,
        }).catch(() => undefined);
      }
      let workflowConnection:
        | {
            configured: boolean;
            ok: boolean;
            credentialId?: string;
            error?: string;
            skippedReason?: "missing_api_key";
          }
        | undefined;
      const workspaceBcgptApiKey =
        typeof (next as { bcgpt?: { apiKey?: unknown } } | null)?.bcgpt?.apiKey === "string"
          ? (next as { bcgpt?: { apiKey?: string } }).bcgpt?.apiKey?.trim() ?? ""
          : "";
      if (workspaceBcgptApiKey) {
        const { ensureWorkspaceBasecampCredential } = await import("../credential-sync.js");
        workflowConnection = await ensureWorkspaceBasecampCredential(workspaceId).catch((err) => ({
          configured: true,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      } else {
        workflowConnection = {
          configured: false,
          ok: false,
          skippedReason: "missing_api_key",
        };
      }
      const safeConnectors = isSuperAdmin(client)
        ? next
        : stripSensitiveUserCredentialsFromConnectors(next);
      respond(
        true,
        { ok: true, workspaceId, connectors: safeConnectors, workflowConnection },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.connectors.workspace.get": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const target = typeof params?.workspaceId === "string" ? params.workspaceId.trim() : undefined;
      // super_admin may request other workspace; non-super admins may only read their own
      if (target && !isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "access denied"));
        return;
      }
      const workspaceId = target ?? requireWorkspaceId(client);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
      const connectors = (await readWorkspaceConnectors(workspaceId)) ?? {};
      // Strip workflow-engine login passwords before returning connectors to non-super-admin clients.
      // api keys (ops.apiKey, bcgpt.apiKey) are kept as-is so the UI can display configured status.
      const safeConnectors = isSuperAdmin(client)
        ? connectors
        : stripSensitiveUserCredentialsFromConnectors(connectors);
      respond(true, { workspaceId, connectors: safeConnectors }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // Provision legacy remote n8n fallback credentials for a workspace when needed.
  // - Attempts to create a Project using the global OPS API key
  // - Attempts to create a workspace-scoped API key (if supported)
  // - Persists `ops.url`, `ops.apiKey` and `ops.projectId` into the workspace connectors file
  // - Returns { projectId?, apiKey? } on success; responds with an explanatory error on failure
  "pmos.connectors.workspace.provision_ops": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const projectName =
        typeof params?.projectName === "string" && params.projectName.trim()
          ? params.projectName.trim()
          : undefined;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { provisionWorkspaceOps } = await import("../pmos-provision-ops.js");
      const result = await provisionWorkspaceOps(workspaceId, projectName);
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // â"€â"€ BYOK (Bring Your Own Keys) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  "pmos.config.get": async ({ respond, client }) => {
    const workspaceId = client?.pmosWorkspaceId;
    if (!workspaceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "No workspace context"));
      return;
    }
    const { loadEffectiveWorkspaceConfig } = await import("../workspace-config.js");
    const config = await loadEffectiveWorkspaceConfig(workspaceId);
    // Redact sensitive fields before returning to non-super-admin clients.
    const safeConfig = client && isSuperAdmin(client) ? config : redactConfigObject(config);
    respond(true, { ok: true, config: safeConfig }, undefined);
  },

  "pmos.byok.list": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { listKeys } = await import("../byok-store.js");
      const keys = await listKeys(workspaceId);
      respond(true, { workspaceId, keys }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.byok.set": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as Record<string, unknown> | undefined;
      const provider = typeof p?.provider === "string" ? p.provider.trim() : "";
      const apiKey = typeof p?.apiKey === "string" ? p.apiKey.trim() : "";
      if (!provider || !apiKey) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "provider and apiKey are required"));
        return;
      }
      const label = typeof p?.label === "string" ? p.label.trim() : undefined;
      const defaultModel = typeof p?.defaultModel === "string" ? p.defaultModel.trim() : undefined;
      const { setKey } = await import("../byok-store.js");
      await setKey(workspaceId, provider as import("../byok-store.js").AIProvider, apiKey, { label, defaultModel });
      respond(true, { ok: true, workspaceId, provider }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.byok.remove": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const provider = typeof (params as Record<string, unknown>)?.provider === "string"
        ? ((params as Record<string, unknown>).provider as string).trim()
        : "";
      if (!provider) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "provider is required"));
        return;
      }
      const { removeKey } = await import("../byok-store.js");
      const removed = await removeKey(workspaceId, provider as import("../byok-store.js").AIProvider);
      respond(true, { ok: true, removed, workspaceId, provider }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.byok.validate": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as Record<string, unknown> | undefined;
      const provider = typeof p?.provider === "string" ? p.provider.trim() : "";
      // Accept either an inline apiKey or validate the stored key
      let apiKey = typeof p?.apiKey === "string" ? p.apiKey.trim() : "";
      if (!provider) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "provider is required"));
        return;
      }
      if (!apiKey) {
        // Try to read the stored key
        const { getKey } = await import("../byok-store.js");
        const stored = await getKey(workspaceId, provider as import("../byok-store.js").AIProvider);
        if (!stored) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `No key stored for provider "${provider}"`));
          return;
        }
        apiKey = stored;
      }
      const { validateKey, markValidated } = await import("../byok-store.js");
      const result = await validateKey(provider as import("../byok-store.js").AIProvider, apiKey);
      // If validating a stored key, mark it
      if (!p?.apiKey) {
        await markValidated(workspaceId, provider as import("../byok-store.js").AIProvider, result.valid);
      }
      respond(true, { ...result, provider, workspaceId }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.auth.check": async ({ params, respond, client }) => {
    // Check if a provider has API key available from global auth sources.
    try {
      const p = params as Record<string, unknown> | undefined;
      const provider = typeof p?.provider === "string" ? p.provider.trim() : "";
      if (!provider) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "provider is required"));
        return;
      }

      const { resolveApiKeyForProvider } = await import("../../agents/model-auth.js");
      const result = await resolveApiKeyForProvider({ provider, cfg: loadConfig() });
      respond(true, {
        provider,
        configured: Boolean(result.apiKey) || result.mode === "aws-sdk",
        source: result.source ?? null,
        mode: result.mode,
      }, undefined);
    } catch (err) {
      respond(true, { provider: "", configured: false, source: null, mode: "none" }, undefined);
    }
  },

  // â"€â"€ Chat-to-Workflow Creation â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  "pmos.workflow.create": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleWorkflowCreate } = await import("./chat-to-workflow.js");
      const result = await handleWorkflowCreate(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message || "Failed to create workflow"));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.workflow.template.list": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTemplateList } = await import("./chat-to-workflow.js");
      const result = await handleTemplateList(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.workflow.template.deploy": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTemplateDeploy } = await import("./chat-to-workflow.js");
      const result = await handleTemplateDeploy(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message || "Failed to deploy template"));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.workflow.confirm": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleWorkflowConfirm } = await import("./chat-to-workflow.js");
      const result = await handleWorkflowConfirm(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.workflow.intent.parse": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleIntentParse } = await import("./chat-to-workflow.js");
      const result = await handleIntentParse(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // â"€â"€ Multi-Agent Orchestration â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  "pmos.agent.parallel": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleParallelExecution } = await import("./agent-orchestration.js");
      const result = await handleParallelExecution(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message || "Parallel execution failed"));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.broadcast": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleAgentBroadcast } = await import("./agent-orchestration.js");
      const result = await handleAgentBroadcast(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.coordinate": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleOrchestration } = await import("./agent-orchestration.js");
      const result = await handleOrchestration(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message || "Orchestration failed"));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.task.status": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTaskStatusQuery } = await import("./agent-orchestration.js");
      const result = await handleTaskStatusQuery(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.task.cancel": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTaskCancel } = await import("./agent-orchestration.js");
      const result = await handleTaskCancel(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.task.list": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleAgentTasksQuery } = await import("./agent-orchestration.js");
      const result = await handleAgentTasksQuery(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.running.list": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleRunningTasksQuery } = await import("./agent-orchestration.js");
      const result = await handleRunningTasksQuery(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.broadcast.history": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleBroadcastHistoryQuery } = await import("./agent-orchestration.js");
      const result = await handleBroadcastHistoryQuery(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.template.list": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTemplateListQuery } = await import("./agent-orchestration.js");
      const result = await handleTemplateListQuery(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.template.create": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTemplateCreate } = await import("./agent-orchestration.js");
      const result = await handleTemplateCreate(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message || "Failed to create agent from template"));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // â"€â"€ Live Flow Builder â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  "pmos.flow.canvas.subscribe": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleCanvasSubscribe } = await import("./live-flow-builder.js");
      const result = await handleCanvasSubscribe(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.canvas.unsubscribe": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleCanvasUnsubscribe } = await import("./live-flow-builder.js");
      const result = await handleCanvasUnsubscribe(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.execution.subscribe": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleExecutionSubscribe } = await import("./live-flow-builder.js");
      const result = await handleExecutionSubscribe(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.execution.unsubscribe": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleExecutionUnsubscribe } = await import("./live-flow-builder.js");
      const result = await handleExecutionUnsubscribe(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.updates.fetch": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handlePendingUpdatesFetch } = await import("./live-flow-builder.js");
      const result = await handlePendingUpdatesFetch(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.execution.history": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleExecutionHistoryFetch } = await import("./live-flow-builder.js");
      const result = await handleExecutionHistoryFetch(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.control": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleFlowControl } = await import("./live-flow-builder.js");
      const result = await handleFlowControl(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.node.move": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleNodeMove } = await import("./live-flow-builder.js");
      const result = await handleNodeMove(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.node.add": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleNodeAdd } = await import("./live-flow-builder.js");
      const result = await handleNodeAdd(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.node.remove": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleNodeRemove } = await import("./live-flow-builder.js");
      const result = await handleNodeRemove(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.connection.add": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleConnectionAdd } = await import("./live-flow-builder.js");
      const result = await handleConnectionAdd(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.connection.remove": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleConnectionRemove } = await import("./live-flow-builder.js");
      const result = await handleConnectionRemove(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.template.search": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTemplateSearch } = await import("./live-flow-builder.js");
      const result = await handleTemplateSearch(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.template.featured": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleFeaturedTemplatesFetch } = await import("./live-flow-builder.js");
      const result = await handleFeaturedTemplatesFetch(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.template.deploy": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTemplateDeployment } = await import("./live-flow-builder.js");
      const result = await handleTemplateDeployment(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.status": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleFlowBuilderStatusQuery } = await import("./live-flow-builder.js");
      const result = await handleFlowBuilderStatusQuery(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.library.list": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleWorkflowLibraryList } = await import("./live-flow-builder.js");
      const result = await handleWorkflowLibraryList(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // â"€â"€ AI Workflow Assistant (uses global openclaw.json model config) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  "pmos.workflow.assist": async ({ params, respond, client, context }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);

      const p = params as {
        messages?: Array<{ role: string; content: string }>;
        message?: string;
        currentWorkflowId?: string;
      } | null;

      const rawMessages: Array<{ role: string; content: string }> = Array.isArray(p?.messages) ? [...p.messages] : [];
      if (p?.message && typeof p.message === "string") {
        rawMessages.push({ role: "user", content: p.message });
      }
      if (rawMessages.length === 0) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "messages required"));
        return;
      }

      const messages = rawMessages
        .filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({ role: m.role as "user" | "assistant", content: String(m.content) }));

      const {
        callWorkspaceModelAgentLoop,
        WORKFLOW_ASSISTANT_SYSTEM_PROMPT,
        getWorkspaceN8nNodeCatalog,
      } = await import("../workflow-ai.js");
      // Fetch available credentials and inject into system prompt so AI can reference them
      const {
        fetchWorkspaceCredentials,
        buildCredentialContext,
      } = await import("../credential-sync.js");
      const withTimeout = async <T>(
        promise: Promise<T>,
        timeoutMs: number,
        fallback: T,
      ): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
          return await Promise.race([
            promise,
            new Promise<T>((resolve) => {
              timer = setTimeout(() => resolve(fallback), timeoutMs);
            }),
          ]);
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
        }
      };

      const availableCredentials = await withTimeout(
        fetchWorkspaceCredentials(workspaceId).catch(() => []),
        6000,
        [] as Awaited<ReturnType<typeof fetchWorkspaceCredentials>>,
      );
      const credentialContext = buildCredentialContext(availableCredentials);
      const liveNodeCatalog = await withTimeout(
        getWorkspaceN8nNodeCatalog(workspaceId).catch(() => ""),
        6000,
        "",
      );
      // NOTE: Workspace memory (AI_CONTEXT.md) is intentionally NOT included in the workflow
      // assistant prompt -- it causes models to treat workflow requests as memory recall queries.
      const workspaceContext = `## Workspace Context
- Workspace ID: ${workspaceId}
- Use node type names from the live workspace catalog when available.
- Treat openclaw.json + workspace connector data as the source of truth for integration configuration.
- If required credentials are missing, explicitly tell the user which provider config to add in openclaw.json.
- If a live node catalog is unavailable, explicitly say so instead of inventing node names.`;

      // If a workflow is currently open in the canvas, fetch and inject its full details
      const currentWorkflowId = typeof p?.currentWorkflowId === "string" ? p.currentWorkflowId.trim() : null;
      let currentWorkflowContext = "";
      if (currentWorkflowId) {
        const { getWorkflowEngineWorkflow } = await import("../workflow-api-client.js");
        const wfResult = await withTimeout(
          getWorkflowEngineWorkflow(workspaceId, currentWorkflowId).catch(() => ({ ok: false as const })),
          4000,
          { ok: false as const },
        );
        if (wfResult.ok && wfResult.workflow) {
          const wf = wfResult.workflow as { id: string; name: string; active: boolean; nodes: unknown[]; connections: unknown };
          currentWorkflowContext = `## Currently Open Workflow in Canvas
- Workflow ID: ${wf.id}
- Name: ${wf.name}
- Active: ${wf.active}
- Nodes (${Array.isArray(wf.nodes) ? wf.nodes.length : 0} total): ${JSON.stringify(wf.nodes, null, 2)}
- Connections: ${JSON.stringify(wf.connections, null, 2)}

When the user asks to edit, modify, add, remove or update this workflow, use pmos_ops_update_workflow with workflow_id="${wf.id}".`;
        }
      }
      const agentBehaviorRules = [
        "## Critical Behaviour Rules (Automations AI)",
        "- When asked to create or build a workflow: CALL pmos_ops_create_workflow IMMEDIATELY -- never output JSON for the user to import manually.",
        "- Always call pmos_ops_list_credentials FIRST to discover which integrations are available.",
        "- After creating a workflow, tell the user its name and ID, and what they should do next (e.g. activate it, add a webhook).",
        "- Never describe a workflow in text and say 'import it' -- use the tool to create it directly.",
        "- When the user asks to edit/modify/add nodes/remove nodes from an EXISTING workflow (especially one currently open in the canvas): call pmos_ops_get_workflow first to fetch current state, then call pmos_ops_update_workflow with the FULL updated nodes+connections.",
        "- pmos_ops_update_workflow replaces the entire workflow -- always include ALL existing nodes plus any new ones.",
        "- Available tools: pmos_ops_list_credentials, pmos_ops_list_workflows, pmos_ops_list_node_types, pmos_ops_create_workflow, pmos_ops_get_workflow, pmos_ops_update_workflow, pmos_ops_execute_workflow.",
      ].join("\n");
      const systemPrompt = [
        WORKFLOW_ASSISTANT_SYSTEM_PROMPT,
        agentBehaviorRules,
        liveNodeCatalog,
        credentialContext,
        workspaceContext,
        currentWorkflowContext,
      ]
        .filter((part) => part && part.trim().length > 0)
        .join("\n\n");

      // â"€â"€ Tool definitions â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_list_credentials",
            description: "List available workflow-engine credentials/integrations configured for this workspace (Basecamp, Slack, GitHub, etc.)",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_list_workflows",
            description: "List existing workflow-engine flows in this workspace",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_list_node_types",
            description: "List available workflow node types (triggers and actions). Legacy-compatible aliases remain accepted where needed.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_create_workflow",
            description: "Create a new workflow-engine flow. Always call pmos_ops_list_credentials first to know which credential IDs to use.",
            parameters: {
              type: "object",
              required: ["name", "nodes", "connections"],
              additionalProperties: false,
              properties: {
                name: { type: "string", description: "Descriptive workflow name" },
                nodes: {
                  type: "array",
                  description: "Array of workflow node objects, each with: id, name, type, typeVersion, position [x,y], parameters, and optionally credentials",
                },
                connections: {
                  type: "object",
                  description: "Connections object mapping source node name â†' { main: [[{ node, type, index }]] }",
                },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_get_workflow",
            description: "Get full details of an existing workflow-engine flow by ID",
            parameters: {
              type: "object",
              required: ["workflow_id"],
              additionalProperties: false,
              properties: {
                workflow_id: { type: "string", description: "The workflow-engine flow ID" },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_update_workflow",
            description: "Update an existing workflow-engine flow -- add, remove or modify nodes and connections. Always call pmos_ops_get_workflow first to retrieve current state, then include ALL nodes (existing + modified) in the update.",
            parameters: {
              type: "object",
              required: ["workflow_id", "nodes", "connections"],
              additionalProperties: false,
              properties: {
                workflow_id: { type: "string", description: "The workflow-engine flow ID to update" },
                name: { type: "string", description: "Optional new name for the workflow" },
                nodes: {
                  type: "array",
                  description: "Complete array of ALL node objects for the workflow (existing + new/updated)",
                },
                connections: {
                  type: "object",
                  description: "Complete connections object (all existing + new connections)",
                },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_execute_workflow",
            description: "Execute (test-run) a workflow-engine flow by ID",
            parameters: {
              type: "object",
              required: ["workflow_id"],
              additionalProperties: false,
              properties: {
                workflow_id: { type: "string", description: "The workflow-engine flow ID to execute" },
              },
            },
          },
        },

        {
          type: "function" as const,
          function: {
            name: "web_search",
            description: "Search the web for current information, documentation, or design resources.",
            parameters: {
              type: "object",
              required: ["query"],
              additionalProperties: false,
              properties: {
                query: { type: "string", description: "Search query" },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "web_fetch",
            description: "Fetch the content of a URL. Use to call the Figma REST API or read any web page.",
            parameters: {
              type: "object",
              required: ["url"],
              additionalProperties: false,
              properties: {
                url: { type: "string", description: "URL to fetch" },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "figma_get_context",
            description: "Get the current Figma workspace context: connected status, active file name/ID/URL, team, and connection details.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
      ];


      // â"€â"€ Progress push helper â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const pushProgress = (stepOrPayload: string | Record<string, unknown>) => {
        if (client?.connId) {
          const payload = typeof stepOrPayload === "string"
            ? { step: stepOrPayload }
            : stepOrPayload;
          context.broadcastToConnIds(
            "pmos.workflow.assist.progress",
            payload,
            new Set([client.connId]),
          );
        }
      };

      // â"€â"€ Track created workflow for UI refresh â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      let createdWorkflowId: string | undefined;
      let createdWorkflowName: string | undefined;

      // â"€â"€ Tool executor â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const executeTool = async (toolName: string, args: Record<string, unknown>): Promise<string> => {
        const {
          createWorkflowEngineWorkflow,
          executeWorkflowEngineWorkflow,
          getWorkflowEngineWorkflow,
          listWorkflowEngineConnections,
          listWorkflowEngineNodeTypes,
          listWorkflowEngineWorkflows,
        } = await import("../workflow-api-client.js");

        const normalizedToolName = toolName.startsWith("pmos_n8n_")
          ? `pmos_ops_${toolName.slice("pmos_n8n_".length)}`
          : toolName;

        switch (normalizedToolName) {
          case "pmos_ops_list_credentials": {
            pushProgress("Checking available integrations...");
            const r = await listWorkflowEngineConnections(workspaceId);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to list credentials" });
            return JSON.stringify({
              credentials: (r.credentials ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type })),
            });
          }
          case "pmos_ops_list_workflows": {
            pushProgress("Loading existing workflows...");
            const r = await listWorkflowEngineWorkflows(workspaceId);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to list workflows" });
            return JSON.stringify({
              workflows: (r.workflows ?? []).map((w) => ({ id: w.id, name: w.name, active: w.active })),
            });
          }
          case "pmos_ops_list_node_types": {
            pushProgress("Looking up available node types...");
            const r = await listWorkflowEngineNodeTypes(workspaceId);
            // Always inject the custom Basecamp node + all essential core n8n nodes,
            // regardless of what the live n8n REST API returns (it often returns empty).
            const BASECAMP_CUSTOM_NODE = {
              name: "n8n-nodes-basecamp.basecamp",
              displayName: "Basecamp (BCgpt Custom Node)",
              description: "Full Basecamp integration -- projects, todos, messages, events, files, and more. ALWAYS use this node type for Basecamp.",
              group: ["custom"],
              version: 1,
            };
            const CORE_N8N_NODES = [
              { name: "n8n-nodes-base.manualTrigger", displayName: "Manual Trigger", description: "Start workflow manually", group: ["trigger"], version: 1 },
              { name: "n8n-nodes-base.scheduleTrigger", displayName: "Schedule Trigger", description: "Trigger on a cron schedule (daily, hourly, etc.)", group: ["trigger"], version: 1 },
              { name: "n8n-nodes-base.webhook", displayName: "Webhook", description: "HTTP webhook trigger -- use this type name, NOT webhookTrigger", group: ["trigger"], version: 1 },
              { name: "n8n-nodes-base.if", displayName: "IF", description: "Branch workflow on a condition (true/false)", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.switch", displayName: "Switch", description: "Route items to multiple output branches", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.merge", displayName: "Merge", description: "Merge data from multiple branches", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.code", displayName: "Code", description: "Execute custom JavaScript or Python", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.set", displayName: "Edit Fields (Set)", description: "Set or map field values", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.filter", displayName: "Filter", description: "Keep only items matching a condition", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.httpRequest", displayName: "HTTP Request", description: "Make HTTP GET/POST/PUT/DELETE requests", group: ["output"], version: 1 },
              { name: "n8n-nodes-base.splitInBatches", displayName: "Loop Over Items", description: "Process items in batches", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.noOp", displayName: "No Operation", description: "Pass-through node", group: ["organization"], version: 1 },
            ];
            const liveNodes = r.ok ? (r.nodeTypes ?? []) : [];
            // Remove any basecamp entry from live list (we inject ours at top),
            // and remove any live nodes that duplicate our core list.
            const coreNames = new Set(["n8n-nodes-basecamp.basecamp", ...CORE_N8N_NODES.map(n => n.name)]);
            const filteredLiveNodes = liveNodes.filter(
              (n) => !coreNames.has(String(n.name ?? "")) && !String(n.name ?? "").toLowerCase().includes("basecamp")
            );
            const nodeTypes = [BASECAMP_CUSTOM_NODE, ...CORE_N8N_NODES, ...filteredLiveNodes].slice(0, 250);
            return JSON.stringify({ nodeTypes });
          }
          case "pmos_ops_create_workflow": {
            const name = String(args.name ?? "").trim();
            let nodes = Array.isArray(args.nodes) ? args.nodes : [];
            const connections =
              args.connections && typeof args.connections === "object"
                ? (args.connections as Record<string, unknown>)
                : {};
            if (!name) return JSON.stringify({ error: "name is required" });
            if (!nodes.length) return JSON.stringify({ error: "nodes array is required and must not be empty" });

            // â"€â"€ Node type validation & auto-correction â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
            // Correct wrong node type names that the AI commonly uses.
            const NODE_TYPE_CORRECTIONS: Record<string, string> = {
              "n8n-nodes-base.webhookTrigger": "n8n-nodes-base.webhook",
              "n8n-nodes-base.cron": "n8n-nodes-base.scheduleTrigger",
              "n8n-nodes-base.interval": "n8n-nodes-base.scheduleTrigger",
              "n8n-nodes-base.function": "n8n-nodes-base.code",
              "n8n-nodes-base.functionItem": "n8n-nodes-base.code",
              "n8n-nodes-base.itemListsMerge": "n8n-nodes-base.merge",
              "n8n-nodes-base.googleSheetsRowTrigger": "n8n-nodes-base.googleSheetsTrigger",
              "n8n-nodes-base.rssFeedRead": "n8n-nodes-base.rssFeedReadTrigger",
            };
            let correctedCount = 0;
            nodes = nodes.map((node: Record<string, unknown>) => {
              const t = String(node.type ?? "");
              // Auto-correct Basecamp nodes to use our custom node
              if (t.toLowerCase().includes("basecamp") && t !== "n8n-nodes-basecamp.basecamp") {
                correctedCount++;
                return { ...node, type: "n8n-nodes-basecamp.basecamp" };
              }
              // Auto-correct known wrong n8n type names
              if (NODE_TYPE_CORRECTIONS[t]) {
                correctedCount++;
                return { ...node, type: NODE_TYPE_CORRECTIONS[t] };
              }
              return node;
            });
            if (correctedCount > 0) {
              pushProgress(`âš™ï¸ Auto-corrected ${correctedCount} node type(s) to valid workflow aliases.`);
            }

            // â"€â"€ Credential check for Basecamp nodes â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
            const hasBasecampNode = nodes.some((n: Record<string, unknown>) =>
              String(n.type ?? "") === "n8n-nodes-basecamp.basecamp"
            );
            if (hasBasecampNode) {
              const credR = await listWorkflowEngineConnections(workspaceId);
              const creds = credR.ok ? (credR.credentials ?? []) : [];
              const basecampCred = creds.find((c) => c.type === "basecampApi");
              if (!basecampCred) {
                return JSON.stringify({
                  error: "Basecamp credential not configured",
                  userMessage: "âš ï¸ Your Basecamp integration is not set up yet. Please go to **Settings â†' Integrations** and add your Basecamp API key before creating this workflow. Once configured, I'll build the workflow automatically.",
                  actionRequired: "configure_basecamp_credential",
                });
              }
              // Inject the credential ID into any Basecamp node that's missing it
              const basecampCredId = basecampCred.id;
              nodes = nodes.map((node: Record<string, unknown>) => {
                if (String(node.type ?? "") === "n8n-nodes-basecamp.basecamp") {
                  const existingCred = node.credentials as Record<string, unknown> | undefined;
                  if (!existingCred?.basecampApi) {
                    return {
                      ...node,
                      credentials: {
                        ...(existingCred ?? {}),
                        basecampApi: { id: basecampCredId, name: basecampCred.name },
                      },
                    };
                  }
                }
                return node;
              });
            }

            // â"€â"€ Per-node streaming â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
            // Push one step event per node so UI shows live "building" feel.
            pushProgress(`ðŸ"§ Building workflow "${name}" with ${nodes.length} nodes...`);
            for (const node of nodes) {
              const nodeName = String((node as Record<string, unknown>).name ?? "node");
              const nodeType = String((node as Record<string, unknown>).type ?? "");
              const displayType = nodeType.split(".").pop() ?? nodeType;
              pushProgress({ type: "node_added", nodeName, nodeType: displayType, step: `âž• Adding node: ${nodeName} (${displayType})` });
              // Small yield to let the event flush
              await new Promise((res) => setTimeout(res, 30));
            }

            const r = await createWorkflowEngineWorkflow(workspaceId, {
              name,
              active: false,
              nodes: nodes as Parameters<typeof createWorkflowEngineWorkflow>[1]["nodes"],
              connections,
            });
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to create workflow" });
            createdWorkflowId = r.workflow?.id;
            createdWorkflowName = name;
            // Navigate the canvas to the new workflow immediately (live creation feel)
            if (createdWorkflowId) {
              pushProgress({ type: "workflow_ready", workflowId: createdWorkflowId });
            }
            pushProgress(`âœ… Workflow "${name}" created with ${nodes.length} nodes!`);
            return JSON.stringify({
              success: true,
              workflowId: r.workflow?.id,
              workflowName: name,
              nodeCount: nodes.length,
              message: `Workflow "${name}" created successfully with ${nodes.length} nodes! ID: ${r.workflow?.id}. It's currently inactive -- activate it in the Workflows panel when ready.`,
            });
          }
          case "pmos_ops_update_workflow": {
            const id = String(args.workflow_id ?? "").trim();
            if (!id) return JSON.stringify({ error: "workflow_id is required" });
            const { updateWorkflowEngineWorkflow } = await import("../workflow-api-client.js");
            pushProgress(`Updating workflow...`);
            const r = await updateWorkflowEngineWorkflow(workspaceId, id, {
              ...(typeof args.name === "string" ? { name: args.name } : {}),
              ...(Array.isArray(args.nodes) ? { nodes: args.nodes as Parameters<typeof createWorkflowEngineWorkflow>[1]["nodes"] } : {}),
              ...(args.connections && typeof args.connections === "object" ? { connections: args.connections as Record<string, unknown> } : {}),
            });
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to update workflow" });
            // Push workflow_ready so the canvas refreshes immediately
            pushProgress({ type: "workflow_ready", workflowId: id });
            pushProgress(`âœ… Workflow updated!`);
            return JSON.stringify({
              success: true,
              workflowId: id,
              message: `Workflow updated successfully. The canvas will reload to show the changes.`,
            });
          }
          case "pmos_ops_get_workflow": {
            const id = String(args.workflow_id ?? "").trim();
            if (!id) return JSON.stringify({ error: "workflow_id is required" });
            const r = await getWorkflowEngineWorkflow(workspaceId, id);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to get workflow" });
            return JSON.stringify(r.workflow);
          }
          case "pmos_ops_execute_workflow": {
            const id = String(args.workflow_id ?? "").trim();
            if (!id) return JSON.stringify({ error: "workflow_id is required" });
            pushProgress("Executing workflow...");
            const r = await executeWorkflowEngineWorkflow(workspaceId, id);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to execute workflow" });
            return JSON.stringify({ success: true, executionId: r.executionId ?? "unknown" });
          }

          case "web_search": {
            const q = String(args.query ?? "").trim();
            if (!q) return JSON.stringify({ error: "query is required" });
            const { duckDuckGoSearch: ddgSearch } = await import("../pmos-mcp-http.js");
            const sr = await ddgSearch(q, 5);
            return JSON.stringify(sr);
          }
          case "web_fetch": {
            const fetchUrl = String(args.url ?? "").trim();
            if (!fetchUrl) return JSON.stringify({ error: "url is required" });
            const fetchResp = await fetch(fetchUrl, {
              signal: AbortSignal.timeout(10000),
              headers: { "User-Agent": "OpenClaw/1.0" },
            });
            const fetchText = await fetchResp.text();
            return JSON.stringify({ url: fetchUrl, status: fetchResp.status, content: fetchText.slice(0, 15000) });
          }
          case "figma_get_context": {
            const figmaContext = await readWorkspaceFigmaContext(workspaceId);
            return JSON.stringify({
              ...figmaContext,
              note: "Use figma_mcp_list_tools next, then figma_mcp_call for live Figma operations.",
            });
          }
          default:
            return JSON.stringify({ error: `Unknown tool: ${toolName}` });
        }
      };

      const latestUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === "user")?.content ?? "";
      const pastedUrlHints = inspectWorkspaceChatUrls(latestUserMessage);
      const intents = detectChatIntents(latestUserMessage, pastedUrlHints);
      const disableBasecampTools = isGreetingOnlyMessage(latestUserMessage);
      const agentTools = filterToolDefinitionsByIntents(tools, intents, {
        disableBasecampTools,
        latestUserMessage,
        urlHints: pastedUrlHints,
      });

      pushProgress("Thinking...");
      const result = await callWorkspaceModelAgentLoop(
        workspaceId,
        systemPrompt,
        messages,
        agentTools,
        executeTool,
        {
          maxTokens: 2048,
          maxIterations: 8,
        },
      );

      if (!result.ok) {
        respond(
          true,
          {
            ok: true,
            message: `AI model unavailable: ${result.error ?? "unknown error"}. Please check your model configuration in Settings â†' AI Model Setup.`,
            workflowCreated: false,
          },
          undefined,
        );
        return;
      }

      // â"€â"€ JSON-response fallback â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      // The system prompt asks the AI to return JSON: {message, workflow?}.
      // If the AI returned a workflow object in text (no tool_calls used),
      // parse and create it directly so models without function-calling still work.
      // Handles: bare JSON, markdown-fenced ```json ... ```, or JSON embedded in text.
      let finalText = result.text ?? "";
      const extractJsonFromText = (text: string): string | null => {
        const trimmed = text.trim();
        // 1. Bare JSON
        if (trimmed.startsWith("{")) return trimmed;
        // 2. Markdown fence: ```json ... ``` or ``` ... ```
        const fenceMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (fenceMatch) return fenceMatch[1];
        // 3. Largest {...} block in the text
        const firstBrace = trimmed.indexOf("{");
        if (firstBrace !== -1) {
          let depth = 0;
          let lastClose = -1;
          for (let i = firstBrace; i < trimmed.length; i++) {
            if (trimmed[i] === "{") depth++;
            else if (trimmed[i] === "}") {
              depth--;
              if (depth === 0) { lastClose = i; break; }
            }
          }
          if (lastClose !== -1) return trimmed.slice(firstBrace, lastClose + 1);
        }
        return null;
      };

      // â"€â"€ JSON-mode retry â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      // If the agent loop returned plain prose (model doesn't use tool_calls AND
      // didn't output JSON), retry once using callWorkspaceModel with
      // response_format:json_object forced, so the model MUST return JSON.
      if (!createdWorkflowId && result.ok && !extractJsonFromText(finalText)) {
        try {
          const { callWorkspaceModel: callWsJson } = await import("../workflow-ai.js");
          pushProgress("Formulating automation plan...");
          const retryResult = await callWsJson(
            workspaceId,
            systemPrompt,
            messages,
            { maxTokens: 4096, jsonMode: true },
          );
          if (retryResult.ok && retryResult.text && retryResult.text.trim().length > 10) {
            finalText = retryResult.text;
          }
        } catch {
          // retry failed -- proceed with original text
        }
      }
      const jsonCandidate = !createdWorkflowId ? extractJsonFromText(finalText) : null;
      if (!createdWorkflowId && jsonCandidate) {
        try {
          const aiJson = JSON.parse(jsonCandidate) as Record<string, unknown>;
          // Handle {message, workflow: {...}} wrapper OR direct {name, nodes, connections} object
          const wfData: Record<string, unknown> | undefined =
            (aiJson.workflow && typeof aiJson.workflow === "object" && !Array.isArray(aiJson.workflow))
              ? aiJson.workflow as Record<string, unknown>
              : (typeof aiJson.name === "string" && Array.isArray(aiJson.nodes))
                ? aiJson
                : undefined;
          if (wfData && typeof wfData.name === "string" && Array.isArray(wfData.nodes)) {
            const wfName = wfData.name.trim();
            let wfNodes = wfData.nodes as Array<Record<string, unknown>>;
            const wfConns = (wfData.connections && typeof wfData.connections === "object")
              ? wfData.connections as Record<string, unknown>
              : {};
            if (wfName && wfNodes.length > 0) {
              // Apply the same type corrections as the tool handler
              const JSON_TYPE_CORRECTIONS: Record<string, string> = {
                "n8n-nodes-base.webhookTrigger": "n8n-nodes-base.webhook",
                "n8n-nodes-base.cron": "n8n-nodes-base.scheduleTrigger",
                "n8n-nodes-base.interval": "n8n-nodes-base.scheduleTrigger",
                "n8n-nodes-base.function": "n8n-nodes-base.code",
                "n8n-nodes-base.functionItem": "n8n-nodes-base.code",
                "n8n-nodes-base.itemListsMerge": "n8n-nodes-base.merge",
                "n8n-nodes-base.googleSheetsRowTrigger": "n8n-nodes-base.googleSheetsTrigger",
                "n8n-nodes-base.rssFeedRead": "n8n-nodes-base.rssFeedReadTrigger",
              };
              wfNodes = wfNodes.map((node) => {
                const t = String(node.type ?? "");
                if (t.toLowerCase().includes("basecamp") && t !== "n8n-nodes-basecamp.basecamp") {
                  return { ...node, type: "n8n-nodes-basecamp.basecamp" };
                }
                if (JSON_TYPE_CORRECTIONS[t]) return { ...node, type: JSON_TYPE_CORRECTIONS[t] };
                return node;
              });
              // Inject Basecamp credentials
              const hasBasecampNode = wfNodes.some(
                (n) => String(n.type ?? "") === "n8n-nodes-basecamp.basecamp",
              );
              if (hasBasecampNode) {
                const { listWorkflowEngineConnections: listCreds } = await import("../workflow-api-client.js");
                const credR2 = await listCreds(workspaceId);
                const bcCred = (credR2.ok ? (credR2.credentials ?? []) : []).find(
                  (c) => c.type === "basecampApi",
                );
                if (bcCred) {
                  wfNodes = wfNodes.map((node) => {
                    if (String(node.type ?? "") === "n8n-nodes-basecamp.basecamp") {
                      const existing = node.credentials as Record<string, unknown> | undefined;
                      if (!existing?.basecampApi) {
                        return {
                          ...node,
                          credentials: {
                            ...(existing ?? {}),
                            basecampApi: { id: bcCred.id, name: bcCred.name },
                          },
                        };
                      }
                    }
                    return node;
                  });
                }
              }
              // Emit per-node streaming events
              pushProgress(`ðŸ"§ Building workflow "${wfName}" with ${wfNodes.length} nodes...`);
              for (const node of wfNodes) {
                const nodeName = String(node.name ?? "node");
                const nodeType = String(node.type ?? "");
                pushProgress({
                  type: "node_added",
                  nodeName,
                  nodeType: nodeType.split(".").pop() ?? nodeType,
                  step: `âž• Adding node: ${nodeName}`,
                });
                await new Promise<void>((res) => setTimeout(res, 30));
              }
              const { createWorkflowEngineWorkflow: createWf } = await import("../workflow-api-client.js");
              const createR = await createWf(workspaceId, {
                name: wfName,
                active: false,
                nodes: wfNodes as Parameters<typeof createWf>[1]["nodes"],
                connections: wfConns,
              });
              if (createR.ok && createR.workflow?.id) {
                createdWorkflowId = createR.workflow.id;
                createdWorkflowName = wfName;
                pushProgress({ type: "workflow_ready", workflowId: createdWorkflowId });
                pushProgress(`âœ… Workflow "${wfName}" created with ${wfNodes.length} nodes!`);
              }
            }
          }
        } catch {
          // Not valid JSON or workflow extraction failed -- stream text as-is
        }
      }

      // Extract human-readable message from JSON response if applicable
      let displayMessage = finalText;
      const displayJsonCandidate = extractJsonFromText(finalText);
      if (displayJsonCandidate) {
        try {
          const msgJson = JSON.parse(displayJsonCandidate) as Record<string, unknown>;
          if (typeof msgJson.message === "string" && msgJson.message.trim()) {
            displayMessage = msgJson.message;
          }
        } catch {
          // use raw text
        }
      }

      // Stream the response text token-by-token for a live typing effect
      if (displayMessage && client?.connId) {
        const CHUNK = 4; // characters per push (~80 chars/sec at 50ms interval)
        for (let i = 0; i < displayMessage.length; i += CHUNK) {
          pushProgress({ type: "token", text: displayMessage.slice(i, i + CHUNK) });
          await new Promise<void>((r) => setTimeout(r, 12));
        }
      }

      respond(true, {
        ok: true,
        message: displayMessage,
        workflowCreated: Boolean(createdWorkflowId),
        workflowId: createdWorkflowId,
        workflowName: createdWorkflowName,
        providerUsed: result.providerUsed,
        _debugModelText: finalText.slice(0, 800),
      }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // â"€â"€ Workspace Chat (agentic -- can directly create/modify workflow-engine flows via tool calls) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  "pmos.chat.send": async ({ req, params, respond, client, context }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);

      const p = params as {
        messages?: Array<{ role: string; content: string }>;
        sessionKey?: string;
        runId?: string;
        screenContext?: string;
      } | null;

      const rawMessages: Array<{ role: string; content: string }> = Array.isArray(p?.messages)
        ? [...p.messages]
        : [];

      if (rawMessages.length === 0) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "messages required"));
        return;
      }

      const messages = rawMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content) }));

      const liveSessionKey =
        typeof p?.sessionKey === "string" && p.sessionKey.trim() ? p.sessionKey.trim() : "";

      // Extract agent ID from session key (format: "agent:<agentId>:<rest>")
      const { parseAgentSessionKey } = await import("../../sessions/session-key-utils.js");
      const parsedSession = parseAgentSessionKey(liveSessionKey);
      const chatAgentId = parsedSession?.agentId ?? null;

      const liveRunId =
        typeof p?.runId === "string" && p.runId.trim()
          ? p.runId.trim()
          : typeof req?.id === "string" && req.id.trim()
            ? req.id.trim()
            : "";
      const liveStreamEnabled = Boolean(liveSessionKey && liveRunId);
      let liveText = "";
      let liveToolSeq = 0;
      const liveStartedAt = Date.now();

      const emitThinking = (thinking: string) => {
        if (!liveStreamEnabled || !thinking.trim()) {
          return;
        }
        emitAgentEvent({
          runId: liveRunId,
          stream: "assistant",
          sessionKey: liveSessionKey,
          data: { thinking },
        });
      };

      const emitTextChunk = async (text: string, chunkSize = 24, delayMs = 14) => {
        if (!liveStreamEnabled || !text) {
          return;
        }
        for (let i = 0; i < text.length; i += chunkSize) {
          liveText += text.slice(i, i + chunkSize);
          emitAgentEvent({
            runId: liveRunId,
            stream: "assistant",
            sessionKey: liveSessionKey,
            data: { text: liveText },
          });
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      };

      const describeToolAction = (toolName: string, args: Record<string, unknown>): string => {
        switch (toolName) {
          case "bcgpt_smart_action":
            return `Checking live Basecamp data with smart_action for: ${String(args.query ?? "").trim() || "workspace request"}`;
          case "bcgpt_search_basecamp":
            return `Searching across all Basecamp data for: ${String(args.query ?? "").trim() || "search query"}`;
          case "bcgpt_list_projects":
            return "Loading the live Basecamp project list for this workspace.";
          case "bcgpt_list_tools":
            return "Inspecting the full live Basecamp MCP tool catalog before choosing an exact tool.";
          case "bcgpt_mcp_call":
            return `Calling the Basecamp MCP tool ${String(args.tool ?? "").trim() || "unknown"}.`;
          case "bcgpt_basecamp_raw":
            return `Fetching raw Basecamp data from ${String(args.path ?? "").trim() || "the requested API path"}.`;
          case "pmos_ops_list_credentials":
            return "Checking which workflow and integration credentials are available in this workspace.";
          case "pmos_ops_list_workflows":
            return "Listing the current workflows so I can inspect what already exists.";
          case "pmos_ops_get_workflow":
            return `Opening workflow ${String(args.workflow_id ?? "").trim() || ""} to inspect its structure.`;
          case "pmos_ops_execute_workflow":
            return `Running workflow ${String(args.workflow_id ?? "").trim() || ""} to verify its behavior.`;
          case "pmos_parallel_subtasks":
            return `Splitting the request into ${Array.isArray(args.tasks) ? args.tasks.length : 0} parallel subtask probe(s).`;
          case "fm_get_context":
            return "Reading your Figma File Manager overview.";
          case "fm_list_files":
            return "Listing files in the Figma File Manager.";
          case "fm_get_file":
            return `Getting file details for ${String(args.file_id ?? "").trim() || "the selected file"}.`;
          case "fm_update_file":
            return `Updating file ${String(args.file_id ?? "").trim() || ""} in the Figma File Manager.`;
          case "fm_list_tags":
            return "Listing all tags in the Figma File Manager.";
          case "fm_create_tag":
            return `Creating tag "${String(args.name ?? "").trim() || "new tag"}".`;
          case "fm_rename_tag":
            return `Renaming tag ${String(args.tag_id ?? "").trim() || ""}.`;
          case "fm_delete_tag":
            return `Deleting tag ${String(args.tag_id ?? "").trim() || ""}.`;
          case "fm_list_folders":
            return "Listing folders in the Figma File Manager.";
          case "fm_create_folder":
            return `Creating folder "${String(args.name ?? "").trim() || "new folder"}".`;
          case "fm_rename_folder":
            return `Renaming folder ${String(args.folder_id ?? "").trim() || ""}.`;
          case "fm_list_categories":
            return "Listing categories in the Figma File Manager.";
          case "fm_create_category":
            return `Creating category "${String(args.name ?? "").trim() || "new category"}".`;
          case "fm_add_link":
            return `Adding a link to file ${String(args.file_id ?? "").trim() || ""}.`;
          case "fm_delete_link":
            return `Removing link ${String(args.link_id ?? "").trim() || ""}.`;
          case "fm_sync_team":
            return "Triggering a Figma team sync to refresh files.";
          case "figma_get_context":
            return "Reading the selected Figma file and team context from the workspace.";
          case "figma_mcp_list_tools":
            return "Checking which live Figma MCP tools are available for this workspace.";
          case "figma_mcp_call":
            return `Calling the Figma MCP tool ${String(args.tool ?? "").trim() || "unknown"}.`;
          case "figma_pat_audit_file":
            return "Running a Figma REST audit with the workspace PAT because MCP access is not ready.";
          case "web_search":
            return `Searching the web for: ${String(args.query ?? "").trim() || "workspace query"}`;
          case "web_fetch":
            return `Fetching ${String(args.url ?? "").trim() || "the requested URL"}.`;
          default:
            return `Running ${toolName} to gather the next piece of data I need.`;
        }
      };

      if (liveStreamEnabled) {
        registerAgentRunContext(liveRunId, {
          sessionKey: liveSessionKey,
          verboseLevel: "full",
        });
        if (client.connId) {
          context.registerToolEventRecipient(liveRunId, client.connId);
        }
        emitAgentEvent({
          runId: liveRunId,
          stream: "lifecycle",
          sessionKey: liveSessionKey,
          data: {
            phase: "start",
            startedAt: liveStartedAt,
          },
        });
      }

      const { callWorkspaceModelAgentLoop } = await import("../workflow-ai.js");
      const { getWorkspaceAiContextForPrompt } = await import("../workspace-ai-context.js");
      const {
        fetchWorkspaceCredentials,
        buildCredentialContext,
      } = await import("../credential-sync.js");

      // Load agent config for agent-specific chat sessions
      let agentConfig: Awaited<ReturnType<typeof import("../../agents/agent-scope.js").resolveAgentConfig>> = undefined;
      if (chatAgentId) {
        try {
          const { resolveAgentConfig } = await import("../../agents/agent-scope.js");
          const { loadEffectiveWorkspaceConfig } = await import("../workspace-config.js");
          const effectiveCfg = await loadEffectiveWorkspaceConfig(workspaceId);
          agentConfig = resolveAgentConfig(
            effectiveCfg as import("../../config/config.js").OpenClawConfig,
            chatAgentId,
          );
        } catch {
          // Best-effort; fall through to workspace defaults.
        }
      }

      const withTimeout = async <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
        let t: ReturnType<typeof setTimeout> | null = null;
        try {
          return await Promise.race([
            promise,
            new Promise<T>((resolve) => {
              t = setTimeout(() => resolve(fallback), ms);
            }),
          ]);
        } finally {
          if (t) clearTimeout(t);
        }
      };

      const latestUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === "user")?.content ?? "";
      const pastedUrlCount = countDistinctAbsoluteUrls(latestUserMessage);
      const pastedUrlHints = inspectWorkspaceChatUrls(latestUserMessage);
      const plan = buildPmosChatExecutionPlan({
        latestUserMessage,
        urlHints: pastedUrlHints,
        pastedUrlCount,
        hasScreenContext: Boolean(p?.screenContext?.trim()),
      });
      if (liveStreamEnabled) {
        emitThinking(plan.thinkingNote);
      }
      const hasMixedWorkspaceUrls = Boolean(
        pastedUrlHints.figmaUrl && pastedUrlHints.basecampUrl,
      );
      const intents = new Set<ChatIntent>(plan.intents);
      const runtimeUrlHints = [
        pastedUrlHints.basecampUrl
          ? `- Pasted Basecamp URL detected for this request: ${pastedUrlHints.basecampUrl}. Treat that URL as the exact resource to inspect.${pastedUrlHints.basecampBucketId ? ` Bucket ID: ${pastedUrlHints.basecampBucketId}.` : ""}${pastedUrlHints.basecampCardId ? ` Card ID: ${pastedUrlHints.basecampCardId}.` : ""}${pastedUrlHints.basecampRecordingId ? ` Recording/comment thread ID: ${pastedUrlHints.basecampRecordingId}.` : ""}${pastedUrlHints.basecampCardPath ? ` If you need direct card data, \`bcgpt_basecamp_raw\` can use path \`${pastedUrlHints.basecampCardPath}\`.` : ""}`
          : null,
        pastedUrlHints.figmaUrl
          ? `- Pasted Figma URL detected for this request: ${pastedUrlHints.figmaUrl}. Anchor to that exact file instead of the selected workspace file.`
          : null,
      ].filter((line): line is string => Boolean(line));
      const requestRoutingHints = plan.guidance;
      const directBasecampShortcut =
        plan.mode !== "cross_system" &&
        intents.has("basecamp") &&
        !intents.has("workflow") &&
        !intents.has("figma") &&
        !isGreetingOnlyMessage(latestUserMessage)
          ? inferDirectBasecampChatShortcut(latestUserMessage, pastedUrlHints)
          : null;

      if (directBasecampShortcut) {
        if (liveStreamEnabled) {
          emitThinking("Handling this as a direct Basecamp request with the exact MCP tool before invoking the general model.");
        }
        const directBasecampReply = await maybeHandleDirectBasecampShortcut({
          workspaceId,
          latestUserMessage,
          shortcut: directBasecampShortcut,
        });
        if (directBasecampReply) {
          if (liveStreamEnabled) {
            await emitTextChunk(directBasecampReply);
            emitAgentEvent({
              runId: liveRunId,
              stream: "lifecycle",
              sessionKey: liveSessionKey,
              data: {
                phase: "end",
                startedAt: liveStartedAt,
                endedAt: Date.now(),
              },
            });
          }
          respond(
            true,
            {
              ok: true,
              message: directBasecampReply,
              providerUsed: "basecamp-direct",
              liveStreamed: liveStreamEnabled,
            },
            undefined,
          );
          return;
        }
      }

      const [workspaceAiContext, availableCredentials] = await Promise.all([
        plan.includeWorkspaceMemory
          ? withTimeout(
              getWorkspaceAiContextForPrompt(workspaceId, {
                ensureFresh: false,
                maxChars: 2500,
              }).catch(() => ""),
              3500,
              "",
            )
          : Promise.resolve(""),
        plan.includeCredentials
          ? withTimeout(
              fetchWorkspaceCredentials(workspaceId).catch(() => []),
              4500,
              [] as Awaited<ReturnType<typeof fetchWorkspaceCredentials>>,
            )
          : Promise.resolve([] as Awaited<ReturnType<typeof fetchWorkspaceCredentials>>),
      ]);

      const credentialContext =
        plan.includeCredentials && availableCredentials.length > 0
          ? buildCredentialContext(availableCredentials)
          : "";

      // Build agent-aware preamble: custom agents get their identity injected
      const agentIdentity = agentConfig?.identity as
        | { name?: string; emoji?: string; theme?: string }
        | undefined;
      const agentPreamble =
        agentIdentity?.name && chatAgentId && chatAgentId !== "main"
          ? [
              `You are "${agentIdentity.name}"${agentIdentity.emoji ? ` ${agentIdentity.emoji}` : ""}, a custom AI agent in workspace ${workspaceId}.`,
              ...(agentIdentity.theme ? [`Your personality/focus: ${agentIdentity.theme}.`] : []),
              "Think clearly, stay concise, and use specialist tools only when the task truly needs live workspace state or external actions.",
            ].join(" ")
          : `You are the OpenClaw workspace operator for workspace ${workspaceId}. Think clearly, stay concise, and use specialist tools only when the task truly needs live workspace state or external actions.`;

      const compactToolFamilyLines = [
        intents.has("basecamp")
          ? "- Basecamp: `bcgpt_list_projects`, `bcgpt_mcp_call`, `bcgpt_smart_action`, `bcgpt_list_tools`, `bcgpt_basecamp_raw`."
          : null,
        intents.has("workflow")
          ? "- Workflows: `pmos_ops_list_credentials`, `pmos_ops_list_workflows`, `pmos_ops_get_workflow`, `pmos_ops_create_workflow`, `pmos_ops_update_workflow`, `pmos_ops_execute_workflow`."
          : null,
        intents.has("figma")
          ? "- Figma: `figma_get_context`, `figma_mcp_list_tools`, `figma_mcp_call`, `figma_pat_audit_file`."
          : null,
        "- General: `pmos_parallel_subtasks`, `web_search`, `web_fetch`.",
      ].filter((line): line is string => Boolean(line));

      const systemPrompt = [
        agentPreamble,
        "",
        "## Execution Brief",
        `- Mode: ${plan.mode}`,
        `- Response style: ${plan.responseStyle}`,
        `- Plan: ${plan.plannerSummary}`,
        `- Live data required: ${plan.needsLiveData ? "yes" : "no"}`,
        `- Context slices loaded: ${[
          plan.includeWorkspaceMemory ? "workspace_memory" : null,
          plan.includeCredentials ? "credentials" : null,
          plan.includeScreenContext && p?.screenContext?.trim() ? "screen_context" : null,
          plan.includeUrlHints ? "url_hints" : null,
        ]
          .filter(Boolean)
          .join(", ") || "none"}`,
        "",
        "## Operating Rules",
        "- Keep answers precise and useful. Do not start by narrating workspace scans, connector checks, or setup reviews unless the user asked for that.",
        "- Never output raw lists of IDs, raw JSON payloads, or unannotated tool results at the user.",
        "- Use live specialist tools only when the request needs them.",
        "- Use the smallest useful chain of tools, but continue reasoning after a tool call when the user still needs interpretation, prioritization, or next steps.",
        "- Always give a concrete next step when it helps the user move forward.",
        "",
        "## Domain Guidance",
        ...requestRoutingHints,
        "",
        "## Tool Families In Play",
        ...compactToolFamilyLines,
        "",
        ...(runtimeUrlHints.length ? ["## Request-Specific URL Routing", ...runtimeUrlHints, ""] : []),
        ...(credentialContext ? [credentialContext, ""] : []),
        ...(workspaceAiContext ? ["## Workspace Memory", workspaceAiContext] : []),
        ...(plan.includeScreenContext && p?.screenContext?.trim()
          ? ["", "## Current Screen Context", p.screenContext.trim()]
          : []),
      ].join("\n");

      // â"€â"€ Tool definitions (OpenAI function-calling format) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "bcgpt_smart_action",
            description: "Run a natural-language Basecamp request through the bcgpt MCP smart router. If the user pasted a Basecamp URL, include that exact URL in the query.",
            parameters: {
              type: "object",
              required: ["query"],
              additionalProperties: false,
              properties: {
                query: { type: "string", description: "Natural-language Basecamp request" },
                project: {
                  type: "string",
                  description: "Optional project name to scope the Basecamp request.",
                },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "bcgpt_search_basecamp",
            description: "Search across all synced Basecamp data: todos, messages, schedule entries, cards, documents, and people. Fast local search from the synced snapshot.",
            parameters: {
              type: "object",
              required: ["query"],
              additionalProperties: false,
              properties: {
                query: { type: "string", description: "Search query" },
                project_id: { type: "string", description: "Optional: limit to a specific project ID" },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "bcgpt_list_projects",
            description: "List live Basecamp projects available through the bcgpt MCP server.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "bcgpt_list_tools",
            description: "List the live Basecamp MCP tool catalog exposed by the bcgpt server. Use when you need to discover the exact named tool instead of defaulting to smart_action.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "bcgpt_mcp_call",
            description:
              "Call an exact named Basecamp MCP tool through the bcgpt server. Prefer this for deterministic reads like todo lists, due-date queues, overdue queues, todos, messages, project people, schedules, documents, or card tables.",
            parameters: {
              type: "object",
              required: ["tool"],
              additionalProperties: false,
              properties: {
                tool: {
                  type: "string",
                  description: "Exact Basecamp MCP tool name, such as list_todolists, list_todos_for_project, list_todos_due, report_todos_overdue, or list_project_people.",
                },
                arguments: {
                  type: "object",
                  description: "JSON object of arguments for the selected Basecamp MCP tool.",
                },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "bcgpt_basecamp_raw",
            description:
              "Make a raw Basecamp API request through the bcgpt MCP bridge when an exact resource lookup is needed or smart_action is not specific enough.",
            parameters: {
              type: "object",
              required: ["path"],
              additionalProperties: false,
              properties: {
                method: {
                  type: "string",
                  description: "HTTP method for the Basecamp API request. Defaults to GET.",
                },
                path: {
                  type: "string",
                  description: "Raw Basecamp API path or exact resource path to fetch.",
                },
                body: {
                  type: "object",
                  description: "Optional JSON body for non-GET Basecamp API requests.",
                },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_list_credentials",
            description: "List available workflow-engine credentials/integrations configured for this workspace (Basecamp, Slack, GitHub, etc.)",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_list_workflows",
            description: "List existing workflow-engine flows in this workspace",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_list_node_types",
            description: "List available workflow node types (triggers and actions). Legacy-compatible aliases remain accepted where needed.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_create_workflow",
            description: "Create a new workflow-engine flow. Always call pmos_ops_list_credentials first to know which credential IDs to use in node parameters.",
            parameters: {
              type: "object",
              required: ["name", "nodes", "connections"],
              additionalProperties: false,
              properties: {
                name: { type: "string", description: "Descriptive workflow name" },
                nodes: {
                  type: "array",
                  description: "Array of workflow node objects, each with: id, name, type, typeVersion, position [x,y], parameters, and optionally credentials",
                },
                connections: {
                  type: "object",
                  description: "Connections object mapping source node name â†' { main: [[{ node, type, index }]] }",
                },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_get_workflow",
            description: "Get full details of an existing workflow-engine flow by ID",
            parameters: {
              type: "object",
              required: ["workflow_id"],
              additionalProperties: false,
              properties: {
                workflow_id: { type: "string", description: "The workflow-engine flow ID" },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_execute_workflow",
            description: "Execute (test-run) a workflow-engine flow by ID",
            parameters: {
              type: "object",
              required: ["workflow_id"],
              additionalProperties: false,
              properties: {
                workflow_id: { type: "string", description: "The workflow-engine flow ID to execute" },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_ops_update_workflow",
            description: "Update an existing workflow-engine flow (edit nodes, connections, or name). Use when the user says 'add', 'modify', 'fix', 'change', or 'update' an existing workflow.",
            parameters: {
              type: "object",
              required: ["workflow_id", "name", "nodes", "connections"],
              additionalProperties: false,
              properties: {
                workflow_id: { type: "string", description: "The workflow-engine flow ID to update" },
                name: { type: "string", description: "Workflow name (can keep existing)" },
                nodes: { type: "array", description: "Full updated array of workflow node objects" },
                connections: { type: "object", description: "Full updated connections object" },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_parallel_subtasks",
            description:
              "Spawn temporary parallel subagents for independent probes, then return their findings so the main agent can aggregate and continue reasoning.",
            parameters: {
              type: "object",
              required: ["tasks"],
              additionalProperties: false,
              properties: {
                tasks: {
                  type: "array",
                  description:
                    "Independent subtasks to run in parallel. Each task should be narrow and self-contained.",
                  items: {
                    type: "object",
                    required: ["task"],
                    additionalProperties: false,
                    properties: {
                      label: {
                        type: "string",
                        description: "Short label for the probe, such as Figma, Basecamp, or Accessibility.",
                      },
                      task: {
                        type: "string",
                        description: "The exact subtask prompt the temporary subagent should complete.",
                      },
                    },
                  },
                },
              },
            },
          },
        },

        {
          type: "function" as const,
          function: {
            name: "web_search",
            description: "Search the web for current information, documentation, or design resources.",
            parameters: {
              type: "object",
              required: ["query"],
              additionalProperties: false,
              properties: {
                query: { type: "string", description: "Search query" },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "web_fetch",
            description: "Fetch the content of a URL. Use to call the Figma REST API or read any web page.",
            parameters: {
              type: "object",
              required: ["url"],
              additionalProperties: false,
              properties: {
                url: { type: "string", description: "URL to fetch" },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "figma_get_context",
            description: "Get the current Figma workspace context: connected status, active selected file name/ID/URL, team, and connection details. This is for workspace readiness and selected-file context.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "figma_mcp_list_tools",
            description: "List the full configured Figma MCP capability surface and schemas through the PMOS-owned Figma MCP service. Use this first to discover context-first Figma tools such as get_design_context, get_metadata, get_screenshot, get_variable_defs, comments, annotations, node inspection, and other deeper file capabilities before choosing a specific MCP call.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "figma_mcp_call",
            description: "Call a specific Figma MCP tool through the PMOS-owned Figma MCP service for deeper file context such as get_design_context, get_metadata, get_screenshot, get_variable_defs, comments, annotations, nodes, screenshots, variables, components, and other live Figma capabilities discovered through figma_mcp_list_tools.",
            parameters: {
              type: "object",
              required: ["tool"],
              additionalProperties: false,
              properties: {
                tool: { type: "string", description: "Figma MCP tool name" },
                arguments: {
                  type: "object",
                  description: "JSON object of MCP tool arguments",
                },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "figma_pat_audit_file",
            description:
              "Run a Figma REST audit against the selected file using the workspace PAT. If the user supplied a Figma URL, extract its file key into file_key or pass the URL directly so the audit targets that file instead of the selected panel file. Use this when MCP auth is unavailable or when the user explicitly wants components, layout, styles, font, or regression-style structural audits. Do not use this as the default path for comments, annotations, or deeper Figma context when MCP tools are available.",
            parameters: {
              type: "object",
              properties: {
                file_key: {
                  type: "string",
                  description: "Optional Figma file key. Defaults to the file selected in the Figma panel.",
                },
                focus: {
                  type: "string",
                  description: "Optional audit focus: general, layout, autolayout, components, styles, fonts, or regression.",
                },
                depth: {
                  type: "number",
                  description: "Optional file traversal depth for the REST audit. Defaults to 2 to keep large files responsive in chat.",
                },
              },
              additionalProperties: false,
            },
          },
        },
      ];

      let figmaMcpCallAttempted = false;
      let figmaMcpFailureSeen = false;


      // â"€â"€ Tool executor -- calls n8n-api-client directly â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const executeTool = async (toolName: string, args: Record<string, unknown>): Promise<string> => {
        const {
          createWorkflowEngineWorkflow,
          executeWorkflowEngineWorkflow,
          getWorkflowEngineWorkflow,
          listWorkflowEngineConnections,
          listWorkflowEngineNodeTypes,
          listWorkflowEngineWorkflows,
          updateWorkflowEngineWorkflow,
        } = await import("../workflow-api-client.js");

        const normalizedToolName = toolName.startsWith("pmos_n8n_")
          ? `pmos_ops_${toolName.slice("pmos_n8n_".length)}`
          : toolName;
        const toolCallId = `${liveRunId || "pmos"}:tool:${++liveToolSeq}`;
        if (liveStreamEnabled) {
          emitThinking(describeToolAction(normalizedToolName, args));
          emitAgentEvent({
            runId: liveRunId,
            stream: "tool",
            sessionKey: liveSessionKey,
            data: {
              phase: "start",
              toolCallId,
              name: normalizedToolName,
              args,
            },
          });
        }

        const finishTool = (result: unknown) => {
          if (!liveStreamEnabled) {
            return;
          }
          emitAgentEvent({
            runId: liveRunId,
            stream: "tool",
            sessionKey: liveSessionKey,
            data: {
              phase: "result",
              toolCallId,
              name: normalizedToolName,
              result,
            },
          });
        };

        const failTool = (err: unknown) => {
          if (!liveStreamEnabled) {
            return;
          }
          emitAgentEvent({
            runId: liveRunId,
            stream: "tool",
            sessionKey: liveSessionKey,
            data: {
              phase: "result",
              toolCallId,
              name: normalizedToolName,
              result: {
                error: err instanceof Error ? err.message : String(err),
              },
            },
          });
        };

        try {
          switch (normalizedToolName) {
          case "bcgpt_smart_action": {
            const basecampUrlHint = pastedUrlHints.basecampUrl;
            const basecampResourceHints = [
              pastedUrlHints.basecampAccountId
                ? `Basecamp account_id: ${pastedUrlHints.basecampAccountId}`
                : null,
              pastedUrlHints.basecampBucketId
                ? `Basecamp bucket_id: ${pastedUrlHints.basecampBucketId}`
                : null,
              pastedUrlHints.basecampCardId
                ? `Basecamp card_id: ${pastedUrlHints.basecampCardId}`
                : null,
              pastedUrlHints.basecampRecordingId
                ? `Basecamp recording_id: ${pastedUrlHints.basecampRecordingId}`
                : null,
              pastedUrlHints.basecampCardPath
                ? `Exact Basecamp card path: ${pastedUrlHints.basecampCardPath}`
                : null,
            ].filter((line): line is string => Boolean(line));
            let query = String(args.query ?? "").trim();
            const project = String(args.project ?? "").trim() || null;
            if (basecampUrlHint) {
              query = query
                ? query.includes(basecampUrlHint)
                  ? query
                  : `${query}\nBasecamp URL: ${basecampUrlHint}${basecampResourceHints.length ? `\n${basecampResourceHints.join("\n")}` : ""}`
                : `Inspect this Basecamp URL and summarize what matters: ${basecampUrlHint}`;
              if (basecampResourceHints.length && !query.includes("Basecamp account_id:")) {
                query = `${query}\n${basecampResourceHints.join("\n")}`;
              }
            }
            if (!query) {
              const value = JSON.stringify({ error: "query is required" });
              finishTool({ error: "query is required" });
              return value;
            }
            const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
              workspaceId,
              allowGlobalSecrets: true,
            });
            if (!apiKey) {
              const value = JSON.stringify({
                error: "Basecamp integration is not configured for this workspace.",
              });
              finishTool({ error: "Basecamp integration is not configured for this workspace." });
              return value;
            }
            const result = await callBcgptTool({
              bcgptUrl,
              apiKey,
              toolName: "smart_action",
              toolArgs: project ? { query, project } : { query },
              timeoutMs: 45_000,
            });
            if (!result.ok) {
              const payload = { error: result.error ?? "smart_action failed" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const payload = {
              tool: "smart_action",
              query,
              project,
              summary: summarizeBcgptSmartActionResult(query, project, result.result),
              continueAgentLoop: true,
              result: result.result,
            };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "bcgpt_list_tools": {
            const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
              workspaceId,
              allowGlobalSecrets: true,
            });
            if (!apiKey) {
              const value = JSON.stringify({
                error: "Basecamp integration is not configured for this workspace.",
              });
              finishTool({ error: "Basecamp integration is not configured for this workspace." });
              return value;
            }
            const result = await listBcgptTools({
              bcgptUrl,
              apiKey,
              timeoutMs: 45_000,
            });
            if (!result.ok) {
              const payload = { error: result.error ?? "Failed to list Basecamp MCP tools" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const toolsCatalog = parseBcgptToolCatalog(result.result);
            const payload = {
              catalog: result.result,
              tools: toolsCatalog,
              summary: summarizeBcgptToolCatalog(toolsCatalog),
              continueAgentLoop: true,
            };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "bcgpt_search_basecamp": {
            const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
              workspaceId,
              allowGlobalSecrets: true,
            });
            if (!apiKey) {
              const value = JSON.stringify({ error: "Basecamp integration is not configured." });
              finishTool({ error: "Basecamp integration is not configured." });
              return value;
            }
            const searchResult = await callBcgptTool({
              bcgptUrl,
              apiKey,
              toolName: "search_basecamp",
              toolArgs: { query: String(args.query ?? ""), project_id: args.project_id ? String(args.project_id) : undefined },
              timeoutMs: 15_000,
            });
            if (!searchResult.ok) {
              const payload = { error: searchResult.error ?? "Search failed" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const searchPayload = {
              tool: "search_basecamp",
              summary: `Found ${((searchResult.result as Record<string, unknown>)?.results as unknown[])?.length ?? 0} results for "${String(args.query ?? "")}"`,
              continueAgentLoop: true,
              result: searchResult.result,
            };
            finishTool(searchPayload);
            return JSON.stringify(searchPayload);
          }
          case "bcgpt_mcp_call": {
            const requestedToolRaw = String(args.tool ?? "").trim();
            const requestedTool = normalizeBcgptNamedToolName(requestedToolRaw);
            const toolArgs =
              args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments)
                ? (args.arguments as Record<string, unknown>)
                : {};
            if (!requestedTool) {
              const payload = { error: "tool is required" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
              workspaceId,
              allowGlobalSecrets: true,
            });
            if (!apiKey) {
              const value = JSON.stringify({
                error: "Basecamp integration is not configured for this workspace.",
              });
              finishTool({ error: "Basecamp integration is not configured for this workspace." });
              return value;
            }
            const result = await callBcgptTool({
              bcgptUrl,
              apiKey,
              toolName: requestedTool,
              toolArgs,
              timeoutMs: 45_000,
            });
            if (!result.ok) {
              const payload = { error: result.error ?? `Basecamp MCP tool ${requestedTool} failed` };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const payload = {
              tool: requestedTool,
              arguments: toolArgs,
              summary: summarizeBcgptDirectToolResult(requestedTool, result.result),
              continueAgentLoop: true,
              result: result.result,
            };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "bcgpt_basecamp_raw": {
            const method = String(args.method ?? "GET").trim().toUpperCase() || "GET";
            const path = String(args.path ?? "").trim();
            const body =
              args.body && typeof args.body === "object" && !Array.isArray(args.body)
                ? (args.body as Record<string, unknown>)
                : undefined;
            if (!path) {
              const payload = { error: "path is required" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
              workspaceId,
              allowGlobalSecrets: true,
            });
            if (!apiKey) {
              const value = JSON.stringify({
                error: "Basecamp integration is not configured for this workspace.",
              });
              finishTool({ error: "Basecamp integration is not configured for this workspace." });
              return value;
            }
            const result = await callBcgptTool({
              bcgptUrl,
              apiKey,
              toolName: "basecamp_raw",
              toolArgs: body ? { method, path, body } : { method, path },
              timeoutMs: 45_000,
            });
            if (!result.ok) {
              const payload = { error: result.error ?? "basecamp_raw failed" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const payload = {
              tool: "basecamp_raw",
              method,
              path,
              summary: summarizeBcgptRawResult(method, path, result.result),
              continueAgentLoop: true,
              result: result.result,
            };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "bcgpt_list_projects": {
            const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
              workspaceId,
              allowGlobalSecrets: true,
            });
            if (!apiKey) {
              const value = JSON.stringify({
                error: "Basecamp integration is not configured for this workspace.",
              });
              finishTool({ error: "Basecamp integration is not configured for this workspace." });
              return value;
            }
            const result = await callBcgptTool({
              bcgptUrl,
              apiKey,
              toolName: "list_projects",
            });
            if (!result.ok) {
              const payload = { error: result.error ?? "Failed to list projects" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const payload = {
              projects: parseProjectList(result.result),
              summary: summarizeBasecampProjectList(parseProjectList(result.result)),
              continueAgentLoop: true,
            };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "pmos_ops_list_credentials": {
            const r = await listWorkflowEngineConnections(workspaceId);
            if (!r.ok) {
              const payload = { error: r.error ?? "Failed to list credentials" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const payload = {
              credentials: (r.credentials ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type })),
            };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "pmos_ops_list_workflows": {
            const r = await listWorkflowEngineWorkflows(workspaceId);
            if (!r.ok) {
              const payload = { error: r.error ?? "Failed to list workflows" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const payload = {
              workflows: (r.workflows ?? []).map((w) => ({ id: w.id, name: w.name, active: w.active })),
            };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "pmos_ops_list_node_types": {
            const r2 = await listWorkflowEngineNodeTypes(workspaceId);
            const BASECAMP_NODE2 = { name: "n8n-nodes-basecamp.basecamp", displayName: "Basecamp (BCgpt Custom Node)", description: "Full Basecamp integration. ALWAYS use this for Basecamp.", group: ["custom"], version: 1 };
            const CORE_NODES2 = [
              { name: "n8n-nodes-base.manualTrigger", displayName: "Manual Trigger", group: ["trigger"], version: 1 },
              { name: "n8n-nodes-base.scheduleTrigger", displayName: "Schedule Trigger", group: ["trigger"], version: 1 },
              { name: "n8n-nodes-base.webhook", displayName: "Webhook", description: "HTTP webhook trigger -- type is webhook NOT webhookTrigger", group: ["trigger"], version: 1 },
              { name: "n8n-nodes-base.if", displayName: "IF", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.switch", displayName: "Switch", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.merge", displayName: "Merge", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.code", displayName: "Code", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.set", displayName: "Edit Fields (Set)", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.filter", displayName: "Filter", group: ["transform"], version: 1 },
              { name: "n8n-nodes-base.httpRequest", displayName: "HTTP Request", group: ["output"], version: 1 },
              { name: "n8n-nodes-base.splitInBatches", displayName: "Loop Over Items", group: ["transform"], version: 1 },
            ];
            const live2 = (r2.ok ? (r2.nodeTypes ?? []) : []).filter(
              (n: { name?: string }) => n.name !== "n8n-nodes-basecamp.basecamp" && !CORE_NODES2.some(c => c.name === n.name)
            );
            const payload = { nodeTypes: [BASECAMP_NODE2, ...CORE_NODES2, ...live2].slice(0, 250) };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "pmos_ops_create_workflow": {
            const name = String(args.name ?? "").trim();
            let nodes2 = Array.isArray(args.nodes) ? [...args.nodes] : [];
            const connections =
              args.connections && typeof args.connections === "object"
                ? (args.connections as Record<string, unknown>)
                : {};
            if (!name) return JSON.stringify({ error: "name is required" });
            if (!nodes2.length) return JSON.stringify({ error: "nodes array is required and must not be empty" });
            // Auto-correct wrong node type names
            const TYPE_FIXES2: Record<string, string> = {
              "n8n-nodes-base.webhookTrigger": "n8n-nodes-base.webhook",
              "n8n-nodes-base.cron": "n8n-nodes-base.scheduleTrigger",
              "n8n-nodes-base.interval": "n8n-nodes-base.scheduleTrigger",
              "n8n-nodes-base.function": "n8n-nodes-base.code",
              "n8n-nodes-base.functionItem": "n8n-nodes-base.code",
            };
            nodes2 = nodes2.map((node: Record<string, unknown>) => {
              const t = String(node.type ?? "");
              if (t.toLowerCase().includes("basecamp") && t !== "n8n-nodes-basecamp.basecamp") return { ...node, type: "n8n-nodes-basecamp.basecamp" };
              if (TYPE_FIXES2[t]) return { ...node, type: TYPE_FIXES2[t] };
              return node;
            });
            const r = await createWorkflowEngineWorkflow(workspaceId, {
              name,
              active: false,
              nodes: nodes2 as Parameters<typeof createWorkflowEngineWorkflow>[1]["nodes"],
              connections,
            });
            if (!r.ok) {
              const payload = { error: r.error ?? "Failed to create workflow" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const payload = {
              success: true,
              workflowId: r.workflow?.id,
              workflowName: name,
              message: `Workflow "${name}" created successfully! ID: ${r.workflow?.id}. It's currently inactive -- activate it in the Workflows panel when ready.`,
            };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "pmos_ops_get_workflow": {
            const id = String(args.workflow_id ?? "").trim();
            if (!id) {
              const payload = { error: "workflow_id is required" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const r = await getWorkflowEngineWorkflow(workspaceId, id);
            if (!r.ok) {
              const payload = { error: r.error ?? "Failed to get workflow" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            finishTool(r.workflow);
            return JSON.stringify(r.workflow);
          }
          case "pmos_ops_execute_workflow": {
            const id = String(args.workflow_id ?? "").trim();
            if (!id) {
              const payload = { error: "workflow_id is required" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const r = await executeWorkflowEngineWorkflow(workspaceId, id);
            if (!r.ok) {
              const payload = { error: r.error ?? "Failed to execute workflow" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const payload = { success: true, executionId: r.executionId ?? "unknown" };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "pmos_ops_update_workflow": {
            const wfId = String(args.workflow_id ?? "").trim();
            const wfName = String(args.name ?? "").trim();
            const wfNodes = Array.isArray(args.nodes) ? args.nodes : [];
            const wfConnections =
              args.connections && typeof args.connections === "object"
                ? (args.connections as Record<string, unknown>)
                : {};
            if (!wfId) {
              const payload = { error: "workflow_id is required" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            if (!wfName) {
              const payload = { error: "name is required" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const ur = await updateWorkflowEngineWorkflow(workspaceId, wfId, {
              name: wfName,
              nodes: wfNodes as Parameters<typeof updateWorkflowEngineWorkflow>[2]["nodes"],
              connections: wfConnections,
            });
            if (!ur.ok) {
              const payload = { error: ur.error ?? "Failed to update workflow" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const payload = {
              success: true,
              workflowId: wfId,
              workflowName: wfName,
              message: `Workflow "${wfName}" (ID: ${wfId}) updated successfully.`,
            };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "pmos_parallel_subtasks": {
            const rawTasks = Array.isArray(args.tasks)
              ? args.tasks.filter(
                  (task): task is Record<string, unknown> =>
                    Boolean(task && typeof task === "object" && !Array.isArray(task)),
                )
              : [];
            if (rawTasks.length === 0) {
              const payload = { error: "tasks must be a non-empty array" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const limitedTasks = rawTasks.slice(0, 6).map((task) => ({
              label: stringOrNull(task.label) ?? undefined,
              task: stringOrNull(task.task) ?? "",
            }));
            const { runPmosParallelSubtasks } = await import("../pmos-parallel-subtasks.js");
            const parallel = await runPmosParallelSubtasks({
              workspaceId,
              baseSystemPrompt: systemPrompt,
              userMessages: messages,
              tasks: limitedTasks,
              tools,
              executeTool,
              maxIterations: 4,
            });
            const payload = {
              continueAgentLoop: true,
              summary: parallel.summary,
              results: parallel.results,
            };
            finishTool(payload);
            return JSON.stringify(payload);
          }

          case "web_search": {
            const q = String(args.query ?? "").trim();
            if (!q) {
              const payload = { error: "query is required" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const { duckDuckGoSearch: ddgSearch } = await import("../pmos-mcp-http.js");
            const sr = await ddgSearch(q, 5);
            finishTool(sr);
            return JSON.stringify(sr);
          }
          case "web_fetch": {
            const fetchUrl = String(args.url ?? "").trim();
            if (!fetchUrl) {
              const payload = { error: "url is required" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const fetchResp = await fetch(fetchUrl, {
              signal: AbortSignal.timeout(10000),
              headers: { "User-Agent": "OpenClaw/1.0" },
            });
            const fetchText = await fetchResp.text();
            const payload = { url: fetchUrl, status: fetchResp.status, content: fetchText.slice(0, 15000) };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "figma_get_context": {
            const figmaContext = await readWorkspaceFigmaContext(workspaceId);
            const payload = {
              ...figmaContext,
              note: "Use the embedded Figma panel only to sync selected-file context and PAT handoff. Use figma_mcp_* first for document/design analysis on the selected file; reserve figma_pat_audit_file for fallback structural audits when MCP cannot reach the needed context.",
              continueAgentLoop: true,
            };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "figma_mcp_list_tools": {
            try {
              const result = await listWorkspaceFigmaMcpServiceTools(workspaceId);
              finishTool(result);
              return JSON.stringify(result);
            } catch (err) {
              figmaMcpFailureSeen = true;
              const payload = await buildWorkspaceFigmaMcpFailurePayload({
                workspaceId,
                err,
                requestedTool: "list_tools",
              });
              finishTool(payload);
              return JSON.stringify(payload);
            }
          }
          case "figma_mcp_call": {
            const requestedTool = String(args.tool ?? "").trim();
            const tool = normalizeFigmaMcpToolName(requestedTool);
            const toolArgs =
              args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments)
                ? (args.arguments as Record<string, unknown>)
                : {};
            if (!tool) {
              const payload = { error: "tool is required" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            figmaMcpCallAttempted = true;
            const figmaContext = await readWorkspaceFigmaContext(workspaceId);
            const effectiveToolArgs = hydrateKnownFigmaContextArguments(toolArgs, figmaContext);
            try {
              const result = await callWorkspaceFigmaMcpServiceTool({
                workspaceId,
                toolName: tool,
                args: effectiveToolArgs,
              });
              finishTool(result);
              return JSON.stringify(result);
            } catch (err) {
              figmaMcpFailureSeen = true;
              const payload = await buildWorkspaceFigmaMcpFailurePayload({
                workspaceId,
                err,
                requestedTool: requestedTool || tool,
              });
              finishTool(payload);
              return JSON.stringify(payload);
            }
          }
          case "figma_pat_audit_file": {
            if (
              shouldDeferFigmaPatAudit({
                latestUserMessage,
                figmaMcpCallAttempted,
                figmaMcpFailureSeen,
              })
            ) {
              const payload = {
                code: "FIGMA_PAT_AUDIT_DEFERRED",
                continueAgentLoop: true,
                note:
                  "This Figma request needs deeper context such as comments, annotations, variables, screenshots, metadata, or exact node/file understanding. Call `figma_mcp_list_tools`, then `figma_mcp_call` with a specific MCP capability before using `figma_pat_audit_file`. Use PAT audit only after a real MCP call or an MCP auth/capability failure.",
              };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const auditArgs =
              pastedUrlHints.figmaUrl &&
              !stringOrNull(args.file_key) &&
              !stringOrNull(args.fileKey) &&
              !stringOrNull(args.url)
                ? {
                    ...args,
                    file_key: pastedUrlHints.figmaFileKey ?? undefined,
                    url: pastedUrlHints.figmaUrl,
                  }
                : args;
            const result = await runWorkspaceFigmaRestAudit(workspaceId, auditArgs);
            const payload =
              hasMixedWorkspaceUrls &&
              result &&
              typeof result === "object" &&
              !Array.isArray(result)
                ? {
                    ...result,
                    continueAgentLoop: true,
                    note:
                      typeof (result as { note?: unknown }).note === "string" &&
                      (result as { note?: string }).note?.trim()
                        ? `${(result as { note: string }).note} Continue with Basecamp lookup and a combined remediation plan before answering.`
                        : "Continue with Basecamp lookup and a combined remediation plan before answering.",
                  }
                : result;
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "fm_get_context":
          case "fm_list_files":
          case "fm_get_file":
          case "fm_update_file":
          case "fm_list_tags":
          case "fm_create_tag":
          case "fm_rename_tag":
          case "fm_delete_tag":
          case "fm_list_folders":
          case "fm_create_folder":
          case "fm_rename_folder":
          case "fm_list_categories":
          case "fm_create_category":
          case "fm_add_link":
          case "fm_delete_link":
          case "fm_sync_team": {
            const fmAuth = await readWorkspaceFmMcpAuth(workspaceId);
            if (!fmAuth.fmMcpUrl || !fmAuth.fmMcpApiToken) {
              const payload = {
                error: "FM MCP not configured",
                hint: "Connect to the Figma File Manager in the Figma panel and sync context. The AI token is provisioned on first sync.",
              };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const mcpMethod = `tools/call`;
            const mcpParams: Record<string, unknown> = { name: toolName, arguments: args };
            try {
              const result = await callFmMcp(fmAuth.fmMcpUrl, fmAuth.fmMcpApiToken, mcpMethod, mcpParams);
              finishTool(result);
              return JSON.stringify(result);
            } catch (err) {
              const payload = { error: String(err), tool: toolName };
              finishTool(payload);
              return JSON.stringify(payload);
            }
          }
          default:
            {
              const payload = { error: `Unknown tool: ${toolName}` };
              finishTool(payload);
              return JSON.stringify(payload);
            }
          }
        } catch (err) {
          failTool(err);
          throw err;
        }
      };

      const disableBasecampTools = isGreetingOnlyMessage(latestUserMessage);
      const agentTools = filterToolDefinitionsByIntents(tools, intents, {
        disableBasecampTools,
        latestUserMessage,
        urlHints: pastedUrlHints,
      });

      const result = await callWorkspaceModelAgentLoop(
        workspaceId,
        systemPrompt,
        messages,
        agentTools,
        executeTool,
        {
          maxTokens: 2048,
          maxIterations: 8,
          ...(chatAgentId ? { agentId: chatAgentId } : {}),
        },
      );

      if (!result.ok) {
        if (liveStreamEnabled) {
          emitAgentEvent({
            runId: liveRunId,
            stream: "lifecycle",
            sessionKey: liveSessionKey,
            data: {
              phase: "error",
              startedAt: liveStartedAt,
              endedAt: Date.now(),
              error: result.error ?? "unknown error",
            },
          });
        }
        respond(
          true,
          {
            ok: false,
            message: `AI model unavailable: ${result.error ?? "unknown error"}. Please check your model configuration in Settings â†' AI Model Setup.`,
            liveStreamed: liveStreamEnabled,
          },
          undefined,
        );
        return;
      }

      const rawFinalMessage = (result.text ?? "").trim();
      const finalMessage = rawFinalMessage
        || "I processed your request but couldn't generate a detailed summary. Please try again or rephrase your question.";
      if (liveStreamEnabled) {
        if (!liveText) {
          emitThinking("Drafting the final response from the collected workspace data.");
        }
        await emitTextChunk(finalMessage);
        emitAgentEvent({
          runId: liveRunId,
          stream: "lifecycle",
          sessionKey: liveSessionKey,
          data: {
            phase: "end",
            startedAt: liveStartedAt,
            endedAt: Date.now(),
          },
        });
      }

      respond(
        true,
        {
          ok: true,
          message: finalMessage,
          providerUsed: result.providerUsed,
          liveStreamed: liveStreamEnabled,
        },
        undefined,
      );
    } catch (err) {
      const liveRunId =
        typeof req?.id === "string" && req.id.trim() ? req.id.trim() : "";
      const liveSessionKey =
        typeof params === "object" &&
        params &&
        "sessionKey" in params &&
        typeof (params as { sessionKey?: unknown }).sessionKey === "string"
          ? String((params as { sessionKey?: unknown }).sessionKey).trim()
          : "";
      if (liveRunId && liveSessionKey) {
        emitAgentEvent({
          runId: liveRunId,
          stream: "lifecycle",
          sessionKey: liveSessionKey,
          data: {
            phase: "error",
            startedAt: Date.now(),
            endedAt: Date.now(),
            error: String(err),
          },
        });
        respond(
          true,
          {
            ok: false,
            message: String(err),
            liveStreamed: true,
          },
          undefined,
        );
        return;
      }
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // â"€â"€ Connections: Real n8n credential list â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  "pmos.projects.snapshot": async ({ respond, client, params }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = isJsonObject(params) ? params : null;
      const fresh = p?.fresh === true;

      const { bcgptUrl, apiKey: bcgptApiKey } = await resolveWorkspaceBcgptAccess({
        workspaceId,
        allowGlobalSecrets: true,
      });

      const emptySnapshot = {
        workspaceId,
        configured: false,
        connected: false,
        connectorUrl: bcgptUrl,
        identity: null,
        totals: {
          projectCount: 0,
          syncedProjects: 0,
          openTodos: 0,
          assignedTodos: 0,
          overdueTodos: 0,
          dueTodayTodos: 0,
          futureTodos: 0,
          noDueDateTodos: 0,
        },
        projects: [] as PmosProjectCard[],
        assignedTodos: [] as PmosProjectTodoItem[],
        urgentTodos: [] as PmosProjectTodoItem[],
        dueTodayTodos: [] as PmosProjectTodoItem[],
        futureTodos: [] as PmosProjectTodoItem[],
        noDueDateTodos: [] as PmosProjectTodoItem[],
        errors: [] as string[],
        refreshedAtMs: Date.now(),
      };

      if (!bcgptApiKey) {
        respond(
          true,
          {
            ...emptySnapshot,
            errors: ["BCGPT key is not configured for this workspace."],
          },
          undefined,
        );
        return;
      }

      const errors: string[] = [];
      const [start, workspaceSnapshotResult] = await Promise.all([
        fetchJson(`${bcgptUrl}/action/startbcgpt`, {
          method: "POST",
          timeoutMs: 4_000,
          headers: {
            "content-type": "application/json",
            "x-bcgpt-api-key": bcgptApiKey,
          },
          body: JSON.stringify({}),
        }),
        callBcgptTool({
          bcgptUrl,
          apiKey: bcgptApiKey,
          toolName: "workspace_todo_snapshot",
          toolArgs: {
            max_age_ms: fresh ? 0 : 900_000,
            force_refresh: fresh,
            wait_for_fresh: fresh,
            allow_stale_on_error: true,
            preview_limit: 12,
            project_preview_limit: 3,
          },
          timeoutMs: fresh ? 180_000 : 20_000,
        }),
      ]);

      const startPayload = isJsonObject(start.json) ? start.json : {};
      if (!start.ok && start.error) {
        errors.push(`Basecamp identity check failed: ${start.error}`);
      }
      const startUser = isJsonObject(startPayload.user) ? startPayload.user : null;
      const identity = {
        connected: startPayload.connected === true,
        name: stringOrNull(startUser?.name),
        email: stringOrNull(startUser?.email),
        selectedAccountId:
          numberStringOrNull(startPayload.selected_account_id),
        accountsCount: Array.isArray(startPayload.accounts) ? startPayload.accounts.length : 0,
        message: stringOrNull(startPayload.message),
      };

      if (workspaceSnapshotResult.ok && isJsonObject(workspaceSnapshotResult.result)) {
        const rawSnapshotPayload = workspaceSnapshotResult.result as Record<string, unknown>;
        const snapshotPayload = isJsonObject(rawSnapshotPayload.result)
          ? (rawSnapshotPayload.result as Record<string, unknown>)
          : rawSnapshotPayload;
        const workspaceMeta = isJsonObject(snapshotPayload.workspace) ? snapshotPayload.workspace : null;
        const totalsRaw = isJsonObject(snapshotPayload.totals) ? snapshotPayload.totals : null;
        const mappedSummaryProjects = mapWorkspaceSnapshotProjectCards(snapshotPayload.projects);
        const mappedDetailProjects = mapWorkspaceSnapshotProjectCards(
          snapshotPayload.project_details ?? snapshotPayload.projectDetails,
        );
        const mappedProjects = mergeWorkspaceSnapshotProjectCards(mappedSummaryProjects, mappedDetailProjects);
        const assignedItems = snapshotPayload.assignedTodos ?? snapshotPayload.assigned_todos;
        const overdueItems = snapshotPayload.urgentTodos ?? snapshotPayload.overdueTodos ?? snapshotPayload.overdue_todos;
        const dueTodayItems = snapshotPayload.dueTodayTodos ?? snapshotPayload.due_today_todos;
        const futureItems = snapshotPayload.futureTodos ?? snapshotPayload.future_todos;
        const noDueDateItems = snapshotPayload.noDueDateTodos ?? snapshotPayload.no_due_date_todos;
        if (totalsRaw) {
          const mappedSnapshot = {
            workspaceId,
            configured: true,
            connected: identity.connected === true,
            connectorUrl: bcgptUrl,
            identity,
            totals: {
              projectCount: typeof totalsRaw.projectCount === "number" ? totalsRaw.projectCount : mappedProjects.length,
              syncedProjects:
                typeof totalsRaw.syncedProjects === "number" ? totalsRaw.syncedProjects : mappedProjects.length,
              openTodos: typeof totalsRaw.openTodos === "number" ? totalsRaw.openTodos : 0,
              assignedTodos: typeof totalsRaw.assignedTodos === "number" ? totalsRaw.assignedTodos : 0,
              overdueTodos: typeof totalsRaw.overdueTodos === "number" ? totalsRaw.overdueTodos : 0,
              dueTodayTodos: typeof totalsRaw.dueTodayTodos === "number" ? totalsRaw.dueTodayTodos : 0,
              futureTodos: typeof totalsRaw.futureTodos === "number" ? totalsRaw.futureTodos : 0,
              noDueDateTodos: typeof totalsRaw.noDueDateTodos === "number" ? totalsRaw.noDueDateTodos : 0,
            },
            projects: mappedProjects,
            assignedTodos: mapWorkspaceSnapshotTodoItems(assignedItems),
            urgentTodos: mapWorkspaceSnapshotTodoItems(overdueItems),
            dueTodayTodos: mapWorkspaceSnapshotTodoItems(dueTodayItems),
            futureTodos: mapWorkspaceSnapshotTodoItems(futureItems),
            noDueDateTodos: mapWorkspaceSnapshotTodoItems(noDueDateItems),
            errors: [
              ...errors,
              ...((Array.isArray(snapshotPayload.errors)
                ? snapshotPayload.errors.filter((entry): entry is string => typeof entry === "string")
                : []) as string[]),
            ].slice(0, 20),
            refreshedAtMs:
              typeof snapshotPayload.fetchedAt === "number"
                ? snapshotPayload.fetchedAt * 1000
                : typeof workspaceMeta?.fetchedAt === "number"
                  ? workspaceMeta.fetchedAt * 1000
                : Date.now(),
            stale: snapshotPayload.stale === true,
            staleReason:
              stringOrNull(
                isJsonObject(snapshotPayload.syncState)
                  ? snapshotPayload.syncState.lastError
                  : isJsonObject(workspaceMeta?.syncState)
                    ? workspaceMeta.syncState.lastError
                    : null,
              ) ?? null,
            cacheAgeMs: typeof snapshotPayload.ageMs === "number" ? snapshotPayload.ageMs : 0,
          };
          respond(true, mappedSnapshot, undefined);
          return;
        }
      }

      const listProjectsResult = await callBcgptTool({
        bcgptUrl,
        apiKey: bcgptApiKey,
        toolName: "list_projects",
        toolArgs: {},
      });
      if (!listProjectsResult.ok) {
        errors.push(`Failed to list projects: ${listProjectsResult.error ?? "unknown error"}`);
      }
      const projects = parseProjectList(listProjectsResult.result);
      const projectNameById = new Map<string, string>();
      for (const project of projects) {
        projectNameById.set(project.id, project.name);
      }

      const todayIso = new Date().toISOString().slice(0, 10);
      const reportsPromise = Promise.all([
        callBcgptTool({
          bcgptUrl,
          apiKey: bcgptApiKey,
          toolName: "report_todos_overdue",
          toolArgs: {},
          timeoutMs: 15_000,
        }),
        callBcgptTool({
          bcgptUrl,
          apiKey: bcgptApiKey,
          toolName: "list_todos_due",
          toolArgs: { date: todayIso, include_overdue: false },
          timeoutMs: 15_000,
        }),
        callBcgptTool({
          bcgptUrl,
          apiKey: bcgptApiKey,
          toolName: "list_assigned_to_me",
          toolArgs: {},
          timeoutMs: 20_000,
        }),
        callBcgptTool({
          bcgptUrl,
          apiKey: bcgptApiKey,
          toolName: "daily_report",
          toolArgs: { date: todayIso },
          timeoutMs: 20_000,
        }),
      ]);

      const [overdueRpc, dueTodayRpc, assignedRpc, dailyReportRpc] = await reportsPromise;

      if (!overdueRpc.ok) {
        errors.push(`Failed to load overdue todos: ${overdueRpc.error ?? "unknown error"}`);
      }
      if (!dueTodayRpc.ok && !isAbortLikeError(dueTodayRpc.error)) {
        errors.push(`Failed to load due-today todos: ${dueTodayRpc.error ?? "unknown error"}`);
      }
      if (!assignedRpc.ok) {
        errors.push(`Failed to load assigned todos: ${assignedRpc.error ?? "unknown error"}`);
      }

      let overdueTodos = parseTodoItems(overdueRpc.result, "overdue", projectNameById);
      let dueTodayTodos = parseTodoItems(dueTodayRpc.result, "todos", projectNameById).filter(
        (todo) => todo.dueOn === todayIso,
      );
      const assignedTodos = parseTodoItems(assignedRpc.result, "todos", projectNameById);
      const aggregateByProjectId = dailyReportRpc.ok
        ? parseDailyReportPerProject(dailyReportRpc.result)
        : new Map<string, { openTodos: number; overdueTodos: number; dueTodayTodos: number }>();
      const detailProjects = rankProjectDetailCandidates(
        projects,
        aggregateByProjectId,
        countTodosByProject(assignedTodos),
        16,
      );
      const detailsByProjectId = new Map<string, unknown>();
      await Promise.all(
        detailProjects.map(async (project) => {
          const detail = await callBcgptTool({
            bcgptUrl,
            apiKey: bcgptApiKey,
            toolName: "list_todos_for_project",
            toolArgs: { project: project.id, compact: true, preview_limit: 20 },
            timeoutMs: 12_000,
          });
          if (!detail.ok) {
            errors.push(`Failed to load todos for ${project.name}: ${detail.error ?? "unknown error"}`);
            return;
          }
          detailsByProjectId.set(project.id, detail.result);
        }),
      );

      const previewTodos = dedupeTodoItems(
        detailProjects.flatMap((project) => parseTodoPreviewItems(detailsByProjectId.get(project.id), project)),
      );
      const classifiedTodos = dedupeTodoItems([
        ...previewTodos,
        ...assignedTodos,
        ...overdueTodos,
        ...dueTodayTodos,
      ]);

      if (!overdueTodos.length) {
        overdueTodos = classifiedTodos.filter((todo) => classifyTodoDueBucket(todo.dueOn, todayIso) === "past");
      }
      if (!dueTodayTodos.length) {
        dueTodayTodos = classifiedTodos.filter((todo) => classifyTodoDueBucket(todo.dueOn, todayIso) === "today");
      }
      const futureTodos = classifiedTodos.filter((todo) => classifyTodoDueBucket(todo.dueOn, todayIso) === "future");
      const noDueDateTodos = classifiedTodos.filter(
        (todo) => classifyTodoDueBucket(todo.dueOn, todayIso) === "none",
      );

      if (
        dueTodayRpc.ok === false &&
        isAbortLikeError(dueTodayRpc.error) &&
        !dueTodayTodos.length &&
        !futureTodos.length &&
        !noDueDateTodos.length
      ) {
        errors.push("Live due-date buckets are temporarily degraded. Showing the todo data that Basecamp returned.");
      }

      const assignedByProject = countTodosByProject(assignedTodos);
      const overdueByProject = countTodosByProject(overdueTodos);
      const dueTodayByProject = countTodosByProject(dueTodayTodos);
      const futureByProject = countTodosByProject(futureTodos);
      const noDueDateByProject = countTodosByProject(noDueDateTodos);

      const cards: PmosProjectCard[] = projects.map((project) => {
        const detail = detailsByProjectId.get(project.id);
        const groups = isJsonObject(detail) && Array.isArray(detail.groups) ? detail.groups : [];
        const aggregate = aggregateByProjectId.get(project.id);
        let openTodos = aggregate?.openTodos ?? 0;
        let todoLists = 0;
        const dueDates: string[] = [];
        for (const groupRaw of groups) {
          if (!isJsonObject(groupRaw)) continue;
          todoLists += 1;
          const todosCount = typeof groupRaw.todos_count === "number" && Number.isFinite(groupRaw.todos_count)
            ? groupRaw.todos_count
            : 0;
          if (!aggregate) {
            openTodos += todosCount;
          }
          const preview = Array.isArray(groupRaw.todos_preview) ? groupRaw.todos_preview : [];
          for (const todoRaw of preview) {
            if (!isJsonObject(todoRaw)) continue;
            const due = stringOrNull(todoRaw.due_on);
            if (due) dueDates.push(due);
          }
        }
        const nextDueOn = dueDates
          .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
          .sort((a, b) => a.localeCompare(b))[0] ?? null;
        const assignedCount = assignedByProject.get(project.id) ?? 0;
        const overdueCount = overdueByProject.get(project.id) ?? aggregate?.overdueTodos ?? 0;
        const dueTodayCount = dueTodayByProject.get(project.id) ?? aggregate?.dueTodayTodos ?? 0;
        const futureCount = futureByProject.get(project.id) ?? 0;
        const noDueDateCount = noDueDateByProject.get(project.id) ?? 0;
        const previewTodos = parseTodoPreviewItems(detail, project).slice(0, 4);
        return {
          id: project.id,
          name: project.name,
          status: project.status,
          appUrl: project.appUrl,
          todoLists,
          openTodos,
          assignedTodos: assignedCount,
          overdueTodos: overdueCount,
          dueTodayTodos: dueTodayCount,
          futureTodos: futureCount,
          noDueDateTodos: noDueDateCount,
          nextDueOn,
          health: projectHealthFromCounts({
            openTodos,
            overdueTodos: overdueCount,
            dueTodayTodos: dueTodayCount,
          }),
          previewTodos,
        };
      });

      cards.sort((a, b) => {
        if (b.overdueTodos !== a.overdueTodos) return b.overdueTodos - a.overdueTodos;
        if (b.dueTodayTodos !== a.dueTodayTodos) return b.dueTodayTodos - a.dueTodayTodos;
        if (b.openTodos !== a.openTodos) return b.openTodos - a.openTodos;
        return a.name.localeCompare(b.name);
      });

      const totals = {
        projectCount: projects.length,
        syncedProjects: cards.length,
        openTodos: cards.reduce((sum, card) => sum + card.openTodos, 0),
        assignedTodos: assignedTodos.length,
        overdueTodos: overdueTodos.length,
        dueTodayTodos: dueTodayTodos.length,
        futureTodos: futureTodos.length,
        noDueDateTodos: noDueDateTodos.length,
      };
      const connected =
        identity.connected ||
        listProjectsResult.ok ||
        dailyReportRpc.ok ||
        assignedRpc.ok ||
        overdueRpc.ok ||
        dueTodayRpc.ok ||
        detailsByProjectId.size > 0;

      respond(
        true,
        {
          workspaceId,
          configured: true,
          connected,
          connectorUrl: bcgptUrl,
          identity,
          totals,
          projects: cards,
          assignedTodos: sortTodoItems(assignedTodos, todayIso).slice(0, 20),
          urgentTodos: sortTodoItems(overdueTodos, todayIso).slice(0, 20),
          dueTodayTodos: sortTodoItems(dueTodayTodos, todayIso).slice(0, 20),
          futureTodos: sortTodoItems(futureTodos, todayIso).slice(0, 20),
          noDueDateTodos: sortTodoItems(noDueDateTodos, todayIso).slice(0, 20),
          errors: errors.slice(0, 20),
          refreshedAtMs: Date.now(),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.connections.list": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { fetchWorkspaceCredentials } = await import("../credential-sync.js");
      const credentials = await fetchWorkspaceCredentials(workspaceId);
      respond(true, { credentials }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // â"€â"€ Super-admin: Workspace List â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  "pmos.workspaces.list": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      if (!isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "super_admin role required"));
        return;
      }
      const { listPmosWorkspaces } = await import("../pmos-auth.js");
      const workspaces = await listPmosWorkspaces();
      respond(true, { workspaces }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // â"€â"€ Basecamp credential setup in workflow engine â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  "pmos.workflow.setup.basecamp": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
      const wc = await readWorkspaceConnectors(workspaceId);
      const bcgptApiKey = (wc?.bcgpt?.apiKey as string | undefined)?.trim();
      if (!bcgptApiKey) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "No BCGPT API key stored. Save your Basecamp connection key in Integrations first."));
        return;
      }
      const { upsertBasecampWorkflowConnection } = await import("../workflow-api-client.js");
      const result = await upsertBasecampWorkflowConnection(workspaceId, bcgptApiKey);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to configure Basecamp credential in workflow engine"));
        return;
      }
      respond(true, { ok: true, credentialId: result.credentialId, message: "Basecamp credential configured in your workflow engine." }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.setup.basecamp": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
      const wc = await readWorkspaceConnectors(workspaceId);
      const bcgptApiKey = (wc?.bcgpt?.apiKey as string | undefined)?.trim();
      if (!bcgptApiKey) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "No BCGPT API key stored. Save your Basecamp connection key in Integrations first."));
        return;
      }
      const { upsertBasecampWorkflowConnection } = await import("../workflow-api-client.js");
      const result = await upsertBasecampWorkflowConnection(workspaceId, bcgptApiKey);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to configure Basecamp credential in workflow engine"));
        return;
      }
      respond(true, { ok: true, credentialId: result.credentialId, message: "Basecamp credential configured in your workflow engine." }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.ops.setup.basecamp": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
      const wc = await readWorkspaceConnectors(workspaceId);
      const bcgptApiKey = (wc?.bcgpt?.apiKey as string | undefined)?.trim();
      if (!bcgptApiKey) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "No BCGPT API key stored. Save your Basecamp connection key in Integrations first."));
        return;
      }
      const { upsertBasecampWorkflowConnection } = await import("../workflow-api-client.js");
      const result = await upsertBasecampWorkflowConnection(workspaceId, bcgptApiKey);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to configure Basecamp credential in workflow engine"));
        return;
      }
      respond(true, { ok: true, credentialId: result.credentialId, message: "Basecamp credential configured in your workflow engine." }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // â"€â"€ Workflow Engine Credentials Management â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  "pmos.n8n.credentials.list": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { listWorkflowEngineConnections } = await import("../workflow-api-client.js");
      const result = await listWorkflowEngineConnections(workspaceId);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to list workflow-engine credentials"));
        return;
      }
      respond(true, { credentials: result.credentials }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.credentials.list": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { listWorkflowEngineConnections } = await import("../workflow-api-client.js");
      const result = await listWorkflowEngineConnections(workspaceId);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to list workflow-engine credentials"));
        return;
      }
      respond(true, { credentials: result.credentials }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.workflow.credentials.list": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { listWorkflowEngineConnections } = await import("../workflow-api-client.js");
      const result = await listWorkflowEngineConnections(workspaceId);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to list workflow-engine credentials"));
        return;
      }
      respond(true, { credentials: result.credentials }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.ops.credentials.list": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { listWorkflowEngineConnections } = await import("../workflow-api-client.js");
      const result = await listWorkflowEngineConnections(workspaceId);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to list workflow-engine credentials"));
        return;
      }
      respond(true, { credentials: result.credentials }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.n8n.credentials.create": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as { name?: string; type?: string; data?: Record<string, unknown> } | null;
      if (!p?.name || !p?.type) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "name and type required"));
        return;
      }
      const { createWorkflowEngineConnection } = await import("../workflow-api-client.js");
      const result = await createWorkflowEngineConnection(workspaceId, p.name, p.type, p.data || {});
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to create workflow-engine credential"));
        return;
      }
      respond(true, { ok: true, credentialId: result.credentialId }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.credentials.create": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as { name?: string; type?: string; data?: Record<string, unknown> } | null;
      if (!p?.name || !p?.type) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "name and type required"));
        return;
      }
      const { createWorkflowEngineConnection } = await import("../workflow-api-client.js");
      const result = await createWorkflowEngineConnection(workspaceId, p.name, p.type, p.data || {});
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to create workflow-engine credential"));
        return;
      }
      respond(true, { ok: true, credentialId: result.credentialId }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.workflow.credentials.create": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as { name?: string; type?: string; data?: Record<string, unknown> } | null;
      if (!p?.name || !p?.type) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "name and type required"));
        return;
      }
      const { createWorkflowEngineConnection } = await import("../workflow-api-client.js");
      const result = await createWorkflowEngineConnection(workspaceId, p.name, p.type, p.data || {});
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to create workflow-engine credential"));
        return;
      }
      respond(true, { ok: true, credentialId: result.credentialId }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.ops.credentials.create": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as { name?: string; type?: string; data?: Record<string, unknown> } | null;
      if (!p?.name || !p?.type) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "name and type required"));
        return;
      }
      const { createWorkflowEngineConnection } = await import("../workflow-api-client.js");
      const result = await createWorkflowEngineConnection(workspaceId, p.name, p.type, p.data || {});
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to create workflow-engine credential"));
        return;
      }
      respond(true, { ok: true, credentialId: result.credentialId }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.n8n.credentials.delete": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as { credentialId?: string } | null;
      if (!p?.credentialId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "credentialId required"));
        return;
      }
      const { deleteWorkflowEngineConnection } = await import("../workflow-api-client.js");
      const result = await deleteWorkflowEngineConnection(workspaceId, p.credentialId);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to delete workflow-engine credential"));
        return;
      }
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.credentials.delete": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as { credentialId?: string } | null;
      if (!p?.credentialId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "credentialId required"));
        return;
      }
      const { deleteWorkflowEngineConnection } = await import("../workflow-api-client.js");
      const result = await deleteWorkflowEngineConnection(workspaceId, p.credentialId);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to delete workflow-engine credential"));
        return;
      }
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.workflow.credentials.delete": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as { credentialId?: string } | null;
      if (!p?.credentialId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "credentialId required"));
        return;
      }
      const { deleteWorkflowEngineConnection } = await import("../workflow-api-client.js");
      const result = await deleteWorkflowEngineConnection(workspaceId, p.credentialId);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to delete workflow-engine credential"));
        return;
      }
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.ops.credentials.delete": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as { credentialId?: string } | null;
      if (!p?.credentialId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "credentialId required"));
        return;
      }
      const { deleteWorkflowEngineConnection } = await import("../workflow-api-client.js");
      const result = await deleteWorkflowEngineConnection(workspaceId, p.credentialId);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to delete workflow-engine credential"));
        return;
      }
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // â"€â"€ Super-admin: reset all workspaces to a single fresh starter agent â"€â"€â"€â"€â"€â"€â"€â"€â"€

  "pmos.admin.reset-all-workspaces": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      if (!isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "super_admin role required"));
        return;
      }
      const [{ listPmosWorkspaces }, { resetWorkspaceToSingleStarter }] = await Promise.all([
        import("../pmos-auth.js"),
        import("../pmos-auth-http.js"),
      ]);
      const workspaces = await listPmosWorkspaces();
      const results: Array<{ workspaceId: string; ok: boolean; error?: string }> = [];
      for (const ws of workspaces) {
        try {
          await resetWorkspaceToSingleStarter(ws.workspaceId);
          results.push({ workspaceId: ws.workspaceId, ok: true });
        } catch (err) {
          results.push({ workspaceId: ws.workspaceId, ok: false, error: String(err) });
        }
      }
      const failed = results.filter((r) => !r.ok);
      respond(true, { results, failed: failed.length }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // -- Per-project section fetch (Todos, Messages, People, Schedule, Card Tables) --

  "pmos.project.fetch": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);

      const p = params as { projectName?: unknown; section?: unknown } | null;
      const projectName = typeof p?.projectName === "string" ? p.projectName.trim() : "";
      const section = typeof p?.section === "string" ? p.section.trim() : "";

      if (!projectName) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "projectName is required"));
        return;
      }
      if (!section) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "section is required"));
        return;
      }

      const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
        workspaceId,
        allowGlobalSecrets: true,
      });
      if (!apiKey) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Basecamp integration is not configured for this workspace."));
        return;
      }

      // Helper: get root payload (handles { result: {...} } wrapper or flat)
      const getRoot = (raw: unknown): Record<string, unknown> => {
        const payload = isJsonObject(raw) ? raw : {};
        return isJsonObject(payload.result) ? payload.result : payload;
      };
      const getItems = (root: Record<string, unknown>, ...keys: string[]): unknown[] => {
        for (const key of keys) {
          const value = root[key];
          if (Array.isArray(value)) return value;
        }
        return [];
      };
      const loadProjectSync = async (toolArgs: Record<string, unknown>) =>
        callBcgptTool({
          bcgptUrl,
          apiKey,
          toolName: "pmos_project_sync",
          toolArgs: {
            project: projectName,
            include_details: true,
            include_disabled_tools: true,
            include_todos: false,
            include_people: false,
            include_cards: false,
            include_messages: false,
            include_documents: false,
            include_schedule: false,
            include_campfires: false,
            ...toolArgs,
          },
          timeoutMs: 45_000,
        });

      switch (section) {
        case "todos": {
          const syncRes = await loadProjectSync({ include_todos: true });
          if (syncRes.ok) {
            const root = getRoot(syncRes.result);
            const groups = getItems(root, "todo_groups");
            const data = groups.filter(isJsonObject).map((g) => ({
              name: stringOrNull(g.todolist) ?? stringOrNull(g.name) ?? "Untitled",
              todosCount: Array.isArray(g.todos) ? g.todos.length : (typeof g.todos_count === "number" ? g.todos_count : 0),
              todos: (Array.isArray(g.todos) ? g.todos : []).filter(isJsonObject).map((t) => ({
                id: numberStringOrNull(t.id) ?? numberStringOrNull(t.todoId) ?? numberStringOrNull(t.todo_id),
                title: stringOrNull(t.title) ?? stringOrNull(t.content) ?? "",
                status: stringOrNull(t.status) ?? "active",
                dueOn: stringOrNull(t.due_on) ?? stringOrNull(t.dueOn),
                appUrl: stringOrNull(t.app_url) ?? stringOrNull(t.appUrl),
                assignee: isJsonObject(t.assignee) ? stringOrNull(t.assignee.name) : stringOrNull(t.assignee),
                completedAt: stringOrNull(t.completed_at),
                creator: isJsonObject(t.creator) ? stringOrNull(t.creator.name) : null,
              })),
            }));
            respond(true, { ok: true, section, projectName, data });
            return;
          }
          const res = await callBcgptTool({ bcgptUrl, apiKey, toolName: "list_todos_for_project", toolArgs: { project: projectName, compact: false }, timeoutMs: 30_000 });
          if (!res.ok) { respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, res.error ?? "Failed to fetch todos")); return; }
          const root = getRoot(res.result);
          const groups = Array.isArray(root.groups) ? root.groups : [];
          const data = groups.filter(isJsonObject).map((g) => ({
            name: stringOrNull(g.todolist) ?? stringOrNull(g.name) ?? "Untitled",
            todosCount: typeof g.todos_count === "number" ? g.todos_count : 0,
            todos: (Array.isArray(g.todos) ? g.todos : []).filter(isJsonObject).map((t) => ({
              id: numberStringOrNull(t.id),
              title: stringOrNull(t.title) ?? "",
              status: stringOrNull(t.status) ?? "active",
              dueOn: stringOrNull(t.due_on) ?? stringOrNull(t.dueOn),
              appUrl: stringOrNull(t.app_url) ?? stringOrNull(t.appUrl),
              assignee: isJsonObject(t.assignee) ? stringOrNull(t.assignee.name) : stringOrNull(t.assignee),
              completedAt: stringOrNull(t.completed_at),
              creator: isJsonObject(t.creator) ? stringOrNull(t.creator.name) : null,
            })),
          }));
          respond(true, { ok: true, section, projectName, data });
          return;
        }
        case "messages": {
          const syncRes = await loadProjectSync({ include_messages: true });
          if (syncRes.ok) {
            const root = getRoot(syncRes.result);
            const msgs = getItems(root, "messages");
            const data = msgs.filter(isJsonObject).map((m) => ({
              id: numberStringOrNull(m.id),
              title: stringOrNull(m.title) ?? stringOrNull(m.subject) ?? "(no title)",
              author: isJsonObject(m.creator) ? stringOrNull(m.creator.name) : stringOrNull(m.author),
              createdAt: stringOrNull(m.created_at) ?? stringOrNull(m.createdAt),
              excerpt: stringOrNull(m.excerpt) ?? stringOrNull(m.content_excerpt) ?? stringOrNull(m.content),
              appUrl: stringOrNull(m.app_url) ?? stringOrNull(m.appUrl),
            }));
            respond(true, { ok: true, section, projectName, data });
            return;
          }
          const res = await callBcgptTool({ bcgptUrl, apiKey, toolName: "list_messages", toolArgs: { project: projectName }, timeoutMs: 30_000 });
          if (!res.ok) { respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, res.error ?? "Failed to fetch messages")); return; }
          const root = getRoot(res.result);
          const msgs = Array.isArray(root.messages) ? root.messages : Array.isArray(root) ? root as unknown[] : [];
          const data = (msgs as unknown[]).filter(isJsonObject).map((m) => ({
            id: numberStringOrNull(m.id),
            title: stringOrNull(m.title) ?? stringOrNull(m.subject) ?? "(no title)",
            author: isJsonObject(m.creator) ? stringOrNull(m.creator.name) : stringOrNull(m.author),
            createdAt: stringOrNull(m.created_at) ?? stringOrNull(m.createdAt),
            excerpt: stringOrNull(m.excerpt) ?? stringOrNull(m.content_excerpt),
            appUrl: stringOrNull(m.app_url) ?? stringOrNull(m.appUrl),
          }));
          respond(true, { ok: true, section, projectName, data });
          return;
        }
        case "schedule": {
          const syncRes = await loadProjectSync({ include_schedule: true });
          if (syncRes.ok) {
            const root = getRoot(syncRes.result);
            const entries = getItems(root, "schedule_entries");
            const data = entries.filter(isJsonObject).map((e) => ({
              id: numberStringOrNull(e.id),
              title: stringOrNull(e.title) ?? stringOrNull(e.summary) ?? "(no title)",
              startsAt: stringOrNull(e.starts_at) ?? stringOrNull(e.startsAt),
              endsAt: stringOrNull(e.ends_at) ?? stringOrNull(e.endsAt),
              allDay: e.all_day === true || e.allDay === true,
              summary: stringOrNull(e.summary) ?? stringOrNull(e.description),
              appUrl: stringOrNull(e.app_url) ?? stringOrNull(e.appUrl),
            }));
            respond(true, { ok: true, section, projectName, data });
            return;
          }
          const res = await callBcgptTool({ bcgptUrl, apiKey, toolName: "list_schedule_entries", toolArgs: { project: projectName }, timeoutMs: 30_000 });
          if (!res.ok) { respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, res.error ?? "Failed to fetch schedule")); return; }
          const root = getRoot(res.result);
          const entries = Array.isArray(root.entries) ? root.entries : Array.isArray(root) ? root as unknown[] : [];
          const data = (entries as unknown[]).filter(isJsonObject).map((e) => ({
            id: numberStringOrNull(e.id),
            title: stringOrNull(e.title) ?? "(no title)",
            startsAt: stringOrNull(e.starts_at) ?? stringOrNull(e.startsAt),
            endsAt: stringOrNull(e.ends_at) ?? stringOrNull(e.endsAt),
            allDay: e.all_day === true || e.allDay === true,
            summary: stringOrNull(e.summary),
            appUrl: stringOrNull(e.app_url) ?? stringOrNull(e.appUrl),
          }));
          respond(true, { ok: true, section, projectName, data });
          return;
        }
        case "campfire": {
          const syncRes = await loadProjectSync({ include_campfires: true, campfire_lines_limit: 80 });
          if (syncRes.ok) {
            const root = getRoot(syncRes.result);
            const campfires = getItems(root, "campfires");
            const lines = getItems(root, "campfire_lines");
            const data = {
              chats: campfires.filter(isJsonObject).map((chat) => ({
                id: numberStringOrNull(chat.id),
                title: stringOrNull(chat.title) ?? stringOrNull(chat.name) ?? "Campfire",
                appUrl: stringOrNull(chat.app_url) ?? stringOrNull(chat.appUrl),
              })),
              lines: lines.filter(isJsonObject).map((line) => ({
                id: numberStringOrNull(line.id),
                content: stringOrNull(line.content) ?? stringOrNull(line.summary) ?? "",
                createdAt: stringOrNull(line.created_at) ?? stringOrNull(line.createdAt),
                author: isJsonObject(line.creator) ? stringOrNull(line.creator.name) : stringOrNull(line.author),
                appUrl: stringOrNull(line.app_url) ?? stringOrNull(line.appUrl),
              })),
            };
            respond(true, { ok: true, section, projectName, data });
            return;
          }
          const chatsRes = await callBcgptTool({
            bcgptUrl,
            apiKey,
            toolName: "list_campfires",
            toolArgs: { project: projectName },
            timeoutMs: 30_000,
          });
          if (!chatsRes.ok) {
            respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, chatsRes.error ?? "Failed to fetch campfire"));
            return;
          }
          const chatsRoot = getRoot(chatsRes.result);
          const chats = Array.isArray(chatsRoot.campfires) ? chatsRoot.campfires.filter(isJsonObject) : [];
          const firstChatId = chats.length > 0 ? numberStringOrNull(chats[0].id) : null;
          const linesRes = firstChatId
            ? await callBcgptTool({
                bcgptUrl,
                apiKey,
                toolName: "list_campfire_lines",
                toolArgs: { project: projectName, campfire_id: firstChatId, limit: 80 },
                timeoutMs: 30_000,
              })
            : null;
          const linesRoot = linesRes?.ok ? getRoot(linesRes.result) : {};
          const lines = Array.isArray(linesRoot.lines) ? linesRoot.lines.filter(isJsonObject) : [];
          respond(true, {
            ok: true,
            section,
            projectName,
            data: {
              chats: chats.map((chat) => ({
                id: numberStringOrNull(chat.id),
                title: stringOrNull(chat.title) ?? stringOrNull(chat.name) ?? "Campfire",
                appUrl: stringOrNull(chat.app_url) ?? stringOrNull(chat.appUrl),
              })),
              lines: lines.map((line) => ({
                id: numberStringOrNull(line.id),
                content: stringOrNull(line.content) ?? stringOrNull(line.summary) ?? "",
                createdAt: stringOrNull(line.created_at) ?? stringOrNull(line.createdAt),
                author: isJsonObject(line.creator) ? stringOrNull(line.creator.name) : stringOrNull(line.author),
                appUrl: stringOrNull(line.app_url) ?? stringOrNull(line.appUrl),
              })),
            },
          });
          return;
        }
        case "files": {
          const syncRes = await loadProjectSync({ include_documents: true });
          if (syncRes.ok) {
            const root = getRoot(syncRes.result);
            const documents = getItems(root, "documents");
            const uploads = getItems(root, "uploads");
            const data = [...documents, ...uploads]
              .filter(isJsonObject)
              .map((item) => ({
                id: numberStringOrNull(item.id),
                title: stringOrNull(item.title) ?? stringOrNull(item.filename) ?? "(untitled)",
                kind: stringOrNull(item.kind) ?? stringOrNull(item.content_type) ?? (stringOrNull(item.filename) ? "upload" : "document"),
                createdAt: stringOrNull(item.created_at) ?? stringOrNull(item.createdAt),
                creator: isJsonObject(item.creator) ? stringOrNull(item.creator.name) : stringOrNull(item.creator),
                excerpt: stringOrNull(item.contentPreview) ?? stringOrNull(item.description),
                appUrl: stringOrNull(item.app_url) ?? stringOrNull(item.appUrl),
              }));
            respond(true, { ok: true, section, projectName, data });
            return;
          }
          const res = await callBcgptTool({ bcgptUrl, apiKey, toolName: "list_documents", toolArgs: { project: projectName }, timeoutMs: 30_000 });
          if (!res.ok) { respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, res.error ?? "Failed to fetch files")); return; }
          const root = getRoot(res.result);
          const documents = Array.isArray(root.documents) ? root.documents : Array.isArray(root) ? root as unknown[] : [];
          const data = documents.filter(isJsonObject).map((item) => ({
            id: numberStringOrNull(item.id),
            title: stringOrNull(item.title) ?? "(untitled)",
            kind: stringOrNull(item.kind) ?? "document",
            createdAt: stringOrNull(item.created_at) ?? stringOrNull(item.createdAt),
            creator: isJsonObject(item.creator) ? stringOrNull(item.creator.name) : stringOrNull(item.creator),
            excerpt: stringOrNull(item.description),
            appUrl: stringOrNull(item.app_url) ?? stringOrNull(item.appUrl),
          }));
          respond(true, { ok: true, section, projectName, data });
          return;
        }
        case "card_tables": {
          const syncRes = await loadProjectSync({ include_cards: true, max_cards_per_column: 12 });
          if (syncRes.ok) {
            const root = getRoot(syncRes.result);
            const tables = getItems(root, "card_boards");
            const data = tables.filter(isJsonObject).map((t) => ({
              id: numberStringOrNull(t.id),
              name: stringOrNull(t.title) ?? stringOrNull(t.name) ?? "Untitled",
              appUrl: stringOrNull(t.app_url) ?? stringOrNull(t.appUrl),
              columns: (Array.isArray(t.columns) ? t.columns : []).filter(isJsonObject).map((c) => ({
                id: numberStringOrNull(c.id),
                name: stringOrNull(c.title) ?? stringOrNull(c.name) ?? "Untitled column",
                cardsCount: typeof c.cards_count === "number" ? c.cards_count : (Array.isArray(c.cards) ? c.cards.length : 0),
                cards: (Array.isArray(c.cards) ? c.cards : []).filter(isJsonObject).map((card) => ({
                  id: numberStringOrNull(card.id),
                  title: stringOrNull(card.title) ?? "(untitled)",
                  dueOn: stringOrNull(card.due_on) ?? stringOrNull(card.dueOn),
                  assignee: isJsonObject(card.assignee) ? stringOrNull(card.assignee.name) : stringOrNull(card.assignee),
                  status: stringOrNull(card.status),
                  appUrl: stringOrNull(card.app_url) ?? stringOrNull(card.appUrl),
                })),
              })),
            }));
            respond(true, { ok: true, section, projectName, data });
            return;
          }
          const res = await callBcgptTool({ bcgptUrl, apiKey, toolName: "list_card_tables", toolArgs: { project: projectName, include_columns: true }, timeoutMs: 30_000 });
          if (!res.ok) { respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, res.error ?? "Failed to fetch card tables")); return; }
          const root = getRoot(res.result);
          const tables = Array.isArray(root.card_tables) ? root.card_tables : Array.isArray(root) ? root as unknown[] : [];
          const data = (tables as unknown[]).filter(isJsonObject).map((t) => ({
            id: numberStringOrNull(t.id),
            name: stringOrNull(t.title) ?? stringOrNull(t.name) ?? "Untitled",
            appUrl: stringOrNull(t.app_url) ?? stringOrNull(t.appUrl),
            columns: (Array.isArray(t.columns) ? t.columns : []).filter(isJsonObject).map((c) => ({
              id: numberStringOrNull(c.id),
              name: stringOrNull(c.title) ?? stringOrNull(c.name) ?? "Untitled column",
              cardsCount: typeof c.cards_count === "number" ? c.cards_count : (Array.isArray(c.cards) ? c.cards.length : 0),
              cards: (Array.isArray(c.cards) ? c.cards : []).filter(isJsonObject).map((card) => ({
                id: numberStringOrNull(card.id),
                title: stringOrNull(card.title) ?? "(untitled)",
                dueOn: stringOrNull(card.due_on) ?? stringOrNull(card.dueOn),
                assignee: isJsonObject(card.assignee) ? stringOrNull(card.assignee.name) : stringOrNull(card.assignee),
                status: stringOrNull(card.status),
                appUrl: stringOrNull(card.app_url) ?? stringOrNull(card.appUrl),
              })),
            })),
          }));
          respond(true, { ok: true, section, projectName, data });
          return;
        }
        case "people": {
          const syncRes = await loadProjectSync({ include_people: true });
          if (syncRes.ok) {
            const root = getRoot(syncRes.result);
            const people = getItems(root, "people");
            const data = people.filter(isJsonObject).map((p) => ({
              id: numberStringOrNull(p.id),
              name: stringOrNull(p.name) ?? "(unknown)",
              email: stringOrNull(p.email) ?? stringOrNull(p.email_address),
              role: stringOrNull(p.title) ?? stringOrNull(p.role),
              avatarUrl: stringOrNull(p.avatar_url) ?? stringOrNull(p.avatarUrl),
            }));
            respond(true, { ok: true, section, projectName, data });
            return;
          }
          const res = await callBcgptTool({ bcgptUrl, apiKey, toolName: "list_project_people", toolArgs: { project: projectName }, timeoutMs: 30_000 });
          if (!res.ok) { respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, res.error ?? "Failed to fetch people")); return; }
          const root = getRoot(res.result);
          const people = Array.isArray(root.people) ? root.people : Array.isArray(root) ? root as unknown[] : [];
          const data = (people as unknown[]).filter(isJsonObject).map((p) => ({
            id: numberStringOrNull(p.id),
            name: stringOrNull(p.name) ?? "(unknown)",
            email: stringOrNull(p.email) ?? stringOrNull(p.email_address),
            role: stringOrNull(p.title) ?? stringOrNull(p.role),
            avatarUrl: stringOrNull(p.avatar_url) ?? stringOrNull(p.avatarUrl),
          }));
          respond(true, { ok: true, section, projectName, data });
          return;
        }
        default:
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `Unknown section: ${section}`));
          return;
      }
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.todo.create": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const payload = isJsonObject(params) ? params : {};
      const projectName = stringOrNull(payload.projectName) ?? stringOrNull(payload.project) ?? "";
      const title = stringOrNull(payload.title) ?? stringOrNull(payload.task) ?? stringOrNull(payload.content) ?? "";
      const description = stringOrNull(payload.description);
      const todolist = stringOrNull(payload.todolist);
      const dueOn = stringOrNull(payload.dueOn) ?? stringOrNull(payload.due_on);

      if (!projectName.trim()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "projectName is required."));
        return;
      }
      if (!title.trim()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "title is required."));
        return;
      }

      const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
        workspaceId,
        allowGlobalSecrets: true,
      });
      if (!apiKey) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Basecamp integration is not configured for this workspace."));
        return;
      }

      const result = await callBcgptTool({
        bcgptUrl,
        apiKey,
        toolName: "create_todo",
        toolArgs: {
          project: projectName,
          task: title,
          description: description ?? undefined,
          todolist: todolist ?? undefined,
          due_on: dueOn ?? undefined,
        },
        timeoutMs: 45_000,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error ?? "Failed to create todo"));
        return;
      }

      const root = isJsonObject(result.result) ? result.result : {};
      const todo = isJsonObject(root.todo) ? root.todo : null;
      respond(true, {
        ok: true,
        message: stringOrNull(root.message) ?? "Todo created.",
        detail: todo
          ? {
              id: numberStringOrNull(todo.id),
              title: stringOrNull(todo.title) ?? stringOrNull(todo.content),
              appUrl: stringOrNull(todo.app_url) ?? stringOrNull(todo.appUrl),
              dueOn: stringOrNull(todo.due_on) ?? stringOrNull(todo.dueOn),
            }
          : null,
      }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.todo.complete": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const payload = isJsonObject(params) ? params : {};
      const projectName = stringOrNull(payload.projectName) ?? stringOrNull(payload.project) ?? "";
      const todoId = numberStringOrNull(payload.todoId) ?? numberStringOrNull(payload.todo_id);
      if (!projectName.trim() || !todoId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "projectName and todoId are required."));
        return;
      }

      const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
        workspaceId,
        allowGlobalSecrets: true,
      });
      if (!apiKey) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Basecamp integration is not configured for this workspace."));
        return;
      }

      const result = await callBcgptTool({
        bcgptUrl,
        apiKey,
        toolName: "complete_todo",
        toolArgs: {
          project: projectName,
          todo_id: Number(todoId),
        },
        timeoutMs: 30_000,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error ?? "Failed to complete todo"));
        return;
      }

      const root = isJsonObject(result.result) ? result.result : {};
      respond(true, {
        ok: true,
        message: stringOrNull(root.message) ?? "Todo completed.",
        detail: {
          todoId,
          status: "completed",
        },
      }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.todo.uncomplete": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const payload = isJsonObject(params) ? params : {};
      const projectName = stringOrNull(payload.projectName) ?? stringOrNull(payload.project) ?? "";
      const todoId = numberStringOrNull(payload.todoId) ?? numberStringOrNull(payload.todo_id);
      if (!projectName.trim() || !todoId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "projectName and todoId are required."));
        return;
      }

      const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
        workspaceId,
        allowGlobalSecrets: true,
      });
      if (!apiKey) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Basecamp integration is not configured for this workspace."));
        return;
      }

      const result = await callBcgptTool({
        bcgptUrl,
        apiKey,
        toolName: "uncomplete_todo",
        toolArgs: {
          project: projectName,
          todo_id: Number(todoId),
        },
        timeoutMs: 30_000,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error ?? "Failed to reopen todo"));
        return;
      }

      const root = isJsonObject(result.result) ? result.result : {};
      respond(true, {
        ok: true,
        message: stringOrNull(root.message) ?? "Todo reopened.",
        detail: {
          todoId,
          status: "active",
        },
      }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.comment.create": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const payload = isJsonObject(params) ? params : {};
      const projectName = stringOrNull(payload.projectName) ?? stringOrNull(payload.project) ?? "";
      const content = stringOrNull(payload.content) ?? stringOrNull(payload.body) ?? "";
      const id = numberStringOrNull(payload.id) ?? numberStringOrNull(payload.recording_id);
      const url = stringOrNull(payload.url);

      if (!projectName.trim()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "projectName is required."));
        return;
      }
      if (!content.trim()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "content is required."));
        return;
      }
      if (!id && !url) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "An item id or url is required."));
        return;
      }

      const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
        workspaceId,
        allowGlobalSecrets: true,
      });
      if (!apiKey) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Basecamp integration is not configured for this workspace."));
        return;
      }

      const result = await callBcgptTool({
        bcgptUrl,
        apiKey,
        toolName: "create_comment",
        toolArgs: {
          project: projectName,
          recording_id: id ?? url,
          url: url ?? undefined,
          content,
        },
        timeoutMs: 45_000,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error ?? "Failed to create comment"));
        return;
      }

      const root = isJsonObject(result.result) ? result.result : {};
      const comment = isJsonObject(root.comment) ? root.comment : null;
      respond(true, {
        ok: true,
        message: stringOrNull(root.message) ?? "Comment created.",
        detail: comment
          ? {
              id: numberStringOrNull(comment.id),
              appUrl: stringOrNull(comment.app_url) ?? stringOrNull(comment.appUrl),
              createdAt: stringOrNull(comment.created_at) ?? stringOrNull(comment.createdAt),
            }
          : null,
      }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.entity.detail": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = isJsonObject(params) ? params : {};
      const { bcgptUrl, apiKey } = await resolveWorkspaceBcgptAccess({
        workspaceId,
        allowGlobalSecrets: true,
      });
      if (!apiKey) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Basecamp integration is not configured for this workspace."));
        return;
      }

      const toolArgs: Record<string, unknown> = {
        include_comments: true,
        include_events: true,
        include_subscription: true,
      };
      const url = stringOrNull(p.url);
      const type = stringOrNull(p.type);
      const id = numberStringOrNull(p.id);
      const projectId = numberStringOrNull(p.projectId) ?? numberStringOrNull(p.project_id) ?? numberStringOrNull(p.bucket_id);

      if (url) {
        toolArgs.url = url;
      } else {
        if (type) toolArgs.type = type;
        if (id) toolArgs.id = Number(id);
        if (projectId) {
          toolArgs.project_id = Number(projectId);
          toolArgs.bucket_id = Number(projectId);
        }
      }

      const result = await callBcgptTool({
        bcgptUrl,
        apiKey,
        toolName: "pmos_entity_detail",
        toolArgs,
        timeoutMs: 45_000,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error ?? "Failed to fetch item details"));
        return;
      }

      const root = isJsonObject(result.result)
        ? (isJsonObject(result.result.result) ? result.result.result : result.result)
        : {};
      const entity = isJsonObject(root.entity) ? root.entity : {};
      const detail = isJsonObject(root.detail) ? root.detail : {};
      const project = isJsonObject(root.project) ? root.project : null;
      const comments = Array.isArray(root.comments) ? root.comments.filter(isJsonObject) : [];
      const events = Array.isArray(root.events) ? root.events.filter(isJsonObject) : [];
      const creator = isJsonObject(detail.creator) ? stringOrNull(detail.creator.name) : stringOrNull(detail.creator);
      const assignee = isJsonObject(detail.assignee) ? stringOrNull(detail.assignee.name) : stringOrNull(detail.assignee);

      respond(true, {
        reference: {
          type: stringOrNull(entity.type) ?? type ?? "item",
          id: numberStringOrNull(entity.id) ?? id,
          projectId: numberStringOrNull(entity.project_id) ?? numberStringOrNull(entity.bucket_id) ?? projectId,
          url: stringOrNull(entity.url) ?? url,
        },
        project: project
          ? {
              id: numberStringOrNull(project.id),
              name: stringOrNull(project.name),
              appUrl: stringOrNull(project.app_url) ?? stringOrNull(project.appUrl),
            }
          : null,
        title: pickEntitySummary(detail),
        status: stringOrNull(detail.status),
        appUrl: stringOrNull(detail.app_url) ?? stringOrNull(detail.appUrl),
        createdAt: stringOrNull(detail.created_at) ?? stringOrNull(detail.createdAt),
        updatedAt: stringOrNull(detail.updated_at) ?? stringOrNull(detail.updatedAt),
        creator,
        assignee,
        summary: pickEntitySnippet(detail),
        raw: detail,
        comments: comments.map((comment) => ({
          id: numberStringOrNull(comment.id),
          author: isJsonObject(comment.creator) ? stringOrNull(comment.creator.name) : stringOrNull(comment.author),
          createdAt: stringOrNull(comment.created_at) ?? stringOrNull(comment.createdAt),
          content: stringOrNull(comment.content) ?? stringOrNull(comment.body) ?? stringOrNull(comment.summary),
          appUrl: stringOrNull(comment.app_url) ?? stringOrNull(comment.appUrl),
        })),
        events: events.map((event) => ({
          id: numberStringOrNull(event.id),
          action: stringOrNull(event.action) ?? stringOrNull(event.event_name) ?? stringOrNull(event.type),
          createdAt: stringOrNull(event.created_at) ?? stringOrNull(event.createdAt),
          actor: isJsonObject(event.creator) ? stringOrNull(event.creator.name) : stringOrNull(event.actor),
          summary: stringOrNull(event.summary) ?? stringOrNull(event.description) ?? stringOrNull(event.content),
        })),
        subscription: root.subscription ?? null,
      }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
