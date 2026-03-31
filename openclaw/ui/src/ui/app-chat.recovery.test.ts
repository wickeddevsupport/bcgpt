import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadChatHistoryMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const sendChatMessageMock = vi.hoisted(() =>
  vi.fn(async (state: { chatRunId: string | null; chatStream: string | null; chatStreamStartedAt: number | null }) => {
    state.chatRunId = "run-1";
    state.chatStream = "";
    state.chatStreamStartedAt = Date.now();
    return "run-1";
  }),
);
const loadSessionsMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const setLastActiveSessionKeyMock = vi.hoisted(() => vi.fn());
const resetToolStreamMock = vi.hoisted(() => vi.fn());
const resetChatScrollMock = vi.hoisted(() => vi.fn());
const scheduleChatScrollMock = vi.hoisted(() => vi.fn());

vi.mock("./controllers/chat.ts", () => ({
  abortChatRun: vi.fn(),
  finalizeChatRunFromWait: vi.fn(() => false),
  loadChatHistory: loadChatHistoryMock,
  sendChatMessage: sendChatMessageMock,
}));

vi.mock("./controllers/sessions.ts", () => ({
  loadSessions: loadSessionsMock,
}));

vi.mock("./app-settings.ts", () => ({
  setLastActiveSessionKey: setLastActiveSessionKeyMock,
}));

vi.mock("./app-tool-stream.ts", () => ({
  resetToolStream: resetToolStreamMock,
}));

vi.mock("./app-scroll.ts", () => ({
  resetChatScroll: resetChatScrollMock,
  scheduleChatScroll: scheduleChatScrollMock,
}));

const { handleSendChat } = await import("./app-chat.ts");

function createHost() {
  return {
    connected: true,
    client: {
      request: vi.fn().mockResolvedValue({ runId: "run-1", status: "timeout" }),
    },
    chatMessage: "hello",
    chatAttachments: [],
    chatQueue: [],
    chatRunId: null,
    chatSending: false,
    chatMessages: [],
    chatStream: null,
    chatStreamStartedAt: null,
    chatHistoryRecoveryTimer: null,
    sessionKey: "main",
    sessionsResult: null,
    compactionStatus: null,
    basePath: "",
    hello: null,
    chatAvatarUrl: null,
    refreshSessionsAfterChat: new Set<string>(),
  };
}

describe("chat recovery watcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls chat history during an active run when no live stream text is present", async () => {
    const host = createHost();

    await handleSendChat(host as never);
    await vi.advanceTimersByTimeAsync(1500);

    expect(loadChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(host.client.request).toHaveBeenCalledWith("agent.wait", {
      runId: "run-1",
      timeoutMs: 1500,
    });
  });

  it("skips forced history polling once live stream text is already present", async () => {
    sendChatMessageMock.mockImplementationOnce(async (state) => {
      state.chatRunId = "run-1";
      state.chatStream = "streaming now";
      state.chatStreamStartedAt = Date.now();
      return "run-1";
    });
    const host = createHost();

    await handleSendChat(host as never);
    await vi.advanceTimersByTimeAsync(1500);

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
  });
});
