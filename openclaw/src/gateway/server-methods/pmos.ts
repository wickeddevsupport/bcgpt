import type { GatewayClient, GatewayRequestHandlers } from "./types.js";
import { loadConfig, writeConfigFile, type OpenClawConfig } from "../../config/config.js";
import { redactConfigObject, restoreRedactedValues } from "../../config/redact-snapshot.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import { filterByWorkspace, requireWorkspaceId, isSuperAdmin } from "../workspace-context.js";
import { buildFigmaRestAuditReport, parseFigmaFileKey } from "../figma-rest-audit.js";
import { emitAgentEvent, registerAgentRunContext } from "../../infra/agent-events.js";

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

const PMOS_SHARED_PROVIDER_ALLOWLIST = new Set(["local-ollama", "ollama", "kilo"]);

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

type PmosProjectCard = {
  id: string;
  name: string;
  status: string;
  appUrl: string | null;
  todoLists: number;
  openTodos: number;
  overdueTodos: number;
  dueTodayTodos: number;
  nextDueOn: string | null;
  health: PmosProjectHealth;
};

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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
  for (const item of content) {
    if (!isJsonObject(item)) continue;
    const text = stringOrNull(item.text);
    if (!text) continue;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Keep scanning; some content entries are plain text.
    }
  }
  return result;
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
    timeoutMs: params.timeoutMs ?? 15_000,
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

async function runMcporterJson(
  args: string[],
  envOverrides?: Record<string, string>,
): Promise<unknown> {
  const { runCommandWithTimeout } = await import("../../process/exec.js");
  const result = await runCommandWithTimeout(
    ["/usr/local/bin/mcporter", ...args],
    { timeoutMs: 20_000, env: envOverrides },
  );
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (result.code !== 0) {
    throw new Error(stderr || stdout || `mcporter failed with exit code ${String(result.code)}`);
  }
  if (!stdout) {
    return { ok: true };
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return { text: stdout, stderr: stderr || null };
  }
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

function isFigmaMcpAuthRequiredError(message: string): boolean {
  return /auth required|mcporter auth figma|non-200 status code\s*\(405\)|\b405\b/i.test(message);
}

function buildFigmaMcpFailurePayload(
  err: unknown,
  mcpAuth: WorkspaceFigmaMcpAuth,
  requestedTool?: string | null,
): Record<string, unknown> {
  const message = err instanceof Error ? err.message : String(err);
  const authRequired = isFigmaMcpAuthRequiredError(message);
  return {
    error: message,
    code: authRequired ? "FIGMA_MCP_AUTH_REQUIRED" : "FIGMA_MCP_CALL_FAILED",
    requestedTool: requestedTool ?? null,
    hasPersonalAccessToken: mcpAuth.hasPersonalAccessToken,
    source: mcpAuth.source,
    mcpServerUrl: mcpAuth.mcpServerUrl,
    fallbackSuggested: "figma_pat_audit_file",
    fallbackReason: authRequired
      ? "Figma MCP remote auth still requires mcporter OAuth; use the workspace PAT-backed audit fallback."
      : "Figma MCP call failed; use the workspace PAT-backed audit fallback.",
    authCommand: authRequired ? "mcporter auth figma" : null,
  };
}

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
  const json = (await resp.json()) as { result?: unknown; error?: { message?: string } };
  if (json.error) {
    throw new Error(json.error.message ?? "FM MCP error");
  }
  return json.result;
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

function summarizeBcgptSmartActionResult(
  query: string,
  projectHint: string | null,
  result: unknown,
): string {
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
      parseProjectIdFromAppUrl(appUrl);
    const projectName =
      stringOrNull(project?.name) ??
      (projectId ? projectNameById.get(projectId) ?? null : null);
    items.push({
      id: numberStringOrNull(raw.id),
      title,
      status: stringOrNull(raw.status),
      dueOn: stringOrNull(raw.due_on),
      projectId,
      projectName,
      appUrl,
    });
  }
  return items;
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
      // assistant prompt — it causes models to treat workflow requests as memory recall queries.
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
        "- When asked to create or build a workflow: CALL pmos_ops_create_workflow IMMEDIATELY — never output JSON for the user to import manually.",
        "- Always call pmos_ops_list_credentials FIRST to discover which integrations are available.",
        "- After creating a workflow, tell the user its name and ID, and what they should do next (e.g. activate it, add a webhook).",
        "- Never describe a workflow in text and say 'import it' — use the tool to create it directly.",
        "- When the user asks to edit/modify/add nodes/remove nodes from an EXISTING workflow (especially one currently open in the canvas): call pmos_ops_get_workflow first to fetch current state, then call pmos_ops_update_workflow with the FULL updated nodes+connections.",
        "- pmos_ops_update_workflow replaces the entire workflow — always include ALL existing nodes plus any new ones.",
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
                  description: "Connections object mapping source node name â†’ { main: [[{ node, type, index }]] }",
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
            description: "Update an existing workflow-engine flow — add, remove or modify nodes and connections. Always call pmos_ops_get_workflow first to retrieve current state, then include ALL nodes (existing + modified) in the update.",
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
              description: "Full Basecamp integration — projects, todos, messages, events, files, and more. ALWAYS use this node type for Basecamp.",
              group: ["custom"],
              version: 1,
            };
            const CORE_N8N_NODES = [
              { name: "n8n-nodes-base.manualTrigger", displayName: "Manual Trigger", description: "Start workflow manually", group: ["trigger"], version: 1 },
              { name: "n8n-nodes-base.scheduleTrigger", displayName: "Schedule Trigger", description: "Trigger on a cron schedule (daily, hourly, etc.)", group: ["trigger"], version: 1 },
              { name: "n8n-nodes-base.webhook", displayName: "Webhook", description: "HTTP webhook trigger — use this type name, NOT webhookTrigger", group: ["trigger"], version: 1 },
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
                  userMessage: "âš ï¸ Your Basecamp integration is not set up yet. Please go to **Settings â†’ Integrations** and add your Basecamp API key before creating this workflow. Once configured, I'll build the workflow automatically.",
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
              message: `Workflow "${name}" created successfully with ${nodes.length} nodes! ID: ${r.workflow?.id}. It's currently inactive — activate it in the Workflows panel when ready.`,
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
      const disableBasecampTools = isGreetingOnlyMessage(latestUserMessage);
      const shouldForceBasecamp =
        !disableBasecampTools &&
        /\bbasecamp\b|\bbcgpt\b|\bproject(?:s)?\b|\btodo(?:s)?\b|\bschedule\b|\bcampfire\b|\bmessage(?:s)?\b|\bkanban\b|\bcard(?:s)?\b|\bpeople\b|\bperson\b|\bassignment(?:s)?\b/i.test(
          latestUserMessage,
        );
      const shouldForceProjectList =
        shouldForceBasecamp &&
        /\b(list|show|what|which|give|display|name)\b[\s\w-]{0,40}\bprojects?\b|\bprojects?\b[\s\w-]{0,30}\b(names?|ids?|list)\b/i.test(
          latestUserMessage,
        );
      const shouldForceFigmaContext =
        /\bfigma\b|\bdesign\b|\bauto[\s-]?layout\b|\bcomponent(?:s)?\b|\bstyle(?:s)?\b|\bfont(?:s)?\b|\bregression\b|\baudit\b/i.test(
          latestUserMessage,
        );
      const agentTools = disableBasecampTools
        ? tools.filter(
            (tool) =>
              tool.type !== "function" ||
              (tool.function.name !== "bcgpt_smart_action" && tool.function.name !== "bcgpt_list_projects"),
          )
        : tools;

      pushProgress("Thinking...");
      const result = await callWorkspaceModelAgentLoop(
        workspaceId,
        systemPrompt,
        messages,
        agentTools,
        executeTool,
        {
          maxTokens: 2048,
          maxIterations: 4,
          initialToolChoice: shouldForceFigmaContext
            ? { type: "function", function: { name: "figma_get_context" } }
            : undefined,
        },
      );

      if (!result.ok) {
        respond(
          true,
          {
            ok: true,
            message: `AI model unavailable: ${result.error ?? "unknown error"}. Please check your model configuration in Settings â†’ AI Model Setup.`,
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
          // retry failed — proceed with original text
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
          // Not valid JSON or workflow extraction failed — stream text as-is
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

  // â"€â"€ Workspace Chat (agentic — can directly create/modify workflow-engine flows via tool calls) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

  "pmos.chat.send": async ({ req, params, respond, client, context }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);

      const p = params as {
        messages?: Array<{ role: string; content: string }>;
        sessionKey?: string;
        runId?: string;
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
          case "bcgpt_list_projects":
            return "Loading the live Basecamp project list for this workspace.";
          case "pmos_ops_list_credentials":
            return "Checking which workflow and integration credentials are available in this workspace.";
          case "pmos_ops_list_workflows":
            return "Listing the current workflows so I can inspect what already exists.";
          case "pmos_ops_get_workflow":
            return `Opening workflow ${String(args.workflow_id ?? "").trim() || ""} to inspect its structure.`;
          case "pmos_ops_execute_workflow":
            return `Running workflow ${String(args.workflow_id ?? "").trim() || ""} to verify its behavior.`;
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
        emitThinking("Reviewing workspace context, recent conversation, and available connectors.");
      }

      const { callWorkspaceModelAgentLoop } = await import("../workflow-ai.js");
      const { getWorkspaceAiContextForPrompt } = await import("../workspace-ai-context.js");
      const {
        fetchWorkspaceCredentials,
        buildCredentialContext,
      } = await import("../credential-sync.js");

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

      const [workspaceAiContext, availableCredentials] = await Promise.all([
        withTimeout(
          getWorkspaceAiContextForPrompt(workspaceId, { ensureFresh: false, maxChars: 6000 }).catch(() => ""),
          4000,
          "",
        ),
        withTimeout(
          fetchWorkspaceCredentials(workspaceId).catch(() => []),
          5000,
          [] as Awaited<ReturnType<typeof fetchWorkspaceCredentials>>,
        ),
      ]);

      const credentialContext = buildCredentialContext(availableCredentials);

      const systemPrompt = [
        `You are an intelligent AI assistant for OpenClaw workspace (ID: ${workspaceId}) — a unified project management and automation platform powered by BCgpt.`,
        "",
        "## What is OpenClaw / BCgpt",
        "OpenClaw combines Basecamp project management with an embedded Activepieces workflow engine and BCgpt AI layer.",
        "- **Basecamp layer**: Projects, todos, messages, people, schedules, card tables — all accessible via BCgpt tools.",
        "- **Workflow engine layer (Activepieces)**: Visual workflow builder embedded in the platform — you can CREATE and EDIT flows directly.",
        "- **BCgpt API**: An intelligent Basecamp integration layer with a smart router (`smart_action`) and full MCP tool set.",
        "",
        "## BCgpt API Reference",
        "BCgpt exposes Basecamp data via MCP (Model Context Protocol) and an OpenAPI compatibility layer:",
        "- `POST /mcp` — MCP JSON-RPC endpoint. Auth: `x-bcgpt-api-key` header.",
        "- `POST /action/:operation` — OpenAPI wrapper for individual tools.",
        "- `smart_action({query})` — Natural-language router. Tell it what you want in plain English; it calls the right Basecamp tools, handles pagination, and returns structured summaries. Best for: listing things, searching, getting project data.",
        "- `basecamp_raw({method, path, body})` — Raw Basecamp API access for anything not covered by named tools.",
        "",
        "## How to Think and Respond",
        "",
        "### Analyze, don't dump",
        "- Never output raw lists of IDs, raw JSON payloads, or unannotated tool results at the user.",
        "- When you retrieve data (credentials, workflows, todos, projects), INTERPRET it: what matters for this user's question?",
        "- Example: Instead of listing 50 node types, say 'You have Slack, GitHub, and Basecamp nodes connected — I'll use those.'",
        "",
        "### Be proactive, not lazy",
        "- Don't ask the user for information you can discover with a tool call.",
        "- For Basecamp/project-management requests, use `bcgpt_list_projects` for exact project lists or project picking, and use `bcgpt_smart_action` for scoped summaries, searches, audits, or follow-up questions.",
        "- Never call Basecamp tools for greetings, session-start acknowledgements, or other non-Basecamp chit-chat.",
        "- Always call `pmos_ops_list_credentials` before building any workflow so you know what's actually connected.",
        "- If the user asks about a project or person, call the appropriate tool to find the answer rather than guessing.",
        "",
        "### Always provide next steps",
        "Every response should tell the user what to do next. Examples:",
        "- 'Activate the workflow by clicking the toggle in the top right of the workflow editor.'",
        "- 'Copy the webhook URL from the Webhook Trigger node and paste it into Basecamp project settings â†’ Webhooks.'",
        "- 'Check your Slack credential is pointing to the #alerts channel.'",
        "- 'Open the Executions tab to verify the workflow ran correctly.'",
        "",
        "### Workflow creation rules",
        "- When asked to CREATE a workflow: call `pmos_ops_create_workflow` immediately — never output JSON for the user to import.",
        "- When asked to EDIT/UPDATE/FIX a workflow: call `pmos_ops_update_workflow` on the existing workflow ID.",
        "- Always call `pmos_ops_list_credentials` first so credential IDs are correct in node parameters.",
        "- For Basecamp steps: always use the compat Basecamp node type `n8n-nodes-basecamp.basecamp`, always include credentials, use `findByName` to resolve project names.",
        "- Position nodes left-to-right: trigger at [250, 300], each next node at x+250.",
        "- Build complete, runnable workflows — no manual rewiring needed.",
        "",
        "### Project management questions",
        "- Use workspace context for connector readiness and defaults only; do not answer Basecamp questions from memory when live tools are available.",
        "- For live Basecamp data, use `bcgpt_list_projects` when the user wants the raw list of projects, and use `bcgpt_smart_action` when the user wants analysis, summaries, or searches.",
        "- Summarize results meaningfully: 'There are 7 open todos in Project X — 3 are overdue. The most recent message was from Alice yesterday about the deploy.'",
        "",
        "### Figma questions",
        "- Start with `figma_get_context`.",
        "- If the user needs live Figma MCP actions, call `figma_mcp_list_tools` first, then `figma_mcp_call`.",
        "- If Figma MCP returns auth required, 405, or unavailable, immediately call `figma_pat_audit_file` on the selected file and continue with a REST-backed audit instead of stopping.",
        "- Do NOT use `web_fetch` for private Figma API access in workspace chat; it cannot inject the workspace PAT.",
        "",
        "### Figma File Manager (FM) questions",
        "- For managing files, tags, folders, categories, or links in the FM (fm.wickedlab.io), start with `fm_get_context` to get an overview.",
        "- Use `fm_list_files` to browse files; use `fm_update_file` to change folder/category; use `fm_create_tag` + `fm_get_file` to tag files.",
        "- FM tools require the user to be connected via the Figma panel. If FM MCP is not configured, instruct the user to open the Figma panel and sync context.",
        "",
        "## Available Tools",
        "**Basecamp MCP Tools:**",
        "- `bcgpt_smart_action` — run natural-language Basecamp queries through the bcgpt MCP router",
        "- `bcgpt_list_projects` — fetch live Basecamp projects with names, IDs, and status",
        "",
        "**Workflow Engine Tools:**",
        "- `pmos_ops_list_credentials` — see which services are connected (Basecamp, Slack, GitHub, etc.)",
        "- `pmos_ops_list_workflows` — list existing workflow-engine flows with names and IDs",
        "- `pmos_ops_create_workflow` — CREATE a new workflow-engine flow right now",
        "- `pmos_ops_update_workflow` — UPDATE an existing workflow (by ID)",
        "- `pmos_ops_get_workflow` — get full definition of a specific workflow by ID",
        "- `pmos_ops_execute_workflow` — test-run a workflow by ID",
        "- `pmos_ops_list_node_types` — list available trigger and action node types",
        "",
        "**Figma Tools:**",
        "- `figma_get_context` — read the selected file/team context from the Figma panel",
        "- `figma_mcp_list_tools` — inspect the live Figma MCP schema exposed through mcporter",
        "- `figma_mcp_call` — call a specific Figma MCP tool once auth/config are ready",
        "- `figma_pat_audit_file` — run a Figma REST audit on the selected file with the workspace PAT when MCP auth is unavailable",
        "",
        "**Figma File Manager (FM) Tools** \u2014 manage files, tags, folders, categories, and links in fm.wickedlab.io:",
        "- `fm_get_context` — get FM user info and overview of files/tags/folders/categories",
        "- `fm_list_files` — list Figma files tracked in FM with filters (tag, folder, category, search)",
        "- `fm_get_file` — get full details for a specific FM file by ID",
        "- `fm_update_file` — update a file's folder, category, or notes",
        "- `fm_list_tags` — list all tags and their file counts",
        "- `fm_create_tag` — create a new tag and optionally apply to a file",
        "- `fm_rename_tag` — rename an existing tag",
        "- `fm_delete_tag` — delete a tag",
        "- `fm_list_folders` — list all folders",
        "- `fm_create_folder` — create a new folder",
        "- `fm_rename_folder` — rename a folder",
        "- `fm_list_categories` — list all categories",
        "- `fm_create_category` — create a new category",
        "- `fm_add_link` — add a URL link to a file",
        "- `fm_delete_link` — remove a link from a file",
        "- `fm_sync_team` — trigger a sync for a Figma team connection to refresh files",
        "",
        ...(credentialContext ? [credentialContext, ""] : []),
        ...(workspaceAiContext ? ["## Workspace Memory", workspaceAiContext] : []),
      ].join("\n");

      // â"€â"€ Tool definitions (OpenAI function-calling format) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "bcgpt_smart_action",
            description: "Run a natural-language Basecamp request through the bcgpt MCP smart router.",
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
            name: "bcgpt_list_projects",
            description: "List live Basecamp projects available through the bcgpt MCP server.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
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
                  description: "Connections object mapping source node name â†’ { main: [[{ node, type, index }]] }",
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
        {
          type: "function" as const,
          function: {
            name: "figma_mcp_list_tools",
            description: "List the configured Figma MCP tools and schemas through mcporter.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "figma_mcp_call",
            description: "Call a specific Figma MCP tool through mcporter.",
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
              "Run a Figma REST audit against the selected file using the workspace PAT. Use this when MCP auth is unavailable or when the user wants components, layout, styles, font, or regression-style structural audits.",
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
        // FM (Figma File Manager) tools
        {
          type: "function" as const,
          function: {
            name: "fm_get_context",
            description: "Get an overview of the user's Figma File Manager: user info, file count, tag count, folder count, category count.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_list_files",
            description: "List Figma files tracked in FM. Supports filtering by tag ID, folder ID, category ID, or a search query.",
            parameters: {
              type: "object",
              properties: {
                tag_id: { type: "number", description: "Filter by tag ID." },
                folder_id: { type: "number", description: "Filter by folder ID." },
                category_id: { type: "number", description: "Filter by category ID." },
                search: { type: "string", description: "Text search across file name/URL." },
                limit: { type: "number", description: "Max results (default 50)." },
              },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_get_file",
            description: "Get full details for a specific FM file: name, URL, folder, category, tags, links, notes.",
            parameters: {
              type: "object",
              required: ["file_id"],
              properties: { file_id: { type: "number", description: "FM file ID." } },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_update_file",
            description: "Update a file's folder, category, or notes in FM.",
            parameters: {
              type: "object",
              required: ["file_id"],
              properties: {
                file_id: { type: "number", description: "FM file ID." },
                folder_id: { type: ["number", "null"], description: "New folder ID (null to remove)." },
                category_id: { type: ["number", "null"], description: "New category ID (null to remove)." },
                notes: { type: "string", description: "Notes/description for the file." },
              },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_list_tags",
            description: "List all tags in FM with their file counts.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_create_tag",
            description: "Create a new tag in FM. Optionally apply it to a file.",
            parameters: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string", description: "Tag name." },
                file_id: { type: "number", description: "Optional file ID to apply the new tag to immediately." },
              },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_rename_tag",
            description: "Rename an existing tag.",
            parameters: {
              type: "object",
              required: ["tag_id", "name"],
              properties: {
                tag_id: { type: "number" },
                name: { type: "string" },
              },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_delete_tag",
            description: "Delete a tag from FM (unlinks it from all files).",
            parameters: {
              type: "object",
              required: ["tag_id"],
              properties: { tag_id: { type: "number" } },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_list_folders",
            description: "List all folders in FM.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_create_folder",
            description: "Create a new folder in FM.",
            parameters: {
              type: "object",
              required: ["name"],
              properties: { name: { type: "string" } },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_rename_folder",
            description: "Rename an existing folder.",
            parameters: {
              type: "object",
              required: ["folder_id", "name"],
              properties: {
                folder_id: { type: "number" },
                name: { type: "string" },
              },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_list_categories",
            description: "List all categories in FM.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_create_category",
            description: "Create a new category in FM.",
            parameters: {
              type: "object",
              required: ["name"],
              properties: { name: { type: "string" } },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_add_link",
            description: "Add a URL link (with optional label) to a file in FM.",
            parameters: {
              type: "object",
              required: ["file_id", "url"],
              properties: {
                file_id: { type: "number" },
                url: { type: "string" },
                label: { type: "string", description: "Display label for the link." },
              },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_delete_link",
            description: "Delete a link from a file in FM.",
            parameters: {
              type: "object",
              required: ["link_id"],
              properties: { link_id: { type: "number" } },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "fm_sync_team",
            description: "Trigger a sync for a Figma team connection in FM to refresh file listings.",
            parameters: {
              type: "object",
              required: ["connection_id"],
              properties: { connection_id: { type: "number", description: "FM connection ID to sync." } },
              additionalProperties: false,
            },
          },
        },
      ];


      // â"€â"€ Tool executor — calls n8n-api-client directly â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
            const query = String(args.query ?? "").trim();
            const project = String(args.project ?? "").trim() || null;
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
              sufficient: true,
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
              sufficient: true,
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
              { name: "n8n-nodes-base.webhook", displayName: "Webhook", description: "HTTP webhook trigger — type is webhook NOT webhookTrigger", group: ["trigger"], version: 1 },
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
              message: `Workflow "${name}" created successfully! ID: ${r.workflow?.id}. It's currently inactive — activate it in the Workflows panel when ready.`,
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
              note: "Use figma_mcp_list_tools next. If that returns auth required, 405, or unavailable, call figma_pat_audit_file for a PAT-backed file audit.",
              fallbackTool: "figma_pat_audit_file",
            };
            finishTool(payload);
            return JSON.stringify(payload);
          }
          case "figma_mcp_list_tools": {
            const mcpAuth = await readWorkspaceFigmaMcpAuth(workspaceId);
            if (!mcpAuth.personalAccessToken) {
              const payload = buildFigmaPatMissingPayload(mcpAuth);
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const mcporterConfigPath =
              process.env.MCPORTER_CONFIG_PATH ?? "/app/.mcporter/mcporter.json";
            try {
              const result = await runMcporterJson([
                "--config",
                mcporterConfigPath,
                "list",
                "figma",
                "--schema",
                "--json",
              ], {
                FIGMA_API_KEY: mcpAuth.personalAccessToken,
                FIGMA_PERSONAL_ACCESS_TOKEN: mcpAuth.personalAccessToken,
                MCP_FIGMA_SERVER_URL: mcpAuth.mcpServerUrl,
              });
              finishTool(result);
              return JSON.stringify(result);
            } catch (err) {
              const payload = buildFigmaMcpFailurePayload(err, mcpAuth, "list_tools");
              finishTool(payload);
              return JSON.stringify(payload);
            }
          }
          case "figma_mcp_call": {
            const tool = String(args.tool ?? "").trim();
            const toolArgs =
              args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments)
                ? (args.arguments as Record<string, unknown>)
                : {};
            if (!tool) {
              const payload = { error: "tool is required" };
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const mcpAuth = await readWorkspaceFigmaMcpAuth(workspaceId);
            if (!mcpAuth.personalAccessToken) {
              const payload = buildFigmaPatMissingPayload(mcpAuth);
              finishTool(payload);
              return JSON.stringify(payload);
            }
            const figmaContext = await readWorkspaceFigmaContext(workspaceId);
            const effectiveToolArgs = hydrateKnownFigmaContextArguments(toolArgs, figmaContext);
            const mcporterConfigPath =
              process.env.MCPORTER_CONFIG_PATH ?? "/app/.mcporter/mcporter.json";
            try {
              const result = await runMcporterJson([
                "--config",
                mcporterConfigPath,
                "call",
                `figma.${tool}`,
                "--args",
                JSON.stringify(effectiveToolArgs),
                "--output",
                "json",
              ], {
                FIGMA_API_KEY: mcpAuth.personalAccessToken,
                FIGMA_PERSONAL_ACCESS_TOKEN: mcpAuth.personalAccessToken,
                MCP_FIGMA_SERVER_URL: mcpAuth.mcpServerUrl,
              });
              finishTool(result);
              return JSON.stringify(result);
            } catch (err) {
              const payload = buildFigmaMcpFailurePayload(err, mcpAuth, tool);
              finishTool(payload);
              return JSON.stringify(payload);
            }
          }
          case "figma_pat_audit_file": {
            const result = await runWorkspaceFigmaRestAudit(workspaceId, args);
            finishTool(result);
            return JSON.stringify(result);
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
            // Map tool name to MCP method + params
            const fmTool = toolName.slice("fm_".length); // e.g. "get_context", "list_files"
            const mcpMethod = `tools/call`;
            const mcpParams: Record<string, unknown> = { name: fmTool, arguments: args };
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

      const latestUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === "user")?.content ?? "";
      const disableBasecampTools = isGreetingOnlyMessage(latestUserMessage);
      const shouldForceFigmaContext =
        /\bfigma\b|\bdesign\b|\bauto[\s-]?layout\b|\bcomponent(?:s)?\b|\bstyle(?:s)?\b|\bfont(?:s)?\b|\bregression\b|\baudit\b/i.test(
          latestUserMessage,
        );
      const agentTools = disableBasecampTools
        ? tools.filter(
            (tool) =>
              tool.type !== "function" ||
              (tool.function.name !== "bcgpt_smart_action" && tool.function.name !== "bcgpt_list_projects"),
          )
        : tools;

      const result = await callWorkspaceModelAgentLoop(
        workspaceId,
        systemPrompt,
        messages,
        agentTools,
        executeTool,
        {
          maxTokens: 2048,
          maxIterations: 4,
          initialToolChoice: shouldForceFigmaContext
            ? { type: "function", function: { name: "figma_get_context" } }
            : shouldForceProjectList
              ? { type: "function", function: { name: "bcgpt_list_projects" } }
              : shouldForceBasecamp
                ? { type: "function", function: { name: "bcgpt_smart_action" } }
            : undefined,
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
            message: `AI model unavailable: ${result.error ?? "unknown error"}. Please check your model configuration in Settings â†’ AI Model Setup.`,
            liveStreamed: liveStreamEnabled,
          },
          undefined,
        );
        return;
      }

      const finalMessage = result.text ?? "";
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

  "pmos.projects.snapshot": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);

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
          overdueTodos: 0,
          dueTodayTodos: 0,
        },
        projects: [] as PmosProjectCard[],
        urgentTodos: [] as PmosProjectTodoItem[],
        dueTodayTodos: [] as PmosProjectTodoItem[],
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
      const [start, listProjectsResult] = await Promise.all([
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
          toolName: "list_projects",
          toolArgs: {},
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

      if (!listProjectsResult.ok) {
        errors.push(`Failed to list projects: ${listProjectsResult.error ?? "unknown error"}`);
      }

      const projects = parseProjectList(listProjectsResult.result);
      const projectNameById = new Map<string, string>();
      for (const project of projects) {
        projectNameById.set(project.id, project.name);
      }

      const focusProjects = projects.slice(0, 8);
      const detailsByProjectId = new Map<string, unknown>();
      const detailsPromise = Promise.all(
        focusProjects.map(async (project) => {
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
      ]);

      const [, [overdueRpc, dueTodayRpc]] = await Promise.all([detailsPromise, reportsPromise]);

      if (!overdueRpc.ok) {
        errors.push(`Failed to load overdue todos: ${overdueRpc.error ?? "unknown error"}`);
      }
      if (!dueTodayRpc.ok) {
        errors.push(`Failed to load due-today todos: ${dueTodayRpc.error ?? "unknown error"}`);
      }

      const overdueTodos = parseTodoItems(overdueRpc.result, "overdue", projectNameById);
      const dueTodayTodos = parseTodoItems(dueTodayRpc.result, "todos", projectNameById).filter(
        (todo) => !todo.dueOn || todo.dueOn === todayIso,
      );

      const overdueByProject = new Map<string, number>();
      for (const todo of overdueTodos) {
        if (!todo.projectId) continue;
        overdueByProject.set(todo.projectId, (overdueByProject.get(todo.projectId) ?? 0) + 1);
      }
      const dueTodayByProject = new Map<string, number>();
      for (const todo of dueTodayTodos) {
        if (!todo.projectId) continue;
        dueTodayByProject.set(todo.projectId, (dueTodayByProject.get(todo.projectId) ?? 0) + 1);
      }

      const cards: PmosProjectCard[] = focusProjects.map((project) => {
        const detail = detailsByProjectId.get(project.id);
        const groups = isJsonObject(detail) && Array.isArray(detail.groups) ? detail.groups : [];
        let openTodos = 0;
        let todoLists = 0;
        const dueDates: string[] = [];
        for (const groupRaw of groups) {
          if (!isJsonObject(groupRaw)) continue;
          todoLists += 1;
          const todosCount = typeof groupRaw.todos_count === "number" && Number.isFinite(groupRaw.todos_count)
            ? groupRaw.todos_count
            : 0;
          openTodos += todosCount;
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
        const overdueCount = overdueByProject.get(project.id) ?? 0;
        const dueTodayCount = dueTodayByProject.get(project.id) ?? 0;
        return {
          id: project.id,
          name: project.name,
          status: project.status,
          appUrl: project.appUrl,
          todoLists,
          openTodos,
          overdueTodos: overdueCount,
          dueTodayTodos: dueTodayCount,
          nextDueOn,
          health: projectHealthFromCounts({
            openTodos,
            overdueTodos: overdueCount,
            dueTodayTodos: dueTodayCount,
          }),
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
        overdueTodos: overdueTodos.length,
        dueTodayTodos: dueTodayTodos.length,
      };
      const connected =
        identity.connected ||
        listProjectsResult.ok ||
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
          urgentTodos: overdueTodos.slice(0, 20),
          dueTodayTodos: dueTodayTodos.slice(0, 20),
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
};
