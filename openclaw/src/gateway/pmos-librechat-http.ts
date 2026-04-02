import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CONFIG_DIR, ensureDir } from "../utils.js";
import { readJsonBody } from "./hooks.js";
import { resolvePmosSessionFromRequest } from "./pmos-auth.js";
import { readWorkspaceConfig } from "./workspace-config.js";

const PMOS_LIBRECHAT_PREFIX = "/api/pmos/librechat";
const LIBRECHAT_ENDPOINT = "wickedops";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TOKEN_TTL_MS = 25 * 60 * 1000;
const DEFAULT_MAX_CONTEXT_TOKENS = 17_100;
const BOT_STATE_FILENAME = "librechat-bot-state.json";
const HIDDEN_CONTEXT_OPEN = "<pmos-bot-context>";
const HIDDEN_CONTEXT_CLOSE = "</pmos-bot-context>";
const HIDDEN_USER_OPEN = "<pmos-user-message>";
const HIDDEN_USER_CLOSE = "</pmos-user-message>";
const LIBRECHAT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

type CachedLibreChatToken = {
  token: string;
  cachedAt: number;
};

type LibreChatSessionUser = {
  id: string;
  email: string;
  workspaceId: string;
};

type JsonRecord = Record<string, unknown>;

type WorkspaceBot = {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  systemPrompt: string | null;
  configuredModel: string | null;
  contextTokens: number | null;
};

type WorkspaceBotState = {
  version: 1;
  bots: Record<string, { model?: string }>;
  conversations: Record<string, { botId?: string; model?: string }>;
};

type NormalizedLibreChatAgent = {
  id: string;
  name: string;
  description: string | null;
  provider: string | null;
  model: string | null;
  avatarUrl: string | null;
  category: string | null;
};

type NormalizedLibreChatConversation = {
  conversationId: string;
  title: string;
  endpoint: string | null;
  agentId: string | null;
  model: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
};

type NormalizedLibreChatMessage = {
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

const libreChatTokenCache = new Map<string, CachedLibreChatToken>();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/\/+$/, "");
}

function resolveLibreChatBaseUrl(): string | null {
  const raw = process.env.PMOS_LIBRECHAT_URL;
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  return normalizeBaseUrl(raw);
}

function resolveLibreChatAutologinPassword(): string | null {
  const raw = process.env.PMOS_LIBRECHAT_AUTOLOGIN_PASSWORD;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed || null;
}

function toRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function safeWorkspaceId(workspaceId: string): string {
  return String(workspaceId).trim() || "default";
}

function cacheKeyForUser(user: LibreChatSessionUser): string {
  return `${user.workspaceId}:${user.email}`.toLowerCase();
}

function getCachedToken(user: LibreChatSessionUser): string | null {
  const entry = libreChatTokenCache.get(cacheKeyForUser(user));
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.cachedAt > TOKEN_TTL_MS) {
    libreChatTokenCache.delete(cacheKeyForUser(user));
    return null;
  }
  return entry.token;
}

function setCachedToken(user: LibreChatSessionUser, token: string): void {
  libreChatTokenCache.set(cacheKeyForUser(user), {
    token,
    cachedAt: Date.now(),
  });
}

function clearCachedToken(user: LibreChatSessionUser): void {
  libreChatTokenCache.delete(cacheKeyForUser(user));
}

function defaultWorkspaceBotState(): WorkspaceBotState {
  return {
    version: 1,
    bots: {},
    conversations: {},
  };
}

function workspaceBotStatePath(workspaceId: string): string {
  return path.join(CONFIG_DIR, "workspaces", safeWorkspaceId(workspaceId), BOT_STATE_FILENAME);
}

async function readWorkspaceBotState(workspaceId: string): Promise<WorkspaceBotState> {
  const filePath = workspaceBotStatePath(workspaceId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = toRecord(JSON.parse(raw));
    const next = defaultWorkspaceBotState();
    const bots = toRecord(parsed?.bots);
    const conversations = toRecord(parsed?.conversations);
    if (bots) {
      for (const [botId, value] of Object.entries(bots)) {
        const entry = toRecord(value);
        next.bots[botId] = {
          model: toStringValue(entry?.model) ?? undefined,
        };
      }
    }
    if (conversations) {
      for (const [conversationId, value] of Object.entries(conversations)) {
        const entry = toRecord(value);
        next.conversations[conversationId] = {
          botId: toStringValue(entry?.botId) ?? undefined,
          model: toStringValue(entry?.model) ?? undefined,
        };
      }
    }
    return next;
  } catch {
    return defaultWorkspaceBotState();
  }
}

async function writeWorkspaceBotState(
  workspaceId: string,
  next: WorkspaceBotState,
): Promise<void> {
  const filePath = workspaceBotStatePath(workspaceId);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(next, null, 2).trimEnd().concat("\n"), "utf-8");
}

async function updateWorkspaceBotState(
  workspaceId: string,
  mutator: (current: WorkspaceBotState) => WorkspaceBotState,
): Promise<WorkspaceBotState> {
  const current = await readWorkspaceBotState(workspaceId);
  const next = mutator(current);
  await writeWorkspaceBotState(workspaceId, next);
  return next;
}

async function rememberWorkspaceBotModel(
  workspaceId: string,
  botId: string,
  model: string,
): Promise<void> {
  const trimmedBotId = botId.trim();
  const trimmedModel = model.trim();
  if (!trimmedBotId || !trimmedModel) {
    return;
  }
  await updateWorkspaceBotState(workspaceId, (current) => ({
    ...current,
    bots: {
      ...current.bots,
      [trimmedBotId]: {
        ...current.bots[trimmedBotId],
        model: trimmedModel,
      },
    },
  }));
}

async function rememberConversationBotAssignment(params: {
  workspaceId: string;
  conversationId: string;
  botId: string;
  model: string;
}): Promise<void> {
  const conversationId = params.conversationId.trim();
  const botId = params.botId.trim();
  const model = params.model.trim();
  if (!conversationId || !botId || !model) {
    return;
  }
  await updateWorkspaceBotState(params.workspaceId, (current) => ({
    ...current,
    conversations: {
      ...current.conversations,
      [conversationId]: {
        botId,
        model,
      },
    },
  }));
}

function resolveFirstString(values: unknown[]): string | null {
  for (const value of values) {
    const next = toStringValue(value);
    if (next) {
      return next;
    }
  }
  return null;
}

function extractWorkspaceContextTokens(config: JsonRecord | null): number | null {
  const agents = toRecord(config?.agents);
  const defaults = toRecord(agents?.defaults);
  const sessions = toRecord(config?.sessions);
  return (
    toNumberValue(defaults?.contextTokens) ??
    toNumberValue(sessions?.contextTokens) ??
    DEFAULT_MAX_CONTEXT_TOKENS
  );
}

function extractWorkspaceBots(config: JsonRecord | null): WorkspaceBot[] {
  const agents = toRecord(config?.agents);
  const list = Array.isArray(agents?.list) ? agents?.list : [];
  const defaultContextTokens = extractWorkspaceContextTokens(config);
  const bots: WorkspaceBot[] = [];

  for (const entry of list) {
    const record = toRecord(entry);
    const id = toStringValue(record?.id);
    if (!id) {
      continue;
    }
    const identity = toRecord(record?.identity);
    const name =
      resolveFirstString([identity?.name, record?.name, id]) ??
      id;
    const description = resolveFirstString([identity?.theme, record?.purpose, record?.description]);
    const avatarUrl = resolveFirstString([identity?.avatarUrl, identity?.avatar]);
    const systemPrompt = resolveFirstString([record?.system, record?.prompt, record?.instructions]);
    const configuredModel =
      resolveFirstString([
        record?.model,
        toRecord(record?.model)?.primary,
        toRecord(toRecord(record?.model)?.primary)?.model,
      ]) ??
      resolveFirstString([
        toRecord(toRecord(agents?.defaults)?.model)?.primary,
        toRecord(agents?.defaults)?.model,
      ]);
    bots.push({
      id,
      name,
      description,
      avatarUrl,
      systemPrompt,
      configuredModel,
      contextTokens: defaultContextTokens,
    });
  }

  return bots;
}

function resolveBotPreferredModel(params: {
  bot: WorkspaceBot;
  store: WorkspaceBotState;
  availableModels: string[];
}): string | null {
  const configured = params.bot.configuredModel?.trim() ?? "";
  const stored = params.store.bots[params.bot.id]?.model?.trim() ?? "";
  if (stored && params.availableModels.includes(stored)) {
    return stored;
  }
  if (configured && params.availableModels.includes(configured)) {
    return configured;
  }
  return params.availableModels[0] ?? null;
}

async function loadWorkspaceBotsForLibreChat(
  workspaceId: string,
  availableModels: string[],
): Promise<{ bots: WorkspaceBot[]; store: WorkspaceBotState; agents: NormalizedLibreChatAgent[] }> {
  const config = toRecord(await readWorkspaceConfig(workspaceId));
  const bots = extractWorkspaceBots(config);
  const store = await readWorkspaceBotState(workspaceId);
  const agents = bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    description: bot.description,
    provider: LIBRECHAT_ENDPOINT,
    model: resolveBotPreferredModel({ bot, store, availableModels }),
    avatarUrl: bot.avatarUrl,
    category: "PMOS Bot",
  }));
  return { bots, store, agents };
}

function unwrapPromptText(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf(HIDDEN_USER_OPEN);
  const end = trimmed.indexOf(HIDDEN_USER_CLOSE);
  if (start < 0 || end < 0 || end <= start) {
    return text;
  }
  const content = trimmed.slice(start + HIDDEN_USER_OPEN.length, end).trim();
  return content || text;
}

function sanitizeMessageContent(
  content: Array<Record<string, unknown>>,
  role: "user" | "assistant",
): Array<Record<string, unknown>> {
  return content.map((entry) => {
    if (role !== "user") {
      return entry;
    }
    if (toStringValue(entry.type) !== "text") {
      return entry;
    }
    const text = toStringValue(entry.text);
    if (!text) {
      return entry;
    }
    return {
      ...entry,
      text: unwrapPromptText(text),
    };
  });
}

function buildWrappedBotPrompt(params: {
  bot: WorkspaceBot;
  model: string;
  text: string;
}): string {
  const context: JsonRecord = {
    botId: params.bot.id,
    botName: params.bot.name,
    model: params.model,
  };
  if (params.bot.description) {
    context.theme = params.bot.description;
  }
  if (params.bot.systemPrompt) {
    context.instructions = params.bot.systemPrompt;
  }
  return [
    HIDDEN_CONTEXT_OPEN,
    JSON.stringify(context),
    HIDDEN_CONTEXT_CLOSE,
    HIDDEN_USER_OPEN,
    params.text,
    HIDDEN_USER_CLOSE,
  ].join("\n");
}

function resolveWorkspaceBotById(workspaceBots: WorkspaceBot[], botId: string): WorkspaceBot | null {
  const trimmed = botId.trim();
  if (!trimmed) {
    return null;
  }
  return workspaceBots.find((entry) => entry.id === trimmed) ?? null;
}

function resolveConversationBotId(params: {
  conversationId: string;
  store: WorkspaceBotState;
  fallbackBotId: string | null;
  knownBotIds: Set<string>;
}): string | null {
  const storedBotId = params.store.conversations[params.conversationId]?.botId?.trim() ?? "";
  if (storedBotId && params.knownBotIds.has(storedBotId)) {
    return storedBotId;
  }
  return params.fallbackBotId;
}

function resolveConversationModel(params: {
  conversation: NormalizedLibreChatConversation;
  botId: string | null;
  agentsById: Map<string, NormalizedLibreChatAgent>;
  store: WorkspaceBotState;
  availableModels: string[];
}): string | null {
  const stored = params.store.conversations[params.conversation.conversationId]?.model?.trim() ?? "";
  if (stored && params.availableModels.includes(stored)) {
    return stored;
  }
  const conversationModel = params.conversation.model?.trim() ?? "";
  if (conversationModel && params.availableModels.includes(conversationModel)) {
    return conversationModel;
  }
  const agentModel = params.botId ? params.agentsById.get(params.botId)?.model?.trim() ?? "" : "";
  if (agentModel && params.availableModels.includes(agentModel)) {
    return agentModel;
  }
  return params.availableModels[0] ?? null;
}

async function loginToLibreChat(user: LibreChatSessionUser): Promise<string> {
  const baseUrl = resolveLibreChatBaseUrl();
  const password = resolveLibreChatAutologinPassword();
  if (!baseUrl) {
    throw new Error("LibreChat URL is not configured.");
  }
  if (!password) {
    throw new Error("LibreChat auto-login password is not configured.");
  }

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": LIBRECHAT_BROWSER_USER_AGENT,
      "accept-language": "en-US,en;q=0.9",
    },
    body: JSON.stringify({
      email: user.email,
      password,
    }),
  });

  const payload = toRecord(await response.json().catch(() => null));
  const token = toStringValue(payload?.token);
  if (!response.ok || !token) {
    const message =
      toStringValue(payload?.message) ||
      toStringValue(payload?.error) ||
      `LibreChat login failed (${response.status})`;
    throw new Error(message);
  }

  setCachedToken(user, token);
  return token;
}

async function getLibreChatToken(
  user: LibreChatSessionUser,
  opts?: { forceRefresh?: boolean },
): Promise<string> {
  if (!opts?.forceRefresh) {
    const cached = getCachedToken(user);
    if (cached) {
      return cached;
    }
  }
  return loginToLibreChat(user);
}

async function libreChatRequest(
  user: LibreChatSessionUser,
  pathName: string,
  init: RequestInit = {},
  opts?: { retryOnUnauthorized?: boolean },
): Promise<Response> {
  const baseUrl = resolveLibreChatBaseUrl();
  if (!baseUrl) {
    throw new Error("LibreChat URL is not configured.");
  }
  const retryOnUnauthorized = opts?.retryOnUnauthorized !== false;
  const token = await getLibreChatToken(user);
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...init,
    headers: {
      accept: "application/json",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": LIBRECHAT_BROWSER_USER_AGENT,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 401 && retryOnUnauthorized) {
    clearCachedToken(user);
    const freshToken = await getLibreChatToken(user, { forceRefresh: true });
    return fetch(`${baseUrl}${pathName}`, {
      ...init,
      headers: {
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": LIBRECHAT_BROWSER_USER_AGENT,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
        authorization: `Bearer ${freshToken}`,
      },
    });
  }
  return response;
}

async function readJsonResponse(response: Response): Promise<JsonRecord | null> {
  return toRecord(await response.json().catch(() => null));
}

async function fetchLibreChatAvailableModels(user: LibreChatSessionUser): Promise<string[]> {
  const response = await libreChatRequest(user, "/api/models");
  if (!response.ok) {
    throw new Error(`LibreChat models request failed (${response.status})`);
  }
  const payload = toRecord(await response.json().catch(() => null));
  const models = Array.isArray(payload?.[LIBRECHAT_ENDPOINT])
    ? payload?.[LIBRECHAT_ENDPOINT]
    : [];
  return models
    .map((entry) => toStringValue(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeConversation(conversation: JsonRecord): NormalizedLibreChatConversation | null {
  const conversationId = toStringValue(conversation.conversationId);
  if (!conversationId) {
    return null;
  }
  return {
    conversationId,
    title: toStringValue(conversation.title) || "New Chat",
    endpoint: toStringValue(conversation.endpoint),
    agentId: toStringValue(conversation.agent_id),
    model: toStringValue(conversation.model),
    createdAtMs: toNumberValue(conversation.createdAt),
    updatedAtMs: toNumberValue(conversation.updatedAt),
  };
}

function normalizeMessageContent(message: JsonRecord): Array<Record<string, unknown>> {
  const content = Array.isArray(message.content)
    ? message.content
        .filter((entry) => toRecord(entry) !== null)
        .map((entry) => entry as Record<string, unknown>)
    : [];
  if (content.length > 0) {
    return content;
  }
  const text = toStringValue(message.text) || "";
  if (text) {
    return [{ type: "text", text }];
  }
  return [];
}

function normalizeMessage(message: JsonRecord): NormalizedLibreChatMessage | null {
  const role = message.isCreatedByUser === true ? "user" : "assistant";
  const rawText = toStringValue(message.text) || "";
  const displayText = role === "user" ? unwrapPromptText(rawText) : rawText;
  const content = sanitizeMessageContent(normalizeMessageContent(message), role);
  return {
    messageId: toStringValue(message.messageId),
    conversationId: toStringValue(message.conversationId),
    parentMessageId: toStringValue(message.parentMessageId),
    role,
    sender: toStringValue(message.sender),
    model: toStringValue(message.model),
    timestamp: toNumberValue(message.createdAt) ?? Date.now(),
    unfinished: message.unfinished === true,
    error: message.error === true,
    text: displayText,
    content: content.length > 0 ? content : displayText ? [{ type: "text", text: displayText }] : [],
  };
}

async function fetchLibreChatBootstrap(user: LibreChatSessionUser) {
  const [availableModels, convosResponse] = await Promise.all([
    fetchLibreChatAvailableModels(user),
    libreChatRequest(user, "/api/convos?limit=200&sortBy=updatedAt&sortDirection=desc"),
  ]);
  if (!convosResponse.ok) {
    throw new Error(`LibreChat conversations request failed (${convosResponse.status})`);
  }

  const convosJson = await readJsonResponse(convosResponse);
  const minimalConversations = Array.isArray(convosJson?.conversations)
    ? convosJson.conversations
    : [];

  const detailedConversations = await Promise.all(
    minimalConversations.map(async (entry) => {
      const conversationId = toStringValue(toRecord(entry)?.conversationId);
      if (!conversationId) {
        return null;
      }
      try {
        const response = await libreChatRequest(
          user,
          `/api/convos/${encodeURIComponent(conversationId)}`,
        );
        if (!response.ok) {
          return normalizeConversation(toRecord(entry) ?? {});
        }
        return normalizeConversation((await readJsonResponse(response)) ?? {});
      } catch {
        return normalizeConversation(toRecord(entry) ?? {});
      }
    }),
  );

  const { store, agents } = await loadWorkspaceBotsForLibreChat(user.workspaceId, availableModels);
  const fallbackBotId = agents.find((entry) => entry.id === "assistant")?.id ?? agents[0]?.id ?? null;
  const knownBotIds = new Set(agents.map((entry) => entry.id));
  const agentsById = new Map(agents.map((entry) => [entry.id, entry]));

  const conversations = detailedConversations
    .filter((entry): entry is NormalizedLibreChatConversation => entry !== null)
    .map((conversation) => {
      const botId = resolveConversationBotId({
        conversationId: conversation.conversationId,
        store,
        fallbackBotId,
        knownBotIds,
      });
      return {
        ...conversation,
        agentId: botId,
        model: resolveConversationModel({
          conversation,
          botId,
          agentsById,
          store,
          availableModels,
        }),
      };
    });

  return {
    availableModels,
    agents,
    conversations,
  };
}

async function fetchLibreChatMessages(user: LibreChatSessionUser, conversationId: string) {
  const response = await libreChatRequest(
    user,
    `/api/messages?conversationId=${encodeURIComponent(conversationId)}`,
  );
  if (!response.ok) {
    throw new Error(`LibreChat messages request failed (${response.status})`);
  }
  const payload = await readJsonResponse(response);
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const normalized = messages
    .map((entry) => normalizeMessage(toRecord(entry) ?? {}))
    .filter((entry): entry is NormalizedLibreChatMessage => entry !== null);
  const lastMessage = normalized.length > 0 ? normalized[normalized.length - 1] : null;
  return {
    messages: normalized,
    parentMessageId: lastMessage?.messageId ?? null,
  };
}

async function sendLibreChatMessage(
  user: LibreChatSessionUser,
  body: JsonRecord,
) {
  const response = await libreChatRequest(user, `/api/agents/chat/${LIBRECHAT_ENDPOINT}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      toStringValue(payload?.message) ||
        toStringValue(payload?.error) ||
        `LibreChat send failed (${response.status})`,
    );
  }
  return payload ?? {};
}

async function fetchLibreChatStatus(user: LibreChatSessionUser, conversationId: string) {
  const response = await libreChatRequest(
    user,
    `/api/agents/chat/status/${encodeURIComponent(conversationId)}`,
  );
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      toStringValue(payload?.message) ||
        toStringValue(payload?.error) ||
        `LibreChat status failed (${response.status})`,
    );
  }
  return {
    active: payload?.active === true,
    streamId: toStringValue(payload?.streamId),
    createdAtMs: toNumberValue(payload?.createdAt),
    aggregatedContent: Array.isArray(payload?.aggregatedContent)
      ? payload?.aggregatedContent
      : [],
  };
}

async function abortLibreChatConversation(
  user: LibreChatSessionUser,
  conversationId: string,
) {
  const response = await libreChatRequest(user, "/api/agents/chat/abort", {
    method: "POST",
    body: JSON.stringify({
      conversationId,
    }),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      toStringValue(payload?.message) ||
        toStringValue(payload?.error) ||
        `LibreChat abort failed (${response.status})`,
    );
  }
  return payload ?? {};
}

function resolveConversationIdFromPath(pathname: string): string | null {
  const suffix = pathname.slice(PMOS_LIBRECHAT_PREFIX.length).replace(/^\/+/, "");
  if (!suffix.startsWith("messages/") && !suffix.startsWith("status/")) {
    return null;
  }
  const parts = suffix.split("/");
  const id = parts[1] ?? "";
  return id ? decodeURIComponent(id) : null;
}

export async function handlePmosLibreChatHttp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(PMOS_LIBRECHAT_PREFIX)) {
    return false;
  }

  const session = await resolvePmosSessionFromRequest(req);
  if (!session.ok) {
    sendJson(res, 401, { ok: false, error: "Authentication required" });
    return true;
  }

  const baseUrl = resolveLibreChatBaseUrl();
  if (!baseUrl) {
    sendJson(res, 503, { ok: false, error: "LibreChat is not configured." });
    return true;
  }

  const user: LibreChatSessionUser = {
    id: session.user.id,
    email: session.user.email,
    workspaceId: session.user.workspaceId,
  };
  const method = (req.method ?? "GET").toUpperCase();

  try {
    if (url.pathname === `${PMOS_LIBRECHAT_PREFIX}/bootstrap` && method === "GET") {
      const result = await fetchLibreChatBootstrap(user);
      sendJson(res, 200, {
        ok: true,
        url: baseUrl,
        autologinConfigured: Boolean(resolveLibreChatAutologinPassword()),
        ...result,
      });
      return true;
    }

    if (url.pathname.startsWith(`${PMOS_LIBRECHAT_PREFIX}/messages/`) && method === "GET") {
      const conversationId = resolveConversationIdFromPath(url.pathname);
      if (!conversationId) {
        sendJson(res, 400, { ok: false, error: "conversationId is required" });
        return true;
      }
      const result = await fetchLibreChatMessages(user, conversationId);
      sendJson(res, 200, { ok: true, conversationId, ...result });
      return true;
    }

    if (url.pathname.startsWith(`${PMOS_LIBRECHAT_PREFIX}/status/`) && method === "GET") {
      const conversationId = resolveConversationIdFromPath(url.pathname);
      if (!conversationId) {
        sendJson(res, 400, { ok: false, error: "conversationId is required" });
        return true;
      }
      const result = await fetchLibreChatStatus(user, conversationId);
      sendJson(res, 200, { ok: true, conversationId, ...result });
      return true;
    }

    if (url.pathname === `${PMOS_LIBRECHAT_PREFIX}/send` && method === "POST") {
      const bodyResult = await readJsonBody(req, MAX_BODY_BYTES);
      if (!bodyResult.ok) {
        sendJson(res, 400, { ok: false, error: bodyResult.error });
        return true;
      }
      const body = toRecord(bodyResult.value) ?? {};
      const botId = toStringValue(body.agentId);
      const text = toStringValue(body.text) || "";
      const requestedModel = toStringValue(body.model);
      const conversationId = toStringValue(body.conversationId);
      const parentMessageId = toStringValue(body.parentMessageId);
      if (!botId) {
        sendJson(res, 400, { ok: false, error: "agentId is required" });
        return true;
      }
      if (!text) {
        sendJson(res, 400, { ok: false, error: "text is required" });
        return true;
      }

      const availableModels = await fetchLibreChatAvailableModels(user);
      const { bots, store } = await loadWorkspaceBotsForLibreChat(user.workspaceId, availableModels);
      const bot = resolveWorkspaceBotById(bots, botId);
      if (!bot) {
        sendJson(res, 404, { ok: false, error: `Unknown PMOS bot "${botId}".` });
        return true;
      }
      const preferredModel =
        (requestedModel && availableModels.includes(requestedModel) ? requestedModel : null) ??
        store.conversations[conversationId ?? ""]?.model ??
        resolveBotPreferredModel({ bot, store, availableModels });
      if (!preferredModel) {
        sendJson(res, 503, { ok: false, error: "No LibreChat models are available for Wicked Ops." });
        return true;
      }

      const result = await sendLibreChatMessage(user, {
        endpoint: LIBRECHAT_ENDPOINT,
        endpointType: "custom",
        model: preferredModel,
        title: "New Chat",
        resendFiles: true,
        maxContextTokens: bot.contextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
        text: buildWrappedBotPrompt({
          bot,
          model: preferredModel,
          text,
        }),
        ...(conversationId ? { conversationId } : {}),
        ...(parentMessageId ? { parentMessageId } : {}),
      });
      const resolvedConversationId = toStringValue(result.conversationId);
      await rememberWorkspaceBotModel(user.workspaceId, bot.id, preferredModel);
      if (resolvedConversationId) {
        await rememberConversationBotAssignment({
          workspaceId: user.workspaceId,
          conversationId: resolvedConversationId,
          botId: bot.id,
          model: preferredModel,
        });
      }
      sendJson(res, 200, {
        ok: true,
        botId: bot.id,
        model: preferredModel,
        ...result,
      });
      return true;
    }

    if (url.pathname === `${PMOS_LIBRECHAT_PREFIX}/abort` && method === "POST") {
      const bodyResult = await readJsonBody(req, MAX_BODY_BYTES);
      if (!bodyResult.ok) {
        sendJson(res, 400, { ok: false, error: bodyResult.error });
        return true;
      }
      const body = toRecord(bodyResult.value) ?? {};
      const conversationId = toStringValue(body.conversationId);
      if (!conversationId) {
        sendJson(res, 400, { ok: false, error: "conversationId is required" });
        return true;
      }
      const result = await abortLibreChatConversation(user, conversationId);
      sendJson(res, 200, { ok: true, ...result });
      return true;
    }

    sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { ok: false, error: message });
    return true;
  }
}
