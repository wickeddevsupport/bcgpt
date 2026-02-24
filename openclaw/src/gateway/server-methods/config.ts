import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { listChannelPlugins } from "../../channels/plugins/index.js";
import {
  CONFIG_PATH,
  loadConfig,
  parseConfigJson5,
  readConfigFileSnapshot,
  resolveConfigSnapshotHash,
  validateConfigObjectWithPlugins,
  writeConfigFile,
} from "../../config/config.js";
import { applyLegacyMigrations } from "../../config/legacy.js";
import { applyMergePatch } from "../../config/merge-patch.js";
import {
  redactConfigObject,
  redactConfigSnapshot,
  restoreRedactedValues,
} from "../../config/redact-snapshot.js";
import { buildConfigSchema } from "../../config/schema.js";
import {
  formatDoctorNonInteractiveHint,
  type RestartSentinelPayload,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { loadOpenClawPlugins } from "../../plugins/loader.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateConfigApplyParams,
  validateConfigGetParams,
  validateConfigPatchParams,
  validateConfigSchemaParams,
  validateConfigSetParams,
} from "../protocol/index.js";
import { isSuperAdmin, filterByWorkspace } from "../workspace-context.js";
import { auditLogger } from "../../security/audit-logger.js";
import type { GatewayClient } from "./types.js";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toJsonRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is JsonRecord => isJsonRecord(entry));
}

const SHARED_MODEL_PROVIDER_ALLOWLIST = new Set(["local-ollama", "ollama"]);

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isJsonRecord(cur)) {
      return undefined;
    }
    cur = cur[key];
  }
  return cur;
}

function parseModelProviderFromRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;
  const provider = trimmed.slice(0, slash).trim().toLowerCase();
  return provider || null;
}

function isSharedProvider(providerName: string, providerEntry: unknown): boolean {
  const normalized = providerName.trim().toLowerCase();
  if (!normalized) return false;
  if (SHARED_MODEL_PROVIDER_ALLOWLIST.has(normalized)) return true;
  if (!isJsonRecord(providerEntry)) return false;
  return providerEntry.sharedForWorkspaces === true || providerEntry.shared === true;
}

function filterSharedModelsForWorkspaceUsers(config: unknown): unknown {
  if (!isJsonRecord(config)) {
    return config;
  }
  const next = JSON.parse(JSON.stringify(config)) as JsonRecord;
  const modelsNode = isJsonRecord(next.models) ? (next.models as JsonRecord) : null;
  const providersNode = modelsNode && isJsonRecord(modelsNode.providers)
    ? (modelsNode.providers as JsonRecord)
    : null;
  const sharedProviderNames = new Set<string>();
  if (providersNode) {
    const filteredProviders: JsonRecord = {};
    for (const [name, value] of Object.entries(providersNode)) {
      if (isSharedProvider(name, value)) {
        filteredProviders[name] = value;
        sharedProviderNames.add(name.trim().toLowerCase());
      }
    }
    next.models = { ...modelsNode, providers: filteredProviders };
  }

  const agentsNode = isJsonRecord(next.agents) ? (next.agents as JsonRecord) : null;
  const defaultsNode = agentsNode && isJsonRecord(agentsNode.defaults)
    ? (agentsNode.defaults as JsonRecord)
    : null;
  if (!defaultsNode) {
    return next;
  }

  const filteredDefaults: JsonRecord = { ...defaultsNode };
  const defaultsModels = isJsonRecord(defaultsNode.models) ? (defaultsNode.models as JsonRecord) : null;
  if (defaultsModels) {
    const keep: JsonRecord = {};
    for (const [modelRef, meta] of Object.entries(defaultsModels)) {
      const provider = parseModelProviderFromRef(modelRef);
      if (provider && sharedProviderNames.has(provider)) {
        keep[modelRef] = meta;
      }
    }
    filteredDefaults.models = keep;
  }

  const primary = getPath(defaultsNode, ["model", "primary"]);
  const primaryProvider = parseModelProviderFromRef(primary);
  if (isJsonRecord(filteredDefaults.model)) {
    const modelObj = { ...(filteredDefaults.model as JsonRecord) };
    if (!primaryProvider || !sharedProviderNames.has(primaryProvider)) {
      delete modelObj.primary;
    }
    filteredDefaults.model = modelObj;
  }

  next.agents = { ...agentsNode, defaults: filteredDefaults };
  return next;
}

function normalizeAgentIdForCompare(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

function workspaceScopedClient(
  client: GatewayClient | undefined,
): { workspaceId: string } | null {
  if (!client || isSuperAdmin(client)) {
    return null;
  }
  const workspaceId =
    typeof client.pmosWorkspaceId === "string" ? client.pmosWorkspaceId.trim() : "";
  if (!workspaceId) {
    return null;
  }
  return { workspaceId };
}

const SHARED_AGENT_WORKSPACE_PATHS = new Set(["~/.openclaw/workspace", "~/.openclaw/workspace-main"]);

function workspaceScopedAgentWorkspacePath(workspaceId: string, agentId: string): string {
  const normalizedAgentId =
    agentId
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "assistant";
  return `~/.openclaw/workspaces/${workspaceId.trim()}/${normalizedAgentId}`;
}

function normalizeWorkspaceScopedAgentEntry(entry: JsonRecord, workspaceId: string): JsonRecord {
  const normalizedId = normalizeAgentIdForCompare(entry.id) ?? "assistant";
  const rawWorkspace = typeof entry.workspace === "string" ? entry.workspace.trim() : "";
  const useScopedWorkspace =
    !rawWorkspace || SHARED_AGENT_WORKSPACE_PATHS.has(rawWorkspace.toLowerCase());
  return {
    ...entry,
    ...(useScopedWorkspace
      ? { workspace: workspaceScopedAgentWorkspacePath(workspaceId, normalizedId) }
      : {}),
    workspaceId,
  };
}

export function mergeWorkspaceScopedAgents(
  currentConfig: Record<string, unknown> | null | undefined,
  requestedConfig: unknown,
  workspaceId: string,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  const requestedRoot = isJsonRecord(requestedConfig) ? requestedConfig : null;
  if (!requestedRoot) {
    return { ok: false, error: "workspace config payload must be an object" };
  }
  const requestedAgentsNode = isJsonRecord(requestedRoot.agents) ? requestedRoot.agents : null;
  const requestedList = requestedAgentsNode ? toJsonRecordArray(requestedAgentsNode.list) : [];
  const normalizedRequested: JsonRecord[] = [];
  const requestedIds = new Set<string>();
  for (const entry of requestedList) {
    const normalizedId = normalizeAgentIdForCompare(entry.id);
    if (!normalizedId) {
      return { ok: false, error: "all agents must include a non-empty id" };
    }
    if (requestedIds.has(normalizedId)) {
      return { ok: false, error: `duplicate agent id "${normalizedId}" in request` };
    }
    requestedIds.add(normalizedId);
    normalizedRequested.push(normalizeWorkspaceScopedAgentEntry(entry, workspaceId));
  }

  const base = isJsonRecord(currentConfig) ? currentConfig : {};
  const baseAgentsNode = isJsonRecord(base.agents) ? base.agents : {};
  const baseList = toJsonRecordArray(baseAgentsNode.list);

  for (const entry of baseList) {
    const existingWorkspace =
      typeof entry.workspaceId === "string" ? entry.workspaceId.trim() : null;
    if (existingWorkspace === workspaceId) {
      continue;
    }
    const normalizedId = normalizeAgentIdForCompare(entry.id);
    if (normalizedId && requestedIds.has(normalizedId)) {
      return {
        ok: false,
        error: `agent id "${normalizedId}" already exists in another workspace`,
      };
    }
  }

  const otherWorkspaceAgents = baseList.filter((entry) => {
    const existingWorkspace =
      typeof entry.workspaceId === "string" ? entry.workspaceId.trim() : null;
    return existingWorkspace !== workspaceId;
  });

  const mergedConfig: Record<string, unknown> = {
    ...base,
    agents: {
      ...baseAgentsNode,
      list: [...otherWorkspaceAgents, ...normalizedRequested],
    },
  };
  return { ok: true, config: mergedConfig };
}

function stripWorkspaceIdsForValidation(config: Record<string, unknown>): Record<string, unknown> {
  const agentsNode = isJsonRecord(config.agents) ? config.agents : null;
  if (!agentsNode) {
    return config;
  }
  const list = toJsonRecordArray(agentsNode.list);
  if (list.length === 0) {
    return config;
  }
  const strippedList = list.map((entry) => {
    if (!Object.prototype.hasOwnProperty.call(entry, "workspaceId")) {
      return entry;
    }
    const { workspaceId: _workspaceId, ...rest } = entry;
    return rest;
  });
  return {
    ...config,
    agents: {
      ...agentsNode,
      list: strippedList,
    },
  };
}

function resolveBaseHash(params: unknown): string | null {
  const raw = (params as { baseHash?: unknown })?.baseHash;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function requireConfigBaseHash(
  params: unknown,
  snapshot: Awaited<ReturnType<typeof readConfigFileSnapshot>>,
  respond: RespondFn,
): boolean {
  if (!snapshot.exists) {
    return true;
  }
  const snapshotHash = resolveConfigSnapshotHash(snapshot);
  if (!snapshotHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config base hash unavailable; re-run config.get and retry",
      ),
    );
    return false;
  }
  const baseHash = resolveBaseHash(params);
  if (!baseHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config base hash required; re-run config.get and retry",
      ),
    );
    return false;
  }
  if (baseHash !== snapshotHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config changed since last load; re-run config.get and retry",
      ),
    );
    return false;
  }
  return true;
}

export const configHandlers: GatewayRequestHandlers = {
  "config.get": async ({ params, respond, client }) => {
    if (!validateConfigGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.get params: ${formatValidationErrors(validateConfigGetParams.errors)}`,
        ),
      );
      return;
    }
    const snapshot = await readConfigFileSnapshot();
    const redacted = redactConfigSnapshot(snapshot);

    // Filter config to show only workspace-relevant data for non-super-admin users
    if (client && !isSuperAdmin(client) && redacted.config && typeof redacted.config === "object") {
      const filteredConfig = filterSharedModelsForWorkspaceUsers(redacted.config);
      if (isJsonRecord(filteredConfig)) {
        redacted.config = filteredConfig;
      }
      if (redacted.config?.agents?.list && Array.isArray(redacted.config.agents.list)) {
        const filteredAgents = filterByWorkspace(redacted.config.agents.list, client);
        redacted.config = {
          ...redacted.config,
          agents: {
            ...redacted.config.agents,
            list: filteredAgents,
          },
        };
      }
    }

    respond(true, redacted, undefined);
  },
  "config.schema": ({ params, respond }) => {
    if (!validateConfigSchemaParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.schema params: ${formatValidationErrors(validateConfigSchemaParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const pluginRegistry = loadOpenClawPlugins({
      config: cfg,
      workspaceDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
    });
    const schema = buildConfigSchema({
      plugins: pluginRegistry.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        configUiHints: plugin.configUiHints,
        configSchema: plugin.configJsonSchema,
      })),
      channels: listChannelPlugins().map((entry) => ({
        id: entry.id,
        label: entry.meta.label,
        description: entry.meta.blurb,
        configSchema: entry.configSchema?.schema,
        configUiHints: entry.configSchema?.uiHints,
      })),
    });
    respond(true, schema, undefined);
  },
  "config.set": async ({ params, respond, client }) => {
    if (!validateConfigSetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.set params: ${formatValidationErrors(validateConfigSetParams.errors)}`,
        ),
      );
      return;
    }

    const snapshot = await readConfigFileSnapshot();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    const rawValue = (params as { raw?: unknown }).raw;
    if (typeof rawValue !== "string") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config.set params: raw (string) required"),
      );
      return;
    }
    const parsedRes = parseConfigJson5(rawValue);
    if (!parsedRes.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsedRes.error));
      return;
    }

    const scoped = workspaceScopedClient(client);
    if (scoped) {
      const merged = mergeWorkspaceScopedAgents(
        snapshot.config as Record<string, unknown> | null | undefined,
        parsedRes.parsed,
        scoped.workspaceId,
      );
      if (!merged.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, merged.error));
        return;
      }
      const validatedScoped = validateConfigObjectWithPlugins(
        stripWorkspaceIdsForValidation(merged.config),
      );
      if (!validatedScoped.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
            details: { issues: validatedScoped.issues },
          }),
        );
        return;
      }
      await writeConfigFile(merged.config);
      const redactedScoped = redactConfigObject(merged.config) as Record<string, unknown>;
      if (
        redactedScoped?.agents &&
        typeof redactedScoped.agents === "object" &&
        !Array.isArray(redactedScoped.agents)
      ) {
        const agentsNode = redactedScoped.agents as Record<string, unknown>;
        const list = toJsonRecordArray(agentsNode.list);
        redactedScoped.agents = {
          ...agentsNode,
          list: list.filter((entry) => {
            const entryWorkspace =
              typeof entry.workspaceId === "string" ? entry.workspaceId.trim() : null;
            return entryWorkspace === scoped.workspaceId;
          }),
        };
      }
      respond(
        true,
        {
          ok: true,
          path: CONFIG_PATH,
          config: redactedScoped,
        },
        undefined,
      );
      return;
    }

    // Only super-admins can modify global config
    if (client && !isSuperAdmin(client)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config modification requires super-admin privileges"),
      );
      return;
    }

    const validated = validateConfigObjectWithPlugins(parsedRes.parsed);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
          details: { issues: validated.issues },
        }),
      );
      return;
    }
    let restored: typeof validated.config;
    try {
      restored = restoreRedactedValues(
        validated.config,
        snapshot.config,
      ) as typeof validated.config;
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, String(err instanceof Error ? err.message : err)),
      );
      return;
    }
    await writeConfigFile(restored);
    respond(
      true,
      {
        ok: true,
        path: CONFIG_PATH,
        config: redactConfigObject(restored),
      },
      undefined,
    );
  },
  "config.patch": async ({ params, respond, client }) => {
    if (!validateConfigPatchParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.patch params: ${formatValidationErrors(validateConfigPatchParams.errors)}`,
        ),
      );
      return;
    }

    // Only super-admins can modify global config via patch.
    if (client && !isSuperAdmin(client)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config modification requires super-admin privileges"),
      );
      return;
    }

    const snapshot = await readConfigFileSnapshot();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    if (!snapshot.valid) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config; fix before patching"),
      );
      return;
    }
    const rawValue = (params as { raw?: unknown }).raw;
    if (typeof rawValue !== "string") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid config.patch params: raw (string) required",
        ),
      );
      return;
    }
    const parsedRes = parseConfigJson5(rawValue);
    if (!parsedRes.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsedRes.error));
      return;
    }
    if (
      !parsedRes.parsed ||
      typeof parsedRes.parsed !== "object" ||
      Array.isArray(parsedRes.parsed)
    ) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config.patch raw must be an object"),
      );
      return;
    }
    const merged = applyMergePatch(snapshot.config, parsedRes.parsed);
    let restoredMerge: unknown;
    try {
      restoredMerge = restoreRedactedValues(merged, snapshot.config);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, String(err instanceof Error ? err.message : err)),
      );
      return;
    }
    const migrated = applyLegacyMigrations(restoredMerge);
    const resolved = migrated.next ?? restoredMerge;
    const validated = validateConfigObjectWithPlugins(resolved);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
          details: { issues: validated.issues },
        }),
      );
      return;
    }
    await writeConfigFile(validated.config);

    const sessionKey =
      typeof (params as { sessionKey?: unknown }).sessionKey === "string"
        ? (params as { sessionKey?: string }).sessionKey?.trim() || undefined
        : undefined;
    const note =
      typeof (params as { note?: unknown }).note === "string"
        ? (params as { note?: string }).note?.trim() || undefined
        : undefined;
    const restartDelayMsRaw = (params as { restartDelayMs?: unknown }).restartDelayMs;
    const restartDelayMs =
      typeof restartDelayMsRaw === "number" && Number.isFinite(restartDelayMsRaw)
        ? Math.max(0, Math.floor(restartDelayMsRaw))
        : undefined;

    const payload: RestartSentinelPayload = {
      kind: "config-apply",
      status: "ok",
      ts: Date.now(),
      sessionKey,
      message: note ?? null,
      doctorHint: formatDoctorNonInteractiveHint(),
      stats: {
        mode: "config.patch",
        root: CONFIG_PATH,
      },
    };
    let sentinelPath: string | null = null;
    try {
      sentinelPath = await writeRestartSentinel(payload);
    } catch {
      sentinelPath = null;
    }
    const restart = scheduleGatewaySigusr1Restart({
      delayMs: restartDelayMs,
      reason: "config.patch",
    });

    // Audit log config modification
    auditLogger.logSuccess("config.updated", {
      workspaceId: client?.pmosWorkspaceId,
      resource: "config",
      resourceId: "system",
      metadata: { method: "patch", sessionKey, note },
    });

    respond(
      true,
      {
        ok: true,
        path: CONFIG_PATH,
        config: redactConfigObject(validated.config),
        restart,
        sentinel: {
          path: sentinelPath,
          payload,
        },
      },
      undefined,
    );
  },
  "config.apply": async ({ params, respond, client }) => {
    if (!validateConfigApplyParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid config.apply params: ${formatValidationErrors(validateConfigApplyParams.errors)}`,
        ),
      );
      return;
    }

    const snapshot = await readConfigFileSnapshot();
    if (!requireConfigBaseHash(params, snapshot, respond)) {
      return;
    }
    const rawValue = (params as { raw?: unknown }).raw;
    if (typeof rawValue !== "string") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid config.apply params: raw (string) required",
        ),
      );
      return;
    }
    const parsedRes = parseConfigJson5(rawValue);
    if (!parsedRes.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsedRes.error));
      return;
    }

    const scoped = workspaceScopedClient(client);
    if (scoped) {
      const merged = mergeWorkspaceScopedAgents(
        snapshot.config as Record<string, unknown> | null | undefined,
        parsedRes.parsed,
        scoped.workspaceId,
      );
      if (!merged.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, merged.error));
        return;
      }
      const validatedScoped = validateConfigObjectWithPlugins(
        stripWorkspaceIdsForValidation(merged.config),
      );
      if (!validatedScoped.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
            details: { issues: validatedScoped.issues },
          }),
        );
        return;
      }
      await writeConfigFile(merged.config);

      const sessionKey =
        typeof (params as { sessionKey?: unknown }).sessionKey === "string"
          ? (params as { sessionKey?: string }).sessionKey?.trim() || undefined
          : undefined;
      const note =
        typeof (params as { note?: unknown }).note === "string"
          ? (params as { note?: string }).note?.trim() || undefined
          : undefined;
      const restartDelayMsRaw = (params as { restartDelayMs?: unknown }).restartDelayMs;
      const restartDelayMs =
        typeof restartDelayMsRaw === "number" && Number.isFinite(restartDelayMsRaw)
          ? Math.max(0, Math.floor(restartDelayMsRaw))
          : undefined;

      const payload: RestartSentinelPayload = {
        kind: "config-apply",
        status: "ok",
        ts: Date.now(),
        sessionKey,
        message: note ?? null,
        doctorHint: formatDoctorNonInteractiveHint(),
        stats: {
          mode: "config.apply",
          root: CONFIG_PATH,
        },
      };
      let sentinelPath: string | null = null;
      try {
        sentinelPath = await writeRestartSentinel(payload);
      } catch {
        sentinelPath = null;
      }
      const restart = scheduleGatewaySigusr1Restart({
        delayMs: restartDelayMs,
        reason: "config.apply",
      });
      const redactedScoped = redactConfigObject(merged.config) as Record<string, unknown>;
      if (
        redactedScoped?.agents &&
        typeof redactedScoped.agents === "object" &&
        !Array.isArray(redactedScoped.agents)
      ) {
        const agentsNode = redactedScoped.agents as Record<string, unknown>;
        const list = toJsonRecordArray(agentsNode.list);
        redactedScoped.agents = {
          ...agentsNode,
          list: list.filter((entry) => {
            const entryWorkspace =
              typeof entry.workspaceId === "string" ? entry.workspaceId.trim() : null;
            return entryWorkspace === scoped.workspaceId;
          }),
        };
      }
      respond(
        true,
        {
          ok: true,
          path: CONFIG_PATH,
          config: redactedScoped,
          restart,
          sentinel: {
            path: sentinelPath,
            payload,
          },
        },
        undefined,
      );
      return;
    }

    // Only super-admins can modify global config
    if (client && !isSuperAdmin(client)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "config modification requires super-admin privileges"),
      );
      return;
    }

    const validated = validateConfigObjectWithPlugins(parsedRes.parsed);
    if (!validated.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
          details: { issues: validated.issues },
        }),
      );
      return;
    }
    let restoredApply: typeof validated.config;
    try {
      restoredApply = restoreRedactedValues(
        validated.config,
        snapshot.config,
      ) as typeof validated.config;
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, String(err instanceof Error ? err.message : err)),
      );
      return;
    }
    await writeConfigFile(restoredApply);

    const sessionKey =
      typeof (params as { sessionKey?: unknown }).sessionKey === "string"
        ? (params as { sessionKey?: string }).sessionKey?.trim() || undefined
        : undefined;
    const note =
      typeof (params as { note?: unknown }).note === "string"
        ? (params as { note?: string }).note?.trim() || undefined
        : undefined;
    const restartDelayMsRaw = (params as { restartDelayMs?: unknown }).restartDelayMs;
    const restartDelayMs =
      typeof restartDelayMsRaw === "number" && Number.isFinite(restartDelayMsRaw)
        ? Math.max(0, Math.floor(restartDelayMsRaw))
        : undefined;

    const payload: RestartSentinelPayload = {
      kind: "config-apply",
      status: "ok",
      ts: Date.now(),
      sessionKey,
      message: note ?? null,
      doctorHint: formatDoctorNonInteractiveHint(),
      stats: {
        mode: "config.apply",
        root: CONFIG_PATH,
      },
    };
    let sentinelPath: string | null = null;
    try {
      sentinelPath = await writeRestartSentinel(payload);
    } catch {
      sentinelPath = null;
    }
    const restart = scheduleGatewaySigusr1Restart({
      delayMs: restartDelayMs,
      reason: "config.apply",
    });
    respond(
      true,
      {
        ok: true,
        path: CONFIG_PATH,
        config: redactConfigObject(restoredApply),
        restart,
        sentinel: {
          path: sentinelPath,
          payload,
        },
      },
      undefined,
    );
  },
};
