import { CURRENT_SESSION_VERSION, SessionManager } from "@mariozechner/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import type { MsgContext } from "../../auto-reply/templating.js";
import type { GatewayClient, GatewayRequestContext, GatewayRequestHandlers } from "./types.js";
import { normalizeVerboseLevel } from "../../auto-reply/thinking.js";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { resolveThinkingDefault } from "../../agents/model-selection.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { dispatchInboundMessage } from "../../auto-reply/dispatch.js";
import { createReplyDispatcher } from "../../auto-reply/reply/reply-dispatcher.js";
import { createReplyPrefixOptions } from "../../channels/reply-prefix.js";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import {
  abortChatRunById,
  abortChatRunsForSessionKey,
  isChatStopCommandText,
  resolveChatRunExpiresAtMs,
} from "../chat-abort.js";
import { type ChatImageContent, parseMessageWithAttachments } from "../chat-attachments.js";
import { stripEnvelopeFromMessages } from "../chat-sanitize.js";
import { GATEWAY_CLIENT_CAPS, hasGatewayClientCap } from "../protocol/client-info.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChatAbortParams,
  validateChatHistoryParams,
  validateChatInjectParams,
  validateChatSendParams,
} from "../protocol/index.js";
import { getMaxChatHistoryMessagesBytes } from "../server-constants.js";
import {
  capArrayByJsonBytes,
  loadSessionEntryForConfig,
  readSessionMessages,
  resolveSessionModelRef,
} from "../session-utils.js";
import { formatForLog } from "../ws-log.js";
import { injectTimestamp, timestampOptsFromConfig } from "./agent-timestamp.js";
import { isSuperAdmin } from "../workspace-context.js";
import { registerAgentRunContext } from "../../infra/agent-events.js";
import { rateLimiter } from "../../security/rate-limiter.js";
import { listAgentsForGateway, resolveGatewaySessionStoreTarget } from "../session-utils.js";
import { inspectWorkspaceChatUrls } from "../url-routing.js";
import {
  resolveEffectiveRequestWorkspaceId,
  resolveWorkspaceRequestContext,
  type WorkspaceRequestContext,
  workspaceRequestCanAccessSessionKey,
} from "../workspace-request.js";

type TranscriptAppendResult = {
  ok: boolean;
  messageId?: string;
  message?: Record<string, unknown>;
  error?: string;
};

type AppendMessageArg = Parameters<SessionManager["appendMessage"]>[0];

async function loadChatWorkspaceContext(
  client: GatewayClient | null,
  params?: unknown,
): Promise<WorkspaceRequestContext> {
  return await resolveWorkspaceRequestContext(client, params, { configLabel: "chat" });
}

function resolveTranscriptPath(params: {
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
}): string | null {
  const { sessionId, storePath, sessionFile } = params;
  if (sessionFile) {
    return sessionFile;
  }
  if (!storePath) {
    return null;
  }
  return path.join(path.dirname(storePath), `${sessionId}.jsonl`);
}

function ensureTranscriptFile(params: { transcriptPath: string; sessionId: string }): {
  ok: boolean;
  error?: string;
} {
  if (fs.existsSync(params.transcriptPath)) {
    return { ok: true };
  }
  try {
    fs.mkdirSync(path.dirname(params.transcriptPath), { recursive: true });
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: params.sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    fs.writeFileSync(params.transcriptPath, `${JSON.stringify(header)}\n`, "utf-8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function appendAssistantTranscriptMessage(params: {
  message: string;
  label?: string;
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  createIfMissing?: boolean;
}): TranscriptAppendResult {
  const transcriptPath = resolveTranscriptPath({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
  });
  if (!transcriptPath) {
    return { ok: false, error: "transcript path not resolved" };
  }

  if (!fs.existsSync(transcriptPath)) {
    if (!params.createIfMissing) {
      return { ok: false, error: "transcript file not found" };
    }
    const ensured = ensureTranscriptFile({
      transcriptPath,
      sessionId: params.sessionId,
    });
    if (!ensured.ok) {
      return { ok: false, error: ensured.error ?? "failed to create transcript file" };
    }
  }

  const now = Date.now();
  const labelPrefix = params.label ? `[${params.label}]\n\n` : "";
  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
  const messageBody: AppendMessageArg & Record<string, unknown> = {
    role: "assistant",
    content: [{ type: "text", text: `${labelPrefix}${params.message}` }],
    timestamp: now,
    // Pi stopReason is a strict enum; this is not model output, but we still store it as a
    // normal assistant message so it participates in the session parentId chain.
    stopReason: "stop",
    usage,
    // Make these explicit so downstream tooling never treats this as model output.
    api: "openai-responses",
    provider: "openclaw",
    model: "gateway-injected",
  };

  try {
    // IMPORTANT: Use SessionManager so the entry is attached to the current leaf via parentId.
    // Raw jsonl appends break the parent chain and can hide compaction summaries from context.
    const sessionManager = SessionManager.open(transcriptPath);
    const messageId = sessionManager.appendMessage(messageBody);
    return { ok: true, messageId, message: messageBody };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function appendUserTranscriptMessage(params: {
  message: string;
  images?: ChatImageContent[];
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  createIfMissing?: boolean;
}): TranscriptAppendResult {
  const transcriptPath = resolveTranscriptPath({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
  });
  if (!transcriptPath) {
    return { ok: false, error: "transcript path not resolved" };
  }
  if (!fs.existsSync(transcriptPath)) {
    if (!params.createIfMissing) {
      return { ok: false, error: "transcript file not found" };
    }
    const ensured = ensureTranscriptFile({
      transcriptPath,
      sessionId: params.sessionId,
    });
    if (!ensured.ok) {
      return { ok: false, error: ensured.error ?? "failed to create transcript file" };
    }
  }

  const content: Array<Record<string, unknown>> = [];
  const text = params.message.trim();
  if (text) {
    content.push({ type: "text", text });
  }
  for (const image of params.images ?? []) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType,
        data: image.data,
      },
    });
  }
  if (content.length === 0) {
    return { ok: false, error: "user transcript content empty" };
  }

  const messageBody: AppendMessageArg & Record<string, unknown> = {
    role: "user",
    content,
    timestamp: Date.now(),
  };

  try {
    const sessionManager = SessionManager.open(transcriptPath);
    const messageId = sessionManager.appendMessage(messageBody);
    return { ok: true, messageId, message: messageBody };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function nextChatSeq(context: { agentRunSeq: Map<string, number> }, runId: string) {
  const next = (context.agentRunSeq.get(runId) ?? 0) + 1;
  context.agentRunSeq.set(runId, next);
  return next;
}

function broadcastChatFinal(params: {
  context: Pick<
    GatewayRequestContext,
    "broadcast" | "nodeSendToSession" | "agentRunSeq" | "chatRunBuffers" | "chatDeltaSentAt"
  >;
  runId: string;
  sessionKey: string;
  scopeKey?: string;
  message?: Record<string, unknown>;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    scopeKey: params.scopeKey,
    seq,
    state: "final" as const,
    message: params.message,
  };
  params.context.chatRunBuffers.delete(params.runId);
  params.context.chatDeltaSentAt.delete(params.runId);
  params.context.broadcast("chat", payload);
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
}

function broadcastChatDelta(params: {
  context: Pick<
    GatewayRequestContext,
    "broadcast" | "nodeSendToSession" | "agentRunSeq" | "chatRunBuffers" | "chatDeltaSentAt"
  >;
  runId: string;
  sessionKey: string;
  scopeKey?: string;
  text: string;
}) {
  const nextText = params.text;
  if (!nextText) {
    return;
  }
  const accumulated = (params.context.chatRunBuffers.get(params.runId) ?? "") + nextText;
  params.context.chatRunBuffers.set(params.runId, accumulated);
  const now = Date.now();
  const last = params.context.chatDeltaSentAt.get(params.runId) ?? 0;
  if (now - last < 50) {
    return;
  }
  params.context.chatDeltaSentAt.set(params.runId, now);
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    scopeKey: params.scopeKey,
    seq,
    state: "delta" as const,
    message: {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: accumulated }],
      timestamp: now,
    },
  };
  params.context.broadcast("chat", payload, { dropIfSlow: true });
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
}

function broadcastChatError(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession" | "agentRunSeq">;
  runId: string;
  sessionKey: string;
  scopeKey?: string;
  errorMessage?: string;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    scopeKey: params.scopeKey,
    seq,
    state: "error" as const,
    errorMessage: params.errorMessage,
  };
  params.context.broadcast("chat", payload);
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
}

/**
 * Validates that a user has access to a session by checking workspace ownership.
 * Returns true if user has access, false otherwise.
 */
function canAccessSession(
  sessionKey: string,
  workspaceContext: WorkspaceRequestContext,
): boolean {
  return workspaceRequestCanAccessSessionKey(workspaceContext, sessionKey);
}

export function shouldRouteToPmosWorkspaceChat(
  client: GatewayClient | null,
  message: string,
): boolean {
  const workspaceId = resolveEffectiveRequestWorkspaceId(client, undefined) ?? "";
  if (!workspaceId) {
    return false;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }

  return false;
}

async function buildWorkspaceSystemPrompt(
  workspaceId?: string,
): Promise<string> {
  if (!workspaceId) {
    return "";
  }

  return [
    `PMOS workspace ID: ${workspaceId}`,
    "For Basecamp requests use bcgpt_mcp_call(workspaceId, tool, arguments) — pass the workspace ID above.",
    "Common tools: list_projects, list_todos_for_project, list_todolists, create_todo, complete_todo,",
    "uncomplete_todo, trash_todo, move_todo, update_todo_details, list_messages, create_message,",
    "list_schedule_entries, create_schedule_entry, trash_schedule_entry, list_card_tables, list_project_people.",
    "For natural language Basecamp queries use bcgpt_smart_action(workspaceId, query, project?).",
    "For Figma requests use figma_mcp_call(workspaceId, tool) or figma_pat_audit_file(workspaceId).",
  ].join(" ");
}

export const chatHandlers: GatewayRequestHandlers = {
  "chat.history": async ({ params, respond, context, client }) => {
    if (!validateChatHistoryParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.history params: ${formatValidationErrors(validateChatHistoryParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, limit } = params as {
      sessionKey: string;
      limit?: number;
    };
    let workspaceContext: WorkspaceRequestContext;
    try {
      workspaceContext = await loadChatWorkspaceContext(client, params);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
      return;
    }
    const cfg = workspaceContext.cfg;
    const { storePath, entry } = loadSessionEntryForConfig(cfg, sessionKey);

    // Check workspace ownership for non-super-admin users
    if (!canAccessSession(sessionKey, workspaceContext)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `session "${sessionKey}" not found`),
      );
      return;
    }
    const sessionId = entry?.sessionId;
    const rawMessages =
      sessionId && storePath ? readSessionMessages(sessionId, storePath, entry?.sessionFile) : [];
    const hardMax = 1000;
    const defaultLimit = 200;
    const requested = typeof limit === "number" ? limit : defaultLimit;
    const max = Math.min(hardMax, requested);
    const sliced = rawMessages.length > max ? rawMessages.slice(-max) : rawMessages;
    const sanitized = stripEnvelopeFromMessages(sliced);
    const capped = capArrayByJsonBytes(sanitized, getMaxChatHistoryMessagesBytes()).items;
    let thinkingLevel = entry?.thinkingLevel;
    if (!thinkingLevel) {
      const configured = cfg.agents?.defaults?.thinkingDefault;
      if (configured) {
        thinkingLevel = configured;
      } else {
        const sessionAgentId = resolveSessionAgentId({ sessionKey, config: cfg });
        const { provider, model } = resolveSessionModelRef(cfg, entry, sessionAgentId);
        const catalog = await context.loadGatewayModelCatalog({ config: cfg });
        thinkingLevel = resolveThinkingDefault({
          cfg,
          provider,
          model,
          catalog,
        });
      }
    }
    const verboseLevel = entry?.verboseLevel ?? cfg.agents?.defaults?.verboseDefault;
    respond(true, {
      sessionKey,
      sessionId,
      messages: capped,
      thinkingLevel,
      verboseLevel,
    });
  },
  "chat.abort": async ({ params, respond, context, client }) => {
    if (!validateChatAbortParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.abort params: ${formatValidationErrors(validateChatAbortParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, runId } = params as {
      sessionKey: string;
      runId?: string;
    };

    // Check workspace ownership for non-super-admin users
    let workspaceContext: WorkspaceRequestContext;
    try {
      workspaceContext = await loadChatWorkspaceContext(client, params);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
      return;
    }
    const cfg = workspaceContext.cfg;
    const scopeKey = workspaceContext.scopeKey;
    if (!canAccessSession(sessionKey, workspaceContext)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `session "${sessionKey}" not found`),
      );
      return;
    }

    const ops = {
      chatAbortControllers: context.chatAbortControllers,
      chatRunBuffers: context.chatRunBuffers,
      chatDeltaSentAt: context.chatDeltaSentAt,
      chatAbortedRuns: context.chatAbortedRuns,
      removeChatRun: context.removeChatRun,
      agentRunSeq: context.agentRunSeq,
      broadcast: context.broadcast,
      nodeSendToSession: context.nodeSendToSession,
    };

    if (!runId) {
      const res = abortChatRunsForSessionKey(ops, {
        sessionKey,
        scopeKey,
        stopReason: "rpc",
      });
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }

    const active = context.chatAbortControllers.get(runId);
    if (!active) {
      respond(true, { ok: true, aborted: false, runIds: [] });
      return;
    }
    if (active.sessionKey !== sessionKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "runId does not match sessionKey"),
      );
      return;
    }

    const res = abortChatRunById(ops, {
      runId,
      sessionKey,
      scopeKey,
      stopReason: "rpc",
    });
    respond(true, {
      ok: true,
      aborted: res.aborted,
      runIds: res.aborted ? [runId] : [],
    });
  },
  "chat.send": async ({ params, respond, context, client }) => {
    if (!validateChatSendParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.send params: ${formatValidationErrors(validateChatSendParams.errors)}`,
        ),
      );
      return;
    }
    let workspaceContext: WorkspaceRequestContext;
    try {
      workspaceContext = await loadChatWorkspaceContext(client, params);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
      return;
    }
    const chatRateCheck = rateLimiter.check(workspaceContext.scopeKey, "chat.send");
    if (!chatRateCheck.allowed) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, `Rate limit exceeded. Retry after ${chatRateCheck.retryAfter}s`));
      return;
    }

    const p = params as {
      sessionKey: string;
      message: string;
      thinking?: string;
      deliver?: boolean;
      attachments?: Array<{
        type?: string;
        mimeType?: string;
        fileName?: string;
        content?: unknown;
      }>;
      timeoutMs?: number;
      idempotencyKey: string;
      screenContext?: string;
    };
    const stopCommand = isChatStopCommandText(p.message);
    const normalizedAttachments =
      p.attachments
        ?.map((a) => ({
          type: typeof a?.type === "string" ? a.type : undefined,
          mimeType: typeof a?.mimeType === "string" ? a.mimeType : undefined,
          fileName: typeof a?.fileName === "string" ? a.fileName : undefined,
          content:
            typeof a?.content === "string"
              ? a.content
              : ArrayBuffer.isView(a?.content)
                ? Buffer.from(
                    a.content.buffer,
                    a.content.byteOffset,
                    a.content.byteLength,
                  ).toString("base64")
                : undefined,
        }))
        .filter((a) => a.content) ?? [];
    const rawMessage = p.message.trim();
    if (!rawMessage && normalizedAttachments.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "message or attachment required"),
      );
      return;
    }

    let parsedMessage = p.message;
    let parsedImages: ChatImageContent[] = [];
    if (normalizedAttachments.length > 0) {
      try {
        const parsed = await parseMessageWithAttachments(p.message, normalizedAttachments, {
          maxBytes: 20_000_000,
          log: context.logGateway,
        });
        parsedMessage = parsed.message;
        parsedImages = parsed.images;
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
        return;
      }
    }
    const rawSessionKey = p.sessionKey;
    const cfg = workspaceContext.cfg;
    const { entry, canonicalKey: sessionKey } = loadSessionEntryForConfig(cfg, rawSessionKey);
    const scopeKey = workspaceContext.scopeKey;

    // Check workspace ownership for non-super-admin users
    if (!canAccessSession(rawSessionKey, workspaceContext)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `session "${rawSessionKey}" not found`),
      );
      return;
    }
    const timeoutMs = resolveAgentTimeoutMs({
      cfg,
      overrideMs: p.timeoutMs,
    });
    const workspaceSystemPrompt = await buildWorkspaceSystemPrompt(workspaceContext.workspaceId);
    const now = Date.now();
    const clientRunId = p.idempotencyKey;

    const sendPolicy = resolveSendPolicy({
      cfg,
      entry,
      sessionKey,
      channel: entry?.channel,
      chatType: entry?.chatType,
    });
    if (sendPolicy === "deny") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "send blocked by session policy"),
      );
      return;
    }

    if (stopCommand) {
      const res = abortChatRunsForSessionKey(
        {
          chatAbortControllers: context.chatAbortControllers,
          chatRunBuffers: context.chatRunBuffers,
          chatDeltaSentAt: context.chatDeltaSentAt,
          chatAbortedRuns: context.chatAbortedRuns,
          removeChatRun: context.removeChatRun,
          agentRunSeq: context.agentRunSeq,
          broadcast: context.broadcast,
          nodeSendToSession: context.nodeSendToSession,
        },
        { sessionKey: rawSessionKey, scopeKey, stopReason: "stop" },
      );
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }

    const cached = context.dedupe.get(`chat:${clientRunId}`);
    if (cached) {
      respond(cached.ok, cached.payload, cached.error, {
        cached: true,
      });
      return;
    }

    const activeExisting = context.chatAbortControllers.get(clientRunId);
    if (activeExisting) {
      respond(true, { runId: clientRunId, status: "in_flight" as const }, undefined, {
        cached: true,
        runId: clientRunId,
      });
      return;
    }

    try {
      const abortController = new AbortController();
      context.chatAbortControllers.set(clientRunId, {
        controller: abortController,
        sessionId: entry?.sessionId ?? clientRunId,
        sessionKey: rawSessionKey,
        scopeKey,
        startedAtMs: now,
        expiresAtMs: resolveChatRunExpiresAtMs({ now, timeoutMs }),
      });
      const ackPayload = {
        runId: clientRunId,
        status: "started" as const,
      };
      respond(true, ackPayload, undefined, { runId: clientRunId });

      const trimmedMessage = parsedMessage.trim();
      const injectThinking = Boolean(
        p.thinking && trimmedMessage && !trimmedMessage.startsWith("/"),
      );
      const commandBody = injectThinking ? `/think ${p.thinking} ${parsedMessage}` : parsedMessage;
      const clientInfo = client?.connect?.client;

      const effectiveCfg = cfg;
      // Inject timestamp so agents know the current date/time.
      // Only BodyForAgent gets the timestamp -- Body stays raw for UI display.
      // See: https://github.com/moltbot/moltbot/issues/3658
      const stampedMessage = injectTimestamp(parsedMessage, timestampOptsFromConfig(effectiveCfg));

      const ctx: MsgContext = {
        Body: parsedMessage,
        BodyForAgent: stampedMessage,
        BodyForCommands: commandBody,
        RawBody: parsedMessage,
        CommandBody: commandBody,
        SessionKey: sessionKey,
        Provider: INTERNAL_MESSAGE_CHANNEL,
        Surface: INTERNAL_MESSAGE_CHANNEL,
        OriginatingChannel: INTERNAL_MESSAGE_CHANNEL,
        ChatType: "direct",
        CommandAuthorized: true,
        MessageSid: clientRunId,
        SenderId: clientInfo?.id,
        SenderName: clientInfo?.displayName,
        SenderUsername: clientInfo?.displayName,
        GatewayClientScopes: client?.connect?.scopes,
        GroupSystemPrompt: workspaceSystemPrompt || undefined,
      };

      const agentId = resolveSessionAgentId({
        sessionKey,
        config: effectiveCfg,
      });
      const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
        cfg: effectiveCfg,
        agentId,
        channel: INTERNAL_MESSAGE_CHANNEL,
      });
      const verboseLevel = normalizeVerboseLevel(
        entry?.verboseLevel ?? effectiveCfg.agents?.defaults?.verboseDefault,
      );
      registerAgentRunContext(clientRunId, {
        sessionKey: rawSessionKey,
        scopeKey,
        verboseLevel,
      });
      const finalReplyParts: string[] = [];
      const dispatcher = createReplyDispatcher({
        ...prefixOptions,
        onError: (err) => {
          context.logGateway.warn(`webchat dispatch failed: ${formatForLog(err)}`);
        },
        deliver: async (payload, info) => {
          if (info.kind === "block") {
            const text = payload.text ?? "";
            if (!text) {
              return;
            }
            broadcastChatDelta({
              context,
              runId: clientRunId,
              sessionKey: rawSessionKey,
              scopeKey,
              text,
            });
            return;
          }
          if (info.kind !== "final") {
            return;
          }
          const text = payload.text?.trim() ?? "";
          if (!text) {
            return;
          }
          finalReplyParts.push(text);
        },
      });

      let agentRunStarted = false;
      let agentRunId: string | null = null;
      void dispatchInboundMessage({
        ctx,
        cfg: effectiveCfg,
        dispatcher,
        replyOptions: {
          runId: clientRunId,
          abortSignal: abortController.signal,
          images: parsedImages.length > 0 ? parsedImages : undefined,
          disableBlockStreaming: false,
          onAgentRunStart: (runId) => {
            agentRunStarted = true;
            agentRunId = runId;
            context.addChatRun(runId, {
              sessionKey: rawSessionKey,
              clientRunId,
              scopeKey,
            });
            registerAgentRunContext(runId, {
              sessionKey: rawSessionKey,
              scopeKey,
              verboseLevel,
            });
            const connId = typeof client?.connId === "string" ? client.connId : undefined;
            const wantsToolEvents = hasGatewayClientCap(
              client?.connect?.caps,
              GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
            );
            if (connId && wantsToolEvents) {
              context.registerToolEventRecipient(runId, connId);
            }
          },
          onModelSelected,
        },
      })
        .then(() => {
          context.chatAbortControllers.delete(clientRunId);
          const combinedReply =
            finalReplyParts
              .map((part) => part.trim())
              .filter(Boolean)
              .join("\n\n")
              .trim() ||
            (context.chatRunBuffers.get(clientRunId)?.trim() ?? "");
          if (combinedReply) {
            let message: Record<string, unknown> | undefined;
            const { storePath: latestStorePath, entry: latestEntry } = loadSessionEntryForConfig(
              effectiveCfg,
              sessionKey,
            );
            const sessionId = latestEntry?.sessionId ?? entry?.sessionId ?? clientRunId;
            const appended = appendAssistantTranscriptMessage({
              message: combinedReply,
              sessionId,
              storePath: latestStorePath,
              sessionFile: latestEntry?.sessionFile,
              createIfMissing: true,
            });
            if (appended.ok) {
              message = appended.message;
            } else {
              context.logGateway.warn(
                `webchat transcript append failed: ${appended.error ?? "unknown error"}`,
              );
              const now = Date.now();
              message = {
                role: "assistant",
                content: [{ type: "text", text: combinedReply }],
                timestamp: now,
                // Keep this compatible with Pi stopReason enums even though this message isn't
                // persisted to the transcript due to the append failure.
                stopReason: "stop",
                usage: { input: 0, output: 0, totalTokens: 0 },
              };
            }
            broadcastChatFinal({
              context,
              runId: clientRunId,
              sessionKey: rawSessionKey,
              scopeKey,
              message,
            });
          }
          if (agentRunStarted && agentRunId) {
            context.removeChatRun(agentRunId, clientRunId, rawSessionKey);
          }
          context.dedupe.set(`chat:${clientRunId}`, {
            ts: Date.now(),
            ok: true,
            payload: { runId: clientRunId, status: "ok" as const },
          });
        })
        .catch((err) => {
          context.chatAbortControllers.delete(clientRunId);
          if (agentRunStarted && agentRunId) {
            context.removeChatRun(agentRunId, clientRunId, rawSessionKey);
          }
          const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
          context.dedupe.set(`chat:${clientRunId}`, {
            ts: Date.now(),
            ok: false,
            payload: {
              runId: clientRunId,
              status: "error" as const,
              summary: String(err),
            },
            error,
          });
          broadcastChatError({
            context,
            runId: clientRunId,
            sessionKey: rawSessionKey,
            scopeKey,
            errorMessage: String(err),
          });
        });
    } catch (err) {
      const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
      const payload = {
        runId: clientRunId,
        status: "error" as const,
        summary: String(err),
      };
      context.dedupe.set(`chat:${clientRunId}`, {
        ts: Date.now(),
        ok: false,
        payload,
        error,
      });
      respond(false, payload, error, {
        runId: clientRunId,
        error: formatForLog(err),
      });
    }
  },
  "chat.inject": async ({ params, respond, context, client }) => {
    if (!validateChatInjectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.inject params: ${formatValidationErrors(validateChatInjectParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      sessionKey: string;
      message: string;
      label?: string;
    };

    // Load session to find transcript file
    const rawSessionKey = p.sessionKey;
    let workspaceContext: WorkspaceRequestContext;
    try {
      workspaceContext = await loadChatWorkspaceContext(client, params);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
      return;
    }
    const cfg = workspaceContext.cfg;
    const { storePath, entry } = loadSessionEntryForConfig(cfg, rawSessionKey);

    // Check workspace ownership for non-super-admin users
    if (!canAccessSession(rawSessionKey, workspaceContext)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `session "${rawSessionKey}" not found`),
      );
      return;
    }
    const sessionId = entry?.sessionId;
    if (!sessionId || !storePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session not found"));
      return;
    }

    const appended = appendAssistantTranscriptMessage({
      message: p.message,
      label: p.label,
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      createIfMissing: false,
    });
    if (!appended.ok || !appended.messageId || !appended.message) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to write transcript: ${appended.error ?? "unknown error"}`,
        ),
      );
      return;
    }

    // Broadcast to webchat for immediate UI update
    const chatPayload = {
      runId: `inject-${appended.messageId}`,
      sessionKey: rawSessionKey,
      seq: 0,
      state: "final" as const,
      message: appended.message,
    };
    context.broadcast("chat", chatPayload);
    context.nodeSendToSession(rawSessionKey, "chat", chatPayload);

    respond(true, { ok: true, messageId: appended.messageId });
  },
};
