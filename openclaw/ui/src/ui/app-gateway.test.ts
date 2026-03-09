import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayClientInstances: MockGatewayBrowserClient[] = [];

class MockGatewayBrowserClient {
  public stopped = false;

  constructor(
    public opts: {
      onClose?: (info: { code: number; reason: string }) => void;
      onEvent?: (evt: unknown) => void;
      onGap?: (info: { expected: number; received: number }) => void;
      onHello?: (hello: unknown) => void;
    },
  ) {
    gatewayClientInstances.push(this);
  }

  start() {}

  stop() {
    this.stopped = true;
  }
}

vi.mock("./gateway.ts", () => ({
  GatewayBrowserClient: MockGatewayBrowserClient,
}));

vi.mock("./controllers/agents.ts", () => ({
  loadAgents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./controllers/assistant-identity.ts", () => ({
  loadAssistantIdentity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./controllers/chat.ts", () => ({
  loadChatHistory: vi.fn().mockResolvedValue(undefined),
  handleChatEvent: vi.fn(),
  extractText: vi.fn((message: { message?: { content?: Array<{ text?: string }> }; content?: Array<{ text?: string }> }) => {
    const content = message?.message?.content ?? message?.content ?? [];
    const parts = Array.isArray(content)
      ? content
          .map((entry) => (typeof entry?.text === "string" ? entry.text : null))
          .filter((entry): entry is string => Boolean(entry))
      : [];
    return parts.join("\n");
  }),
  extractThinking: vi.fn(
    (message: { message?: { content?: Array<{ thinking?: string }> }; content?: Array<{ thinking?: string }> }) => {
      const content = message?.message?.content ?? message?.content ?? [];
      const parts = Array.isArray(content)
        ? content
            .map((entry) => (typeof entry?.thinking === "string" ? entry.thinking : null))
            .filter((entry): entry is string => Boolean(entry))
        : [];
      return parts.join("\n");
    },
  ),
}));

vi.mock("./controllers/devices.ts", () => ({
  loadDevices: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./controllers/nodes.ts", () => ({
  loadNodes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./controllers/sessions.ts", () => ({
  loadSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./app-chat.ts", () => ({
  CHAT_SESSIONS_ACTIVE_MINUTES: 30,
  flushChatQueueForEvent: vi.fn(),
}));

vi.mock("./app-scroll.ts", () => ({
  scheduleChatScroll: vi.fn(),
}));

vi.mock("./app-tool-stream.ts", () => ({
  handleAgentEvent: vi.fn(),
  resetToolStream: vi.fn(),
}));

vi.mock("./app-settings.ts", () => ({
  applySettings: vi.fn(),
  loadCron: vi.fn(),
  refreshActiveTab: vi.fn(),
  setLastActiveSessionKey: vi.fn(),
}));

vi.mock("./controllers/exec-approval.ts", () => ({
  addExecApproval: vi.fn(),
  parseExecApprovalRequested: vi.fn(),
  parseExecApprovalResolved: vi.fn(),
  removeExecApproval: vi.fn(),
}));

vi.mock("./controllers/pmos-trace.ts", () => ({
  appendPmosTraceEvent: vi.fn(),
  summarizeTraceValue: vi.fn(() => ""),
}));

const { connectGateway, handleGatewayEvent } = await import("./app-gateway.ts");
const { handleChatEvent } = await import("./controllers/chat.ts");

describe("connectGateway", () => {
  beforeEach(() => {
    gatewayClientInstances.length = 0;
  });

  it("ignores close callbacks from stale gateway clients", () => {
    const host = {
      settings: { gatewayUrl: "wss://example.test", token: "", lastActiveSessionKey: "main" },
      password: "",
      client: null,
      connected: false,
      hello: null,
      lastError: null,
      onboarding: false,
      eventLogBuffer: [],
      eventLog: [],
      tab: "dashboard",
      presenceEntries: [],
      presenceError: null,
      presenceStatus: null,
      agentsLoading: false,
      agentsList: null,
      agentsError: null,
      debugHealth: null,
      assistantName: "",
      assistantAvatar: null,
      assistantAgentId: null,
      sessionKey: "main",
      chatRunId: null,
      refreshSessionsAfterChat: new Set<string>(),
      pmosTraceEvents: [],
      execApprovalQueue: [],
      execApprovalError: null,
      pmosAuthUser: { role: "workspace_admin" },
      handlePmosRefreshConnectors: vi.fn(),
    } as any;

    connectGateway(host);
    const first = gatewayClientInstances[0];
    expect(first).toBeTruthy();

    connectGateway(host);
    const second = gatewayClientInstances[1];
    expect(second).toBeTruthy();
    expect(first.stopped).toBe(true);

    host.connected = true;
    first.opts.onClose?.({ code: 1006, reason: "stale" });
    expect(host.connected).toBe(true);
    expect(host.lastError).toBeNull();

    second.opts.onClose?.({ code: 1006, reason: "active" });
    expect(host.connected).toBe(false);
    expect(host.lastError).toContain("active");
  });

  it("processes all queued chat deltas in a single animation frame", () => {
    const originalRaf = globalThis.requestAnimationFrame;
    let queuedFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queuedFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const host = {
      settings: { gatewayUrl: "wss://example.test", token: "", lastActiveSessionKey: "main" },
      password: "",
      client: null,
      connected: true,
      hello: null,
      lastError: null,
      onboarding: false,
      eventLogBuffer: [],
      eventLog: [],
      tab: "dashboard",
      presenceEntries: [],
      presenceError: null,
      presenceStatus: null,
      agentsLoading: false,
      agentsList: null,
      agentsError: null,
      debugHealth: null,
      assistantName: "",
      assistantAvatar: null,
      assistantAgentId: null,
      sessionKey: "main",
      chatRunId: "run-1",
      refreshSessionsAfterChat: new Set<string>(),
      pmosTraceEvents: [],
      execApprovalQueue: [],
      execApprovalError: null,
    } as any;

    handleGatewayEvent(host, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: "main",
        state: "delta",
        message: { role: "assistant", content: [{ type: "thinking", thinking: "step 1" }] },
      },
    });
    handleGatewayEvent(host, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: "main",
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
      },
    });

    queuedFrame?.(0);
    expect(vi.mocked(handleChatEvent)).toHaveBeenCalledTimes(2);
    vi.stubGlobal("requestAnimationFrame", originalRaf);
  });
});
