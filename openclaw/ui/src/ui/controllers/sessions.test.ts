import { describe, expect, it } from "vitest";
import type { SessionsListResult } from "../types.ts";
import {
  loadSessions,
  syncWorkspaceSessionSelection,
  type SessionsState,
} from "./sessions.ts";

function createState(overrides: Partial<SessionsState> = {}): SessionsState {
  return {
    client: null,
    connected: true,
    sessionsLoading: false,
    sessionsResult: null,
    sessionsError: null,
    sessionsFilterActive: "",
    sessionsFilterLimit: "120",
    sessionsIncludeGlobal: false,
    sessionsIncludeUnknown: false,
    sessionKey: "agent:assistant:main",
    settings: {
      sessionKey: "agent:assistant:main",
      lastActiveSessionKey: "agent:assistant:main",
    },
    agentsSelectedId: "assistant",
    assistantAgentId: "assistant",
    pmosAuthUser: { role: "member" },
    agentsList: {
      defaultId: "assistant",
      agents: [{ id: "assistant" }, { id: "designer" }],
    },
    ...overrides,
  };
}

function createResult(keys: string[]): SessionsListResult {
  return {
    ts: Date.now(),
    path: "",
    count: keys.length,
    defaults: { model: null, contextTokens: null },
    sessions: keys.map((key) => ({
      key,
      kind: "direct" as const,
      updatedAt: Date.now(),
    })),
  };
}

describe("syncWorkspaceSessionSelection", () => {
  it("keeps an explicitly selected workspace agent session even when it is not listed yet", () => {
    const state = createState({
      sessionKey: "agent:designer:main",
      settings: {
        sessionKey: "agent:designer:main",
        lastActiveSessionKey: "agent:designer:main",
      },
    });

    syncWorkspaceSessionSelection(
      state,
      createResult(["agent:assistant:main", "agent:assistant:chat:abc123"]),
    );

    expect(state.sessionKey).toBe("agent:designer:main");
    expect(state.settings?.sessionKey).toBe("agent:designer:main");
  });

  it("falls back when the current session does not belong to a workspace agent", () => {
    const state = createState({
      sessionKey: "agent:ghost:main",
      settings: {
        sessionKey: "agent:ghost:main",
        lastActiveSessionKey: "agent:ghost:main",
      },
    });

    syncWorkspaceSessionSelection(
      state,
      createResult(["agent:assistant:main", "agent:designer:main"]),
    );

    expect(state.sessionKey).toBe("agent:assistant:main");
    expect(state.settings?.sessionKey).toBe("agent:assistant:main");
    expect(state.settings?.lastActiveSessionKey).toBe("agent:assistant:main");
    expect(state.agentsSelectedId).toBe("assistant");
  });

  it("clears stale chatRunId when the active session row is missing", async () => {
    const request = async () =>
      createResult(["agent:assistant:chat:abc123", "agent:designer:main"]);
    const state = createState({
      client: { request } as unknown as SessionsState["client"],
      chatRunId: "run-stale",
    });

    await loadSessions(state);

    expect(state.chatRunId).toBe("run-stale");
  });

  it("preserves the local chatRunId while the active session row has not caught up yet", async () => {
    const request = async () =>
      createResult(["agent:assistant:main", "agent:designer:main"]);
    const state = createState({
      client: { request } as unknown as SessionsState["client"],
      chatRunId: "run-local",
    });

    await loadSessions(state);

    expect(state.chatRunId).toBe("run-local");
  });

  it("clears the local chatRunId when session selection falls back to a different session", async () => {
    const request = async () =>
      createResult(["agent:assistant:main", "agent:designer:main"]);
    const state = createState({
      client: { request } as unknown as SessionsState["client"],
      sessionKey: "agent:ghost:main",
      settings: {
        sessionKey: "agent:ghost:main",
        lastActiveSessionKey: "agent:ghost:main",
      },
      chatRunId: "run-stale",
    });

    await loadSessions(state);

    expect(state.sessionKey).toBe("agent:assistant:main");
    expect(state.chatRunId).toBeNull();
  });
});
