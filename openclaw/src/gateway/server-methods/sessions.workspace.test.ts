import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  annotateSessionsWithActiveRuns: vi.fn((result: unknown) => result),
  listSessionsFromStore: vi.fn(() => ({
    count: 1,
    sessions: [{ key: "agent:assistant:main" }],
  })),
  loadCombinedSessionStoreForGateway: vi.fn(() => ({
    storePath: "(multiple)",
    store: {},
  })),
  resolveGatewaySessionStoreTarget: vi.fn(({ key }: { key: string }) => ({
    agentId: key.includes("seo") ? "seo" : "assistant",
    storePath: "/tmp/sessions.json",
    canonicalKey: key,
    storeKeys: [key],
  })),
  resolveSessionKeyFromResolveParams: vi.fn(),
}));

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn(() => ({
      agents: {
        list: [
          { id: "assistant", workspaceId: "ws-target", default: true },
          { id: "seo", workspaceId: "ws-other" },
        ],
      },
      session: {
        store: "~/.openclaw/workspaces/ws-target/agents/{agentId}/sessions/sessions.json",
      },
    })),
  };
});

vi.mock("../workspace-config.js", () => ({
  loadEffectiveWorkspaceConfig: vi.fn(async () => ({
    agents: {
      list: [
        { id: "assistant", workspaceId: "ws-target", default: true },
        { id: "seo", workspaceId: "ws-other" },
      ],
    },
    session: {
      store: "~/.openclaw/workspaces/ws-target/agents/{agentId}/sessions/sessions.json",
    },
  })),
}));

vi.mock("../session-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...actual,
    annotateSessionsWithActiveRuns: mocks.annotateSessionsWithActiveRuns,
    listSessionsFromStore: mocks.listSessionsFromStore,
    loadCombinedSessionStoreForGateway: mocks.loadCombinedSessionStoreForGateway,
    resolveGatewaySessionStoreTarget: mocks.resolveGatewaySessionStoreTarget,
  };
});

vi.mock("../sessions-resolve.js", () => ({
  resolveSessionKeyFromResolveParams: mocks.resolveSessionKeyFromResolveParams,
}));

import { sessionsHandlers } from "./sessions.js";

describe("sessions workspace isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSessionKeyFromResolveParams.mockReturnValue({ ok: true, key: "agent:assistant:subagent-1" });
  });

  it("lists sessions using the effective workspace agent set for backend callers", async () => {
    const respond = vi.fn();

    await sessionsHandlers["sessions.list"]({
      params: { workspaceId: "ws-target", limit: 20 },
      respond,
      client: null,
      context: {
        chatAbortControllers: new Map(),
      } as never,
    } as never);

    expect(mocks.loadCombinedSessionStoreForGateway).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentIds: new Set(["assistant"]) }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ sessions: [{ key: "agent:assistant:main" }] }),
      undefined,
    );
  });

  it("blocks resolving a session outside the effective workspace", async () => {
    mocks.resolveSessionKeyFromResolveParams.mockReturnValue({ ok: true, key: "agent:seo:main" });
    const respond = vi.fn();

    await sessionsHandlers["sessions.resolve"]({
      params: { workspaceId: "ws-target", key: "agent:seo:main" },
      respond,
      client: null,
    } as never);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: 'session "agent:seo:main" not found' }),
    );
  });

  it("allows workspace-scoped subagent session resolution inside the effective workspace", async () => {
    const respond = vi.fn();

    await sessionsHandlers["sessions.resolve"]({
      params: { workspaceId: "ws-target", key: "agent:assistant:subagent-1" },
      respond,
      client: null,
    } as never);

    expect(respond).toHaveBeenCalledWith(
      true,
      { ok: true, key: "agent:assistant:subagent-1" },
      undefined,
    );
  });
});