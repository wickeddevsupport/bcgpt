import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import { resolveDefaultAgentWorkspaceDir } from "./workspace.js";

export { resolveAgentIdFromSessionKey } from "../routing/session-key.js";

type AgentEntry = NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>[number];

type ResolvedAgentConfig = {
  name?: string;
  workspace?: string;
  workspaceId?: string;
  agentDir?: string;
  model?: AgentEntry["model"];
  skills?: AgentEntry["skills"];
  memorySearch?: AgentEntry["memorySearch"];
  humanDelay?: AgentEntry["humanDelay"];
  heartbeat?: AgentEntry["heartbeat"];
  identity?: AgentEntry["identity"];
  groupChat?: AgentEntry["groupChat"];
  subagents?: AgentEntry["subagents"];
  sandbox?: AgentEntry["sandbox"];
  tools?: AgentEntry["tools"];
};

let defaultAgentWarned = false;

function listAgents(cfg: OpenClawConfig): AgentEntry[] {
  const list = cfg.agents?.list;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((entry): entry is AgentEntry => Boolean(entry && typeof entry === "object"));
}

export function listAgentIds(cfg: OpenClawConfig): string[] {
  const agents = listAgents(cfg);
  if (agents.length === 0) {
    return [DEFAULT_AGENT_ID];
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of agents) {
    const id = normalizeAgentId(entry?.id);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : [DEFAULT_AGENT_ID];
}

export function resolveDefaultAgentId(cfg: OpenClawConfig): string {
  const agents = listAgents(cfg);
  if (agents.length === 0) {
    return DEFAULT_AGENT_ID;
  }
  const defaults = agents.filter((agent) => agent?.default);
  if (defaults.length > 1 && !defaultAgentWarned) {
    defaultAgentWarned = true;
    console.warn("Multiple agents marked default=true; using the first entry as default.");
  }
  const chosen = (defaults[0] ?? agents[0])?.id?.trim();
  return normalizeAgentId(chosen || DEFAULT_AGENT_ID);
}

export function resolveSessionAgentIds(params: { sessionKey?: string; config?: OpenClawConfig }): {
  defaultAgentId: string;
  sessionAgentId: string;
} {
  const defaultAgentId = resolveDefaultAgentId(params.config ?? {});
  const sessionKey = params.sessionKey?.trim();
  const normalizedSessionKey = sessionKey ? sessionKey.toLowerCase() : undefined;
  const parsed = normalizedSessionKey ? parseAgentSessionKey(normalizedSessionKey) : null;
  const sessionAgentId = parsed?.agentId ? normalizeAgentId(parsed.agentId) : defaultAgentId;
  return { defaultAgentId, sessionAgentId };
}

export function resolveSessionAgentId(params: {
  sessionKey?: string;
  config?: OpenClawConfig;
}): string {
  return resolveSessionAgentIds(params).sessionAgentId;
}

function resolveWorkspaceDir(rawWorkspace: string): string {
  const trimmed = rawWorkspace.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("~") || path.isAbsolute(trimmed)) {
    return resolveUserPath(trimmed);
  }
  // Relative workspace entries are mapped into state dir so they remain writable
  // in containerized deployments where cwd can be read-only.
  return path.join(resolveStateDir(process.env), "workspaces", trimmed);
}

function resolveAgentEntry(cfg: OpenClawConfig, agentId: string): AgentEntry | undefined {
  const id = normalizeAgentId(agentId);
  return listAgents(cfg).find((entry) => normalizeAgentId(entry.id) === id);
}

export function resolveAgentConfig(
  cfg: OpenClawConfig,
  agentId: string,
): ResolvedAgentConfig | undefined {
  const id = normalizeAgentId(agentId);
  const entry = resolveAgentEntry(cfg, id);
  if (!entry) {
    return undefined;
  }
  return {
    name: typeof entry.name === "string" ? entry.name : undefined,
    workspace: typeof entry.workspace === "string" ? entry.workspace : undefined,
    workspaceId:
      typeof (entry as { workspaceId?: unknown }).workspaceId === "string"
        ? ((entry as { workspaceId?: string }).workspaceId?.trim() || undefined)
        : undefined,
    agentDir: typeof entry.agentDir === "string" ? entry.agentDir : undefined,
    model:
      typeof entry.model === "string" || (entry.model && typeof entry.model === "object")
        ? entry.model
        : undefined,
    skills: Array.isArray(entry.skills) ? entry.skills : undefined,
    memorySearch: entry.memorySearch,
    humanDelay: entry.humanDelay,
    heartbeat: entry.heartbeat,
    identity: entry.identity,
    groupChat: entry.groupChat,
    subagents: typeof entry.subagents === "object" && entry.subagents ? entry.subagents : undefined,
    sandbox: entry.sandbox,
    tools: entry.tools,
  };
}

const SHARED_WORKSPACE_PATH_SUFFIXES = [
  "/.openclaw/workspace",
  "/.openclaw/workspace-main",
] as const;

function normalizeSlashPath(value: string): string {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

function isSharedWorkspacePath(value: string): boolean {
  const normalized = normalizeSlashPath(value);
  if (!normalized) {
    return true;
  }
  if (normalized === "~/.openclaw/workspace" || normalized === "~/.openclaw/workspace-main") {
    return true;
  }
  if (normalized === "/app/openclaw/default") {
    return true;
  }
  return SHARED_WORKSPACE_PATH_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function resolveWorkspaceScopedWorkspaceDir(workspaceId: string, agentId: string): string {
  return resolveWorkspaceDir(`~/.openclaw/workspaces/${workspaceId.trim()}/${agentId}`);
}

function isSharedAgentDirPath(value: string, agentId: string): boolean {
  const normalized = normalizeSlashPath(value);
  if (!normalized) {
    return true;
  }
  const id = normalizeAgentId(agentId);
  if (normalized === `/app/.openclaw/agents/${id}/agent`) {
    return true;
  }
  return normalized.endsWith(`/.openclaw/agents/${id}/agent`);
}

export function resolveAgentSkillsFilter(
  cfg: OpenClawConfig,
  agentId: string,
): string[] | undefined {
  const raw = resolveAgentConfig(cfg, agentId)?.skills;
  if (!raw) {
    return undefined;
  }
  const normalized = raw.map((entry) => String(entry).trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : [];
}

export function resolveAgentModelPrimary(cfg: OpenClawConfig, agentId: string): string | undefined {
  const raw = resolveAgentConfig(cfg, agentId)?.model;
  if (!raw) {
    return undefined;
  }
  if (typeof raw === "string") {
    return raw.trim() || undefined;
  }
  const primary = raw.primary?.trim();
  return primary || undefined;
}

export function resolveAgentModelFallbacksOverride(
  cfg: OpenClawConfig,
  agentId: string,
): string[] | undefined {
  const raw = resolveAgentConfig(cfg, agentId)?.model;
  if (!raw || typeof raw === "string") {
    return undefined;
  }
  // Important: treat an explicitly provided empty array as an override to disable global fallbacks.
  if (!Object.hasOwn(raw, "fallbacks")) {
    return undefined;
  }
  return Array.isArray(raw.fallbacks) ? raw.fallbacks : undefined;
}

export function resolveAgentWorkspaceDir(cfg: OpenClawConfig, agentId: string) {
  const id = normalizeAgentId(agentId);
  const resolved = resolveAgentConfig(cfg, id);
  const configured = resolved?.workspace?.trim();
  const workspaceId = resolved?.workspaceId?.trim();
  if (workspaceId && (!configured || isSharedWorkspacePath(configured))) {
    return resolveWorkspaceScopedWorkspaceDir(workspaceId, id);
  }
  if (configured) {
    return resolveWorkspaceDir(configured);
  }
  const defaultAgentId = resolveDefaultAgentId(cfg);
  if (id === defaultAgentId) {
    const fallback = cfg.agents?.defaults?.workspace?.trim();
    if (fallback) {
      return resolveWorkspaceDir(fallback);
    }
    return resolveDefaultAgentWorkspaceDir(process.env);
  }
  const stateDir = resolveStateDir(process.env);
  return path.join(stateDir, `workspace-${id}`);
}

export function resolveAgentDir(cfg: OpenClawConfig, agentId: string) {
  const id = normalizeAgentId(agentId);
  const resolved = resolveAgentConfig(cfg, id);
  const configured = resolved?.agentDir?.trim();
  const root = resolveStateDir(process.env);
  const workspaceId = resolved?.workspaceId?.trim();
  if (configured) {
    if (workspaceId && isSharedAgentDirPath(configured, id)) {
      return path.join(root, "workspaces", workspaceId, "agents", id, "agent");
    }
    return resolveUserPath(configured);
  }
  if (workspaceId) {
    return path.join(root, "workspaces", workspaceId, "agents", id, "agent");
  }
  return path.join(root, "agents", id, "agent");
}
