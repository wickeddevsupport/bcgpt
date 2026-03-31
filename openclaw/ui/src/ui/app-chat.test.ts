import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAbortChat, isChatBusy } from "./app-chat.ts";
import { rememberCompletedSessionRun } from "./session-active-run.ts";

describe("isChatBusy", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("keeps long-running active runs busy instead of force unlocking on a timer", () => {
    const host = {
      chatSending: false,
      chatRunId: "run-123",
      chatStream: null,
      chatStreamStartedAt: Date.now() - 60_000,
    };

    expect(isChatBusy(host)).toBe(true);
    expect(host.chatRunId).toBe("run-123");
  });

  it("treats a server-reported active session run as busy", () => {
    const host = {
      chatSending: false,
      chatRunId: null,
      sessionKey: "main",
      sessionsResult: {
        ts: Date.now(),
        path: "",
        count: 1,
        defaults: {},
        sessions: [
          { key: "main", kind: "direct", updatedAt: null, hasActiveRun: true, activeRunId: "run-remote" },
        ],
      },
    };

    expect(isChatBusy(host as never)).toBe(true);
  });

  it("ignores a recovered session run that this browser already saw complete", () => {
    rememberCompletedSessionRun("main", "run-remote");

    const host = {
      chatSending: false,
      chatRunId: null,
      chatStream: null,
      compactionStatus: null,
      sessionKey: "main",
      sessionsResult: {
        ts: Date.now(),
        path: "",
        count: 1,
        defaults: {},
        sessions: [
          { key: "main", kind: "direct", updatedAt: null, hasActiveRun: true, activeRunId: "run-remote" },
        ],
      },
    };

    expect(isChatBusy(host as never)).toBe(false);
  });

  it("clears recovered session busy state after a successful abort", async () => {
    const host = {
      connected: true,
      client: {
        request: vi.fn().mockResolvedValue({ ok: true, aborted: true }),
      },
      chatMessage: "stop",
      chatRunId: null,
      chatSending: false,
      chatStream: null,
      chatStreamStartedAt: null,
      lastError: null,
      sessionKey: "main",
      sessionsResult: {
        ts: Date.now(),
        path: "",
        count: 1,
        defaults: {},
        sessions: [
          { key: "main", kind: "direct", updatedAt: null, hasActiveRun: true, activeRunId: "run-remote" },
        ],
      },
    };

    await handleAbortChat(host as never);

    expect(host.client.request).toHaveBeenCalledWith("chat.abort", { sessionKey: "main" });
    expect(host.sessionsResult.sessions[0]?.hasActiveRun).toBe(false);
    expect(host.sessionsResult.sessions[0]?.activeRunId).toBeUndefined();
    expect(isChatBusy(host as never)).toBe(false);
  });
});