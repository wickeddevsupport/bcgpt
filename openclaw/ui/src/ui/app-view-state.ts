import type { EventLogEntry } from "./app-events.ts";
import type { CompactionStatus } from "./app-tool-stream.ts";
import type { DevicePairingList } from "./controllers/devices.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import type { SkillMessage } from "./controllers/skills.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import type { UiSettings } from "./storage.ts";
import type { ThemeTransitionContext } from "./theme-transition.ts";
import type { ThemeMode } from "./theme.ts";
import type {
  AgentsListResult,
  AgentsFilesListResult,
  AgentIdentityResult,
  ChannelsStatusSnapshot,
  ConfigSnapshot,
  ConfigUiHints,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  HealthSnapshot,
  LogEntry,
  LogLevel,
  NostrProfile,
  PresenceEntry,
  SessionsUsageResult,
  CostUsageSummary,
  SessionUsageTimeSeries,
  SessionsListResult,
  SkillStatusReport,
  StatusSummary,
} from "./types.ts";
import type { ChatAttachment, ChatQueueItem, CronFormState } from "./ui-types.ts";
import type { NostrProfileFormState } from "./views/channels.nostr-profile-form.ts";
import type { SessionLogEntry } from "./views/usage.ts";
import type { PmosAuthUser } from "./controllers/pmos-auth.ts";
import type { PmosConnectorsStatus } from "./controllers/pmos-connectors.ts";
import type { PmosModelProvider } from "./controllers/pmos-model-auth.ts";
import type {
  ActivepiecesConnectionSummary,
  ActivepiecesFlowSummary,
  ActivepiecesPieceSummary,
  ActivepiecesRunSummary,
} from "./controllers/pmos-activepieces.ts";
import type { PmosExecutionTraceEvent } from "./controllers/pmos-trace.ts";
import type {
  PmosAuditEvent,
  PmosMember,
  PmosMemberStatus,
  PmosRole,
} from "./controllers/pmos-admin.ts";
import type {
  PmosCommandHistoryEntry,
  PmosCommandPendingApproval,
  PmosCommandPlanStep,
} from "./controllers/pmos-command-center.ts";
import type {
  PmosFlowGraphEdge,
  PmosFlowGraphNode,
  PmosFlowGraphOp,
} from "./controllers/pmos-flow-builder.ts";

export type AppViewState = {
  settings: UiSettings;
  password: string;
  tab: Tab;
  onboarding: boolean;
  pmosAuthLoading: boolean;
  pmosAuthAuthenticated: boolean;
  pmosAuthMode: "signin" | "signup";
  pmosAuthName: string;
  pmosAuthEmail: string;
  pmosAuthPassword: string;
  pmosAuthError: string | null;
  pmosAuthUser: PmosAuthUser | null;
  basePath: string;
  connected: boolean;
  theme: ThemeMode;
  themeResolved: "light" | "dark";
  hello: GatewayHelloOk | null;
  lastError: string | null;
  eventLog: EventLogEntry[];
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  sessionKey: string;
  chatLoading: boolean;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatRunId: string | null;
  compactionStatus: CompactionStatus | null;
  chatAvatarUrl: string | null;
  chatThinkingLevel: string | null;
  chatQueue: ChatQueueItem[];
  chatManualRefreshInFlight: boolean;
  nodesLoading: boolean;
  nodes: Array<Record<string, unknown>>;
  chatNewMessagesBelow: boolean;
  sidebarOpen: boolean;
  sidebarContent: string | null;
  sidebarError: string | null;
  splitRatio: number;
  scrollToBottom: (opts?: { smooth?: boolean }) => void;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
  execApprovalsLoading: boolean;
  execApprovalsSaving: boolean;
  execApprovalsDirty: boolean;
  execApprovalsSnapshot: ExecApprovalsSnapshot | null;
  execApprovalsForm: ExecApprovalsFile | null;
  execApprovalsSelectedAgent: string | null;
  execApprovalsTarget: "gateway" | "node";
  execApprovalsTargetNodeId: string | null;
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalBusy: boolean;
  execApprovalError: string | null;
  pendingGatewayUrl: string | null;
  configLoading: boolean;
  configRaw: string;
  configRawOriginal: string;
  configValid: boolean | null;
  configIssues: unknown[];
  configSaving: boolean;
  configApplying: boolean;
  updateRunning: boolean;
  applySessionKey: string;
  configSnapshot: ConfigSnapshot | null;
  configSchema: unknown;
  configSchemaVersion: string | null;
  configSchemaLoading: boolean;
  configUiHints: ConfigUiHints;
  configForm: Record<string, unknown> | null;
  configFormOriginal: Record<string, unknown> | null;
  configFormMode: "form" | "raw";
  configSearchQuery: string;
  configActiveSection: string | null;
  configActiveSubsection: string | null;

  // PMOS connector onboarding (Phase 1)
  pmosConnectorDraftsInitialized: boolean;
  pmosActivepiecesUrl: string;
  pmosActivepiecesProjectId: string;
  pmosActivepiecesApiKeyDraft: string;
  pmosBcgptUrl: string;
  pmosBcgptApiKeyDraft: string;
  pmosIntegrationsSaving: boolean;
  pmosIntegrationsError: string | null;
  pmosConnectorsLoading: boolean;
  pmosConnectorsStatus: PmosConnectorsStatus | null;
  pmosConnectorsError: string | null;
  pmosConnectorsLastChecked: number | null;
  pmosTraceEvents: PmosExecutionTraceEvent[];

  // workspace-scoped Wicked Ops provisioning state
  pmosOpsProvisioning: boolean;
  pmosOpsProvisioningError: string | null;
  pmosOpsProvisioningResult: { projectId?: string; apiKey?: string } | null;
  pmosModelProvider: PmosModelProvider;
  pmosModelId: string;
  pmosModelAlias: string;
  pmosModelApiKeyDraft: string;
  pmosModelSaving: boolean;
  pmosModelError: string | null;
  pmosModelConfigured: boolean;

  // PMOS identity/admin (Phase 4)
  pmosAdminDraftsInitialized: boolean;
  pmosAdminLoading: boolean;
  pmosAdminSaving: boolean;
  pmosAdminError: string | null;
  pmosWorkspaceId: string;
  pmosWorkspaceName: string;
  pmosCurrentUserName: string;
  pmosCurrentUserEmail: string;
  pmosCurrentUserRole: PmosRole;
  pmosMembers: PmosMember[];
  pmosMemberDraftName: string;
  pmosMemberDraftEmail: string;
  pmosMemberDraftRole: PmosRole;
  pmosMemberDraftStatus: PmosMemberStatus;
  pmosAuditEvents: PmosAuditEvent[];

  // PMOS unified command center (Phase 6)
  pmosCommandPrompt: string;
  pmosCommandPlanning: boolean;
  pmosCommandExecuting: boolean;
  pmosCommandError: string | null;
  pmosCommandPlan: PmosCommandPlanStep[];
  pmosCommandHistory: PmosCommandHistoryEntry[];
  pmosCommandPendingApprovals: PmosCommandPendingApproval[];

  // PMOS Activepieces native embed (Phase 2)
  apPiecesLoading: boolean;
  apPiecesError: string | null;
  apPiecesQuery: string;
  apPieces: ActivepiecesPieceSummary[];
  apPieceSelectedName: string | null;
  apPieceDetailsLoading: boolean;
  apPieceDetailsError: string | null;
  apPieceDetails: unknown | null;

  apConnectionsLoading: boolean;
  apConnectionsError: string | null;
  apConnections: ActivepiecesConnectionSummary[];
  apConnectionsCursor: string | null;
  apConnectionsHasNext: boolean;
  apConnectionCreateSaving: boolean;
  apConnectionCreateError: string | null;
  apConnectionCreatePieceName: string;
  apConnectionCreateDisplayName: string;
  apConnectionCreateType: "secret_text" | "basic_auth" | "no_auth";
  apConnectionCreateSecretText: string;
  apConnectionCreateBasicUser: string;
  apConnectionCreateBasicPass: string;

  apFlowsLoading: boolean;
  apFlowsError: string | null;
  apFlowsQuery: string;
  apFlows: ActivepiecesFlowSummary[];
  apFlowsCursor: string | null;
  apFlowsHasNext: boolean;
  apFlowCreateName: string;
  apFlowCreateSaving: boolean;
  apFlowCreateError: string | null;
  apFlowSelectedId: string | null;
  apFlowDetailsLoading: boolean;
  apFlowDetailsError: string | null;
  apFlowDetails: unknown | null;
  apFlowRenameDraft: string;
  apFlowOperationDraft: string;
  apFlowTriggerPayloadDraft: string;
  apFlowMutating: boolean;
  apFlowMutateError: string | null;

  // PMOS AI flow builder stream (Phase 5)
  pmosFlowBuilderPrompt: string;
  pmosFlowBuilderGenerating: boolean;
  pmosFlowBuilderCommitting: boolean;
  pmosFlowBuilderError: string | null;
  pmosFlowBuilderFlowName: string;
  pmosFlowBuilderNodes: PmosFlowGraphNode[];
  pmosFlowBuilderEdges: PmosFlowGraphEdge[];
  pmosFlowBuilderOps: PmosFlowGraphOp[];
  pmosFlowBuilderOpIndex: number;
  pmosFlowBuilderLastCommittedFlowId: string | null;

  apRunsLoading: boolean;
  apRunsError: string | null;
  apRuns: ActivepiecesRunSummary[];
  apRunsCursor: string | null;
  apRunsHasNext: boolean;
  apRunSelectedId: string | null;
  apRunDetailsLoading: boolean;
  apRunDetailsError: string | null;
  apRunDetails: unknown | null;
  apRunRetrying: boolean;
  apRunRetryError: string | null;
  channelsLoading: boolean;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsError: string | null;
  channelsLastSuccess: number | null;
  whatsappLoginMessage: string | null;
  whatsappLoginQrDataUrl: string | null;
  whatsappLoginConnected: boolean | null;
  whatsappBusy: boolean;
  nostrProfileFormState: NostrProfileFormState | null;
  nostrProfileAccountId: string | null;
  configFormDirty: boolean;
  presenceLoading: boolean;
  presenceEntries: PresenceEntry[];
  presenceError: string | null;
  presenceStatus: string | null;
  agentsLoading: boolean;
  agentsList: AgentsListResult | null;
  agentsError: string | null;
  agentsSelectedId: string | null;
  agentsPanel: "overview" | "files" | "tools" | "skills" | "channels" | "cron";
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileActive: string | null;
  agentFileSaving: boolean;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkillsLoading: boolean;
  agentSkillsError: string | null;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsAgentId: string | null;
  sessionsLoading: boolean;
  sessionsResult: SessionsListResult | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
  usageLoading: boolean;
  usageResult: SessionsUsageResult | null;
  usageCostSummary: CostUsageSummary | null;
  usageError: string | null;
  usageStartDate: string;
  usageEndDate: string;
  usageSelectedSessions: string[];
  usageSelectedDays: string[];
  usageSelectedHours: number[];
  usageChartMode: "tokens" | "cost";
  usageDailyChartMode: "total" | "by-type";
  usageTimeSeriesMode: "cumulative" | "per-turn";
  usageTimeSeriesBreakdownMode: "total" | "by-type";
  usageTimeSeries: SessionUsageTimeSeries | null;
  usageTimeSeriesLoading: boolean;
  usageSessionLogs: SessionLogEntry[] | null;
  usageSessionLogsLoading: boolean;
  usageSessionLogsExpanded: boolean;
  usageQuery: string;
  usageQueryDraft: string;
  usageQueryDebounceTimer: number | null;
  usageSessionSort: "tokens" | "cost" | "recent" | "messages" | "errors";
  usageSessionSortDir: "asc" | "desc";
  usageRecentSessions: string[];
  usageTimeZone: "local" | "utc";
  usageContextExpanded: boolean;
  usageHeaderPinned: boolean;
  usageSessionsTab: "all" | "recent";
  usageVisibleColumns: string[];
  usageLogFilterRoles: import("./views/usage.js").SessionLogRole[];
  usageLogFilterTools: string[];
  usageLogFilterHasTools: boolean;
  usageLogFilterQuery: string;
  cronLoading: boolean;
  cronJobs: CronJob[];
  cronStatus: CronStatus | null;
  cronError: string | null;
  cronForm: CronFormState;
  cronRunsJobId: string | null;
  cronRuns: CronRunLogEntry[];
  cronBusy: boolean;
  skillsLoading: boolean;
  skillsReport: SkillStatusReport | null;
  skillsError: string | null;
  skillsFilter: string;
  skillEdits: Record<string, string>;
  skillMessages: Record<string, SkillMessage>;
  skillsBusyKey: string | null;
  debugLoading: boolean;
  debugStatus: StatusSummary | null;
  debugHealth: HealthSnapshot | null;
  debugModels: unknown[];
  debugHeartbeat: unknown;
  debugCallMethod: string;
  debugCallParams: string;
  debugCallResult: string | null;
  debugCallError: string | null;
  logsLoading: boolean;
  logsError: string | null;
  logsFile: string | null;
  logsEntries: LogEntry[];
  logsFilterText: string;
  logsLevelFilters: Record<LogLevel, boolean>;
  logsAutoFollow: boolean;
  logsTruncated: boolean;
  logsCursor: number | null;
  logsLastFetchAt: number | null;
  logsLimit: number;
  logsMaxBytes: number;
  logsAtBottom: boolean;
  client: GatewayBrowserClient | null;
  refreshSessionsAfterChat: Set<string>;
  connect: () => void;
  handlePmosAuthSubmit: () => Promise<void>;
  handlePmosAuthLogout: () => Promise<void>;
  setTab: (tab: Tab) => void;
  setTheme: (theme: ThemeMode, context?: ThemeTransitionContext) => void;
  applySettings: (next: UiSettings) => void;
  loadOverview: () => Promise<void>;
  loadAssistantIdentity: () => Promise<void>;
  loadCron: () => Promise<void>;
  handleWhatsAppStart: (force: boolean) => Promise<void>;
  handleWhatsAppWait: () => Promise<void>;
  handleWhatsAppLogout: () => Promise<void>;
  handleChannelConfigSave: () => Promise<void>;
  handleChannelConfigReload: () => Promise<void>;
  handleNostrProfileEdit: (accountId: string, profile: NostrProfile | null) => void;
  handleNostrProfileCancel: () => void;
  handleNostrProfileFieldChange: (field: keyof NostrProfile, value: string) => void;
  handleNostrProfileSave: () => Promise<void>;
  handleNostrProfileImport: () => Promise<void>;
  handleNostrProfileToggleAdvanced: () => void;
  handleExecApprovalDecision: (decision: "allow-once" | "allow-always" | "deny") => Promise<void>;
  handleGatewayUrlConfirm: () => void;
  handleGatewayUrlCancel: () => void;
  handleConfigLoad: () => Promise<void>;
  handleConfigSave: () => Promise<void>;
  handleConfigApply: () => Promise<void>;
  handleConfigFormUpdate: (path: string, value: unknown) => void;
  handleConfigFormModeChange: (mode: "form" | "raw") => void;
  handleConfigRawChange: (raw: string) => void;
  handleInstallSkill: (key: string) => Promise<void>;
  handleUpdateSkill: (key: string) => Promise<void>;
  handleToggleSkillEnabled: (key: string, enabled: boolean) => Promise<void>;
  handleUpdateSkillEdit: (key: string, value: string) => void;
  handleSaveSkillApiKey: (key: string, apiKey: string) => Promise<void>;
  handleCronToggle: (jobId: string, enabled: boolean) => Promise<void>;
  handleCronRun: (jobId: string) => Promise<void>;
  handleCronRemove: (jobId: string) => Promise<void>;
  handleCronAdd: () => Promise<void>;
  handleCronRunsLoad: (jobId: string) => Promise<void>;
  handleCronFormUpdate: (path: string, value: unknown) => void;
  handleSessionsLoad: () => Promise<void>;
  handleSessionsPatch: (key: string, patch: unknown) => Promise<void>;
  handleLoadNodes: () => Promise<void>;
  handleLoadPresence: () => Promise<void>;
  handleLoadSkills: () => Promise<void>;
  handleLoadDebug: () => Promise<void>;
  handleLoadLogs: () => Promise<void>;
  handleDebugCall: () => Promise<void>;
  handleRunUpdate: () => Promise<void>;
  setPassword: (next: string) => void;
  setSessionKey: (next: string) => void;
  setChatMessage: (next: string) => void;
  handleSendChat: (messageOverride?: string, opts?: { restoreDraft?: boolean }) => Promise<void>;
  handleAbortChat: () => Promise<void>;
  handlePmosRefreshConnectors: () => Promise<void>;
  handlePmosTraceClear: () => void;
  handlePmosAdminLoad: () => Promise<void>;
  handlePmosAdminSave: (opts?: { action?: string; target?: string; detail?: string }) => Promise<void>;
  handlePmosMemberUpsert: () => Promise<void>;
  handlePmosMemberRemove: (email: string) => Promise<void>;
  handlePmosIntegrationsLoad: () => Promise<void>;
  handlePmosIntegrationsSave: () => Promise<void>;
  handlePmosIntegrationsClearActivepiecesKey: () => Promise<void>;
  handlePmosIntegrationsClearBcgptKey: () => Promise<void>;
  handlePmosModelProviderChange: (next: PmosModelProvider) => void;
  handlePmosModelSave: () => Promise<void>;
  handlePmosModelClearKey: () => Promise<void>;
  handlePmosApPiecesLoad: () => Promise<void>;
  handlePmosApConnectionsLoad: () => Promise<void>;
  handlePmosApConnectionCreate: () => Promise<void>;
  handlePmosApConnectionDelete: (connectionId: string) => Promise<void>;
  handlePmosApFlowsLoad: () => Promise<void>;
  handlePmosApFlowCreate: () => Promise<void>;
  handlePmosApFlowSelect: (flowId: string) => Promise<void>;
  handlePmosApFlowRename: () => Promise<void>;
  handlePmosApFlowSetStatus: (status: "ENABLED" | "DISABLED") => Promise<void>;
  handlePmosApFlowPublish: () => Promise<void>;
  handlePmosApFlowDelete: () => Promise<void>;
  handlePmosApFlowApplyOperation: () => Promise<void>;
  handlePmosApFlowTriggerWebhook: (opts?: { draft?: boolean; sync?: boolean }) => Promise<void>;
  handlePmosFlowBuilderGenerate: () => Promise<void>;
  handlePmosFlowBuilderCommit: () => Promise<void>;
  handlePmosFlowBuilderReset: () => void;
  handlePmosApRunsLoad: () => Promise<void>;
  handlePmosApRunSelect: (runId: string) => Promise<void>;
  handlePmosApRunRetry: (strategy: "FROM_FAILED_STEP" | "ON_LATEST_VERSION") => Promise<void>;
  handlePmosCommandPlan: () => Promise<void>;
  handlePmosCommandExecute: () => Promise<void>;
  handlePmosCommandApprove: (approvalId: string) => Promise<void>;
  handlePmosCommandClearHistory: () => void;
  removeQueuedMessage: (id: string) => void;
  handleChatScroll: (event: Event) => void;
  resetToolStream: () => void;
  resetChatScroll: () => void;
  exportLogs: (lines: string[], label: string) => void;
  handleLogsScroll: (event: Event) => void;
  handleOpenSidebar: (content: string) => void;
  handleCloseSidebar: () => void;
  handleSplitRatioChange: (ratio: number) => void;
};
