import { describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import type { TemplateContext } from "../templating.js";
import type { GetReplyOptions } from "../types.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const runEmbeddedPiAgentMock = vi.fn();
const emitAgentEventMock = vi.fn();

vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: async ({
    provider,
    model,
    run,
  }: {
    provider: string;
    model: string;
    run: (provider: string, model: string) => Promise<unknown>;
  }) => ({
    result: await run(provider, model),
    provider,
    model,
  }),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
  runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
}));

vi.mock("../../infra/agent-events.js", () => ({
  emitAgentEvent: (evt: unknown) => emitAgentEventMock(evt),
  registerAgentRunContext: vi.fn(),
}));

vi.mock("./queue.js", async () => {
  const actual = await vi.importActual<typeof import("./queue.js")>("./queue.js");
  return {
    ...actual,
    enqueueFollowupRun: vi.fn(),
    scheduleFollowupDrain: vi.fn(),
  };
});

import { runReplyAgent } from "./agent-runner.js";

function createMinimalRun(params?: {
  opts?: GetReplyOptions;
  sessionStore?: Record<string, SessionEntry>;
  sessionEntry?: SessionEntry;
  sessionKey?: string;
  storePath?: string;
}) {
  const typing = createMockTypingController();
  const opts = params?.opts;
  const sessionCtx = {
    Provider: "whatsapp",
    MessageSid: "msg",
  } as unknown as TemplateContext;
  const resolvedQueue = { mode: "interrupt" } as unknown as QueueSettings;
  const sessionKey = params?.sessionKey ?? "main";
  const followupRun = {
    prompt: "hello",
    summaryLine: "hello",
    enqueuedAt: Date.now(),
    run: {
      sessionId: "session",
      sessionKey,
      messageProvider: "whatsapp",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      config: {},
      skillsSnapshot: {},
      provider: "anthropic",
      model: "claude",
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: {
        enabled: false,
        allowed: false,
        defaultLevel: "off",
      },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
    },
  } as unknown as FollowupRun;

  return {
    run: () =>
      runReplyAgent({
        commandBody: "hello",
        followupRun,
        queueKey: "main",
        resolvedQueue,
        shouldSteer: false,
        shouldFollowup: false,
        isActive: false,
        isStreaming: false,
        opts,
        typing,
        sessionEntry: params?.sessionEntry,
        sessionStore: params?.sessionStore,
        sessionKey,
        storePath: params?.storePath,
        sessionCtx,
        defaultModel: "anthropic/claude-opus-4-5",
        resolvedVerboseLevel: "off",
        isNewSession: false,
        blockStreamingEnabled: false,
        resolvedBlockStreamingBreak: "message_end",
        shouldInjectGroupIntro: false,
        typingMode: "instant",
      }),
  };
}

describe("runReplyAgent embedded lifecycle backstop", () => {
  it("emits terminal lifecycle error when embedded run aborts without one", async () => {
    emitAgentEventMock.mockReset();
    runEmbeddedPiAgentMock.mockReset();
    runEmbeddedPiAgentMock.mockImplementationOnce(async () => ({
      payloads: undefined,
      meta: { aborted: true },
    }));

    const { run } = createMinimalRun();
    await run();

    expect(emitAgentEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: "lifecycle",
        data: expect.objectContaining({
          phase: "error",
          error: "Embedded run aborted.",
        }),
      }),
    );
  });

  it("does not emit a duplicate lifecycle event when embedded run already reports one", async () => {
    emitAgentEventMock.mockReset();
    runEmbeddedPiAgentMock.mockReset();
    runEmbeddedPiAgentMock.mockImplementationOnce(async (params: {
      onAgentEvent?: (evt: { stream: string; data: Record<string, unknown> }) => Promise<void> | void;
    }) => {
      await params.onAgentEvent?.({ stream: "lifecycle", data: { phase: "end" } });
      return {
        payloads: [{ text: "ok" }],
        meta: {},
      };
    });

    const { run } = createMinimalRun();
    await run();

    expect(emitAgentEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        stream: "lifecycle",
      }),
    );
  });
});