import fs from "node:fs/promises";
import os from "node:os";
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
    try {
      await fs.rm(path.join(os.homedir(), ".openclaw", "workspaces", workspaceId), {
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
      routing: {
        bindings: [
          {
            agentId: "assistant",
            match: { channel: "discord", accountId: "legacy-rajan" },
          },
        ],
      },
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
    expect((effective.routing as Record<string, unknown> | undefined)?.bindings).toBeUndefined();
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
    expect((effective.routing as Record<string, unknown> | undefined)?.defaultAgentId).toBe("assistant");
    expect(session?.store).toBe(
      `~/.openclaw/workspaces/${workspaceId}/agents/{agentId}/sessions/sessions.json`,
    );
    expect(cron?.store).toBe(`~/.openclaw/workspaces/${workspaceId}/cron/jobs.json`);
  });

  it("merges leaked same-workspace global agents into the workspace effective config", async () => {
    mockGlobalConfig = {
      agents: {
        list: [
          { id: "assistant", default: true },
          { id: "growth-hacker", workspaceId, model: "github-copilot/gpt-4.1" },
          { id: "rajan-only", workspaceId: "ws-other", model: "github-copilot/gpt-4.1" },
        ],
      },
    };

    const { loadEffectiveWorkspaceConfig, writeWorkspaceConfig } = await import("./workspace-config.js");
    await writeWorkspaceConfig(workspaceId, {
      agents: {
        list: [{ id: "assistant", default: true, workspaceId }],
      },
    });

    const effective = await loadEffectiveWorkspaceConfig(workspaceId);
    const agents = ((effective.agents as Record<string, unknown> | undefined)?.list ?? []) as Array<
      Record<string, unknown>
    >;

    expect(agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "assistant", workspaceId }),
        expect.objectContaining({
          id: "growth-hacker",
          workspaceId,
          model: "github-copilot/gpt-4.1",
        }),
      ]),
    );
    expect(agents.find((entry) => entry.id === "rajan-only")).toBeUndefined();
  });

  it("enables full-mesh agent collaboration defaults inside a workspace office", async () => {
    mockGlobalConfig = {
      tools: {
        agentToAgent: {
          enabled: false,
        },
      },
      agents: {
        list: [
          { id: "assistant", default: true, workspaceId },
          { id: "marketing-agent", workspaceId },
          { id: "pm-agent", workspaceId, subagents: { allowAgents: ["marketing-agent"] } },
        ],
      },
    };

    const { loadEffectiveWorkspaceConfig } = await import("./workspace-config.js");
    const effective = await loadEffectiveWorkspaceConfig(workspaceId);
    const tools = effective.tools as Record<string, unknown> | undefined;
    const a2a = tools?.agentToAgent as Record<string, unknown> | undefined;
    const agents = ((effective.agents as Record<string, unknown> | undefined)?.list ?? []) as Array<
      Record<string, unknown>
    >;
    const assistant = agents.find((entry) => entry.id === "assistant");
    const marketing = agents.find((entry) => entry.id === "marketing-agent");
    const pm = agents.find((entry) => entry.id === "pm-agent");

    expect(a2a?.enabled).toBe(true);
    expect(a2a?.allow).toEqual(["*"]);
    expect((assistant?.subagents as Record<string, unknown> | undefined)?.allowAgents).toEqual(["*"]);
    expect((marketing?.subagents as Record<string, unknown> | undefined)?.allowAgents).toEqual(["*"]);
    expect((pm?.subagents as Record<string, unknown> | undefined)?.allowAgents).toEqual([
      "marketing-agent",
    ]);
  });

  it("normalizes shared assistant workspace paths to per-agent workspace paths", async () => {
    const { loadEffectiveWorkspaceConfig, writeWorkspaceConfig } = await import("./workspace-config.js");
    await writeWorkspaceConfig(workspaceId, {
      agents: {
        list: [
          {
            id: "assistant",
            default: true,
            workspaceId,
            workspace: `~/.openclaw/workspaces/${workspaceId}/assistant`,
          },
          {
            id: "marketing-agent",
            workspaceId,
            workspace: `~/.openclaw/workspaces/${workspaceId}/assistant`,
          },
        ],
      },
    });

    const effective = await loadEffectiveWorkspaceConfig(workspaceId);
    const agents = ((effective.agents as Record<string, unknown> | undefined)?.list ?? []) as Array<
      Record<string, unknown>
    >;
    const assistant = agents.find((entry) => entry.id === "assistant");
    const marketing = agents.find((entry) => entry.id === "marketing-agent");

    expect(assistant?.workspace).toBe(`~/.openclaw/workspaces/${workspaceId}/assistant`);
    expect(marketing?.workspace).toBe(`~/.openclaw/workspaces/${workspaceId}/marketing-agent`);
  });

  it("seeds bound main-session delivery targets from workspace channel bindings", async () => {
    const { loadEffectiveWorkspaceConfig, writeWorkspaceConfig } = await import("./workspace-config.js");
    await writeWorkspaceConfig(workspaceId, {
      agents: {
        list: [
          { id: "assistant", default: true, workspaceId },
          { id: "marketing-agent", workspaceId },
        ],
      },
      bindings: [
        {
          agentId: "assistant",
          match: { channel: "discord", accountId: "*" },
        },
        {
          agentId: "marketing-agent",
          match: { channel: "discord", channelId: "1486842570708357270" },
        },
      ],
    });

    const effective = await loadEffectiveWorkspaceConfig(workspaceId);
    const { resolveStorePath } = await import("../config/sessions/paths.js");
    const { loadSessionStore } = await import("../config/sessions/store.js");
    const storePath = resolveStorePath(
      (effective.session as Record<string, unknown> | undefined)?.store as string | undefined,
      {
        agentId: "marketing-agent",
      },
    );
    const store = loadSessionStore(storePath, { skipCache: true });
    const entry = store["agent:marketing-agent:main"];

    expect(entry?.lastChannel).toBe("discord");
    expect(entry?.lastTo).toBe("channel:1486842570708357270");
    expect(entry?.deliveryContext).toEqual(
      expect.objectContaining({
        channel: "discord",
        to: "channel:1486842570708357270",
      }),
    );
  });
});
