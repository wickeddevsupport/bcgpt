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
  hydratePmosModelDraftFromConfig,
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
  applyActivepiecesFlowOperationDraft,
  createActivepiecesConnection,
  createActivepiecesFlow,
  deleteActivepiecesConnection,
  deleteActivepiecesFlow,
  loadActivepiecesConnections,
  loadActivepiecesFlows,
  loadActivepiecesFlowDetails,
  loadActivepiecesPieces,
  loadActivepiecesRunDetails,
  loadActivepiecesRuns,
  publishActivepiecesFlow,
  renameActivepiecesFlow,
  retryActivepiecesRun,
  setActivepiecesFlowStatus,
  triggerActivepiecesFlowWebhook,
} from "./controllers/pmos-activepieces.ts";
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
  @state() pmosActivepiecesUrl = "https://flow.wickedlab.io";
  @state() pmosActivepiecesProjectId = "";
  @state() pmosActivepiecesApiKeyDraft = "";
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

  // PMOS model auth quick setup (admin UX)
  @state() pmosModelProvider: PmosModelProvider = "google";
  @state() pmosModelId = "gemini-3-flash-preview";
  @state() pmosModelAlias = "gemini";
  @state() pmosModelApiKeyDraft = "";
  @state() pmosModelSaving = false;
  @state() pmosModelError: string | null = null;
  @state() pmosModelConfigured = false;

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
  @state() pmosAuditEvents: PmosAuditEvent[] = [];

  // PMOS unified command center (Phase 6)
  @state() pmosCommandPrompt = "";
  @state() pmosCommandPlanning = false;
  @state() pmosCommandExecuting = false;
  @state() pmosCommandError: string | null = null;
  @state() pmosCommandPlan: PmosCommandPlanStep[] = [];
  @state() pmosCommandHistory: PmosCommandHistoryEntry[] = [];
  @state() pmosCommandPendingApprovals: PmosCommandPendingApproval[] = [];

  // PMOS Activepieces native embed (Phase 2)
  @state() apPiecesLoading = false;
  @state() apPiecesError: string | null = null;
  @state() apPiecesQuery = "";
  @state() apPieces: import("./controllers/pmos-activepieces.ts").ActivepiecesPieceSummary[] = [];
  @state() apPieceSelectedName: string | null = null;
  @state() apPieceDetailsLoading = false;
  @state() apPieceDetailsError: string | null = null;
  @state() apPieceDetails: unknown | null = null;

  @state() apConnectionsLoading = false;
  @state() apConnectionsError: string | null = null;
  @state() apConnections: import("./controllers/pmos-activepieces.ts").ActivepiecesConnectionSummary[] =
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
  @state() apFlows: import("./controllers/pmos-activepieces.ts").ActivepiecesFlowSummary[] = [];
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
  @state() apRuns: import("./controllers/pmos-activepieces.ts").ActivepiecesRunSummary[] = [];
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
          this.pmosOpsProvisioningResult = { projectId: ops.projectId ?? undefined, apiKey: String(ops.apiKey) };
          this.pmosOpsProvisioningError = null;
        } else {
          this.pmosOpsProvisioningResult = null;
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
    hydratePmosModelDraftFromConfig(this);
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
          this.pmosOpsProvisioningResult = { projectId: ops.projectId ?? undefined, apiKey: String(ops.apiKey) };
          this.pmosOpsProvisioningError = null;
        } else {
          this.pmosOpsProvisioningResult = null;
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
    hydratePmosModelDraftFromConfig(this);
    await loadPmosConnectorsStatus(this);
  }

  async handlePmosIntegrationsClearActivepiecesKey() {
    await savePmosConnectorsConfig(this, { clearActivepiecesKey: true });
    await loadConfig(this);
    this.pmosConnectorDraftsInitialized = false;
    hydratePmosConnectorDraftsFromConfig(this);
    hydratePmosModelDraftFromConfig(this);
    await loadPmosConnectorsStatus(this);
  }

  async handlePmosIntegrationsClearBcgptKey() {
    await savePmosConnectorsConfig(this, { clearBcgptKey: true });
    await loadConfig(this);
    this.pmosConnectorDraftsInitialized = false;
    hydratePmosConnectorDraftsFromConfig(this);
    hydratePmosModelDraftFromConfig(this);
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
      this.pmosOpsProvisioningError = String(err);
    } finally {
      this.pmosOpsProvisioning = false;
    }
  }

  handlePmosModelProviderChange(next: PmosModelProvider) {
    setPmosModelProvider(this, next);
  }

  async handlePmosModelSave() {
    await savePmosModelConfig(this);
    hydratePmosModelDraftFromConfig(this);
  }

  async handlePmosModelClearKey() {
    await clearPmosModelApiKey(this);
    hydratePmosModelDraftFromConfig(this);
  }

  async handlePmosApPiecesLoad() {
    await loadActivepiecesPieces(this as unknown as Parameters<typeof loadActivepiecesPieces>[0]);
  }

  async handlePmosApConnectionsLoad() {
    await loadActivepiecesConnections(
      this as unknown as Parameters<typeof loadActivepiecesConnections>[0],
    );
  }

  async handlePmosApConnectionCreate() {
    await createActivepiecesConnection(
      this as unknown as Parameters<typeof createActivepiecesConnection>[0],
    );
  }

  async handlePmosApConnectionDelete(connectionId: string) {
    await deleteActivepiecesConnection(
      this as unknown as Parameters<typeof deleteActivepiecesConnection>[0],
      connectionId,
    );
  }

  async handlePmosApFlowsLoad() {
    await loadActivepiecesFlows(this as unknown as Parameters<typeof loadActivepiecesFlows>[0]);
  }

  async handlePmosApFlowCreate() {
    await createActivepiecesFlow(this as unknown as Parameters<typeof createActivepiecesFlow>[0]);
  }

  async handlePmosApFlowSelect(flowId: string) {
    await loadActivepiecesFlowDetails(
      this as unknown as Parameters<typeof loadActivepiecesFlowDetails>[0],
      flowId,
    );
  }

  async handlePmosApFlowRename() {
    await renameActivepiecesFlow(this as unknown as Parameters<typeof renameActivepiecesFlow>[0]);
  }

  async handlePmosApFlowSetStatus(status: "ENABLED" | "DISABLED") {
    await setActivepiecesFlowStatus(
      this as unknown as Parameters<typeof setActivepiecesFlowStatus>[0],
      status,
    );
  }

  async handlePmosApFlowPublish() {
    await publishActivepiecesFlow(
      this as unknown as Parameters<typeof publishActivepiecesFlow>[0],
    );
  }

  async handlePmosApFlowDelete() {
    await deleteActivepiecesFlow(this as unknown as Parameters<typeof deleteActivepiecesFlow>[0]);
  }

  async handlePmosApFlowApplyOperation() {
    await applyActivepiecesFlowOperationDraft(
      this as unknown as Parameters<typeof applyActivepiecesFlowOperationDraft>[0],
    );
  }

  async handlePmosApFlowTriggerWebhook(opts?: { draft?: boolean; sync?: boolean }) {
    await triggerActivepiecesFlowWebhook(
      this as unknown as Parameters<typeof triggerActivepiecesFlowWebhook>[0],
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

  async handlePmosApRunsLoad() {
    await loadActivepiecesRuns(this as unknown as Parameters<typeof loadActivepiecesRuns>[0]);
  }

  async handlePmosApRunSelect(runId: string) {
    await loadActivepiecesRunDetails(
      this as unknown as Parameters<typeof loadActivepiecesRunDetails>[0],
      runId,
    );
  }

  async handlePmosApRunRetry(strategy: "FROM_FAILED_STEP" | "ON_LATEST_VERSION") {
    await retryActivepiecesRun(
      this as unknown as Parameters<typeof retryActivepiecesRun>[0],
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
    await handleSendChatInternal(
      this as unknown as Parameters<typeof handleSendChatInternal>[0],
      messageOverride,
      opts,
    );
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
