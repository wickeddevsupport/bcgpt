import fs from "node:fs/promises";
import path from "node:path";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
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

export async function readWorkspaceConfig(workspaceId: string): Promise<JsonObject | null> {
  const p = workspaceConfigPath(workspaceId);
  try {
    const raw = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isJsonObject(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeWorkspaceConfig(workspaceId: string, next: JsonObject): Promise<void> {
  const p = workspaceConfigPath(workspaceId);
  await ensureDir(path.dirname(p));
  const raw = JSON.stringify(next, null, 2).trimEnd().concat("\n");
  await fs.writeFile(p, raw, "utf-8");
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
  return next;
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

function normalizeWorkspaceAgentEntry(
  entry: JsonObject | null,
  workspaceId: string,
  fallbackAgentId: string,
): JsonObject {
  const agentId =
    typeof entry?.id === "string" && entry.id.trim() ? entry.id.trim() : fallbackAgentId;
  const next: JsonObject = { ...(entry ?? {}), id: agentId, workspaceId };
  if (!isWorkspaceScopedPath(next.workspace, workspaceId)) {
    next.workspace = workspaceDefaultAgentWorkspacePath(workspaceId, agentId);
  }
  return next;
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

export async function loadEffectiveWorkspaceConfig(workspaceId: string): Promise<JsonObject> {
  const globalCfg = loadConfig() as unknown;
  const globalObject = isJsonObject(globalCfg) ? stripCrossWorkspaceInheritedConfig(globalCfg) : {};
  const workspaceCfg = (await readWorkspaceConfig(workspaceId)) ?? {};
  const merged = deepMerge(globalObject, workspaceCfg);
  const mergedObject = isJsonObject(merged) ? merged : globalObject;
  const mergedAgents = mergeWorkspaceAgentLists(globalObject, workspaceCfg, mergedObject, workspaceId);
  const scopedPaths = applyWorkspaceScopedPaths(mergedAgents, workspaceId);
  // Strip any agents from other workspaces that may have leaked into global config
  return filterAgentsForWorkspace(scopedPaths, workspaceId);
}
