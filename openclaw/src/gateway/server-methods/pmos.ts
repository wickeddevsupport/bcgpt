import type { GatewayClient, GatewayRequestHandlers } from "./types.js";
import { loadConfig, writeConfigFile, type OpenClawConfig } from "../../config/config.js";
import { redactConfigObject, restoreRedactedValues } from "../../config/redact-snapshot.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import { filterByWorkspace, requireWorkspaceId, isSuperAdmin } from "../workspace-context.js";

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
    name?: string | null;
    email?: string | null;
    selectedAccountId?: string | null;
    accountsCount?: number;
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

const PMOS_SHARED_PROVIDER_ALLOWLIST = new Set(["local-ollama", "ollama"]);

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

/**
 * Remove ops.user sub-object from connectors before returning to client.
 * The ops.user object contains the n8n provisioned password and email which
 * the client UI doesn't need and should not be exposed to the browser.
 */
function stripOpsUserFromConnectors(connectors: Record<string, unknown>): Record<string, unknown> {
  const ops = connectors.ops;
  if (!isJsonObject(ops) || !("user" in ops)) {
    return connectors;
  }
  const { user: _user, ...opsWithoutUser } = ops as Record<string, unknown>;
  return { ...connectors, ops: opsWithoutUser };
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

function parseProjectList(result: unknown): Array<{ id: string; name: string; status: string; appUrl: string | null }> {
  const listRaw = (() => {
    if (isJsonObject(result) && Array.isArray(result.projects)) return result.projects;
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

function parseTodoItems(
  result: unknown,
  key: string,
  projectNameById: Map<string, string>,
): PmosProjectTodoItem[] {
  if (!isJsonObject(result) || !Array.isArray(result[key])) {
    return [];
  }
  const todos = result[key];
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
        process.env.OPS_URL ??
        null;
      const opsUrl = normalizeBaseUrl(opsUrlRaw, "https://ops.wickedlab.io");
      const opsProjectId =
        (workspaceConnectors?.ops?.projectId as string | undefined) ??
        readConfigString(cfg, ["pmos", "connectors", "ops", "projectId"]) ??
        null;

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

      const { readLocalN8nConfig } = await import("../pmos-ops-proxy.js");
      const { findVendoredN8nRepo } = await import("../n8n-embed.js");
      const localN8n = readLocalN8nConfig();
      const vendoredRepo = findVendoredN8nRepo();

      const ops: ConnectorResult = {
        url: localN8n?.url ?? opsUrl,
        projectId: opsProjectId,
        configured: Boolean(localN8n || vendoredRepo || (opsUrlRaw && opsUrlRaw.trim())),
        reachable: null,
        authOk: null,
        mode: localN8n || vendoredRepo ? "embedded" : "remote",
        editorUrl: "/ops-ui/",
        vendoredRepo,
        healthUrl: localN8n ? `${localN8n.url}/healthz` : null,
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

      // Embedded n8n / ops runtime reachability.
      if (localN8n) {
        const localHealth = await fetchJson(`${localN8n.url}/healthz`, { method: "GET", timeoutMs: 3500 });
        ops.reachable = localHealth.ok || isReachableStatus(localHealth.status);
        if (!ops.reachable) {
          ops.error = localHealth.error || "EMBEDDED_N8N_UNREACHABLE";
        }
      } else if (vendoredRepo) {
        ops.reachable = false;
        ops.error = "Vendored n8n is present but runtime is not running (N8N_LOCAL_URL missing).";
      } else if (opsUrlRaw && opsUrlRaw.trim()) {
        const remoteHealth = await fetchJson(`${opsUrl}/healthz`, { method: "GET", timeoutMs: 3500 });
        ops.reachable = remoteHealth.ok || isReachableStatus(remoteHealth.status);
        if (!ops.reachable) {
          ops.error = remoteHealth.error || "OPS_REMOTE_UNREACHABLE";
        }
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
          bcgpt.identity = {
            connected: payload.connected === true,
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

      respond(
        true,
        {
          checkedAtMs: Date.now(),
          ops,
          bcgpt,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  // Lightweight auto-connect: pings /action/startbcgpt with workspace or global BCGPT key.
  // Called automatically on every gateway connect so the Basecamp session is always warm.
  "pmos.bcgpt.autoconnect": async ({ respond, client }) => {
    try {
      const cfg = loadConfig() as unknown;
      const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
      const workspaceId = client?.pmosWorkspaceId ?? undefined;
      const workspaceConnectors = workspaceId ? await readWorkspaceConnectors(workspaceId) : null;

      const bcgptUrl = normalizeBaseUrl(
        (workspaceConnectors?.bcgpt?.url as string | undefined) ??
          readConfigString(cfg, ["pmos", "connectors", "bcgpt", "url"]) ??
          process.env.BCGPT_URL ??
          null,
        "https://bcgpt.wickedlab.io",
      );
      // Only use workspace-scoped key — user must save their own key before auto-connect fires
      const bcgptKey =
        ((workspaceConnectors?.bcgpt?.apiKey as string | undefined)?.trim()) ||
        null;

      if (!bcgptKey) {
        // No key saved yet — silently skip, no error
        respond(true, { connected: false, configured: false, message: "No API key saved — visit Integrations to connect Basecamp" }, undefined);
        return;
      }

      const startResult = await fetchJson(`${bcgptUrl}/action/startbcgpt`, {
        method: "POST",
        timeoutMs: 10_000,
        headers: {
          "content-type": "application/json",
          "x-bcgpt-api-key": bcgptKey,
        },
        body: JSON.stringify({}),
      });

      if (!startResult.ok || !isJsonObject(startResult.json)) {
        respond(true, {
          connected: false,
          configured: true,
          reachable: startResult.status ? startResult.status < 500 : false,
          error: startResult.error || "BCGPT_UNREACHABLE",
        }, undefined);
        return;
      }

      const payload = startResult.json as Record<string, unknown>;
      const user = isJsonObject(payload.user) ? payload.user : null;
      const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];

      respond(true, {
        connected: payload.connected === true,
        configured: true,
        reachable: true,
        name: typeof user?.name === "string" ? user.name : null,
        email: typeof user?.email === "string" ? user.email : null,
        accountsCount: accounts.length,
        selectedAccountId:
          typeof payload.selected_account_id === "string" || typeof payload.selected_account_id === "number"
            ? String(payload.selected_account_id)
            : null,
        message: typeof payload.message === "string" ? payload.message : null,
        authLink: typeof payload.auth_link === "string" ? payload.auth_link : null,
        shared: !((workspaceConnectors?.bcgpt?.apiKey as string | undefined)?.trim()),
      }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
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
      const next = isJsonObject(merged) ? merged : existing;
      await writeWorkspaceConnectors(workspaceId, next);
      respond(true, { ok: true, workspaceId, connectors: next }, undefined);
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
      // Strip ops.user sub-object (contains n8n provisioned password) — not needed by the client UI.
      // api keys (ops.apiKey, bcgpt.apiKey) are kept as-is so the UI can display configured status.
      const safeConnectors = isSuperAdmin(client) ? connectors : stripOpsUserFromConnectors(connectors);
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

  // ── BYOK (Bring Your Own Keys) ──────────────────────────────────────

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

  // ── Chat-to-Workflow Creation ──────────────────────────────────────

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

  // ── Multi-Agent Orchestration ──────────────────────────────────────

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

  // ── Live Flow Builder ──────────────────────────────────────────────

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

  // ── AI Workflow Assistant (uses global openclaw.json model config) ─────────────

  "pmos.workflow.assist": async ({ params, respond, client, context }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);

      const p = params as {
        messages?: Array<{ role: string; content: string }>;
        message?: string;
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
      const { getWorkspaceAiContextForPrompt } = await import("../workspace-ai-context.js");

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
      const workspaceAiContext = await withTimeout(
        getWorkspaceAiContextForPrompt(workspaceId, {
          ensureFresh: true,
          maxChars: 12_000,
          credentials: availableCredentials,
        }).catch(() => ""),
        4000,
        "",
      );
      const workspaceContext = `## Workspace Context
- Workspace ID: ${workspaceId}
- Use node type names from the live workspace catalog when available.
- Treat openclaw.json + workspace connector data as the source of truth for integration configuration.
- Treat AI_CONTEXT.md as current workspace memory for connectors, models, and agent assignments.
- If required credentials are missing, explicitly tell the user which provider config to add in openclaw.json.
- If a live node catalog is unavailable, explicitly say so instead of inventing node names.`;
      const workspaceMemoryContext = workspaceAiContext
        ? `## Workspace Memory Snapshot (AI_CONTEXT.md)\n${workspaceAiContext}`
        : "";
      const agentBehaviorRules = [
        "## Critical Behaviour Rules (Automations AI)",
        "- When asked to create or build a workflow: CALL pmos_n8n_create_workflow IMMEDIATELY — never output JSON for the user to import manually.",
        "- Always call pmos_n8n_list_credentials FIRST to discover which integrations are available.",
        "- After creating a workflow, tell the user its name and ID, and what they should do next (e.g. activate it, add a webhook).",
        "- Never describe a workflow in text and say 'import it' — use the tool to create it directly.",
        "- Available tools: pmos_n8n_list_credentials, pmos_n8n_list_workflows, pmos_n8n_list_node_types, pmos_n8n_create_workflow, pmos_n8n_get_workflow, pmos_n8n_execute_workflow.",
      ].join("\n");
      const systemPrompt = [
        WORKFLOW_ASSISTANT_SYSTEM_PROMPT,
        agentBehaviorRules,
        liveNodeCatalog,
        credentialContext,
        workspaceContext,
        workspaceMemoryContext,
      ]
        .filter((part) => part && part.trim().length > 0)
        .join("\n\n");

      // ── Tool definitions ─────────────────────────────────────────────────
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "pmos_n8n_list_credentials",
            description: "List available n8n credentials/integrations configured for this workspace (Basecamp, Slack, GitHub, etc.)",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_n8n_list_workflows",
            description: "List existing n8n workflows in this workspace",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_n8n_list_node_types",
            description: "List available n8n node types (triggers and actions). Call this when you need to know exact node type names.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_n8n_create_workflow",
            description: "Create a new n8n workflow. Always call pmos_n8n_list_credentials first to know which credential IDs to use.",
            parameters: {
              type: "object",
              required: ["name", "nodes", "connections"],
              additionalProperties: false,
              properties: {
                name: { type: "string", description: "Descriptive workflow name" },
                nodes: {
                  type: "array",
                  description: "Array of n8n node objects, each with: id, name, type, typeVersion, position [x,y], parameters, and optionally credentials",
                },
                connections: {
                  type: "object",
                  description: "Connections object mapping source node name → { main: [[{ node, type, index }]] }",
                },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_n8n_get_workflow",
            description: "Get full details of an existing n8n workflow by ID",
            parameters: {
              type: "object",
              required: ["workflow_id"],
              additionalProperties: false,
              properties: {
                workflow_id: { type: "string", description: "The n8n workflow ID" },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_n8n_execute_workflow",
            description: "Execute (test-run) an n8n workflow by ID",
            parameters: {
              type: "object",
              required: ["workflow_id"],
              additionalProperties: false,
              properties: {
                workflow_id: { type: "string", description: "The n8n workflow ID to execute" },
              },
            },
          },
        },
      ];

      // ── Progress push helper ──────────────────────────────────────────────
      const pushProgress = (step: string) => {
        if (client?.connId) {
          context.broadcastToConnIds(
            "pmos.workflow.assist.progress",
            { step },
            new Set([client.connId]),
          );
        }
      };

      // ── Track created workflow for UI refresh ──────────────────────────
      let createdWorkflowId: string | undefined;
      let createdWorkflowName: string | undefined;

      // ── Tool executor ────────────────────────────────────────────────────
      const executeTool = async (toolName: string, args: Record<string, unknown>): Promise<string> => {
        const {
          listN8nCredentials,
          listN8nWorkflows,
          createN8nWorkflow,
          getN8nWorkflow,
          executeN8nWorkflow,
          listN8nNodeTypes,
        } = await import("../n8n-api-client.js");

        switch (toolName) {
          case "pmos_n8n_list_credentials": {
            pushProgress("Checking available integrations...");
            const r = await listN8nCredentials(workspaceId);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to list credentials" });
            return JSON.stringify({
              credentials: (r.credentials ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type })),
            });
          }
          case "pmos_n8n_list_workflows": {
            pushProgress("Loading existing workflows...");
            const r = await listN8nWorkflows(workspaceId);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to list workflows" });
            return JSON.stringify({
              workflows: (r.workflows ?? []).map((w) => ({ id: w.id, name: w.name, active: w.active })),
            });
          }
          case "pmos_n8n_list_node_types": {
            pushProgress("Looking up available node types...");
            const r = await listN8nNodeTypes(workspaceId);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to list node types" });
            return JSON.stringify({ nodeTypes: (r.nodeTypes ?? []).slice(0, 200) });
          }
          case "pmos_n8n_create_workflow": {
            const name = String(args.name ?? "").trim();
            const nodes = Array.isArray(args.nodes) ? args.nodes : [];
            const connections =
              args.connections && typeof args.connections === "object"
                ? (args.connections as Record<string, unknown>)
                : {};
            if (!name) return JSON.stringify({ error: "name is required" });
            if (!nodes.length) return JSON.stringify({ error: "nodes array is required and must not be empty" });
            pushProgress(`Building workflow "${name}"...`);
            const r = await createN8nWorkflow(workspaceId, {
              name,
              active: false,
              nodes: nodes as Parameters<typeof createN8nWorkflow>[1]["nodes"],
              connections,
            });
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to create workflow" });
            createdWorkflowId = r.workflow?.id;
            createdWorkflowName = name;
            pushProgress(`✅ Workflow "${name}" created!`);
            return JSON.stringify({
              success: true,
              workflowId: r.workflow?.id,
              workflowName: name,
              message: `Workflow "${name}" created successfully! ID: ${r.workflow?.id}. It's currently inactive — activate it in the Workflows panel when ready.`,
            });
          }
          case "pmos_n8n_get_workflow": {
            const id = String(args.workflow_id ?? "").trim();
            if (!id) return JSON.stringify({ error: "workflow_id is required" });
            const r = await getN8nWorkflow(workspaceId, id);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to get workflow" });
            return JSON.stringify(r.workflow);
          }
          case "pmos_n8n_execute_workflow": {
            const id = String(args.workflow_id ?? "").trim();
            if (!id) return JSON.stringify({ error: "workflow_id is required" });
            pushProgress("Executing workflow...");
            const r = await executeN8nWorkflow(workspaceId, id);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to execute workflow" });
            return JSON.stringify({ success: true, executionId: r.executionId ?? "unknown" });
          }
          default:
            return JSON.stringify({ error: `Unknown tool: ${toolName}` });
        }
      };

      pushProgress("Thinking...");
      const result = await callWorkspaceModelAgentLoop(
        workspaceId,
        systemPrompt,
        messages,
        tools,
        executeTool,
        { maxTokens: 2048, maxIterations: 6 },
      );

      if (!result.ok) {
        respond(
          true,
          {
            ok: true,
            message: `AI model unavailable: ${result.error ?? "unknown error"}. Please check your model configuration in Settings → AI Model Setup.`,
            workflowCreated: false,
          },
          undefined,
        );
        return;
      }

      respond(true, {
        ok: true,
        message: result.text ?? "",
        workflowCreated: Boolean(createdWorkflowId),
        workflowId: createdWorkflowId,
        workflowName: createdWorkflowName,
        providerUsed: result.providerUsed,
      }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Workspace Chat (agentic — can directly create/modify n8n workflows via tool calls) ────────────────

  "pmos.chat.send": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);

      const p = params as {
        messages?: Array<{ role: string; content: string }>;
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
          getWorkspaceAiContextForPrompt(workspaceId, { ensureFresh: true, maxChars: 10_000 }).catch(() => ""),
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
        `You are an AI assistant for this workspace (ID: ${workspaceId}) that can DIRECTLY CREATE and MANAGE automation workflows in n8n.`,
        "",
        "## Critical Behaviour Rules",
        "- When asked to create a workflow: CALL pmos_n8n_create_workflow immediately — do NOT output JSON for the user to import manually.",
        "- Always call pmos_n8n_list_credentials FIRST to discover available integrations before building any workflow.",
        "- Only ask the user for info you truly cannot infer or find yourself (e.g. a specific Slack channel name, a Discord webhook URL they own).",
        "- After creating a workflow, tell the user the workflow name and ID, and what they should do next (e.g. activate it, set up a Basecamp webhook).",
        "- For project management questions, answer directly from workspace context.",
        "- Never describe a workflow in plain text and tell the user to import it — just create it.",
        "",
        "## Available n8n Tools",
        "- **pmos_n8n_list_credentials** — see which services are connected (Basecamp, Slack, GitHub, etc.)",
        "- **pmos_n8n_list_workflows** — list existing n8n workflows",
        "- **pmos_n8n_create_workflow** — CREATE a workflow in n8n right now",
        "- **pmos_n8n_get_workflow** — get full details of a specific workflow by ID",
        "- **pmos_n8n_execute_workflow** — test-run a workflow",
        "- **pmos_n8n_list_node_types** — list available trigger and action node types (call when unsure of exact type names)",
        "",
        ...(credentialContext ? [credentialContext, ""] : []),
        ...(workspaceAiContext ? [`## Workspace Memory\n${workspaceAiContext}`] : []),
      ].join("\n");

      // ── Tool definitions (OpenAI function-calling format) ────────────────────
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "pmos_n8n_list_credentials",
            description: "List available n8n credentials/integrations configured for this workspace (Basecamp, Slack, GitHub, etc.)",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_n8n_list_workflows",
            description: "List existing n8n workflows in this workspace",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_n8n_list_node_types",
            description: "List available n8n node types (triggers and actions). Call this when you need to know exact node type names.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_n8n_create_workflow",
            description: "Create a new n8n workflow. Always call pmos_n8n_list_credentials first to know which credential IDs to use in node parameters.",
            parameters: {
              type: "object",
              required: ["name", "nodes", "connections"],
              additionalProperties: false,
              properties: {
                name: { type: "string", description: "Descriptive workflow name" },
                nodes: {
                  type: "array",
                  description: "Array of n8n node objects, each with: id, name, type, typeVersion, position [x,y], parameters, and optionally credentials",
                },
                connections: {
                  type: "object",
                  description: "Connections object mapping source node name → { main: [[{ node, type, index }]] }",
                },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_n8n_get_workflow",
            description: "Get full details of an existing n8n workflow by ID",
            parameters: {
              type: "object",
              required: ["workflow_id"],
              additionalProperties: false,
              properties: {
                workflow_id: { type: "string", description: "The n8n workflow ID" },
              },
            },
          },
        },
        {
          type: "function" as const,
          function: {
            name: "pmos_n8n_execute_workflow",
            description: "Execute (test-run) an n8n workflow by ID",
            parameters: {
              type: "object",
              required: ["workflow_id"],
              additionalProperties: false,
              properties: {
                workflow_id: { type: "string", description: "The n8n workflow ID to execute" },
              },
            },
          },
        },
      ];

      // ── Tool executor — calls n8n-api-client directly ────────────────────────
      const executeTool = async (toolName: string, args: Record<string, unknown>): Promise<string> => {
        const {
          listN8nCredentials,
          listN8nWorkflows,
          createN8nWorkflow,
          getN8nWorkflow,
          executeN8nWorkflow,
          listN8nNodeTypes,
        } = await import("../n8n-api-client.js");

        switch (toolName) {
          case "pmos_n8n_list_credentials": {
            const r = await listN8nCredentials(workspaceId);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to list credentials" });
            return JSON.stringify({
              credentials: (r.credentials ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type })),
            });
          }
          case "pmos_n8n_list_workflows": {
            const r = await listN8nWorkflows(workspaceId);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to list workflows" });
            return JSON.stringify({
              workflows: (r.workflows ?? []).map((w) => ({ id: w.id, name: w.name, active: w.active })),
            });
          }
          case "pmos_n8n_list_node_types": {
            const r = await listN8nNodeTypes(workspaceId);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to list node types" });
            return JSON.stringify({ nodeTypes: (r.nodeTypes ?? []).slice(0, 200) });
          }
          case "pmos_n8n_create_workflow": {
            const name = String(args.name ?? "").trim();
            const nodes = Array.isArray(args.nodes) ? args.nodes : [];
            const connections =
              args.connections && typeof args.connections === "object"
                ? (args.connections as Record<string, unknown>)
                : {};
            if (!name) return JSON.stringify({ error: "name is required" });
            if (!nodes.length) return JSON.stringify({ error: "nodes array is required and must not be empty" });
            const r = await createN8nWorkflow(workspaceId, {
              name,
              active: false,
              nodes: nodes as Parameters<typeof createN8nWorkflow>[1]["nodes"],
              connections,
            });
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to create workflow" });
            return JSON.stringify({
              success: true,
              workflowId: r.workflow?.id,
              workflowName: name,
              message: `Workflow "${name}" created successfully! ID: ${r.workflow?.id}. It's currently inactive — activate it in the Workflows panel when ready.`,
            });
          }
          case "pmos_n8n_get_workflow": {
            const id = String(args.workflow_id ?? "").trim();
            if (!id) return JSON.stringify({ error: "workflow_id is required" });
            const r = await getN8nWorkflow(workspaceId, id);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to get workflow" });
            return JSON.stringify(r.workflow);
          }
          case "pmos_n8n_execute_workflow": {
            const id = String(args.workflow_id ?? "").trim();
            if (!id) return JSON.stringify({ error: "workflow_id is required" });
            const r = await executeN8nWorkflow(workspaceId, id);
            if (!r.ok) return JSON.stringify({ error: r.error ?? "Failed to execute workflow" });
            return JSON.stringify({ success: true, executionId: r.executionId ?? "unknown" });
          }
          default:
            return JSON.stringify({ error: `Unknown tool: ${toolName}` });
        }
      };

      const result = await callWorkspaceModelAgentLoop(
        workspaceId,
        systemPrompt,
        messages,
        tools,
        executeTool,
        { maxTokens: 2048, maxIterations: 6 },
      );

      if (!result.ok) {
        respond(
          true,
          {
            ok: false,
            message: `AI model unavailable: ${result.error ?? "unknown error"}. Please check your model configuration in Settings → AI Model Setup.`,
          },
          undefined,
        );
        return;
      }

      respond(
        true,
        { ok: true, message: result.text ?? "", providerUsed: result.providerUsed },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Connections: Real n8n credential list ─────────────────────────

  "pmos.projects.snapshot": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const cfg = loadConfig() as unknown;
      const allowGlobalSecrets = isSuperAdmin(client);

      const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
      const workspaceConnectors = await readWorkspaceConnectors(workspaceId);

      const bcgptUrl = normalizeBaseUrl(
        (workspaceConnectors?.bcgpt?.url as string | undefined) ??
          readConfigString(cfg, ["pmos", "connectors", "bcgpt", "url"]) ??
          process.env.BCGPT_URL ??
          null,
        "https://bcgpt.wickedlab.io",
      );
      const bcgptApiKey =
        (workspaceConnectors?.bcgpt?.apiKey as string | undefined)?.trim() ??
        (allowGlobalSecrets
          ? readConfigString(cfg, ["pmos", "connectors", "bcgpt", "apiKey"]) ??
            (process.env.BCGPT_API_KEY?.trim() || null)
          : null);

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
      const start = await fetchJson(`${bcgptUrl}/action/startbcgpt`, {
        method: "POST",
        timeoutMs: 12_000,
        headers: {
          "content-type": "application/json",
          "x-bcgpt-api-key": bcgptApiKey,
        },
        body: JSON.stringify({}),
      });

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

      const focusProjects = projects.slice(0, 12);
      const detailsByProjectId = new Map<string, unknown>();
      await Promise.all(
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
      const [overdueRpc, dueTodayRpc] = await Promise.all([
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

      respond(
        true,
        {
          workspaceId,
          configured: true,
          connected: identity.connected,
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

  // ── Super-admin: Workspace List ────────────────────────────────────

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

  // ── Basecamp credential setup in n8n ──────────────────────────────

  "pmos.ops.setup.basecamp": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
      const wc = await readWorkspaceConnectors(workspaceId);
      const bcgptUrl = (wc?.bcgpt?.url as string | undefined)?.trim() || "https://bcgpt.wickedlab.io";
      const bcgptApiKey = (wc?.bcgpt?.apiKey as string | undefined)?.trim();
      if (!bcgptApiKey) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "No BCGPT API key stored. Save your Basecamp connection key in Integrations first."));
        return;
      }
      const { upsertBasecampCredential } = await import("../n8n-api-client.js");
      const result = await upsertBasecampCredential(workspaceId, bcgptUrl, bcgptApiKey);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to configure Basecamp credential in n8n"));
        return;
      }
      respond(true, { ok: true, credentialId: result.credentialId, message: "Basecamp credential configured in your workflow engine." }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── n8n Credentials Management ─────────────────────────────────────

  "pmos.n8n.credentials.list": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { listN8nCredentials } = await import("../n8n-api-client.js");
      const result = await listN8nCredentials(workspaceId);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to list n8n credentials"));
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
      const { createN8nCredential } = await import("../n8n-api-client.js");
      const result = await createN8nCredential(workspaceId, p.name, p.type, p.data || {});
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to create n8n credential"));
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
      const { deleteN8nCredential } = await import("../n8n-api-client.js");
      const result = await deleteN8nCredential(workspaceId, p.credentialId);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to delete n8n credential"));
        return;
      }
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Super-admin: reset all workspaces to a single fresh starter agent ─────────

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
