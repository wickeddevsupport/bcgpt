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

  it("shows a working badge from server session state after refresh", () => {
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

    const badge = container.querySelector(".chat-compose .chat-status-badge--busy");
    expect(badge?.textContent).toContain("Working");
    expect(container.textContent).toContain("Restoring the active run after refresh.");
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

  it('shows "Create workflow" button and calls handler when clicked', () => {
    const container = document.createElement('div');
    const onCreate = vi.fn();
    render(
      renderChat(
        createProps({
          draft: 'When a new ticket is created, post to Slack',
          onCreateWorkflow: onCreate,
        }),
      ),
      container,
    );

    const createBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Automate'),
    );
    expect(createBtn).toBeDefined();
    createBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onCreate).toHaveBeenCalledTimes(1);
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
