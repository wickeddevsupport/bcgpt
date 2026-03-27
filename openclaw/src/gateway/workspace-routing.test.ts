import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockGlobalConfig: Record<string, unknown> = {};

vi.mock("../config/config.js", () => ({
  loadConfig: () => mockGlobalConfig,
}));

describe("workspace route resolution", () => {
  const workspaceId = "ws-route-resolution";

  beforeEach(() => {
    mockGlobalConfig = {};
  });

  afterEach(async () => {
    const { workspaceConfigPath } = await import("./workspace-config.js");
    try {
      await fs.rm(path.dirname(workspaceConfigPath(workspaceId)), {
        recursive: true,
        force: true,
      });
    } catch {
      // ignore cleanup issues
    }
  });

  it("upgrades matched bindings to the workspace effective config", async () => {
    mockGlobalConfig = {
      agents: {
        defaults: {
          workspace: "~/.openclaw/workspace-main",
        },
        list: [{ id: "assistant", default: true }],
      },
      session: {
        store: "~/.openclaw/agents/{agentId}/sessions/sessions.json",
      },
    };

    const { writeWorkspaceConfig } = await import("./workspace-config.js");
    const { resolveWorkspaceRoute } = await import("./workspace-routing.js");

    await writeWorkspaceConfig(workspaceId, {
      bindings: [
        {
          agentId: "workspace-assistant",
          match: {
            channel: "whatsapp",
            accountId: "rohit",
            peer: {
              kind: "direct",
              id: "+15551234567",
            },
          },
        },
      ],
      agents: {
        list: [{ id: "workspace-assistant", default: true, workspaceId }],
      },
    });

    const resolved = await resolveWorkspaceRoute({
      cfg: mockGlobalConfig as never,
      channel: "whatsapp",
      accountId: "rohit",
      peer: {
        kind: "direct",
        id: "+15551234567",
      },
    });

    expect(resolved.workspaceId).toBe(workspaceId);
    expect(resolved.route.agentId).toBe("workspace-assistant");
    expect((resolved.cfg.session as Record<string, unknown> | undefined)?.store).toBe(
      `~/.openclaw/workspaces/${workspaceId}/agents/{agentId}/sessions/sessions.json`,
    );
  });
});
