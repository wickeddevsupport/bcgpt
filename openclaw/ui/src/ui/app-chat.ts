import type { OpenClawApp } from "./app.ts";
import type { GatewayHelloOk } from "./gateway.ts";
import type { SessionsListResult } from "./types.ts";
import type { ChatAttachment, ChatQueueItem } from "./ui-types.ts";
import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.js";
import { rememberCompletedSessionRun } from "./session-active-run.ts";
import { resolveBlockingRecoveredSessionRun } from "./session-active-run.ts";
import { resetChatScroll, scheduleChatScroll } from "./app-scroll.ts";
import { setLastActiveSessionKey } from "./app-settings.ts";
import { resetToolStream } from "./app-tool-stream.ts";
import {
  abortChatRun,
  finalizeChatRunFromWait,
  loadChatHistory,
  sendChatMessage,
} from "./controllers/chat.ts";
import { loadSessions } from "./controllers/sessions.ts";
import { normalizeBasePath } from "./navigation.ts";
import { generateUUID } from "./uuid.ts";

export type ChatHost = {
  connected: boolean;
  client?: {
    request: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
  } | null;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatQueue: ChatQueueItem[];
  chatRunId: string | null;
  chatSending: boolean;
  chatMessages: unknown[];
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatHistoryRecoveryTimer?: number | null;
  sessionKey: string;
  sessionsResult?: SessionsListResult | null;
  compactionStatus?: { active?: boolean } | null;
  basePath: string;
  hello: GatewayHelloOk | null;
  chatAvatarUrl: string | null;
  refreshSessionsAfterChat: Set<string>;
};

export const CHAT_SESSIONS_ACTIVE_MINUTES = 120;

function resolveRecoveredActiveRunId(host: ChatHost): string | null {
  const currentSession = host.sessionsResult?.sessions?.find((row) => row.key === host.sessionKey);
  const remoteActiveRunId =
    typeof currentSession?.activeRunId === "string" ? currentSession.activeRunId.trim() : "";
  return remoteActiveRunId || null;
}

function hasRemoteActiveRun(host: ChatHost): boolean {
  return resolveBlockingRecoveredSessionRun({
    sessionKey: host.sessionKey,
    sessions: host.sessionsResult?.sessions,
    localRunId: host.chatRunId,
    localStream: host.chatStream,
    localSending: host.chatSending,
    compactionActive: host.compactionStatus?.active === true,
  });
}

export function isChatBusy(host: ChatHost) {
  return host.chatSending || Boolean(host.chatRunId) || hasRemoteActiveRun(host);
}

export function isChatStopCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/stop") {
    return true;
  }
  return (
    normalized === "stop" ||
    normalized === "esc" ||
    normalized === "abort" ||
    normalized === "wait" ||
    normalized === "exit"
  );
}

function isChatResetCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/new" || normalized === "/reset") {
    return true;
  }
  return normalized.startsWith("/new ") || normalized.startsWith("/reset ");
}

export async function handleAbortChat(host: ChatHost) {
  if (!host.connected) {
    return;
  }
  const activeRunId = host.chatRunId || resolveRecoveredActiveRunId(host);
  host.chatMessage = "";
  const aborted = await abortChatRun(host as unknown as OpenClawApp);
  if (!aborted) {
    return;
  }
  clearChatRecoveryPoll(host);
  const currentKey = host.sessionKey.trim();
  if (currentKey && host.sessionsResult?.sessions?.length) {
    if (activeRunId) {
      rememberCompletedSessionRun(currentKey, activeRunId);
    }
    host.sessionsResult = {
      ...host.sessionsResult,
      sessions: host.sessionsResult.sessions.map((session) => {
        if ((typeof session.key === "string" ? session.key.trim() : "") !== currentKey) {
          return session;
        }
        return {
          ...session,
          hasActiveRun: false,
          activeRunId: undefined,
        };
      }),
    };
  }
}

function enqueueChatMessage(
  host: ChatHost,
  text: string,
  attachments?: ChatAttachment[],
  refreshSessions?: boolean,
) {
  const trimmed = text.trim();
  const hasAttachments = Boolean(attachments && attachments.length > 0);
  if (!trimmed && !hasAttachments) {
    return;
  }
  host.chatQueue = [
    ...host.chatQueue,
    {
      id: generateUUID(),
      text: trimmed,
      createdAt: Date.now(),
      attachments: hasAttachments ? attachments?.map((att) => ({ ...att })) : undefined,
      refreshSessions,
    },
  ];
}

function clearChatRecoveryPoll(host: ChatHost) {
  if (host.chatHistoryRecoveryTimer != null) {
    window.clearTimeout(host.chatHistoryRecoveryTimer);
    host.chatHistoryRecoveryTimer = null;
  }
}

const CHAT_RECOVERY_POLL_INTERVAL_MS = 1500;
const CHAT_RECOVERY_MAX_WAIT_MS = 25000;
const CHAT_RECOVERY_STEADY_POLL_INTERVAL_MS = 5000;

async function reconcileLiveChatHistory(host: ChatHost, runId: string) {
  if (host.chatRunId !== runId) {
    return;
  }
  const hasLiveStream = typeof host.chatStream === "string" && host.chatStream.trim().length > 0;
  if (hasLiveStream) {
    return;
  }
  await loadChatHistory(host as unknown as OpenClawApp).catch(() => undefined);
}

type AgentWaitResult = {
  runId: string;
  status: "ok" | "error" | "timeout";
  error?: string;
};

async function waitForChatRunLifecycle(
  host: ChatHost,
  runId: string,
  timeoutMs: number,
): Promise<AgentWaitResult | null> {
  if (!host.client || !host.connected) {
    return null;
  }
  try {
    return await host.client.request<AgentWaitResult>("agent.wait", {
      runId,
      timeoutMs,
    });
  } catch {
    return null;
  }
}

function startChatRecoveryPoll(host: ChatHost, runId: string) {
  clearChatRecoveryPoll(host);
  const startedAt = Date.now();
  const tick = async () => {
    if (host.chatRunId !== runId) {
      clearChatRecoveryPoll(host);
      return;
    }
    await reconcileLiveChatHistory(host, runId);
    const timeoutMs =
      Date.now() - startedAt > CHAT_RECOVERY_MAX_WAIT_MS
        ? CHAT_RECOVERY_STEADY_POLL_INTERVAL_MS
        : CHAT_RECOVERY_POLL_INTERVAL_MS;
    const waitResult = await waitForChatRunLifecycle(host, runId, timeoutMs);
    if (host.chatRunId !== runId) {
      clearChatRecoveryPoll(host);
      const scrollHost = host as unknown as Parameters<typeof scheduleChatScroll>[0];
      scheduleChatScroll(scrollHost, true);
      void flushChatQueue(host);
      return;
    }
    if (!waitResult || waitResult.status === "timeout") {
      const retryDelay = waitResult ? 0 : timeoutMs;
      host.chatHistoryRecoveryTimer = window.setTimeout(tick, retryDelay);
      return;
    }

    await loadSessions(host as unknown as Parameters<typeof loadSessions>[0], {
      activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
    }).catch(() => undefined);
    await loadChatHistory(host as unknown as OpenClawApp).catch(() => undefined);

    if (host.chatRunId === runId) {
      finalizeChatRunFromWait(host as unknown as OpenClawApp, waitResult);
    }

    clearChatRecoveryPoll(host);
    const scrollHost = host as unknown as Parameters<typeof scheduleChatScroll>[0];
    scheduleChatScroll(scrollHost, true);
    void flushChatQueue(host);
  };
  host.chatHistoryRecoveryTimer = window.setTimeout(tick, CHAT_RECOVERY_POLL_INTERVAL_MS);
}

async function sendChatMessageNow(
  host: ChatHost,
  message: string,
  opts?: {
    previousDraft?: string;
    restoreDraft?: boolean;
    attachments?: ChatAttachment[];
    previousAttachments?: ChatAttachment[];
    restoreAttachments?: boolean;
    refreshSessions?: boolean;
  },
) {
  resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
  const runId = await sendChatMessage(host as unknown as OpenClawApp, message, opts?.attachments);
  const ok = Boolean(runId);
  if (!ok && opts?.previousDraft != null) {
    host.chatMessage = opts.previousDraft;
  }
  if (!ok && opts?.previousAttachments) {
    host.chatAttachments = opts.previousAttachments;
  }
  if (ok) {
    setLastActiveSessionKey(
      host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
      host.sessionKey,
    );
    if (runId) {
      startChatRecoveryPoll(host, runId);
    }
  }
  if (ok && opts?.restoreDraft && opts.previousDraft?.trim()) {
    host.chatMessage = opts.previousDraft;
  }
  if (ok && opts?.restoreAttachments && opts.previousAttachments?.length) {
    host.chatAttachments = opts.previousAttachments;
  }
  // User just sent a message — always scroll to bottom regardless of previous position.
  const scrollHost = host as unknown as Parameters<typeof scheduleChatScroll>[0];
  resetChatScroll(scrollHost);
  scheduleChatScroll(scrollHost, true);
  if (ok && !host.chatRunId) {
    void flushChatQueue(host);
  }
  if (ok && opts?.refreshSessions && runId) {
    host.refreshSessionsAfterChat.add(runId);
  }
  return ok;
}

async function flushChatQueue(host: ChatHost) {
  if (!host.connected || isChatBusy(host)) {
    return;
  }
  const [next, ...rest] = host.chatQueue;
  if (!next) {
    return;
  }
  host.chatQueue = rest;
  const ok = await sendChatMessageNow(host, next.text, {
    attachments: next.attachments,
    refreshSessions: next.refreshSessions,
  });
  if (!ok) {
    host.chatQueue = [next, ...host.chatQueue];
  }
}

export function removeQueuedMessage(host: ChatHost, id: string) {
  host.chatQueue = host.chatQueue.filter((item) => item.id !== id);
}

export async function handleSendChat(
  host: ChatHost,
  messageOverride?: string,
  opts?: { restoreDraft?: boolean },
) {
  if (!host.connected) {
    return;
  }
  const previousDraft = host.chatMessage;
  const message = (messageOverride ?? host.chatMessage).trim();
  const attachments = host.chatAttachments ?? [];
  const attachmentsToSend = messageOverride == null ? attachments : [];
  const hasAttachments = attachmentsToSend.length > 0;

  // Allow sending with just attachments (no message text required)
  if (!message && !hasAttachments) {
    return;
  }

  if (isChatStopCommand(message)) {
    await handleAbortChat(host);
    return;
  }

  const refreshSessions = isChatResetCommand(message);
  if (messageOverride == null) {
    host.chatMessage = "";
    // Clear attachments when sending
    host.chatAttachments = [];
  }

  if (isChatBusy(host)) {
    enqueueChatMessage(host, message, attachmentsToSend, refreshSessions);
    return;
  }

  await sendChatMessageNow(host, message, {
    previousDraft: messageOverride == null ? previousDraft : undefined,
    restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
    attachments: hasAttachments ? attachmentsToSend : undefined,
    previousAttachments: messageOverride == null ? attachments : undefined,
    restoreAttachments: Boolean(messageOverride && opts?.restoreDraft),
    refreshSessions,
  });
}

export async function refreshChat(host: ChatHost, opts?: { scheduleScroll?: boolean }) {
  const pmosRole = (host as unknown as { pmosAuthUser?: { role?: string | null } | null })
    .pmosAuthUser?.role;
  const isWorkspaceUser = Boolean(pmosRole && pmosRole !== "super_admin");

  if (isWorkspaceUser) {
    // For PMOS workspace users, sessions.list may clamp a stale session key from old browser state.
    // Load sessions first so chat.history never fires against a foreign/invalid session.
    await loadSessions(host as unknown as Parameters<typeof loadSessions>[0], {
      activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
    });
    await Promise.all([
      loadChatHistory(host as unknown as OpenClawApp),
      refreshChatAvatar(host),
    ]);
  } else {
    await Promise.all([
      loadChatHistory(host as unknown as OpenClawApp),
      loadSessions(host as unknown as Parameters<typeof loadSessions>[0], {
        activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
      }),
      refreshChatAvatar(host),
    ]);
  }
  if (opts?.scheduleScroll !== false) {
    scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
  }
}

export const flushChatQueueForEvent = flushChatQueue;

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
};

function resolveAgentIdForSession(host: ChatHost): string | null {
  const parsed = parseAgentSessionKey(host.sessionKey);
  if (parsed?.agentId) {
    return parsed.agentId;
  }
  const snapshot = host.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const fallback = snapshot?.sessionDefaults?.defaultAgentId?.trim();
  return fallback || "main";
}

function buildAvatarMetaUrl(basePath: string, agentId: string): string {
  const base = normalizeBasePath(basePath);
  const encoded = encodeURIComponent(agentId);
  return base ? `${base}/avatar/${encoded}?meta=1` : `/avatar/${encoded}?meta=1`;
}

export async function refreshChatAvatar(host: ChatHost) {
  if (!host.connected) {
    host.chatAvatarUrl = null;
    return;
  }
  const agentId = resolveAgentIdForSession(host);
  if (!agentId) {
    host.chatAvatarUrl = null;
    return;
  }
  host.chatAvatarUrl = null;
  const url = buildAvatarMetaUrl(host.basePath, agentId);
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      host.chatAvatarUrl = null;
      return;
    }
    const data = (await res.json()) as { avatarUrl?: unknown };
    const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl.trim() : "";
    host.chatAvatarUrl = avatarUrl || null;
  } catch {
    host.chatAvatarUrl = null;
  }
}
