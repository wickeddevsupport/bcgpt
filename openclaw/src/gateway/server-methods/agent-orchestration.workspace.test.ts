import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfig = vi.fn();
const writeConfigFile = vi.fn();
const loadEffectiveWorkspaceConfig = vi.fn();
const readWorkspaceConfig = vi.fn();
const writeWorkspaceConfig = vi.fn();
const ensureAgentWorkspace = vi.fn();
const mkdir = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig,
  writeConfigFile,
}));

vi.mock("../workspace-config.js", () => ({
  loadEffectiveWorkspaceConfig,
  readWorkspaceConfig,
  writeWorkspaceConfig,
}));

vi.mock("../../agents/workspace.js", () => ({
  ensureAgentWorkspace,
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir,
  },
}));

describe("agent-orchestration workspace persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfig.mockReturnValue({});
    loadEffectiveWorkspaceConfig.mockResolvedValue({
      agents: {
        list: [{ id: "assistant", workspaceId: "ws-rohit", default: true }],
      },
    });
    readWorkspaceConfig.mockResolvedValue({
      agents: {
        list: [{ id: "assistant", workspaceId: "ws-rohit", default: true }],
      },
    });
    writeWorkspaceConfig.mockResolvedValue(undefined);
    writeConfigFile.mockResolvedValue(undefined);
    ensureAgentWorkspace.mockResolvedValue({ dir: "/tmp/ws" });
    mkdir.mockResolvedValue(undefined);
  });

  it("persists template-created agents into the caller workspace overlay", async () => {
    const { handleTemplateCreate } = await import("./agent-orchestration.js");

    const result = await handleTemplateCreate(
      {
        templateId: "sales-agent",
      },
      {
        pmosWorkspaceId: "ws-rohit",
        pmosRole: "workspace_admin",
      } as any,
    );

    expect(result.success).toBe(true);
    expect(result.agentId).toBe("sales-agent");
    expect(writeWorkspaceConfig).toHaveBeenCalledWith(
      "ws-rohit",
      expect.objectContaining({
        agents: expect.objectContaining({
          list: expect.arrayContaining([
            expect.objectContaining({
              id: "sales-agent",
              workspaceId: "ws-rohit",
              workspace: "~/.openclaw/workspaces/ws-rohit/sales-agent",
              agentDir: "~/.openclaw/workspaces/ws-rohit/agents/sales-agent/agent",
            }),
          ]),
        }),
      }),
    );
    expect(writeConfigFile).not.toHaveBeenCalled();
    expect(ensureAgentWorkspace).toHaveBeenCalledWith({
      dir: "~/.openclaw/workspaces/ws-rohit/sales-agent",
      ensureBootstrapFiles: true,
    });
    expect(mkdir).toHaveBeenCalledWith(
      expect.stringContaining("workspaces\\ws-rohit\\agents\\sales-agent\\sessions"),
      { recursive: true },
    );
  });
});
