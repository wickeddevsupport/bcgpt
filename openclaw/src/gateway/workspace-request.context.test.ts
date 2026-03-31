import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  globalConfig: {
    agents: {
      list: [{ id: "global-assistant" }],
    },
  },
  workspaceConfig: {
    agents: {
      list: [
        { id: "assistant", workspaceId: "ws-target" },
        { id: "seo", workspaceId: "ws-other" },
      ],
    },
    session: {
      store: "~/.openclaw/workspaces/ws-target/agents/{agentId}/sessions/sessions.json",
    },
  },
  loadEffectiveWorkspaceConfig: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => mocks.globalConfig,
}));

vi.mock("./workspace-config.js", () => ({
  loadEffectiveWorkspaceConfig: mocks.loadEffectiveWorkspaceConfig,
}));

vi.mock("./session-utils.js", () => ({
  listAgentsForGateway: vi.fn((cfg: { agents?: { list?: Array<{ id: string; workspaceId?: string }> } }) => ({
    defaultId: "assistant",
    mainKey: "agent:assistant:main",
    scope: "per-sender",
    agents: cfg.agents?.list ?? [],
  })),
  resolveGatewaySessionStoreTarget: vi.fn(({ key }: { key: string }) => ({
    agentId: key.includes("seo") ? "seo" : "assistant",
    storePath: "/tmp/sessions.json",
    canonicalKey: key,
    storeKeys: [key],
  })),
}));

import {
  resolveWorkspaceRequestContext,
  workspaceRequestCanAccessSessionKey,
} from "./workspace-request.js";

describe("resolveWorkspaceRequestContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadEffectiveWorkspaceConfig.mockResolvedValue(mocks.workspaceConfig);
  });

  it("uses the explicit request workspace for backend callers and derives a single scope model", async () => {
    const context = await resolveWorkspaceRequestContext(null, { workspaceId: "ws-target" });

    expect(mocks.loadEffectiveWorkspaceConfig).toHaveBeenCalledWith("ws-target");
    expect(context.workspaceId).toBe("ws-target");
    expect(context.isWorkspaceScoped).toBe(true);
    expect(context.scopeKey).toBe("workspace:ws-target");
    expect(context.workspaceAgentIds).toEqual(new Set(["assistant"]));
    expect(workspaceRequestCanAccessSessionKey(context, "agent:assistant:main")).toBe(true);
    expect(workspaceRequestCanAccessSessionKey(context, "agent:seo:main")).toBe(false);
  });

  it("pins workspace admins to their own workspace even when params request another", async () => {
    const context = await resolveWorkspaceRequestContext(
      { pmosRole: "workspace_admin", pmosWorkspaceId: "ws-owner" } as never,
      { workspaceId: "ws-target" },
    );

    expect(mocks.loadEffectiveWorkspaceConfig).toHaveBeenCalledWith("ws-owner");
    expect(context.workspaceId).toBe("ws-owner");
    expect(context.scopeKey).toBe("workspace:ws-owner");
  });

  it("lets super admins intentionally target another workspace", async () => {
    const context = await resolveWorkspaceRequestContext(
      { pmosRole: "super_admin", pmosWorkspaceId: "ws-owner" } as never,
      { workspaceId: "ws-target" },
    );

    expect(mocks.loadEffectiveWorkspaceConfig).toHaveBeenCalledWith("ws-target");
    expect(context.workspaceId).toBe("ws-target");
    expect(context.isSuperAdmin).toBe(true);
  });
});