#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || "/app/.openclaw";
const GLOBAL_CONFIG_PATH = path.join(STATE_DIR, "openclaw.json");
const WORKSPACES_DIR = path.join(STATE_DIR, "workspaces");
const MANAGED_SKILLS_DIR = path.join(STATE_DIR, "skills");
const REPO_SKILLS_DIR = process.env.BCGPT_SHARED_SKILLS_DIR || "/app/bcgpt-skills";
const MCPORTER_STATE_DIR = process.env.MCPORTER_HOME || "/app/.mcporter";
const MCPORTER_CONFIG_PATH =
  process.env.MCPORTER_CONFIG_PATH || "/app/openclaw/config/mcporter.json";

const PRIMER_VERSION = "bcgpt-primer-2026-03-08";
const DEFAULT_AGENT_ID = "assistant";
const DEFAULT_AGENT_NAME = "Workspace Assistant";
const DEFAULT_MODEL_REF = "kilo/minimax/minimax-m2.5:free";
const DEPRECATED_MODEL_REFS = new Set(["kilo/auto-free", "kilo/z-ai/glm-5:free", "kilo/glm-5:free"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimToNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeModelRef(value) {
  const ref = trimToNull(value);
  if (!ref) {
    return DEFAULT_MODEL_REF;
  }
  return DEPRECATED_MODEL_REFS.has(ref) ? DEFAULT_MODEL_REF : ref;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  const next = JSON.stringify(value, null, 2).trimEnd() + "\n";
  const current = await fs.readFile(filePath, "utf8").catch(() => null);
  if (current === next) {
    return false;
  }
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, next, "utf8");
  return true;
}

function ensureMeta(target) {
  const meta = isRecord(target.meta) ? target.meta : {};
  target.meta = {
    ...meta,
    lastTouchedVersion: PRIMER_VERSION,
    lastTouchedAt: new Date().toISOString(),
  };
}

function ensureGlobalDefaults(config) {
  const next = isRecord(config) ? config : {};
  ensureMeta(next);

  next.gateway = isRecord(next.gateway) ? next.gateway : {};
  next.gateway.auth = isRecord(next.gateway.auth) ? next.gateway.auth : {};
  const gatewayToken = trimToNull(process.env.OPENCLAW_GATEWAY_TOKEN);
  if (gatewayToken) {
    next.gateway.auth.token = gatewayToken;
  }
  delete next.gateway.token;

  next.gateway.controlUi = isRecord(next.gateway.controlUi) ? next.gateway.controlUi : {};
  if (typeof next.gateway.controlUi.enabled !== "boolean") {
    next.gateway.controlUi.enabled = true;
  }

  next.browser = isRecord(next.browser) ? next.browser : {};
  if (typeof next.browser.enabled !== "boolean") {
    next.browser.enabled = true;
  }
  if (typeof next.browser.headless !== "boolean") {
    next.browser.headless = true;
  }
  if (typeof next.browser.noSandbox !== "boolean") {
    next.browser.noSandbox = true;
  }

  next.skills = isRecord(next.skills) ? next.skills : {};
  next.skills.load = isRecord(next.skills.load) ? next.skills.load : {};
  if (typeof next.skills.load.watch !== "boolean") {
    next.skills.load.watch = true;
  }
  if (typeof next.skills.load.watchDebounceMs !== "number") {
    next.skills.load.watchDebounceMs = 250;
  }
  next.skills.install = isRecord(next.skills.install) ? next.skills.install : {};
  if (!trimToNull(next.skills.install.nodeManager)) {
    next.skills.install.nodeManager = "npm";
  }

  next.agents = isRecord(next.agents) ? next.agents : {};
  next.agents.defaults = isRecord(next.agents.defaults) ? next.agents.defaults : {};
  const defaults = next.agents.defaults;

  defaults.compaction = isRecord(defaults.compaction) ? defaults.compaction : {};
  if (!trimToNull(defaults.compaction.mode)) {
    defaults.compaction.mode = "safeguard";
  }

  if (typeof defaults.maxConcurrent !== "number") {
    defaults.maxConcurrent = 4;
  }
  if (!trimToNull(defaults.thinkingDefault)) {
    defaults.thinkingDefault = "low";
  }

  defaults.model = isRecord(defaults.model) ? defaults.model : {};
  defaults.model.primary = normalizeModelRef(defaults.model.primary);
  if (!Array.isArray(defaults.model.fallbacks)) {
    defaults.model.fallbacks = [];
  }

  defaults.models = isRecord(defaults.models) ? defaults.models : {};
  if (!isRecord(defaults.models[defaults.model.primary])) {
    defaults.models[defaults.model.primary] = { alias: "MiniMax M2.5 (Free)" };
  }

  defaults.subagents = isRecord(defaults.subagents) ? defaults.subagents : {};
  if (!trimToNull(defaults.subagents.model)) {
    defaults.subagents.model = defaults.model.primary;
  }
  if (!trimToNull(defaults.subagents.thinking)) {
    defaults.subagents.thinking = "low";
  }
  if (typeof defaults.subagents.maxConcurrent !== "number") {
    defaults.subagents.maxConcurrent = 4;
  }
  if (typeof defaults.subagents.archiveAfterMinutes !== "number") {
    defaults.subagents.archiveAfterMinutes = 30;
  }

  defaults.memorySearch = isRecord(defaults.memorySearch) ? defaults.memorySearch : {};
  const memorySearch = defaults.memorySearch;
  if (typeof memorySearch.enabled !== "boolean") {
    memorySearch.enabled = true;
  }
  memorySearch.experimental = isRecord(memorySearch.experimental) ? memorySearch.experimental : {};
  if (typeof memorySearch.experimental.sessionMemory !== "boolean") {
    memorySearch.experimental.sessionMemory = true;
  }
  if (!Array.isArray(memorySearch.sources) || memorySearch.sources.length === 0) {
    memorySearch.sources = ["memory", "sessions"];
  }
  memorySearch.sync = isRecord(memorySearch.sync) ? memorySearch.sync : {};
  if (typeof memorySearch.sync.onSessionStart !== "boolean") {
    memorySearch.sync.onSessionStart = true;
  }
  if (typeof memorySearch.sync.onSearch !== "boolean") {
    memorySearch.sync.onSearch = true;
  }
  if (typeof memorySearch.sync.watch !== "boolean") {
    memorySearch.sync.watch = true;
  }

  next.agents.list = Array.isArray(next.agents.list) ? next.agents.list : [];
  return next;
}

function buildStarterAgent(workspaceId, modelRef) {
  const workspace = `~/.openclaw/workspaces/${workspaceId}/${DEFAULT_AGENT_ID}`;
  return {
    id: DEFAULT_AGENT_ID,
    name: DEFAULT_AGENT_NAME,
    default: true,
    workspaceId,
    workspace,
    identity: {
      name: DEFAULT_AGENT_NAME,
      emoji: "🤖",
      theme: "Workspace Assistant",
    },
    tools: { profile: "full" },
    model: modelRef,
  };
}

function ensureWorkspaceDefaults(workspaceId, config, globalPrimaryModel) {
  const next = isRecord(config) ? config : {};
  ensureMeta(next);

  next.session = isRecord(next.session) ? next.session : {};
  if (!trimToNull(next.session.store)) {
    next.session.store = `~/.openclaw/workspaces/${workspaceId}/agents/{agentId}/sessions/sessions.json`;
  }

  next.agents = isRecord(next.agents) ? next.agents : {};
  next.agents.defaults = isRecord(next.agents.defaults) ? next.agents.defaults : {};
  const defaults = next.agents.defaults;
  const primaryModelRef = normalizeModelRef(
    trimToNull(defaults.model?.primary) || trimToNull(globalPrimaryModel) || DEFAULT_MODEL_REF,
  );

  if (!trimToNull(defaults.workspace)) {
    defaults.workspace = `~/.openclaw/workspaces/${workspaceId}/${DEFAULT_AGENT_ID}`;
  }
  if (!trimToNull(defaults.thinkingDefault)) {
    defaults.thinkingDefault = "low";
  }

  defaults.model = isRecord(defaults.model) ? defaults.model : {};
  defaults.model.primary = primaryModelRef;
  if (!Array.isArray(defaults.model.fallbacks)) {
    defaults.model.fallbacks = [];
  }

  defaults.models = isRecord(defaults.models) ? defaults.models : {};
  if (!isRecord(defaults.models[primaryModelRef])) {
    defaults.models[primaryModelRef] = { alias: "MiniMax M2.5 (Free)" };
  }

  defaults.subagents = isRecord(defaults.subagents) ? defaults.subagents : {};
  if (!trimToNull(defaults.subagents.model)) {
    defaults.subagents.model = primaryModelRef;
  }
  if (!trimToNull(defaults.subagents.thinking)) {
    defaults.subagents.thinking = "low";
  }
  if (typeof defaults.subagents.maxConcurrent !== "number") {
    defaults.subagents.maxConcurrent = 4;
  }
  if (typeof defaults.subagents.archiveAfterMinutes !== "number") {
    defaults.subagents.archiveAfterMinutes = 30;
  }

  defaults.memorySearch = isRecord(defaults.memorySearch) ? defaults.memorySearch : {};
  const memorySearch = defaults.memorySearch;
  if (typeof memorySearch.enabled !== "boolean") {
    memorySearch.enabled = true;
  }
  memorySearch.experimental = isRecord(memorySearch.experimental) ? memorySearch.experimental : {};
  if (typeof memorySearch.experimental.sessionMemory !== "boolean") {
    memorySearch.experimental.sessionMemory = true;
  }
  if (!Array.isArray(memorySearch.sources) || memorySearch.sources.length === 0) {
    memorySearch.sources = ["memory", "sessions"];
  }
  memorySearch.sync = isRecord(memorySearch.sync) ? memorySearch.sync : {};
  if (typeof memorySearch.sync.onSessionStart !== "boolean") {
    memorySearch.sync.onSessionStart = true;
  }
  if (typeof memorySearch.sync.onSearch !== "boolean") {
    memorySearch.sync.onSearch = true;
  }
  if (typeof memorySearch.sync.watch !== "boolean") {
    memorySearch.sync.watch = true;
  }
  memorySearch.store = isRecord(memorySearch.store) ? memorySearch.store : {};
  if (!trimToNull(memorySearch.store.path)) {
    memorySearch.store.path = `~/.openclaw/workspaces/${workspaceId}/agents/{agentId}/memory/memory.db`;
  }

  const list = Array.isArray(next.agents.list) ? next.agents.list : [];
  if (list.length === 0) {
    next.agents.list = [buildStarterAgent(workspaceId, primaryModelRef)];
    return next;
  }

  next.agents.list = list.map((entry) => {
    if (!isRecord(entry)) {
      return entry;
    }
    const nextEntry = { ...entry };
    if (!trimToNull(nextEntry.workspaceId)) {
      nextEntry.workspaceId = workspaceId;
    }
    if (!trimToNull(nextEntry.workspace)) {
      nextEntry.workspace = `~/.openclaw/workspaces/${workspaceId}/${nextEntry.id || DEFAULT_AGENT_ID}`;
    }
    if (trimToNull(nextEntry.model)) {
      nextEntry.model = normalizeModelRef(nextEntry.model);
    } else {
      nextEntry.model = primaryModelRef;
    }
    return nextEntry;
  });

  return next;
}

async function syncRepoSkills() {
  if (!(await exists(REPO_SKILLS_DIR))) {
    return 0;
  }
  await ensureDir(MANAGED_SKILLS_DIR);
  const entries = await fs.readdir(REPO_SKILLS_DIR, { withFileTypes: true });
  let synced = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourceDir = path.join(REPO_SKILLS_DIR, entry.name);
    if (!(await exists(path.join(sourceDir, "SKILL.md")))) {
      continue;
    }
    const targetDir = path.join(MANAGED_SKILLS_DIR, entry.name);
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
    synced += 1;
  }

  return synced;
}

async function primeMcporterConfig() {
  const current = (await readJson(MCPORTER_CONFIG_PATH)) ?? {};
  const next = isRecord(current) ? { ...current } : {};
  next.figma = isRecord(next.figma) ? { ...next.figma } : {};
  if (!trimToNull(next.figma.baseUrl)) {
    next.figma.baseUrl = "https://mcp.figma.com/mcp";
  }
  return await writeJson(MCPORTER_CONFIG_PATH, next);
}

async function primeGlobalConfig() {
  const current = await readJson(GLOBAL_CONFIG_PATH);
  const next = ensureGlobalDefaults(current);
  const changed = await writeJson(GLOBAL_CONFIG_PATH, next);
  return {
    changed,
    primaryModel: next.agents?.defaults?.model?.primary || DEFAULT_MODEL_REF,
  };
}

async function primeWorkspaceConfigs(globalPrimaryModel) {
  if (!(await exists(WORKSPACES_DIR))) {
    return { changed: 0, total: 0 };
  }

  const entries = await fs.readdir(WORKSPACES_DIR, { withFileTypes: true });
  let changed = 0;
  let total = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    total += 1;
    const workspaceId = entry.name;
    const workspaceConfigPath = path.join(WORKSPACES_DIR, workspaceId, "config.json");
    const current = await readJson(workspaceConfigPath);
    const next = ensureWorkspaceDefaults(workspaceId, current, globalPrimaryModel);
    if (await writeJson(workspaceConfigPath, next)) {
      changed += 1;
    }
  }

  return { changed, total };
}

async function main() {
  await ensureDir(STATE_DIR);
  await ensureDir(MCPORTER_STATE_DIR);

  const { changed: globalChanged, primaryModel } = await primeGlobalConfig();
  const workspaceResult = await primeWorkspaceConfigs(primaryModel);
  const syncedSkills = await syncRepoSkills();
  const mcporterChanged = await primeMcporterConfig();

  console.log(
    `[pmos-prime] global=${globalChanged ? "updated" : "ok"} workspaces=${workspaceResult.changed}/${workspaceResult.total} skills=${syncedSkills} mcporter=${mcporterChanged ? "updated" : "ok"}`,
  );
}

main().catch((error) => {
  console.error("[pmos-prime] failed:", error);
  process.exitCode = 1;
});
