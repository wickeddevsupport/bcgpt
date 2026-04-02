import { html, nothing } from "lit";
import type { AppViewState } from "./app-view-state.ts";
import type { UsageState } from "./controllers/usage.ts";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { refreshChat } from "./app-chat.ts";
import {
  activateChatSession,
  buildNewAgentSessionKey,
  buildNewSessionLabel,
  renderChatControls,
  renderTab,
  renderThemeToggle,
} from "./app-render.helpers.ts";
import { loadAgentFileContent, loadAgentFiles, saveAgentFile } from "./controllers/agent-files.ts";
import { loadAgentIdentities, loadAgentIdentity } from "./controllers/agent-identity.ts";
import { loadAgentSkills } from "./controllers/agent-skills.ts";
import { createAgentListRow, loadAgents, upsertAgentsListResult } from "./controllers/agents.ts";
import { loadChannels } from "./controllers/channels.ts";
import {
  applyConfig,
  loadConfig,
  runUpdate,
  saveConfig,
  updateConfigFormValue,
  removeConfigFormValue,
} from "./controllers/config.ts";
import {
  loadCronRuns,
  toggleCronJob,
  runCronJob,
  removeCronJob,
  addCronJob,
} from "./controllers/cron.ts";
import { loadDebug, callDebugMethod } from "./controllers/debug.ts";
import {
  approveDevicePairing,
  loadDevices,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
} from "./controllers/devices.ts";
import {
  loadExecApprovals,
  removeExecApprovalsFormValue,
  saveExecApprovals,
  updateExecApprovalsFormValue,
} from "./controllers/exec-approvals.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadPresence } from "./controllers/presence.ts";
import { deleteSession, loadSessions, patchSession } from "./controllers/sessions.ts";
import {
  installSkill,
  loadSkills,
  saveSkillApiKey,
  updateSkillEdit,
  updateSkillEnabled,
} from "./controllers/skills.ts";
import { loadUsage, loadSessionTimeSeries, loadSessionLogs } from "./controllers/usage.ts";
import { loadWorkflowRuns } from "./controllers/pmos-workflows.ts";
import { canManagePmosMembers } from "./controllers/pmos-admin.ts";
import { isPmosSignupEnabled } from "./controllers/pmos-auth.ts";
import { DEFAULT_AGENT_WORKSPACE_PATH } from "./app-defaults.ts";
import type { PmosModelProvider } from "./controllers/pmos-model-auth.ts";
import { icons } from "./icons.ts";
import {
  normalizeBasePath,
  pathForTab,
  TAB_GROUPS,
  subtitleForTab,
  titleForTab,
  type Tab,
} from "./navigation.ts";
import { buildOpsUiConnectionsUrl, buildOpsUiEmbedUrl } from "./controllers/pmos-embed.ts";

// Module-scope debounce for usage date changes (avoids type-unsafe hacks on state object)
let usageDateDebounceTimeout: number | null = null;
const debouncedLoadUsage = (state: UsageState) => {
  if (usageDateDebounceTimeout) {
    clearTimeout(usageDateDebounceTimeout);
  }
  usageDateDebounceTimeout = window.setTimeout(() => void loadUsage(state), 400);
};
import {
  DEFAULT_CREATE_AGENT_FORM,
  renderAgents,
  type AgentMode,
  type CreateAgentFormData,
} from "./views/agents.ts";
import {
  buildFallbackSoul,
  loadArchetypeSoul,
  type AgentArchetype,
  type ModelTier,
} from "./views/agents-catalog.ts";
import { renderAdmin } from "./views/admin.ts";
import { renderAutomations } from "./views/automations.ts";
import { renderDashboard } from "./views/dashboard.ts";
import { renderChannels } from "./views/channels.ts";
import { renderChat, type ChatProps } from "./views/chat.ts";
import { renderCommandCenter } from "./views/command-center.ts";
import { renderConfig } from "./views/config.ts";
import { renderConnections } from "./views/connections.ts";
import { renderCron } from "./views/cron.ts";
import { renderOnboarding } from "./views/onboarding.ts";
import { renderDebug } from "./views/debug.ts";
import { renderExecApprovalPrompt } from "./views/exec-approval.ts";
import { renderFigma } from "./views/figma.ts";
import { renderGatewayUrlConfirmation } from "./views/gateway-url-confirmation.ts";
import { renderIntegrations } from "./views/integrations.ts";
import { renderInstances } from "./views/instances.ts";
import { renderLogs } from "./views/logs.ts";
import { renderModels } from "./views/models.ts";
import { renderNodes } from "./views/nodes.ts";
import { renderOverview } from "./views/overview.ts";
import { renderSessions } from "./views/sessions.ts";
import { renderSkills } from "./views/skills.ts";
import { renderUsage } from "./views/usage.ts";

const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;
const LOCAL_PAGE_HEADER_TABS = new Set<Tab>(["connections", "figma", "command-center", "usage"]);

function shouldRenderGlobalContentHeader(tab: Tab): boolean {
  return !LOCAL_PAGE_HEADER_TABS.has(tab);
}

function resolveAssistantAvatarUrl(state: AppViewState): string | undefined {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) {
    return undefined;
  }
  if (AVATAR_DATA_RE.test(candidate) || AVATAR_HTTP_RE.test(candidate)) {
    return candidate;
  }
  return identity?.avatarUrl;
}

function canAccessTab(state: AppViewState, tab: Tab): boolean {
  const role = state.pmosAuthUser?.role ?? null;
  if (!role) {
    return false;
  }
  if (role === "super_admin") {
    return true;
  }
  if (tab === "debug" || tab === "logs" || tab === "nodes") {
    return false;
  }
  return true;
}

function getObjectAtPath(source: unknown, path: string[]): unknown {
  let cursor: unknown = source;
  for (const part of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function hasConfiguredModelAuth(config: unknown): boolean {
  const hasSecret = (value: unknown): boolean =>
    typeof value === "string" && value.trim().length > 0;

  const explicitPaths = [
    ["providers", "openai", "apiKey"],
    ["providers", "anthropic", "apiKey"],
    ["providers", "google", "apiKey"],
    ["providers", "gemini", "apiKey"],
    ["providers", "glm", "apiKey"],
    ["providers", "openrouter", "apiKey"],
    ["providers", "kilo", "apiKey"],
    ["env", "OPENAI_API_KEY"],
    ["env", "ANTHROPIC_API_KEY"],
    ["env", "GEMINI_API_KEY"],
    ["env", "ZAI_API_KEY"],
    ["env", "OPENROUTER_API_KEY"],
    ["env", "vars", "OPENAI_API_KEY"],
    ["env", "vars", "ANTHROPIC_API_KEY"],
    ["env", "vars", "GEMINI_API_KEY"],
    ["env", "vars", "ZAI_API_KEY"],
    ["env", "vars", "OPENROUTER_API_KEY"],
    ["llm", "providers", "openai", "apiKey"],
    ["llm", "providers", "anthropic", "apiKey"],
    ["llm", "providers", "google", "apiKey"],
    ["llm", "providers", "gemini", "apiKey"],
    ["llm", "providers", "glm", "apiKey"],
    ["llm", "providers", "openrouter", "apiKey"],
    ["model", "apiKey"],
  ];
  for (const path of explicitPaths) {
    const value = getObjectAtPath(config, path);
    if (hasSecret(value)) {
      return true;
    }
  }
  const modelProviders = getObjectAtPath(config, ["models", "providers"]);
  if (modelProviders && typeof modelProviders === "object" && !Array.isArray(modelProviders)) {
    for (const providerConfig of Object.values(modelProviders as Record<string, unknown>)) {
      if (!providerConfig || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
        continue;
      }
      if (hasSecret((providerConfig as Record<string, unknown>).apiKey)) {
        return true;
      }
    }
  }
  return false;
}

function toAgentId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toWorkspaceScopedAgentWorkspacePath(workspaceId: string, agentId: string): string {
  const ws = workspaceId.trim();
  const id = agentId.trim() || "assistant";
  return `~/.openclaw/workspaces/${ws}/${id}`;
}

function extractAvailableSkillNames(
  report: { skills?: Array<{ name?: string | null } | null> } | null | undefined,
): string[] {
  const entries = Array.isArray(report?.skills) ? report.skills : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push(name);
  }
  return result;
}

function resolveAvailableSkillNames(state: AppViewState): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of [
    ...state.availableSkills,
    ...extractAvailableSkillNames(state.skillsReport),
    ...extractAvailableSkillNames(state.agentSkillsReport),
  ]) {
    const normalized = name.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildDefaultCreateAgentForm(state: AppViewState, agentId = "assistant"): CreateAgentFormData {
  const wsId = state.pmosAuthUser?.workspaceId?.trim() ?? "";
  const isWorkspaceScopedUser = Boolean(wsId);
  return {
    ...DEFAULT_CREATE_AGENT_FORM,
    skills: resolveAvailableSkillNames(state),
    workspace: isWorkspaceScopedUser
      ? toWorkspaceScopedAgentWorkspacePath(wsId, agentId)
      : DEFAULT_AGENT_WORKSPACE_PATH,
  };
}

function findConfigAgentEntry(
  config: Record<string, unknown> | null,
  agentId: string,
): Record<string, unknown> | null {
  const agents = (config?.agents as { list?: unknown } | undefined)?.list;
  if (!Array.isArray(agents)) {
    return null;
  }
  const entry = agents.find((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const id = (item as { id?: unknown }).id;
    return typeof id === "string" && id === agentId;
  });
  return entry && typeof entry === "object" && !Array.isArray(entry)
    ? (entry as Record<string, unknown>)
    : null;
}

function resolveModelTier(tier: ModelTier, availableModels: string[]): string {
  if (availableModels.length === 0) return "";
  const fast = availableModels.find((m) => /mini|small|flash|haiku|nano/i.test(m));
  const reasoning = availableModels.find((m) => /opus|o1|o3|pro|ultra|large/i.test(m));
  const balanced = availableModels.find((m) =>
    /gpt-4|sonnet|gemini|claude/i.test(m) && !/mini|flash|haiku/i.test(m),
  );
  switch (tier) {
    case "fast": return fast ?? availableModels[0] ?? "";
    case "reasoning": return reasoning ?? balanced ?? availableModels[0] ?? "";
    case "balanced": return balanced ?? availableModels[0] ?? "";
    default: return "";
  }
}

async function resolveArchetypeSoulContent(
  archetype: AgentArchetype,
): Promise<{ content: string; warning: string | null }> {
  try {
    return {
      content: await loadArchetypeSoul(archetype),
      warning: null,
    };
  } catch {
    return {
      content: buildFallbackSoul(archetype),
      warning: "Loaded the built-in persona summary because the full upstream profile was unavailable.",
    };
  }
}

function extractAgentModelRef(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const primary = (value as { primary?: unknown }).primary;
    return typeof primary === "string" ? primary.trim() : "";
  }
  return "";
}

function mapToolsProfileToMode(profile: unknown): "autonomous" | "interactive" | "hybrid" {
  if (typeof profile !== "string") {
    return "hybrid";
  }
  const normalized = profile.trim().toLowerCase();
  if (normalized === "full") {
    return "autonomous";
  }
  if (normalized === "messaging") {
    return "interactive";
  }
  return "hybrid";
}

function renderAuthScreen(state: AppViewState) {
  const loading = state.pmosAuthLoading;
  const signupEnabled = isPmosSignupEnabled();
  const isSignup = signupEnabled && state.pmosAuthMode === "signup";
  const emailValid = state.pmosAuthEmail.includes("@") && state.pmosAuthEmail.includes(".");
  const passwordValid = state.pmosAuthPassword.length >= 8;
  const canSubmit = !loading && emailValid && passwordValid;
  return html`
    <div class="pmos-auth-shell">
      <div class="pmos-auth-card">
        <div class="pmos-auth-brand">
          <img
            src=${state.basePath ? `${state.basePath}/wicked-os-logo.svg` : "/wicked-os-logo.svg"}
            alt="Wicked OS"
          />
        </div>
        <div class="pmos-auth-title">${isSignup ? "Create your workspace" : "Sign in to Wicked OS"}</div>
        <div class="pmos-auth-subtitle">
          ${isSignup
            ? "First account becomes super admin. Next signups become workspace admins."
            : signupEnabled
              ? "Use your PMOS account to access your workspace and agents."
              : "Use your PMOS account to access your workspace and agents. Account creation is currently disabled."}
        </div>
        <form
          class="pmos-auth-form"
          @submit=${(event: Event) => {
            event.preventDefault();
            void state.handlePmosAuthSubmit();
          }}
        >
          ${isSignup
            ? html`
                <label class="field">
                  <span>Name</span>
                  <input
                    .value=${state.pmosAuthName}
                    @input=${(event: Event) =>
                      (state.pmosAuthName = (event.target as HTMLInputElement).value)}
                    autocomplete="name"
                    placeholder="Your name"
                    required
                  />
                </label>
              `
            : nothing}
          <label class="field">
            <span>Email</span>
            <input
              .value=${state.pmosAuthEmail}
              @input=${(event: Event) =>
                (state.pmosAuthEmail = (event.target as HTMLInputElement).value)}
              autocomplete="email"
              placeholder="you@company.com"
              required
            />
          </label>
          <label class="field">
            <span>Password</span>
            <input
              type="password"
              .value=${state.pmosAuthPassword}
              @input=${(event: Event) =>
                (state.pmosAuthPassword = (event.target as HTMLInputElement).value)}
              autocomplete=${isSignup ? "new-password" : "current-password"}
              placeholder="At least 8 characters"
              required
            />
          </label>
          ${state.pmosAuthError ? html`<div class="pill danger">${state.pmosAuthError}</div>` : nothing}
          ${state.pmosAuthEmail.length > 0 && !emailValid ? html`<div class="muted" style="font-size:12px;margin-top:4px;">Enter a valid email address.</div>` : nothing}
          ${state.pmosAuthPassword.length > 0 && !passwordValid ? html`<div class="muted" style="font-size:12px;margin-top:4px;">Password must be at least 8 characters.</div>` : nothing}
          <button class="button primary" type="submit" ?disabled=${!canSubmit}>
            ${loading ? "Please wait..." : isSignup ? "Create account" : "Sign in"}
          </button>
        </form>
        <div class="pmos-auth-switch">
          ${!signupEnabled
            ? html`Account creation is currently disabled.`
            : isSignup
            ? html`
                Already have an account?
                <button class="link-button" @click=${() => (state.pmosAuthMode = "signin")}>
                  Sign in
                </button>
              `
            : html`
                New to Wicked OS?
                <button class="link-button" @click=${() => (state.pmosAuthMode = "signup")}>
                  Create account
                </button>
              `}
        </div>
      </div>
    </div>
  `;
}

export function renderApp(state: AppViewState) {
  if (state.pmosAuthLoading) {
    return html`
      <div class="pmos-auth-shell">
        <div class="pmos-auth-card">
          <div class="pmos-auth-brand">
            <img
              src=${state.basePath ? `${state.basePath}/wicked-os-logo.svg` : "/wicked-os-logo.svg"}
              alt="Wicked OS"
            />
          </div>
          <div class="pmos-auth-title">Wicked OS</div>
          <div class="pmos-auth-subtitle">Restoring your session...</div>
        </div>
      </div>
    `;
  }

  if (!state.pmosAuthAuthenticated) {
    return renderAuthScreen(state);
  }

  const presenceCount = state.presenceEntries.length;
  const sessionsCount = state.sessionsResult?.count ?? null;
  const cronNext = state.cronStatus?.nextWakeAtMs ?? null;
  const chatDisabledReason = state.connected ? null : "Disconnected from gateway.";
  const isChat = state.tab === "chat";
  const isDashboard = state.tab === "dashboard" && !state.onboarding;
  const chatFocus = isChat && (state.settings.chatFocusMode || state.onboarding);
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;
  const configValue =
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const basePath = normalizeBasePath(state.basePath ?? "");
  const tabAllowed = canAccessTab(state, state.tab);
  const resolvedAgentId =
    state.agentsSelectedId ??
    state.agentsList?.defaultId ??
    state.agentsList?.agents?.[0]?.id ??
    null;
  const agentList = state.agentsList?.agents ?? [];
  const chatSessionParsed = parseAgentSessionKey(state.sessionKey);
  const agentId = chatSessionParsed?.agentId ?? null;
  const agent = agentId ? (agentList.find((entry) => entry.id === agentId) ?? null) : null;
  const selectedAgentIdentity = agentId ? state.agentIdentityById[agentId] : undefined;
  const workflowsQuery = (state.apFlowsQuery ?? "").trim().toLowerCase();
  const workflowsFiltered = workflowsQuery
    ? (state.apFlows ?? []).filter((flow) =>
        `${flow.displayName ?? ""} ${flow.id}`.toLowerCase().includes(workflowsQuery),
      )
    : (state.apFlows ?? []);
  const selectedWorkflow =
    state.apFlowSelectedId && state.apFlows
      ? state.apFlows.find((flow) => flow.id === state.apFlowSelectedId) ?? null
      : null;
  const opsProjectId =
    state.pmosOpsProvisioningResult?.projectId ?? state.pmosConnectorsStatus?.ops?.projectId ?? null;
  const workflowEmbedBaseUrl = buildOpsUiEmbedUrl(
    basePath,
    state.apFlowSelectedId,
    opsProjectId,
  );
  const flowConnectionsEmbedBaseUrl = buildOpsUiConnectionsUrl(basePath, opsProjectId);
    const figmaBaseUrl = (state.pmosFigmaUrl || state.pmosConnectorsStatus?.figma?.url || "https://fm.wickedlab.io")
    .replace(/\/+$/, "");
  const figmaEmbedBaseUrl = `${figmaBaseUrl}/?pmosEmbed=1&pmosParentOrigin=${encodeURIComponent(
    typeof window !== "undefined" ? window.location.origin : "",
  )}`;
  const figmaAuthUrl = `${figmaBaseUrl}/auth/figma?pmosEmbed=1&pmosParentOrigin=${encodeURIComponent(
    typeof window !== "undefined" ? window.location.origin : "",
  )}`;
  const showGlobalContentHeader = shouldRenderGlobalContentHeader(state.tab);
  const showContentHeader = showGlobalContentHeader || Boolean(state.lastError) || isChat;
  const sessionDefaults =
    (state.hello?.snapshot as { sessionDefaults?: { mainKey?: string } } | undefined)
      ?.sessionDefaults ?? null;
  const chatMainKey = sessionDefaults?.mainKey?.trim() || "main";
  const openAgentChat = async (
    agentId: string,
    opts?: { newSession?: boolean },
  ) => {
    state.agentsSelectedId = agentId;
    const targetKey = opts?.newSession
      ? buildNewAgentSessionKey(agentId)
      : `agent:${agentId}:${chatMainKey}`;
    const agentName =
      state.agentsList?.agents.find((entry) => entry.id === agentId)?.identity?.name?.trim() ||
      state.agentsList?.agents.find((entry) => entry.id === agentId)?.name?.trim() ||
      agentId;
    const activated = await activateChatSession(state, targetKey, {
      ensureExists: true,
      label: opts?.newSession ? buildNewSessionLabel(agentName) : null,
      syncUrl: false,
    });
    if (!activated) {
      return;
    }
    state.setTab("chat");
  };
  const createNewChatSession = async () => {
    const currentAgentId =
      parseAgentSessionKey(state.sessionKey)?.agentId?.trim() ||
      state.assistantAgentId?.trim() ||
      state.agentsList?.defaultId?.trim() ||
      state.agentsList?.agents[0]?.id?.trim() ||
      "";
    if (!currentAgentId) {
      return;
    }
    await openAgentChat(currentAgentId, { newSession: true });
  };

  // Auto-exit onboarding once the user has saved an AI key (Step 3 complete)
  if (state.onboarding && state.pmosModelConfigured) {
    state.onboarding = false;
    state.setTab("chat");
  }

  // Build shared chat props for all chat surfaces (chat tab + inline panels).
  const chatProps: ChatProps = {
    sessionKey: state.sessionKey,
    onSessionKeyChange: (next: string) => {
      void activateChatSession(state, next, { replaceHistory: true });
    },
    thinkingLevel: state.chatThinkingLevel,
    showThinking,
    loading: state.chatLoading,
    sending: state.chatSending,
    activeRunId: state.chatRunId,
    canAbort: Boolean(state.chatRunId),
    compactionStatus: state.compactionStatus,
    assistantAvatarUrl: chatAvatarUrl,
    messages: state.chatMessages,
    toolMessages: state.chatToolMessages,
    stream: state.chatStream,
    streamStartedAt: state.chatStreamStartedAt,
    draft: state.chatMessage,
    queue: state.chatQueue,
    connected: state.connected,
    canSend: state.connected,
    disabledReason: chatDisabledReason,
    error: state.lastError,
    sessions: state.sessionsResult,
    focusMode: chatFocus,
    refreshing: state.chatManualRefreshInFlight,
    onRefresh: async () => {
      if (state.chatManualRefreshInFlight) {
        return;
      }
      state.chatManualRefreshInFlight = true;
      state.resetToolStream();
      try {
        await refreshChat(state, { scheduleScroll: false });
      } finally {
        state.chatManualRefreshInFlight = false;
      }
    },
    onToggleFocusMode: () => {
      if (state.onboarding) {
        return;
      }
      state.applySettings({
        ...state.settings,
        chatFocusMode: !state.settings.chatFocusMode,
      });
    },
    onChatScroll: (event) => state.handleChatScroll(event),
    onDraftChange: (next: string) => (state.chatMessage = next),
    attachments: state.chatAttachments,
    onAttachmentsChange: (next) => (state.chatAttachments = next),
    onSend: () => void state.handleSendChat(),
onAbort: () => void state.handleAbortChat(),
    onQueueRemove: (id) => state.removeQueuedMessage(id),
    onNewSession: () => void createNewChatSession(),
    showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
    onScrollToBottom: () => state.scrollToBottom(),
    sidebarOpen: state.sidebarOpen,
    sidebarContent: state.sidebarContent,
    sidebarError: state.sidebarError,
    splitRatio: state.splitRatio,
    onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
    onCloseSidebar: () => state.handleCloseSidebar(),
    onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
    assistantName: state.assistantName,
    assistantAvatar: state.assistantAvatar,
    agentId: agentId,
    agentName: agent?.name ?? agent?.identity?.name ?? selectedAgentIdentity?.name ?? null,
    agentEmoji: agent?.identity?.emoji ?? selectedAgentIdentity?.emoji ?? null,
    agentTheme: agent?.identity?.theme ?? null,
    headerCollapsed: state.chatHeaderCollapsed,
    onViewMemory: agentId
      ? () => {
          state.agentsSelectedId = agentId;
          state.agentsPanel = "files";
          state.setTab("agents");
        }
      : undefined,
    onToggleHeaderCollapsed: () => {
      state.chatHeaderCollapsed = !state.chatHeaderCollapsed;
    },
  };

  // Workflows tab uses a dedicated assistant flow (`pmos.workflow.assist` / `pmos.workflow.confirm`)
  // and should not reuse the global chat session state.
  const workflowChatProps: ChatProps = {
    ...chatProps,
    sessionKey: "workflow-assistant",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    loading: false,
    sending: state.workflowChatSending,
    activeRunId: null,
    canAbort: false,
    compactionStatus: null,
    assistantAvatarUrl: null,
    messages: state.workflowChatMessages,
    toolMessages: [],
    stream: state.workflowChatStream,
    streamStartedAt: state.workflowChatStreamStartedAt,
    draft: state.workflowChatDraft,
    queue: [],
    error: null,
    sessions: null,
    focusMode: false,
    sidebarOpen: false,
    sidebarContent: null,
    sidebarError: null,
    onRefresh: () => Promise.resolve(),
    onToggleFocusMode: () => undefined,
    onChatScroll: undefined,
    onDraftChange: (next: string) => {
      state.workflowChatDraft = next;
    },
    attachments: [],
    onAttachmentsChange: undefined,
    onSend: () => void state.handleWorkflowChatSend(),
    onAbort: undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => {
      state.workflowChatDraft = "";
      state.workflowChatMessages = [];
      state.workflowChatStream = null;
      state.workflowChatStreamStartedAt = null;
      state.workflowChatPendingWorkflow = null;
      state.workflowChatSteps = [];
    },
    showNewMessages: false,
    onScrollToBottom: undefined,
    onOpenSidebar: undefined,
    onCloseSidebar: undefined,
    onSplitRatioChange: undefined,
    assistantName: "AI Workflow Assistant",
    assistantAvatar: null,
    agentId: null,
    agentName: null,
    agentEmoji: null,
    agentTheme: null,
    onViewMemory: undefined,
  };

  return html`
    <div class="shell ${isChat ? "shell--chat" : ""} ${chatFocus ? "shell--chat-focus" : ""} ${state.settings.navCollapsed ? "shell--nav-collapsed" : ""} ${state.onboarding ? "shell--onboarding" : ""}">
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="nav-collapse-toggle"
            @click=${() =>
              state.applySettings({
                ...state.settings,
                navCollapsed: !state.settings.navCollapsed,
              })}
            title="${state.settings.navCollapsed ? "Expand sidebar" : "Collapse sidebar"}"
            aria-label="${state.settings.navCollapsed ? "Expand sidebar" : "Collapse sidebar"}"
          >
            <span class="nav-collapse-toggle__icon">${icons.menu}</span>
          </button>
          <div class="brand">
            <div class="brand-logo brand-logo--wordmark">
              <img src=${basePath ? `${basePath}/wicked-os-logo.svg` : "/wicked-os-logo.svg"} alt="Wicked OS" />
            </div>
          </div>
        </div>
        <div class="topbar-status">
          ${state.pmosAuthUser
            ? html`
                <div class="pill">
                  <span>${state.pmosAuthUser.role === "super_admin" ? "Super Admin" : "Workspace Admin"}</span>
                  <span class="mono">${state.pmosAuthUser.email}</span>
                </div>
              `
            : nothing}
          <div class="pill">
            <span class="statusDot ${state.connected ? "ok" : ""}"></span>
            <span>Health</span>
            <span class="mono">${state.connected ? "OK" : "Offline"}</span>
          </div>
          ${state.pmosAuthUser?.role === "super_admin"
            ? html`<button class="button" @click=${() => state.setTab("admin")} title="Workspace admin panel">Admin Panel</button>`
            : nothing}
          <button
            class="button"
            @click=${() => { state.notificationsOpen = !state.notificationsOpen; }}
            title="Activity feed"
            style="position:relative;"
          >
            🔔
            ${state.pmosTraceEvents.length > 0
              ? html`<span style="position:absolute;top:-4px;right:-4px;background:var(--color-danger,#e74c3c);color:#fff;border-radius:50%;width:16px;height:16px;font-size:10px;display:flex;align-items:center;justify-content:center;line-height:1;">${state.pmosTraceEvents.length > 9 ? "9+" : state.pmosTraceEvents.length}</span>`
              : nothing}
          </button>
          <button class="button" @click=${() => void state.handlePmosAuthLogout()}>Sign out</button>
          ${renderThemeToggle(state)}
        </div>
      </header>
      <aside class="nav ${state.settings.navCollapsed ? "nav--collapsed" : ""}">
        ${TAB_GROUPS.map((group) => {
          const visibleTabs = group.tabs.filter((tab) => canAccessTab(state, tab));
          if (visibleTabs.length === 0) {
            return nothing;
          }
          const isGroupCollapsed = state.settings.navGroupsCollapsed[group.label] ?? false;
          const hasActiveTab = visibleTabs.some((tab) => tab === state.tab);
          return html`
            <div class="nav-group ${isGroupCollapsed && !hasActiveTab ? "nav-group--collapsed" : ""}">
              <button
                class="nav-label"
                @click=${() => {
                  const next = { ...state.settings.navGroupsCollapsed };
                  next[group.label] = !isGroupCollapsed;
                  state.applySettings({
                    ...state.settings,
                    navGroupsCollapsed: next,
                  });
                }}
                aria-expanded=${!isGroupCollapsed}
              >
                <span class="nav-label__text">${group.label}</span>
                <span class="nav-label__chevron">${isGroupCollapsed ? "+" : "-"}</span>
              </button>
              <div class="nav-group__items">
                ${visibleTabs.map((tab) => renderTab(state, tab))}
              </div>
            </div>
          `;
        })}
        <div class="nav-group nav-group--links">
          <div class="nav-label nav-label--static">
            <span class="nav-label__text">Resources</span>
          </div>
          <div class="nav-group__items">
            <a
              class="nav-item nav-item--external"
              href=${state.pmosBcgptUrl.replace(/\/$/, "") + "/connect"}
              target="_blank"
              rel="noreferrer"
              title="Connect Basecamp via BCGPT (opens in new tab)"
            >
              <span class="nav-item__icon" aria-hidden="true">${icons.book}</span>
              <span class="nav-item__text">Basecamp Connect</span>
            </a>
            <button
              class="nav-item nav-item--external"
              type="button"
              @click=${() => state.setTab("automations")}
              title="Open embedded Workflows editor"
            >
              <span class="nav-item__icon" aria-hidden="true">${icons.link}</span>
              <span class="nav-item__text">Workflows Editor</span>
            </button>
            <a
              class="nav-item nav-item--external"
              href=${state.pmosBcgptUrl}
              target="_blank"
              rel="noreferrer"
              title="Project docs (opens in new tab)"
            >
              <span class="nav-item__icon" aria-hidden="true">${icons.book}</span>
              <span class="nav-item__text">Docs</span>
            </a>
          </div>
        </div>
      </aside>
      <main class="content ${isChat ? "content--chat" : ""} ${isDashboard ? "content--dashboard" : ""}">
        ${showContentHeader
          ? html`
              <section class="content-header ${showGlobalContentHeader ? "" : "content-header--compact"} ${isChat ? "content-header--chat" : ""} ${isChat && state.chatHeaderCollapsed ? "content-header--chat-collapsed" : ""}">
                <div class="content-header__intro">
                  ${showGlobalContentHeader ? html`<div class="page-title">${titleForTab(state.tab)}</div>` : nothing}
                  ${showGlobalContentHeader ? html`<div class="page-sub">${subtitleForTab(state.tab)}</div>` : nothing}
                </div>
                <div class="page-meta">
                  ${state.lastError ? html`<div class="pill danger">${state.lastError}</div>` : nothing}
                  ${isChat ? renderChatControls(state) : nothing}
                </div>
              </section>
            `
          : nothing}
        ${!tabAllowed
          ? html`
              <section class="card">
                <div class="stack">
                  <div class="section-title">Access Restricted</div>
                  <div class="muted">
                    This section is restricted to super-admin accounts. Use Dashboard or Chat for
                    normal workspace operations.
                  </div>
                  <div class="row">
                    <button class="button" @click=${() => state.setTab("dashboard")}>
                      Go to dashboard
                    </button>
                  </div>
                </div>
              </section>
            `
          : html`

        ${
          state.tab === "dashboard"
            ? state.onboarding
              ? renderOnboarding({
                  modelAuthConfigured: hasConfiguredModelAuth(configValue),
                  onSkip: () => { state.onboarding = false; },
                  onComplete: () => { state.onboarding = false; state.setTab("chat"); },
                  modelProvider: state.pmosModelProvider,
                  modelId: state.pmosModelId,
                  modelApiKeyDraft: state.pmosModelApiKeyDraft,
                  modelSaving: state.pmosModelSaving,
                  modelError: state.pmosModelError,
                  modelConfigured: state.pmosModelConfigured,
                  onModelProviderChange: (p) => state.handlePmosModelProviderChange(p as PmosModelProvider),
                  onModelIdChange: (id) => { state.pmosModelId = id; },
                  onModelApiKeyChange: (key) => { state.pmosModelApiKeyDraft = key; },
                  onModelSave: () => state.handlePmosModelSave(),
                })
              : renderDashboard({
                connected: state.connected,
                settings: state.settings,
                lastError: state.lastError,
                connectorsLoading: state.pmosConnectorsLoading,
                connectorsError: state.pmosConnectorsError,
                connectorsStatus: state.pmosConnectorsStatus,
                flows: state.apFlows ?? [],
                runs: state.apRuns ?? [],
                traceEvents: state.pmosTraceEvents,
                integrationsHref: pathForTab("integrations", state.basePath),
                automationsHref: pathForTab("automations", state.basePath),
                chatHref: pathForTab("chat", state.basePath),
                configHref: pathForTab("config", state.basePath),
                modelAuthConfigured: hasConfiguredModelAuth(configValue),
                currentModel: state.pmosModelConfigured ? `${state.pmosModelProvider}/${state.pmosModelId}` : undefined,
                currentModelProvider: state.pmosModelConfigured ? state.pmosModelProvider : undefined,
                onSettingsChange: (next) => state.applySettings(next),
                onConnect: () => state.connect(),
                onRefreshConnectors: () => state.handlePmosRefreshConnectors(),
                onRefreshDashboard: () =>
                  Promise.all([
                    loadConfig(state),
                    state.handlePmosRefreshConnectors(),
                    loadAgents(state),
                    loadWorkflowRuns(state as unknown as Parameters<typeof loadWorkflowRuns>[0]),
                  ]).then(() => undefined),
                onNavigateTab: (tab) => state.setTab(tab as Tab),
                onClearTrace: () => state.handlePmosTraceClear(),
                onProvisionOps: () => state.handlePmosProvisionOps(),
                opsProvisioning: state.pmosOpsProvisioning,
                opsProvisioned: Boolean(state.pmosOpsProvisioningResult?.apiKey) || state.pmosConnectorsStatus?.ops?.reachable === true,
                opsProvisioningResult: state.pmosOpsProvisioningResult,
                opsProvisioningError: state.pmosOpsProvisioningError,
                opsManualApiKeyDraft: state.pmosOpsManualApiKeyDraft,
                onOpsManualApiKeyChange: (v: string) => (state.pmosOpsManualApiKeyDraft = v),
                onSaveOpsApiKey: () => state.handlePmosSaveManualOpsKey(),
                // Agent system integration
                agentsList: state.agentsList,
                agentActivityById: state.agentActivityById,
                agentIdentityById: state.agentIdentityById,
                onOpenAgentChat: (agentId: string) => {
                  void openAgentChat(agentId);
                },
                // Inline chat panel
                chatProps,
                // Dashboard tab
                dashboardTab: state.dashboardTab ?? "home",
                onDashboardTabChange: (tab) => { state.dashboardTab = tab; },
                // Quick actions
                onQuickAction: (action) => {
                  if (action === "check-leads") {
                    state.chatMessage = "Check my leads and give me a summary";
                    void state.handleSendChat();
                    state.setTab("chat");
                  } else if (action === "daily-report") {
                    state.chatMessage = "Generate my daily report";
                    void state.handleSendChat();
                    state.setTab("chat");
                  } else if (action === "create-workflow") {
                    state.setTab("automations");
                  } else if (action === "settings") {
                    state.setTab("config");
                  }
                },
              })
            : nothing
        }

        ${
          state.tab === "automations"
            ? html`<div class="tab-panel tab-panel--full-height">
                ${state.pmosOpsProvisioning
                  ? html`<div class="loading-panel" style="display:flex;align-items:center;justify-content:center;height:100%;gap:12px;">
                      <span class="spinner"></span>
                      <span class="muted">Setting up your automation workspace...</span>
                    </div>`
                  : renderAutomations({
                      connected: state.connected,
                      integrationsHref: pathForTab("integrations", state.basePath),
                      projectId: state.pmosOpsProvisioningResult?.projectId ?? "embedded",
                      onOpenIntegrations: () => state.setTab("integrations"),
                      embedUrl:
                        workflowEmbedBaseUrl +
                        (state.workflowEmbedVersion
                          ? `${workflowEmbedBaseUrl.includes("?") ? "&" : "?"}v=${state.workflowEmbedVersion}`
                          : ""),
                      selectedFlowLabel: selectedWorkflow
                        ? selectedWorkflow.displayName ?? selectedWorkflow.id
                        : null,
                      loading: state.apFlowsLoading,
                      error: state.apFlowsError,
                      flowsQuery: state.apFlowsQuery,
                      flows: workflowsFiltered,
                      createName: state.apFlowCreateName,
                      creating: state.apFlowCreateSaving,
                      createError: state.apFlowCreateError,
                      selectedFlowId: state.apFlowSelectedId,
                      flowDetailsLoading: state.apFlowDetailsLoading,
                      flowDetailsError: state.apFlowDetailsError,
                      flowDetails: state.apFlowDetails,
                      renameDraft: state.apFlowRenameDraft,
                      operationDraft: state.apFlowOperationDraft,
                      triggerPayloadDraft: state.apFlowTriggerPayloadDraft,
                      mutating: state.apFlowMutating,
                      mutateError: state.apFlowMutateError,
                      onFlowsQueryChange: (next) => (state.apFlowsQuery = next),
                      onRefresh: () => void state.handlePmosApFlowsLoad(),
                      onCreateNameChange: (next) => (state.apFlowCreateName = next),
                      onCreate: () => void state.handlePmosApFlowCreate(),
                      onSelectFlow: (flowId) => void state.handlePmosApFlowSelect(flowId),
                      onRenameDraftChange: (next) => (state.apFlowRenameDraft = next),
                      onRename: () => void state.handlePmosApFlowRename(),
                      onSetStatus: (status) => void state.handlePmosApFlowSetStatus(status),
                      onPublish: () => void state.handlePmosApFlowPublish(),
                      onDelete: () => void state.handlePmosApFlowDelete(),
                      onOperationDraftChange: (next) => (state.apFlowOperationDraft = next),
                      onApplyOperation: () => void state.handlePmosApFlowApplyOperation(),
                      onTriggerPayloadDraftChange: (next) =>
                        (state.apFlowTriggerPayloadDraft = next),
                      onTriggerWebhook: (opts) => void state.handlePmosApFlowTriggerWebhook(opts),
                      runs: state.apRuns ?? [],
                      runsLoading: state.apRunsLoading,
                      runsError: state.apRunsError,
                      onLoadRuns: () =>
                        void loadWorkflowRuns(
                          state as unknown as Parameters<typeof loadWorkflowRuns>[0],
                        ),
                      templateDeploying: state.apFlowMutating,
                      templateDeployError: state.apFlowMutateError ?? null,
                      templateDeployedOk: state.apFlowTemplateDeployedOk ?? false,
                      onDeployTemplate: async (templateId: string) => {
                        await state.client!.request("pmos.flow.template.deploy", { templateId });
                        void state.handlePmosApFlowsLoad();
                        state.apFlowTemplateDeployedOk = true;
                        setTimeout(() => { state.apFlowTemplateDeployedOk = false; }, 3000);
                      },
                      centerSplitRatio: state.automationsCenterSplitRatio,
                      onCenterSplitResize: (ratio) =>
                        state.handleAutomationsCenterSplitRatioChange(ratio),
                      chatOpen: state.automationsChatOpen,
                      currentModel: state.pmosModelConfigured ? `${state.pmosModelProvider}/${state.pmosModelId}` : undefined,
                      currentModelProvider: state.pmosModelConfigured ? state.pmosModelProvider : undefined,
                      onChatToggle: () => { state.automationsChatOpen = !state.automationsChatOpen; },
                      chatMessages: state.workflowChatMessages,
                      chatDraft: state.workflowChatDraft,
                      chatSending: state.workflowChatSending,
                      onChatDraftChange: (next) => { state.workflowChatDraft = next; },
                      onChatSend: () => void state.handleWorkflowChatSend(),
                      pendingWorkflow: state.workflowChatPendingWorkflow,
                      onConfirmWorkflow: () => void state.handleWorkflowChatConfirm(),
                      onCancelWorkflow: () => state.handleWorkflowChatCancelWorkflow(),
                      // Full chat props for inline chat panel
                      chatProps: workflowChatProps,
                      chatSteps: state.workflowChatSteps ?? [],
                    })}
              </div>`
            : nothing
        }

        ${
          state.tab === "integrations"
            ? renderIntegrations({
                connected: state.connected,
                saving: state.pmosIntegrationsSaving,
                error: state.pmosIntegrationsError,
                bcgptUrl: state.pmosBcgptUrl,
                bcgptApiKeyDraft: state.pmosBcgptApiKeyDraft,
                connectorsLoading: state.pmosConnectorsLoading,
                connectorsStatus: state.pmosConnectorsStatus,
                connectorsError: state.pmosConnectorsError,
                modelRows: state.pmosModelRows,
                figmaUrl: state.pmosFigmaUrl,
                onBcgptUrlChange: (next) => (state.pmosBcgptUrl = next),
                onFigmaUrlChange: (next) => (state.pmosFigmaUrl = next),
                onBcgptApiKeyDraftChange: (next) => (state.pmosBcgptApiKeyDraft = next),
                onSave: () => state.handlePmosIntegrationsSave(),
                onClearBcgptKey: () => state.handlePmosIntegrationsClearBcgptKey(),
                onRefreshConnectors: () => state.handlePmosRefreshConnectors(),
                onOpenModels: () => state.setTab("models"),
                onOpenAutomations: () => state.setTab("automations"),
                onOpenFigma: () => state.setTab("figma"),
                bcgptSavedOk: state.pmosBcgptSavedOk,
                opsProvisioned: Boolean(state.pmosOpsProvisioningResult?.apiKey) || state.pmosConnectorsStatus?.ops?.reachable === true,
                opsProjectId: state.pmosOpsProvisioningResult?.projectId ?? null,
                opsUiHref: flowConnectionsEmbedBaseUrl,
                basecampSetupPending: state.pmosBasecampSetupPending,
                basecampSetupOk: state.pmosBasecampSetupOk,
                basecampSetupError: state.pmosBasecampSetupError,
                onSetupBasecamp: () => void state.handlePmosSetupBasecampInWorkflowEngine(),
                workflowCredentials: state.pmosRealCredentials ?? undefined,
                workflowCredentialsLoading: state.pmosRealCredentialsLoading,
                workflowCredentialsError: state.pmosRealCredentialsError,
                onRefreshWorkflowCredentials: () => void state.handleLoadRealCredentials(),
              })
            : nothing
        }

        ${
          state.tab === "figma"
            ? renderFigma({
                connected: state.connected,
                figmaUrl: state.pmosFigmaUrl,
                embedUrl:
                  figmaEmbedBaseUrl +
                  (state.pmosFigmaEmbedVersion
                    ? `${figmaEmbedBaseUrl.includes("?") ? "&" : "?"}v=${state.pmosFigmaEmbedVersion}`
                    : ""),
                connectorsLoading: state.pmosConnectorsLoading,
                connectorsError: state.pmosConnectorsError,
                connectorsStatus: state.pmosConnectorsStatus,
                syncing: state.pmosFigmaContextSyncing,
                syncError: state.pmosFigmaContextError,
                syncedOk: state.pmosFigmaContextSyncedOk,
                liveAuthVerified: state.pmosFigmaLiveAuthVerified,
                authUrl: figmaAuthUrl,
                chatProps,
                onSyncContext: () => void state.handlePmosFigmaSyncContext(),
                onOpenAuth: () => state.handlePmosOpenFigmaAuthPopup(),
                onRefresh: () => {
                  state.pmosFigmaEmbedVersion = (state.pmosFigmaEmbedVersion ?? 0) + 1;
                  void state.handlePmosRefreshConnectors();
                },
                onPrepareOfficialMcp: () => void state.handlePmosPrepareFigmaMcp(),
                onOpenIntegrations: () => state.setTab("integrations"),
                onPrefillPrompt: (prompt) => {
                  chatProps.onDraftChange(prompt);
                },
              })
            : nothing
        }

        ${
          state.tab === "models"
            ? renderModels({
                connected: state.connected,
                modelAlias: state.pmosModelAlias,
                modelApiKeyDraft: state.pmosModelApiKeyDraft,
                modelApiKeyEditable: state.pmosModelApiKeyEditable,
                modelApiKeyStored: state.pmosModelApiKeyStored,
                modelBaseUrl: state.pmosModelBaseUrl,
                modelApiType: state.pmosModelApiType,
                modelSaving: state.pmosModelSaving,
                modelConfigured: state.pmosModelConfigured,
                modelError: state.pmosModelError,
                modelSavedOk: state.pmosModelSavedOk,
                modelRefDraft: state.pmosModelRefDraft,
                modelRows: state.pmosModelRows,
                modelCatalogLoading: state.pmosModelCatalogLoading,
                modelCatalogError: state.pmosModelCatalogError,
                modelOptions: state.availableModels,
                agentModelAssignments: state.pmosAgentModelAssignments,
                onModelRefDraftChange: (next) => state.handlePmosModelRefDraftChange(next),
                onModelAliasChange: (next) => {
                  state.pmosModelAlias = next;
                  state.pmosModelError = null;
                },
                onModelApiKeyDraftChange: (next) => {
                  state.pmosModelApiKeyDraft = next;
                  state.pmosModelApiKeyEditable = true;
                  state.pmosModelError = null;
                },
                onModelApiKeyEditToggle: (editable) =>
                  state.handlePmosModelApiKeyEditToggle(editable),
                onModelBaseUrlChange: (next) => {
                  state.pmosModelBaseUrl = next;
                  state.pmosModelError = null;
                },
                onModelApiTypeChange: (next) => {
                  state.pmosModelApiType = next;
                  state.pmosModelError = null;
                },
                onModelSave: () => state.handlePmosModelSave(),
                onModelSaveWithoutActivate: () => state.handlePmosModelSaveWithoutActivate(),
                onModelClearKey: () => state.handlePmosModelClearKey(),
                onModelClearKeyForRef: (ref) => state.handlePmosModelClearKeyForRef(ref),
                onModelEdit: (ref) => state.handlePmosModelEdit(ref),
                onModelActivate: (ref) => state.handlePmosModelActivate(ref),
                onModelDeactivate: (ref) => state.handlePmosModelDeactivate(ref),
                onModelDelete: (ref) => state.handlePmosModelDelete(ref),
                onAssignAgentModel: (agentId, ref) =>
                  state.handlePmosAssignAgentModel(agentId, ref),
              })
            : nothing
        }

        ${
          state.tab === "connections"
            ? (() => {
                return renderConnections({
                  opsProvisioned: Boolean(state.pmosOpsProvisioningResult?.apiKey) || state.pmosConnectorsStatus?.ops?.reachable === true,
                  connectorsLoading: state.pmosConnectorsLoading,
                  connectorsError: state.pmosConnectorsError,
                  credentials: state.pmosRealCredentials ?? [],
                  selectedConnectionId: state.pmosSelectedConnectionId,
                  credentialsLoading: state.pmosRealCredentialsLoading,
                  credentialsError: state.pmosRealCredentialsError,
                  addConnectionUrl:
                    flowConnectionsEmbedBaseUrl +
                    (state.flowConnectionsEmbedVersion
                      ? `${flowConnectionsEmbedBaseUrl.includes("?") ? "&" : "?"}v=${state.flowConnectionsEmbedVersion}`
                      : ""),
                  onRefresh: () => {
                    void state.handleLoadRealCredentials();
                  },
                  onSelectConnection: (connectionId) => {
                    state.pmosSelectedConnectionId = connectionId;
                  },
                  onOpenIntegrations: () => state.setTab("integrations"),
                  onAddConnection: () => {
                    // Open the Flow connections page in a new tab for adding connections
                    const url = flowConnectionsEmbedBaseUrl +
                      (state.flowConnectionsEmbedVersion
                        ? `${flowConnectionsEmbedBaseUrl.includes("?") ? "&" : "?"}v=${state.flowConnectionsEmbedVersion}`
                        : "");
                    window.open(url, "pmos-add-connection", "popup=yes,width=900,height=700,resizable=yes,scrollbars=yes");
                  },
                });
              })()
            : nothing
        }

        ${
          state.tab === "command-center"
            ? renderCommandCenter({
                connected: state.connected,
                loading: state.pmosProjectsLoading,
                error: state.pmosProjectsError ?? state.pmosCommandError,
                snapshot: state.pmosProjectsSnapshot,
                projectSearch: state.pmosProjectSearch,
                viewMode: state.pmosProjectViewMode,
                commandCenterTab: state.pmosCommandCenterTab ?? "overview",
                onCommandCenterTabChange: (tab) => { state.handleCommandCenterTabChange(tab); },
                chatProps,
                selectedProject: state.pmosSelectedProject ?? null,
                projectDetailTab: state.pmosProjectDetailTab ?? "overview",
                projectSectionData: state.pmosProjectSectionData ?? {},
                selectedEntityDetail: state.pmosSelectedEntityDetail ?? null,
                selectedEntityLoading: state.pmosSelectedEntityLoading,
                selectedEntityError: state.pmosSelectedEntityError,
                actionBusy: state.pmosProjectActionBusy,
                actionError: state.pmosProjectActionError,
                actionMessage: state.pmosProjectActionMessage,
                todoDraft: {
                  title: state.pmosTodoDraftTitle,
                  description: state.pmosTodoDraftDescription,
                  list: state.pmosTodoDraftList,
                  dueOn: state.pmosTodoDraftDueOn,
                },
                entityCommentDraft: state.pmosEntityCommentDraft,
                onRefresh: () => state.handlePmosProjectsLoad({ fresh: true }),
                onOpenIntegrations: () => state.setTab("integrations"),
                onOpenWorkflows: () => state.setTab("automations"),
                onPrefillChat: (next) => {
                  chatProps.onDraftChange(next);
                },
                onProjectSearchChange: (next) => {
                  state.pmosProjectSearch = next;
                },
                onViewModeChange: (next) => {
                  state.pmosProjectViewMode = next;
                },
                onSelectProject: (project) => state.handleSelectProject(project),
                onProjectDetailTabChange: (tab) => state.handleProjectDetailTabChange(tab),
                onLoadProjectSection: (projectName, section) =>
                  state.handleLoadProjectSection(projectName, section),
                onOpenItemDetail: (reference) => state.handleOpenProjectEntity(reference),
                onCloseItemDetail: () => state.handleCloseProjectEntity(),
                onTodoDraftChange: (field, value) => state.handlePmosTodoDraftChange(field, value),
                onCreateTodo: () => void state.handleCreateProjectTodo(),
                onToggleTodo: (todoId, completed) => void state.handleToggleProjectTodo(todoId, completed),
                onEntityCommentDraftChange: (value) => state.handlePmosEntityCommentDraftChange(value),
                onCreateEntityComment: () => void state.handleCreateProjectComment(),
              })
            : nothing
        }

        ${
          state.tab === "admin"
            ? renderAdmin({
                connected: state.connected,
                loading: state.pmosAdminLoading,
                saving: state.pmosAdminSaving,
                error: state.pmosAdminError,
                workspaceId: state.pmosWorkspaceId,
                workspaceName: state.pmosWorkspaceName,
                currentUserName: state.pmosCurrentUserName,
                currentUserEmail: state.pmosCurrentUserEmail,
                currentUserRole: state.pmosCurrentUserRole,
                canManageMembers: canManagePmosMembers(state),
                memberDraftName: state.pmosMemberDraftName,
                memberDraftEmail: state.pmosMemberDraftEmail,
                memberDraftRole: state.pmosMemberDraftRole,
                memberDraftStatus: state.pmosMemberDraftStatus,
                members: state.pmosMembers,
                auditEvents: state.pmosAuditEvents,
                onWorkspaceIdChange: (next) => (state.pmosWorkspaceId = next),
                onWorkspaceNameChange: (next) => (state.pmosWorkspaceName = next),
                onCurrentUserNameChange: (next) => (state.pmosCurrentUserName = next),
                onCurrentUserEmailChange: (next) => (state.pmosCurrentUserEmail = next),
                onCurrentUserRoleChange: (next) => (state.pmosCurrentUserRole = next),
                onSave: () =>
                  state.handlePmosAdminSave({
                    action: "pmos.admin.profile.save",
                    target: "workspace",
                  }),
                onRefresh: () => state.handlePmosAdminLoad(),
                onMemberDraftNameChange: (next) => (state.pmosMemberDraftName = next),
                onMemberDraftEmailChange: (next) => (state.pmosMemberDraftEmail = next),
                onMemberDraftRoleChange: (next) => (state.pmosMemberDraftRole = next),
                onMemberDraftStatusChange: (next) => (state.pmosMemberDraftStatus = next),
                onUpsertMember: () => state.handlePmosMemberUpsert(),
                onRemoveMember: (email) => state.handlePmosMemberRemove(email),
                memberRemoveConfirm: state.pmosMemberRemoveConfirm,
                onMemberRemoveConfirmSet: (email) => (state.pmosMemberRemoveConfirm = email),
                isSuperAdmin: state.pmosAuthUser?.role === "super_admin",
                workspacesList: state.pmosWorkspacesList,
                workspacesLoading: state.pmosWorkspacesLoading,
                workspacesError: state.pmosWorkspacesError,
                onLoadWorkspaces: () => void state._loadWorkspacesList(),
                restarting: state.pmosGatewayRestarting,
                restartError: state.pmosGatewayRestartError,
                onRestart: () => void state.handleGatewayRestart(),
                workspaceResetting: state.pmosWorkspaceResetting,
                workspaceResetError: state.pmosWorkspaceResetError,
                workspaceResetResults: state.pmosWorkspaceResetResults,
                onResetAllWorkspaces: () => void state.handleResetAllWorkspaces(),
                passwordCurrentDraft: state.pmosPasswordCurrentDraft,
                passwordNewDraft: state.pmosPasswordNewDraft,
                passwordConfirmDraft: state.pmosPasswordConfirmDraft,
                passwordSaving: state.pmosPasswordSaving,
                passwordError: state.pmosPasswordError,
                passwordSavedOk: state.pmosPasswordSavedOk,
                onPasswordCurrentDraftChange: (next) => (state.pmosPasswordCurrentDraft = next),
                onPasswordNewDraftChange: (next) => (state.pmosPasswordNewDraft = next),
                onPasswordConfirmDraftChange: (next) => (state.pmosPasswordConfirmDraft = next),
                onPasswordChange: () => void state.handlePmosPasswordChange(),
                adminResetTargetEmail: state.pmosAdminResetTargetEmail,
                adminResetPasswordDraft: state.pmosAdminResetPasswordDraft,
                adminResetSaving: state.pmosAdminResetSaving,
                adminResetError: state.pmosAdminResetError,
                adminResetSavedOk: state.pmosAdminResetSavedOk,
                onAdminResetTargetEmailChange: (next) => (state.pmosAdminResetTargetEmail = next),
                onAdminResetPasswordDraftChange: (next) => (state.pmosAdminResetPasswordDraft = next),
                onAdminResetPassword: () => void state.handlePmosAdminResetUserPassword(),
              })
            : nothing
        }

        ${
          state.tab === "overview"
            ? renderOverview({
                connected: state.connected,
                hello: state.hello,
                settings: state.settings,
                password: state.password,
                lastError: state.lastError,
                presenceCount,
                sessionsCount,
                cronEnabled: state.cronStatus?.enabled ?? null,
                cronNext,
                lastChannelsRefresh: state.channelsLastSuccess,
                onSettingsChange: (next) => state.applySettings(next),
                onPasswordChange: (next) => (state.password = next),
                onSessionKeyChange: (next) => {
                  if (state.chatHistoryRecoveryTimer != null) {
                    window.clearTimeout(state.chatHistoryRecoveryTimer);
                    state.chatHistoryRecoveryTimer = null;
                  }
                  if ((state as { compactionClearTimer?: number | null }).compactionClearTimer != null) {
                    window.clearTimeout((state as { compactionClearTimer?: number | null }).compactionClearTimer!);
                    (state as { compactionClearTimer?: number | null }).compactionClearTimer = null;
                  }
                  state.compactionStatus = null;
                  state.sessionKey = next;
                  state.chatMessage = "";
                  state.chatStream = null;
                  state.chatStreamStartedAt = null;
                  state.chatRunId = null;
                  state.chatQueue = [];
                  state.resetToolStream();
                  state.applySettings({
                    ...state.settings,
                    sessionKey: next,
                    lastActiveSessionKey: next,
                  });
                  void state.loadAssistantIdentity();
                },
                onConnect: () => state.connect(),
                onRefresh: () => state.loadOverview(),
              })
            : nothing
        }

        ${
          state.tab === "channels"
            ? renderChannels({
                connected: state.connected,
                loading: state.channelsLoading,
                snapshot: state.channelsSnapshot,
                lastError: state.channelsError,
                lastSuccessAt: state.channelsLastSuccess,
                whatsappMessage: state.whatsappLoginMessage,
                whatsappQrDataUrl: state.whatsappLoginQrDataUrl,
                whatsappConnected: state.whatsappLoginConnected,
                whatsappBusy: state.whatsappBusy,
                configSchema: state.configSchema,
                configSchemaLoading: state.configSchemaLoading,
                configForm: state.configForm,
                configUiHints: state.configUiHints,
                configSaving: state.configSaving,
                configFormDirty: state.configFormDirty,
                nostrProfileFormState: state.nostrProfileFormState,
                nostrProfileAccountId: state.nostrProfileAccountId,
                onRefresh: (probe) => loadChannels(state, probe),
                onWhatsAppStart: (force) => state.handleWhatsAppStart(force),
                onWhatsAppWait: () => state.handleWhatsAppWait(),
                onWhatsAppLogout: () => state.handleWhatsAppLogout(),
                onConfigPatch: (path, value) => updateConfigFormValue(state, path, value),
                onConfigSave: () => state.handleChannelConfigSave(),
                onConfigReload: () => state.handleChannelConfigReload(),
                onNostrProfileEdit: (accountId, profile) =>
                  state.handleNostrProfileEdit(accountId, profile),
                onNostrProfileCancel: () => state.handleNostrProfileCancel(),
                onNostrProfileFieldChange: (field, value) =>
                  state.handleNostrProfileFieldChange(field, value),
                onNostrProfileSave: () => state.handleNostrProfileSave(),
                onNostrProfileImport: () => state.handleNostrProfileImport(),
                onNostrProfileToggleAdvanced: () => state.handleNostrProfileToggleAdvanced(),
              })
            : nothing
        }

        ${
          state.tab === "instances"
            ? renderInstances({
                loading: state.presenceLoading,
                entries: state.presenceEntries,
                lastError: state.presenceError,
                statusMessage: state.presenceStatus,
                onRefresh: () => loadPresence(state),
              })
            : nothing
        }

        ${
          state.tab === "sessions"
            ? renderSessions({
                loading: state.sessionsLoading,
                result: state.sessionsResult,
                error: state.sessionsError,
                activeMinutes: state.sessionsFilterActive,
                limit: state.sessionsFilterLimit,
                includeGlobal: state.sessionsIncludeGlobal,
                includeUnknown: state.sessionsIncludeUnknown,
                basePath: state.basePath,
                onFiltersChange: (next) => {
                  state.sessionsFilterActive = next.activeMinutes;
                  state.sessionsFilterLimit = next.limit;
                  state.sessionsIncludeGlobal = next.includeGlobal;
                  state.sessionsIncludeUnknown = next.includeUnknown;
                },
                onRefresh: () => loadSessions(state),
                onPatch: (key, patch) => patchSession(state, key, patch),
                onDelete: (key) => deleteSession(state, key),
              })
            : nothing
        }

        ${
          state.tab === "usage"
            ? renderUsage({
                loading: state.usageLoading,
                error: state.usageError,
                startDate: state.usageStartDate,
                endDate: state.usageEndDate,
                sessions: state.usageResult?.sessions ?? [],
                sessionsLimitReached: (state.usageResult?.sessions?.length ?? 0) >= 1000,
                totals: state.usageResult?.totals ?? null,
                aggregates: state.usageResult?.aggregates ?? null,
                costDaily: state.usageCostSummary?.daily ?? [],
                selectedSessions: state.usageSelectedSessions,
                selectedDays: state.usageSelectedDays,
                selectedHours: state.usageSelectedHours,
                chartMode: state.usageChartMode,
                dailyChartMode: state.usageDailyChartMode,
                timeSeriesMode: state.usageTimeSeriesMode,
                timeSeriesBreakdownMode: state.usageTimeSeriesBreakdownMode,
                timeSeries: state.usageTimeSeries,
                timeSeriesLoading: state.usageTimeSeriesLoading,
                sessionLogs: state.usageSessionLogs,
                sessionLogsLoading: state.usageSessionLogsLoading,
                sessionLogsExpanded: state.usageSessionLogsExpanded,
                logFilterRoles: state.usageLogFilterRoles,
                logFilterTools: state.usageLogFilterTools,
                logFilterHasTools: state.usageLogFilterHasTools,
                logFilterQuery: state.usageLogFilterQuery,
                query: state.usageQuery,
                queryDraft: state.usageQueryDraft,
                sessionSort: state.usageSessionSort,
                sessionSortDir: state.usageSessionSortDir,
                recentSessions: state.usageRecentSessions,
                sessionsTab: state.usageSessionsTab,
                visibleColumns:
                  state.usageVisibleColumns as import("./views/usage.ts").UsageColumnId[],
                timeZone: state.usageTimeZone,
                contextExpanded: state.usageContextExpanded,
                headerPinned: state.usageHeaderPinned,
                onStartDateChange: (date) => {
                  state.usageStartDate = date;
                  state.usageSelectedDays = [];
                  state.usageSelectedHours = [];
                  state.usageSelectedSessions = [];
                  debouncedLoadUsage(state);
                },
                onEndDateChange: (date) => {
                  state.usageEndDate = date;
                  state.usageSelectedDays = [];
                  state.usageSelectedHours = [];
                  state.usageSelectedSessions = [];
                  debouncedLoadUsage(state);
                },
                onRefresh: () => loadUsage(state),
                onTimeZoneChange: (zone) => {
                  state.usageTimeZone = zone;
                },
                onToggleContextExpanded: () => {
                  state.usageContextExpanded = !state.usageContextExpanded;
                },
                onToggleSessionLogsExpanded: () => {
                  state.usageSessionLogsExpanded = !state.usageSessionLogsExpanded;
                },
                onLogFilterRolesChange: (next) => {
                  state.usageLogFilterRoles = next;
                },
                onLogFilterToolsChange: (next) => {
                  state.usageLogFilterTools = next;
                },
                onLogFilterHasToolsChange: (next) => {
                  state.usageLogFilterHasTools = next;
                },
                onLogFilterQueryChange: (next) => {
                  state.usageLogFilterQuery = next;
                },
                onLogFilterClear: () => {
                  state.usageLogFilterRoles = [];
                  state.usageLogFilterTools = [];
                  state.usageLogFilterHasTools = false;
                  state.usageLogFilterQuery = "";
                },
                onToggleHeaderPinned: () => {
                  state.usageHeaderPinned = !state.usageHeaderPinned;
                },
                onSelectHour: (hour, shiftKey) => {
                  if (shiftKey && state.usageSelectedHours.length > 0) {
                    const allHours = Array.from({ length: 24 }, (_, i) => i);
                    const lastSelected =
                      state.usageSelectedHours[state.usageSelectedHours.length - 1];
                    const lastIdx = allHours.indexOf(lastSelected);
                    const thisIdx = allHours.indexOf(hour);
                    if (lastIdx !== -1 && thisIdx !== -1) {
                      const [start, end] =
                        lastIdx < thisIdx ? [lastIdx, thisIdx] : [thisIdx, lastIdx];
                      const range = allHours.slice(start, end + 1);
                      state.usageSelectedHours = [
                        ...new Set([...state.usageSelectedHours, ...range]),
                      ];
                    }
                  } else {
                    if (state.usageSelectedHours.includes(hour)) {
                      state.usageSelectedHours = state.usageSelectedHours.filter((h) => h !== hour);
                    } else {
                      state.usageSelectedHours = [...state.usageSelectedHours, hour];
                    }
                  }
                },
                onQueryDraftChange: (query) => {
                  state.usageQueryDraft = query;
                  if (state.usageQueryDebounceTimer) {
                    window.clearTimeout(state.usageQueryDebounceTimer);
                  }
                  state.usageQueryDebounceTimer = window.setTimeout(() => {
                    state.usageQuery = state.usageQueryDraft;
                    state.usageQueryDebounceTimer = null;
                  }, 250);
                },
                onApplyQuery: () => {
                  if (state.usageQueryDebounceTimer) {
                    window.clearTimeout(state.usageQueryDebounceTimer);
                    state.usageQueryDebounceTimer = null;
                  }
                  state.usageQuery = state.usageQueryDraft;
                },
                onClearQuery: () => {
                  if (state.usageQueryDebounceTimer) {
                    window.clearTimeout(state.usageQueryDebounceTimer);
                    state.usageQueryDebounceTimer = null;
                  }
                  state.usageQueryDraft = "";
                  state.usageQuery = "";
                },
                onSessionSortChange: (sort) => {
                  state.usageSessionSort = sort;
                },
                onSessionSortDirChange: (dir) => {
                  state.usageSessionSortDir = dir;
                },
                onSessionsTabChange: (tab) => {
                  state.usageSessionsTab = tab;
                },
                onToggleColumn: (column) => {
                  if (state.usageVisibleColumns.includes(column)) {
                    state.usageVisibleColumns = state.usageVisibleColumns.filter(
                      (entry) => entry !== column,
                    );
                  } else {
                    state.usageVisibleColumns = [...state.usageVisibleColumns, column];
                  }
                },
                onSelectSession: (key, shiftKey) => {
                  state.usageTimeSeries = null;
                  state.usageSessionLogs = null;
                  state.usageRecentSessions = [
                    key,
                    ...state.usageRecentSessions.filter((entry) => entry !== key),
                  ].slice(0, 8);

                  if (shiftKey && state.usageSelectedSessions.length > 0) {
                    // Shift-click: select range from last selected to this session
                    // Sort sessions same way as displayed (by tokens or cost descending)
                    const isTokenMode = state.usageChartMode === "tokens";
                    const sortedSessions = [...(state.usageResult?.sessions ?? [])].toSorted(
                      (a, b) => {
                        const valA = isTokenMode
                          ? (a.usage?.totalTokens ?? 0)
                          : (a.usage?.totalCost ?? 0);
                        const valB = isTokenMode
                          ? (b.usage?.totalTokens ?? 0)
                          : (b.usage?.totalCost ?? 0);
                        return valB - valA;
                      },
                    );
                    const allKeys = sortedSessions.map((s) => s.key);
                    const lastSelected =
                      state.usageSelectedSessions[state.usageSelectedSessions.length - 1];
                    const lastIdx = allKeys.indexOf(lastSelected);
                    const thisIdx = allKeys.indexOf(key);
                    if (lastIdx !== -1 && thisIdx !== -1) {
                      const [start, end] =
                        lastIdx < thisIdx ? [lastIdx, thisIdx] : [thisIdx, lastIdx];
                      const range = allKeys.slice(start, end + 1);
                      const newSelection = [...new Set([...state.usageSelectedSessions, ...range])];
                      state.usageSelectedSessions = newSelection;
                    }
                  } else {
                    // Regular click: focus a single session (so details always open).
                    // Click the focused session again to clear selection.
                    if (
                      state.usageSelectedSessions.length === 1 &&
                      state.usageSelectedSessions[0] === key
                    ) {
                      state.usageSelectedSessions = [];
                    } else {
                      state.usageSelectedSessions = [key];
                    }
                  }

                  // Load timeseries/logs only if exactly one session selected
                  if (state.usageSelectedSessions.length === 1) {
                    void loadSessionTimeSeries(state, state.usageSelectedSessions[0]);
                    void loadSessionLogs(state, state.usageSelectedSessions[0]);
                  }
                },
                onSelectDay: (day, shiftKey) => {
                  if (shiftKey && state.usageSelectedDays.length > 0) {
                    // Shift-click: select range from last selected to this day
                    const allDays = (state.usageCostSummary?.daily ?? []).map((d) => d.date);
                    const lastSelected =
                      state.usageSelectedDays[state.usageSelectedDays.length - 1];
                    const lastIdx = allDays.indexOf(lastSelected);
                    const thisIdx = allDays.indexOf(day);
                    if (lastIdx !== -1 && thisIdx !== -1) {
                      const [start, end] =
                        lastIdx < thisIdx ? [lastIdx, thisIdx] : [thisIdx, lastIdx];
                      const range = allDays.slice(start, end + 1);
                      // Merge with existing selection
                      const newSelection = [...new Set([...state.usageSelectedDays, ...range])];
                      state.usageSelectedDays = newSelection;
                    }
                  } else {
                    // Regular click: toggle single day
                    if (state.usageSelectedDays.includes(day)) {
                      state.usageSelectedDays = state.usageSelectedDays.filter((d) => d !== day);
                    } else {
                      state.usageSelectedDays = [day];
                    }
                  }
                },
                onChartModeChange: (mode) => {
                  state.usageChartMode = mode;
                },
                onDailyChartModeChange: (mode) => {
                  state.usageDailyChartMode = mode;
                },
                onTimeSeriesModeChange: (mode) => {
                  state.usageTimeSeriesMode = mode;
                },
                onTimeSeriesBreakdownChange: (mode) => {
                  state.usageTimeSeriesBreakdownMode = mode;
                },
                onClearDays: () => {
                  state.usageSelectedDays = [];
                },
                onClearHours: () => {
                  state.usageSelectedHours = [];
                },
                onClearSessions: () => {
                  state.usageSelectedSessions = [];
                  state.usageTimeSeries = null;
                  state.usageSessionLogs = null;
                },
                onClearFilters: () => {
                  state.usageSelectedDays = [];
                  state.usageSelectedHours = [];
                  state.usageSelectedSessions = [];
                  state.usageTimeSeries = null;
                  state.usageSessionLogs = null;
                },
              })
            : nothing
        }

        ${
          state.tab === "cron"
            ? renderCron({
                basePath: state.basePath,
                loading: state.cronLoading,
                status: state.cronStatus,
                jobs: state.cronJobs,
                error: state.cronError,
                busy: state.cronBusy,
                form: state.cronForm,
                channels: state.channelsSnapshot?.channelMeta?.length
                  ? state.channelsSnapshot.channelMeta.map((entry) => entry.id)
                  : (state.channelsSnapshot?.channelOrder ?? []),
                channelLabels: state.channelsSnapshot?.channelLabels ?? {},
                channelMeta: state.channelsSnapshot?.channelMeta ?? [],
                runsJobId: state.cronRunsJobId,
                runs: state.cronRuns,
                onFormChange: (patch) => (state.cronForm = { ...state.cronForm, ...patch }),
                onRefresh: () => state.loadCron(),
                onAdd: () => addCronJob(state),
                onToggle: (job, enabled) => toggleCronJob(state, job, enabled),
                onRun: (job) => runCronJob(state, job),
                onRemove: (job) => removeCronJob(state, job),
                onLoadRuns: (jobId) => loadCronRuns(state, jobId),
              })
            : nothing
        }

        ${
          state.tab === "agents"
            ? renderAgents({
                loading: state.agentsLoading,
                error: state.agentsError,
                agentsList: state.agentsList,
                selectedAgentId: resolvedAgentId,
                activePanel: state.agentsPanel,
                configForm: configValue,
                configLoading: state.configLoading,
                configSaving: state.configSaving,
                configDirty: state.configFormDirty,
                channelsLoading: state.channelsLoading,
                channelsError: state.channelsError,
                channelsSnapshot: state.channelsSnapshot,
                channelsLastSuccess: state.channelsLastSuccess,
                cronLoading: state.cronLoading,
                cronStatus: state.cronStatus,
                cronJobs: state.cronJobs,
                cronError: state.cronError,
                agentFilesLoading: state.agentFilesLoading,
                agentFilesError: state.agentFilesError,
                agentFilesList: state.agentFilesList,
                agentFileActive: state.agentFileActive,
                agentFileContents: state.agentFileContents,
                agentFileDrafts: state.agentFileDrafts,
                agentFileSaving: state.agentFileSaving,
                agentIdentityLoading: state.agentIdentityLoading,
                agentIdentityError: state.agentIdentityError,
                agentIdentityById: state.agentIdentityById,
                agentSkillsLoading: state.agentSkillsLoading,
                agentSkillsReport: state.agentSkillsReport,
                agentSkillsError: state.agentSkillsError,
                agentSkillsAgentId: state.agentSkillsAgentId,
                skillsFilter: state.skillsFilter,
                onRefresh: async () => {
                  await loadAgents(state);
                  const agentIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
                  if (agentIds.length > 0) {
                    void loadAgentIdentities(state, agentIds);
                  }
                },
                onSelectAgent: (agentId) => {
                  if (state.agentsSelectedId === agentId) {
                    return;
                  }
                  state.agentsSelectedId = agentId;
                  state.agentFilesList = null;
                  state.agentFilesError = null;
                  state.agentFilesLoading = false;
                  state.agentFileActive = null;
                  state.agentFileContents = {};
                  state.agentFileDrafts = {};
                  state.agentSkillsReport = null;
                  state.agentSkillsError = null;
                  state.agentSkillsAgentId = null;
                  void loadAgentIdentity(state, agentId);
                  if (state.agentsPanel === "files") {
                    void loadAgentFiles(state, agentId);
                  }
                  if (state.agentsPanel === "skills") {
                    void loadAgentSkills(state, agentId);
                  }
                },
                onSelectPanel: (panel) => {
                  state.agentsPanel = panel;
                  if (panel === "files" && resolvedAgentId) {
                    if (state.agentFilesList?.agentId !== resolvedAgentId) {
                      state.agentFilesList = null;
                      state.agentFilesError = null;
                      state.agentFileActive = null;
                      state.agentFileContents = {};
                      state.agentFileDrafts = {};
                      void loadAgentFiles(state, resolvedAgentId);
                    }
                  }
                  if (panel === "skills") {
                    if (resolvedAgentId) {
                      void loadAgentSkills(state, resolvedAgentId);
                    }
                  }
                  if (panel === "channels") {
                    void loadChannels(state, false);
                  }
                  if (panel === "cron") {
                    void state.loadCron();
                  }
                },
                onLoadFiles: (agentId) => loadAgentFiles(state, agentId),
                onSelectFile: (name) => {
                  state.agentFileActive = name;
                  if (!resolvedAgentId) {
                    return;
                  }
                  void loadAgentFileContent(state, resolvedAgentId, name);
                },
                onFileDraftChange: (name, content) => {
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
                },
                onFileReset: (name) => {
                  const base = state.agentFileContents[name] ?? "";
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: base };
                },
                onFileSave: (name) => {
                  if (!resolvedAgentId) {
                    return;
                  }
                  const content =
                    state.agentFileDrafts[name] ?? state.agentFileContents[name] ?? "";
                  void saveAgentFile(state, resolvedAgentId, name, content);
                },
                onToolsProfileChange: (agentId, profile, clearAllow) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (profile) {
                    updateConfigFormValue(state, [...basePath, "profile"], profile);
                  } else {
                    removeConfigFormValue(state, [...basePath, "profile"]);
                  }
                  if (clearAllow) {
                    removeConfigFormValue(state, [...basePath, "allow"]);
                  }
                },
                onToolsOverridesChange: (agentId, alsoAllow, deny) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (alsoAllow.length > 0) {
                    updateConfigFormValue(state, [...basePath, "alsoAllow"], alsoAllow);
                  } else {
                    removeConfigFormValue(state, [...basePath, "alsoAllow"]);
                  }
                  if (deny.length > 0) {
                    updateConfigFormValue(state, [...basePath, "deny"], deny);
                  } else {
                    removeConfigFormValue(state, [...basePath, "deny"]);
                  }
                },
                onConfigReload: () => loadConfig(state),
                onConfigSave: () => saveConfig(state),
                onChannelsRefresh: () => loadChannels(state, false),
                onCronRefresh: () => state.loadCron(),
                onSkillsFilterChange: (next) => (state.skillsFilter = next),
                onSkillsRefresh: () => {
                  if (resolvedAgentId) {
                    void loadAgentSkills(state, resolvedAgentId);
                  }
                },
                onAgentSkillToggle: (agentId, skillName, enabled) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const entry = list[index] as { skills?: unknown };
                  const normalizedSkill = skillName.trim();
                  if (!normalizedSkill) {
                    return;
                  }
                  const allSkills =
                    state.agentSkillsReport?.skills?.map((skill) => skill.name).filter(Boolean) ??
                    [];
                  const existing = Array.isArray(entry.skills)
                    ? entry.skills.map((name) => String(name).trim()).filter(Boolean)
                    : undefined;
                  const base = existing ?? allSkills;
                  const next = new Set(base);
                  if (enabled) {
                    next.add(normalizedSkill);
                  } else {
                    next.delete(normalizedSkill);
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], [...next]);
                },
                onAgentSkillsClear: (agentId) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  removeConfigFormValue(state, ["agents", "list", index, "skills"]);
                },
                onAgentSkillsDisableAll: (agentId) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], []);
                },
                onModelChange: (agentId, modelId) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "model"];
                  if (!modelId) {
                    removeConfigFormValue(state, basePath);
                    return;
                  }
                  const entry = list[index] as { model?: unknown };
                  const existing = entry?.model;
                  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                    const fallbacks = (existing as { fallbacks?: unknown }).fallbacks;
                    const next = {
                      primary: modelId,
                      ...(Array.isArray(fallbacks) ? { fallbacks } : {}),
                    };
                    updateConfigFormValue(state, basePath, next);
                  } else {
                    updateConfigFormValue(state, basePath, modelId);
                  }
                },
                onModelFallbacksChange: (agentId, fallbacks) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "model"];
                  const entry = list[index] as { model?: unknown };
                  const normalized = fallbacks.map((name) => name.trim()).filter(Boolean);
                  const existing = entry.model;
                  const resolvePrimary = () => {
                    if (typeof existing === "string") {
                      return existing.trim() || null;
                    }
                    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                      const primary = (existing as { primary?: unknown }).primary;
                      if (typeof primary === "string") {
                        const trimmed = primary.trim();
                        return trimmed || null;
                      }
                    }
                    return null;
                  };
                  const primary = resolvePrimary();
                  if (normalized.length === 0) {
                    if (primary) {
                      updateConfigFormValue(state, basePath, primary);
                    } else {
                      removeConfigFormValue(state, basePath);
                    }
                    return;
                  }
                  const next = primary
                    ? { primary, fallbacks: normalized }
                    : { fallbacks: normalized };
                  updateConfigFormValue(state, basePath, next);
                },
                // Create Agent Modal
                createModalOpen: state.createModalOpen,
                createModalMode: state.createModalMode,
                createModalEditAgentId: state.createModalEditAgentId,
                createModalStep: state.createModalStep,
                createModalLoading: state.createModalLoading,
                createModalError: state.createModalError,
                createModalFormData: state.createModalFormData,
                availableModels: state.availableModels,
                configuredProviders: state.pmosByokProviders,
                availableSkills: state.availableSkills,
                workspaceLocked: Boolean(
                  state.pmosAuthUser?.workspaceId?.trim() &&
                    state.pmosAuthUser?.role !== "super_admin",
                ),
                catalogDivision: state.catalogDivision ?? "all",
                catalogSearch: state.catalogSearch ?? "",
                catalogPreviewArchetypeId: state.catalogPreviewArchetypeId,
                catalogPreviewSoulContent: state.catalogPreviewSoulContent,
                catalogPreviewLoading: state.catalogPreviewLoading,
                catalogPreviewError: state.catalogPreviewError,
                onCatalogDivisionChange: (division) => {
                  state.catalogDivision = division;
                },
                onCatalogSearchChange: (query) => {
                  state.catalogSearch = query;
                },
                onSelectArchetype: async (archetype) => {
                  const wsId = state.pmosAuthUser?.workspaceId?.trim() ?? "";
                  const isWorkspaceScopedUser =
                    Boolean(wsId) && state.pmosAuthUser?.role !== "super_admin";
                  const agentId = toAgentId(archetype.name);
                  const profileMap: Record<string, AgentMode> = {
                    full: "autonomous",
                    messaging: "interactive",
                    coding: "hybrid",
                  };
                  state.createModalLoading = true;
                  state.createModalError = null;
                  const { content, warning } = await resolveArchetypeSoulContent(archetype);
                  state.catalogPreviewArchetypeId = archetype.id;
                  state.catalogPreviewSoulContent = content;
                  state.catalogPreviewLoading = false;
                  state.catalogPreviewError = warning;
                  state.createModalFormData = {
                    ...buildDefaultCreateAgentForm(state, agentId),
                    name: archetype.name,
                    id: agentId,
                    purpose: archetype.shortDescription,
                    emoji: archetype.emoji,
                    theme: archetype.theme,
                    mode: profileMap[archetype.toolsProfile] ?? "hybrid",
                    model: resolveModelTier(archetype.modelTier, state.availableModels),
                    skills: archetype.recommendedSkills.filter(
                      (s) =>
                        state.availableSkills.length === 0 ||
                        state.availableSkills.includes(s),
                    ),
                    personality: "professional",
                    autonomousTasks: [],
                    archetypeId: archetype.id,
                    soulContent: content,
                    workspace: isWorkspaceScopedUser
                      ? toWorkspaceScopedAgentWorkspacePath(wsId, agentId)
                      : DEFAULT_AGENT_WORKSPACE_PATH,
                  };
                  state.createModalStep = 1;
                  state.createModalLoading = false;
                },
                onPreviewArchetype: async (archetype) => {
                  if (!archetype) {
                    state.catalogPreviewArchetypeId = null;
                    state.catalogPreviewSoulContent = "";
                    state.catalogPreviewLoading = false;
                    state.catalogPreviewError = null;
                    return;
                  }
                  const previewId = archetype.id;
                  state.catalogPreviewArchetypeId = previewId;
                  state.catalogPreviewSoulContent = "";
                  state.catalogPreviewLoading = true;
                  state.catalogPreviewError = null;
                  const { content, warning } = await resolveArchetypeSoulContent(archetype);
                  if (state.catalogPreviewArchetypeId !== previewId) {
                    return;
                  }
                  state.catalogPreviewSoulContent = content;
                  state.catalogPreviewLoading = false;
                  state.catalogPreviewError = warning;
                },
                onStartFromScratch: () => {
                  state.createModalFormData = {
                    ...buildDefaultCreateAgentForm(state, "assistant"),
                    archetypeId: "",
                    soulContent: "",
                  };
                  state.catalogPreviewArchetypeId = null;
                  state.catalogPreviewSoulContent = "";
                  state.catalogPreviewLoading = false;
                  state.catalogPreviewError = null;
                  state.createModalStep = 1;
                },
                onCreateModalOpen: async () => {
                  await loadSkills(state);
                  state.availableSkills = resolveAvailableSkillNames(state);
                  state.createModalOpen = true;
                  state.createModalMode = "create";
                  state.createModalEditAgentId = null;
                  state.createModalStep = 0;
                  state.createModalError = null;
                  state.catalogDivision = "all";
                  state.catalogSearch = "";
                  state.catalogPreviewArchetypeId = null;
                  state.catalogPreviewSoulContent = "";
                  state.catalogPreviewLoading = false;
                  state.catalogPreviewError = null;
                  state.createModalFormData = {
                    ...buildDefaultCreateAgentForm(state, "assistant"),
                    archetypeId: "",
                    soulContent: "",
                  };
                },
                onCreateModalCancel: () => {
                  state.createModalOpen = false;
                  state.createModalMode = "create";
                  state.createModalEditAgentId = null;
                  state.createModalStep = 0;
                  state.createModalError = null;
                  state.catalogDivision = "all";
                  state.catalogSearch = "";
                  state.catalogPreviewArchetypeId = null;
                  state.catalogPreviewSoulContent = "";
                  state.catalogPreviewLoading = false;
                  state.catalogPreviewError = null;
                  state.createModalFormData = {
                    ...buildDefaultCreateAgentForm(state, "assistant"),
                    archetypeId: "",
                    soulContent: "",
                  };
                },
                onCreateModalStepChange: (nextStep) => {
                  state.createModalStep = nextStep;
                  state.createModalError = null;
                },
                onCreateModalFieldChange: (field, value) => {
                  const nextForm = { ...state.createModalFormData, [field]: value };
                  const wsId = state.pmosAuthUser?.workspaceId?.trim() ?? "";
                  const isWorkspaceScopedUser =
                    Boolean(wsId) && state.pmosAuthUser?.role !== "super_admin";
                  const isEditMode = state.createModalMode === "edit";
                  if (!isEditMode && field === "name") {
                    const currentId = state.createModalFormData.id.trim();
                    const previousAutoId = toAgentId(state.createModalFormData.name);
                    if (!currentId || currentId === previousAutoId) {
                      nextForm.id = toAgentId(String(value));
                    }
                  }
                  if (!isEditMode && isWorkspaceScopedUser && (field === "name" || field === "id")) {
                    const previousAgentId =
                      toAgentId(state.createModalFormData.id || state.createModalFormData.name) ||
                      "assistant";
                    const previousAutoWorkspace =
                      toWorkspaceScopedAgentWorkspacePath(wsId, previousAgentId);
                    const currentWorkspace = state.createModalFormData.workspace.trim();
                    if (!currentWorkspace || currentWorkspace === previousAutoWorkspace) {
                      const nextAgentId = toAgentId(String(nextForm.id || nextForm.name)) || "assistant";
                      nextForm.workspace = toWorkspaceScopedAgentWorkspacePath(wsId, nextAgentId);
                    }
                  }
                  state.createModalFormData = nextForm;
                },
                onCreateModalSubmit: async () => {
                  const form = state.createModalFormData;
                  const name = form.name.trim();
                  if (!name) {
                    state.createModalError = "Agent name is required";
                    return;
                  }

                  const isEditMode =
                    state.createModalMode === "edit" &&
                    typeof state.createModalEditAgentId === "string" &&
                    state.createModalEditAgentId.trim().length > 0;
                  const editAgentId = isEditMode ? state.createModalEditAgentId!.trim() : null;
                  const requestedId = toAgentId(form.id || name);
                  const candidateId = editAgentId ?? requestedId;
                  if (!candidateId) {
                    state.createModalError =
                      "Agent ID is invalid. Use letters, numbers, '-' or '_'.";
                    return;
                  }
                  if (isEditMode && requestedId && requestedId !== candidateId) {
                    state.createModalError = "Agent ID cannot be changed after creation.";
                    return;
                  }

                  state.createModalLoading = true;
                  state.createModalError = null;

                  try {
                    const modeToProfile: Record<string, string> = {
                      autonomous: "full",
                      interactive: "messaging",
                      hybrid: "coding",
                    };
                    const wsId = state.pmosAuthUser?.workspaceId?.trim() ?? "";
                    const isWorkspaceScopedUser = Boolean(wsId);
                    const workspace = isWorkspaceScopedUser
                      ? toWorkspaceScopedAgentWorkspacePath(wsId, candidateId)
                      : form.workspace.trim() || DEFAULT_AGENT_WORKSPACE_PATH;
                    const model = form.model.trim();
                    const skills = Array.from(
                      new Set(form.skills.map((skill) => skill.trim()).filter(Boolean)),
                    );
                    const emoji = form.emoji.trim();
                    const theme = form.theme.trim() || form.purpose.trim();
                    const toolsProfile = modeToProfile[form.mode] ?? "coding";

                    if (isEditMode) {
                      // Update existing agent via gateway handler
                      const updateResult = await state.client!.request("agents.update", {
                        agentId: candidateId,
                        name,
                        ...(model ? { model } : {}),
                        ...(emoji ? { emoji } : {}),
                        ...(theme ? { theme } : {}),
                        ...(skills.length > 0 ? { skills } : {}),
                        toolsProfile,
                      });
                      if (updateResult && typeof updateResult === "object" && !(updateResult as { ok?: boolean }).ok) {
                        throw new Error((updateResult as { error?: string }).error ?? "Failed to update agent");
                      }
                    } else {
                      // Create new agent via gateway handler (handles workspace dirs, IDENTITY.md, validation)
                      const createResult = await state.client!.request("agents.create", {
                        name,
                        workspace,
                        ...(emoji ? { emoji } : {}),
                        ...(model ? { model } : {}),
                        ...(theme ? { theme } : {}),
                        ...(skills.length > 0 ? { skills } : {}),
                        toolsProfile,
                      });
                      if (createResult && typeof createResult === "object" && !(createResult as { ok?: boolean }).ok) {
                        throw new Error((createResult as { error?: string }).error ?? "Failed to create agent");
                      }
                    }

                    // Write SOUL.md if archetype was selected (best-effort)
                    const soulContent = form.soulContent?.trim();
                    if (soulContent && !isEditMode) {
                      try {
                        await state.client!.request("agents.files.set", {
                          agentId: candidateId,
                          name: "SOUL.md",
                          content: soulContent,
                        });
                      } catch {
                        // Best-effort: agent created but SOUL.md write failed
                      }
                    }

                    // Reload config and agents list to reflect gateway changes
                    await loadConfig(state);
                    await loadAgents(state);
                    const agentExists = state.agentsList?.agents?.some((entry) => entry.id === candidateId) ?? false;
                    if (!agentExists) {
                      state.agentsList = upsertAgentsListResult(
                        state.agentsList,
                        createAgentListRow({
                          id: candidateId,
                          name,
                          identity: {
                            name,
                            ...(emoji ? { emoji } : {}),
                            ...(theme ? { theme } : {}),
                          },
                        }),
                      );
                    }
                    const agentIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
                    if (agentIds.length > 0) {
                      void loadAgentIdentities(state, agentIds);
                    }
                    const existingIdentity = state.agentIdentityById[candidateId];
                    state.agentIdentityById = {
                      ...state.agentIdentityById,
                      [candidateId]: {
                        agentId: candidateId,
                        name,
                        avatar: existingIdentity?.avatar ?? "",
                        ...(emoji ? { emoji } : existingIdentity?.emoji ? { emoji: existingIdentity.emoji } : {}),
                      },
                    };
                    state.agentsSelectedId = candidateId;
                    void loadAgentIdentity(state, candidateId);
                    state.createModalFormData = buildDefaultCreateAgentForm(state, "assistant");
                    state.createModalOpen = false;
                    state.createModalMode = "create";
                    state.createModalEditAgentId = null;
                    state.createModalStep = 0;
                    state.catalogPreviewArchetypeId = null;
                    state.catalogPreviewSoulContent = "";
                    state.catalogPreviewLoading = false;
                    state.catalogPreviewError = null;
                  } catch (error) {
                    state.createModalError =
                      error instanceof Error ? error.message : String(error);
                  } finally {
                    state.createModalLoading = false;
                  }
                },
                onOpenModelsTab: () => state.setTab("models"),
                // Agent activity and actions
                agentActivityById: state.agentActivityById,
                onOpenAgentChat: (agentId: string) => {
                  void openAgentChat(agentId);
                },
                onPauseAgent: (agentId: string) => {
                  // TODO: Implement pause/resume agent
                  console.log("Pause agent:", agentId);
                },
                onViewAgentLogs: (agentId: string) => {
                  state.setTab("logs");
                },
                onEditAgent: async (agentId: string) => {
                  if (!state.connected) {
                    return;
                  }
                  const agent = state.agentsList?.agents.find((entry) => entry.id === agentId);
                  if (!agent) {
                    state.agentsError = `Agent "${agentId}" not found.`;
                    return;
                  }
                  try {
                    state.agentsError = null;
                    await loadSkills(state);
                    state.availableSkills = resolveAvailableSkillNames(state);
                    if (!state.configForm) {
                      await loadConfig(state);
                    }
                    const configEntry = findConfigAgentEntry(state.configForm, agentId);
                    const identity = state.agentIdentityById[agentId] ?? null;
                    const identityConfig =
                      configEntry?.identity &&
                      typeof configEntry.identity === "object" &&
                      !Array.isArray(configEntry.identity)
                        ? (configEntry.identity as Record<string, unknown>)
                        : null;
                    const toolsConfig =
                      configEntry?.tools &&
                      typeof configEntry.tools === "object" &&
                      !Array.isArray(configEntry.tools)
                        ? (configEntry.tools as Record<string, unknown>)
                        : null;
                    const currentName =
                      (typeof agent.name === "string" && agent.name.trim()) ||
                      (typeof agent.identity?.name === "string" && agent.identity.name.trim()) ||
                      (typeof identityConfig?.name === "string" && identityConfig.name.trim()) ||
                      agent.id;
                    const currentEmoji =
                      identity?.emoji?.trim() ||
                      (typeof agent.identity?.emoji === "string" ? agent.identity.emoji.trim() : "") ||
                      (typeof identityConfig?.emoji === "string" ? identityConfig.emoji.trim() : "") ||
                      DEFAULT_CREATE_AGENT_FORM.emoji;
                    const currentTheme =
                      (typeof agent.identity?.theme === "string" ? agent.identity.theme.trim() : "") ||
                      (typeof identityConfig?.theme === "string" ? identityConfig.theme.trim() : "");
                    const currentWorkspace =
                      (typeof configEntry?.workspace === "string" && configEntry.workspace.trim()) ||
                      buildDefaultCreateAgentForm(state, agentId).workspace;
                    const currentModel = extractAgentModelRef(configEntry?.model);
                    const currentSkills = Array.isArray(configEntry?.skills)
                      ? Array.from(
                          new Set(
                            configEntry.skills
                              .filter((skill): skill is string => typeof skill === "string")
                              .map((skill) => skill.trim())
                              .filter(Boolean),
                          ),
                        )
                      : resolveAvailableSkillNames(state);

                    state.createModalFormData = {
                      ...buildDefaultCreateAgentForm(state, agentId),
                      name: currentName,
                      id: agentId,
                      purpose: currentTheme,
                      workspace: currentWorkspace,
                      emoji: currentEmoji,
                      theme: currentTheme,
                      mode: mapToolsProfileToMode(toolsConfig?.profile),
                      model: currentModel,
                      skills: currentSkills,
                    };
                    state.createModalMode = "edit";
                    state.createModalEditAgentId = agentId;
                    state.createModalStep = 1;
                    state.createModalError = null;
                    state.catalogPreviewArchetypeId = null;
                    state.catalogPreviewSoulContent = "";
                    state.catalogPreviewLoading = false;
                    state.catalogPreviewError = null;
                    state.createModalOpen = true;
                  } catch (error) {
                    state.agentsError = error instanceof Error ? error.message : String(error);
                  }
                },
                onDeleteAgent: async (agentId: string) => {
                  if (!state.client || !state.connected) {
                    return;
                  }
                  const agent = state.agentsList?.agents.find((entry) => entry.id === agentId);
                  const label = agent
                    ? (typeof agent.name === "string" && agent.name.trim()) ||
                      (typeof agent.identity?.name === "string" && agent.identity.name.trim()) ||
                      agent.id
                    : agentId;
                  const confirmed = window.confirm(
                    `Delete agent "${label}"?\n\nThis will remove the agent config and its workspace/session files.`,
                  );
                  if (!confirmed) {
                    return;
                  }
                  try {
                    state.agentsError = null;
                    await state.client.request("agents.delete", { agentId, deleteFiles: true });
                    await loadConfig(state);
                    await loadAgents(state);
                    const nextIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
                    if (nextIds.length > 0) {
                      void loadAgentIdentities(state, nextIds);
                    }
                  } catch (error) {
                    state.agentsError = error instanceof Error ? error.message : String(error);
                  }
                },
              })
            : nothing
        }

        ${
          state.tab === "skills"
            ? renderSkills({
                loading: state.skillsLoading,
                report: state.skillsReport,
                error: state.skillsError,
                filter: state.skillsFilter,
                edits: state.skillEdits,
                messages: state.skillMessages,
                busyKey: state.skillsBusyKey,
                onFilterChange: (next) => (state.skillsFilter = next),
                onRefresh: () => loadSkills(state, { clearMessages: true }),
                onToggle: (key, enabled) => updateSkillEnabled(state, key, enabled),
                onEdit: (key, value) => updateSkillEdit(state, key, value),
                onSaveKey: (key) => saveSkillApiKey(state, key),
                onInstall: (skillKey, name, installId) =>
                  installSkill(state, skillKey, name, installId),
              })
            : nothing
        }

        ${
          state.tab === "nodes" && canAccessTab(state, "nodes")
            ? renderNodes({
                loading: state.nodesLoading,
                nodes: state.nodes,
                devicesLoading: state.devicesLoading,
                devicesError: state.devicesError,
                devicesList: state.devicesList,
                configForm:
                  state.configForm ??
                  (state.configSnapshot?.config as Record<string, unknown> | null),
                configLoading: state.configLoading,
                configSaving: state.configSaving,
                configDirty: state.configFormDirty,
                configFormMode: state.configFormMode,
                execApprovalsLoading: state.execApprovalsLoading,
                execApprovalsSaving: state.execApprovalsSaving,
                execApprovalsDirty: state.execApprovalsDirty,
                execApprovalsSnapshot: state.execApprovalsSnapshot,
                execApprovalsForm: state.execApprovalsForm,
                execApprovalsSelectedAgent: state.execApprovalsSelectedAgent,
                execApprovalsTarget: state.execApprovalsTarget,
                execApprovalsTargetNodeId: state.execApprovalsTargetNodeId,
                onRefresh: () => loadNodes(state),
                onDevicesRefresh: () => loadDevices(state),
                onDeviceApprove: (requestId) => approveDevicePairing(state, requestId),
                onDeviceReject: (requestId) => rejectDevicePairing(state, requestId),
                onDeviceRotate: (deviceId, role, scopes) =>
                  rotateDeviceToken(state, { deviceId, role, scopes }),
                onDeviceRevoke: (deviceId, role) => revokeDeviceToken(state, { deviceId, role }),
                onLoadConfig: () => loadConfig(state),
                onLoadExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  return loadExecApprovals(state, target);
                },
                onBindDefault: (nodeId) => {
                  if (nodeId) {
                    updateConfigFormValue(state, ["tools", "exec", "node"], nodeId);
                  } else {
                    removeConfigFormValue(state, ["tools", "exec", "node"]);
                  }
                },
                onBindAgent: (agentIndex, nodeId) => {
                  const basePath = ["agents", "list", agentIndex, "tools", "exec", "node"];
                  if (nodeId) {
                    updateConfigFormValue(state, basePath, nodeId);
                  } else {
                    removeConfigFormValue(state, basePath);
                  }
                },
                onSaveBindings: () => saveConfig(state),
                onExecApprovalsTargetChange: (kind, nodeId) => {
                  state.execApprovalsTarget = kind;
                  state.execApprovalsTargetNodeId = nodeId;
                  state.execApprovalsSnapshot = null;
                  state.execApprovalsForm = null;
                  state.execApprovalsDirty = false;
                  state.execApprovalsSelectedAgent = null;
                },
                onExecApprovalsSelectAgent: (agentId) => {
                  state.execApprovalsSelectedAgent = agentId;
                },
                onExecApprovalsPatch: (path, value) =>
                  updateExecApprovalsFormValue(state, path, value),
                onExecApprovalsRemove: (path) => removeExecApprovalsFormValue(state, path),
                onSaveExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  return saveExecApprovals(state, target);
                },
              })
            : nothing
        }

        ${state.tab === "chat" ? renderChat(chatProps) : nothing}

        ${
          state.tab === "config" && canAccessTab(state, "config")
            ? renderConfig({
                scope:
                  state.pmosAuthUser && state.pmosAuthUser.role !== "super_admin" ? "workspace" : "global",
                scopeLabel:
                  state.pmosAuthUser && state.pmosAuthUser.role !== "super_admin"
                    ? state.pmosAuthUser.workspaceId
                    : null,
                allowRawMode: state.pmosAuthUser?.role === "super_admin",
                raw: state.configRaw,
                originalRaw: state.configRawOriginal,
                valid: state.configValid,
                issues: state.configIssues,
                loading: state.configLoading,
                saving: state.configSaving,
                applying: state.configApplying,
                updating: state.updateRunning,
                connected: state.connected,
                schema: state.configSchema,
                schemaLoading: state.configSchemaLoading,
                uiHints: state.configUiHints,
                formMode: state.pmosAuthUser?.role === "super_admin" ? state.configFormMode : "form",
                formValue: state.configForm,
                originalValue: state.configFormOriginal,
                searchQuery: state.configSearchQuery,
                activeSection: state.configActiveSection,
                activeSubsection: state.configActiveSubsection,
                onRawChange: (next) => {
                  state.configRaw = next;
                },
                onFormModeChange: (mode) => {
                  if (state.pmosAuthUser?.role !== "super_admin" && mode === "raw") {
                    return;
                  }
                  state.configFormMode = mode;
                },
                onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
                onSearchChange: (query) => (state.configSearchQuery = query),
                onSectionChange: (section) => {
                  state.configActiveSection = section;
                  state.configActiveSubsection = null;
                },
                onSubsectionChange: (section) => (state.configActiveSubsection = section),
                onReload: () => loadConfig(state),
                onSave: () => saveConfig(state),
                onApply: () => applyConfig(state),
                onUpdate: () => runUpdate(state),
              })
            : nothing
        }

        ${
          state.tab === "debug" && canAccessTab(state, "debug")
            ? renderDebug({
                loading: state.debugLoading,
                status: state.debugStatus,
                health: state.debugHealth,
                models: state.debugModels,
                heartbeat: state.debugHeartbeat,
                eventLog: state.eventLog,
                callMethod: state.debugCallMethod,
                callParams: state.debugCallParams,
                callResult: state.debugCallResult,
                callError: state.debugCallError,
                onCallMethodChange: (next) => (state.debugCallMethod = next),
                onCallParamsChange: (next) => (state.debugCallParams = next),
                onRefresh: () => loadDebug(state),
                onCall: () => callDebugMethod(state),
              })
            : nothing
        }

        ${
          state.tab === "logs" && canAccessTab(state, "logs")
            ? renderLogs({
                loading: state.logsLoading,
                error: state.logsError,
                file: state.logsFile,
                entries: state.logsEntries,
                filterText: state.logsFilterText,
                levelFilters: state.logsLevelFilters,
                autoFollow: state.logsAutoFollow,
                truncated: state.logsTruncated,
                onFilterTextChange: (next) => (state.logsFilterText = next),
                onLevelToggle: (level, enabled) => {
                  state.logsLevelFilters = { ...state.logsLevelFilters, [level]: enabled };
                },
                onToggleAutoFollow: (next) => (state.logsAutoFollow = next),
                onRefresh: () => loadLogs(state, { reset: true }),
                onExport: (lines, label) => state.exportLogs(lines, label),
                onScroll: (event) => state.handleLogsScroll(event),
              })
            : nothing
        }
          `}
      </main>
      ${renderExecApprovalPrompt(state)}
      ${renderGatewayUrlConfirmation(state)}

      ${state.notificationsOpen ? html`
        <div
          class="notifications-overlay"
          style="position:fixed;inset:0;z-index:900;"
          @click=${() => { state.notificationsOpen = false; }}
        ></div>
        <aside
          class="notifications-panel"
          style="position:fixed;top:0;right:0;bottom:0;width:340px;max-width:100vw;background:var(--bg-card,#1a1a1a);border-left:1px solid var(--border);z-index:901;display:flex;flex-direction:column;box-shadow:-4px 0 24px rgba(0,0,0,0.3);"
        >
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid var(--border);">
            <span style="font-weight:600;">Activity Feed</span>
            <button class="button" @click=${() => { state.notificationsOpen = false; }}>✕</button>
          </div>
          <div style="flex:1;overflow-y:auto;padding:12px;">
            ${state.pmosTraceEvents.length === 0
              ? html`<div class="muted" style="padding:16px 0;">No activity yet. Events from agent runs and workflows appear here.</div>`
              : [...state.pmosTraceEvents].reverse().map((ev) => {
                  const status = ev.status ?? "info";
                  const chipClass = status === "success" ? "chip-ok" : status === "error" ? "chip-danger" : "chip-muted";
                  const source = typeof ev.source === "string" ? ev.source : "";
                  const kind = typeof ev.kind === "string" ? ev.kind : "";
                  const title = typeof ev.title === "string" && ev.title ? ev.title : `${source}:${kind}`;
                  const detail = typeof ev.detail === "string" && ev.detail ? ev.detail : null;
                  const ts = typeof ev.ts === "number" ? new Date(ev.ts).toLocaleTimeString() : "";
                  return html`
                    <div class="list-item" style="border-bottom:1px solid var(--border);padding:10px 0;">
                      <div class="list-main">
                        <div class="list-title">${title}</div>
                        ${detail ? html`<div class="list-sub" style="white-space:pre-wrap;word-break:break-word;">${detail}</div>` : nothing}
                        ${ts ? html`<div class="list-sub muted">${ts}</div>` : nothing}
                      </div>
                      <div class="list-meta"><span class="chip ${chipClass}">${status}</span></div>
                    </div>
                  `;
                })
            }
          </div>
          ${state.pmosTraceEvents.length > 0
            ? html`<div style="padding:12px;border-top:1px solid var(--border);">
                <button class="btn btn--secondary" style="width:100%;" @click=${() => state.handlePmosTraceClear()}>Clear all</button>
              </div>`
            : nothing}
        </aside>
      ` : nothing}
    </div>
  `;
}
