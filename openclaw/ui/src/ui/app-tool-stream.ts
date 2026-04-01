import { truncateText } from "./format.ts";
import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.js";

const TOOL_STREAM_LIMIT = 50;
const TOOL_STREAM_THROTTLE_MS = 80;
const TOOL_OUTPUT_CHAR_LIMIT = 120_000;

export type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: string;
  ts: number;
  sessionKey?: string;
  scopeKey?: string;
  data: Record<string, unknown>;
};

export type ToolStreamEntry = {
  toolCallId: string;
  runId: string;
  sessionKey?: string;
  name: string;
  args?: unknown;
  output?: string;
  startedAt: number;
  updatedAt: number;
  message: Record<string, unknown>;
};

type ToolStreamHost = {
  sessionKey: string;
  chatRunId: string | null;
  pmosWorkspaceId?: string;
  sessionsResult?: {
    sessions?: Array<{
      key?: string;
      activeRunId?: string;
      hasActiveRun?: boolean;
    }>;
  } | null;
  toolStreamById: Map<string, ToolStreamEntry>;
  toolStreamOrder: string[];
  chatToolMessages: Record<string, unknown>[];
  toolStreamSyncTimer: number | null;
};

function resolveCurrentActiveRunId(host: ToolStreamHost): string | null {
  if (host.chatRunId) {
    return host.chatRunId;
  }
  const currentSession = host.sessionsResult?.sessions?.find((row) => row.key === host.sessionKey);
  const remoteActiveRunId =
    typeof currentSession?.activeRunId === "string" ? currentSession.activeRunId.trim() : "";
  return remoteActiveRunId || null;
}

function resolveExpectedScopeKey(host: ToolStreamHost): string {
  const workspaceId = typeof host.pmosWorkspaceId === "string" ? host.pmosWorkspaceId.trim() : "";
  return workspaceId ? `workspace:${workspaceId}` : "global";
}

function matchesAgentEventScope(
  host: ToolStreamHost,
  payload?: Pick<AgentEventPayload, "runId" | "scopeKey" | "sessionKey">,
): boolean {
  const expectedScopeKey = resolveExpectedScopeKey(host);
  const actualScopeKey = typeof payload?.scopeKey === "string" ? payload.scopeKey.trim() : "";
  if (actualScopeKey) {
    return actualScopeKey === expectedScopeKey;
  }
  if (expectedScopeKey === "global") {
    return true;
  }
  const sessionKey = typeof payload?.sessionKey === "string" ? payload.sessionKey.trim() : "";
  if (sessionKey && isRelatedAgentSessionKey(host.sessionKey, sessionKey)) {
    return true;
  }
  const activeRunId = resolveCurrentActiveRunId(host);
  return Boolean(payload?.runId && activeRunId && payload.runId === activeRunId);
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

function extractToolOutputText(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  const content = record.content;
  if (!Array.isArray(content)) {
    return null;
  }
  const parts = content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const entry = item as Record<string, unknown>;
      if (entry.type === "text" && typeof entry.text === "string") {
        return entry.text;
      }
      return null;
    })
    .filter((part): part is string => Boolean(part));
  if (parts.length === 0) {
    return null;
  }
  return parts.join("\n");
}

function formatToolOutput(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const contentText = extractToolOutputText(value);
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (contentText) {
    text = contentText;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      // oxlint-disable typescript/no-base-to-string
      text = String(value);
    }
  }
  const truncated = truncateText(text, TOOL_OUTPUT_CHAR_LIMIT);
  if (!truncated.truncated) {
    return truncated.text;
  }
  return `${truncated.text}\n\n… truncated (${truncated.total} chars, showing first ${truncated.text.length}).`;
}

function buildToolStreamMessage(entry: ToolStreamEntry): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  content.push({
    type: "toolcall",
    name: entry.name,
    arguments: entry.args ?? {},
  });
  if (entry.output) {
    content.push({
      type: "toolresult",
      name: entry.name,
      text: entry.output,
    });
  }
  return {
    role: "assistant",
    toolCallId: entry.toolCallId,
    runId: entry.runId,
    content,
    timestamp: entry.startedAt,
  };
}

function trimToolStream(host: ToolStreamHost) {
  if (host.toolStreamOrder.length <= TOOL_STREAM_LIMIT) {
    return;
  }
  const overflow = host.toolStreamOrder.length - TOOL_STREAM_LIMIT;
  const removed = host.toolStreamOrder.splice(0, overflow);
  for (const id of removed) {
    host.toolStreamById.delete(id);
  }
}

function syncToolStreamMessages(host: ToolStreamHost) {
  host.chatToolMessages = host.toolStreamOrder
    .map((id) => host.toolStreamById.get(id)?.message)
    .filter((msg): msg is Record<string, unknown> => Boolean(msg));
}

export function flushToolStreamSync(host: ToolStreamHost) {
  if (host.toolStreamSyncTimer != null) {
    clearTimeout(host.toolStreamSyncTimer);
    host.toolStreamSyncTimer = null;
  }
  syncToolStreamMessages(host);
}

export function scheduleToolStreamSync(host: ToolStreamHost, force = false) {
  if (force) {
    flushToolStreamSync(host);
    return;
  }
  if (host.toolStreamSyncTimer != null) {
    return;
  }
  host.toolStreamSyncTimer = window.setTimeout(
    () => flushToolStreamSync(host),
    TOOL_STREAM_THROTTLE_MS,
  );
}

export function resetToolStream(host: ToolStreamHost) {
  host.toolStreamById.clear();
  host.toolStreamOrder = [];
  host.chatToolMessages = [];
  flushToolStreamSync(host);
}

export type CompactionStatus = {
  active: boolean;
  startedAt: number | null;
  completedAt: number | null;
};

type CompactionHost = ToolStreamHost & {
  compactionStatus?: CompactionStatus | null;
  compactionClearTimer?: number | null;
};

const COMPACTION_TOAST_DURATION_MS = 5000;

export function handleCompactionEvent(host: CompactionHost, payload: AgentEventPayload) {
  const data = payload.data ?? {};
  const phase = typeof data.phase === "string" ? data.phase : "";
  const willRetry = Boolean(data.willRetry);

  // Clear any existing timer
  if (host.compactionClearTimer != null) {
    window.clearTimeout(host.compactionClearTimer);
    host.compactionClearTimer = null;
  }

  if (phase === "start") {
    host.compactionStatus = {
      active: true,
      startedAt: Date.now(),
      completedAt: null,
    };
  } else if (phase === "end") {
    if (willRetry) {
      // Another compaction cycle is imminent — keep the active indicator
      // so the UI doesn't briefly flash "Context compacted" then restart.
      host.compactionStatus = {
        active: true,
        startedAt: host.compactionStatus?.startedAt ?? Date.now(),
        completedAt: null,
      };
    } else {
      host.compactionStatus = {
        active: false,
        startedAt: host.compactionStatus?.startedAt ?? null,
        completedAt: Date.now(),
      };
      // Auto-clear the toast after duration
      host.compactionClearTimer = window.setTimeout(() => {
        host.compactionStatus = null;
        host.compactionClearTimer = null;
      }, COMPACTION_TOAST_DURATION_MS);
    }
  }
}

export function handleAgentEvent(host: ToolStreamHost, payload?: AgentEventPayload) {
  if (!payload) {
    return;
  }
  if (!matchesAgentEventScope(host, payload)) {
    return;
  }

  // Handle compaction events
  if (payload.stream === "compaction") {
    handleCompactionEvent(host as CompactionHost, payload);
    return;
  }

  if (payload.stream !== "tool") {
    return;
  }
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : undefined;
  if (sessionKey && !isRelatedAgentSessionKey(host.sessionKey, sessionKey)) {
    return;
  }
  const activeRunId = resolveCurrentActiveRunId(host);
  // Fallback: only accept session-less events for the active run.
  if (!sessionKey && activeRunId && payload.runId !== activeRunId) {
    return;
  }
  if (!sessionKey && activeRunId && payload.runId !== activeRunId) {
    return;
  }
  if (!activeRunId) {
    return;
  }

  const data = payload.data ?? {};
  const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
  if (!toolCallId) {
    return;
  }
  const name = typeof data.name === "string" ? data.name : "tool";
  const phase = typeof data.phase === "string" ? data.phase : "";
  const args = phase === "start" ? data.args : undefined;
  const output =
    phase === "update"
      ? formatToolOutput(data.partialResult)
      : phase === "result"
        ? formatToolOutput(data.result)
        : undefined;

  const now = Date.now();
  let entry = host.toolStreamById.get(toolCallId);
  if (!entry) {
    entry = {
      toolCallId,
      runId: payload.runId,
      sessionKey,
      name,
      args,
      output: output || undefined,
      startedAt: typeof payload.ts === "number" ? payload.ts : now,
      updatedAt: now,
      message: {},
    };
    host.toolStreamById.set(toolCallId, entry);
    host.toolStreamOrder.push(toolCallId);
  } else {
    entry.name = name;
    if (args !== undefined) {
      entry.args = args;
    }
    if (output !== undefined) {
      entry.output = output || undefined;
    }
    entry.updatedAt = now;
  }

  entry.message = buildToolStreamMessage(entry);
  trimToolStream(host);
  scheduleToolStreamSync(host, phase === "result");
}
