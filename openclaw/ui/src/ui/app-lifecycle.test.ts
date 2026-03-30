import { describe, expect, it, vi } from "vitest";
import { handleUpdated } from "./app-lifecycle.ts";

vi.mock("./app-scroll.ts", () => ({
  observeTopbar: vi.fn(),
  scheduleChatScroll: vi.fn(),
  scheduleLogsScroll: vi.fn(),
  resetChatScroll: vi.fn(),
}));

import { scheduleChatScroll } from "./app-scroll.ts";

describe("handleUpdated", () => {
  it("keeps chat auto-scroll active while chat updates arrive", () => {
    const host = {
      tab: "dashboard",
      chatHasAutoScrolled: true,
      chatManualRefreshInFlight: true,
      chatLoading: false,
      chatMessages: [],
      chatToolMessages: [],
      chatStream: "streaming",
      logsAutoFollow: false,
      logsAtBottom: false,
      logsEntries: [],
    } as any;

    handleUpdated(host, new Map([["chatStream", null]]));
    expect(vi.mocked(scheduleChatScroll)).toHaveBeenCalledTimes(1);
  });
});
