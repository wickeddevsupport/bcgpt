import { describe, expect, it } from "vitest";
import type { SessionsListResult } from "./types.ts";
import {
  resolveChatAgentOptions,
  resolveSelectedAgentIdForSession,
  resolveSessionDisplayName,
  resolveWorkspaceAssistantAgentId,
} from "./app-render.helpers.ts";

type SessionRow = SessionsListResult["sessions"][number];
type SelectedAgentState = Parameters<typeof resolveSelectedAgentIdForSession>[0];
type ChatAgentOptionsState = Parameters<typeof resolveChatAgentOptions>[0];

function row(overrides: Partial<SessionRow> & { key: string }): SessionRow {
  return { kind: "direct", updatedAt: 0, ...overrides };
}

describe("resolveSessionDisplayName", () => {
  it("returns key when no row is provided", () => {
    expect(resolveSessionDisplayName("agent:main:main")).toBe("agent:main:main");
  });

  it("returns key when row has no label or displayName", () => {
    expect(resolveSessionDisplayName("agent:main:main", row({ key: "agent:main:main" }))).toBe(
      "agent:main:main",
    );
  });

  it("returns key when displayName matches key", () => {
    expect(resolveSessionDisplayName("mykey", row({ key: "mykey", displayName: "mykey" }))).toBe(
      "mykey",
    );
  });

  it("returns key when label matches key", () => {
    expect(resolveSessionDisplayName("mykey", row({ key: "mykey", label: "mykey" }))).toBe("mykey");
  });

  it("uses displayName prominently when available", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", displayName: "My Chat" }),
      ),
    ).toBe("My Chat (discord:123:456)");
  });

  it("falls back to label when displayName is absent", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", label: "General" }),
      ),
    ).toBe("General (discord:123:456)");
  });

  it("prefers displayName over label when both are present", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", displayName: "My Chat", label: "General" }),
      ),
    ).toBe("My Chat (discord:123:456)");
  });

  it("ignores whitespace-only displayName", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", displayName: "   ", label: "General" }),
      ),
    ).toBe("General (discord:123:456)");
  });

  it("ignores whitespace-only label", () => {
    expect(
      resolveSessionDisplayName("discord:123:456", row({ key: "discord:123:456", label: "   " })),
    ).toBe("discord:123:456");
  });

  it("trims displayName and label", () => {
    expect(resolveSessionDisplayName("k", row({ key: "k", displayName: "  My Chat  " }))).toBe(
      "My Chat (k)",
    );
  });
});

describe("resolveSelectedAgentIdForSession", () => {
  it("returns the agent embedded in an agent session key", () => {
    expect(
      resolveSelectedAgentIdForSession(
        {
          assistantAgentId: "assistant",
          agentsList: {
            defaultId: "assistant",
            agents: [{ id: "assistant" }, { id: "designer" }],
          },
        } as SelectedAgentState,
        "agent:designer:main",
      ),
    ).toBe("designer");
  });

  it("falls back to the workspace assistant when session key is not agent-scoped", () => {
    expect(
      resolveSelectedAgentIdForSession(
        {
          assistantAgentId: "assistant",
          agentsList: {
            defaultId: "assistant",
            agents: [{ id: "assistant" }, { id: "designer" }],
          },
        } as SelectedAgentState,
        "main",
      ),
    ).toBe("assistant");
  });
});

describe("resolveWorkspaceAssistantAgentId", () => {
  it("falls back to the main session agent when assistant identity is not loaded yet", () => {
    expect(
      resolveWorkspaceAssistantAgentId(
        {
          assistantAgentId: null,
          agentsList: {
            defaultId: "assistant",
            agents: [{ id: "assistant" }, { id: "designer" }],
          },
        } as SelectedAgentState,
        "agent:assistant:main",
      ),
    ).toBe("assistant");
  });
});

describe("resolveChatAgentOptions", () => {
  it("deduplicates the workspace assistant when it already exists in the agent list", () => {
    expect(
      resolveChatAgentOptions(
        {
          assistantAgentId: "assistant",
          assistantName: "Workspace Assistant",
          agentsList: {
            defaultId: "assistant",
            agents: [
              {
                id: "assistant",
                name: "Workspace Assistant",
                identity: { name: "Workspace Assistant", emoji: "🏰" },
              },
              {
                id: "research",
                name: "Research Agent",
                identity: { name: "Research Agent", emoji: "🔎" },
              },
            ],
          },
        } as ChatAgentOptionsState,
        "main",
      ),
    ).toEqual([
      { value: "assistant", label: "🏰 Workspace Assistant" },
      { value: "research", label: "🔎 Research Agent" },
    ]);
  });

  it("creates a synthetic assistant option only when the assistant agent is absent", () => {
    expect(
      resolveChatAgentOptions(
        {
          assistantAgentId: "assistant",
          assistantName: "Workspace Assistant",
          agentsList: {
            defaultId: "assistant",
            agents: [{ id: "research", name: "Research Agent", identity: { emoji: "🔎" } }],
          },
        } as ChatAgentOptionsState,
        "main",
      ),
    ).toEqual([
      { value: "assistant", label: "Workspace Assistant" },
      { value: "research", label: "🔎 Research Agent" },
    ]);
  });
});
