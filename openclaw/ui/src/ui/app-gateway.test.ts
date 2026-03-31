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
const { handleChatEvent, loadChatHistory } = await import("./controllers/chat.ts");
const { flushChatQueueForEvent } = await import("./app-chat.ts");

describe("connectGateway", () => {
  beforeEach(() => {
    gatewayClientInstances.length = 0;
    vi.clearAllMocks();
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

  it("recovers chat history over HTTP when the websocket closes during an active run", async () => {
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
      chatRunId: "run-1",
      chatStreamStartedAt: null,
      refreshSessionsAfterChat: new Set<string>(),
      pmosTraceEvents: [],
      execApprovalQueue: [],
      execApprovalError: null,
      pmosAuthUser: { role: "workspace_admin" },
      handlePmosRefreshConnectors: vi.fn(),
    } as any;

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeTruthy();

    client.opts.onClose?.({ code: 1001, reason: "socket dropped" });
    await Promise.resolve();

    expect(host.connected).toBe(false);
    expect(host.lastError).toContain("socket dropped");
    expect(host.chatStreamStartedAt).toBeNull();
    expect(vi.mocked(loadChatHistory)).not.toHaveBeenCalled();
  });

  it("clears stale local run state when the gateway reconnects", async () => {
    const host = {
      settings: { gatewayUrl: "wss://example.test", token: "", lastActiveSessionKey: "main" },
      password: "",
      client: null,
      connected: false,
      hello: null,
      lastError: "old error",
      onboarding: false,
      eventLogBuffer: [],
      eventLog: [],
      tab: "chat",
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
      chatStream: "partial reply",
      chatStreamStartedAt: Date.now() - 1_000,
      refreshSessionsAfterChat: new Set<string>(),
      pmosTraceEvents: [],
      execApprovalQueue: [],
      execApprovalError: null,
      pmosAuthUser: { role: "workspace_admin" },
      handlePmosRefreshConnectors: vi.fn(),
    } as any;

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeTruthy();

    await client.opts.onHello?.({ snapshot: {} });

    expect(host.connected).toBe(true);
    expect(host.lastError).toBeNull();
    expect(host.chatRunId).toBeNull();
    expect(host.chatStream).toBeNull();
    expect(host.chatStreamStartedAt).toBeNull();
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

  it("reloads history before flushing the queued next message when a final has no assistant content", async () => {
    vi.mocked(handleChatEvent).mockImplementation((state: unknown) => {
      (state as { chatStream: string | null }).chatStream = null;
      (state as { chatRunId: string | null }).chatRunId = null;
      return "final";
    });

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
      chatQueue: [{ id: "q1", text: "queued", createdAt: Date.now() }],
      refreshSessionsAfterChat: new Set<string>(),
      pmosTraceEvents: [],
      execApprovalQueue: [],
      execApprovalError: null,
      chatMessages: [],
    } as any;

    handleGatewayEvent(host, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: "main",
        state: "final",
      },
    });

    await Promise.resolve();

    expect(vi.mocked(loadChatHistory)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(flushChatQueueForEvent)).toHaveBeenCalledTimes(1);
  });

  it("skips history reload when final already includes the assistant reply", async () => {
    vi.mocked(handleChatEvent).mockImplementation((state: unknown) => {
      (state as { chatRunId: string | null }).chatRunId = null;
      (state as { chatMessages: unknown[] }).chatMessages = [
        {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      ];
      return "final";
    });

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
      tab: "chat",
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
      chatQueue: [{ id: "q1", text: "queued", createdAt: Date.now() }],
      refreshSessionsAfterChat: new Set<string>(),
      pmosTraceEvents: [],
      execApprovalQueue: [],
      execApprovalError: null,
      chatMessages: [],
      chatStream: null,
      notificationsOpen: false,
      toolStreamOrder: [],
    } as any;

    handleGatewayEvent(host, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    expect(vi.mocked(loadChatHistory)).not.toHaveBeenCalled();
    expect(vi.mocked(flushChatQueueForEvent)).toHaveBeenCalledTimes(1);
  });

  it("reloads history when a final arrives without assistant content or live stream text", async () => {
    vi.mocked(handleChatEvent).mockImplementation((state: unknown) => {
      (state as { chatRunId: string | null }).chatRunId = null;
      return "final";
    });

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
      tab: "chat",
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
      chatQueue: [],
      refreshSessionsAfterChat: new Set<string>(),
      pmosTraceEvents: [],
      execApprovalQueue: [],
      execApprovalError: null,
      chatMessages: [],
      chatStream: null,
      notificationsOpen: false,
      toolStreamOrder: [],
    } as any;

    handleGatewayEvent(host, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: "main",
        state: "final",
      },
    });

    await Promise.resolve();

    expect(vi.mocked(loadChatHistory)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(flushChatQueueForEvent)).toHaveBeenCalledTimes(1);
  });

  it("promotes live tool messages into chat history and skips reload on normal finals", () => {
    vi.mocked(handleChatEvent).mockImplementation((state: unknown) => {
      const host = state as { chatRunId: string | null; chatMessages: unknown[] };
      host.chatMessages = [
        ...host.chatMessages,
        {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      ];
      host.chatRunId = null;
      return "final";
    });

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
      tab: "chat",
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
      chatQueue: [],
      refreshSessionsAfterChat: new Set<string>(),
      pmosTraceEvents: [],
      execApprovalQueue: [],
      execApprovalError: null,
      chatMessages: [],
      chatToolMessages: [
        {
          role: "assistant",
          toolCallId: "tool-1",
          content: [
            { type: "toolcall", name: "web_search", arguments: { query: "status" } },
            { type: "toolresult", name: "web_search", text: "Search complete" },
          ],
          timestamp: Date.now(),
        },
      ],
      chatStream: null,
      notificationsOpen: false,
      toolStreamOrder: ["tool-1"],
    } as any;

    handleGatewayEvent(host, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: "main",
        state: "final",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done" }],
        },
      },
    });

    expect(vi.mocked(loadChatHistory)).not.toHaveBeenCalled();
    expect(host.chatMessages).toHaveLength(2);
    expect((host.chatMessages[0] as { toolCallId?: string }).toolCallId).toBe("tool-1");
    expect((host.chatMessages[1] as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(
      "Done",
    );
    expect(vi.mocked(flushChatQueueForEvent)).toHaveBeenCalledTimes(1);
  });

  it("clears a stale session active run marker on terminal chat events", () => {
    vi.mocked(handleChatEvent).mockImplementation((state: unknown) => {
      (state as { chatRunId: string | null }).chatRunId = null;
      return "final";
    });

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
      tab: "chat",
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
      chatQueue: [],
      refreshSessionsAfterChat: new Set<string>(),
      pmosTraceEvents: [],
      execApprovalQueue: [],
      execApprovalError: null,
      chatMessages: [],
      chatStream: null,
      notificationsOpen: false,
      toolStreamOrder: [],
      sessionsResult: {
        ts: 0,
        path: "",
        count: 1,
        defaults: {},
        sessions: [{ key: "main", kind: "direct", updatedAt: null, hasActiveRun: true, activeRunId: "run-1" }],
      },
    } as any;

    handleGatewayEvent(host, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: "main",
        state: "final",
      },
    });

    expect(host.sessionsResult.sessions[0]?.hasActiveRun).toBe(false);
    expect(host.sessionsResult.sessions[0]?.activeRunId).toBeUndefined();
  });

  it("clears a stale session active run marker by run id when terminal chat events omit sessionKey", () => {
    vi.mocked(handleChatEvent).mockImplementation((state: unknown) => {
      (state as { chatRunId: string | null }).chatRunId = null;
      return "final";
    });

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
      tab: "chat",
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
      chatQueue: [],
      refreshSessionsAfterChat: new Set<string>(),
      pmosTraceEvents: [],
      execApprovalQueue: [],
      execApprovalError: null,
      chatMessages: [],
      chatStream: null,
      notificationsOpen: false,
      toolStreamOrder: [],
      sessionsResult: {
        ts: 0,
        path: "",
        count: 1,
        defaults: {},
        sessions: [{ key: "main", kind: "direct", updatedAt: null, hasActiveRun: true, activeRunId: "run-1" }],
      },
    } as any;

    handleGatewayEvent(host, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        state: "final",
      },
    } as any);

    expect(host.sessionsResult.sessions[0]?.hasActiveRun).toBe(false);
    expect(host.sessionsResult.sessions[0]?.activeRunId).toBeUndefined();
  });

  it("clears stale compaction state on terminal chat events", () => {
    vi.mocked(handleChatEvent).mockImplementation((state: unknown) => {
      (state as { chatRunId: string | null }).chatRunId = null;
      return "final";
    });

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
      tab: "chat",
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
      chatQueue: [],
      refreshSessionsAfterChat: new Set<string>(),
      pmosTraceEvents: [],
      execApprovalQueue: [],
      execApprovalError: null,
      chatMessages: [],
      chatStream: null,
      notificationsOpen: false,
      toolStreamOrder: [],
      compactionStatus: { active: true, startedAt: Date.now(), completedAt: null },
      compactionClearTimer: 123,
      sessionsResult: {
        ts: 0,
        path: "",
        count: 1,
        defaults: {},
        sessions: [{ key: "main", kind: "direct", updatedAt: null, hasActiveRun: true, activeRunId: "run-1" }],
      },
    } as any;

    handleGatewayEvent(host, {
      type: "event",
      event: "chat",
      payload: {
        runId: "run-1",
        sessionKey: "main",
        state: "final",
      },
    });

    expect(host.compactionStatus).toBeNull();
    expect(host.compactionClearTimer).toBeNull();
  });

  it("clears a recovered compaction-only active run when compaction ends", () => {
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
      tab: "chat",
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
      chatQueue: [],
      refreshSessionsAfterChat: new Set<string>(),
      pmosTraceEvents: [],
      execApprovalQueue: [],
      execApprovalError: null,
      chatMessages: [],
      chatStream: null,
      notificationsOpen: false,
      toolStreamOrder: [],
      sessionsResult: {
        ts: 0,
        path: "",
        count: 1,
        defaults: {},
        sessions: [{ key: "main", kind: "direct", updatedAt: null, hasActiveRun: true, activeRunId: "run-1" }],
      },
    } as any;

    handleGatewayEvent(host, {
      type: "event",
      event: "agent",
      payload: {
        runId: "run-1",
        sessionKey: "main",
        stream: "compaction",
        data: { phase: "end" },
      },
    });

    expect(host.sessionsResult.sessions[0]?.hasActiveRun).toBe(false);
    expect(host.sessionsResult.sessions[0]?.activeRunId).toBeUndefined();
  });
});
