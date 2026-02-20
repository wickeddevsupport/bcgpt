import { LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { EventLogEntry } from "./app-events.ts";
import type { AppViewState } from "./app-view-state.ts";
import type { DevicePairingList } from "./controllers/devices.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import type { SkillMessage } from "./controllers/skills.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import type { ResolvedTheme, ThemeMode } from "./theme.ts";
import type {
  AgentsListResult,
  AgentsFilesListResult,
  AgentIdentityResult,
  ConfigSnapshot,
  ConfigUiHints,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  HealthSnapshot,
  LogEntry,
  LogLevel,
  PresenceEntry,
  ChannelsStatusSnapshot,
  SessionsListResult,
  SkillStatusReport,
  StatusSummary,
  NostrProfile,
} from "./types.ts";
import type { NostrProfileFormState } from "./views/channels.nostr-profile-form.ts";
import {
  handleChannelConfigReload as handleChannelConfigReloadInternal,
  handleChannelConfigSave as handleChannelConfigSaveInternal,
  handleNostrProfileCancel as handleNostrProfileCancelInternal,
  handleNostrProfileEdit as handleNostrProfileEditInternal,
  handleNostrProfileFieldChange as handleNostrProfileFieldChangeInternal,
  handleNostrProfileImport as handleNostrProfileImportInternal,
  handleNostrProfileSave as handleNostrProfileSaveInternal,
  handleNostrProfileToggleAdvanced as handleNostrProfileToggleAdvancedInternal,
  handleWhatsAppLogout as handleWhatsAppLogoutInternal,
  handleWhatsAppStart as handleWhatsAppStartInternal,
  handleWhatsAppWait as handleWhatsAppWaitInternal,
} from "./app-channels.ts";
import {
  handleAbortChat as handleAbortChatInternal,
  handleSendChat as handleSendChatInternal,
  removeQueuedMessage as removeQueuedMessageInternal,
} from "./app-chat.ts";
import { DEFAULT_CRON_FORM, DEFAULT_LOG_LEVEL_FILTERS } from "./app-defaults.ts";
import { connectGateway as connectGatewayInternal } from "./app-gateway.ts";
import {
  handleConnected,
  handleDisconnected,
  handleFirstUpdated,
  handleUpdated,
} from "./app-lifecycle.ts";
import { renderApp } from "./app-render.ts";
import {
  exportLogs as exportLogsInternal,
  handleChatScroll as handleChatScrollInternal,
  handleLogsScroll as handleLogsScrollInternal,
  resetChatScroll as resetChatScrollInternal,
  scheduleChatScroll as scheduleChatScrollInternal,
} from "./app-scroll.ts";
import {
  applySettings as applySettingsInternal,
  loadCron as loadCronInternal,
  loadOverview as loadOverviewInternal,
  setTab as setTabInternal,
  setTheme as setThemeInternal,
  onPopState as onPopStateInternal,
} from "./app-settings.ts";
import {
  resetToolStream as resetToolStreamInternal,
  type ToolStreamEntry,
  type CompactionStatus,
} from "./app-tool-stream.ts";
import { resolveInjectedAssistantIdentity } from "./assistant-identity.ts";
import { loadAssistantIdentity as loadAssistantIdentityInternal } from "./controllers/assistant-identity.ts";
import { loadSettings, type UiSettings } from "./storage.ts";
import { type ChatAttachment, type ChatQueueItem, type CronFormState } from "./ui-types.ts";
import {
  hydratePmosConnectorDraftsFromConfig,
  loadPmosConnectorsStatus,
  savePmosConnectorsConfig,
  type PmosConnectorsStatus,
} from "./controllers/pmos-connectors.ts";
import {
  clearPmosModelApiKey,
  loadPmosModelWorkspaceState,
  savePmosModelConfig,
  setPmosModelProvider,
  type PmosModelProvider,
} from "./controllers/pmos-model-auth.ts";
import {
  loadPmosAuthSession,
  loginPmosAuth,
  logoutPmosAuth,
  signupPmosAuth,
  type PmosAuthUser,
} from "./controllers/pmos-auth.ts";
import type { PmosExecutionTraceEvent } from "./controllers/pmos-trace.ts";
import {
  hydratePmosAdminFromConfig,
  loadPmosAdminState,
  removePmosMember,
  savePmosAdminState,
  upsertPmosMember,
  type PmosAuditEvent,
  type PmosMember,
  type PmosMemberStatus,
  type PmosRole,
} from "./controllers/pmos-admin.ts";
import {
  approvePmosCommandStep,
  clearPmosCommandHistory,
  executePmosCommandPlan,
  planPmosCommand,
  type PmosCommandHistoryEntry,
  type PmosCommandPendingApproval,
  type PmosCommandPlanStep,
} from "./controllers/pmos-command-center.ts";
import {
  applyWorkflowOperationDraft,
  createWorkflowConnection,
  createWorkflow,
  deleteWorkflowConnection,
  deleteWorkflow,
  loadWorkflowConnections,
  loadWorkflows,
  loadWorkflowDetails,
  loadWorkflowPieces,
  loadWorkflowRunDetails,
  loadWorkflowRuns,
  publishWorkflow,
  renameWorkflow,
  retryWorkflowRun,
  setWorkflowStatus,
  triggerWorkflowWebhook,
} from "./controllers/pmos-workflows.ts";
import {
  commitPmosFlowBuilderPlan,
  generatePmosFlowBuilderPlan,
  resetPmosFlowBuilder,
  type PmosFlowGraphEdge,
  type PmosFlowGraphNode,
  type PmosFlowGraphOp,
} from "./controllers/pmos-flow-builder.ts";
import { loadConfig } from "./controllers/config.ts";

declare global {
  interface Window {
    __OPENCLAW_CONTROL_UI_BASE_PATH__?: string;
  }
}

const injectedAssistantIdentity = resolveInjectedAssistantIdentity();

function resolveOnboardingMode(): boolean {
  if (!window.location.search) {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("onboarding");
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

@customElement("openclaw-app")
export class OpenClawApp extends LitElement {
  @state() settings: UiSettings = loadSettings();
  @state() password = "";
  @state() tab: Tab = "dashboard";
  @state() onboarding = resolveOnboardingMode();
  @state() onboardingStep: 1 | 2 | 3 = 1;
  @state() notificationsOpen = false;
  @state() pmosAuthLoading = true;
  @state() pmosAuthAuthenticated = false;
  @state() pmosAuthMode: "signin" | "signup" = "signin";
  @state() pmosAuthName = "";
  @state() pmosAuthEmail = "";
  @state() pmosAuthPassword = "";
  @state() pmosAuthError: string | null = null;
  @state() pmosAuthUser: PmosAuthUser | null = null;
  @state() connected = false;
  @state() theme: ThemeMode = this.settings.theme ?? "system";
  @state() themeResolved: ResolvedTheme = "dark";
  @state() hello: GatewayHelloOk | null = null;
  @state() lastError: string | null = null;
  @state() eventLog: EventLogEntry[] = [];
  private eventLogBuffer: EventLogEntry[] = [];
  private toolStreamSyncTimer: number | null = null;
  private sidebarCloseTimer: number | null = null;

  @state() assistantName = injectedAssistantIdentity.name;
  @state() assistantAvatar = injectedAssistantIdentity.avatar;
  @state() assistantAgentId = injectedAssistantIdentity.agentId ?? null;

  @state() sessionKey = this.settings.sessionKey;
  @state() chatLoading = false;
  @state() chatSending = false;
  @state() chatMessage = "";
  @state() chatMessages: unknown[] = [];
  @state() chatToolMessages: unknown[] = [];
  @state() chatStream: string | null = null;
  @state() chatStreamStartedAt: number | null = null;
  @state() chatRunId: string | null = null;
  @state() compactionStatus: CompactionStatus | null = null;
  @state() chatAvatarUrl: string | null = null;
  @state() chatThinkingLevel: string | null = null;
  @state() chatQueue: ChatQueueItem[] = [];
  @state() chatAttachments: ChatAttachment[] = [];
  @state() chatManualRefreshInFlight = false;
  @state() dashboardNlDraft = "";
  @state() chatTraceLimit = 8;
  @state() chatCreateWorkflowBusy = false;
  @state() chatCreateWorkflowError: string | null = null;
  // Sidebar state for tool output viewing
  @state() sidebarOpen = false;
  @state() sidebarContent: string | null = null;
  @state() sidebarError: string | null = null;
  @state() splitRatio = this.settings.splitRatio;

  @state() nodesLoading = false;
  @state() nodes: Array<Record<string, unknown>> = [];
  @state() devicesLoading = false;
  @state() devicesError: string | null = null;
  @state() devicesList: DevicePairingList | null = null;
  @state() execApprovalsLoading = false;
  @state() execApprovalsSaving = false;
  @state() execApprovalsDirty = false;
  @state() execApprovalsSnapshot: ExecApprovalsSnapshot | null = null;
  @state() execApprovalsForm: ExecApprovalsFile | null = null;
  @state() execApprovalsSelectedAgent: string | null = null;
  @state() execApprovalsTarget: "gateway" | "node" = "gateway";
  @state() execApprovalsTargetNodeId: string | null = null;
  @state() execApprovalQueue: ExecApprovalRequest[] = [];
  @state() execApprovalBusy = false;
  @state() execApprovalError: string | null = null;
  @state() pendingGatewayUrl: string | null = null;

  @state() configLoading = false;
  @state() configRaw = "{\n}\n";
  @state() configRawOriginal = "";
  @state() configValid: boolean | null = null;
  @state() configIssues: unknown[] = [];
  @state() configSaving = false;
  @state() configApplying = false;
  @state() updateRunning = false;
  @state() applySessionKey = this.settings.lastActiveSessionKey;
  @state() configSnapshot: ConfigSnapshot | null = null;
  @state() configSchema: unknown = null;
  @state() configSchemaVersion: string | null = null;
  @state() configSchemaLoading = false;
  @state() configUiHints: ConfigUiHints = {};
  @state() configForm: Record<string, unknown> | null = null;
  @state() configFormOriginal: Record<string, unknown> | null = null;
  @state() configFormDirty = false;
  @state() configFormMode: "form" | "raw" = "form";
  @state() configSearchQuery = "";
  @state() configActiveSection: string | null = null;
  @state() configActiveSubsection: string | null = null;

  // PMOS connector onboarding (Phase 1)
  @state() pmosConnectorDraftsInitialized = false;
  @state() pmosOpsUrl = "https://ops.wickedlab.io";
  @state() pmosBcgptUrl = "https://bcgpt.wickedlab.io";
  @state() pmosBcgptApiKeyDraft = "";
  @state() pmosIntegrationsSaving = false;
  @state() pmosIntegrationsError: string | null = null;
  @state() pmosConnectorsLoading = false;
  @state() pmosConnectorsStatus: PmosConnectorsStatus | null = null;
  @state() pmosConnectorsError: string | null = null;
  @state() pmosConnectorsLastChecked: number | null = null;
  @state() pmosTraceEvents: PmosExecutionTraceEvent[] = [];

  // Wicked Ops (n8n) provisioning per-workspace
  @state() pmosOpsProvisioning = false;
  @state() pmosOpsProvisioningError: string | null = null;
  @state() pmosOpsProvisioningResult: { projectId?: string; apiKey?: string } | null = null;

  // Manual API-key fallback (when Projects API is license-gated)
  @state() pmosOpsManualApiKeyDraft = "";
  @state() pmosOpsSavingManualKey = false;

  // PMOS model auth quick setup (admin UX)
  @state() pmosModelProvider: PmosModelProvider = "google";
  @state() pmosModelId = "gemini-3-flash-preview";
  @state() pmosModelAlias = "gemini";
  @state() pmosModelApiKeyDraft = "";
  @state() pmosModelSaving = false;
  @state() pmosModelSavedOk = false;
  @state() pmosModelError: string | null = null;
  @state() pmosModelConfigured = false;
  @state() pmosBcgptSavedOk = false;
  @state() pmosBasecampSetupPending = false;
  @state() pmosBasecampSetupOk = false;
  @state() pmosBasecampSetupError: string | null = null;
  @state() pmosByokProviders: PmosModelProvider[] = [];

  // PMOS identity/admin (Phase 4)
  @state() pmosAdminDraftsInitialized = false;
  @state() pmosAdminLoading = false;
  @state() pmosAdminSaving = false;
  @state() pmosAdminError: string | null = null;
  @state() pmosWorkspaceId = "default";
  @state() pmosWorkspaceName = "PMOS Workspace";
  @state() pmosCurrentUserName = "";
  @state() pmosCurrentUserEmail = "";
  @state() pmosCurrentUserRole: PmosRole = "workspace_admin";
  @state() pmosMembers: PmosMember[] = [];
  @state() pmosMemberDraftName = "";
  @state() pmosMemberDraftEmail = "";
  @state() pmosMemberDraftRole: PmosRole = "member";
  @state() pmosMemberDraftStatus: PmosMemberStatus = "active";
  @state() pmosMemberRemoveConfirm: string | null = null;
  @state() pmosAuditEvents: PmosAuditEvent[] = [];
  @state() pmosWorkspacesList: Array<{ workspaceId: string; ownerEmail: string; ownerName: string; ownerRole: string; createdAtMs: number }> = [];
  @state() pmosWorkspacesLoading = false;
  @state() pmosWorkspacesError: string | null = null;

  // PMOS unified command center (Phase 6)
  @state() pmosCommandPrompt = "";
  @state() pmosCommandPlanning = false;
  @state() pmosCommandExecuting = false;
  @state() pmosCommandError: string | null = null;
  @state() pmosCommandPlan: PmosCommandPlanStep[] = [];
  @state() pmosCommandHistory: PmosCommandHistoryEntry[] = [];
  @state() pmosCommandPendingApprovals: PmosCommandPendingApproval[] = [];

  // PMOS workflows native embed (Phase 2)
  @state() apPiecesLoading = false;
  @state() apPiecesError: string | null = null;
  @state() apPiecesQuery = "";
  @state() apPieces: import("./controllers/pmos-workflows.ts").WorkflowPieceSummary[] = [];
  @state() apPieceSelectedName: string | null = null;
  @state() apPieceDetailsLoading = false;
  @state() apPieceDetailsError: string | null = null;
  @state() apPieceDetails: unknown | null = null;

  @state() apConnectionsLoading = false;
  @state() apConnectionsError: string | null = null;
  @state() apConnections: import("./controllers/pmos-workflows.ts").WorkflowConnectionSummary[] =
    [];
  @state() apConnectionsCursor: string | null = null;
  @state() apConnectionsHasNext = false;
  @state() apConnectionCreateSaving = false;
  @state() apConnectionCreateError: string | null = null;
  @state() apConnectionCreatePieceName = "";
  @state() apConnectionCreateDisplayName = "";
  @state() apConnectionCreateType: "secret_text" | "basic_auth" | "no_auth" = "secret_text";
  @state() apConnectionCreateSecretText = "";
  @state() apConnectionCreateBasicUser = "";
  @state() apConnectionCreateBasicPass = "";

  @state() apFlowsLoading = false;
  @state() apFlowsError: string | null = null;
  @state() apFlowsQuery = "";
  @state() apFlows: import("./controllers/pmos-workflows.ts").WorkflowSummary[] = [];
  @state() apFlowsCursor: string | null = null;
  @state() apFlowsHasNext = false;
  @state() apFlowCreateName = "";
  @state() apFlowCreateSaving = false;
  @state() apFlowCreateError: string | null = null;
  @state() apFlowSelectedId: string | null = null;
  @state() apFlowDetailsLoading = false;
  @state() apFlowDetailsError: string | null = null;
  @state() apFlowDetails: unknown | null = null;
  @state() apFlowRenameDraft = "";
  @state() apFlowOperationDraft = "";
  @state() apFlowTriggerPayloadDraft = "{\n  \n}\n";
  @state() apFlowMutating = false;
  @state() apFlowMutateError: string | null = null;
  @state() apFlowTemplateDeployedOk = false;
  @state() automationsPanelOpen = true;
  @state() automationsPanelTab: "workflows" | "templates" | "settings" | "runs" = "workflows";
  @state() automationsChatOpen = false;
  @state() workflowChatDraft = "";
  @state() workflowChatMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  @state() workflowChatSending = false;

  // PMOS AI flow builder stream (Phase 5)
  @state() pmosFlowBuilderPrompt = "";
  @state() pmosFlowBuilderGenerating = false;
  @state() pmosFlowBuilderCommitting = false;
  @state() pmosFlowBuilderError: string | null = null;
  @state() pmosFlowBuilderFlowName = "";
  @state() pmosFlowBuilderNodes: PmosFlowGraphNode[] = [];
  @state() pmosFlowBuilderEdges: PmosFlowGraphEdge[] = [];
  @state() pmosFlowBuilderOps: PmosFlowGraphOp[] = [];
  @state() pmosFlowBuilderOpIndex = 0;
  @state() pmosFlowBuilderLastCommittedFlowId: string | null = null;

  @state() apRunsLoading = false;
  @state() apRunsError: string | null = null;
  @state() apRuns: import("./controllers/pmos-workflows.ts").WorkflowRunSummary[] = [];
  @state() apRunsCursor: string | null = null;
  @state() apRunsHasNext = false;
  @state() apRunSelectedId: string | null = null;
  @state() apRunDetailsLoading = false;
  @state() apRunDetailsError: string | null = null;
  @state() apRunDetails: unknown | null = null;
  @state() apRunRetrying = false;
  @state() apRunRetryError: string | null = null;

  @state() channelsLoading = false;
  @state() channelsSnapshot: ChannelsStatusSnapshot | null = null;
  @state() channelsError: string | null = null;
  @state() channelsLastSuccess: number | null = null;
  @state() whatsappLoginMessage: string | null = null;
  @state() whatsappLoginQrDataUrl: string | null = null;
  @state() whatsappLoginConnected: boolean | null = null;
  @state() whatsappBusy = false;
  @state() nostrProfileFormState: NostrProfileFormState | null = null;
  @state() nostrProfileAccountId: string | null = null;

  @state() presenceLoading = false;
  @state() presenceEntries: PresenceEntry[] = [];
  @state() presenceError: string | null = null;
  @state() presenceStatus: string | null = null;

  @state() agentsLoading = false;
  @state() agentsList: AgentsListResult | null = null;
  @state() agentsError: string | null = null;
  @state() agentsSelectedId: string | null = null;
  @state() agentsPanel: "overview" | "files" | "tools" | "skills" | "channels" | "cron" =
    "overview";
  @state() agentFilesLoading = false;
  @state() agentFilesError: string | null = null;
  @state() agentFilesList: AgentsFilesListResult | null = null;
  @state() agentFileContents: Record<string, string> = {};
  @state() agentFileDrafts: Record<string, string> = {};
  @state() agentFileActive: string | null = null;
  @state() agentFileSaving = false;
  @state() agentIdentityLoading = false;
  @state() agentIdentityError: string | null = null;
  @state() agentIdentityById: Record<string, AgentIdentityResult> = {};
  @state() agentSkillsLoading = false;
  @state() agentSkillsError: string | null = null;
  @state() agentSkillsReport: SkillStatusReport | null = null;
  @state() agentSkillsAgentId: string | null = null;
  // Create Agent Modal state
  @state() createModalOpen = false;
  @state() createModalLoading = false;
  @state() createModalError: string | null = null;
  @state() createModalFormData: import("./views/agents.js").CreateAgentFormData = {
    name: "",
    purpose: "",
    mode: "interactive",
    model: "",
    skills: [],
    personality: "professional",
    autonomousTasks: [],
  };
  @state() availableModels: string[] = [];
  @state() availableSkills: string[] = [];
  @state() agentActivityById: Record<string, import("./views/agents.js").AgentActivitySummary> = {};

  @state() sessionsLoading = false;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() sessionsError: string | null = null;
  @state() sessionsFilterActive = "";
  @state() sessionsFilterLimit = "120";
  @state() sessionsIncludeGlobal = true;
  @state() sessionsIncludeUnknown = false;

  @state() usageLoading = false;
  @state() usageResult: import("./types.js").SessionsUsageResult | null = null;
  @state() usageCostSummary: import("./types.js").CostUsageSummary | null = null;
  @state() usageError: string | null = null;
  @state() usageStartDate = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  @state() usageEndDate = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  @state() usageSelectedSessions: string[] = [];
  @state() usageSelectedDays: string[] = [];
  @state() usageSelectedHours: number[] = [];
  @state() usageChartMode: "tokens" | "cost" = "tokens";
  @state() usageDailyChartMode: "total" | "by-type" = "by-type";
  @state() usageTimeSeriesMode: "cumulative" | "per-turn" = "per-turn";
  @state() usageTimeSeriesBreakdownMode: "total" | "by-type" = "by-type";
  @state() usageTimeSeries: import("./types.js").SessionUsageTimeSeries | null = null;
  @state() usageTimeSeriesLoading = false;
  @state() usageSessionLogs: import("./views/usage.js").SessionLogEntry[] | null = null;
  @state() usageSessionLogsLoading = false;
  @state() usageSessionLogsExpanded = false;
  // Applied query (used to filter the already-loaded sessions list client-side).
  @state() usageQuery = "";
  // Draft query text (updates immediately as the user types; applied via debounce or "Search").
  @state() usageQueryDraft = "";
  @state() usageSessionSort: "tokens" | "cost" | "recent" | "messages" | "errors" = "recent";
  @state() usageSessionSortDir: "desc" | "asc" = "desc";
  @state() usageRecentSessions: string[] = [];
  @state() usageTimeZone: "local" | "utc" = "local";
  @state() usageContextExpanded = false;
  @state() usageHeaderPinned = false;
  @state() usageSessionsTab: "all" | "recent" = "all";
  @state() usageVisibleColumns: string[] = [
    "channel",
    "agent",
    "provider",
    "model",
    "messages",
    "tools",
    "errors",
    "duration",
  ];
  @state() usageLogFilterRoles: import("./views/usage.js").SessionLogRole[] = [];
  @state() usageLogFilterTools: string[] = [];
  @state() usageLogFilterHasTools = false;
  @state() usageLogFilterQuery = "";

  // Non-reactive (don’t trigger renders just for timer bookkeeping).
  usageQueryDebounceTimer: number | null = null;

  @state() cronLoading = false;
  @state() cronJobs: CronJob[] = [];
  @state() cronStatus: CronStatus | null = null;
  @state() cronError: string | null = null;
  @state() cronForm: CronFormState = { ...DEFAULT_CRON_FORM };
  @state() cronRunsJobId: string | null = null;
  @state() cronRuns: CronRunLogEntry[] = [];
  @state() cronBusy = false;

  @state() skillsLoading = false;
  @state() skillsReport: SkillStatusReport | null = null;
  @state() skillsError: string | null = null;
  @state() skillsFilter = "";
  @state() skillEdits: Record<string, string> = {};
  @state() skillsBusyKey: string | null = null;
  @state() skillMessages: Record<string, SkillMessage> = {};

  @state() debugLoading = false;
  @state() debugStatus: StatusSummary | null = null;
  @state() debugHealth: HealthSnapshot | null = null;
  @state() debugModels: unknown[] = [];
  @state() debugHeartbeat: unknown = null;
  @state() debugCallMethod = "";
  @state() debugCallParams = "{}";
  @state() debugCallResult: string | null = null;
  @state() debugCallError: string | null = null;

  @state() logsLoading = false;
  @state() logsError: string | null = null;
  @state() logsFile: string | null = null;
  @state() logsEntries: LogEntry[] = [];
  @state() logsFilterText = "";
  @state() logsLevelFilters: Record<LogLevel, boolean> = {
    ...DEFAULT_LOG_LEVEL_FILTERS,
  };
  @state() logsAutoFollow = true;
  @state() logsTruncated = false;
  @state() logsCursor: number | null = null;
  @state() logsLastFetchAt: number | null = null;
  @state() logsLimit = 500;
  @state() logsMaxBytes = 250_000;
  @state() logsAtBottom = true;

  client: GatewayBrowserClient | null = null;
  private chatScrollFrame: number | null = null;
  private chatScrollTimeout: number | null = null;
  private chatHasAutoScrolled = false;
  private chatUserNearBottom = true;
  @state() chatNewMessagesBelow = false;
  private nodesPollInterval: number | null = null;
  dashboardPollInterval: number | null = null;
  private logsPollInterval: number | null = null;
  private debugPollInterval: number | null = null;
  private logsScrollFrame: number | null = null;
  private toolStreamById = new Map<string, ToolStreamEntry>();
  private toolStreamOrder: string[] = [];
  refreshSessionsAfterChat = new Set<string>();
  basePath = "";
  private popStateHandler = () =>
    onPopStateInternal(this as unknown as Parameters<typeof onPopStateInternal>[0]);
  private themeMedia: MediaQueryList | null = null;
  private themeMediaHandler: ((event: MediaQueryListEvent) => void) | null = null;
  private topbarObserver: ResizeObserver | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    handleConnected(this as unknown as Parameters<typeof handleConnected>[0]);
    void this.handlePmosAuthBootstrap();
  }

  protected firstUpdated() {
    handleFirstUpdated(this as unknown as Parameters<typeof handleFirstUpdated>[0]);
  }

  disconnectedCallback() {
    handleDisconnected(this as unknown as Parameters<typeof handleDisconnected>[0]);
    super.disconnectedCallback();
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    handleUpdated(this as unknown as Parameters<typeof handleUpdated>[0], changed);
  }

  connect() {
    connectGatewayInternal(this as unknown as Parameters<typeof connectGatewayInternal>[0]);
  }

  async handlePmosAuthBootstrap() {
    await loadPmosAuthSession(this);
    if (this.pmosAuthAuthenticated) {
      this.connect();
    }
  }

  async handlePmosAuthSubmit() {
    const ok =
      this.pmosAuthMode === "signup" ? await signupPmosAuth(this) : await loginPmosAuth(this);
    if (!ok) {
      return;
    }
    this.lastError = null;
    if (this.pmosAuthMode === "signup") {
      this.onboarding = true;
    }
    this.connect();
  }

  async handlePmosAuthLogout() {
    await logoutPmosAuth(this);
    this.client?.stop();
    this.client = null;
    this.connected = false;
    this.hello = null;
    this.lastError = null;
    this.execApprovalQueue = [];
    this.execApprovalError = null;
  }

  handleChatScroll(event: Event) {
    handleChatScrollInternal(
      this as unknown as Parameters<typeof handleChatScrollInternal>[0],
      event,
    );
  }

  handleLogsScroll(event: Event) {
    handleLogsScrollInternal(
      this as unknown as Parameters<typeof handleLogsScrollInternal>[0],
      event,
    );
  }

  exportLogs(lines: string[], label: string) {
    exportLogsInternal(lines, label);
  }

  resetToolStream() {
    resetToolStreamInternal(this as unknown as Parameters<typeof resetToolStreamInternal>[0]);
  }

  resetChatScroll() {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
  }

  scrollToBottom(opts?: { smooth?: boolean }) {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
    scheduleChatScrollInternal(
      this as unknown as Parameters<typeof scheduleChatScrollInternal>[0],
      true,
      Boolean(opts?.smooth),
    );
  }

  async loadAssistantIdentity() {
    await loadAssistantIdentityInternal(this);
  }

  applySettings(next: UiSettings) {
    applySettingsInternal(this as unknown as Parameters<typeof applySettingsInternal>[0], next);
  }

  setTab(next: Tab) {
    setTabInternal(this as unknown as Parameters<typeof setTabInternal>[0], next);
    // Auto-load workspaces list when super_admin opens admin tab
    if (next === "admin" && this.pmosAuthUser?.role === "super_admin" && this.pmosWorkspacesList.length === 0 && !this.pmosWorkspacesLoading) {
      void this._loadWorkspacesList();
    }
  }

  async _loadWorkspacesList() {
    this.pmosWorkspacesLoading = true;
    this.pmosWorkspacesError = null;
    try {
      const res = await this.client!.request<{ workspaces: Array<{ workspaceId: string; ownerEmail: string; ownerName: string; ownerRole: string; createdAtMs: number }> }>("pmos.workspaces.list", {});
      this.pmosWorkspacesList = res.workspaces ?? [];
    } catch (err) {
      this.pmosWorkspacesError = String(err);
    } finally {
      this.pmosWorkspacesLoading = false;
    }
  }

  setTheme(next: ThemeMode, context?: Parameters<typeof setThemeInternal>[2]) {
    setThemeInternal(this as unknown as Parameters<typeof setThemeInternal>[0], next, context);
  }

  async loadOverview() {
    await loadOverviewInternal(this as unknown as Parameters<typeof loadOverviewInternal>[0]);
  }

  async loadCron() {
    await loadCronInternal(this as unknown as Parameters<typeof loadCronInternal>[0]);
  }

  async handleAbortChat() {
    await handleAbortChatInternal(this as unknown as Parameters<typeof handleAbortChatInternal>[0]);
  }

  async handlePmosRefreshConnectors() {
    await loadPmosConnectorsStatus(this);

    // Refresh workspace-scoped Wicked Ops connectors (if any)
    try {
      if (this.client && this.connected) {
        const ws = await this.client.request<{ workspaceId: string; connectors: Record<string, any> }>(
          "pmos.connectors.workspace.get",
          {},
        );
        const ops = ws?.connectors?.ops ?? null;
        if (ops && typeof ops === "object" && ops.apiKey) {
          const key = String(ops.apiKey);
          this.pmosOpsProvisioningResult = { projectId: ops.projectId ?? undefined, apiKey: key };
          this.pmosOpsManualApiKeyDraft = key;
          this.pmosOpsProvisioningError = null;
        } else {
          this.pmosOpsProvisioningResult = null;
          this.pmosOpsManualApiKeyDraft = "";
        }
      }
    } catch (err) {
      // ignore workspace-read failures (UI remains usable)
      this.pmosOpsProvisioningResult = null;
    }
  }

  handlePmosTraceClear() {
    this.pmosTraceEvents = [];
  }

  async handlePmosAdminLoad() {
    await loadPmosAdminState(this);
    hydratePmosAdminFromConfig(this);
  }

  async handlePmosAdminSave(opts?: { action?: string; target?: string; detail?: string }) {
    await savePmosAdminState(this, opts);
    await loadPmosAdminState(this);
  }

  async handlePmosMemberUpsert() {
    this.pmosAdminError = null;
    upsertPmosMember(this);
    if (this.pmosAdminError) {
      return;
    }
    await this.handlePmosAdminSave({
      action: "pmos.admin.member.upsert",
      target: this.pmosMemberDraftEmail.trim().toLowerCase() || "member",
    });
    this.pmosMemberDraftName = "";
    this.pmosMemberDraftEmail = "";
    this.pmosMemberDraftRole = "member";
    this.pmosMemberDraftStatus = "active";
  }

  async handlePmosMemberRemove(email: string) {
    this.pmosAdminError = null;
    removePmosMember(this, email);
    if (this.pmosAdminError) {
      return;
    }
    await this.handlePmosAdminSave({
      action: "pmos.admin.member.remove",
      target: email.trim().toLowerCase(),
    });
  }

  async handlePmosIntegrationsLoad() {
    await loadConfig(this);
    hydratePmosConnectorDraftsFromConfig(this);
    await loadPmosModelWorkspaceState(this);
    await loadPmosConnectorsStatus(this);

    // Load any existing workspace-scoped Wicked Ops connectors so the UI can reflect provisioning state
    try {
      if (this.client && this.connected) {
        const ws = await this.client.request<{ workspaceId: string; connectors: Record<string, any> }>(
          "pmos.connectors.workspace.get",
          {},
        );
        const ops = ws?.connectors?.ops ?? null;
        if (ops && typeof ops === "object" && ops.apiKey) {
          const key = String(ops.apiKey);
          this.pmosOpsProvisioningResult = { projectId: ops.projectId ?? undefined, apiKey: key };
          this.pmosOpsManualApiKeyDraft = key;
          this.pmosOpsProvisioningError = null;
        } else {
          this.pmosOpsProvisioningResult = null;
          this.pmosOpsManualApiKeyDraft = "";
        }
      }
    } catch (err) {
      this.pmosOpsProvisioningResult = null;
    }
  }

  async handlePmosIntegrationsSave() {
    await savePmosConnectorsConfig(this);
    await loadConfig(this);
    this.pmosConnectorDraftsInitialized = false;
    hydratePmosConnectorDraftsFromConfig(this);
    await loadPmosModelWorkspaceState(this);
    await loadPmosConnectorsStatus(this);
    this.pmosBcgptSavedOk = true;
    setTimeout(() => { this.pmosBcgptSavedOk = false; }, 2500);
  }

  async handlePmosSetupBasecampInN8n() {
    if (!this.client || this.pmosBasecampSetupPending) return;
    this.pmosBasecampSetupPending = true;
    this.pmosBasecampSetupError = null;
    this.pmosBasecampSetupOk = false;
    try {
      await this.client.request("pmos.ops.setup.basecamp", {});
      this.pmosBasecampSetupOk = true;
      setTimeout(() => { this.pmosBasecampSetupOk = false; }, 3000);
    } catch (err) {
      this.pmosBasecampSetupError = err instanceof Error ? err.message : String(err);
    } finally {
      this.pmosBasecampSetupPending = false;
    }
  }

  async handlePmosIntegrationsClearBcgptKey() {
    await savePmosConnectorsConfig(this, { clearBcgptKey: true });
    await loadConfig(this);
    this.pmosConnectorDraftsInitialized = false;
    hydratePmosConnectorDraftsFromConfig(this);
    await loadPmosModelWorkspaceState(this);
    await loadPmosConnectorsStatus(this);
  }

  async handlePmosProvisionOps(opts?: { projectName?: string }) {
    if (!this.client || !this.connected) {
      this.pmosOpsProvisioningError = "Not connected to gateway";
      return;
    }
    this.pmosOpsProvisioning = true;
    this.pmosOpsProvisioningError = null;
    this.pmosOpsProvisioningResult = null;
    try {
      const res = await this.client.request<{ ok?: boolean; projectId?: string; apiKey?: string }>(
        "pmos.connectors.workspace.provision_ops",
        { projectName: opts?.projectName ?? undefined },
      );
      // persist result in UI state and refresh connectors
      this.pmosOpsProvisioningResult = { projectId: res.projectId, apiKey: res.apiKey };
      this.pmosOpsProvisioningError = null;
      await this.handlePmosRefreshConnectors();
    } catch (err) {
      // keep original error message for display and allow manual-key fallback UI to show
      this.pmosOpsProvisioningError = String(err);
    } finally {
      this.pmosOpsProvisioning = false;
    }
  }

  async handlePmosSaveManualOpsKey() {
    if (!this.client || !this.connected) {
      this.pmosOpsProvisioningError = "Not connected to gateway";
      return;
    }
    const key = String(this.pmosOpsManualApiKeyDraft ?? "").trim();
    if (!key) {
      this.pmosOpsProvisioningError = "API key cannot be empty";
      return;
    }

    this.pmosOpsSavingManualKey = true;
    this.pmosOpsProvisioningError = null;
    try {
      await this.client.request("pmos.connectors.workspace.set", { connectors: { ops: { apiKey: key } } });
      // reflect saved key in UI state and refresh connectors
      this.pmosOpsProvisioningResult = { apiKey: key };
      this.pmosOpsManualApiKeyDraft = "";
      await this.handlePmosRefreshConnectors();
    } catch (err) {
      this.pmosOpsProvisioningError = String(err);
    } finally {
      this.pmosOpsSavingManualKey = false;
    }
  }

  handlePmosModelProviderChange(next: PmosModelProvider) {
    setPmosModelProvider(this, next);
  }

  async handlePmosModelSave() {
    await savePmosModelConfig(this);
    await loadPmosModelWorkspaceState(this);
    this.pmosModelSavedOk = true;
    setTimeout(() => { this.pmosModelSavedOk = false; }, 2500);
  }

  async handlePmosModelClearKey() {
    await clearPmosModelApiKey(this);
    await loadPmosModelWorkspaceState(this);
  }

  async handlePmosApPiecesLoad() {
    await loadWorkflowPieces(this as unknown as Parameters<typeof loadWorkflowPieces>[0]);
  }

  async handlePmosApConnectionsLoad() {
    await loadWorkflowConnections(
      this as unknown as Parameters<typeof loadWorkflowConnections>[0],
    );
  }

  async handlePmosApConnectionCreate() {
    await createWorkflowConnection(
      this as unknown as Parameters<typeof createWorkflowConnection>[0],
    );
  }

  async handlePmosApConnectionDelete(connectionId: string) {
    await deleteWorkflowConnection(
      this as unknown as Parameters<typeof deleteWorkflowConnection>[0],
      connectionId,
    );
  }

  async handlePmosApFlowsLoad() {
    await loadWorkflows(this as unknown as Parameters<typeof loadWorkflows>[0]);
  }

  async handlePmosApFlowCreate() {
    await createWorkflow(this as unknown as Parameters<typeof createWorkflow>[0]);
  }

  async handlePmosApFlowSelect(flowId: string) {
    await loadWorkflowDetails(
      this as unknown as Parameters<typeof loadWorkflowDetails>[0],
      flowId,
    );
  }

  async handlePmosApFlowRename() {
    await renameWorkflow(this as unknown as Parameters<typeof renameWorkflow>[0]);
  }

  async handlePmosApFlowSetStatus(status: "ENABLED" | "DISABLED") {
    await setWorkflowStatus(
      this as unknown as Parameters<typeof setWorkflowStatus>[0],
      status,
    );
  }

  async handlePmosApFlowPublish() {
    await publishWorkflow(
      this as unknown as Parameters<typeof publishWorkflow>[0],
    );
  }

  async handlePmosApFlowDelete() {
    await deleteWorkflow(this as unknown as Parameters<typeof deleteWorkflow>[0]);
  }

  async handlePmosApFlowApplyOperation() {
    await applyWorkflowOperationDraft(
      this as unknown as Parameters<typeof applyWorkflowOperationDraft>[0],
    );
  }

  async handlePmosApFlowTriggerWebhook(opts?: { draft?: boolean; sync?: boolean }) {
    await triggerWorkflowWebhook(
      this as unknown as Parameters<typeof triggerWorkflowWebhook>[0],
      opts,
    );
  }

  async handlePmosFlowBuilderGenerate() {
    await generatePmosFlowBuilderPlan(this);
  }

  async handlePmosFlowBuilderCommit() {
    await commitPmosFlowBuilderPlan(this);
  }

  handlePmosFlowBuilderReset() {
    resetPmosFlowBuilder(this);
  }

  async handleWorkflowChatSend() {
    const message = this.workflowChatDraft.trim();
    if (!message || this.workflowChatSending) return;
    this.workflowChatDraft = "";

    // Append user message and send full history to the AI
    const history = [...this.workflowChatMessages, { role: "user" as const, content: message }];
    this.workflowChatMessages = history;
    this.workflowChatSending = true;

    try {
      const result = await this.client!.request("pmos.workflow.assist", {
        messages: history.map(m => ({ role: m.role, content: m.content })),
      }) as {
        ok: boolean;
        message: string;
        workflow?: {
          name: string;
          nodes: unknown[];
          connections: Record<string, unknown>;
        } | null;
        providerError?: boolean;
        providerUsed?: string;
      };

      const reply = result.message || "I couldn't process that.";
      this.workflowChatMessages = [...this.workflowChatMessages, { role: "assistant", content: reply }];

      // If the AI returned a workflow, auto-create it in n8n
      if (result.workflow && typeof result.workflow === "object" && result.workflow.nodes?.length) {
        try {
          const created = await this.client!.request("pmos.workflow.confirm", {
            workflow: {
              name: result.workflow.name || "AI-Generated Workflow",
              nodes: result.workflow.nodes,
              connections: result.workflow.connections ?? {},
            },
            confirmed: true,
          }) as { success: boolean; workflowId?: string; message?: string };

          if (created.success && created.workflowId) {
            const successMsg = `✓ Workflow created! Open it in the n8n editor to configure credentials and test it. (ID: ${String(created.workflowId).slice(0, 8)}…)`;
            this.workflowChatMessages = [...this.workflowChatMessages, { role: "assistant", content: successMsg }];
            void this.handlePmosApFlowsLoad();
          }
        } catch {
          // Non-fatal — user can create manually
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.workflowChatMessages = [...this.workflowChatMessages, { role: "assistant", content: `Error: ${errMsg}` }];
    } finally {
      this.workflowChatSending = false;
    }
  }

  async handlePmosApRunsLoad() {
    await loadWorkflowRuns(this as unknown as Parameters<typeof loadWorkflowRuns>[0]);
  }

  async handlePmosApRunSelect(runId: string) {
    await loadWorkflowRunDetails(
      this as unknown as Parameters<typeof loadWorkflowRunDetails>[0],
      runId,
    );
  }

  async handlePmosApRunRetry(strategy: "FROM_FAILED_STEP" | "ON_LATEST_VERSION") {
    await retryWorkflowRun(
      this as unknown as Parameters<typeof retryWorkflowRun>[0],
      strategy,
    );
  }

  async handlePmosCommandPlan() {
    await planPmosCommand(this);
  }

  async handlePmosCommandExecute() {
    await executePmosCommandPlan(this);
  }

  async handlePmosCommandApprove(approvalId: string) {
    await approvePmosCommandStep(this, approvalId);
  }

  handlePmosCommandClearHistory() {
    clearPmosCommandHistory(this);
  }

  removeQueuedMessage(id: string) {
    removeQueuedMessageInternal(
      this as unknown as Parameters<typeof removeQueuedMessageInternal>[0],
      id,
    );
  }

  async handleSendChat(
    messageOverride?: string,
    opts?: Parameters<typeof handleSendChatInternal>[2],
  ) {
    const message = (messageOverride ?? this.chatMessage ?? "").trim();
    
    // Detect workflow creation intent
    const workflowKeywords = [
      "create workflow", "make a workflow", "build workflow", "new workflow",
      "create automation", "make automation", "build automation", "new automation",
      "create a flow", "make a flow", "build a flow", "new flow",
      "set up workflow", "setup workflow", "automate this", "workflow that",
      "n8n workflow", "create an n8n", "build an n8n"
    ];
    const isWorkflowIntent = workflowKeywords.some(kw => 
      message.toLowerCase().includes(kw));
    
    if (isWorkflowIntent) {
      // Route to workflow assistant
      this.workflowChatDraft = message;
      this.workflowChatMessages = []; // Start fresh
      await this.handleWorkflowChatSend();
      // Switch to automations tab to show the result
      this.setTab("automations");
      return;
    }
    
    // Regular chat
    await handleSendChatInternal(
      this as unknown as Parameters<typeof handleSendChatInternal>[0],
      messageOverride,
      opts,
    );
  }

  async handleChatCreateWorkflow() {
    const draft = (this.chatMessage ?? "").trim();
    if (!draft) {
      this.lastError = "Type a message first to create a workflow.";
      return;
    }

    // Simple title: first 6 words title-cased
    const words = draft.split(/\s+/).filter(Boolean).slice(0, 6);
    const title = (words.length ? words.join(" ") : "New Automation").slice(0, 64);
    const name = title.replace(/\b\w/g, (c) => c.toUpperCase());

    this.chatCreateWorkflowBusy = true;
    this.chatCreateWorkflowError = null;
    try {
      // Lazy import controller to avoid circular deps
      const mod = await import("./controllers/wicked-ops.js");
      const res = await mod.generateN8nWorkflow(
        this as unknown as Parameters<typeof mod.generateN8nWorkflow>[0],
        name,
        draft,
      );

      const details = (res ?? {}) as Record<string, unknown>;
      const possibleId =
        details.id ?? details.workflowId ?? (details.data && (details.data as any).id) ??
        (details.details && (details.details as any).id);
      const workflowId = possibleId ? String(possibleId) : undefined;

      // Keep workflow editing native inside the dashboard tab.
      if (workflowId) {
        this.apFlowSelectedId = workflowId;
        this.setTab("automations");
        return;
      }

      this.lastError =
        "Workflow created but ID could not be detected. Opening Workflows tab.";
      this.setTab("automations");
    } catch (err) {
      this.chatCreateWorkflowError = String(err ?? "unknown error");
      this.lastError = `Create workflow failed: ${String(err)}`;
    } finally {
      this.chatCreateWorkflowBusy = false;
    }
  }

  async handleWhatsAppStart(force: boolean) {
    await handleWhatsAppStartInternal(this, force);
  }

  async handleWhatsAppWait() {
    await handleWhatsAppWaitInternal(this);
  }

  async handleWhatsAppLogout() {
    await handleWhatsAppLogoutInternal(this);
  }

  async handleChannelConfigSave() {
    await handleChannelConfigSaveInternal(this);
  }

  async handleChannelConfigReload() {
    await handleChannelConfigReloadInternal(this);
  }

  handleNostrProfileEdit(accountId: string, profile: NostrProfile | null) {
    handleNostrProfileEditInternal(this, accountId, profile);
  }

  handleNostrProfileCancel() {
    handleNostrProfileCancelInternal(this);
  }

  handleNostrProfileFieldChange(field: keyof NostrProfile, value: string) {
    handleNostrProfileFieldChangeInternal(this, field, value);
  }

  async handleNostrProfileSave() {
    await handleNostrProfileSaveInternal(this);
  }

  async handleNostrProfileImport() {
    await handleNostrProfileImportInternal(this);
  }

  handleNostrProfileToggleAdvanced() {
    handleNostrProfileToggleAdvancedInternal(this);
  }

  async handleExecApprovalDecision(decision: "allow-once" | "allow-always" | "deny") {
    const active = this.execApprovalQueue[0];
    if (!active || !this.client || this.execApprovalBusy) {
      return;
    }
    this.execApprovalBusy = true;
    this.execApprovalError = null;
    try {
      await this.client.request("exec.approval.resolve", {
        id: active.id,
        decision,
      });
      this.execApprovalQueue = this.execApprovalQueue.filter((entry) => entry.id !== active.id);
    } catch (err) {
      this.execApprovalError = `Exec approval failed: ${String(err)}`;
    } finally {
      this.execApprovalBusy = false;
    }
  }

  handleGatewayUrlConfirm() {
    const nextGatewayUrl = this.pendingGatewayUrl;
    if (!nextGatewayUrl) {
      return;
    }
    this.pendingGatewayUrl = null;
    applySettingsInternal(this as unknown as Parameters<typeof applySettingsInternal>[0], {
      ...this.settings,
      gatewayUrl: nextGatewayUrl,
    });
    this.connect();
  }

  handleGatewayUrlCancel() {
    this.pendingGatewayUrl = null;
  }

  // Sidebar handlers for tool output viewing
  handleOpenSidebar(content: string) {
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
      this.sidebarCloseTimer = null;
    }
    this.sidebarContent = content;
    this.sidebarError = null;
    this.sidebarOpen = true;
  }

  handleCloseSidebar() {
    this.sidebarOpen = false;
    // Clear content after transition
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
    }
    this.sidebarCloseTimer = window.setTimeout(() => {
      if (this.sidebarOpen) {
        return;
      }
      this.sidebarContent = null;
      this.sidebarError = null;
      this.sidebarCloseTimer = null;
    }, 200);
  }

  handleSplitRatioChange(ratio: number) {
    const newRatio = Math.max(0.4, Math.min(0.7, ratio));
    this.splitRatio = newRatio;
    this.applySettings({ ...this.settings, splitRatio: newRatio });
  }

  render() {
    return renderApp(this as unknown as AppViewState);
  }
}
