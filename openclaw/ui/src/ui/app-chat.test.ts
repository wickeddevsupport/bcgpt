import { describe, expect, it } from "vitest";
import { isChatBusy } from "./app-chat.ts";

describe("isChatBusy", () => {
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
});