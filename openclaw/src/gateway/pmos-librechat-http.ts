import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody } from "./hooks.js";
import { resolvePmosSessionFromRequest } from "./pmos-auth.js";

const PMOS_LIBRECHAT_PREFIX = "/api/pmos/librechat";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TOKEN_TTL_MS = 25 * 60 * 1000;

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
      "content-type": "application/json",
      accept: "application/json",
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
  path: string,
  init: RequestInit = {},
  opts?: { retryOnUnauthorized?: boolean },
): Promise<Response> {
  const baseUrl = resolveLibreChatBaseUrl();
  if (!baseUrl) {
    throw new Error("LibreChat URL is not configured.");
  }
  const retryOnUnauthorized = opts?.retryOnUnauthorized !== false;
  const token = await getLibreChatToken(user);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 401 && retryOnUnauthorized) {
    clearCachedToken(user);
    const freshToken = await getLibreChatToken(user, { forceRefresh: true });
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
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

function normalizeAgent(agent: JsonRecord): NormalizedLibreChatAgent | null {
  const id = toStringValue(agent.id);
  if (!id) {
    return null;
  }
  const avatar = toRecord(agent.avatar);
  return {
    id,
    name: toStringValue(agent.name) || id,
    description: toStringValue(agent.description),
    provider: toStringValue(agent.provider),
    model:
      toStringValue(agent.model) ||
      toStringValue(toRecord(agent.model_parameters)?.model) ||
      null,
    avatarUrl: toStringValue(avatar?.filepath),
    category: toStringValue(agent.category),
  };
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
    ? message.content.filter((entry) => toRecord(entry) !== null).map((entry) => entry as Record<string, unknown>)
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
    text: toStringValue(message.text) || "",
    content: normalizeMessageContent(message),
  };
}

async function fetchLibreChatBootstrap(user: LibreChatSessionUser) {
  const [agentsResponse, convosResponse] = await Promise.all([
    libreChatRequest(user, "/api/agents?limit=200"),
    libreChatRequest(user, "/api/convos?limit=200&sortBy=updatedAt&sortDirection=desc"),
  ]);
  if (!agentsResponse.ok) {
    throw new Error(`LibreChat agents request failed (${agentsResponse.status})`);
  }
  if (!convosResponse.ok) {
    throw new Error(`LibreChat conversations request failed (${convosResponse.status})`);
  }

  const agentsJson = await readJsonResponse(agentsResponse);
  const convosJson = await readJsonResponse(convosResponse);

  const rawAgents = Array.isArray(agentsJson?.data)
    ? agentsJson?.data
    : Array.isArray(agentsJson)
      ? agentsJson
      : [];
  const agents = rawAgents
    .map((entry) => normalizeAgent(toRecord(entry) ?? {}))
    .filter((entry): entry is NormalizedLibreChatAgent => entry !== null);

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

  return {
    agents,
    conversations: detailedConversations.filter(
      (entry): entry is NormalizedLibreChatConversation => entry !== null,
    ),
  };
}

async function fetchLibreChatMessages(user: LibreChatSessionUser, conversationId: string) {
  const response = await libreChatRequest(
    user,
    `/api/messages/${encodeURIComponent(conversationId)}`,
  );
  if (!response.ok) {
    throw new Error(`LibreChat messages request failed (${response.status})`);
  }
  const payload = await response.json().catch(() => []);
  const messages = Array.isArray(payload) ? payload : [];
  const normalized = messages
    .map((entry) => normalizeMessage(toRecord(entry) ?? {}))
    .filter((entry): entry is NormalizedLibreChatMessage => entry !== null);
  const lastMessage =
    normalized.length > 0 ? normalized[normalized.length - 1] : null;
  return {
    messages: normalized,
    parentMessageId: lastMessage?.messageId ?? null,
  };
}

async function sendLibreChatMessage(
  user: LibreChatSessionUser,
  body: JsonRecord,
) {
  const response = await libreChatRequest(user, "/api/agents/chat", {
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
      const agentId = toStringValue(body.agentId);
      const text = toStringValue(body.text) || "";
      const conversationId = toStringValue(body.conversationId);
      const parentMessageId = toStringValue(body.parentMessageId);
      if (!agentId) {
        sendJson(res, 400, { ok: false, error: "agentId is required" });
        return true;
      }
      if (!text) {
        sendJson(res, 400, { ok: false, error: "text is required" });
        return true;
      }
      const result = await sendLibreChatMessage(user, {
        endpoint: "agents",
        agent_id: agentId,
        text,
        ...(conversationId ? { conversationId } : {}),
        ...(parentMessageId ? { parentMessageId } : {}),
      });
      sendJson(res, 200, { ok: true, ...result });
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
