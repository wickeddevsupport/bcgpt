import { beforeEach, describe, expect, it, vi } from "vitest";

const fakePlugin = {
  id: "discord",
  config: {
    listAccountIds: (cfg: Record<string, any>) => Object.keys(cfg.channels?.discord?.accounts ?? {}),
    resolveAccount: (cfg: Record<string, any>, accountId: string) =>
      cfg.channels?.discord?.accounts?.[accountId] ?? { enabled: true },
    isEnabled: (account: Record<string, any>) => account?.enabled !== false,
  },
  gateway: {
    startAccount: vi.fn(async ({ setStatus }: { setStatus: (next: Record<string, unknown>) => void }) => {
      setStatus({ connected: true });
    }),
    stopAccount: vi.fn(async () => {}),
  },
  status: {
    defaultRuntime: { accountId: "default" },
  },
  meta: {
    order: 1,
  },
};

vi.mock("../channels/plugins/index.js", () => ({
  listChannelPlugins: () => [fakePlugin],
  getChannelPlugin: () => fakePlugin,
}));

import { createChannelManager } from "./server-channels.js";

describe("channel manager runtime scopes", () => {
  beforeEach(() => {
    fakePlugin.gateway.startAccount.mockClear();
    fakePlugin.gateway.stopAccount.mockClear();
  });

  it("keeps workspace runtime state separate from the global runtime scope", async () => {
    const manager = createChannelManager({
      loadConfig: () =>
        ({
          channels: {
            discord: {
              accounts: {
                shared: { enabled: true },
              },
            },
          },
        }) as never,
      channelLogs: {
        discord: {
          error: vi.fn(),
        },
      } as never,
      channelRuntimeEnvs: {
        discord: {},
      } as never,
    });

    const workspaceCfg = {
      channels: {
        discord: {
          accounts: {
            shared: { enabled: true },
          },
        },
      },
    } as never;

    await manager.startChannel("discord" as never, "shared", {
      scopeKey: "workspace:rohit",
      cfg: workspaceCfg,
    });

    const workspaceSnapshot = manager.getRuntimeSnapshot({
      scopeKey: "workspace:rohit",
      cfg: workspaceCfg,
    });
    const globalSnapshot = manager.getRuntimeSnapshot({
      cfg: workspaceCfg,
    });

    expect(workspaceSnapshot.channelAccounts.discord?.shared?.connected).toBe(true);
    expect(globalSnapshot.channelAccounts.discord?.shared?.connected).not.toBe(true);
  });

  it("does not allow workspace runtime calls to fall back to global config", async () => {
    const manager = createChannelManager({
      loadConfig: () =>
        ({
          channels: {
            discord: {
              accounts: {
                shared: { enabled: true },
              },
            },
          },
        }) as never,
      channelLogs: {
        discord: {
          error: vi.fn(),
        },
      } as never,
      channelRuntimeEnvs: {
        discord: {},
      } as never,
    });

    await expect(
      manager.startChannel("discord" as never, "shared", {
        scopeKey: "workspace:rohit",
      }),
    ).rejects.toThrow(/workspace-scoped channel runtime requires cfg/i);

    expect(() =>
      manager.getRuntimeSnapshot({
        scopeKey: "workspace:rohit",
      }),
    ).toThrow(/workspace-scoped channel runtime requires cfg/i);
  });
});
