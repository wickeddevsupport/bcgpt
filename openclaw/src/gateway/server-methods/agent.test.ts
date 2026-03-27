import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./types.js";
import { agentHandlers } from "./agent.js";

const mocks = vi.hoisted(() => ({
  loadSessionEntryForConfig: vi.fn(),
  updateSessionStore: vi.fn(),
  agentCommand: vi.fn(),
  registerAgentRunContext: vi.fn(),
  loadConfigReturn: {} as Record<string, unknown>,
  loadEffectiveWorkspaceConfig: vi.fn(),
  listAgentIds: vi.fn(() => ["main"]),
}));

vi.mock("../session-utils.js", () => ({
  loadSessionEntryForConfig: mocks.loadSessionEntryForConfig,
}));

vi.mock("../../config/sessions.js", async () => {
  const actual = await vi.importActual<typeof import("../../config/sessions.js")>(
    "../../config/sessions.js",
  );
  return {
    ...actual,
    updateSessionStore: mocks.updateSessionStore,
    resolveAgentIdFromSessionKey: (key?: string) => {
      const trimmed = typeof key === "string" ? key.trim() : "";
      return trimmed.split(":")[1] || "main";
    },
    resolveExplicitAgentSessionKey: ({ agentId }: { agentId?: string }) =>
      agentId ? `agent:${agentId}:main` : undefined,
    resolveAgentMainSessionKey: ({ agentId }: { agentId: string }) => `agent:${agentId}:main`,
  };
});

vi.mock("../../commands/agent.js", () => ({
  agentCommand: mocks.agentCommand,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => mocks.loadConfigReturn,
}));

vi.mock("../../agents/agent-scope.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/agent-scope.js")>(
    "../../agents/agent-scope.js",
  );
  return {
    ...actual,
    listAgentIds: mocks.listAgentIds,
  };
});

vi.mock("../../infra/agent-events.js", () => ({
  registerAgentRunContext: mocks.registerAgentRunContext,
  onAgentEvent: vi.fn(),
}));

vi.mock("../../sessions/send-policy.js", () => ({
  resolveSendPolicy: () => "allow",
}));

vi.mock("../../utils/delivery-context.js", async () => {
  const actual = await vi.importActual<typeof import("../../utils/delivery-context.js")>(
    "../../utils/delivery-context.js",
  );
  return {
    ...actual,
    normalizeSessionDeliveryFields: () => ({}),
  };
});

vi.mock("../workspace-config.js", () => ({
  loadEffectiveWorkspaceConfig: mocks.loadEffectiveWorkspaceConfig,
}));

const makeContext = (): GatewayRequestContext =>
  ({
    dedupe: new Map(),
    addChatRun: vi.fn(),
    logGateway: { info: vi.fn(), error: vi.fn() },
  }) as unknown as GatewayRequestContext;

beforeEach(() => {
  mocks.loadSessionEntryForConfig.mockReset();
  mocks.updateSessionStore.mockReset();
  mocks.agentCommand.mockReset();
  mocks.registerAgentRunContext.mockReset();
  mocks.loadEffectiveWorkspaceConfig.mockReset();
  mocks.loadConfigReturn = {};
  mocks.listAgentIds.mockReset();
  mocks.listAgentIds.mockReturnValue(["main"]);
});

describe("gateway agent handler", () => {
  it("preserves cliSessionIds from existing session entry", async () => {
    const existingCliSessionIds = { "claude-cli": "abc-123-def" };
    const existingClaudeCliSessionId = "abc-123-def";

    mocks.loadSessionEntryForConfig.mockReturnValue({
      cfg: {},
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "existing-session-id",
        updatedAt: Date.now(),
        cliSessionIds: existingCliSessionIds,
        claudeCliSessionId: existingClaudeCliSessionId,
      },
      canonicalKey: "agent:main:main",
    });

    let capturedEntry: Record<string, unknown> | undefined;
    mocks.updateSessionStore.mockImplementation(async (_path, updater) => {
      const store: Record<string, unknown> = {};
      await updater(store);
      capturedEntry = store["agent:main:main"] as Record<string, unknown>;
    });

    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });

    const respond = vi.fn();
    await agentHandlers.agent({
      params: {
        message: "test",
        agentId: "main",
        sessionKey: "agent:main:main",
        idempotencyKey: "test-idem",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "agent" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.updateSessionStore).toHaveBeenCalled();
    expect(capturedEntry).toBeDefined();
    expect(capturedEntry?.cliSessionIds).toEqual(existingCliSessionIds);
    expect(capturedEntry?.claudeCliSessionId).toBe(existingClaudeCliSessionId);
  });

  it("injects a timestamp into the message passed to agentCommand", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-29T01:30:00.000Z")); // Wed Jan 28, 8:30 PM EST
    mocks.agentCommand.mockReset();

    mocks.loadConfigReturn = {
      agents: {
        defaults: {
          userTimezone: "America/New_York",
        },
      },
    };

    mocks.loadSessionEntryForConfig.mockReturnValue({
      cfg: mocks.loadConfigReturn,
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "existing-session-id",
        updatedAt: Date.now(),
      },
      canonicalKey: "agent:main:main",
    });
    mocks.updateSessionStore.mockResolvedValue(undefined);
    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });

    const respond = vi.fn();
    await agentHandlers.agent({
      params: {
        message: "Is it the weekend?",
        agentId: "main",
        sessionKey: "agent:main:main",
        idempotencyKey: "test-timestamp-inject",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "ts-1", method: "agent" },
      client: null,
      isWebchatConnect: () => false,
    });

    // Wait for the async agentCommand call
    await vi.waitFor(() => expect(mocks.agentCommand).toHaveBeenCalled());

    const callArgs = mocks.agentCommand.mock.calls[0][0];
    expect(callArgs.message).toBe("[Wed 2026-01-28 20:30 EST] Is it the weekend?");

    mocks.loadConfigReturn = {};
    vi.useRealTimers();
  });

  it("handles missing cliSessionIds gracefully", async () => {
    mocks.loadSessionEntryForConfig.mockReturnValue({
      cfg: {},
      storePath: "/tmp/sessions.json",
      entry: {
        sessionId: "existing-session-id",
        updatedAt: Date.now(),
        // No cliSessionIds or claudeCliSessionId
      },
      canonicalKey: "agent:main:main",
    });

    let capturedEntry: Record<string, unknown> | undefined;
    mocks.updateSessionStore.mockImplementation(async (_path, updater) => {
      const store: Record<string, unknown> = {};
      await updater(store);
      capturedEntry = store["agent:main:main"] as Record<string, unknown>;
    });

    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });

    const respond = vi.fn();
    await agentHandlers.agent({
      params: {
        message: "test",
        agentId: "main",
        sessionKey: "agent:main:main",
        idempotencyKey: "test-idem-2",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "2", method: "agent" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.updateSessionStore).toHaveBeenCalled();
    expect(capturedEntry).toBeDefined();
    // Should be undefined, not cause an error
    expect(capturedEntry?.cliSessionIds).toBeUndefined();
    expect(capturedEntry?.claudeCliSessionId).toBeUndefined();
  });

  it("uses workspace-effective config for workspace agent runs", async () => {
    const workspaceCfg = {
      agents: {
        list: [{ id: "ops", default: true, workspaceId: "ws-1" }],
      },
      session: {
        mainKey: "main",
      },
    };
    mocks.loadConfigReturn = {
      agents: {
        list: [{ id: "main", default: true }],
      },
      session: {
        mainKey: "main",
      },
    };
    mocks.listAgentIds.mockImplementation((cfg?: { agents?: { list?: Array<{ id?: string }> } }) =>
      (cfg?.agents?.list ?? []).map((entry) => entry.id ?? "").filter(Boolean),
    );
    mocks.loadEffectiveWorkspaceConfig.mockResolvedValue(workspaceCfg);
    mocks.loadSessionEntryForConfig.mockReturnValue({
      cfg: workspaceCfg,
      storePath: "/tmp/ws-sessions.json",
      entry: {
        sessionId: "workspace-session-id",
        updatedAt: Date.now(),
      },
      canonicalKey: "agent:ops:main",
    });
    mocks.updateSessionStore.mockResolvedValue(undefined);
    mocks.agentCommand.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 100 },
    });

    const respond = vi.fn();
    await agentHandlers.agent({
      params: {
        message: "hello from workspace",
        agentId: "ops",
        sessionKey: "agent:ops:main",
        idempotencyKey: "workspace-agent-run",
      },
      respond,
      context: makeContext(),
      req: { type: "req", id: "ws-1", method: "agent" },
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: "ws-1" } as any,
      isWebchatConnect: () => false,
    });

    await vi.waitFor(() => expect(mocks.agentCommand).toHaveBeenCalled());

    expect(mocks.loadEffectiveWorkspaceConfig).toHaveBeenCalledWith("ws-1");
    expect(mocks.loadSessionEntryForConfig).toHaveBeenCalledWith(
      workspaceCfg,
      "agent:ops:main",
    );
    expect(mocks.agentCommand.mock.calls[0][0].cfg).toBe(workspaceCfg);
  });

  it("resolves agent.identity.get against workspace-effective defaults", async () => {
    const workspaceCfg = {
      agents: {
        list: [{ id: "ops", default: true, workspaceId: "ws-1" }],
      },
      session: {
        mainKey: "main",
      },
    };
    mocks.loadConfigReturn = {
      agents: {
        list: [{ id: "main", default: true }],
      },
    };
    mocks.loadEffectiveWorkspaceConfig.mockResolvedValue(workspaceCfg);

    const respond = vi.fn();
    await agentHandlers["agent.identity.get"]({
      params: {},
      respond,
      context: makeContext(),
      req: { type: "req", id: "identity-1", method: "agent.identity.get" },
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: "ws-1" } as any,
      isWebchatConnect: () => false,
    });

    expect(mocks.loadEffectiveWorkspaceConfig).toHaveBeenCalledWith("ws-1");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ agentId: "ops" }),
      undefined,
    );
  });
});
