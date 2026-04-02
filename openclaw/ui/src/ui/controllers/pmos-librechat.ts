function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, "");
}

export type PmosLibreChatAgent = {
  id: string;
  name: string;
  description: string | null;
  provider: string | null;
  model: string | null;
  avatarUrl: string | null;
  category: string | null;
};

export type PmosLibreChatConversation = {
  conversationId: string;
  title: string;
  endpoint: string | null;
  agentId: string | null;
  model: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
};

export type PmosLibreChatMessage = {
  messageId: string | null;
  conversationId: string | null;
  parentMessageId: string | null;
  role: "user" | "assistant";
  sender: string | null;
  model: string | null;
  timestamp: number;
  unfinished: boolean;
  error: boolean;
  text: string;
  content: Array<Record<string, unknown>>;
};

type PmosLibreChatBootstrapResponse = {
  ok: boolean;
  url?: string | null;
  autologinConfigured?: boolean;
  agents?: PmosLibreChatAgent[];
  conversations?: PmosLibreChatConversation[];
  error?: string;
};

type PmosLibreChatMessagesResponse = {
  ok: boolean;
  messages?: PmosLibreChatMessage[];
  parentMessageId?: string | null;
  error?: string;
};

type PmosLibreChatStatusResponse = {
  ok: boolean;
  active?: boolean;
  conversationId?: string;
  streamId?: string | null;
  aggregatedContent?: Array<Record<string, unknown>>;
  createdAtMs?: number | null;
  error?: string;
};

type PmosLibreChatSendResponse = {
  ok: boolean;
  streamId?: string | null;
  conversationId?: string | null;
  status?: string | null;
  error?: string;
};

export type PmosLibreChatState = {
  basePath: string;
  libreChatLoading: boolean;
  libreChatError: string | null;
  libreChatUrl: string | null;
  libreChatAutologinConfigured: boolean;
  libreChatAgents: PmosLibreChatAgent[];
  libreChatConversations: PmosLibreChatConversation[];
  libreChatMessages: PmosLibreChatMessage[];
  libreChatSelectedAgentId: string | null;
  libreChatSelectedConversationId: string | null;
  libreChatDraft: string;
  libreChatSending: boolean;
  libreChatParentMessageId: string | null;
  libreChatStreamingMessage: PmosLibreChatMessage | null;
  libreChatOpenAgentIds: string[];
  libreChatStatusPollTimer: number | null;
};

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}

function resolveLibreChatApiUrl(basePath: string, path: string): string {
  const normalized = normalizeBasePath(basePath);
  return normalized ? `${normalized}${path}` : path;
}

async function requestLibreChat<T>(
  state: Pick<PmosLibreChatState, "basePath">,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(resolveLibreChatApiUrl(state.basePath, path), {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error || `LibreChat request failed (${response.status})`);
  }
  return (payload ?? {}) as T;
}

function sortConversationsByRecent(
  conversations: PmosLibreChatConversation[],
): PmosLibreChatConversation[] {
  return [...conversations].sort((a, b) => {
    const aTime = a.updatedAtMs ?? a.createdAtMs ?? 0;
    const bTime = b.updatedAtMs ?? b.createdAtMs ?? 0;
    return bTime - aTime;
  });
}

function uniqueOpenAgentIds(agentIds: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const agentId of agentIds) {
    const trimmed = agentId.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function buildStreamingMessage(
  content: Array<Record<string, unknown>>,
  timestamp?: number | null,
): PmosLibreChatMessage {
  return {
    messageId: null,
    conversationId: null,
    parentMessageId: null,
    role: "assistant",
    sender: "LibreChat",
    model: null,
    timestamp: timestamp ?? Date.now(),
    unfinished: true,
    error: false,
    text: "",
    content,
  };
}

function buildUserMessage(text: string): PmosLibreChatMessage {
  return {
    messageId: null,
    conversationId: null,
    parentMessageId: null,
    role: "user",
    sender: null,
    model: null,
    timestamp: Date.now(),
    unfinished: false,
    error: false,
    text,
    content: [{ type: "text", text }],
  };
}

function buildAssistantErrorMessage(error: string): PmosLibreChatMessage {
  return {
    messageId: null,
    conversationId: null,
    parentMessageId: null,
    role: "assistant",
    sender: "LibreChat",
    model: null,
    timestamp: Date.now(),
    unfinished: false,
    error: true,
    text: error,
    content: [{ type: "text", text: `Error: ${error}` }],
  };
}

function ensureSelectedAgent(state: PmosLibreChatState): void {
  const current = state.libreChatSelectedAgentId?.trim() ?? "";
  if (current && state.libreChatAgents.some((agent) => agent.id === current)) {
    return;
  }
  state.libreChatSelectedAgentId = state.libreChatAgents[0]?.id ?? null;
}

function ensureSelectedConversation(state: PmosLibreChatState): void {
  const current = state.libreChatSelectedConversationId?.trim() ?? "";
  if (
    current &&
    state.libreChatConversations.some((conversation) => conversation.conversationId === current)
  ) {
    return;
  }
  const selectedAgentId = state.libreChatSelectedAgentId?.trim() ?? "";
  const latestForAgent = sortConversationsByRecent(
    state.libreChatConversations.filter(
      (conversation) => (conversation.agentId?.trim() ?? "") === selectedAgentId,
    ),
  )[0];
  state.libreChatSelectedConversationId = latestForAgent?.conversationId ?? null;
}

function syncSelectedAgentFromConversation(state: PmosLibreChatState): void {
  const selectedConversationId = state.libreChatSelectedConversationId?.trim() ?? "";
  if (!selectedConversationId) {
    return;
  }
  const conversation = state.libreChatConversations.find(
    (entry) => entry.conversationId === selectedConversationId,
  );
  const agentId = conversation?.agentId?.trim() ?? "";
  if (!agentId) {
    return;
  }
  state.libreChatSelectedAgentId = agentId;
  state.libreChatOpenAgentIds = uniqueOpenAgentIds([
    ...state.libreChatOpenAgentIds,
    agentId,
  ]);
}

export function getPmosLibreChatUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = (window as Window & { __OPENCLAW_PMOS_LIBRECHAT_URL__?: string | null })
    .__OPENCLAW_PMOS_LIBRECHAT_URL__;
  return typeof raw === "string" ? normalizeUrl(raw) : null;
}

export function isPmosLibreChatEnabled(): boolean {
  return Boolean(getPmosLibreChatUrl());
}

export function clearPmosLibreChatStatusPolling(state: PmosLibreChatState): void {
  if (state.libreChatStatusPollTimer != null) {
    window.clearTimeout(state.libreChatStatusPollTimer);
    state.libreChatStatusPollTimer = null;
  }
}

export async function loadPmosLibreChatBootstrap(
  state: PmosLibreChatState,
  opts?: { preserveSelection?: boolean },
): Promise<void> {
  if (state.libreChatLoading) {
    return;
  }
  state.libreChatLoading = true;
  state.libreChatError = null;
  try {
    const result = await requestLibreChat<PmosLibreChatBootstrapResponse>(
      state,
      "/api/pmos/librechat/bootstrap",
    );
    state.libreChatUrl = normalizeUrl(result.url || getPmosLibreChatUrl() || "") ?? null;
    state.libreChatAutologinConfigured = result.autologinConfigured === true;
    state.libreChatAgents = Array.isArray(result.agents) ? result.agents : [];
    state.libreChatConversations = sortConversationsByRecent(
      Array.isArray(result.conversations) ? result.conversations : [],
    );
    ensureSelectedAgent(state);
    if (!opts?.preserveSelection || !state.libreChatSelectedConversationId) {
      ensureSelectedConversation(state);
    } else {
      syncSelectedAgentFromConversation(state);
    }
    state.libreChatOpenAgentIds = uniqueOpenAgentIds([
      ...state.libreChatOpenAgentIds,
      state.libreChatSelectedAgentId ?? "",
    ]);
  } catch (err) {
    state.libreChatError = String(err);
  } finally {
    state.libreChatLoading = false;
  }
}

export async function loadPmosLibreChatMessages(
  state: PmosLibreChatState,
  conversationId: string,
): Promise<void> {
  const trimmedId = conversationId.trim();
  if (!trimmedId) {
    state.libreChatMessages = [];
    state.libreChatParentMessageId = null;
    state.libreChatSelectedConversationId = null;
    state.libreChatStreamingMessage = null;
    return;
  }
  state.libreChatLoading = true;
  state.libreChatError = null;
  try {
    const result = await requestLibreChat<PmosLibreChatMessagesResponse>(
      state,
      `/api/pmos/librechat/messages/${encodeURIComponent(trimmedId)}`,
    );
    state.libreChatMessages = Array.isArray(result.messages) ? result.messages : [];
    state.libreChatParentMessageId =
      typeof result.parentMessageId === "string" ? result.parentMessageId : null;
    state.libreChatSelectedConversationId = trimmedId;
    syncSelectedAgentFromConversation(state);
  } catch (err) {
    state.libreChatError = String(err);
  } finally {
    state.libreChatLoading = false;
  }
}

export async function selectPmosLibreChatConversation(
  state: PmosLibreChatState,
  conversationId: string,
): Promise<void> {
  clearPmosLibreChatStatusPolling(state);
  state.libreChatStreamingMessage = null;
  await loadPmosLibreChatMessages(state, conversationId);
}

export function selectPmosLibreChatAgent(state: PmosLibreChatState, agentId: string): void {
  const trimmed = agentId.trim();
  if (!trimmed) {
    return;
  }
  state.libreChatSelectedAgentId = trimmed;
  state.libreChatOpenAgentIds = uniqueOpenAgentIds([...state.libreChatOpenAgentIds, trimmed]);
  const selectedConversation = state.libreChatConversations.find(
    (conversation) => conversation.conversationId === state.libreChatSelectedConversationId,
  );
  if ((selectedConversation?.agentId?.trim() ?? "") !== trimmed) {
    state.libreChatSelectedConversationId = null;
    state.libreChatMessages = [];
    state.libreChatParentMessageId = null;
    state.libreChatStreamingMessage = null;
  }
}

export function togglePmosLibreChatAgentAccordion(
  state: PmosLibreChatState,
  agentId: string,
): void {
  const trimmed = agentId.trim();
  if (!trimmed) {
    return;
  }
  if (state.libreChatOpenAgentIds.includes(trimmed)) {
    state.libreChatOpenAgentIds = state.libreChatOpenAgentIds.filter((id) => id !== trimmed);
    return;
  }
  state.libreChatOpenAgentIds = [...state.libreChatOpenAgentIds, trimmed];
}

export function startPmosLibreChatConversation(
  state: PmosLibreChatState,
  agentId: string,
): void {
  clearPmosLibreChatStatusPolling(state);
  selectPmosLibreChatAgent(state, agentId);
  state.libreChatSelectedConversationId = null;
  state.libreChatMessages = [];
  state.libreChatParentMessageId = null;
  state.libreChatDraft = "";
  state.libreChatStreamingMessage = null;
  state.libreChatError = null;
}

async function pollPmosLibreChatStatus(
  state: PmosLibreChatState,
  conversationId: string,
): Promise<void> {
  try {
    const result = await requestLibreChat<PmosLibreChatStatusResponse>(
      state,
      `/api/pmos/librechat/status/${encodeURIComponent(conversationId)}`,
    );
    if (result.active) {
      const content = Array.isArray(result.aggregatedContent) ? result.aggregatedContent : [];
      state.libreChatStreamingMessage = buildStreamingMessage(content, result.createdAtMs);
      state.libreChatStatusPollTimer = window.setTimeout(() => {
        void pollPmosLibreChatStatus(state, conversationId);
      }, 1200);
      return;
    }

    clearPmosLibreChatStatusPolling(state);
    state.libreChatSending = false;
    state.libreChatStreamingMessage = null;
    await loadPmosLibreChatMessages(state, conversationId);
    await loadPmosLibreChatBootstrap(state, { preserveSelection: true });
  } catch (err) {
    clearPmosLibreChatStatusPolling(state);
    state.libreChatSending = false;
    state.libreChatStreamingMessage = null;
    state.libreChatError = String(err);
  }
}

function upsertConversationSummary(
  state: PmosLibreChatState,
  conversation: PmosLibreChatConversation,
): void {
  const existing = state.libreChatConversations.find(
    (entry) => entry.conversationId === conversation.conversationId,
  );
  const merged = existing
    ? {
        ...existing,
        ...conversation,
      }
    : conversation;
  state.libreChatConversations = sortConversationsByRecent([
    merged,
    ...state.libreChatConversations.filter(
      (entry) => entry.conversationId !== conversation.conversationId,
    ),
  ]);
}

export async function sendPmosLibreChatMessage(state: PmosLibreChatState): Promise<void> {
  const agentId = state.libreChatSelectedAgentId?.trim() ?? "";
  const text = state.libreChatDraft.trim();
  if (!agentId || !text || state.libreChatSending) {
    return;
  }

  clearPmosLibreChatStatusPolling(state);
  state.libreChatError = null;
  state.libreChatSending = true;
  state.libreChatDraft = "";
  state.libreChatMessages = [...state.libreChatMessages, buildUserMessage(text)];
  state.libreChatStreamingMessage = buildStreamingMessage([{ type: "text", text: "Thinking..." }]);

  try {
    const result = await requestLibreChat<PmosLibreChatSendResponse>(
      state,
      "/api/pmos/librechat/send",
      {
        method: "POST",
        body: JSON.stringify({
          agentId,
          text,
          conversationId: state.libreChatSelectedConversationId,
          parentMessageId: state.libreChatParentMessageId,
        }),
      },
    );
    const conversationId = typeof result.conversationId === "string" ? result.conversationId : "";
    if (!conversationId) {
      throw new Error("LibreChat did not return a conversation ID.");
    }
    state.libreChatSelectedConversationId = conversationId;
    upsertConversationSummary(state, {
      conversationId,
      title: "New Chat",
      endpoint: "agents",
      agentId,
      model:
        state.libreChatAgents.find((agent) => agent.id === agentId)?.model ??
        null,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    });
    state.libreChatOpenAgentIds = uniqueOpenAgentIds([
      ...state.libreChatOpenAgentIds,
      agentId,
    ]);
    await pollPmosLibreChatStatus(state, conversationId);
  } catch (err) {
    clearPmosLibreChatStatusPolling(state);
    state.libreChatSending = false;
    state.libreChatStreamingMessage = null;
    const error = String(err);
    state.libreChatError = error;
    state.libreChatMessages = [...state.libreChatMessages, buildAssistantErrorMessage(error)];
  }
}

export async function abortPmosLibreChatMessage(state: PmosLibreChatState): Promise<void> {
  const conversationId = state.libreChatSelectedConversationId?.trim() ?? "";
  if (!conversationId || !state.libreChatSending) {
    return;
  }
  try {
    await requestLibreChat(state, "/api/pmos/librechat/abort", {
      method: "POST",
      body: JSON.stringify({ conversationId }),
    });
  } catch (err) {
    state.libreChatError = String(err);
  } finally {
    clearPmosLibreChatStatusPolling(state);
    state.libreChatSending = false;
    state.libreChatStreamingMessage = null;
    await loadPmosLibreChatMessages(state, conversationId);
  }
}
