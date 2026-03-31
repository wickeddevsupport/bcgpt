import { onAgentEvent } from "../../infra/agent-events.js";

const AGENT_RUN_CACHE_TTL_MS = 10 * 60_000;
const AGENT_RUN_RESULT_GRACE_MS = 100;
const agentRunCache = new Map<string, AgentRunSnapshot>();
const agentRunStarts = new Map<string, number>();
let agentRunListenerStarted = false;

type AgentRunSnapshot = {
  runId: string;
  status?: "ok" | "error";
  startedAt?: number;
  endedAt?: number;
  error?: string;
  terminalAt?: number;
  resultReady?: boolean;
  reply?: string;
  replyDisposition?: "reply" | "no_reply" | "sent_via_messaging_tool" | "unavailable";
  sessionId?: string;
  sessionFile?: string;
  transcriptStatus?: "ready" | "missing";
  didSendViaMessagingTool?: boolean;
  messagingToolSentTexts?: string[];
  ts: number;
};

function pruneAgentRunCache(now = Date.now()) {
  for (const [runId, entry] of agentRunCache) {
    if (now - entry.ts > AGENT_RUN_CACHE_TTL_MS) {
      agentRunCache.delete(runId);
    }
  }
}

function recordAgentRunSnapshot(entry: AgentRunSnapshot) {
  pruneAgentRunCache(entry.ts);
  agentRunCache.set(entry.runId, entry);
}

function mergeAgentRunSnapshot(runId: string, patch: Partial<AgentRunSnapshot>) {
  const current = agentRunCache.get(runId);
  const next: AgentRunSnapshot = {
    runId,
    ...(current ?? { ts: Date.now() }),
    ...patch,
    ts: patch.ts ?? Date.now(),
  };
  recordAgentRunSnapshot(next);
  return next;
}

function canResolveAgentRun(entry: AgentRunSnapshot, now = Date.now()) {
  if (entry.status === "error") {
    return true;
  }
  if (entry.status !== "ok") {
    return false;
  }
  if (entry.resultReady) {
    return true;
  }
  return typeof entry.terminalAt === "number" && now - entry.terminalAt >= AGENT_RUN_RESULT_GRACE_MS;
}

function ensureAgentRunListener() {
  if (agentRunListenerStarted) {
    return;
  }
  agentRunListenerStarted = true;
  onAgentEvent((evt) => {
    if (!evt) {
      return;
    }
    if (evt.stream === "result") {
      const reply =
        typeof evt.data?.reply === "string" && evt.data.reply.trim()
          ? evt.data.reply.trim()
          : undefined;
      const replyDispositionRaw = evt.data?.replyDisposition;
      const replyDisposition =
        replyDispositionRaw === "reply" ||
        replyDispositionRaw === "no_reply" ||
        replyDispositionRaw === "sent_via_messaging_tool" ||
        replyDispositionRaw === "unavailable"
          ? replyDispositionRaw
          : undefined;
      const transcriptStatusRaw = evt.data?.transcriptStatus;
      const transcriptStatus =
        transcriptStatusRaw === "ready" || transcriptStatusRaw === "missing"
          ? transcriptStatusRaw
          : undefined;
      const messagingToolSentTexts = Array.isArray(evt.data?.messagingToolSentTexts)
        ? evt.data.messagingToolSentTexts.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
          )
        : undefined;
      mergeAgentRunSnapshot(evt.runId, {
        status: "ok",
        resultReady: true,
        reply,
        replyDisposition,
        sessionId: typeof evt.data?.sessionId === "string" ? evt.data.sessionId : undefined,
        sessionFile: typeof evt.data?.sessionFile === "string" ? evt.data.sessionFile : undefined,
        transcriptStatus,
        didSendViaMessagingTool:
          typeof evt.data?.didSendViaMessagingTool === "boolean"
            ? evt.data.didSendViaMessagingTool
            : undefined,
        messagingToolSentTexts,
        ts: Date.now(),
      });
      return;
    }
    if (evt.stream !== "lifecycle") {
      return;
    }
    const phase = evt.data?.phase;
    if (phase === "start") {
      const startedAt = typeof evt.data?.startedAt === "number" ? evt.data.startedAt : undefined;
      agentRunStarts.set(evt.runId, startedAt ?? Date.now());
      return;
    }
    if (phase !== "end" && phase !== "error") {
      return;
    }
    const startedAt =
      typeof evt.data?.startedAt === "number" ? evt.data.startedAt : agentRunStarts.get(evt.runId);
    const endedAt = typeof evt.data?.endedAt === "number" ? evt.data.endedAt : undefined;
    const error = typeof evt.data?.error === "string" ? evt.data.error : undefined;
    agentRunStarts.delete(evt.runId);
    mergeAgentRunSnapshot(evt.runId, {
      status: phase === "error" ? "error" : "ok",
      startedAt,
      endedAt,
      error,
      terminalAt: Date.now(),
      ts: Date.now(),
    });
  });
}

function getCachedAgentRun(runId: string) {
  pruneAgentRunCache();
  return agentRunCache.get(runId);
}

export async function waitForAgentJob(params: {
  runId: string;
  timeoutMs: number;
}): Promise<AgentRunSnapshot | null> {
  const { runId, timeoutMs } = params;
  ensureAgentRunListener();
  const cached = getCachedAgentRun(runId);
  if (cached && canResolveAgentRun(cached)) {
    return cached;
  }
  if (timeoutMs <= 0) {
    return cached ?? null;
  }

  return await new Promise((resolve) => {
    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const deadlineAt = Date.now() + timeoutMs;
    const finish = (entry: AgentRunSnapshot | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (graceTimer) {
        clearTimeout(graceTimer);
      }
      unsubscribe();
      resolve(entry);
    };
    const scheduleGraceFinish = (entry: AgentRunSnapshot) => {
      if (entry.status !== "ok" || entry.resultReady || typeof entry.terminalAt !== "number") {
        return;
      }
      const remainingToGrace = Math.max(0, AGENT_RUN_RESULT_GRACE_MS - (Date.now() - entry.terminalAt));
      const remainingToDeadline = Math.max(0, deadlineAt - Date.now());
      const waitMs = Math.min(remainingToGrace, remainingToDeadline);
      if (waitMs <= 0) {
        finish(getCachedAgentRun(runId) ?? entry);
        return;
      }
      if (graceTimer) {
        clearTimeout(graceTimer);
      }
      graceTimer = setTimeout(() => finish(getCachedAgentRun(runId) ?? entry), waitMs);
    };
    const unsubscribe = onAgentEvent((evt) => {
      if (!evt || (evt.stream !== "lifecycle" && evt.stream !== "result")) {
        return;
      }
      if (evt.runId !== runId) {
        return;
      }
      const cached = getCachedAgentRun(runId);
      if (cached && canResolveAgentRun(cached)) {
        finish(cached);
        return;
      }
      if (cached) {
        scheduleGraceFinish(cached);
      }
    });
    const timerDelayMs = Math.max(1, Math.min(Math.floor(timeoutMs), 2_147_483_647));
    const timer = setTimeout(() => finish(getCachedAgentRun(runId) ?? null), timerDelayMs);
  });
}

ensureAgentRunListener();
