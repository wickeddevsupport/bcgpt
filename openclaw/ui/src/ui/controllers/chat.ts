import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { extractText, extractThinking } from "../chat/message-extract.ts";
import { generateUUID } from "../uuid.ts";
import { parseAgentSessionKey } from "../../../../src/routing/session-key.js";

export { extractText, extractThinking } from "../chat/message-extract.ts";

export type ChatState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatThinkingLevel: string | null;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  lastError: string | null;
  /** Set for PMOS workspace users (real UUID, not "default"). Used for workspace-aware validation paths. */
  pmosWorkspaceId?: string;
  /** Current screen context (selected project + tab) injected into PMOS chat system prompt. */
  pmosScreenContext?: string | null;
};

const chatHistoryLoadVersion = new WeakMap<object, number>();

function normalizeBasePath(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}

function messageTimestamp(message: unknown): number {
  if (!message || typeof message !== "object") {
    return 0;
  }
  const raw = message as Record<string, unknown>;
  const direct = typeof raw.timestamp === "number" ? raw.timestamp : 0;
  if (direct > 0) {
    return direct;
  }
  const nested = raw.message;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const value = (nested as Record<string, unknown>).timestamp;
    return typeof value === "number" ? value : 0;
  }
  return 0;
}

function isAssistantReply(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const raw = message as Record<string, unknown>;
  return raw.role === "assistant";
}

function reconcileRunWithHistory(state: ChatState, historyMessages: unknown[]): boolean {
  if (!state.chatRunId || !state.chatStreamStartedAt) {
    return false;
  }
  const runStartedAt = state.chatStreamStartedAt;
  const hasAssistantReply = historyMessages.some((message) => {
    if (!isAssistantReply(message)) {
      return false;
    }
    if (messageTimestamp(message) < runStartedAt) {
      return false;
    }
    const text = extractText(message)?.trim() ?? "";
    const thinking = extractThinking(message)?.trim() ?? "";
    return Boolean(text || thinking);
  });
  if (!hasAssistantReply) {
    return false;
  }
  state.chatRunId = null;
  state.chatStream = null;
  state.chatStreamStartedAt = null;
  state.chatSending = false;
  return true;
}

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  scopeKey?: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

type PendingChatMarker = {
  kind?: unknown;
  runId?: unknown;
};

function resolveExpectedScopeKey(state: ChatState): string {
  const workspaceId = typeof state.pmosWorkspaceId === "string" ? state.pmosWorkspaceId.trim() : "";
  return workspaceId ? `workspace:${workspaceId}` : "global";
}

function matchesChatEventScope(
  state: ChatState,
  payload?: Pick<ChatEventPayload, "runId" | "scopeKey">,
): boolean {
  const expectedScopeKey = resolveExpectedScopeKey(state);
  const actualScopeKey = typeof payload?.scopeKey === "string" ? payload.scopeKey.trim() : "";
  if (actualScopeKey) {
    return actualScopeKey === expectedScopeKey;
  }
  if (expectedScopeKey === "global") {
    return true;
  }
  return Boolean(payload?.runId && state.chatRunId && payload.runId === state.chatRunId);
}

function readPendingMarker(message: unknown): PendingChatMarker | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const raw = (message as Record<string, unknown>).__openclaw;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return raw as PendingChatMarker;
}

function isPendingMessageForRun(message: unknown, runId: string | null): boolean {
  if (!runId) {
    return false;
  }
  const marker = readPendingMarker(message);
  return marker?.kind === "pending-user" && marker.runId === runId;
}

function comparableMessageKey(message: unknown): string {
  const raw = message as Record<string, unknown>;
  const role = typeof raw.role === "string" ? raw.role : "unknown";
  const text = (extractText(message) ?? "").trim();
  if (text) {
    return `${role}:${text}`;
  }
  try {
    return `${role}:${JSON.stringify(raw.content ?? null)}`;
  } catch {
    return `${role}:${String(raw.content ?? "")}`;
  }
}

function mergePendingMessages(params: {
  history: unknown[];
  previous: unknown[];
  activeRunId: string | null;
}) {
  if (!params.activeRunId) {
    return params.history;
  }
  const pending = params.previous.filter((message) =>
    isPendingMessageForRun(message, params.activeRunId),
  );
  if (pending.length === 0) {
    return params.history;
  }
  const seen = new Set(params.history.map((message) => comparableMessageKey(message)));
  const extra = pending.filter((message) => {
    const key = comparableMessageKey(message);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  if (extra.length === 0) {
    return params.history;
  }
  return [...params.history, ...extra];
}

function clearPendingMarkersForRun(messages: unknown[], runId: string) {
  if (!runId) {
    return messages;
  }
  let changed = false;
  const next = messages.map((message) => {
    const marker = readPendingMarker(message);
    if (!marker || marker.kind !== "pending-user" || marker.runId !== runId) {
      return message;
    }
    const raw = message as Record<string, unknown>;
    const patched = { ...raw };
    delete patched.__openclaw;
    changed = true;
    return patched;
  });
  return changed ? next : messages;
}

function beginChatHistoryLoad(state: ChatState): number {
  const host = state as object;
  const nextVersion = (chatHistoryLoadVersion.get(host) ?? 0) + 1;
  chatHistoryLoadVersion.set(host, nextVersion);
  return nextVersion;
}

function isLatestChatHistoryLoad(state: ChatState, version: number): boolean {
  return (chatHistoryLoadVersion.get(state as object) ?? 0) === version;
}

function applyChatHistoryResult(
  state: ChatState,
  version: number,
  res: { messages?: unknown[]; thinkingLevel?: string | null },
): boolean {
  if (!isLatestChatHistoryLoad(state, version)) {
    return false;
  }
  const historyMessages = Array.isArray(res.messages) ? res.messages : [];
  const previousMessages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
  const recovered = reconcileRunWithHistory(state, historyMessages);
  state.chatMessages = mergePendingMessages({
    history: historyMessages,
    previous: previousMessages,
    activeRunId: recovered ? null : state.chatRunId,
  });
  state.chatThinkingLevel = res.thinkingLevel ?? null;
  state.lastError = null;
  return true;
}

async function resolveChatReadinessError(state: ChatState): Promise<string | null> {
  if (!state.client || !state.connected) {
    return "Connect to Wicked OS first, then try again.";
  }
  try {
    const res = await state.client.request<{ models?: Array<Record<string, unknown>> }>(
      "models.list",
      {},
    );
    const models = Array.isArray(res.models) ? res.models : [];
    if (models.length === 0) {
      return "No AI model is configured for this workspace. Configure one in Integrations -> AI Model Setup.";
    }
    // Newer gateways may return model catalog entries without an explicit
    // `available` boolean. In that case, treat listed models as usable.
    const hasExplicitAvailability = models.some(
      (model) => typeof model?.available === "boolean",
    );
    const hasAvailable = hasExplicitAvailability
      ? models.some((model) => model?.available === true)
      : models.length > 0;
    if (!hasAvailable) {
      return (
        "No model auth is configured for the active session. " +
        "Add a provider API key in Integrations -> AI Model Setup, then try Chat again."
      );
    }
    return null;
  } catch {
    // If the probe fails, do not block sending; normal chat error handling will catch issues.
    return null;
  }
}

async function loadChatHistoryViaHttp(state: ChatState): Promise<{
  messages?: unknown[];
  thinkingLevel?: string | null;
}> {
  const globalBasePath =
    typeof window !== "undefined" &&
    typeof (window as Window & { __OPENCLAW_CONTROL_UI_BASE_PATH__?: string })
      .__OPENCLAW_CONTROL_UI_BASE_PATH__ === "string"
      ? (window as Window & { __OPENCLAW_CONTROL_UI_BASE_PATH__?: string })
          .__OPENCLAW_CONTROL_UI_BASE_PATH__
      : "";
  const basePath = normalizeBasePath(globalBasePath);
  const url = new URL(
    `${basePath}/api/pmos/chat/history`,
    typeof window !== "undefined" ? window.location.origin : "http://localhost",
  );
  url.searchParams.set("sessionKey", state.sessionKey);
  url.searchParams.set("limit", "200");
  const res = await fetch(url.toString(), {
    credentials: "include",
    headers: {
      accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`chat history http failed (${res.status})`);
  }
  return (await res.json()) as {
    messages?: unknown[];
    thinkingLevel?: string | null;
  };
}

async function refreshWorkspaceSessionKey(state: ChatState): Promise<string | null> {
  if (!state.client || !state.connected || !state.pmosWorkspaceId) {
    return null;
  }
  const currentKey = typeof state.sessionKey === "string" ? state.sessionKey.trim() : "";
  const currentAgentId = parseAgentSessionKey(currentKey)?.agentId?.trim() ?? "";
  if (currentKey) {
    try {
      await state.client.request("sessions.patch", { key: currentKey });
      return currentKey;
    } catch {
      // Fall through to the existing-session recovery path.
    }
  }
  const res = await state.client.request<{
    sessions?: Array<{ key?: string | null }>;
  }>("sessions.list", {
    includeGlobal: false,
    includeUnknown: false,
    activeMinutes: 120,
  });
  const availableKeys =
    res.sessions
      ?.map((row) => (typeof row?.key === "string" ? row.key.trim() : ""))
      .filter(Boolean) ?? [];
  const nextKey =
    (currentAgentId
      ? availableKeys.find((key) => parseAgentSessionKey(key)?.agentId?.trim() === currentAgentId)
      : null) ??
    availableKeys[0] ??
    null;
  if (!nextKey) {
    return null;
  }
  state.sessionKey = nextKey;
  return nextKey;
}

export async function loadChatHistory(state: ChatState) {
  const version = beginChatHistoryLoad(state);
  state.chatLoading = true;
  state.lastError = null;
  try {
    const res =
      state.client && state.connected
        ? await state.client.request<{ messages?: Array<unknown>; thinkingLevel?: string }>(
            "chat.history",
            {
              sessionKey: state.sessionKey,
              limit: 200,
            },
          )
        : await loadChatHistoryViaHttp(state);
    applyChatHistoryResult(state, version, res);
  } catch (err) {
    const errorMessage = String(err);
    const canRepairMissingSession =
      Boolean(state.client && state.connected && state.pmosWorkspaceId) &&
      errorMessage.includes("session") &&
      errorMessage.includes("not found");
    if (canRepairMissingSession) {
      try {
        await state.client!.request("sessions.patch", { key: state.sessionKey });
        const repaired = await state.client!.request<{
          messages?: Array<unknown>;
          thinkingLevel?: string;
        }>("chat.history", {
          sessionKey: state.sessionKey,
          limit: 200,
        });
        applyChatHistoryResult(state, version, repaired);
        return;
      } catch {
        // Fall through to the existing fallback paths.
      }
    }
    if (state.client && state.connected) {
      try {
        const fallback = await loadChatHistoryViaHttp(state);
        applyChatHistoryResult(state, version, fallback);
        return;
      } catch {
        // Fall through to the original gateway error.
      }
    }
    if (isLatestChatHistoryLoad(state, version)) {
      state.lastError = String(err);
    }
  } finally {
    if (isLatestChatHistoryLoad(state, version)) {
      state.chatLoading = false;
    }
  }
}

function dataUrlToBase64(dataUrl: string): { content: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], content: match[2] };
}

export async function sendChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }

  const readinessError = await resolveChatReadinessError(state);
  if (readinessError) {
    state.lastError = readinessError;
    state.chatMessages = [
      ...state.chatMessages,
      {
        role: "assistant",
        content: [{ type: "text", text: `Error: ${readinessError}` }],
        timestamp: Date.now(),
      },
    ];
    return null;
  }

  const now = Date.now();
  const runId = generateUUID();

  // Build user message content blocks
  const contentBlocks: Array<{ type: string; text?: string; source?: unknown }> = [];
  if (msg) {
    contentBlocks.push({ type: "text", text: msg });
  }
  // Add attachment previews to the pending message for display
  if (hasAttachments) {
    for (const att of attachments) {
      if (att.mimeType.startsWith("image/")) {
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: att.mimeType, data: att.dataUrl },
        });
      } else {
        contentBlocks.push({ type: "text", text: `📎 ${att.fileName ?? att.mimeType}` });
      }
    }
  }

  state.chatMessages = [
    ...state.chatMessages,
    {
      role: "user",
      content: contentBlocks,
      timestamp: now,
      __openclaw: {
        kind: "pending-user",
        runId,
      },
    },
  ];

  // Use agent-based chat.send with WebSocket streaming for both PMOS workspace chat
  // and regular agent chat so live thoughts/tools/subagents stay visible in the UI.
  state.chatSending = true;
  state.lastError = null;
  state.chatRunId = runId;
  state.chatStream = "";
  state.chatStreamStartedAt = now;

  // Convert attachments to API format
  const apiAttachments = hasAttachments
    ? attachments
        .map((att) => {
          const parsed = dataUrlToBase64(att.dataUrl);
          if (!parsed) {
            return null;
          }
          return {
            mimeType: parsed.mimeType,
            fileName: att.fileName,
            content: parsed.content,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : undefined;

  try {
    const sendParams: Record<string, unknown> = {
      sessionKey: state.sessionKey,
      message: msg,
      deliver: false,
      idempotencyKey: runId,
      attachments: apiAttachments,
      ...(state.pmosScreenContext ? { screenContext: state.pmosScreenContext } : {}),
    };
    try {
      await state.client.request("chat.send", sendParams);
    } catch (err) {
      const message = String(err);
      const canRetryWithFreshSession =
        Boolean(state.pmosWorkspaceId) &&
        message.includes("session") &&
        message.includes("not found");
      if (!canRetryWithFreshSession) {
        throw err;
      }
      const refreshedSessionKey = await refreshWorkspaceSessionKey(state);
      if (!refreshedSessionKey) {
        throw err;
      }
      await state.client.request("chat.send", {
        ...sendParams,
        sessionKey: refreshedSessionKey,
      });
    }
    return runId;
  } catch (err) {
    const error = String(err);
    state.chatRunId = null;
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.lastError = error;
    state.chatMessages = [
      ...state.chatMessages,
      {
        role: "assistant",
        content: [{ type: "text", text: "Error: " + error }],
        timestamp: Date.now(),
      },
    ];
    return null;
  } finally {
    state.chatSending = false;
  }
}

export async function abortChatRun(state: ChatState): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const runId = state.chatRunId;
  try {
    await state.client.request(
      "chat.abort",
      runId ? { sessionKey: state.sessionKey, runId } : { sessionKey: state.sessionKey },
    );
    return true;
  } catch (err) {
    state.lastError = String(err);
    return false;
  }
}

export function handleChatEvent(state: ChatState, payload?: ChatEventPayload) {
  if (!payload) {
    return null;
  }
  if (!matchesChatEventScope(state, payload)) {
    return null;
  }
  if (payload.sessionKey !== state.sessionKey) {
    return null;
  }

  // Final from another run (e.g. sub-agent announce): refresh history to show new message.
  // See https://github.com/openclaw/openclaw/issues/1909
  if (payload.runId && state.chatRunId && payload.runId !== state.chatRunId) {
    if (payload.state === "final") {
      return "final";
    }
    return null;
  }

  if (payload.state === "delta") {
    const next = extractText(payload.message);
    const thinking = extractThinking(payload.message);
    // Update stream whenever we have thinking OR text content.
    // When only thinking is present (text hasn't started yet), we still surface it
    // so the UI shows the live reasoning stream instead of a static 3-dot indicator.
    const textPart = typeof next === "string" ? next : "";
    if (thinking || textPart) {
      // Encode live thinking as inline tags so renderStreamingGroup can display it.
      // extractThinkingCached and extractTextCached in grouped-render handle this format.
      const streamText = thinking ? `<thinking>${thinking}</thinking>\n${textPart}` : textPart;
      state.chatStream = streamText;
    }
  } else if (payload.state === "final") {
    state.chatMessages = clearPendingMarkersForRun(state.chatMessages, payload.runId);
    state.chatStream = null;
    state.chatSending = false;
  } else if (payload.state === "aborted") {
    state.chatMessages = clearPendingMarkersForRun(state.chatMessages, payload.runId);
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    state.chatSending = false;
  } else if (payload.state === "error") {
    state.chatMessages = clearPendingMarkersForRun(state.chatMessages, payload.runId);
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    state.chatSending = false;
    state.lastError = payload.errorMessage ?? "chat error";
  }
  return payload.state;
}
