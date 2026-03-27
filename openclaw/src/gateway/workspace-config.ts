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
  const filtered = list.filter((entry) => {
    if (!isJsonObject(entry)) {
      return true; // keep non-object entries as-is
    }
    const entryWs = typeof entry.workspaceId === "string" ? entry.workspaceId.trim() : "";
    // Keep: global agents (no workspaceId) or agents that belong to this workspace
    return !entryWs || entryWs === wsId;
  });
  const scoped = filtered.map((entry) => {
    if (!isJsonObject(entry)) {
      return entry;
    }
    const entryWs = typeof entry.workspaceId === "string" ? entry.workspaceId.trim() : "";
    return entryWs ? entry : { ...entry, workspaceId: wsId };
  });
  const mergedForDefault = {
    ...mergedCfg,
    agents: {
      ...(isJsonObject(agents) ? agents : {}),
      defaults: agentDefaults,
      list: scoped,
    },
  } as OpenClawConfig;
  const defaultAgentId = resolveDefaultAgentId(mergedForDefault);
  if (!isWorkspaceScopedPath(agentDefaults.workspace, wsId)) {
    agentDefaults.workspace = workspaceDefaultAgentWorkspacePath(wsId, defaultAgentId);
  }
  if (scoped.length === 0) {
    scoped.push({ id: defaultAgentId, default: true, workspaceId: wsId });
  }
  return {
    ...mergedCfg,
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
  const scopedPaths = applyWorkspaceScopedPaths(mergedObject, workspaceId);
  // Strip any agents from other workspaces that may have leaked into global config
  return filterAgentsForWorkspace(scopedPaths, workspaceId);
}
