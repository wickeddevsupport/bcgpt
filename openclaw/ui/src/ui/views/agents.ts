import { html, nothing } from "lit";
import {
  AGENT_ARCHETYPES,
  DIVISION_META,
  getArchetypeById,
  renderCatalogBrowser,
} from "./agents-catalog.ts";
import type {
  AgentFileEntry,
  AgentsFilesListResult,
  AgentsListResult,
  AgentIdentityResult,
  ChannelAccountSnapshot,
  ChannelsStatusSnapshot,
  CronJob,
  CronStatus,
  SkillStatusEntry,
  SkillStatusReport,
} from "../types.ts";
import {
  expandToolGroups,
  normalizeToolName,
  resolveToolProfilePolicy,
} from "../../../../src/agents/tool-policy.js";
import { formatRelativeTimestamp } from "../format.ts";
import {
  formatCronPayload,
  formatCronSchedule,
  formatCronState,
  formatNextRun,
} from "../presenter.ts";
import { DEFAULT_AGENT_WORKSPACE_PATH } from "../app-defaults.ts";

// Agent mode types for business-friendly UI
export type AgentMode = "autonomous" | "interactive" | "hybrid";
export type AgentPersonality = "professional" | "friendly" | "technical" | "custom";
export type CreateAgentModalMode = "create" | "edit";

export type CreateAgentFormData = {
  name: string;
  id: string;
  purpose: string;
  workspace: string;
  emoji: string;
  theme: string;
  mode: AgentMode;
  model: string;
  skills: string[];
  personality: AgentPersonality;
  autonomousTasks: string[];
  archetypeId: string;
  soulContent: string;
};

export type CreateAgentModalProps = {
  open: boolean;
  step: 0 | 1 | 2 | 3;
  formData: CreateAgentFormData;
  loading: boolean;
  error: string | null;
  availableModels: string[];
  configuredProviders: string[];  // Providers with API keys in BYOK
  availableSkills: string[];
  onCancel: () => void;
  onSubmit: () => void;
  onStepChange: (step: 0 | 1 | 2 | 3) => void;
  onFieldChange: <K extends keyof CreateAgentFormData>(field: K, value: CreateAgentFormData[K]) => void;
};

// Autonomous task options for the modal
const AUTONOMOUS_TASK_OPTIONS = [
  { id: "check-leads", label: "Check for new leads" },
  { id: "qualify-leads", label: "Qualify leads automatically" },
  { id: "notify-hot-leads", label: "Notify on hot leads" },
  { id: "auto-follow-ups", label: "Auto-send follow-ups" },
];

// Default skill options for the modal
const DEFAULT_SKILL_OPTIONS = [
  { id: "basecamp", label: "Basecamp" },
  { id: "github", label: "GitHub" },
  { id: "slack", label: "Slack" },
  { id: "email", label: "Email" },
  { id: "calendar", label: "Calendar" },
  { id: "terminal", label: "Terminal" },
  { id: "knowledge", label: "Knowledge" },
  { id: "reports", label: "Reports" },
];

const AGENT_EMOJI_OPTIONS = [
  { value: "🤖", label: "Robot" },
  { value: "🧠", label: "Brain" },
  { value: "⚡", label: "Lightning" },
  { value: "🛠️", label: "Tools" },
  { value: "📊", label: "Analytics" },
  { value: "📈", label: "Growth" },
  { value: "💼", label: "Business" },
  { value: "🧾", label: "Ops" },
  { value: "📣", label: "Marketing" },
  { value: "🎯", label: "Target" },
  { value: "💬", label: "Chat" },
  { value: "📨", label: "Inbox" },
  { value: "🔎", label: "Research" },
  { value: "🧪", label: "Testing" },
  { value: "🧩", label: "Workflow" },
  { value: "🚀", label: "Launch" },
  { value: "🛡️", label: "Guard" },
  { value: "📝", label: "Writer" },
  { value: "🎨", label: "Design" },
  { value: "💻", label: "Developer" },
] as const;

// Default form state
export const DEFAULT_CREATE_AGENT_FORM: CreateAgentFormData = {
  name: "",
  id: "",
  purpose: "",
  workspace: DEFAULT_AGENT_WORKSPACE_PATH,
  emoji: "🤖",
  theme: "",
  mode: "autonomous",
  model: "",
  skills: [],
  personality: "professional",
  autonomousTasks: [],
  archetypeId: "",
  soulContent: "",
};

export type AgentsPanel = "overview" | "files" | "tools" | "skills" | "channels" | "cron";

export type AgentActivitySummary = {
  tasksRunning: number;
  tasksQueued: number;
  lastActivityAt: number | null;
  status: "active" | "paused" | "idle" | "error";
};

export type AgentsProps = {
  // Modal state
  createModalOpen: boolean;
  createModalMode: CreateAgentModalMode;
  createModalEditAgentId: string | null;
  createModalStep: 0 | 1 | 2 | 3;
  createModalLoading: boolean;
  createModalError: string | null;
  createModalFormData: CreateAgentFormData;
  availableModels: string[];
  configuredProviders: string[];  // Providers with API keys in BYOK store
  availableSkills: string[];
  workspaceLocked?: boolean;
  // Catalog browser state
  catalogDivision: string;
  catalogSearch: string;
  catalogPreviewArchetypeId: string | null;
  catalogPreviewSoulContent: string;
  catalogPreviewLoading: boolean;
  catalogPreviewError: string | null;
  onCreateModalOpen: () => void;
  onCreateModalCancel: () => void;
  onCreateModalStepChange: (step: 0 | 1 | 2 | 3) => void;
  onSelectArchetype: (archetype: import("./agents-catalog.ts").AgentArchetype) => void;
  onPreviewArchetype: (archetype: import("./agents-catalog.ts").AgentArchetype | null) => void;
  onStartFromScratch: () => void;
  onCatalogDivisionChange: (division: string) => void;
  onCatalogSearchChange: (query: string) => void;
  onCreateModalSubmit: () => void;
  onCreateModalFieldChange: <K extends keyof CreateAgentFormData>(
    field: K,
    value: CreateAgentFormData[K],
  ) => void;
  onOpenModelsTab: () => void;
  // Agent activity summaries by ID
  agentActivityById: Record<string, AgentActivitySummary>;
  // Chat integration
  onOpenAgentChat: (agentId: string) => void;
  onPauseAgent: (agentId: string) => void;
  onViewAgentLogs: (agentId: string) => void;
  onEditAgent: (agentId: string) => void;
  onDeleteAgent: (agentId: string) => void;
  loading: boolean;
  error: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  activePanel: AgentsPanel;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  channelsLoading: boolean;
  channelsError: string | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsLastSuccess: number | null;
  cronLoading: boolean;
  cronStatus: CronStatus | null;
  cronJobs: CronJob[];
  cronError: string | null;
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileActive: string | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileSaving: boolean;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkillsLoading: boolean;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsError: string | null;
  agentSkillsAgentId: string | null;
  skillsFilter: string;
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPanel: (panel: AgentsPanel) => void;
  onLoadFiles: (agentId: string) => void;
  onSelectFile: (name: string) => void;
  onFileDraftChange: (name: string, content: string) => void;
  onFileReset: (name: string) => void;
  onFileSave: (name: string) => void;
  onToolsProfileChange: (agentId: string, profile: string | null, clearAllow: boolean) => void;
  onToolsOverridesChange: (agentId: string, alsoAllow: string[], deny: string[]) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onChannelsRefresh: () => void;
  onCronRefresh: () => void;
  onSkillsFilterChange: (next: string) => void;
  onSkillsRefresh: () => void;
  onAgentSkillToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  onAgentSkillsClear: (agentId: string) => void;
  onAgentSkillsDisableAll: (agentId: string) => void;
};

const TOOL_SECTIONS = [
  {
    id: "fs",
    label: "Files",
    tools: [
      { id: "read", label: "read", description: "Read file contents" },
      { id: "write", label: "write", description: "Create or overwrite files" },
      { id: "edit", label: "edit", description: "Make precise edits" },
      { id: "apply_patch", label: "apply_patch", description: "Patch files (OpenAI)" },
    ],
  },
  {
    id: "runtime",
    label: "Runtime",
    tools: [
      { id: "exec", label: "exec", description: "Run shell commands" },
      { id: "process", label: "process", description: "Manage background processes" },
    ],
  },
  {
    id: "web",
    label: "Web",
    tools: [
      { id: "web_search", label: "web_search", description: "Search the web" },
      { id: "web_fetch", label: "web_fetch", description: "Fetch web content" },
    ],
  },
  {
    id: "memory",
    label: "Memory",
    tools: [
      { id: "memory_search", label: "memory_search", description: "Semantic search" },
      { id: "memory_get", label: "memory_get", description: "Read memory files" },
    ],
  },
  {
    id: "sessions",
    label: "Sessions",
    tools: [
      { id: "sessions_list", label: "sessions_list", description: "List sessions" },
      { id: "sessions_history", label: "sessions_history", description: "Session history" },
      { id: "sessions_send", label: "sessions_send", description: "Send to session" },
      { id: "sessions_spawn", label: "sessions_spawn", description: "Spawn sub-agent" },
      { id: "session_status", label: "session_status", description: "Session status" },
    ],
  },
  {
    id: "ui",
    label: "UI",
    tools: [
      { id: "browser", label: "browser", description: "Control web browser" },
      { id: "canvas", label: "canvas", description: "Control canvases" },
    ],
  },
  {
    id: "messaging",
    label: "Messaging",
    tools: [{ id: "message", label: "message", description: "Send messages" }],
  },
  {
    id: "automation",
    label: "Automation",
    tools: [
      { id: "cron", label: "cron", description: "Schedule tasks" },
      { id: "gateway", label: "gateway", description: "Gateway control" },
    ],
  },
  {
    id: "nodes",
    label: "Nodes",
    tools: [{ id: "nodes", label: "nodes", description: "Nodes + devices" }],
  },
  {
    id: "agents",
    label: "Agents",
    tools: [{ id: "agents_list", label: "agents_list", description: "List agents" }],
  },
  {
    id: "media",
    label: "Media",
    tools: [{ id: "image", label: "image", description: "Image understanding" }],
  },
];

const PROFILE_OPTIONS = [
  { id: "minimal", label: "Minimal" },
  { id: "coding", label: "Coding" },
  { id: "messaging", label: "Messaging" },
  { id: "full", label: "Full" },
] as const;

type ToolPolicy = {
  allow?: string[];
  deny?: string[];
};

type AgentConfigEntry = {
  id: string;
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: unknown;
  skills?: string[];
  tools?: {
    profile?: string;
    allow?: string[];
    alsoAllow?: string[];
    deny?: string[];
  };
};

type ConfigSnapshot = {
  agents?: {
    defaults?: { workspace?: string; model?: unknown; models?: Record<string, { alias?: string }> };
    list?: AgentConfigEntry[];
  };
  tools?: {
    profile?: string;
    allow?: string[];
    alsoAllow?: string[];
    deny?: string[];
  };
};

function normalizeAgentLabel(agent: { id: string; name?: string; identity?: { name?: string } }) {
  return agent.name?.trim() || agent.identity?.name?.trim() || agent.id;
}

function isLikelyEmoji(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.length > 16) {
    return false;
  }
  let hasNonAscii = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) > 127) {
      hasNonAscii = true;
      break;
    }
  }
  if (!hasNonAscii) {
    return false;
  }
  if (trimmed.includes("://") || trimmed.includes("/") || trimmed.includes(".")) {
    return false;
  }
  return true;
}

function resolveAgentEmoji(
  agent: { identity?: { emoji?: string; avatar?: string } },
  agentIdentity?: AgentIdentityResult | null,
) {
  const identityEmoji = agentIdentity?.emoji?.trim();
  if (identityEmoji && isLikelyEmoji(identityEmoji)) {
    return identityEmoji;
  }
  const agentEmoji = agent.identity?.emoji?.trim();
  if (agentEmoji && isLikelyEmoji(agentEmoji)) {
    return agentEmoji;
  }
  const identityAvatar = agentIdentity?.avatar?.trim();
  if (identityAvatar && isLikelyEmoji(identityAvatar)) {
    return identityAvatar;
  }
  const avatar = agent.identity?.avatar?.trim();
  if (avatar && isLikelyEmoji(avatar)) {
    return avatar;
  }
  return "";
}

function agentBadgeText(agentId: string, defaultId: string | null) {
  return defaultId && agentId === defaultId ? "default" : null;
}

function formatBytes(bytes?: number) {
  if (bytes == null || !Number.isFinite(bytes)) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function resolveAgentConfig(config: Record<string, unknown> | null, agentId: string) {
  const cfg = config as ConfigSnapshot | null;
  const list = cfg?.agents?.list ?? [];
  const entry = list.find((agent) => agent?.id === agentId);
  return {
    entry,
    defaults: cfg?.agents?.defaults,
    globalTools: cfg?.tools,
  };
}

type AgentContext = {
  workspace: string;
  model: string;
  identityName: string;
  identityEmoji: string;
  skillsLabel: string;
  isDefault: boolean;
};

function buildAgentContext(
  agent: AgentsListResult["agents"][number],
  configForm: Record<string, unknown> | null,
  agentFilesList: AgentsFilesListResult | null,
  defaultId: string | null,
  agentIdentity?: AgentIdentityResult | null,
): AgentContext {
  const config = resolveAgentConfig(configForm, agent.id);
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles ||
    config.entry?.workspace ||
    config.defaults?.workspace ||
    DEFAULT_AGENT_WORKSPACE_PATH;
  const modelLabel = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : resolveModelLabel(config.defaults?.model);
  const identityName =
    agentIdentity?.name?.trim() ||
    agent.identity?.name?.trim() ||
    agent.name?.trim() ||
    config.entry?.name ||
    agent.id;
  const identityEmoji = resolveAgentEmoji(agent, agentIdentity) || "-";
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  return {
    workspace,
    model: modelLabel,
    identityName,
    identityEmoji,
    skillsLabel: skillFilter ? `${skillCount} selected` : "all skills",
    isDefault: Boolean(defaultId && agent.id === defaultId),
  };
}

function resolveModelLabel(model?: unknown): string {
  if (!model) {
    return "-";
  }
  if (typeof model === "string") {
    return model.trim() || "-";
  }
  if (typeof model === "object" && model) {
    const record = model as { primary?: string; fallbacks?: string[] };
    const primary = record.primary?.trim();
    if (primary) {
      const fallbackCount = Array.isArray(record.fallbacks) ? record.fallbacks.length : 0;
      return fallbackCount > 0 ? `${primary} (+${fallbackCount} fallback)` : primary;
    }
  }
  return "-";
}

function normalizeModelValue(label: string): string {
  const match = label.match(/^(.+) \(\+\d+ fallback\)$/);
  return match ? match[1] : label;
}

function resolveModelPrimary(model?: unknown): string | null {
  if (!model) {
    return null;
  }
  if (typeof model === "string") {
    const trimmed = model.trim();
    return trimmed || null;
  }
  if (typeof model === "object" && model) {
    const record = model as Record<string, unknown>;
    const candidate =
      typeof record.primary === "string"
        ? record.primary
        : typeof record.model === "string"
          ? record.model
          : typeof record.id === "string"
            ? record.id
            : typeof record.value === "string"
              ? record.value
              : null;
    const primary = candidate?.trim();
    return primary || null;
  }
  return null;
}

function resolveModelFallbacks(model?: unknown): string[] | null {
  if (!model || typeof model === "string") {
    return null;
  }
  if (typeof model === "object" && model) {
    const record = model as Record<string, unknown>;
    const fallbacks = Array.isArray(record.fallbacks)
      ? record.fallbacks
      : Array.isArray(record.fallback)
        ? record.fallback
        : null;
    return fallbacks
      ? fallbacks.filter((entry): entry is string => typeof entry === "string")
      : null;
  }
  return null;
}

function parseFallbackList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

type ConfiguredModelOption = {
  value: string;
  label: string;
};

function resolveConfiguredModels(
  configForm: Record<string, unknown> | null,
): ConfiguredModelOption[] {
  const cfg = configForm as ConfigSnapshot | null;
  const models = cfg?.agents?.defaults?.models;
  if (!models || typeof models !== "object") {
    return [];
  }
  const options: ConfiguredModelOption[] = [];
  for (const [modelId, modelRaw] of Object.entries(models)) {
    const trimmed = modelId.trim();
    if (!trimmed) {
      continue;
    }
    const alias =
      modelRaw && typeof modelRaw === "object" && "alias" in modelRaw
        ? typeof (modelRaw as { alias?: unknown }).alias === "string"
          ? (modelRaw as { alias?: string }).alias?.trim()
          : undefined
        : undefined;
    const label = alias && alias !== trimmed ? `${alias} (${trimmed})` : trimmed;
    options.push({ value: trimmed, label });
  }
  return options;
}

function buildModelOptions(configForm: Record<string, unknown> | null, current?: string | null) {
  const options = resolveConfiguredModels(configForm);
  const hasCurrent = current ? options.some((option) => option.value === current) : false;
  if (current && !hasCurrent) {
    options.unshift({ value: current, label: `Current (${current})` });
  }
  if (options.length === 0) {
    return html`
      <option value="" disabled>No configured models</option>
    `;
  }
  return options.map((option) => html`<option value=${option.value}>${option.label}</option>`);
}

type CompiledPattern =
  | { kind: "all" }
  | { kind: "exact"; value: string }
  | { kind: "regex"; value: RegExp };

function compilePattern(pattern: string): CompiledPattern {
  const normalized = normalizeToolName(pattern);
  if (!normalized) {
    return { kind: "exact", value: "" };
  }
  if (normalized === "*") {
    return { kind: "all" };
  }
  if (!normalized.includes("*")) {
    return { kind: "exact", value: normalized };
  }
  const escaped = normalized.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  return { kind: "regex", value: new RegExp(`^${escaped.replaceAll("\\*", ".*")}$`) };
}

function compilePatterns(patterns?: string[]): CompiledPattern[] {
  if (!Array.isArray(patterns)) {
    return [];
  }
  return expandToolGroups(patterns)
    .map(compilePattern)
    .filter((pattern) => {
      return pattern.kind !== "exact" || pattern.value.length > 0;
    });
}

function matchesAny(name: string, patterns: CompiledPattern[]) {
  for (const pattern of patterns) {
    if (pattern.kind === "all") {
      return true;
    }
    if (pattern.kind === "exact" && name === pattern.value) {
      return true;
    }
    if (pattern.kind === "regex" && pattern.value.test(name)) {
      return true;
    }
  }
  return false;
}

function isAllowedByPolicy(name: string, policy?: ToolPolicy) {
  if (!policy) {
    return true;
  }
  const normalized = normalizeToolName(name);
  const deny = compilePatterns(policy.deny);
  if (matchesAny(normalized, deny)) {
    return false;
  }
  const allow = compilePatterns(policy.allow);
  if (allow.length === 0) {
    return true;
  }
  if (matchesAny(normalized, allow)) {
    return true;
  }
  if (normalized === "apply_patch" && matchesAny("exec", allow)) {
    return true;
  }
  return false;
}

function matchesList(name: string, list?: string[]) {
  if (!Array.isArray(list) || list.length === 0) {
    return false;
  }
  const normalized = normalizeToolName(name);
  const patterns = compilePatterns(list);
  if (matchesAny(normalized, patterns)) {
    return true;
  }
  if (normalized === "apply_patch" && matchesAny("exec", patterns)) {
    return true;
  }
  return false;
}

export function renderAgents(props: AgentsProps) {
  const agents = props.agentsList?.agents ?? [];
  const defaultId = props.agentsList?.defaultId ?? null;
  const preferredSelectedId = props.selectedAgentId ?? defaultId ?? agents[0]?.id ?? null;
  const selectedAgent =
    (preferredSelectedId ? agents.find((agent) => agent.id === preferredSelectedId) : null) ??
    (defaultId ? agents.find((agent) => agent.id === defaultId) : null) ??
    agents[0] ??
    null;
  const selectedId = selectedAgent?.id ?? null;

  return html`
    ${props.createModalOpen ? renderCreateAgentModal(props) : nothing}
    <div class="agents-layout">
      <section class="card agents-sidebar">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Agents</div>
            <div class="card-sub">${agents.length} configured.</div>
          </div>
          <div class="row" style="gap: 8px;">
            <button
              class="btn btn--sm primary"
              @click=${props.onCreateModalOpen}
              ?disabled=${props.createModalLoading}
            >
              + New
            </button>
            <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
              ${props.loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        ${
          props.error
            ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
            : nothing
        }
        <div class="agent-list" style="margin-top: 12px; display:grid; gap:10px;">
          ${
            agents.length === 0
              ? html`
                  <div class="muted">No agents found.</div>
                `
              : agents.map((agent) => {
                  const badge = agentBadgeText(agent.id, defaultId);
                  const emoji = resolveAgentEmoji(agent, props.agentIdentityById[agent.id] ?? null);
                  const isActive = selectedId === agent.id;
                  return html`
                    <button
                      type="button"
                      class="agent-card ${isActive ? "agent-card--selected" : ""}"
                      @click=${() => props.onSelectAgent(agent.id)}
                      style="text-align:left; width:100%;"
                    >
                      <div class="agent-card-header">
                        <div class="agent-avatar">${emoji || normalizeAgentLabel(agent).slice(0, 1)}</div>
                        <div class="agent-card-info">
                          <div class="agent-card-title">${normalizeAgentLabel(agent)}</div>
                          <div class="muted mono" style="font-size:12px;">${agent.id}</div>
                        </div>
                      </div>
                      <div class="chip-row" style="margin-top:8px;">
                        ${badge ? html`<span class="chip">${badge}</span>` : nothing}
                        ${isActive ? html`<span class="chip chip-ok">selected</span>` : nothing}
                      </div>
                    </button>
                  `;
                })
          }
        </div>
      </section>
      <section class="agents-main">
        ${
          !selectedAgent
            ? html`
                <div class="card">
                  <div class="card-title">Select an agent</div>
                  <div class="card-sub">Pick an agent to inspect its workspace and tools.</div>
                </div>
              `
            : html`
              ${renderAgentHeader(
                selectedAgent,
                defaultId,
                props.agentIdentityById[selectedAgent.id] ?? null,
                props,
              )}
              ${renderAgentTabs(props.activePanel, (panel) => props.onSelectPanel(panel))}
              ${
                props.activePanel === "overview"
                  ? renderAgentOverview({
                      agent: selectedAgent,
                      defaultId,
                      configForm: props.configForm,
                      agentFilesList: props.agentFilesList,
                      agentIdentity: props.agentIdentityById[selectedAgent.id] ?? null,
                      agentIdentityError: props.agentIdentityError,
                      agentIdentityLoading: props.agentIdentityLoading,
                      configLoading: props.configLoading,
                      configSaving: props.configSaving,
                      configDirty: props.configDirty,
                      onConfigReload: props.onConfigReload,
                      onConfigSave: props.onConfigSave,
                      onModelChange: props.onModelChange,
                      onModelFallbacksChange: props.onModelFallbacksChange,
                      availableModels: props.availableModels,
                    })
                  : nothing
              }
              ${
                props.activePanel === "files"
                  ? renderAgentFiles({
                      agentId: selectedAgent.id,
                      agentFilesList: props.agentFilesList,
                      agentFilesLoading: props.agentFilesLoading,
                      agentFilesError: props.agentFilesError,
                      agentFileActive: props.agentFileActive,
                      agentFileContents: props.agentFileContents,
                      agentFileDrafts: props.agentFileDrafts,
                      agentFileSaving: props.agentFileSaving,
                      onLoadFiles: props.onLoadFiles,
                      onSelectFile: props.onSelectFile,
                      onFileDraftChange: props.onFileDraftChange,
                      onFileReset: props.onFileReset,
                      onFileSave: props.onFileSave,
                    })
                  : nothing
              }
              ${
                props.activePanel === "tools"
                  ? renderAgentTools({
                      agentId: selectedAgent.id,
                      configForm: props.configForm,
                      configLoading: props.configLoading,
                      configSaving: props.configSaving,
                      configDirty: props.configDirty,
                      onProfileChange: props.onToolsProfileChange,
                      onOverridesChange: props.onToolsOverridesChange,
                      onConfigReload: props.onConfigReload,
                      onConfigSave: props.onConfigSave,
                    })
                  : nothing
              }
              ${
                props.activePanel === "skills"
                  ? renderAgentSkills({
                      agentId: selectedAgent.id,
                      report: props.agentSkillsReport,
                      loading: props.agentSkillsLoading,
                      error: props.agentSkillsError,
                      activeAgentId: props.agentSkillsAgentId,
                      configForm: props.configForm,
                      configLoading: props.configLoading,
                      configSaving: props.configSaving,
                      configDirty: props.configDirty,
                      filter: props.skillsFilter,
                      onFilterChange: props.onSkillsFilterChange,
                      onRefresh: props.onSkillsRefresh,
                      onToggle: props.onAgentSkillToggle,
                      onClear: props.onAgentSkillsClear,
                      onDisableAll: props.onAgentSkillsDisableAll,
                      onConfigReload: props.onConfigReload,
                      onConfigSave: props.onConfigSave,
                    })
                  : nothing
              }
              ${
                props.activePanel === "channels"
                  ? renderAgentChannels({
                      agent: selectedAgent,
                      defaultId,
                      configForm: props.configForm,
                      agentFilesList: props.agentFilesList,
                      agentIdentity: props.agentIdentityById[selectedAgent.id] ?? null,
                      snapshot: props.channelsSnapshot,
                      loading: props.channelsLoading,
                      error: props.channelsError,
                      lastSuccess: props.channelsLastSuccess,
                      onRefresh: props.onChannelsRefresh,
                    })
                  : nothing
              }
              ${
                props.activePanel === "cron"
                  ? renderAgentCron({
                      agent: selectedAgent,
                      defaultId,
                      configForm: props.configForm,
                      agentFilesList: props.agentFilesList,
                      agentIdentity: props.agentIdentityById[selectedAgent.id] ?? null,
                      jobs: props.cronJobs,
                      status: props.cronStatus,
                      loading: props.cronLoading,
                      error: props.cronError,
                      onRefresh: props.onCronRefresh,
                    })
                  : nothing
              }
            `
        }
      </section>
    </div>
  `;
}

function renderAgentHeader(
  agent: AgentsListResult["agents"][number],
  defaultId: string | null,
  agentIdentity: AgentIdentityResult | null,
  props: Pick<AgentsProps, "onEditAgent" | "onDeleteAgent">,
) {
  const badge = agentBadgeText(agent.id, defaultId);
  const displayName = normalizeAgentLabel(agent);
  const subtitle = agent.identity?.theme?.trim() || "Agent workspace and routing.";
  const emoji = resolveAgentEmoji(agent, agentIdentity);
  return html`
    <section class="card agent-header">
      <div class="agent-header-main">
        <div class="agent-avatar agent-avatar--lg">
          ${emoji || displayName.slice(0, 1)}
        </div>
        <div>
          <div class="card-title">${displayName}</div>
          <div class="card-sub">${subtitle}</div>
        </div>
      </div>
      <div class="agent-header-meta">
        <div class="mono">${agent.id}</div>
        <div class="row" style="gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
          <button class="btn btn--sm" @click=${() => props.onEditAgent(agent.id)}>Edit</button>
          <button class="btn btn--sm danger" @click=${() => props.onDeleteAgent(agent.id)}>
            Delete
          </button>
        </div>
        ${badge ? html`<span class="agent-pill">${badge}</span>` : nothing}
      </div>
    </section>
  `;
}

function renderAgentTabs(active: AgentsPanel, onSelect: (panel: AgentsPanel) => void) {
  const tabs: Array<{ id: AgentsPanel; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "files", label: "Files" },
    { id: "tools", label: "Tools" },
    { id: "skills", label: "Skills" },
    { id: "channels", label: "Channels" },
    { id: "cron", label: "Cron Jobs" },
  ];
  return html`
    <div class="agent-tabs">
      ${tabs.map(
        (tab) => html`
          <button
            class="agent-tab ${active === tab.id ? "active" : ""}"
            type="button"
            @click=${() => onSelect(tab.id)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
  `;
}

function renderAgentOverview(params: {
  agent: AgentsListResult["agents"][number];
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  availableModels: string[];
}) {
  const {
    agent,
    configForm,
    agentFilesList,
    agentIdentity,
    agentIdentityLoading,
    agentIdentityError,
    configLoading,
    configSaving,
    configDirty,
    onConfigReload,
    onConfigSave,
    onModelChange,
    onModelFallbacksChange,
    availableModels,
  } = params;
  const config = resolveAgentConfig(configForm, agent.id);
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles ||
    config.entry?.workspace ||
    config.defaults?.workspace ||
    DEFAULT_AGENT_WORKSPACE_PATH;
  const model = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : resolveModelLabel(config.defaults?.model);
  const defaultModel = resolveModelLabel(config.defaults?.model);
  const modelPrimary =
    resolveModelPrimary(config.entry?.model) || (model !== "-" ? normalizeModelValue(model) : null);
  const defaultPrimary =
    resolveModelPrimary(config.defaults?.model) ||
    (defaultModel !== "-" ? normalizeModelValue(defaultModel) : null);
  const effectivePrimary = modelPrimary ?? defaultPrimary ?? null;
  const modelFallbacks = resolveModelFallbacks(config.entry?.model);
  const fallbackText = modelFallbacks ? modelFallbacks.join(", ") : "";
  const identityName =
    agentIdentity?.name?.trim() ||
    agent.identity?.name?.trim() ||
    agent.name?.trim() ||
    config.entry?.name ||
    "-";
  const resolvedEmoji = resolveAgentEmoji(agent, agentIdentity);
  const identityEmoji = resolvedEmoji || "-";
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  const identityStatus = agentIdentityLoading
    ? "Loading…"
    : agentIdentityError
      ? "Unavailable"
      : "";
  const isDefault = Boolean(params.defaultId && agent.id === params.defaultId);

  return html`
    <section class="card">
      <div class="card-title">Overview</div>
      <div class="card-sub">Workspace paths and identity metadata.</div>
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Workspace</div>
          <div class="mono">${workspace}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Primary Model</div>
          <div class="mono">${model}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Name</div>
          <div>${identityName}</div>
          ${identityStatus ? html`<div class="agent-kv-sub muted">${identityStatus}</div>` : nothing}
        </div>
        <div class="agent-kv">
          <div class="label">Default</div>
          <div>${isDefault ? "yes" : "no"}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Emoji</div>
          <div>${identityEmoji}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Skills Filter</div>
          <div>${skillFilter ? `${skillCount} selected` : "all skills"}</div>
        </div>
      </div>

      <div class="agent-model-select" style="margin-top: 20px;">
        <div class="label">Model Selection</div>
        <div class="row" style="gap: 12px; flex-wrap: wrap;">
          <label class="field" style="min-width: 260px; flex: 1;">
            <span>Primary model${isDefault ? " (default)" : ""}</span>
            <select
              .value=${effectivePrimary ?? ""}
              ?disabled=${!configForm || configLoading || configSaving}
              @change=${(e: Event) =>
                onModelChange(agent.id, (e.target as HTMLSelectElement).value || null)}
            >
              ${
                isDefault
                  ? nothing
                  : html`
                      <option value="">
                        ${
                          defaultPrimary ? `Inherit default (${defaultPrimary})` : "Inherit default"
                        }
                      </option>
                    `
              }
              ${availableModels.length > 0
                ? availableModels.map(
                    (ref) => html`<option value=${ref} ?selected=${ref === effectivePrimary}>${ref}</option>`,
                  )
                : buildModelOptions(configForm, effectivePrimary ?? undefined)}
            </select>
          </label>
          <label class="field" style="min-width: 260px; flex: 1;">
            <span>Fallbacks (comma-separated)</span>
            <input
              .value=${fallbackText}
              ?disabled=${!configForm || configLoading || configSaving}
              placeholder="provider/model, provider/model"
              @input=${(e: Event) =>
                onModelFallbacksChange(
                  agent.id,
                  parseFallbackList((e.target as HTMLInputElement).value),
                )}
            />
          </label>
        </div>
        <div class="row" style="justify-content: flex-end; gap: 8px;">
          <button
            class="btn btn--sm"
            ?disabled=${configLoading}
            @click=${onConfigReload}
          >
            Reload Config
          </button>
          <button
            class="btn btn--sm primary"
            ?disabled=${configSaving || !configDirty}
            @click=${onConfigSave}
          >
            ${configSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </section>
  `;
}

function renderAgentContextCard(context: AgentContext, subtitle: string) {
  return html`
    <section class="card">
      <div class="card-title">Agent Context</div>
      <div class="card-sub">${subtitle}</div>
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Workspace</div>
          <div class="mono">${context.workspace}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Primary Model</div>
          <div class="mono">${context.model}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Name</div>
          <div>${context.identityName}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Emoji</div>
          <div>${context.identityEmoji}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Skills Filter</div>
          <div>${context.skillsLabel}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Default</div>
          <div>${context.isDefault ? "yes" : "no"}</div>
        </div>
      </div>
    </section>
  `;
}

type ChannelSummaryEntry = {
  id: string;
  label: string;
  accounts: ChannelAccountSnapshot[];
};

function resolveChannelLabel(snapshot: ChannelsStatusSnapshot, id: string) {
  const meta = snapshot.channelMeta?.find((entry) => entry.id === id);
  if (meta?.label) {
    return meta.label;
  }
  return snapshot.channelLabels?.[id] ?? id;
}

function resolveChannelEntries(snapshot: ChannelsStatusSnapshot | null): ChannelSummaryEntry[] {
  if (!snapshot) {
    return [];
  }
  const ids = new Set<string>();
  for (const id of snapshot.channelOrder ?? []) {
    ids.add(id);
  }
  for (const entry of snapshot.channelMeta ?? []) {
    ids.add(entry.id);
  }
  for (const id of Object.keys(snapshot.channelAccounts ?? {})) {
    ids.add(id);
  }
  const ordered: string[] = [];
  const seed = snapshot.channelOrder?.length ? snapshot.channelOrder : Array.from(ids);
  for (const id of seed) {
    if (!ids.has(id)) {
      continue;
    }
    ordered.push(id);
    ids.delete(id);
  }
  for (const id of ids) {
    ordered.push(id);
  }
  return ordered.map((id) => ({
    id,
    label: resolveChannelLabel(snapshot, id),
    accounts: snapshot.channelAccounts?.[id] ?? [],
  }));
}

const CHANNEL_EXTRA_FIELDS = ["groupPolicy", "streamMode", "dmPolicy"] as const;

function resolveChannelConfigValue(
  configForm: Record<string, unknown> | null,
  channelId: string,
): Record<string, unknown> | null {
  if (!configForm) {
    return null;
  }
  const channels = (configForm.channels ?? {}) as Record<string, unknown>;
  const fromChannels = channels[channelId];
  if (fromChannels && typeof fromChannels === "object") {
    return fromChannels as Record<string, unknown>;
  }
  const fallback = configForm[channelId];
  if (fallback && typeof fallback === "object") {
    return fallback as Record<string, unknown>;
  }
  return null;
}

function formatChannelExtraValue(raw: unknown): string {
  if (raw == null) {
    return "n/a";
  }
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return "n/a";
  }
}

function resolveChannelExtras(
  configForm: Record<string, unknown> | null,
  channelId: string,
): Array<{ label: string; value: string }> {
  const value = resolveChannelConfigValue(configForm, channelId);
  if (!value) {
    return [];
  }
  return CHANNEL_EXTRA_FIELDS.flatMap((field) => {
    if (!(field in value)) {
      return [];
    }
    return [{ label: field, value: formatChannelExtraValue(value[field]) }];
  });
}

function summarizeChannelAccounts(accounts: ChannelAccountSnapshot[]) {
  let connected = 0;
  let configured = 0;
  let enabled = 0;
  for (const account of accounts) {
    const probeOk =
      account.probe && typeof account.probe === "object" && "ok" in account.probe
        ? Boolean((account.probe as { ok?: unknown }).ok)
        : false;
    const isConnected = account.connected === true || account.running === true || probeOk;
    if (isConnected) {
      connected += 1;
    }
    if (account.configured) {
      configured += 1;
    }
    if (account.enabled) {
      enabled += 1;
    }
  }
  return {
    total: accounts.length,
    connected,
    configured,
    enabled,
  };
}

function renderAgentChannels(params: {
  agent: AgentsListResult["agents"][number];
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  snapshot: ChannelsStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  lastSuccess: number | null;
  onRefresh: () => void;
}) {
  const context = buildAgentContext(
    params.agent,
    params.configForm,
    params.agentFilesList,
    params.defaultId,
    params.agentIdentity,
  );
  const entries = resolveChannelEntries(params.snapshot);
  const lastSuccessLabel = params.lastSuccess
    ? formatRelativeTimestamp(params.lastSuccess)
    : "never";
  return html`
    <section class="grid grid-cols-2">
      ${renderAgentContextCard(context, "Workspace, identity, and model configuration.")}
      <section class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Channels</div>
            <div class="card-sub">Gateway-wide channel status snapshot.</div>
          </div>
          <button class="btn btn--sm" ?disabled=${params.loading} @click=${params.onRefresh}>
            ${params.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div class="muted" style="margin-top: 8px;">
          Last refresh: ${lastSuccessLabel}
        </div>
        ${
          params.error
            ? html`<div class="callout danger" style="margin-top: 12px;">${params.error}</div>`
            : nothing
        }
        ${
          !params.snapshot
            ? html`
                <div class="callout info" style="margin-top: 12px">Load channels to see live status.</div>
              `
            : nothing
        }
        ${
          entries.length === 0
            ? html`
                <div class="muted" style="margin-top: 16px">No channels found.</div>
              `
            : html`
              <div class="list" style="margin-top: 16px;">
                ${entries.map((entry) => {
                  const summary = summarizeChannelAccounts(entry.accounts);
                  const status = summary.total
                    ? `${summary.connected}/${summary.total} connected`
                    : "no accounts";
                  const config = summary.configured
                    ? `${summary.configured} configured`
                    : "not configured";
                  const enabled = summary.total ? `${summary.enabled} enabled` : "disabled";
                  const extras = resolveChannelExtras(params.configForm, entry.id);
                  return html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${entry.label}</div>
                        <div class="list-sub mono">${entry.id}</div>
                      </div>
                      <div class="list-meta">
                        <div>${status}</div>
                        <div>${config}</div>
                        <div>${enabled}</div>
                        ${
                          extras.length > 0
                            ? extras.map((extra) => html`<div>${extra.label}: ${extra.value}</div>`)
                            : nothing
                        }
                      </div>
                    </div>
                  `;
                })}
              </div>
            `
        }
      </section>
    </section>
  `;
}

function renderAgentCron(params: {
  agent: AgentsListResult["agents"][number];
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  jobs: CronJob[];
  status: CronStatus | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const context = buildAgentContext(
    params.agent,
    params.configForm,
    params.agentFilesList,
    params.defaultId,
    params.agentIdentity,
  );
  const jobs = params.jobs.filter((job) => job.agentId === params.agent.id);
  return html`
    <section class="grid grid-cols-2">
      ${renderAgentContextCard(context, "Workspace and scheduling targets.")}
      <section class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Scheduler</div>
            <div class="card-sub">Gateway cron status.</div>
          </div>
          <button class="btn btn--sm" ?disabled=${params.loading} @click=${params.onRefresh}>
            ${params.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">Enabled</div>
            <div class="stat-value">
              ${params.status ? (params.status.enabled ? "Yes" : "No") : "n/a"}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">Jobs</div>
            <div class="stat-value">${params.status?.jobs ?? "n/a"}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Next wake</div>
            <div class="stat-value">${formatNextRun(params.status?.nextWakeAtMs ?? null)}</div>
          </div>
        </div>
        ${
          params.error
            ? html`<div class="callout danger" style="margin-top: 12px;">${params.error}</div>`
            : nothing
        }
      </section>
    </section>
    <section class="card">
      <div class="card-title">Agent Cron Jobs</div>
      <div class="card-sub">Scheduled jobs targeting this agent.</div>
      ${
        jobs.length === 0
          ? html`
              <div class="muted" style="margin-top: 16px">No jobs assigned.</div>
            `
          : html`
              <div class="list" style="margin-top: 16px;">
                ${jobs.map(
                  (job) => html`
                  <div class="list-item">
                    <div class="list-main">
                      <div class="list-title">${job.name}</div>
                      ${job.description ? html`<div class="list-sub">${job.description}</div>` : nothing}
                      <div class="chip-row" style="margin-top: 6px;">
                        <span class="chip">${formatCronSchedule(job)}</span>
                        <span class="chip ${job.enabled ? "chip-ok" : "chip-warn"}">
                          ${job.enabled ? "enabled" : "disabled"}
                        </span>
                        <span class="chip">${job.sessionTarget}</span>
                      </div>
                    </div>
                    <div class="list-meta">
                      <div class="mono">${formatCronState(job)}</div>
                      <div class="muted">${formatCronPayload(job)}</div>
                    </div>
                  </div>
                `,
                )}
              </div>
            `
      }
    </section>
  `;
}

function renderAgentFiles(params: {
  agentId: string;
  agentFilesList: AgentsFilesListResult | null;
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFileActive: string | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileSaving: boolean;
  onLoadFiles: (agentId: string) => void;
  onSelectFile: (name: string) => void;
  onFileDraftChange: (name: string, content: string) => void;
  onFileReset: (name: string) => void;
  onFileSave: (name: string) => void;
}) {
  const list = params.agentFilesList?.agentId === params.agentId ? params.agentFilesList : null;
  const files = list?.files ?? [];
  const active = params.agentFileActive ?? null;
  const activeEntry = active ? (files.find((file) => file.name === active) ?? null) : null;
  const baseContent = active ? (params.agentFileContents[active] ?? "") : "";
  const draft = active ? (params.agentFileDrafts[active] ?? baseContent) : "";
  const isDirty = active ? draft !== baseContent : false;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Core Files</div>
          <div class="card-sub">Bootstrap persona, identity, and tool guidance.</div>
        </div>
        <button
          class="btn btn--sm"
          ?disabled=${params.agentFilesLoading}
          @click=${() => params.onLoadFiles(params.agentId)}
        >
          ${params.agentFilesLoading ? "Loading…" : "Refresh"}
        </button>
      </div>
      ${list ? html`<div class="muted mono" style="margin-top: 8px;">Workspace: ${list.workspace}</div>` : nothing}
      ${
        params.agentFilesError
          ? html`<div class="callout danger" style="margin-top: 12px;">${
              params.agentFilesError
            }</div>`
          : nothing
      }
      ${
        !list
          ? html`
              <div class="callout info" style="margin-top: 12px">
                Load the agent workspace files to edit core instructions.
              </div>
            `
          : html`
              <div class="agent-files-grid" style="margin-top: 16px;">
                <div class="agent-files-list">
                  ${
                    files.length === 0
                      ? html`
                          <div class="muted">No files found.</div>
                        `
                      : files.map((file) =>
                          renderAgentFileRow(file, active, () => params.onSelectFile(file.name)),
                        )
                  }
                </div>
                <div class="agent-files-editor">
                  ${
                    !activeEntry
                      ? html`
                          <div class="muted">Select a file to edit.</div>
                        `
                      : html`
                          <div class="agent-file-header">
                            <div>
                              <div class="agent-file-title mono">${activeEntry.name}</div>
                              <div class="agent-file-sub mono">${activeEntry.path}</div>
                            </div>
                            <div class="agent-file-actions">
                              <button
                                class="btn btn--sm"
                                ?disabled=${!isDirty}
                                @click=${() => params.onFileReset(activeEntry.name)}
                              >
                                Reset
                              </button>
                              <button
                                class="btn btn--sm primary"
                                ?disabled=${params.agentFileSaving || !isDirty}
                                @click=${() => params.onFileSave(activeEntry.name)}
                              >
                                ${params.agentFileSaving ? "Saving…" : "Save"}
                              </button>
                            </div>
                          </div>
                          ${
                            activeEntry.missing
                              ? html`
                                  <div class="callout info" style="margin-top: 10px">
                                    This file is missing. Saving will create it in the agent workspace.
                                  </div>
                                `
                              : nothing
                          }
                          <label class="field" style="margin-top: 12px;">
                            <span>Content</span>
                            <textarea
                              .value=${draft}
                              @input=${(e: Event) =>
                                params.onFileDraftChange(
                                  activeEntry.name,
                                  (e.target as HTMLTextAreaElement).value,
                                )}
                            ></textarea>
                          </label>
                        `
                  }
                </div>
              </div>
            `
      }
    </section>
  `;
}

function renderAgentFileRow(file: AgentFileEntry, active: string | null, onSelect: () => void) {
  const status = file.missing
    ? "Missing"
    : `${formatBytes(file.size)} · ${formatRelativeTimestamp(file.updatedAtMs ?? null)}`;
  return html`
    <button
      type="button"
      class="agent-file-row ${active === file.name ? "active" : ""}"
      @click=${onSelect}
    >
      <div>
        <div class="agent-file-name mono">${file.name}</div>
        <div class="agent-file-meta">${status}</div>
      </div>
      ${
        file.missing
          ? html`
              <span class="agent-pill warn">missing</span>
            `
          : nothing
      }
    </button>
  `;
}

function renderAgentTools(params: {
  agentId: string;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  onProfileChange: (agentId: string, profile: string | null, clearAllow: boolean) => void;
  onOverridesChange: (agentId: string, alsoAllow: string[], deny: string[]) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
}) {
  const config = resolveAgentConfig(params.configForm, params.agentId);
  const agentTools = config.entry?.tools ?? {};
  const globalTools = config.globalTools ?? {};
  const profile = agentTools.profile ?? globalTools.profile ?? "full";
  const profileSource = agentTools.profile
    ? "agent override"
    : globalTools.profile
      ? "global default"
      : "default";
  const hasAgentAllow = Array.isArray(agentTools.allow) && agentTools.allow.length > 0;
  const hasGlobalAllow = Array.isArray(globalTools.allow) && globalTools.allow.length > 0;
  const editable =
    Boolean(params.configForm) && !params.configLoading && !params.configSaving && !hasAgentAllow;
  const alsoAllow = hasAgentAllow
    ? []
    : Array.isArray(agentTools.alsoAllow)
      ? agentTools.alsoAllow
      : [];
  const deny = hasAgentAllow ? [] : Array.isArray(agentTools.deny) ? agentTools.deny : [];
  const basePolicy = hasAgentAllow
    ? { allow: agentTools.allow ?? [], deny: agentTools.deny ?? [] }
    : (resolveToolProfilePolicy(profile) ?? undefined);
  const toolIds = TOOL_SECTIONS.flatMap((section) => section.tools.map((tool) => tool.id));

  const resolveAllowed = (toolId: string) => {
    const baseAllowed = isAllowedByPolicy(toolId, basePolicy);
    const extraAllowed = matchesList(toolId, alsoAllow);
    const denied = matchesList(toolId, deny);
    const allowed = (baseAllowed || extraAllowed) && !denied;
    return {
      allowed,
      baseAllowed,
      denied,
    };
  };
  const enabledCount = toolIds.filter((toolId) => resolveAllowed(toolId).allowed).length;

  const updateTool = (toolId: string, nextEnabled: boolean) => {
    const nextAllow = new Set(
      alsoAllow.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
    );
    const nextDeny = new Set(
      deny.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
    );
    const baseAllowed = resolveAllowed(toolId).baseAllowed;
    const normalized = normalizeToolName(toolId);
    if (nextEnabled) {
      nextDeny.delete(normalized);
      if (!baseAllowed) {
        nextAllow.add(normalized);
      }
    } else {
      nextAllow.delete(normalized);
      nextDeny.add(normalized);
    }
    params.onOverridesChange(params.agentId, [...nextAllow], [...nextDeny]);
  };

  const updateAll = (nextEnabled: boolean) => {
    const nextAllow = new Set(
      alsoAllow.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
    );
    const nextDeny = new Set(
      deny.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
    );
    for (const toolId of toolIds) {
      const baseAllowed = resolveAllowed(toolId).baseAllowed;
      const normalized = normalizeToolName(toolId);
      if (nextEnabled) {
        nextDeny.delete(normalized);
        if (!baseAllowed) {
          nextAllow.add(normalized);
        }
      } else {
        nextAllow.delete(normalized);
        nextDeny.add(normalized);
      }
    }
    params.onOverridesChange(params.agentId, [...nextAllow], [...nextDeny]);
  };

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Tool Access</div>
          <div class="card-sub">
            Profile + per-tool overrides for this agent.
            <span class="mono">${enabledCount}/${toolIds.length}</span> enabled.
          </div>
        </div>
        <div class="row" style="gap: 8px;">
          <button
            class="btn btn--sm"
            ?disabled=${!editable}
            @click=${() => updateAll(true)}
          >
            Enable All
          </button>
          <button
            class="btn btn--sm"
            ?disabled=${!editable}
            @click=${() => updateAll(false)}
          >
            Disable All
          </button>
          <button
            class="btn btn--sm"
            ?disabled=${params.configLoading}
            @click=${params.onConfigReload}
          >
            Reload Config
          </button>
          <button
            class="btn btn--sm primary"
            ?disabled=${params.configSaving || !params.configDirty}
            @click=${params.onConfigSave}
          >
            ${params.configSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      ${
        !params.configForm
          ? html`
              <div class="callout info" style="margin-top: 12px">
                Load the gateway config to adjust tool profiles.
              </div>
            `
          : nothing
      }
      ${
        hasAgentAllow
          ? html`
              <div class="callout info" style="margin-top: 12px">
                This agent is using an explicit allowlist in config. Tool overrides are managed in the Config tab.
              </div>
            `
          : nothing
      }
      ${
        hasGlobalAllow
          ? html`
              <div class="callout info" style="margin-top: 12px">
                Global tools.allow is set. Agent overrides cannot enable tools that are globally blocked.
              </div>
            `
          : nothing
      }

      <div class="agent-tools-meta" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Profile</div>
          <div class="mono">${profile}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Source</div>
          <div>${profileSource}</div>
        </div>
        ${
          params.configDirty
            ? html`
                <div class="agent-kv">
                  <div class="label">Status</div>
                  <div class="mono">unsaved</div>
                </div>
              `
            : nothing
        }
      </div>

      <div class="agent-tools-presets" style="margin-top: 16px;">
        <div class="label">Quick Presets</div>
        <div class="agent-tools-buttons">
          ${PROFILE_OPTIONS.map(
            (option) => html`
              <button
                class="btn btn--sm ${profile === option.id ? "active" : ""}"
                ?disabled=${!editable}
                @click=${() => params.onProfileChange(params.agentId, option.id, true)}
              >
                ${option.label}
              </button>
            `,
          )}
          <button
            class="btn btn--sm"
            ?disabled=${!editable}
            @click=${() => params.onProfileChange(params.agentId, null, false)}
          >
            Inherit
          </button>
        </div>
      </div>

      <div class="agent-tools-grid" style="margin-top: 20px;">
        ${TOOL_SECTIONS.map(
          (section) =>
            html`
            <div class="agent-tools-section">
              <div class="agent-tools-header">${section.label}</div>
              <div class="agent-tools-list">
                ${section.tools.map((tool) => {
                  const { allowed } = resolveAllowed(tool.id);
                  return html`
                    <div class="agent-tool-row">
                      <div>
                        <div class="agent-tool-title mono">${tool.label}</div>
                        <div class="agent-tool-sub">${tool.description}</div>
                      </div>
                      <label class="cfg-toggle">
                        <input
                          type="checkbox"
                          .checked=${allowed}
                          ?disabled=${!editable}
                          @change=${(e: Event) =>
                            updateTool(tool.id, (e.target as HTMLInputElement).checked)}
                        />
                        <span class="cfg-toggle__track"></span>
                      </label>
                    </div>
                  `;
                })}
              </div>
            </div>
          `,
        )}
      </div>
    </section>
  `;
}

type SkillGroup = {
  id: string;
  label: string;
  skills: SkillStatusEntry[];
};

const SKILL_SOURCE_GROUPS: Array<{ id: string; label: string; sources: string[] }> = [
  { id: "workspace", label: "Workspace Skills", sources: ["openclaw-workspace"] },
  { id: "built-in", label: "Built-in Skills", sources: ["openclaw-bundled"] },
  { id: "installed", label: "Installed Skills", sources: ["openclaw-managed"] },
  { id: "extra", label: "Extra Skills", sources: ["openclaw-extra"] },
];

function groupSkills(skills: SkillStatusEntry[]): SkillGroup[] {
  const groups = new Map<string, SkillGroup>();
  for (const def of SKILL_SOURCE_GROUPS) {
    groups.set(def.id, { id: def.id, label: def.label, skills: [] });
  }
  const builtInGroup = SKILL_SOURCE_GROUPS.find((group) => group.id === "built-in");
  const other: SkillGroup = { id: "other", label: "Other Skills", skills: [] };
  for (const skill of skills) {
    const match = skill.bundled
      ? builtInGroup
      : SKILL_SOURCE_GROUPS.find((group) => group.sources.includes(skill.source));
    if (match) {
      groups.get(match.id)?.skills.push(skill);
    } else {
      other.skills.push(skill);
    }
  }
  const ordered = SKILL_SOURCE_GROUPS.map((group) => groups.get(group.id)).filter(
    (group): group is SkillGroup => Boolean(group && group.skills.length > 0),
  );
  if (other.skills.length > 0) {
    ordered.push(other);
  }
  return ordered;
}

function renderAgentSkills(params: {
  agentId: string;
  report: SkillStatusReport | null;
  loading: boolean;
  error: string | null;
  activeAgentId: string | null;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  filter: string;
  onFilterChange: (next: string) => void;
  onRefresh: () => void;
  onToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  onClear: (agentId: string) => void;
  onDisableAll: (agentId: string) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
}) {
  const editable = Boolean(params.configForm) && !params.configLoading && !params.configSaving;
  const config = resolveAgentConfig(params.configForm, params.agentId);
  const allowlist = Array.isArray(config.entry?.skills) ? config.entry?.skills : undefined;
  const allowSet = new Set((allowlist ?? []).map((name) => name.trim()).filter(Boolean));
  const usingAllowlist = allowlist !== undefined;
  const reportReady = Boolean(params.report && params.activeAgentId === params.agentId);
  const rawSkills = reportReady ? (params.report?.skills ?? []) : [];
  const filter = params.filter.trim().toLowerCase();
  const filtered = filter
    ? rawSkills.filter((skill) =>
        [skill.name, skill.description, skill.source].join(" ").toLowerCase().includes(filter),
      )
    : rawSkills;
  const groups = groupSkills(filtered);
  const enabledCount = usingAllowlist
    ? rawSkills.filter((skill) => allowSet.has(skill.name)).length
    : rawSkills.length;
  const totalCount = rawSkills.length;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Skills</div>
          <div class="card-sub">
            Per-agent skill allowlist and workspace skills.
            ${totalCount > 0 ? html`<span class="mono">${enabledCount}/${totalCount}</span>` : nothing}
          </div>
        </div>
        <div class="row" style="gap: 8px;">
          <button class="btn btn--sm" ?disabled=${!editable} @click=${() => params.onClear(params.agentId)}>
            Use All
          </button>
          <button class="btn btn--sm" ?disabled=${!editable} @click=${() => params.onDisableAll(params.agentId)}>
            Disable All
          </button>
          <button
            class="btn btn--sm"
            ?disabled=${params.configLoading}
            @click=${params.onConfigReload}
          >
            Reload Config
          </button>
          <button class="btn btn--sm" ?disabled=${params.loading} @click=${params.onRefresh}>
            ${params.loading ? "Loading…" : "Refresh"}
          </button>
          <button
            class="btn btn--sm primary"
            ?disabled=${params.configSaving || !params.configDirty}
            @click=${params.onConfigSave}
          >
            ${params.configSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      ${
        !params.configForm
          ? html`
              <div class="callout info" style="margin-top: 12px">
                Load the gateway config to set per-agent skills.
              </div>
            `
          : nothing
      }
      ${
        usingAllowlist
          ? html`
              <div class="callout info" style="margin-top: 12px">This agent uses a custom skill allowlist.</div>
            `
          : html`
              <div class="callout info" style="margin-top: 12px">
                All skills are enabled. Disabling any skill will create a per-agent allowlist.
              </div>
            `
      }
      ${
        !reportReady && !params.loading
          ? html`
              <div class="callout info" style="margin-top: 12px">
                Load skills for this agent to view workspace-specific entries.
              </div>
            `
          : nothing
      }
      ${
        params.error
          ? html`<div class="callout danger" style="margin-top: 12px;">${params.error}</div>`
          : nothing
      }

      <div class="filters" style="margin-top: 14px;">
        <label class="field" style="flex: 1;">
          <span>Filter</span>
          <input
            .value=${params.filter}
            @input=${(e: Event) => params.onFilterChange((e.target as HTMLInputElement).value)}
            placeholder="Search skills"
          />
        </label>
        <div class="muted">${filtered.length} shown</div>
      </div>

      ${
        filtered.length === 0
          ? html`
              <div class="muted" style="margin-top: 16px">No skills found.</div>
            `
          : html`
              <div class="agent-skills-groups" style="margin-top: 16px;">
                ${groups.map((group) =>
                  renderAgentSkillGroup(group, {
                    agentId: params.agentId,
                    allowSet,
                    usingAllowlist,
                    editable,
                    onToggle: params.onToggle,
                  }),
                )}
              </div>
            `
      }
    </section>
  `;
}

function renderAgentSkillGroup(
  group: SkillGroup,
  params: {
    agentId: string;
    allowSet: Set<string>;
    usingAllowlist: boolean;
    editable: boolean;
    onToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  },
) {
  const collapsedByDefault = group.id === "workspace" || group.id === "built-in";
  return html`
    <details class="agent-skills-group" ?open=${!collapsedByDefault}>
      <summary class="agent-skills-header">
        <span>${group.label}</span>
        <span class="muted">${group.skills.length}</span>
      </summary>
      <div class="list skills-grid">
        ${group.skills.map((skill) =>
          renderAgentSkillRow(skill, {
            agentId: params.agentId,
            allowSet: params.allowSet,
            usingAllowlist: params.usingAllowlist,
            editable: params.editable,
            onToggle: params.onToggle,
          }),
        )}
      </div>
    </details>
  `;
}

function renderAgentSkillRow(
  skill: SkillStatusEntry,
  params: {
    agentId: string;
    allowSet: Set<string>;
    usingAllowlist: boolean;
    editable: boolean;
    onToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  },
) {
  const enabled = params.usingAllowlist ? params.allowSet.has(skill.name) : true;
  const missing = [
    ...skill.missing.bins.map((b) => `bin:${b}`),
    ...skill.missing.env.map((e) => `env:${e}`),
    ...skill.missing.config.map((c) => `config:${c}`),
    ...skill.missing.os.map((o) => `os:${o}`),
  ];
  const reasons: string[] = [];
  if (skill.disabled) {
    reasons.push("disabled");
  }
  if (skill.blockedByAllowlist) {
    reasons.push("blocked by allowlist");
  }
  return html`
    <div class="list-item agent-skill-row">
      <div class="list-main">
        <div class="list-title">
          ${skill.emoji ? `${skill.emoji} ` : ""}${skill.name}
        </div>
        <div class="list-sub">${skill.description}</div>
        <div class="chip-row" style="margin-top: 6px;">
          <span class="chip">${skill.source}</span>
          <span class="chip ${skill.eligible ? "chip-ok" : "chip-warn"}">
            ${skill.eligible ? "eligible" : "blocked"}
          </span>
          ${
            skill.disabled
              ? html`
                  <span class="chip chip-warn">disabled</span>
                `
              : nothing
          }
        </div>
        ${
          missing.length > 0
            ? html`<div class="muted" style="margin-top: 6px;">Missing: ${missing.join(", ")}</div>`
            : nothing
        }
        ${
          reasons.length > 0
            ? html`<div class="muted" style="margin-top: 6px;">Reason: ${reasons.join(", ")}</div>`
            : nothing
        }
      </div>
      <div class="list-meta">
        <label class="cfg-toggle">
          <input
            type="checkbox"
            .checked=${enabled}
            ?disabled=${!params.editable}
            @change=${(e: Event) =>
              params.onToggle(params.agentId, skill.name, (e.target as HTMLInputElement).checked)}
          />
          <span class="cfg-toggle__track"></span>
        </label>
      </div>
    </div>
  `;
}

/**
 * Render the Create Agent Modal
 * Based on UI_MOCKUPS.md Section 7: Create Agent Modal
 */
function renderCreateAgentModal(props: AgentsProps) {
  const {
    createModalFormData: form,
    createModalMode,
    createModalLoading,
    createModalError,
    createModalStep: step,
  } = props;
  const isEditMode = createModalMode === "edit";
  const modalTitle = isEditMode ? "Edit Agent" : "Create Agent";
  const modalSub = isEditMode
    ? "Update the agent using the same guided setup form."
    : "Step-by-step setup for faster and cleaner agent creation.";
  const reviewVerb = isEditMode ? "updating" : "creating";
  const submitLabel = isEditMode ? "Update Agent" : "Create Agent";
  const submitLoadingLabel = isEditMode ? "Updating..." : "Creating...";
  const isAutonomous = form.mode === "autonomous";
  const emojiValue = form.emoji.trim();
  const emojiIsPreset = AGENT_EMOJI_OPTIONS.some((option) => option.value === emojiValue);
  const emojiSelectValue = emojiIsPreset ? emojiValue : "__custom__";
  const selectedArchetype = getArchetypeById(form.archetypeId);

  const modeOptions: Array<{ value: AgentMode; label: string; description: string }> = [
    { value: "interactive", label: "Interactive", description: "Optimized for direct chat usage." },
    { value: "hybrid", label: "Hybrid", description: "Balanced profile for chat and task execution." },
    { value: "autonomous", label: "Autonomous", description: "Task-heavy profile for scheduled workflows." },
  ];

  const personalityOptions: Array<{ value: AgentPersonality; label: string }> = [
    { value: "professional", label: "Professional" },
    { value: "friendly", label: "Friendly" },
    { value: "technical", label: "Technical" },
    { value: "custom", label: "Custom" },
  ];

  const skillOptions = props.availableSkills.length > 0
    ? props.availableSkills.map((s) => ({ id: s, label: s }))
    : DEFAULT_SKILL_OPTIONS;

  const configuredModels: ConfiguredModelOption[] = props.availableModels.length > 0
    ? props.availableModels.map((ref) => ({ value: ref, label: ref }))
    : resolveConfiguredModels(props.configForm);
  const modelConfigured = form.model
    ? configuredModels.some((option) => option.value === form.model)
    : true;
  const hasConfiguredModels = configuredModels.length > 0;
  const workspaceLocked = Boolean(props.workspaceLocked);
  const canAdvanceStep1 = Boolean(form.name.trim());
  const canSubmit = Boolean(form.name.trim()) && (hasConfiguredModels || !form.model.trim());

  const steps: Array<{ value: 0 | 1 | 2 | 3; label: string; sub: string }> = [
    ...(isEditMode ? [] : [{ value: 0 as const, label: "Catalog", sub: "Pick an archetype" }]),
    { value: 1, label: "Customize", sub: "Name, identity, persona" },
    { value: 2, label: "Runtime", sub: "Mode, model, skills" },
    { value: 3, label: "Review", sub: "Preview + create" },
  ];

  const modeToProfile: Record<AgentMode, string> = {
    autonomous: "full",
    interactive: "messaging",
    hybrid: "coding",
  };

  const previewAgent: Record<string, unknown> = {
    id: form.id.trim() || "<auto-from-name>",
    name: form.name.trim() || "<required>",
    workspace: form.workspace.trim() || DEFAULT_AGENT_WORKSPACE_PATH,
    identity: {
      name: form.name.trim() || "<required>",
      ...(form.emoji.trim() ? { emoji: form.emoji.trim() } : {}),
      ...(form.theme.trim() || form.purpose.trim()
        ? { theme: form.theme.trim() || form.purpose.trim() }
        : {}),
    },
    tools: { profile: modeToProfile[form.mode] },
  };
  if (form.model.trim()) {
    previewAgent.model = form.model.trim();
  }
  if (form.skills.length > 0) {
    previewAgent.skills = form.skills;
  }
  const jsonPreview = JSON.stringify(previewAgent, null, 2);

  const minStep = isEditMode ? 1 : 0;
  const goNext = () => {
    if (step === 0) return; // catalog step advances via archetype selection
    if (step === 1 && !canAdvanceStep1) return;
    if (step < 3) {
      props.onCreateModalStepChange((step + 1) as 1 | 2 | 3);
    }
  };

  const goBack = () => {
    if (step > minStep) {
      props.onCreateModalStepChange((step - 1) as 0 | 1 | 2);
    }
  };

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-modal="true" aria-labelledby="create-agent-title">
      <div class="exec-approval-card exec-approval-card--wizard" style="max-width: 920px; width: min(96vw, 920px);">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title" id="create-agent-title">${modalTitle}</div>
            <div class="exec-approval-sub">${modalSub}</div>
          </div>
          <button
            class="btn btn--sm"
            @click=${props.onCreateModalCancel}
            ?disabled=${createModalLoading}
            title="Close"
            style="padding: 4px 8px;"
          >
            Close
          </button>
        </div>

        <div class="exec-approval-body exec-approval-body--wizard">
        <section class="card" style="margin-top: 14px;">
          <div class="row" style="justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
            <div>
              <div class="card-title">Setup Steps</div>
              <div class="card-sub">Complete each step and review JSON before ${reviewVerb} the agent.</div>
            </div>
            <div class="chip-row">
              ${steps.map((item) => {
                const complete = step > item.value;
                const active = step === item.value;
                return html`
                  <button
                    class="chip ${active ? "chip-ok" : complete ? "" : ""}"
                    type="button"
                    ?disabled=${createModalLoading || item.value > step + 1}
                    @click=${() => props.onCreateModalStepChange(item.value)}
                    title=${item.sub}
                  >
                    ${item.value}. ${item.label}
                  </button>
                `;
              })}
            </div>
          </div>
        </section>

        ${createModalError
          ? html`<div class="callout danger" style="margin-top: 12px;">${createModalError}</div>`
          : nothing}

        ${step === 0
          ? renderCatalogBrowser({
              archetypes: AGENT_ARCHETYPES,
              divisions: DIVISION_META,
              selectedDivision: (props.catalogDivision ?? "all") as import("./agents-catalog.ts").AgentArchetypeDivision | "all",
              searchQuery: props.catalogSearch ?? "",
              previewArchetypeId: props.catalogPreviewArchetypeId,
              previewSoulContent: props.catalogPreviewSoulContent,
              previewLoading: props.catalogPreviewLoading,
              previewError: props.catalogPreviewError,
              onDivisionChange: (d) => props.onCatalogDivisionChange(d),
              onSearchChange: (q) => props.onCatalogSearchChange(q),
              onSelectArchetype: (a) => props.onSelectArchetype(a),
              onPreviewArchetype: (a) => props.onPreviewArchetype(a),
              onStartFromScratch: () => props.onStartFromScratch(),
            })
          : nothing}

        ${step === 1
          ? html`
              ${form.archetypeId
                ? html`<div class="callout" style="margin-top: 14px;">
                    Based on: <strong>${selectedArchetype?.name ?? form.archetypeId}</strong>
                    ${selectedArchetype?.emoji ?? ""}
                    -- persona will be written to SOUL.md
                  </div>`
                : nothing}
              <section class="card" style="margin-top: 14px;">
                <div class="card-title">Identity And Routing</div>
                <div class="card-sub">Core identity and workspace fields written into config.</div>
                <div class="form-grid" style="margin-top: 14px; grid-template-columns: 1fr 1fr;">
                  <label class="field">
                    <span>Name *</span>
                    <input
                      .value=${form.name}
                      @input=${(e: Event) =>
                        props.onCreateModalFieldChange("name", (e.target as HTMLInputElement).value)}
                      placeholder="e.g. Sales Agent"
                      ?disabled=${createModalLoading}
                    />
                  </label>
                  <label class="field">
                    <span>Agent ID</span>
                    <input
                      .value=${form.id}
                      @input=${(e: Event) =>
                        props.onCreateModalFieldChange("id", (e.target as HTMLInputElement).value)}
                      placeholder="auto-generated from name"
                      ?disabled=${createModalLoading || isEditMode}
                    />
                    ${isEditMode
                      ? html`
                          <div class="muted" style="font-size: 11px; margin-top: 4px;">
                            Agent ID is fixed after creation.
                          </div>
                        `
                      : nothing}
                  </label>
                  <label class="field">
                    <span>Workspace</span>
                    <input
                      .value=${form.workspace}
                      @input=${(e: Event) =>
                        props.onCreateModalFieldChange("workspace", (e.target as HTMLInputElement).value)}
                      placeholder=${DEFAULT_AGENT_WORKSPACE_PATH}
                      ?disabled=${createModalLoading || workspaceLocked}
                    />
                    ${
                      workspaceLocked
                        ? html`
                            <div class="muted" style="font-size: 11px; margin-top: 4px;">
                              Managed by the current workspace. Agent files and memory stay isolated here.
                            </div>
                          `
                        : nothing
                    }
                  </label>
                  <label class="field">
                    <span>Emoji</span>
                    <div class="row" style="gap:8px; align-items:center;">
                      <select
                        .value=${emojiSelectValue}
                        @change=${(e: Event) => {
                          const next = (e.target as HTMLSelectElement).value;
                          if (next !== "__custom__") {
                            props.onCreateModalFieldChange("emoji", next);
                          }
                        }}
                        ?disabled=${createModalLoading}
                      >
                        ${AGENT_EMOJI_OPTIONS.map(
                          (option) =>
                            html`<option value=${option.value}>${option.value} ${option.label}</option>`,
                        )}
                        <option value="__custom__">Custom / badge</option>
                      </select>
                      <span class="chip" title="Emoji preview">${emojiValue || "∅"}</span>
                    </div>
                  </label>
                  <label class="field">
                    <span>Custom Emoji Or Badge</span>
                    <input
                      .value=${form.emoji}
                      @input=${(e: Event) =>
                        props.onCreateModalFieldChange("emoji", (e.target as HTMLInputElement).value)}
                      placeholder="🤖 or WW"
                      ?disabled=${createModalLoading || emojiSelectValue !== "__custom__"}
                    />
                  </label>
                  <label class="field full">
                    <span>Purpose</span>
                    <input
                      .value=${form.purpose}
                      @input=${(e: Event) =>
                        props.onCreateModalFieldChange("purpose", (e.target as HTMLInputElement).value)}
                      placeholder="One-line mission statement"
                      ?disabled=${createModalLoading}
                    />
                  </label>
                  <label class="field full">
                    <span>Theme</span>
                    <input
                      .value=${form.theme}
                      @input=${(e: Event) =>
                        props.onCreateModalFieldChange("theme", (e.target as HTMLInputElement).value)}
                      placeholder="Optional identity theme"
                      ?disabled=${createModalLoading}
                    />
                  </label>
                </div>
              </section>
              ${form.soulContent
                ? html`
                  <section class="card" style="margin-top: 14px;">
                    <div class="card-title">Agent Persona (SOUL.md)</div>
                    <div class="card-sub">This persona will guide the agent's behavior, tone, and expertise.</div>
                    <div class="soul-preview" style="margin-top: 10px;">${form.soulContent.length > 1200 ? form.soulContent.slice(0, 1200) + "\n..." : form.soulContent}</div>
                  </section>
                `
                : nothing}
            `
          : nothing}

        ${step === 2
          ? html`
              <section class="card" style="margin-top: 14px;">
                <div class="card-title">Runtime Profile</div>
                <div class="card-sub">Choose behavior mode, model, and skills.</div>
                <div class="form-grid" style="margin-top: 14px; grid-template-columns: 1fr 1fr;">
                  <label class="field">
                    <span>Mode</span>
                    <select
                      .value=${form.mode}
                      @change=${(e: Event) =>
                        props.onCreateModalFieldChange("mode", (e.target as HTMLSelectElement).value as AgentMode)}
                      ?disabled=${createModalLoading}
                    >
                      ${modeOptions.map(
                        (opt) => html`
                          <option value=${opt.value}>${opt.label}</option>
                        `,
                      )}
                    </select>
                    <div class="muted" style="font-size: 11px; margin-top: 4px;">
                      ${modeOptions.find((opt) => opt.value === form.mode)?.description ?? ""}
                    </div>
                  </label>
                  <label class="field">
                    <span>Personality</span>
                    <select
                      .value=${form.personality}
                      @change=${(e: Event) =>
                        props.onCreateModalFieldChange(
                          "personality",
                          (e.target as HTMLSelectElement).value as AgentPersonality,
                        )}
                      ?disabled=${createModalLoading}
                    >
                      ${personalityOptions.map(
                        (opt) => html`<option value=${opt.value}>${opt.label}</option>`,
                      )}
                    </select>
                  </label>
                  <label class="field full">
                    <span>Model</span>
                    <select
                      .value=${form.model}
                      @change=${(e: Event) =>
                        props.onCreateModalFieldChange("model", (e.target as HTMLSelectElement).value)}
                      ?disabled=${createModalLoading}
                    >
                      <option value="">Inherit workspace default</option>
                      ${configuredModels.map(
                        (option) => html`<option value=${option.value}>${option.label}</option>`,
                      )}
                      ${form.model && !modelConfigured
                        ? html`<option value=${form.model}>Current (${form.model})</option>`
                        : nothing}
                    </select>
                  </label>
                </div>

                <div class="field" style="margin-top: 12px;">
                  <span>Skills</span>
                  <div class="chip-row" style="margin-top: 8px;">
                    ${skillOptions.map((skill) => {
                      const isSelected = form.skills.includes(skill.id);
                      return html`
                        <label class="chip" style="cursor: pointer;">
                          <input
                            type="checkbox"
                            .checked=${isSelected}
                            @change=${(e: Event) => {
                              const checked = (e.target as HTMLInputElement).checked;
                              const newSkills = checked
                                ? [...form.skills, skill.id]
                                : form.skills.filter((s) => s !== skill.id);
                              props.onCreateModalFieldChange("skills", newSkills);
                            }}
                            ?disabled=${createModalLoading}
                          />
                          ${skill.label}
                        </label>
                      `;
                    })}
                  </div>
                </div>

                ${configuredModels.length === 0
                  ? html`
                      <div class="callout warn" style="margin-top: 12px;">
                        No configured models found. Add one first in the Models tab.
                        <div style="margin-top: 8px;">
                          <button
                            class="btn btn--sm"
                            @click=${() => {
                              props.onCreateModalCancel();
                              props.onOpenModelsTab();
                            }}
                          >
                            Open Models Tab
                          </button>
                        </div>
                      </div>
                    `
                  : nothing}

                ${isAutonomous
                  ? html`
                      <div class="field" style="margin-top: 12px;">
                        <span>Autonomous Task Checklist</span>
                        <div class="chip-row" style="margin-top: 8px;">
                          ${AUTONOMOUS_TASK_OPTIONS.map((task) => {
                            const isSelected = form.autonomousTasks.includes(task.id);
                            return html`
                              <label class="chip" style="cursor: pointer;">
                                <input
                                  type="checkbox"
                                  .checked=${isSelected}
                                  @change=${(e: Event) => {
                                    const checked = (e.target as HTMLInputElement).checked;
                                    const next = checked
                                      ? [...form.autonomousTasks, task.id]
                                      : form.autonomousTasks.filter((id) => id !== task.id);
                                    props.onCreateModalFieldChange("autonomousTasks", next);
                                  }}
                                  ?disabled=${createModalLoading}
                                />
                                ${task.label}
                              </label>
                            `;
                          })}
                        </div>
                        <div class="muted" style="font-size: 11px; margin-top: 6px;">
                          Checklist is stored in UI state and can seed future automation setup.
                        </div>
                      </div>
                    `
                  : nothing}
              </section>
            `
          : nothing}

        ${step === 3
          ? html`
              <section class="card" style="margin-top: 14px;">
                <div class="card-title">Review</div>
                <div class="card-sub">Confirm values before writing to agents.list.</div>
                <div class="agents-overview-grid" style="margin-top: 14px;">
                  <div class="agent-kv">
                    <div class="label">Name</div>
                    <div>${form.name.trim() || "-"}</div>
                  </div>
                  <div class="agent-kv">
                    <div class="label">Agent ID</div>
                    <div class="mono">${form.id.trim() || "<auto-from-name>"}</div>
                  </div>
                  <div class="agent-kv">
                    <div class="label">Workspace</div>
                    <div class="mono">${form.workspace.trim() || DEFAULT_AGENT_WORKSPACE_PATH}</div>
                  </div>
                  <div class="agent-kv">
                    <div class="label">Mode</div>
                    <div>${form.mode}</div>
                  </div>
                  <div class="agent-kv">
                    <div class="label">Model</div>
                    <div class="mono">${form.model.trim() || "Inherit workspace default"}</div>
                  </div>
                  <div class="agent-kv">
                    <div class="label">Skills</div>
                    <div>${form.skills.length > 0 ? form.skills.join(", ") : "None selected"}</div>
                  </div>
                </div>
              </section>

              <section class="card" style="margin-top: 12px;">
                <div class="card-title">Config JSON Preview</div>
                <div class="card-sub">
                  This is what will be written into agents.list on ${isEditMode ? "update" : "create"}.
                </div>
                <textarea
                  class="mono"
                  style="margin-top: 10px; min-height: 170px;"
                  readonly
                  .value=${jsonPreview}
                ></textarea>
              </section>
            `
          : nothing}

        </div>

        <div class="exec-approval-actions exec-approval-actions--wizard" style="justify-content: flex-end;">
          <button class="btn" @click=${props.onCreateModalCancel} ?disabled=${createModalLoading}>
            Cancel
          </button>
          ${step > 1
            ? html`
                <button class="btn" @click=${goBack} ?disabled=${createModalLoading}>
                  Back
                </button>
              `
            : nothing}
          ${step < 3
            ? html`
                <button
                  class="btn primary"
                  @click=${goNext}
                  ?disabled=${createModalLoading || (step === 1 && !canAdvanceStep1)}
                >
                  Next
                </button>
              `
            : html`
                <button
                  class="btn primary"
                  @click=${props.onCreateModalSubmit}
                  ?disabled=${createModalLoading || !canSubmit}
                >
                  ${createModalLoading ? submitLoadingLabel : submitLabel}
                </button>
              `}
        </div>
      </div>
    </div>
  `;
}
/**
 * Render an agent card for the dashboard view
 * Based on UI_MOCKUPS.md Section 6: Agents Page
 */
function renderAgentCard(
  agent: AgentsListResult["agents"][number],
  props: AgentsProps,
  defaultId: string | null,
) {
  const activity = props.agentActivityById[agent.id] ?? {
    tasksRunning: 0,
    tasksQueued: 0,
    lastActivityAt: null,
    status: "idle",
  };
  const displayName = normalizeAgentLabel(agent);
  const emoji = resolveAgentEmoji(agent, props.agentIdentityById[agent.id] ?? null);
  const isSelected = props.selectedAgentId === agent.id;

  // Resolve mode from config
  const config = resolveAgentConfig(props.configForm, agent.id);
  const mode = (config.entry?.tools?.profile as AgentMode) ?? "hybrid";
  const model = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : resolveModelLabel(config.defaults?.model);

  const statusClass =
    activity.status === "active"
      ? "chip-ok"
      : activity.status === "paused"
        ? "chip-warn"
        : activity.status === "error"
          ? "chip-danger"
          : "";

  const lastActivityText = activity.lastActivityAt
    ? formatRelativeTimestamp(activity.lastActivityAt)
    : "No recent activity";

  return html`
    <div class="agent-card ${isSelected ? "agent-card--selected" : ""}">
      <div class="agent-card-header">
        <div class="agent-avatar agent-avatar--lg">
          ${emoji || displayName.slice(0, 1)}
        </div>
        <div class="agent-card-info">
          <div class="agent-card-title">${displayName}</div>
          <div class="chip-row" style="margin-top: 6px;">
            <span class="chip ${statusClass}">${activity.status}</span>
            <span class="chip">${mode}</span>
          </div>
        </div>
      </div>

      <div class="agent-card-meta">
        <div class="agent-card-meta-row">
          <span class="muted">Model:</span>
          <span class="mono">${model}</span>
        </div>
        <div class="agent-card-meta-row">
          <span class="muted">Tasks:</span>
          <span>${activity.tasksRunning} running · ${activity.tasksQueued} queued</span>
        </div>
        <div class="agent-card-meta-row">
          <span class="muted">Last:</span>
          <span>${lastActivityText}</span>
        </div>
      </div>

      ${isAutonomous(agent, props.configForm)
        ? html`
            <div class="agent-card-tasks">
              <div class="muted" style="font-size: 11px; margin-bottom: 6px;">Autonomous Tasks:</div>
              <div class="chip-row">
                ${AUTONOMOUS_TASK_OPTIONS.slice(0, 2).map((task) =>
                  html`<span class="chip chip--sm">${task.label}</span>`,
                )}
              </div>
            </div>
          `
        : nothing
      }

      <div class="agent-card-actions">
        <button
          class="btn btn--sm primary"
          @click=${() => props.onOpenAgentChat(agent.id)}
        >
          Chat
        </button>
        <button
          class="btn btn--sm"
          @click=${() => props.onSelectAgent(agent.id)}
        >
          Settings
        </button>
        <button
          class="btn btn--sm"
          @click=${() => props.onPauseAgent(agent.id)}
        >
          ${activity.status === "paused" ? "Resume" : "Pause"}
        </button>
        <button
          class="btn btn--sm"
          @click=${() => props.onViewAgentLogs(agent.id)}
        >
          View Logs
        </button>
      </div>
    </div>
  `;
}

/**
 * Check if an agent is in autonomous mode based on its config
 */
function isAutonomous(
  agent: AgentsListResult["agents"][number],
  configForm: Record<string, unknown> | null,
): boolean {
  const config = resolveAgentConfig(configForm, agent.id);
  const mode = (config.entry?.tools?.profile as string) ?? "";
  return mode.toLowerCase() === "autonomous";
}
