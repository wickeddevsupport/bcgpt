import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext } from "./types.js";
import { modelsHandlers } from "./models.js";

const mocks = vi.hoisted(() => ({
  loadConfigReturn: {} as Record<string, unknown>,
  loadEffectiveWorkspaceConfig: vi.fn(),
  loadGatewayModelCatalog: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => mocks.loadConfigReturn,
}));

vi.mock("../workspace-config.js", () => ({
  loadEffectiveWorkspaceConfig: mocks.loadEffectiveWorkspaceConfig,
}));

const makeContext = (): GatewayRequestContext =>
  ({
    loadGatewayModelCatalog: mocks.loadGatewayModelCatalog,
  }) as unknown as GatewayRequestContext;

beforeEach(() => {
  mocks.loadConfigReturn = {};
  mocks.loadEffectiveWorkspaceConfig.mockReset();
  mocks.loadGatewayModelCatalog.mockReset();
});

describe("gateway models handler", () => {
  it("uses workspace-effective config for workspace-admin models.list", async () => {
    const workspaceCfg = {
      models: {
        providers: {
          openai: {
            models: [{ id: "gpt-5.2" }],
          },
        },
      },
    };
    const models = [{ id: "gpt-5.2", name: "GPT-5.2", provider: "openai" }];
    mocks.loadEffectiveWorkspaceConfig.mockResolvedValue(workspaceCfg);
    mocks.loadGatewayModelCatalog.mockResolvedValue(models);

    const respond = vi.fn();
    await modelsHandlers["models.list"]({
      params: {},
      respond,
      context: makeContext(),
      req: { type: "req", id: "1", method: "models.list" },
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: "ws-1" } as any,
      isWebchatConnect: () => false,
    });

    expect(mocks.loadEffectiveWorkspaceConfig).toHaveBeenCalledWith("ws-1");
    expect(mocks.loadGatewayModelCatalog).toHaveBeenCalledWith({ config: workspaceCfg });
    expect(respond).toHaveBeenCalledWith(true, { models }, undefined);
  });

  it("uses explicit workspaceId for backend models.list requests", async () => {
    const workspaceCfg = {
      models: {
        providers: {
          githubCopilot: {
            models: [{ id: "gpt-5-mini" }],
          },
        },
      },
    };
    const models = [
      { id: "gpt-5-mini", name: "GPT-5 mini", provider: "github-copilot" },
    ];
    mocks.loadEffectiveWorkspaceConfig.mockResolvedValue(workspaceCfg);
    mocks.loadGatewayModelCatalog.mockResolvedValue(models);

    const respond = vi.fn();
    await modelsHandlers["models.list"]({
      params: { workspaceId: "ws-1" },
      respond,
      context: makeContext(),
      req: { type: "req", id: "2", method: "models.list" },
      client: null,
      isWebchatConnect: () => false,
    });

    expect(mocks.loadEffectiveWorkspaceConfig).toHaveBeenCalledWith("ws-1");
    expect(mocks.loadGatewayModelCatalog).toHaveBeenCalledWith({ config: workspaceCfg });
    expect(respond).toHaveBeenCalledWith(true, { models }, undefined);
  });
});