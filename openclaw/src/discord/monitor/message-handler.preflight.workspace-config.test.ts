import { ChannelType, MessageType } from "@buape/carbon";
import { describe, expect, it, vi } from "vitest";

vi.mock("./workspace-routing.js", () => ({
  resolveDiscordWorkspaceRoute: vi.fn(async () => ({
    workspaceId: "workspace-rohit",
    cfg: {
      channels: {
        discord: {
          groupPolicy: "open",
          guilds: {
            "guild-1": {
              requireMention: false,
              channels: {
                "channel-1": {
                  allow: true,
                  requireMention: false,
                },
              },
            },
          },
        },
      },
      commands: {
        useAccessGroups: true,
      },
      messages: {},
    },
    route: {
      agentId: "assistant",
      channel: "discord",
      accountId: "default",
      sessionKey: "agent:assistant:discord:channel:channel-1",
      mainSessionKey: "agent:assistant:main",
      matchedBy: "binding.channel",
    },
  })),
}));

vi.mock("./message-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./message-utils.js")>();
  return {
    ...actual,
    resolveDiscordChannelInfo: vi.fn(async () => ({
      id: "channel-1",
      name: "sales-agent",
      type: ChannelType.GuildText,
    })),
    resolveDiscordMessageText: vi.fn((message: { content?: string }) => message.content ?? ""),
  };
});

vi.mock("./threading.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./threading.js")>();
  return {
    ...actual,
    resolveDiscordThreadChannel: vi.fn(() => null),
    resolveDiscordThreadParentInfo: vi.fn(async () => ({
      id: undefined,
      name: undefined,
      type: undefined,
    })),
  };
});

const { preflightDiscordMessage } = await import("./message-handler.preflight.js");

describe("discord preflight workspace config", () => {
  it("honors workspace group policy and mention settings for unmentioned guild messages", async () => {
    const ctx = await preflightDiscordMessage({
      cfg: {
        channels: {
          discord: {
            groupPolicy: "allowlist",
          },
        },
        messages: {},
      } as any,
      discordConfig: {
        groupPolicy: "allowlist",
      } as any,
      accountId: "default",
      token: "token",
      runtime: { log: vi.fn(), error: vi.fn() } as any,
      botUserId: "bot-1",
      guildHistories: new Map(),
      historyLimit: 20,
      mediaMaxBytes: 1024 * 1024,
      textLimit: 4000,
      replyToMode: "off",
      dmEnabled: true,
      groupDmEnabled: false,
      groupDmChannels: undefined,
      allowFrom: undefined,
      guildEntries: undefined,
      ackReactionScope: "group-mentions",
      groupPolicy: "allowlist",
      data: {
        guild_id: "guild-1",
        guild: { id: "guild-1", name: "Wicked Websites" },
        member: null,
        author: {
          id: "user-1",
          bot: false,
          username: "Rohit",
          discriminator: "0",
          globalName: "Rohit",
        },
        message: {
          id: "msg-1",
          type: MessageType.Default,
          content: "please handle this normally",
          channelId: "channel-1",
          mentionedEveryone: false,
          mentionedUsers: [],
          mentionedRoles: [],
          attachments: [],
          timestamp: new Date().toISOString(),
        },
      } as any,
      client: {} as any,
    });

    expect(ctx).not.toBeNull();
    expect(ctx?.groupPolicy).toBe("open");
    expect(ctx?.shouldRequireMention).toBe(false);
    expect(ctx?.route.sessionKey).toBe("agent:assistant:discord:channel:channel-1");
  });
});
