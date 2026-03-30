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
});