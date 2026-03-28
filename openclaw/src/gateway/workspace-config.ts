import fs from "node:fs/promises";
import path from "node:path";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { getChannelPlugin } from "../channels/plugins/index.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { updateLastRoute } from "../config/sessions/store.js";
import { loadConfig } from "../config/config.js";
import { buildAgentMainSessionKey, normalizeAgentId } from "../routing/session-key.js";
import { isDeliverableMessageChannel, normalizeMessageChannel } from "../utils/message-channel.js";
import { CONFIG_DIR, ensureDir, isRecord } from "../utils.js";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isJsonObject(base) || !isJsonObject(patch)) {
    return patch;
  }
  const out: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const prev = out[key];
    out[key] = deepMerge(prev, value);
  }
  return out;
}

export function workspaceConfigPath(workspaceId: string): string {
  const safe = String(workspaceId).trim() || "default";
  return path.join(CONFIG_DIR, "workspaces", safe, "config.json");
}

function stripCrossWorkspaceInheritedConfig(globalCfg: JsonObject): JsonObject {
  const next: JsonObject = { ...globalCfg };

  // Workspace-owned channel/account state must not bleed in from the global
  // config, otherwise workspace users inherit another tenant's Discord/session
  // routing and credentials.
  delete next.channels;
  delete next.env;
  delete next.bindings;

  const routing = isJsonObject(next.routing) ? ({ ...next.routing } as JsonObject) : null;
  if (routing && Object.prototype.hasOwnProperty.call(routing, "bindings")) {
    delete routing.bindings;
    next.routing = routing;
  }

  const session = isJsonObject(next.session) ? ({ ...next.session } as JsonObject) : null;
  if (session && Object.prototype.hasOwnProperty.call(session, "identityLinks")) {
    delete session.identityLinks;
    next.session = session;
  }

  return next;
}

function workspaceSessionStorePath(workspaceId: string): string {
  return `~/.openclaw/workspaces/${workspaceId}/agents/{agentId}/sessions/sessions.json`;
}

function workspaceCronStorePath(workspaceId: string): string {
  return `~/.openclaw/workspaces/${workspaceId}/cron/jobs.json`;
}

function workspaceDefaultAgentWorkspacePath(workspaceId: string, agentId: string): string {
  return `~/.openclaw/workspaces/${workspaceId}/${agentId}`;
}

function isWorkspaceScopedPath(value: unknown, workspaceId: string): boolean {
  return typeof value === "string" && value.includes(`/workspaces/${workspaceId}/`);
}

function hasExpectedWorkspaceAgentPath(value: unknown, workspaceId: string, agentId: string): boolean {
  return typeof value === "string" && value.includes(`/workspaces/${workspaceId}/${agentId}`);
}

function shouldNormalizeWorkspaceAgentPath(
  value: unknown,
  workspaceId: string,
  agentId: string,
): boolean {
  if (!isWorkspaceScopedPath(value, workspaceId)) {
    return true;
  }
  return !hasExpectedWorkspaceAgentPath(value, workspaceId, agentId);
}

function normalizeWorkspaceAgentEntry(
  entry: JsonObject | null,
  workspaceId: string,
  fallbackAgentId: string,
): JsonObject {
  const agentId =
    typeof entry?.id === "string" && entry.id.trim() ? entry.id.trim() : fallbackAgentId;
  const next: JsonObject = { ...(entry ?? {}), id: agentId, workspaceId };
  if (shouldNormalizeWorkspaceAgentPath(next.workspace, workspaceId, agentId)) {
    next.workspace = workspaceDefaultAgentWorkspacePath(workspaceId, agentId);
  }
  return next;
}

export function normalizeWorkspaceConfigDocument(
  workspaceId: string,
  config: JsonObject,
): JsonObject {
  const wsId = workspaceId.trim();
  if (!wsId) {
    return config;
  }

  let next: JsonObject = { ...config };
  const agents = isJsonObject(next.agents) ? ({ ...next.agents } as JsonObject) : null;
  if (agents) {
    const defaultAgentId =
      typeof agents.defaultAgentId === "string" && agents.defaultAgentId.trim()
        ? agents.defaultAgentId.trim()
        : "assistant";
    if (Array.isArray(agents.list)) {
      agents.list = agents.list
        .filter((entry): entry is JsonObject => isJsonObject(entry))
        .filter((entry) => {
          const entryWorkspaceId =
            typeof entry.workspaceId === "string" ? entry.workspaceId.trim() : "";
          return !entryWorkspaceId || entryWorkspaceId === wsId;
        })
        .map((entry) =>
          normalizeWorkspaceAgentEntry(
            entry,
            wsId,
            typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : defaultAgentId,
          ),
        );
    }
    const defaults = isJsonObject(agents.defaults) ? ({ ...agents.defaults } as JsonObject) : null;
    if (defaults && shouldNormalizeWorkspaceAgentPath(defaults.workspace, wsId, defaultAgentId)) {
      defaults.workspace = workspaceDefaultAgentWorkspacePath(wsId, defaultAgentId);
      agents.defaults = defaults;
    }
    next.agents = agents;
  }

  const session = isJsonObject(next.session) ? ({ ...next.session } as JsonObject) : null;
  if (
    session &&
    Object.prototype.hasOwnProperty.call(session, "store") &&
    !isWorkspaceScopedPath(session.store, wsId)
  ) {
    session.store = workspaceSessionStorePath(wsId);
    next.session = session;
  }

  const cron = isJsonObject(next.cron) ? ({ ...next.cron } as JsonObject) : null;
  if (
    cron &&
    Object.prototype.hasOwnProperty.call(cron, "store") &&
    !isWorkspaceScopedPath(cron.store, wsId)
  ) {
    cron.store = workspaceCronStorePath(wsId);
    next.cron = cron;
  }

  return applyWorkspaceAgentCollaborationDefaults(next, wsId);
}

async function persistWorkspaceConfigFile(workspaceId: string, next: JsonObject): Promise<void> {
  const p = workspaceConfigPath(workspaceId);
  await ensureDir(path.dirname(p));
  const raw = JSON.stringify(next, null, 2).trimEnd().concat("\n");
  await fs.writeFile(p, raw, "utf-8");
}

export async function readWorkspaceConfig(workspaceId: string): Promise<JsonObject | null> {
  const p = workspaceConfigPath(workspaceId);
  try {
    const raw = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isJsonObject(parsed)) {
      return null;
    }
    const normalized = normalizeWorkspaceConfigDocument(workspaceId, parsed);
    if (JSON.stringify(normalized) !== JSON.stringify(parsed)) {
      await persistWorkspaceConfigFile(workspaceId, normalized);
    }
    return normalized;
  } catch {
    return null;
  }
}

export async function writeWorkspaceConfig(workspaceId: string, next: JsonObject): Promise<void> {
  const normalized = normalizeWorkspaceConfigDocument(workspaceId, next);
  await persistWorkspaceConfigFile(workspaceId, normalized);
  try {
    await seedWorkspaceAgentBoundRoutes(workspaceId);
  } catch {
    // Best-effort session route seeding.
  }
  try {
    const { refreshWorkspaceAiContext } = await import("./workspace-ai-context.js");
    await refreshWorkspaceAiContext(workspaceId);
  } catch {
    // Best-effort context snapshot update.
  }
}

export async function patchWorkspaceConfig(
  workspaceId: string,
  patch: JsonObject,
): Promise<JsonObject> {
  const existing = (await readWorkspaceConfig(workspaceId)) ?? {};
  const merged = deepMerge(existing, patch);
  const next = isJsonObject(merged) ? merged : {};
  await writeWorkspaceConfig(workspaceId, next);
  return normalizeWorkspaceConfigDocument(workspaceId, next);
}

function mergeWorkspaceAgentLists(
  globalCfg: JsonObject,
  workspaceCfg: JsonObject,
  mergedCfg: JsonObject,
  workspaceId: string,
): JsonObject {
  const wsId = workspaceId.trim();
  const globalAgents =
    isJsonObject(globalCfg.agents) && Array.isArray(globalCfg.agents.list) ? globalCfg.agents.list : [];
  const workspaceAgents =
    isJsonObject(workspaceCfg.agents) && Array.isArray(workspaceCfg.agents.list)
      ? workspaceCfg.agents.list
      : null;
  if (!workspaceAgents) {
    return mergedCfg;
  }

  const combined = new Map<string, JsonObject>();
  for (const entry of globalAgents) {
    if (!isJsonObject(entry)) {
      continue;
    }
    const entryWs = typeof entry.workspaceId === "string" ? entry.workspaceId.trim() : "";
    const agentId = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!agentId || entryWs !== wsId) {
      continue;
    }
    combined.set(agentId, { ...entry });
  }
  for (const entry of workspaceAgents) {
    if (!isJsonObject(entry)) {
      continue;
    }
    const agentId = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!agentId) {
      continue;
    }
    combined.set(agentId, { ...entry });
  }

  return {
    ...mergedCfg,
    agents: {
      ...(isJsonObject(mergedCfg.agents) ? mergedCfg.agents : {}),
      list: Array.from(combined.values()),
    },
  };
}

/**
 * Filter agents.list in the merged effective config to only include agents that
 * belong to the given workspaceId (i.e. entries with no workspaceId or with
 * workspaceId matching this workspace). This prevents workspace-agent cross-
 * contamination when global config accidentally has workspace-scoped entries.
 */
function filterAgentsForWorkspace(mergedCfg: JsonObject, workspaceId: string): JsonObject {
  const agents = mergedCfg.agents;
  const agentDefaults = isJsonObject(agents) && isJsonObject(agents.defaults) ? { ...agents.defaults } : {};
  const list = isJsonObject(agents) && Array.isArray(agents.list) ? agents.list : [];
  const wsId = workspaceId.trim();
  const workspaceEntries = list
    .filter((entry): entry is JsonObject => {
      if (!isJsonObject(entry)) {
        return false;
      }
      return typeof entry.workspaceId === "string" && entry.workspaceId.trim() === wsId;
    })
    .map((entry) => normalizeWorkspaceAgentEntry(entry, wsId, String(entry.id ?? "").trim() || "assistant"));
  const defaultAgentId = resolveDefaultAgentId(mergedCfg as OpenClawConfig);
  const defaultTemplate =
    list.find(
      (entry) =>
        isJsonObject(entry) &&
        typeof entry.id === "string" &&
        entry.id.trim() === defaultAgentId &&
        (typeof entry.workspaceId !== "string" || entry.workspaceId.trim() === wsId),
    ) ?? null;
  const scoped = workspaceEntries.slice();
  if (!scoped.some((entry) => String(entry.id ?? "").trim() === defaultAgentId)) {
    scoped.unshift(normalizeWorkspaceAgentEntry(defaultTemplate, wsId, defaultAgentId));
  }
  if (!scoped.some((entry) => entry.default === true)) {
    const defaultIndex = scoped.findIndex((entry) => String(entry.id ?? "").trim() === defaultAgentId);
    if (defaultIndex >= 0) {
      scoped[defaultIndex] = { ...scoped[defaultIndex], default: true };
    }
  }
  if (!isWorkspaceScopedPath(agentDefaults.workspace, wsId)) {
    agentDefaults.workspace = workspaceDefaultAgentWorkspacePath(wsId, defaultAgentId);
  }
  const routing = isJsonObject(mergedCfg.routing) ? { ...mergedCfg.routing } : {};
  const routingDefaultAgentId =
    typeof routing.defaultAgentId === "string" ? routing.defaultAgentId.trim() : "";
  if (
    !routingDefaultAgentId ||
    !scoped.some((entry) => String(entry.id ?? "").trim() === routingDefaultAgentId)
  ) {
    routing.defaultAgentId = defaultAgentId;
  }
  return {
    ...mergedCfg,
    routing,
    agents: {
      ...(isJsonObject(agents) ? agents : {}),
      defaults: agentDefaults,
      list: scoped,
    },
  };
}

function applyWorkspaceScopedPaths(mergedCfg: JsonObject, workspaceId: string): JsonObject {
  const wsId = workspaceId.trim();
  const session = isJsonObject(mergedCfg.session) ? { ...mergedCfg.session } : {};
  if (!isWorkspaceScopedPath(session.store, wsId)) {
    session.store = workspaceSessionStorePath(wsId);
  }

  const cron = isJsonObject(mergedCfg.cron) ? { ...mergedCfg.cron } : {};
  if (!isWorkspaceScopedPath(cron.store, wsId)) {
    cron.store = workspaceCronStorePath(wsId);
  }

  return {
    ...mergedCfg,
    session,
    cron,
  };
}

type WorkspaceBindingRouteSeed = {
  agentId: string;
  channel: ReturnType<typeof normalizeMessageChannel>;
  to: string;
  accountId?: string;
};

function normalizeBoundTarget(params: {
  channel: string;
  channelId?: unknown;
  peer?: unknown;
}): string | null {
  const normalizedChannel = normalizeMessageChannel(params.channel);
  if (!normalizedChannel || !isDeliverableMessageChannel(normalizedChannel)) {
    return null;
  }
  const plugin = getChannelPlugin(normalizedChannel);
  const channelId =
    typeof params.channelId === "string" && params.channelId.trim()
      ? params.channelId.trim()
      : "";
  if (channelId) {
    const raw = `channel:${channelId}`;
    return plugin?.messaging?.normalizeTarget?.(raw) ?? raw;
  }
  const peer = isJsonObject(params.peer) ? params.peer : null;
  const peerKind = typeof peer?.kind === "string" ? peer.kind.trim().toLowerCase() : "";
  const peerId = typeof peer?.id === "string" ? peer.id.trim() : "";
  if (!peerKind || !peerId) {
    return null;
  }
  const raw =
    peerKind === "direct"
      ? `user:${peerId}`
      : peerKind === "channel"
        ? `channel:${peerId}`
        : `group:${peerId}`;
  return plugin?.messaging?.normalizeTarget?.(raw) ?? raw;
}

function collectWorkspaceBindingRouteSeeds(cfg: JsonObject): WorkspaceBindingRouteSeed[] {
  const bindings = Array.isArray(cfg.bindings) ? cfg.bindings : [];
  const seeds = new Map<string, WorkspaceBindingRouteSeed>();
  for (const binding of bindings) {
    if (!isJsonObject(binding)) {
      continue;
    }
    const agentId = normalizeAgentId(typeof binding.agentId === "string" ? binding.agentId : "");
    if (!agentId) {
      continue;
    }
    const match = isJsonObject(binding.match) ? binding.match : null;
    const channel = typeof match?.channel === "string" ? match.channel.trim() : "";
    const normalizedChannel = normalizeMessageChannel(channel);
    if (!normalizedChannel || !isDeliverableMessageChannel(normalizedChannel)) {
      continue;
    }
    const to = normalizeBoundTarget({
      channel,
      channelId: match?.channelId,
      peer: match?.peer,
    });
    if (!to) {
      continue;
    }
    const rawAccountId = typeof match?.accountId === "string" ? match.accountId.trim() : "";
    seeds.set(agentId, {
      agentId,
      channel: normalizedChannel,
      to,
      accountId: rawAccountId && rawAccountId !== "*" ? rawAccountId : undefined,
    });
  }
  return Array.from(seeds.values());
}

async function seedWorkspaceAgentBoundRoutes(workspaceId: string): Promise<void> {
  const effective = (await loadEffectiveWorkspaceConfig(workspaceId)) as OpenClawConfig;
  const seeds = collectWorkspaceBindingRouteSeeds(effective as JsonObject);
  if (seeds.length === 0) {
    return;
  }
  for (const seed of seeds) {
    const storePath = resolveStorePath(effective.session?.store, { agentId: seed.agentId });
    await updateLastRoute({
      storePath,
      sessionKey: buildAgentMainSessionKey({
        agentId: seed.agentId,
        mainKey: effective.session?.mainKey,
      }),
      channel: seed.channel,
      to: seed.to,
      accountId: seed.accountId,
    });
  }
}

export function applyWorkspaceAgentCollaborationDefaults(
  config: JsonObject,
  workspaceId: string,
): JsonObject {
  const wsId = workspaceId.trim();
  if (!wsId) {
    return config;
  }

  const agents = isJsonObject(config.agents) ? ({ ...config.agents } as JsonObject) : null;
  const list = agents && Array.isArray(agents.list) ? agents.list : null;
  if (!list) {
    return config;
  }

  let mutated = false;
  const nextList = list.map((entry) => {
    if (!isJsonObject(entry)) {
      return entry;
    }
    const entryWorkspaceId =
      typeof entry.workspaceId === "string" ? entry.workspaceId.trim() : "";
    if (entryWorkspaceId !== wsId) {
      return entry;
    }
    const subagents = isJsonObject(entry.subagents)
      ? ({ ...entry.subagents } as JsonObject)
      : {};
    const allowAgents = Array.isArray(subagents.allowAgents)
      ? subagents.allowAgents.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const normalizedId =
      typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : "assistant";
    let nextEntry: JsonObject = { ...entry };
    if (shouldNormalizeWorkspaceAgentPath(nextEntry.workspace, wsId, normalizedId)) {
      nextEntry = {
        ...nextEntry,
        workspace: workspaceDefaultAgentWorkspacePath(wsId, normalizedId),
      };
      mutated = true;
    }
    if (allowAgents.length === 0) {
      nextEntry = {
        ...nextEntry,
        subagents: {
          ...subagents,
          allowAgents: ["*"],
        },
      };
      mutated = true;
    }
    return nextEntry;
  });

  const tools = isJsonObject(config.tools) ? ({ ...config.tools } as JsonObject) : {};
  const toolAgentToAgent = isJsonObject(tools.agentToAgent)
    ? ({ ...tools.agentToAgent } as JsonObject)
    : null;
  const agentToAgentEnabled = toolAgentToAgent?.enabled;
  const agentToAgentAllow = Array.isArray(toolAgentToAgent?.allow)
    ? toolAgentToAgent.allow.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (agentToAgentEnabled !== true || agentToAgentAllow.length === 0) {
    mutated = true;
    tools.agentToAgent = {
      ...(toolAgentToAgent ?? {}),
      enabled: true,
      allow: ["*"],
    };
  }

  if (!mutated) {
    return config;
  }

  return {
    ...config,
    tools,
    agents: {
      ...agents,
      list: nextList,
    },
  };
}

export async function loadEffectiveWorkspaceConfig(workspaceId: string): Promise<JsonObject> {
  const globalCfg = loadConfig() as unknown;
  const globalObject = isJsonObject(globalCfg) ? stripCrossWorkspaceInheritedConfig(globalCfg) : {};
  const workspaceCfg = (await readWorkspaceConfig(workspaceId)) ?? {};
  const merged = deepMerge(globalObject, workspaceCfg);
  const mergedObject = isJsonObject(merged) ? merged : globalObject;
  const mergedAgents = mergeWorkspaceAgentLists(globalObject, workspaceCfg, mergedObject, workspaceId);
  const scopedPaths = applyWorkspaceScopedPaths(mergedAgents, workspaceId);
  // Strip any agents from other workspaces that may have leaked into global config
  const filtered = filterAgentsForWorkspace(scopedPaths, workspaceId);
  return applyWorkspaceAgentCollaborationDefaults(filtered, workspaceId);
}
