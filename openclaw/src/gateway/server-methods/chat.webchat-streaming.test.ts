import "../test-helpers.mocks.js";
import { describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";
import { GATEWAY_CLIENT_CAPS } from "../protocol/client-info.js";

const dispatchInboundMessageMock = vi.hoisted(() => vi.fn());

vi.mock("../../auto-reply/dispatch.js", () => ({
  dispatchInboundMessage: dispatchInboundMessageMock,
}));

const { chatHandlers } = await import("./chat.js");

function createContext() {
  return {
    deps: {} as GatewayRequestHandlerOptions["context"]["deps"],
    cron: {} as GatewayRequestHandlerOptions["context"]["cron"],
    cronStorePath: "",
    loadGatewayModelCatalog: vi.fn(),
    getHealthCache: vi.fn(),
    refreshHealthSnapshot: vi.fn(),
    logHealth: { error: vi.fn() },
    logGateway: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    incrementPresenceVersion: vi.fn(),
    getHealthVersion: vi.fn(),
    broadcast: vi.fn(),
    broadcastToConnIds: vi.fn(),
    nodeSendToSession: vi.fn(),
    nodeSendToAllSubscribed: vi.fn(),
    nodeSubscribe: vi.fn(),
    nodeUnsubscribe: vi.fn(),
    nodeUnsubscribeAll: vi.fn(),
    hasConnectedMobileNode: vi.fn(),
    nodeRegistry: {} as GatewayRequestHandlerOptions["context"]["nodeRegistry"],
    agentRunSeq: new Map<string, number>(),
    chatAbortControllers: new Map<string, { controller: AbortController }>(),
    chatAbortedRuns: new Map<string, number>(),
    chatRunBuffers: new Map<string, string>(),
    chatDeltaSentAt: new Map<string, number>(),
    addChatRun: vi.fn(),
    removeChatRun: vi.fn(),
    registerToolEventRecipient: vi.fn(),
    dedupe: new Map<string, { ts: number; ok: boolean; payload?: unknown; error?: unknown }>(),
    wizardSessions: new Map(),
    findRunningWizard: vi.fn(),
    purgeWizardSession: vi.fn(),
    getRuntimeSnapshot: vi.fn(),
    startChannel: vi.fn(),
    stopChannel: vi.fn(),
    markChannelLoggedOut: vi.fn(),
    wizardRunner: vi.fn(),
    broadcastVoiceWakeChanged: vi.fn(),
  } as unknown as GatewayRequestHandlerOptions["context"];
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("chat.send webchat streaming", () => {
  it("registers the runtime run id, enables block streaming, broadcasts finals (deltas come via global agent events)", async () => {
    dispatchInboundMessageMock.mockReset();
    dispatchInboundMessageMock.mockImplementation(async ({ dispatcher, replyOptions }) => {
      replyOptions?.onAgentRunStart?.("agent-run-1");
      dispatcher.sendBlockReply({ text: "Chunk 1" });
      dispatcher.sendFinalReply({ text: "Final fallback" });
      await dispatcher.waitForIdle();
      return {};
    });

    const context = createContext();
    const respond = vi.fn();

    await chatHandlers["chat.send"]({
      req: { type: "req", id: "1", method: "chat.send", params: {} } as never,
      params: {
        sessionKey: "main",
        message: "hello",
        idempotencyKey: "idem-1",
      },
      client: {
        connect: { caps: [GATEWAY_CLIENT_CAPS.TOOL_EVENTS] },
        connId: "conn-1",
      } as never,
      isWebchatConnect: () => true,
      respond,
      context,
    });

    await flushAsyncWork();

    expect(dispatchInboundMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        replyOptions: expect.objectContaining({
          disableBlockStreaming: false,
        }),
      }),
    );
    expect(context.addChatRun).toHaveBeenCalledWith("agent-run-1", {
      sessionKey: "main",
      clientRunId: "idem-1",
      scopeKey: "global",
    });
    expect(context.registerToolEventRecipient).toHaveBeenCalledWith("agent-run-1", "conn-1");

    // Block replies should NOT produce chat deltas from the deliver callback.
    // Token-level deltas flow through the global emitAgentEvent → server-chat
    // createAgentEventHandler path instead, which avoids shared-buffer corruption.
    const chatDeltaBroadcast = vi
      .mocked(context.broadcast)
      .mock.calls.find((call) => call[0] === "chat" && (call[1] as { state?: string }).state === "delta");
    expect(chatDeltaBroadcast).toBeUndefined();

    const chatBroadcast = vi
      .mocked(context.broadcast)
      .mock.calls.find((call) => call[0] === "chat" && (call[1] as { state?: string }).state === "final");
    expect(chatBroadcast).toBeTruthy();
    expect(chatBroadcast?.[1]).toEqual(
      expect.objectContaining({
        runId: "idem-1",
        sessionKey: "main",
        state: "final",
        message: expect.objectContaining({
          role: "assistant",
          content: [{ type: "text", text: "Final fallback" }],
        }),
      }),
    );
  });
});