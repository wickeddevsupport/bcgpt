import { describe, expect, it, vi } from "vitest";

vi.mock("../workspace-config.js", () => ({
  loadEffectiveWorkspaceConfig: vi.fn(async () => ({
    agents: {
      assistant: { workspaceId: "ws-target" },
      seo: { workspaceId: "ws-other" },
    },
  })),
}));

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    loadSessionEntryForConfig: vi.fn(() => ({
      storePath: "C:/tmp/store.json",
      entry: {
        sessionId: "sess-1",
        sessionFile: "C:/tmp/sess-1.jsonl",
      },
    })),
    readSessionMessages: vi.fn(() => []),
    resolveSessionModelRef: vi.fn(() => ({ provider: "github-copilot", model: "gpt-5.4" })),
    resolveGatewaySessionStoreTarget: vi.fn(() => ({ agentId: "assistant" })),
    listAgentsForGateway: vi.fn(() => ({
      agents: [
        { id: "assistant", workspaceId: "ws-target" },
        { id: "seo", workspaceId: "ws-other" },
      ],
    })),
  };
});

const { chatHandlers } = await import("./chat.js");

describe("chat session workspace access", () => {
  it("uses effective request workspace id for chat.history access checks", async () => {
    const respond = vi.fn();
    await chatHandlers["chat.history"]({
      params: {
        sessionKey: "agent:assistant:main",
        workspaceId: "ws-target",
      },
      respond,
      context: {
        loadGatewayModelCatalog: vi.fn(async () => []),
      } as never,
      client: {
        pmosWorkspaceId: "",
      } as never,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        sessionKey: "agent:assistant:main",
        sessionId: "sess-1",
      }),
    );
  });
});
