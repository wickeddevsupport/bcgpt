import type { EventLogEntry } from "./app-events.ts";
import type { OpenClawApp } from "./app.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.js";
import type { GatewayEventFrame, GatewayHelloOk } from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import type { UiSettings } from "./storage.ts";
import type { AgentsListResult, PresenceEntry, HealthSnapshot, StatusSummary } from "./types.ts";
import { CHAT_SESSIONS_ACTIVE_MINUTES, flushChatQueueForEvent } from "./app-chat.ts";
import {
  applySettings,
  loadCron,
  refreshActiveTab,
  setLastActiveSessionKey,
} from "./app-settings.ts";
import { handleAgentEvent, resetToolStream, type AgentEventPayload } from "./app-tool-stream.ts";
import { loadAgents } from "./controllers/agents.ts";
import { loadAssistantIdentity } from "./controllers/assistant-identity.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import { handleChatEvent, type ChatEventPayload } from "./controllers/chat.ts";
import { loadDevices } from "./controllers/devices.ts";
import {
  addExecApproval,
  parseExecApprovalRequested,
  parseExecApprovalResolved,
  removeExecApproval,
} from "./controllers/exec-approval.ts";
import { loadNodes } from "./controllers/nodes.ts";
import {
  appendPmosTraceEvent,
  summarizeTraceValue,
  type PmosExecutionTraceEvent,
} from "./controllers/pmos-trace.ts";
import { loadSessions } from "./controllers/sessions.ts";
import { GatewayBrowserClient } from "./gateway.ts";

// Per-host rAF coalescing state for chat delta events.
// Batches rapid-fire deltas so at most one Lit re-render fires per animation frame.
const pendingChatDelta = new WeakMap<object, ChatEventPayload>();
const chatDeltaRafId = new WeakMap<object, number>();
const relatedSessionRefreshSeen = new WeakMap<object, Set<string>>();

type GatewayHost = {
  settings: UiSettings;
  password: string;
  client: GatewayBrowserClient | null;
  connected: boolean;
  hello: GatewayHelloOk | null;
  lastError: string | null;
  onboarding?: boolean;
  eventLogBuffer: EventLogEntry[];
  eventLog: EventLogEntry[];
  tab: Tab;
  presenceEntries: PresenceEntry[];
  presenceError: string | null;
  presenceStatus: StatusSummary | null;
  agentsLoading: boolean;
  agentsList: AgentsListResult | null;
  agentsError: string | null;
  debugHealth: HealthSnapshot | null;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  sessionKey: string;
  chatRunId: string | null;
  refreshSessionsAfterChat: Set<string>;
  pmosTraceEvents: PmosExecutionTraceEvent[];
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalError: string | null;
};

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
  mainKey?: string;
  mainSessionKey?: string;
  scope?: string;
};

function normalizeSessionKeyForDefaults(
  value: string | undefined,
  defaults: SessionDefaultsSnapshot,
): string {
  const raw = (value ?? "").trim();
  const mainSessionKey = defaults.mainSessionKey?.trim();
  if (!mainSessionKey) {
    return raw;
  }
  if (!raw) {
    return mainSessionKey;
  }
  const mainKey = defaults.mainKey?.trim() || "main";
  const defaultAgentId = defaults.defaultAgentId?.trim();
  const isAlias =
    raw === "main" ||
    raw === mainKey ||
    (defaultAgentId &&
      (raw === `agent:${defaultAgentId}:main` || raw === `agent:${defaultAgentId}:${mainKey}`));
  return isAlias ? mainSessionKey : raw;
}

function applySessionDefaults(host: GatewayHost, defaults?: SessionDefaultsSnapshot) {
  if (!defaults?.mainSessionKey) {
    return;
  }
  const resolvedSessionKey = normalizeSessionKeyForDefaults(host.sessionKey, defaults);
  const resolvedSettingsSessionKey = normalizeSessionKeyForDefaults(
    host.settings.sessionKey,
    defaults,
  );
  const resolvedLastActiveSessionKey = normalizeSessionKeyForDefaults(
    host.settings.lastActiveSessionKey,
    defaults,
  );
  const nextSessionKey = resolvedSessionKey || resolvedSettingsSessionKey || host.sessionKey;
  const nextSettings = {
    ...host.settings,
    sessionKey: resolvedSettingsSessionKey || nextSessionKey,
    lastActiveSessionKey: resolvedLastActiveSessionKey || nextSessionKey,
  };
  const shouldUpdateSettings =
    nextSettings.sessionKey !== host.settings.sessionKey ||
    nextSettings.lastActiveSessionKey !== host.settings.lastActiveSessionKey;
  if (nextSessionKey !== host.sessionKey) {
    host.sessionKey = nextSessionKey;
  }
  if (shouldUpdateSettings) {
    applySettings(host as unknown as Parameters<typeof applySettings>[0], nextSettings);
  }
}

function isRelatedAgentSessionKey(activeSessionKey: string, candidateSessionKey: string): boolean {
  if (candidateSessionKey === activeSessionKey) {
    return true;
  }
  const active = parseAgentSessionKey(activeSessionKey);
  const candidate = parseAgentSessionKey(candidateSessionKey);
  if (!active || !candidate || active.agentId !== candidate.agentId) {
    return false;
  }
  const activeRest = active.rest.trim().toLowerCase();
  const candidateRest = candidate.rest.trim().toLowerCase();
  if (!activeRest || !candidateRest) {
    return false;
  }
  if (activeRest === candidateRest) {
    return true;
  }
  if (activeRest === "main" && candidateRest.startsWith("subagent:")) {
    return true;
  }
  if (candidateRest === "main" && activeRest.startsWith("subagent:")) {
    return true;
  }
  return false;
}

function refreshSessionsForRelatedAgentSession(host: GatewayHost, payload?: AgentEventPayload) {
  const relatedSessionKey =
    typeof payload?.sessionKey === "string" ? payload.sessionKey.trim() : "";
  if (!relatedSessionKey || !host.chatRunId || payload?.runId !== host.chatRunId) {
    return;
  }
  if (
    relatedSessionKey === host.sessionKey ||
    !isRelatedAgentSessionKey(host.sessionKey, relatedSessionKey)
  ) {
    return;
  }
  const cacheKey = `${payload.runId}:${relatedSessionKey}`;
  const seen = relatedSessionRefreshSeen.get(host) ?? new Set<string>();
  if (seen.has(cacheKey)) {
    return;
  }
  seen.add(cacheKey);
  relatedSessionRefreshSeen.set(host, seen);
  void loadSessions(host as unknown as OpenClawApp, {
    activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
  });
}

function recordAgentTraceEvent(host: GatewayHost, payload?: AgentEventPayload) {
  if (!payload) {
    return;
  }
  if (
    payload.sessionKey &&
    !isRelatedAgentSessionKey(host.sessionKey, payload.sessionKey)
  ) {
    return;
  }
  if (payload.stream === "compaction") {
    const phase = typeof payload.data?.phase === "string" ? payload.data.phase : "";
    appendPmosTraceEvent(host, {
      id: `compaction:${payload.runId}`,
      ts: payload.ts,
      source: "system",
      kind: "compaction",
      status: phase === "start" ? "running" : "info",
      title: phase === "start" ? "Context compaction started" : "Context compaction completed",
      runId: payload.runId,
      sessionKey: payload.sessionKey,
    });
    return;
  }
  if (payload.stream !== "tool") {
    return;
  }
  const data = payload.data ?? {};
  const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
  const name = typeof data.name === "string" ? data.name : "tool";
  const phase = typeof data.phase === "string" ? data.phase : "";
  const id = toolCallId
    ? `tool:${payload.runId}:${toolCallId}`
    : `tool:${payload.runId}:${payload.seq}`;
  const detail =
    phase === "start"
      ? summarizeTraceValue(data.args)
      : phase === "update"
        ? summarizeTraceValue(data.partialResult)
        : phase === "result"
          ? summarizeTraceValue(data.result)
          : null;

  appendPmosTraceEvent(host, {
    id,
    ts: payload.ts,
    source: "tool",
    kind: "tool.call",
    status: phase === "result" ? "success" : "running",
    title: `Tool: ${name}`,
    detail: detail ?? undefined,
    runId: payload.runId,
    sessionKey: payload.sessionKey,
  });
}

function recordChatTraceEvent(host: GatewayHost, payload?: ChatEventPayload) {
  if (!payload) {
    return;
  }
  if (payload.sessionKey && payload.sessionKey !== host.sessionKey) {
    return;
  }
  const id = `chat:${payload.runId}`;
  const status =
    payload.state === "final"
      ? "success"
      : payload.state === "error"
        ? "error"
        : payload.state === "aborted"
          ? "info"
          : "running";
  const detail =
    payload.state === "error"
      ? payload.errorMessage ?? "Chat run failed."
      : payload.state === "aborted"
        ? "Run aborted."
        : payload.state === "final"
          ? "Response complete."
          : "Generating response...";

  appendPmosTraceEvent(host, {
    id,
    source: "chat",
    kind: "chat.run",
    status,
    title: "Assistant run",
    detail,
    runId: payload.runId,
    sessionKey: payload.sessionKey,
  });
}

export function connectGateway(host: GatewayHost) {
  host.lastError = null;
  host.hello = null;
  host.connected = false;
  host.execApprovalQueue = [];
  host.execApprovalError = null;

  host.client?.stop();
  const client = new GatewayBrowserClient({
    url: host.settings.gatewayUrl,
    token: host.settings.token.trim() ? host.settings.token : undefined,
    password: host.password.trim() ? host.password : undefined,
    clientName: "openclaw-control-ui",
    mode: "webchat",
    onHello: async (hello) => {
      if (host.client !== client) {
        return;
      }
      host.connected = true;
      host.lastError = null;
      host.hello = hello;
      applySnapshot(host, hello);
      // Reset orphaned chat run state from before disconnect.
      // Any in-flight run's final event was lost during the disconnect window.
      host.chatRunId = null;
      (host as unknown as { chatStream: string | null }).chatStream = null;
      (host as unknown as { chatStreamStartedAt: number | null }).chatStreamStartedAt = null;
      // Clear gateway restart flag now that we've reconnected successfully.
      (host as unknown as { pmosGatewayRestarting: boolean }).pmosGatewayRestarting = false;
      (host as unknown as { pmosGatewayRestartError: string | null }).pmosGatewayRestartError = null;
      resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
      const app = host as unknown as OpenClawApp;
      const loadAgentsPromise = loadAgents(app);
      const pmosRole = (app as unknown as { pmosAuthUser?: { role?: string | null } | null })
        .pmosAuthUser?.role;
      const shouldReconcileWorkspaceSessions = Boolean(pmosRole && pmosRole !== "super_admin");
      void loadNodes(app, { quiet: true });
      void loadDevices(app, { quiet: true });
      // Workspace users can have stale persisted session keys (deleted agent sessions).
      // Reconcile sessions before the first assistant/chat refresh to avoid noisy startup errors.
      if (shouldReconcileWorkspaceSessions || host.tab === "chat") {
        await loadAgentsPromise.catch(() => undefined);
        await loadSessions(app).catch(() => undefined);
        void loadAssistantIdentity(app, { sessionKey: host.sessionKey });
      } else {
        void loadAssistantIdentity(app);
      }
      void refreshActiveTab(host as unknown as Parameters<typeof refreshActiveTab>[0]);
      // Auto-refresh connector status on connect so opsProvisioned is populated
      // immediately (no manual "Provision" click required).
      void app.handlePmosRefreshConnectors();
      // Auto-connect bcgpt: warm the Basecamp session on every gateway connect.
      // Runs silently in background — result just logged, not shown in UI.
      void (async () => {
        try {
          const result = await app.client!.request<{
            connected: boolean; configured: boolean; name?: string | null;
            email?: string | null; shared?: boolean; authLink?: string | null;
          }>("pmos.bcgpt.autoconnect", {});
          if (result?.configured) {
            console.info(
              `[bcgpt] auto-connect: connected=${result.connected}, user=${result.name ?? result.email ?? "\u2014"}` +
              (result.shared ? " (shared key)" : "") +
              (!result.connected && result.authLink ? ` → auth: ${result.authLink}` : "")
            );
          }
        } catch (err) {
          console.warn("[bcgpt] auto-connect ping failed:", err);
        }
      })();
    },
    onClose: ({ code, reason }) => {
      if (host.client !== client) {
        return;
      }
      host.connected = false;
      // Code 1012 = Service Restart (expected during config saves, don't show as error)
      if (code !== 1012) {
        host.lastError = `disconnected (${code}): ${reason || "no reason"}`;
      }
    },
    onEvent: (evt) => {
      if (host.client !== client) {
        return;
      }
      handleGatewayEvent(host, evt);
    },
    onGap: ({ expected, received }) => {
      if (host.client !== client) {
        return;
      }
      host.lastError = `event gap detected (expected seq ${expected}, got ${received}); refresh recommended`;
    },
  });
  host.client = client;
  host.client.start();
}

export function handleGatewayEvent(host: GatewayHost, evt: GatewayEventFrame) {
  try {
    handleGatewayEventUnsafe(host, evt);
  } catch (err) {
    console.error("[gateway] handleGatewayEvent error:", evt.event, err);
  }
}

function handleGatewayEventUnsafe(host: GatewayHost, evt: GatewayEventFrame) {
  host.eventLogBuffer = [
    { ts: Date.now(), event: evt.event, payload: evt.payload },
    ...host.eventLogBuffer,
  ].slice(0, 250);
  if (host.tab === "debug") {
    host.eventLog = host.eventLogBuffer;
  }

  if (evt.event === "agent") {
    const payload = evt.payload as AgentEventPayload | undefined;
    if (host.onboarding) {
      return;
    }
    recordAgentTraceEvent(host, payload);
    handleAgentEvent(host as unknown as Parameters<typeof handleAgentEvent>[0], payload);
    refreshSessionsForRelatedAgentSession(host, payload);
    return;
  }

  if (evt.event === "chat") {
    const payload = evt.payload as ChatEventPayload | undefined;
    recordChatTraceEvent(host, payload);
    if (payload?.sessionKey) {
      setLastActiveSessionKey(
        host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
        payload.sessionKey,
      );
    }

    // For streaming deltas, coalesce via rAF: only one Lit re-render per animation frame.
    if (payload?.state === "delta") {
      pendingChatDelta.set(host, payload);
      if (!chatDeltaRafId.has(host)) {
        chatDeltaRafId.set(
          host,
          requestAnimationFrame(() => {
            chatDeltaRafId.delete(host);
            const pending = pendingChatDelta.get(host);
            if (pending) {
              pendingChatDelta.delete(host);
              handleChatEvent(host as unknown as OpenClawApp, pending);
            }
          }),
        );
      }
      return;
    }

    // For final/error/aborted: cancel any pending delta rAF and apply immediately.
    const pendingRaf = chatDeltaRafId.get(host);
    if (pendingRaf !== undefined) {
      cancelAnimationFrame(pendingRaf);
      chatDeltaRafId.delete(host);
      const pending = pendingChatDelta.get(host);
      if (pending) {
        pendingChatDelta.delete(host);
        handleChatEvent(host as unknown as OpenClawApp, pending);
      }
    }

    const state = handleChatEvent(host as unknown as OpenClawApp, payload);
    const foreignFinalWhileBusy =
      state === "final" &&
      typeof payload?.runId === "string" &&
      Boolean(host.chatRunId) &&
      payload.runId !== host.chatRunId;
    if ((state === "final" || state === "error" || state === "aborted") && !foreignFinalWhileBusy) {
      resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
      relatedSessionRefreshSeen.delete(host);
      void flushChatQueueForEvent(host as unknown as Parameters<typeof flushChatQueueForEvent>[0]);
      const runId = payload?.runId;
      if (runId && host.refreshSessionsAfterChat.has(runId)) {
        host.refreshSessionsAfterChat.delete(runId);
        if (state === "final") {
          void loadSessions(host as unknown as OpenClawApp, {
            activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
          });
        }
      }
    }
    if (state === "final") {
      void loadChatHistory(host as unknown as OpenClawApp);
    }
    return;
  }

  if (evt.event === "presence") {
    const payload = evt.payload as { presence?: PresenceEntry[] } | undefined;
    if (payload?.presence && Array.isArray(payload.presence)) {
      host.presenceEntries = payload.presence;
      host.presenceError = null;
      host.presenceStatus = null;
    }
    return;
  }

  if (evt.event === "cron" && host.tab === "cron") {
    void loadCron(host as unknown as Parameters<typeof loadCron>[0]);
  }

  if (evt.event === "device.pair.requested" || evt.event === "device.pair.resolved") {
    void loadDevices(host as unknown as OpenClawApp, { quiet: true });
  }

  if (evt.event === "exec.approval.requested") {
    const entry = parseExecApprovalRequested(evt.payload);
    if (entry) {
      host.execApprovalQueue = addExecApproval(host.execApprovalQueue, entry);
      host.execApprovalError = null;
      const delay = Math.max(0, entry.expiresAtMs - Date.now() + 500);
      window.setTimeout(() => {
        host.execApprovalQueue = removeExecApproval(host.execApprovalQueue, entry.id);
      }, delay);
    }
    return;
  }

  if (evt.event === "exec.approval.resolved") {
    const resolved = parseExecApprovalResolved(evt.payload);
    if (resolved) {
      host.execApprovalQueue = removeExecApproval(host.execApprovalQueue, resolved.id);
    }
  }

  if (evt.event === "pmos.workflow.assist.progress") {
    const payload = evt.payload as { step?: string; type?: string; text?: string; workflowId?: string; nodeName?: string; nodeType?: string } | undefined;
    if (!payload) return;

    // Typed payload: token stream (AI response text)
    if (payload.type === "token" && typeof payload.text === "string") {
      const app = host as unknown as { workflowChatStream: string | null };
      app.workflowChatStream = (app.workflowChatStream && !app.workflowChatStream.startsWith("🔧") && !app.workflowChatStream.startsWith("🧠")
        ? app.workflowChatStream
        : "") + payload.text;
      return;
    }

    // Typed payload: live node being added to canvas during workflow creation
    if (payload.type === "node_added" && typeof (payload as Record<string, unknown>).nodeName === "string") {
      const p = payload as Record<string, unknown>;
      const app = host as unknown as { workflowChatSteps: string[]; workflowChatStream: string | null };
      const nodeLabel = `➕ Adding node: ${p.nodeName} (${p.nodeType ?? "node"})`;
      app.workflowChatSteps = [...(app.workflowChatSteps ?? []), nodeLabel];
      app.workflowChatStream = "🔧 " + nodeLabel;
      return;
    }

    // Typed payload: workflow created/updated — navigate iframe immediately
    if (payload.type === "workflow_ready" && typeof payload.workflowId === "string") {
      const app = host as unknown as { apFlowSelectedId: string | null; workflowEmbedVersion: number };
      app.apFlowSelectedId = payload.workflowId;
      app.workflowEmbedVersion = (app.workflowEmbedVersion ?? 0) + 1;
      return;
    }

    // Step progress (tool activity, loading indicators)
    const step = typeof payload.step === "string" ? payload.step
      : (payload.type === "step" && typeof payload.text === "string" ? payload.text : null);
    if (step) {
      const app = host as unknown as { workflowChatStream: string | null; workflowChatSteps: string[] };
      app.workflowChatSteps = [...(app.workflowChatSteps ?? []), step];
      // Show current step as activity indicator (replaced when tokens arrive)
      app.workflowChatStream = "🔧 " + step;
    }
  }
}

export function applySnapshot(host: GatewayHost, hello: GatewayHelloOk) {
  const snapshot = hello.snapshot as
    | {
        presence?: PresenceEntry[];
        health?: HealthSnapshot;
        sessionDefaults?: SessionDefaultsSnapshot;
      }
    | undefined;
  if (snapshot?.presence && Array.isArray(snapshot.presence)) {
    host.presenceEntries = snapshot.presence;
  }
  if (snapshot?.health) {
    host.debugHealth = snapshot.health;
  }
  if (snapshot?.sessionDefaults) {
    applySessionDefaults(host, snapshot.sessionDefaults);
  }
}
