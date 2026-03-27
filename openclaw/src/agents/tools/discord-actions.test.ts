import { describe, expect, it, vi } from "vitest";
import type { DiscordActionConfig, OpenClawConfig } from "../../config/config.js";
import { handleDiscordGuildAction } from "./discord-actions-guild.js";
import { handleDiscordMessagingAction } from "./discord-actions-messaging.js";
import { handleDiscordModerationAction } from "./discord-actions-moderation.js";

const createChannelDiscord = vi.fn(async () => ({
  id: "new-channel",
  name: "test",
  type: 0,
}));
const createThreadDiscord = vi.fn(async () => ({}));
const deleteChannelDiscord = vi.fn(async () => ({ ok: true, channelId: "C1" }));
const deleteMessageDiscord = vi.fn(async () => ({}));
const editChannelDiscord = vi.fn(async () => ({
  id: "C1",
  name: "edited",
}));
const editMessageDiscord = vi.fn(async () => ({}));
const fetchMessageDiscord = vi.fn(async () => ({}));
const fetchChannelPermissionsDiscord = vi.fn(async () => ({}));
const fetchReactionsDiscord = vi.fn(async () => ({}));
const listGuildChannelsDiscord = vi.fn(async () => []);
const listPinsDiscord = vi.fn(async () => ({}));
const listThreadsDiscord = vi.fn(async () => ({}));
const moveChannelDiscord = vi.fn(async () => ({ ok: true }));
const pinMessageDiscord = vi.fn(async () => ({}));
const reactMessageDiscord = vi.fn(async () => ({}));
const readMessagesDiscord = vi.fn(async () => []);
const removeChannelPermissionDiscord = vi.fn(async () => ({ ok: true }));
const removeOwnReactionsDiscord = vi.fn(async () => ({ removed: ["thumbs_up"] }));
const removeReactionDiscord = vi.fn(async () => ({}));
const searchMessagesDiscord = vi.fn(async () => ({}));
const sendMessageDiscord = vi.fn(async () => ({}));
const sendPollDiscord = vi.fn(async () => ({}));
const sendStickerDiscord = vi.fn(async () => ({}));
const setChannelPermissionDiscord = vi.fn(async () => ({ ok: true }));
const unpinMessageDiscord = vi.fn(async () => ({}));
const timeoutMemberDiscord = vi.fn(async () => ({}));
const kickMemberDiscord = vi.fn(async () => ({}));
const banMemberDiscord = vi.fn(async () => ({}));

vi.mock("../../discord/send.js", () => ({
  banMemberDiscord: (...args: unknown[]) => banMemberDiscord(...args),
  createChannelDiscord: (...args: unknown[]) => createChannelDiscord(...args),
  createThreadDiscord: (...args: unknown[]) => createThreadDiscord(...args),
  deleteChannelDiscord: (...args: unknown[]) => deleteChannelDiscord(...args),
  deleteMessageDiscord: (...args: unknown[]) => deleteMessageDiscord(...args),
  editChannelDiscord: (...args: unknown[]) => editChannelDiscord(...args),
  editMessageDiscord: (...args: unknown[]) => editMessageDiscord(...args),
  fetchMessageDiscord: (...args: unknown[]) => fetchMessageDiscord(...args),
  fetchChannelPermissionsDiscord: (...args: unknown[]) => fetchChannelPermissionsDiscord(...args),
  fetchReactionsDiscord: (...args: unknown[]) => fetchReactionsDiscord(...args),
  kickMemberDiscord: (...args: unknown[]) => kickMemberDiscord(...args),
  listGuildChannelsDiscord: (...args: unknown[]) => listGuildChannelsDiscord(...args),
  listPinsDiscord: (...args: unknown[]) => listPinsDiscord(...args),
  listThreadsDiscord: (...args: unknown[]) => listThreadsDiscord(...args),
  moveChannelDiscord: (...args: unknown[]) => moveChannelDiscord(...args),
  pinMessageDiscord: (...args: unknown[]) => pinMessageDiscord(...args),
  reactMessageDiscord: (...args: unknown[]) => reactMessageDiscord(...args),
  readMessagesDiscord: (...args: unknown[]) => readMessagesDiscord(...args),
  removeChannelPermissionDiscord: (...args: unknown[]) => removeChannelPermissionDiscord(...args),
  removeOwnReactionsDiscord: (...args: unknown[]) => removeOwnReactionsDiscord(...args),
  removeReactionDiscord: (...args: unknown[]) => removeReactionDiscord(...args),
  searchMessagesDiscord: (...args: unknown[]) => searchMessagesDiscord(...args),
  sendMessageDiscord: (...args: unknown[]) => sendMessageDiscord(...args),
  sendPollDiscord: (...args: unknown[]) => sendPollDiscord(...args),
  sendStickerDiscord: (...args: unknown[]) => sendStickerDiscord(...args),
  setChannelPermissionDiscord: (...args: unknown[]) => setChannelPermissionDiscord(...args),
  timeoutMemberDiscord: (...args: unknown[]) => timeoutMemberDiscord(...args),
  unpinMessageDiscord: (...args: unknown[]) => unpinMessageDiscord(...args),
}));

const enableAllActions = () => true;
const disabledActions = (key: keyof DiscordActionConfig) => key !== "reactions";
const channelInfoEnabled = (key: keyof DiscordActionConfig) => key === "channelInfo";
const channelsEnabled = (key: keyof DiscordActionConfig) => key === "channels";
const channelsDisabled = () => false;
const moderationEnabled = (key: keyof DiscordActionConfig) => key === "moderation";
const workspaceCfg = { channels: { discord: { actions: {} } } } as unknown as OpenClawConfig;

const callMessaging = (
  action: string,
  params: Record<string, unknown>,
  gate: (key: keyof DiscordActionConfig) => boolean = enableAllActions,
) => handleDiscordMessagingAction(action, params, gate, workspaceCfg);

const callGuild = (
  action: string,
  params: Record<string, unknown>,
  gate: (key: keyof DiscordActionConfig) => boolean,
) => handleDiscordGuildAction(action, params, gate, workspaceCfg);

const callModeration = (
  action: string,
  params: Record<string, unknown>,
  gate: (key: keyof DiscordActionConfig) => boolean,
) => handleDiscordModerationAction(action, params, gate, workspaceCfg);

describe("handleDiscordMessagingAction", () => {
  it("adds reactions", async () => {
    await callMessaging("react", {
      channelId: "C1",
      messageId: "M1",
      emoji: "check",
    });
    expect(reactMessageDiscord).toHaveBeenCalledWith("C1", "M1", "check", { cfg: workspaceCfg });
  });

  it("forwards accountId for reactions", async () => {
    await callMessaging("react", {
      channelId: "C1",
      messageId: "M1",
      emoji: "check",
      accountId: "ops",
    });
    expect(reactMessageDiscord).toHaveBeenCalledWith("C1", "M1", "check", {
      accountId: "ops",
      cfg: workspaceCfg,
    });
  });

  it("removes reactions on empty emoji", async () => {
    await callMessaging("react", {
      channelId: "C1",
      messageId: "M1",
      emoji: "",
    });
    expect(removeOwnReactionsDiscord).toHaveBeenCalledWith("C1", "M1", { cfg: workspaceCfg });
  });

  it("removes reactions when remove flag set", async () => {
    await callMessaging("react", {
      channelId: "C1",
      messageId: "M1",
      emoji: "check",
      remove: true,
    });
    expect(removeReactionDiscord).toHaveBeenCalledWith("C1", "M1", "check", {
      cfg: workspaceCfg,
    });
  });

  it("rejects removes without emoji", async () => {
    await expect(
      callMessaging("react", {
        channelId: "C1",
        messageId: "M1",
        emoji: "",
        remove: true,
      }),
    ).rejects.toThrow(/Emoji is required/);
  });

  it("respects reaction gating", async () => {
    await expect(
      callMessaging(
        "react",
        {
          channelId: "C1",
          messageId: "M1",
          emoji: "check",
        },
        disabledActions,
      ),
    ).rejects.toThrow(/Discord reactions are disabled/);
  });

  it("adds normalized timestamps to readMessages payloads", async () => {
    readMessagesDiscord.mockResolvedValueOnce([{ id: "1", timestamp: "2026-01-15T10:00:00.000Z" }]);
    const result = await callMessaging("readMessages", { channelId: "C1" });
    const payload = result.details as {
      messages: Array<{ timestampMs?: number; timestampUtc?: string }>;
    };

    const expectedMs = Date.parse("2026-01-15T10:00:00.000Z");
    expect(payload.messages[0].timestampMs).toBe(expectedMs);
    expect(payload.messages[0].timestampUtc).toBe(new Date(expectedMs).toISOString());
  });

  it("adds normalized timestamps to fetchMessage payloads", async () => {
    fetchMessageDiscord.mockResolvedValueOnce({
      id: "1",
      timestamp: "2026-01-15T11:00:00.000Z",
    });

    const result = await callMessaging("fetchMessage", {
      guildId: "G1",
      channelId: "C1",
      messageId: "M1",
    });
    const payload = result.details as { message?: { timestampMs?: number; timestampUtc?: string } };

    const expectedMs = Date.parse("2026-01-15T11:00:00.000Z");
    expect(payload.message?.timestampMs).toBe(expectedMs);
    expect(payload.message?.timestampUtc).toBe(new Date(expectedMs).toISOString());
  });

  it("adds normalized timestamps to listPins payloads", async () => {
    listPinsDiscord.mockResolvedValueOnce([{ id: "1", timestamp: "2026-01-15T12:00:00.000Z" }]);

    const result = await callMessaging("listPins", { channelId: "C1" });
    const payload = result.details as {
      pins: Array<{ timestampMs?: number; timestampUtc?: string }>;
    };

    const expectedMs = Date.parse("2026-01-15T12:00:00.000Z");
    expect(payload.pins[0].timestampMs).toBe(expectedMs);
    expect(payload.pins[0].timestampUtc).toBe(new Date(expectedMs).toISOString());
  });

  it("adds normalized timestamps to searchMessages payloads", async () => {
    searchMessagesDiscord.mockResolvedValueOnce({
      total_results: 1,
      messages: [[{ id: "1", timestamp: "2026-01-15T13:00:00.000Z" }]],
    });

    const result = await callMessaging("searchMessages", { guildId: "G1", content: "hi" });
    const payload = result.details as {
      results?: { messages?: Array<Array<{ timestampMs?: number; timestampUtc?: string }>> };
    };

    const expectedMs = Date.parse("2026-01-15T13:00:00.000Z");
    expect(payload.results?.messages?.[0]?.[0]?.timestampMs).toBe(expectedMs);
    expect(payload.results?.messages?.[0]?.[0]?.timestampUtc).toBe(
      new Date(expectedMs).toISOString(),
    );
  });

  it("forwards optional thread content", async () => {
    createThreadDiscord.mockClear();
    await callMessaging("threadCreate", {
      channelId: "C1",
      name: "Forum thread",
      content: "Initial forum post body",
    });
    expect(createThreadDiscord).toHaveBeenCalledWith(
      "C1",
      {
        name: "Forum thread",
        messageId: undefined,
        autoArchiveMinutes: undefined,
        content: "Initial forum post body",
      },
      { cfg: workspaceCfg },
    );
  });
});

describe("handleDiscordGuildAction - channel management", () => {
  it("creates a channel", async () => {
    const result = await callGuild(
      "channelCreate",
      {
        guildId: "G1",
        name: "test-channel",
        type: 0,
        topic: "Test topic",
      },
      channelsEnabled,
    );
    expect(createChannelDiscord).toHaveBeenCalledWith(
      {
        guildId: "G1",
        name: "test-channel",
        type: 0,
        parentId: undefined,
        topic: "Test topic",
        position: undefined,
        nsfw: undefined,
      },
      { cfg: workspaceCfg },
    );
    expect(result.details).toMatchObject({ ok: true });
  });

  it("respects channel gating for channelCreate", async () => {
    await expect(
      callGuild("channelCreate", { guildId: "G1", name: "test" }, channelsDisabled),
    ).rejects.toThrow(/Discord channel management is disabled/);
  });

  it("forwards accountId for channelList", async () => {
    await callGuild("channelList", { guildId: "G1", accountId: "ops" }, channelInfoEnabled);
    expect(listGuildChannelsDiscord).toHaveBeenCalledWith("G1", {
      accountId: "ops",
      cfg: workspaceCfg,
    });
  });

  it("edits a channel", async () => {
    await callGuild(
      "channelEdit",
      {
        channelId: "C1",
        name: "new-name",
        topic: "new topic",
      },
      channelsEnabled,
    );
    expect(editChannelDiscord).toHaveBeenCalledWith(
      {
        channelId: "C1",
        name: "new-name",
        topic: "new topic",
        position: undefined,
        parentId: undefined,
        nsfw: undefined,
        rateLimitPerUser: undefined,
      },
      { cfg: workspaceCfg },
    );
  });

  it("clears the channel parent when parentId is null", async () => {
    await callGuild(
      "channelEdit",
      {
        channelId: "C1",
        parentId: null,
      },
      channelsEnabled,
    );
    expect(editChannelDiscord).toHaveBeenCalledWith(
      {
        channelId: "C1",
        name: undefined,
        topic: undefined,
        position: undefined,
        parentId: null,
        nsfw: undefined,
        rateLimitPerUser: undefined,
      },
      { cfg: workspaceCfg },
    );
  });

  it("clears the channel parent when clearParent is true", async () => {
    await callGuild(
      "channelEdit",
      {
        channelId: "C1",
        clearParent: true,
      },
      channelsEnabled,
    );
    expect(editChannelDiscord).toHaveBeenCalledWith(
      {
        channelId: "C1",
        name: undefined,
        topic: undefined,
        position: undefined,
        parentId: null,
        nsfw: undefined,
        rateLimitPerUser: undefined,
      },
      { cfg: workspaceCfg },
    );
  });

  it("deletes a channel", async () => {
    await callGuild("channelDelete", { channelId: "C1" }, channelsEnabled);
    expect(deleteChannelDiscord).toHaveBeenCalledWith("C1", { cfg: workspaceCfg });
  });

  it("moves a channel", async () => {
    await callGuild(
      "channelMove",
      {
        guildId: "G1",
        channelId: "C1",
        parentId: "P1",
        position: 5,
      },
      channelsEnabled,
    );
    expect(moveChannelDiscord).toHaveBeenCalledWith(
      {
        guildId: "G1",
        channelId: "C1",
        parentId: "P1",
        position: 5,
      },
      { cfg: workspaceCfg },
    );
  });

  it("clears the channel parent on move when parentId is null", async () => {
    await callGuild(
      "channelMove",
      {
        guildId: "G1",
        channelId: "C1",
        parentId: null,
      },
      channelsEnabled,
    );
    expect(moveChannelDiscord).toHaveBeenCalledWith(
      {
        guildId: "G1",
        channelId: "C1",
        parentId: null,
        position: undefined,
      },
      { cfg: workspaceCfg },
    );
  });

  it("clears the channel parent on move when clearParent is true", async () => {
    await callGuild(
      "channelMove",
      {
        guildId: "G1",
        channelId: "C1",
        clearParent: true,
      },
      channelsEnabled,
    );
    expect(moveChannelDiscord).toHaveBeenCalledWith(
      {
        guildId: "G1",
        channelId: "C1",
        parentId: null,
        position: undefined,
      },
      { cfg: workspaceCfg },
    );
  });

  it("creates a category with type=4", async () => {
    await callGuild("categoryCreate", { guildId: "G1", name: "My Category" }, channelsEnabled);
    expect(createChannelDiscord).toHaveBeenCalledWith(
      {
        guildId: "G1",
        name: "My Category",
        type: 4,
        position: undefined,
      },
      { cfg: workspaceCfg },
    );
  });

  it("edits a category", async () => {
    await callGuild(
      "categoryEdit",
      { categoryId: "CAT1", name: "Renamed Category" },
      channelsEnabled,
    );
    expect(editChannelDiscord).toHaveBeenCalledWith(
      {
        channelId: "CAT1",
        name: "Renamed Category",
        position: undefined,
      },
      { cfg: workspaceCfg },
    );
  });

  it("deletes a category", async () => {
    await callGuild("categoryDelete", { categoryId: "CAT1" }, channelsEnabled);
    expect(deleteChannelDiscord).toHaveBeenCalledWith("CAT1", { cfg: workspaceCfg });
  });

  it("sets channel permissions for role", async () => {
    await callGuild(
      "channelPermissionSet",
      {
        channelId: "C1",
        targetId: "R1",
        targetType: "role",
        allow: "1024",
        deny: "2048",
      },
      channelsEnabled,
    );
    expect(setChannelPermissionDiscord).toHaveBeenCalledWith(
      {
        channelId: "C1",
        targetId: "R1",
        targetType: 0,
        allow: "1024",
        deny: "2048",
      },
      { cfg: workspaceCfg },
    );
  });

  it("sets channel permissions for member", async () => {
    await callGuild(
      "channelPermissionSet",
      {
        channelId: "C1",
        targetId: "U1",
        targetType: "member",
        allow: "1024",
      },
      channelsEnabled,
    );
    expect(setChannelPermissionDiscord).toHaveBeenCalledWith(
      {
        channelId: "C1",
        targetId: "U1",
        targetType: 1,
        allow: "1024",
        deny: undefined,
      },
      { cfg: workspaceCfg },
    );
  });

  it("removes channel permissions", async () => {
    await callGuild(
      "channelPermissionRemove",
      { channelId: "C1", targetId: "R1" },
      channelsEnabled,
    );
    expect(removeChannelPermissionDiscord).toHaveBeenCalledWith("C1", "R1", {
      cfg: workspaceCfg,
    });
  });
});

describe("handleDiscordModerationAction", () => {
  it("forwards accountId for timeout", async () => {
    await callModeration(
      "timeout",
      {
        guildId: "G1",
        userId: "U1",
        durationMinutes: 5,
        accountId: "ops",
      },
      moderationEnabled,
    );
    expect(timeoutMemberDiscord).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: "G1",
        userId: "U1",
        durationMinutes: 5,
      }),
      { accountId: "ops", cfg: workspaceCfg },
    );
  });
});

describe("workspace cfg forwarding", () => {
  it("passes workspace cfg into sendMessage calls", async () => {
    sendMessageDiscord.mockClear();
    await callMessaging("sendMessage", {
      to: "channel:C1",
      content: "hello",
    });
    expect(sendMessageDiscord).toHaveBeenCalledWith(
      "channel:C1",
      "hello",
      expect.objectContaining({ cfg: workspaceCfg }),
    );
  });

  it("passes workspace cfg into permission reads", async () => {
    fetchChannelPermissionsDiscord.mockClear();
    await callMessaging("permissions", {
      channelId: "C1",
    });
    expect(fetchChannelPermissionsDiscord).toHaveBeenCalledWith(
      "C1",
      expect.objectContaining({ cfg: workspaceCfg }),
    );
  });
});
