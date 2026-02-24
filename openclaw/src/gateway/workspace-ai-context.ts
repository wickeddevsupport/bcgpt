import fs from "node:fs/promises";
import path from "node:path";
import { listKeys, type AIProvider } from "./byok-store.js";
import { loadEffectiveWorkspaceConfig, readWorkspaceConfig } from "./workspace-config.js";
import { readWorkspaceConnectors, type WorkspaceConnectors } from "./workspace-connectors.js";
import { CONFIG_DIR, ensureDir } from "../utils.js";

type JsonObject = Record<string, unknown>;

export type WorkspaceAiCredential = {
  id: string;
  name: string;
  type: string;
};

type WorkspaceAiContextInput = {
  workspaceId: string;
  generatedAt: string;
  workspaceConfig: JsonObject;
  effectiveConfig: JsonObject;
  connectors: WorkspaceConnectors | null;
  byokKeys: Array<{
    provider: AIProvider;
    label: string;
    defaultModel?: string;
    validated?: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  credentials: WorkspaceAiCredential[];
};

export type RefreshWorkspaceAiContextOptions = {
  credentials?: WorkspaceAiCredential[];
  includeLiveCredentials?: boolean;
};

const WORKSPACE_AI_CONTEXT_FILENAME = "AI_CONTEXT.md";
const DEFAULT_PROMPT_CONTEXT_MAX_CHARS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getPath(source: unknown, pathParts: string[]): unknown {
  let current: unknown = source;
  for (const part of pathParts) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasConfiguredLeaf(value: unknown, depth = 0): boolean {
  if (depth > 6) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasConfiguredLeaf(entry, depth + 1));
  }
  if (isRecord(value)) {
    return Object.values(value).some((entry) => hasConfiguredLeaf(entry, depth + 1));
  }
  return false;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function normalizeModelRef(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  const slashIndex = raw.indexOf("/");
  if (slashIndex <= 0 || slashIndex === raw.length - 1) {
    return null;
  }
  const provider = raw.slice(0, slashIndex).trim().toLowerCase();
  const modelId = raw.slice(slashIndex + 1).trim().replace(/^\/+/, "");
  if (!provider || !modelId) {
    return null;
  }
  return `${provider}/${modelId}`;
}

function collectProviderKeysWithApiKey(effectiveConfig: JsonObject): string[] {
  const providers = getPath(effectiveConfig, ["models", "providers"]);
  if (!isRecord(providers)) {
    return [];
  }
  const out: string[] = [];
  for (const [providerKey, entry] of Object.entries(providers)) {
    if (!isRecord(entry)) {
      continue;
    }
    const apiKey = asNonEmptyString(entry.apiKey);
    if (apiKey) {
      out.push(providerKey.trim().toLowerCase());
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function collectAllowedModelRefs(effectiveConfig: JsonObject): string[] {
  const out = new Set<string>();
  const addRef = (value: unknown) => {
    const ref = normalizeModelRef(value);
    if (ref) {
      out.add(ref);
    }
  };

  addRef(getPath(effectiveConfig, ["agents", "defaults", "model", "primary"]));

  const fallbacks = getPath(effectiveConfig, ["agents", "defaults", "model", "fallbacks"]);
  if (Array.isArray(fallbacks)) {
    for (const entry of fallbacks) {
      addRef(entry);
    }
  }

  const models = getPath(effectiveConfig, ["agents", "defaults", "models"]);
  if (isRecord(models)) {
    for (const key of Object.keys(models)) {
      addRef(key);
    }
  }

  const agents = getPath(effectiveConfig, ["agents", "list"]);
  if (Array.isArray(agents)) {
    for (const entry of agents) {
      if (!isRecord(entry)) {
        continue;
      }
      const model = entry.model;
      if (typeof model === "string") {
        addRef(model);
      } else if (isRecord(model)) {
        addRef(model.primary);
        if (Array.isArray(model.fallbacks)) {
          for (const fallback of model.fallbacks) {
            addRef(fallback);
          }
        }
      }
    }
  }

  return [...out].sort((a, b) => a.localeCompare(b));
}

type AgentSummary = {
  id: string;
  name: string;
  modelRef: string | null;
  workspace: string | null;
  workspaceScoped: boolean;
  isDefault: boolean;
};

function resolveAgentModelRef(entry: Record<string, unknown>): string | null {
  const model = entry.model;
  if (typeof model === "string") {
    return normalizeModelRef(model);
  }
  if (isRecord(model)) {
    return normalizeModelRef(model.primary);
  }
  return null;
}

function resolveAgentName(entry: Record<string, unknown>, fallbackId: string): string {
  const name = asNonEmptyString(entry.name);
  if (name) {
    return name;
  }
  const identity = isRecord(entry.identity) ? entry.identity : null;
  const identityName = identity ? asNonEmptyString(identity.name) : null;
  if (identityName) {
    return identityName;
  }
  return fallbackId;
}

function collectAgentSummaries(effectiveConfig: JsonObject, workspaceId: string): AgentSummary[] {
  const list = getPath(effectiveConfig, ["agents", "list"]);
  if (!Array.isArray(list)) {
    return [];
  }

  const workspaceAgents: AgentSummary[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = asNonEmptyString(entry.id);
    if (!id) {
      continue;
    }
    const entryWorkspace = asNonEmptyString(entry.workspaceId);
    if (entryWorkspace && entryWorkspace !== workspaceId) {
      continue;
    }
    workspaceAgents.push({
      id,
      name: resolveAgentName(entry, id),
      modelRef: resolveAgentModelRef(entry),
      workspace: asNonEmptyString(entry.workspace),
      workspaceScoped: Boolean(entryWorkspace),
      isDefault: entry.default === true,
    });
  }

  if (!workspaceAgents.length) {
    return [];
  }

  if (!workspaceAgents.some((entry) => entry.isDefault)) {
    workspaceAgents[0]!.isDefault = true;
  }
  return workspaceAgents;
}

function describeConnectorSection(connectors: WorkspaceConnectors | null): string {
  const raw = isRecord(connectors) ? connectors : {};

  const ops = isRecord(raw.ops) ? raw.ops : {};
  const opsUrl = asNonEmptyString(ops.url);
  const opsApiKeySet = Boolean(asNonEmptyString(ops.apiKey));
  const opsProjectId = asNonEmptyString(ops.projectId);
  const opsUser = isRecord(ops.user) ? ops.user : {};
  const opsUserEmail = asNonEmptyString(opsUser.email);
  const opsUserPasswordSet = Boolean(asNonEmptyString(opsUser.password));

  const bcgpt = isRecord(raw.bcgpt) ? raw.bcgpt : {};
  const bcgptUrl = asNonEmptyString(bcgpt.url);
  const bcgptApiKeySet = Boolean(asNonEmptyString(bcgpt.apiKey));

  const extraConnectorKeys = Object.keys(raw)
    .filter((key) => key !== "ops" && key !== "bcgpt")
    .sort((a, b) => a.localeCompare(b));

  const extraLines = extraConnectorKeys.map((key) => {
    const entry = raw[key];
    return `- ${key}: configured=${yesNo(hasConfiguredLeaf(entry))}`;
  });

  return [
    "## Connector Status",
    `- ops configured: ${yesNo(Boolean(opsUrl || opsApiKeySet || opsProjectId || opsUserEmail || opsUserPasswordSet))}`,
    `- ops url: ${opsUrl ?? "(not set)"}`,
    `- ops apiKey present: ${yesNo(opsApiKeySet)}`,
    `- ops projectId: ${opsProjectId ?? "(not set)"}`,
    `- ops user email: ${opsUserEmail ?? "(not set)"}`,
    `- ops user password present: ${yesNo(opsUserPasswordSet)}`,
    `- basecamp connector configured: ${yesNo(Boolean(bcgptUrl || bcgptApiKeySet))}`,
    `- basecamp url: ${bcgptUrl ?? "(not set)"}`,
    `- basecamp apiKey present: ${yesNo(bcgptApiKeySet)}`,
    extraLines.length > 0 ? "### Additional connectors" : "",
    ...extraLines,
  ]
    .filter(Boolean)
    .join("\n");
}

function describeModelSection(input: {
  effectiveConfig: JsonObject;
  byokKeys: WorkspaceAiContextInput["byokKeys"];
}): string {
  const primary = normalizeModelRef(
    getPath(input.effectiveConfig, ["agents", "defaults", "model", "primary"]),
  );

  const fallbackRefsRaw = getPath(input.effectiveConfig, ["agents", "defaults", "model", "fallbacks"]);
  const fallbackRefs = Array.isArray(fallbackRefsRaw)
    ? fallbackRefsRaw
        .map((entry) => normalizeModelRef(entry))
        .filter((entry): entry is string => Boolean(entry))
    : [];

  const allowedRefs = collectAllowedModelRefs(input.effectiveConfig);
  const providersWithConfigKey = collectProviderKeysWithApiKey(input.effectiveConfig);
  const byokProviders = input.byokKeys
    .map((entry) => entry.provider)
    .sort((a, b) => a.localeCompare(b));

  return [
    "## Model Configuration",
    `- primary model: ${primary ?? "(not set)"}`,
    `- fallback models: ${fallbackRefs.length ? fallbackRefs.join(", ") : "(none)"}`,
    `- allowed/saved model refs: ${allowedRefs.length ? allowedRefs.join(", ") : "(none)"}`,
    `- providers with apiKey in effective config: ${providersWithConfigKey.length ? providersWithConfigKey.join(", ") : "(none)"}`,
    `- providers with BYOK key in workspace: ${byokProviders.length ? byokProviders.join(", ") : "(none)"}`,
  ].join("\n");
}

function describeByokSection(keys: WorkspaceAiContextInput["byokKeys"]): string {
  if (!keys.length) {
    return ["## BYOK Keys", "- none"].join("\n");
  }
  const lines = keys
    .slice()
    .sort((a, b) => a.provider.localeCompare(b.provider))
    .map((entry) => {
      const defaultModel = entry.defaultModel?.trim() ? entry.defaultModel.trim() : "(none)";
      return `- ${entry.provider}: validated=${yesNo(entry.validated === true)}, defaultModel=${defaultModel}, label=${entry.label}`;
    });
  return ["## BYOK Keys", ...lines].join("\n");
}

function describeAgentSection(input: {
  effectiveConfig: JsonObject;
  workspaceId: string;
}): string {
  const agents = collectAgentSummaries(input.effectiveConfig, input.workspaceId);
  if (!agents.length) {
    return ["## Agent Assignments", "- no workspace agents configured"].join("\n");
  }

  const lines = agents.map((agent) => {
    const workspaceDisplay = agent.workspace ?? "(default workspace)";
    return `- ${agent.id} (${agent.name}): model=${agent.modelRef ?? "(inherits default)"}, workspace=${workspaceDisplay}, workspaceScoped=${yesNo(agent.workspaceScoped)}, default=${yesNo(agent.isDefault)}`;
  });
  return ["## Agent Assignments", ...lines].join("\n");
}

function describeCredentialSection(credentials: WorkspaceAiCredential[]): string {
  if (!credentials.length) {
    return ["## n8n Credential Inventory", "- no credentials discovered"].join("\n");
  }

  const sorted = credentials
    .slice()
    .sort((a, b) => `${a.type}/${a.name}`.localeCompare(`${b.type}/${b.name}`));
  const top = sorted.slice(0, 40);
  const lines = top.map((cred) => `- ${cred.name} (type=${cred.type}, id=${cred.id})`);
  if (sorted.length > top.length) {
    lines.push(`- ... plus ${sorted.length - top.length} more`);
  }
  return ["## n8n Credential Inventory", ...lines].join("\n");
}

function describeWorkspaceConfigSection(input: {
  workspaceConfig: JsonObject;
  effectiveConfig: JsonObject;
}): string {
  const workspaceTopLevelKeys = Object.keys(input.workspaceConfig).sort((a, b) => a.localeCompare(b));
  const effectiveTopLevelKeys = Object.keys(input.effectiveConfig).sort((a, b) => a.localeCompare(b));

  return [
    "## Workspace Config Summary",
    `- workspace config top-level keys: ${workspaceTopLevelKeys.length ? workspaceTopLevelKeys.join(", ") : "(none)"}`,
    `- effective config top-level keys: ${effectiveTopLevelKeys.length ? effectiveTopLevelKeys.join(", ") : "(none)"}`,
    "- source of truth: global openclaw.json merged with workspace config plus workspace connectors/BYOK for secrets.",
  ].join("\n");
}

function describeCapabilitySection(): string {
  return [
    "## PMOS Surface and Capabilities",
    "- Chat panel: ask, run tasks, and automate actions with workspace-scoped agents.",
    "- Workflows panel: create, update, activate, and execute n8n workflows.",
    "- Connections panel: inspect and manage available n8n credentials.",
    "- Integrations panel: configure model providers, connector settings, and Basecamp/BCGPT access.",
    "- Projects panel: summarize Basecamp project state and urgent work via BCGPT tools.",
    "- Agents/Models/Skills/Nodes: manage automation agents, model assignment, and enabled tooling.",
    "- Control pages: overview/channels/instances/sessions/usage/cron operations for the workspace.",
    "- Settings pages: inspect config/debug/logs and diagnose workspace issues.",
  ].join("\n");
}

function describeAssistantPolicySection(): string {
  return [
    "## Assistant Policy",
    "- Treat this snapshot and the live node catalog as authoritative.",
    "- Do not ask the user to paste keys that are already marked as present.",
    "- If required connector or key is missing, report exactly what is missing and where to configure it.",
    "- Prefer deterministic, executable workflows with explicit branching/merge nodes when complexity requires it.",
    "- Use workspace-scoped credentials and avoid cross-workspace assumptions.",
  ].join("\n");
}

export function buildWorkspaceAiContextMarkdown(input: WorkspaceAiContextInput): string {
  return [
    "# PMOS Workspace AI Context",
    `Generated at: ${input.generatedAt}`,
    `Workspace ID: ${input.workspaceId}`,
    "",
    describeWorkspaceConfigSection({
      workspaceConfig: input.workspaceConfig,
      effectiveConfig: input.effectiveConfig,
    }),
    "",
    describeConnectorSection(input.connectors),
    "",
    describeModelSection({
      effectiveConfig: input.effectiveConfig,
      byokKeys: input.byokKeys,
    }),
    "",
    describeByokSection(input.byokKeys),
    "",
    describeAgentSection({
      effectiveConfig: input.effectiveConfig,
      workspaceId: input.workspaceId,
    }),
    "",
    describeCredentialSection(input.credentials),
    "",
    describeCapabilitySection(),
    "",
    describeAssistantPolicySection(),
  ].join("\n");
}

export function workspaceAiContextPath(workspaceId: string): string {
  const safe = String(workspaceId).trim() || "default";
  return path.join(CONFIG_DIR, "workspaces", safe, WORKSPACE_AI_CONTEXT_FILENAME);
}

export async function readWorkspaceAiContext(workspaceId: string): Promise<string | null> {
  const p = workspaceAiContextPath(workspaceId);
  try {
    const raw = await fs.readFile(p, "utf-8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export async function refreshWorkspaceAiContext(
  workspaceId: string,
  opts: RefreshWorkspaceAiContextOptions = {},
): Promise<{ workspaceId: string; path: string; markdown: string; generatedAt: string }> {
  const wsId = String(workspaceId).trim() || "default";
  const [workspaceConfigRaw, effectiveConfigRaw, connectors, byokKeys] = await Promise.all([
    readWorkspaceConfig(wsId),
    loadEffectiveWorkspaceConfig(wsId),
    readWorkspaceConnectors(wsId),
    listKeys(wsId),
  ]);

  let credentials = Array.isArray(opts.credentials) ? opts.credentials : [];
  if (credentials.length === 0 && opts.includeLiveCredentials) {
    try {
      const { fetchWorkspaceCredentials } = await import("./credential-sync.js");
      credentials = await fetchWorkspaceCredentials(wsId);
    } catch {
      credentials = [];
    }
  }

  const workspaceConfig = isRecord(workspaceConfigRaw) ? workspaceConfigRaw : {};
  const effectiveConfig = isRecord(effectiveConfigRaw) ? effectiveConfigRaw : {};
  const generatedAt = new Date().toISOString();
  const markdown = buildWorkspaceAiContextMarkdown({
    workspaceId: wsId,
    generatedAt,
    workspaceConfig,
    effectiveConfig,
    connectors,
    byokKeys,
    credentials,
  });

  const p = workspaceAiContextPath(wsId);
  await ensureDir(path.dirname(p));
  const raw = markdown.trimEnd().concat("\n");
  await fs.writeFile(p, raw, "utf-8");

  return {
    workspaceId: wsId,
    path: p,
    markdown,
    generatedAt,
  };
}

export async function getWorkspaceAiContextForPrompt(
  workspaceId: string,
  opts: RefreshWorkspaceAiContextOptions & {
    ensureFresh?: boolean;
    maxChars?: number;
  } = {},
): Promise<string> {
  const wsId = String(workspaceId).trim() || "default";
  let markdown = "";

  if (opts.ensureFresh) {
    try {
      const refreshed = await refreshWorkspaceAiContext(wsId, {
        credentials: opts.credentials,
        includeLiveCredentials: opts.includeLiveCredentials,
      });
      markdown = refreshed.markdown;
    } catch {
      markdown = "";
    }
  }

  if (!markdown) {
    markdown = (await readWorkspaceAiContext(wsId)) ?? "";
  }
  const trimmed = markdown.trim();
  if (!trimmed) {
    return "";
  }

  const maxChars = Number.isFinite(opts.maxChars)
    ? Math.max(500, Math.floor(opts.maxChars as number))
    : DEFAULT_PROMPT_CONTEXT_MAX_CHARS;
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars).trimEnd()}\n\n[workspace ai context truncated]`;
}
