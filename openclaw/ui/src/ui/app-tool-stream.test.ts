import { describe, expect, it } from "vitest";

import { handleAgentEvent } from "./app-tool-stream.ts";

function createHost() {
  return {
    sessionKey: "agent:assistant:main",
    chatRunId: "chat-run-1",
    pmosWorkspaceId: "workspace-1",
    sessionsResult: {
      sessions: [
        {
          key: "agent:assistant:main",
          activeRunId: "chat-run-1",
          hasActiveRun: true,
        },
      ],
    },
    toolStreamById: new Map(),
    toolStreamOrder: [],
    chatToolMessages: [],
    toolStreamSyncTimer: null,
  };
}

describe("handleAgentEvent", () => {
  it("accepts same-session tool events when the agent run id differs from the chat run id", () => {
    const host = createHost();

    handleAgentEvent(host, {
      runId: "agent-run-7",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      sessionKey: "agent:assistant:main",
      scopeKey: "workspace:workspace-1",
      data: {
        phase: "result",
        toolCallId: "tool-1",
        name: "web_search",
        result: { text: "Search complete" },
      },
    });

    expect(host.chatToolMessages).toHaveLength(1);
    expect(host.toolStreamOrder).toEqual(["tool-1"]);
    expect((host.chatToolMessages[0] as { runId?: string }).runId).toBe("agent-run-7");
  });

  it("accepts related subagent tool events for the active session", () => {
    const host = createHost();

    handleAgentEvent(host, {
      runId: "subagent-run-3",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      sessionKey: "agent:assistant:subagent:planner",
      scopeKey: "workspace:workspace-1",
      data: {
        phase: "result",
        toolCallId: "tool-2",
        name: "todo_write",
        result: { text: "Plan saved" },
      },
    });

    expect(host.chatToolMessages).toHaveLength(1);
    expect((host.chatToolMessages[0] as { toolCallId?: string }).toolCallId).toBe("tool-2");
  });

  it("still rejects session-less tool events from a different run", () => {
    const host = createHost();

    handleAgentEvent(host, {
      runId: "foreign-run",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      scopeKey: "workspace:workspace-1",
      data: {
        phase: "result",
        toolCallId: "tool-3",
        name: "web_search",
        result: { text: "Should not show" },
      },
    });

    expect(host.chatToolMessages).toHaveLength(0);
    expect(host.toolStreamOrder).toHaveLength(0);
  });
});
