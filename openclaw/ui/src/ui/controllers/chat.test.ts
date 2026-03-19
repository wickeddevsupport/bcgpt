import { describe, expect, it, vi } from "vitest";
import {
  handleChatEvent,
  loadChatHistory,
  sendChatMessage,
  type ChatEventPayload,
  type ChatState,
} from "./chat.ts";

function createState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatAttachments: [],
    chatLoading: false,
    chatMessage: "",
    chatMessages: [],
    chatRunId: null,
    chatSending: false,
    chatStream: null,
    chatStreamStartedAt: null,
    chatThinkingLevel: null,
    client: null,
    connected: true,
    lastError: null,
    sessionKey: "main",
    ...overrides,
  };
}

describe("handleChatEvent", () => {
  it("returns null when payload is missing", () => {
    const state = createState();
    expect(handleChatEvent(state, undefined)).toBe(null);
  });

  it("returns null when sessionKey does not match", () => {
    const state = createState({ sessionKey: "main" });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "other",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe(null);
  });

  it("returns null for delta from another run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Hello");
  });

  it("returns 'final' for final from another run (e.g. sub-agent announce) without clearing state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Sub-agent findings" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
  });

  it("processes final from own run and clears state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Reply",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });

  it("shows reasoning-only deltas in the live stream", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Reviewing the current config" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("delta");
    expect(state.chatStream).toContain("<thinking>Reviewing the current config</thinking>");
  });

  it("keeps pending optimistic user message during history refresh while run is active", async () => {
    const pendingMessage = {
      role: "user",
      content: [{ type: "text", text: "hello workflow" }],
      timestamp: 1,
      __openclaw: { kind: "pending-user", runId: "run-1" },
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatMessages: [pendingMessage],
      client: {
        request: vi.fn().mockResolvedValue({
          messages: [],
          thinkingLevel: "off",
        }),
      } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);
    expect(state.chatMessages).toHaveLength(1);
    expect((state.chatMessages[0] as { role?: string }).role).toBe("user");
  });

  it("repairs a missing workspace session during history load instead of falling back", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "chat.history") {
        if (params?.sessionKey === "agent:designer:chat:stale" && request.mock.calls.length === 1) {
          throw new Error('session "agent:designer:chat:stale" not found');
        }
        return {
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "Recovered session history" }],
              timestamp: 10,
            },
          ],
          thinkingLevel: "off",
        };
      }
      if (method === "sessions.patch") {
        return { ok: true };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      sessionKey: "agent:designer:chat:stale",
      pmosWorkspaceId: "workspace-123",
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(state.lastError).toBeNull();
    expect(state.chatMessages).toHaveLength(1);
    expect(request.mock.calls).toContainEqual([
      "sessions.patch",
      { key: "agent:designer:chat:stale" },
    ]);
  });

  it("clears pending marker when own run final event arrives", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
          timestamp: 1,
          __openclaw: { kind: "pending-user", runId: "run-1" },
        },
      ],
    });

    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect((state.chatMessages[0] as { __openclaw?: unknown }).__openclaw).toBeUndefined();
  });

  it("uses streamed chat.send for PMOS workspace chat", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "models.list") {
        return {
          models: [{ id: "gpt-5", available: true }],
        };
      }
      if (method === "chat.send") {
        return { ok: true };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      sessionKey: "agent:main:main",
      pmosWorkspaceId: "workspace-123",
      client: { request } as unknown as ChatState["client"],
    });

    const runId = await sendChatMessage(state, "hello workspace");

    expect(typeof runId).toBe("string");
    expect(state.chatRunId).toBe(runId);
    expect(request.mock.calls.some(([method]) => method === "chat.send")).toBe(true);
    expect(request.mock.calls.some(([method]) => method === "pmos.chat.send")).toBe(false);
  });

  it("recreates the requested workspace session and retries chat.send without falling back", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "models.list") {
        return {
          models: [{ id: "gpt-5", available: true }],
        };
      }
      if (method === "chat.send") {
        const chatSendCount = request.mock.calls.filter(([name]) => name === "chat.send").length;
        if (params?.sessionKey === "agent:main:main" && chatSendCount === 1) {
          throw new Error('session "agent:main:main" not found');
        }
        return { ok: true };
      }
      if (method === "sessions.patch") {
        return { ok: true };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      sessionKey: "agent:main:main",
      pmosWorkspaceId: "workspace-123",
      client: { request } as unknown as ChatState["client"],
    });

    const runId = await sendChatMessage(state, "hello workspace");

    expect(typeof runId).toBe("string");
    expect(state.sessionKey).toBe("agent:main:main");
    expect(
      request.mock.calls.filter(([method]) => method === "chat.send").map(([, params]) => params),
    ).toEqual([
      expect.objectContaining({ sessionKey: "agent:main:main" }),
      expect.objectContaining({ sessionKey: "agent:main:main" }),
    ]);
    expect(request.mock.calls).toContainEqual([
      "sessions.patch",
      { key: "agent:main:main" },
    ]);
  });

  it("prefers another session for the same agent before falling back to another agent", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "models.list") {
        return {
          models: [{ id: "gpt-5", available: true }],
        };
      }
      if (method === "chat.send") {
        if (params?.sessionKey === "agent:designer:chat:missing") {
          throw new Error('session "agent:designer:chat:missing" not found');
        }
        return { ok: true };
      }
      if (method === "sessions.patch") {
        throw new Error("cannot recreate session");
      }
      if (method === "sessions.list") {
        return {
          sessions: [{ key: "agent:designer:main" }, { key: "agent:assistant:main" }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      sessionKey: "agent:designer:chat:missing",
      pmosWorkspaceId: "workspace-123",
      client: { request } as unknown as ChatState["client"],
    });

    const runId = await sendChatMessage(state, "hello workspace");

    expect(typeof runId).toBe("string");
    expect(state.sessionKey).toBe("agent:designer:main");
    expect(
      request.mock.calls.filter(([method]) => method === "chat.send").map(([, params]) => params),
    ).toEqual([
      expect.objectContaining({ sessionKey: "agent:designer:chat:missing" }),
      expect.objectContaining({ sessionKey: "agent:designer:main" }),
    ]);
  });
});
