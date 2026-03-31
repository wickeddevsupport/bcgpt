import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { SessionsListResult } from "../types.ts";
import { renderChat, type ChatProps } from "./chat.ts";

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { model: null, contextTokens: null },
    sessions: [],
  };
}

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    loading: false,
    sending: false,
    activeRunId: null,
    canAbort: false,
    compactionStatus: null,
    messages: [],
    toolMessages: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: createSessions(),
    focusMode: false,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    refreshing: false,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    ...overrides,
  };
}

describe("chat view", () => {
  it("shows a ready badge when chat is idle", () => {
    const container = document.createElement("div");
    render(renderChat(createProps()), container);

    const badge = container.querySelector(".chat-status-badge--ready");
    expect(badge?.textContent).toContain("Ready");
    expect(container.textContent).toContain("Waiting for the next message.");
    const sendButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Send"),
    );
    expect(sendButton?.textContent).toContain("Send");
  });

  it("shows a working badge while streaming", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          stream: "Working through the reply",
          streamStartedAt: Date.now(),
        }),
      ),
      container,
    );

    const badge = container.querySelector(".chat-status-badge--busy");
    expect(badge?.textContent).toContain("Working");
    expect(container.textContent).toContain("Streaming the current response.");
  });

  it("keeps rendering streamed text when live text is already available", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          stream: "Partial answer",
          streamStartedAt: Date.now(),
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Partial answer");
  });

  it("shows live reasoning while a stream is active even when the toggle is off", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          showThinking: false,
          stream: "<thinking>Plan next step</thinking>\nWorking through the reply",
          streamStartedAt: Date.now(),
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Thinking");
    expect(container.textContent).toContain("Plan next step");
  });

  it("shows live tool updates while a run is active even when the toggle is off", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          showThinking: false,
          activeRunId: "run-123",
          toolMessages: [
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
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-tool-card")).not.toBeNull();
    expect(container.textContent).toContain("web_search");
    expect(container.textContent).toContain("Search complete");
  });

  it("shows a working badge while finalizing a completed run", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          activeRunId: "run-123",
          queue: [{ id: "q1", text: "next message", createdAt: Date.now() }],
        }),
      ),
      container,
    );

    const badge = container.querySelector(".chat-status-badge--busy");
    expect(badge?.textContent).toContain("Working");
    expect(container.textContent).toContain("Finishing the current response before sending 1 queued message.");
  });

  it("shows a stream-driven status instead of history sync copy while a run is finalizing", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          activeRunId: "run-123",
          queue: [],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Finishing the current response.");
    expect(container.textContent).not.toContain("syncing history");
    const queueButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Queue"),
    );
    expect(queueButton?.textContent).toContain("Queue");
  });

  it("shows a working badge from server session state after refresh", () => {
    const container = document.createElement("div");
    const onAbort = vi.fn();
    render(
      renderChat(
        createProps({
          onAbort,
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { model: null, contextTokens: null },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: Date.now(),
                hasActiveRun: true,
                activeRunId: "run-123",
              },
            ],
          },
        }),
      ),
      container,
    );

    const badge = container.querySelector(".chat-compose .chat-status-badge--busy");
    expect(badge?.textContent).toContain("Working");
    expect(container.textContent).toContain("Restoring the active run after refresh.");
    const queueButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Queue"),
    );
    expect(queueButton?.textContent).toContain("Queue");
    const stopButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Stop",
    );
    expect(stopButton).not.toBeUndefined();
    stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("stays busy while reconnecting to an active run", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          connected: false,
          activeRunId: "run-123",
        }),
      ),
      container,
    );

    const badge = container.querySelector(".chat-compose .chat-status-badge--busy");
    expect(badge?.textContent).toContain("Working");
    expect(container.textContent).toContain("Reconnecting to the active run.");
    expect(container.textContent).not.toContain("Reconnect to resume chat activity.");
  });

  it("renders compacting indicator as a badge", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: true,
            startedAt: Date.now(),
            completedAt: null,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--active");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Compacting context...");
  });

  it("renders completion indicator shortly after compaction", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: false,
            startedAt: 900,
            completedAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--complete");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Context compacted");
    nowSpy.mockRestore();
  });

  it("hides stale compaction completion indicator", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: false,
            startedAt: 0,
            completedAt: 0,
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".compaction-indicator")).toBeNull();
    nowSpy.mockRestore();
  });

  it("shows a stop button when aborting is available", () => {
    const container = document.createElement("div");
    const onAbort = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: true,
          onAbort,
        }),
      ),
      container,
    );

    const stopButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Stop",
    );
    expect(stopButton).not.toBeUndefined();
    stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("New session");
  });

  it("shows a new session button when aborting is unavailable", () => {
    const container = document.createElement("div");
    const onNewSession = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: false,
          onNewSession,
        }),
      ),
      container,
    );

    const newSessionButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "New session",
    );
    expect(newSessionButton).not.toBeUndefined();
    newSessionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Stop");
  });

  it("renders a manual refresh button that calls onRefresh", () => {
    const container = document.createElement("div");
    const onRefresh = vi.fn();
    render(
      renderChat(
        createProps({
          onRefresh,
        }),
      ),
      container,
    );

    const refreshButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.getAttribute("title") === "Refresh chat history",
    );
    expect(refreshButton).not.toBeUndefined();
    expect(refreshButton?.textContent).toContain("Refresh");
    refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("updates the compose placeholder when the server reports an active run", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { model: null, contextTokens: null },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: Date.now(),
                hasActiveRun: true,
                activeRunId: "run-123",
              },
            ],
          },
        }),
      ),
      container,
    );

    const input = container.querySelector("textarea");
    expect(input?.getAttribute("placeholder")).toContain("queue it");
  });

  it("renders a compact agent header when expanded", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          agentId: "research-agent",
          agentName: "Research Agent",
          agentEmoji: "🔎",
          agentTheme: "AI Agent",
        }),
      ),
      container,
    );

    const card = container.querySelector(".chat-agent-card");
    expect(card?.textContent).toContain("Research Agent");
    expect(card?.textContent).toContain("AI Agent");
  });

  it("hides the agent header when collapsed", () => {
    const container = document.createElement("div");
    const onToggleHeaderCollapsed = vi.fn();
    render(
      renderChat(
        createProps({
          agentId: "research-agent",
          agentName: "Research Agent",
          headerCollapsed: true,
          onToggleHeaderCollapsed,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-agent-card")).toBeNull();
  });

  it("renders assistant message meta from usage, cost, model, and context window", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              model: "anthropic/claude-3.5-sonnet",
              timestamp: Date.now(),
              content: [{ type: "text", text: "Here is the answer." }],
              usage: {
                input: 1200,
                output: 320,
                cacheRead: 500,
                cacheWrite: 250,
              },
              cost: {
                total: 0.0123,
              },
            },
          ],
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { model: null, contextTokens: null },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: Date.now(),
                contextTokens: 2000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".msg-meta")?.textContent).toContain("↑1.2k");
    expect(container.querySelector(".msg-meta")?.textContent).toContain("↓320");
    expect(container.querySelector(".msg-meta")?.textContent).toContain("R500");
    expect(container.querySelector(".msg-meta")?.textContent).toContain("W250");
    expect(container.querySelector(".msg-meta")?.textContent).toContain("$0.0123");
    expect(container.querySelector(".msg-meta")?.textContent).toContain("60% ctx");
    expect(container.querySelector(".msg-meta__model")?.textContent).toContain("claude-3.5-sonnet");
  });
});
