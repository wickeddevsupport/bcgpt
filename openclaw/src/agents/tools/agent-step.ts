import crypto from "node:crypto";
import type { OpenClawConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import { AGENT_LANE_NESTED } from "../lanes.js";
import {
  extractAssistantText,
  stripToolMessages,
  withWorkspaceScope,
} from "./sessions-helpers.js";

export async function readLatestAssistantReply(params: {
  sessionKey: string;
  limit?: number;
  config?: OpenClawConfig;
  workspaceId?: string;
}): Promise<string | undefined> {
  const history = await callGateway<{ messages: Array<unknown> }>({
    config: params.config,
    method: "chat.history",
    params: withWorkspaceScope(
      { sessionKey: params.sessionKey, limit: params.limit ?? 50 },
      params.workspaceId,
    ),
  });
  const filtered = stripToolMessages(Array.isArray(history?.messages) ? history.messages : []);
  const last = filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
  return last ? extractAssistantText(last) : undefined;
}

export async function runAgentStep(params: {
  sessionKey: string;
  message: string;
  extraSystemPrompt: string;
  timeoutMs: number;
  channel?: string;
  lane?: string;
  config?: OpenClawConfig;
  workspaceId?: string;
}): Promise<string | undefined> {
  const stepIdem = crypto.randomUUID();
  const response = await callGateway<{ runId?: string }>({
    config: params.config,
    method: "agent",
    params: withWorkspaceScope({
      message: params.message,
      sessionKey: params.sessionKey,
      idempotencyKey: stepIdem,
      deliver: false,
      channel: params.channel ?? INTERNAL_MESSAGE_CHANNEL,
      lane: params.lane ?? AGENT_LANE_NESTED,
      extraSystemPrompt: params.extraSystemPrompt,
    }, params.workspaceId),
    timeoutMs: 10_000,
  });

  const stepRunId = typeof response?.runId === "string" && response.runId ? response.runId : "";
  const resolvedRunId = stepRunId || stepIdem;
  const stepWaitMs = Math.min(params.timeoutMs, 60_000);
  const wait = await callGateway<{ status?: string }>({
    method: "agent.wait",
    params: {
      runId: resolvedRunId,
      timeoutMs: stepWaitMs,
    },
    timeoutMs: stepWaitMs + 2000,
  });
  if (wait?.status !== "ok") {
    return undefined;
  }
  return await readLatestAssistantReply({
    sessionKey: params.sessionKey,
    config: params.config,
    workspaceId: params.workspaceId,
  });
}
