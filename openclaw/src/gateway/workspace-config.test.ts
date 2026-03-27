import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockGlobalConfig: Record<string, unknown> = {};

vi.mock("../config/config.js", () => ({
  loadConfig: () => mockGlobalConfig,
}));

describe("workspace-config isolation", () => {
  const workspaceId = "ws-config-isolation";

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
      // ignore test cleanup issues
    }
  });

  it("strips cross-workspace global channel and identity state from effective config", async () => {
    mockGlobalConfig = {
      channels: {
        discord: {
          token: "global-discord-token",
        },
      },
      env: {
        vars: {
          DISCORD_BOT_TOKEN: "global-env-token",
        },
      },
      bindings: [
        {
          agentId: "assistant",
          match: { channel: "discord", accountId: "rajan" },
        },
      ],
      session: {
        mainKey: "main",
        identityLinks: {
          rajan: ["discord:123"],
        },
      },
      models: {
        providers: {
          kilo: {
            apiKey: "shared-model-key",
          },
        },
      },
    };

    const { loadEffectiveWorkspaceConfig, writeWorkspaceConfig } = await import("./workspace-config.js");
    await writeWorkspaceConfig(workspaceId, {
      session: {
        store: `~/.openclaw/workspaces/${workspaceId}/agents/{agentId}/sessions/sessions.json`,
      },
    });

    const effective = await loadEffectiveWorkspaceConfig(workspaceId);

    expect(effective.channels).toBeUndefined();
    expect(effective.env).toBeUndefined();
    expect(effective.bindings).toBeUndefined();
    expect((effective.session as Record<string, unknown> | undefined)?.identityLinks).toBeUndefined();
    expect((effective.session as Record<string, unknown> | undefined)?.mainKey).toBe("main");
    expect(
      ((((effective.models as Record<string, unknown> | undefined)?.providers as Record<string, unknown> | undefined)
        ?.kilo as Record<string, unknown> | undefined)?.apiKey),
    ).toBe("shared-model-key");
  });

  it("preserves explicit workspace-owned channel config", async () => {
    mockGlobalConfig = {
      channels: {
        discord: {
          token: "global-discord-token",
        },
      },
    };

    const { loadEffectiveWorkspaceConfig, writeWorkspaceConfig } = await import("./workspace-config.js");
    await writeWorkspaceConfig(workspaceId, {
      channels: {
        discord: {
          token: "workspace-discord-token",
          enabled: true,
        },
      },
      env: {
        vars: {
          DISCORD_BOT_TOKEN: "workspace-env-token",
        },
      },
      bindings: [
        {
          agentId: "assistant",
          match: { channel: "discord", accountId: "rohit" },
        },
      ],
    });

    const effective = await loadEffectiveWorkspaceConfig(workspaceId);

    expect(
      ((((effective.channels as Record<string, unknown> | undefined)?.discord as Record<string, unknown> | undefined)
        ?.token)),
    ).toBe("workspace-discord-token");
    expect(
      ((((effective.env as Record<string, unknown> | undefined)?.vars as Record<string, unknown> | undefined)
        ?.DISCORD_BOT_TOKEN)),
    ).toBe("workspace-env-token");
    expect(Array.isArray(effective.bindings)).toBe(true);
  });

  it("materializes workspace-scoped session, cron, and agent paths for inherited agents", async () => {
    mockGlobalConfig = {
      agents: {
        defaults: {
          workspace: "~/.openclaw/workspace-main",
        },
        list: [
          { id: "assistant", default: true },
          { id: "rajan-only", workspaceId: "other-workspace" },
        ],
      },
      session: {
        store: "~/.openclaw/agents/{agentId}/sessions/sessions.json",
      },
      cron: {
        store: "~/.openclaw/cron/jobs.json",
      },
    };

    const { loadEffectiveWorkspaceConfig } = await import("./workspace-config.js");
    const effective = await loadEffectiveWorkspaceConfig(workspaceId);
    const agents = ((effective.agents as Record<string, unknown> | undefined)?.list ?? []) as Array<
      Record<string, unknown>
    >;
    const defaults = (effective.agents as Record<string, unknown> | undefined)
      ?.defaults as Record<string, unknown> | undefined;
    const session = effective.session as Record<string, unknown> | undefined;
    const cron = effective.cron as Record<string, unknown> | undefined;

    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe("assistant");
    expect(agents[0]?.workspaceId).toBe(workspaceId);
    expect(defaults?.workspace).toBe(`~/.openclaw/workspaces/${workspaceId}/assistant`);
    expect(session?.store).toBe(
      `~/.openclaw/workspaces/${workspaceId}/agents/{agentId}/sessions/sessions.json`,
    );
    expect(cron?.store).toBe(`~/.openclaw/workspaces/${workspaceId}/cron/jobs.json`);
  });
});
