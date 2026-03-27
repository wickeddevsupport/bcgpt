import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveWorkspaceRoute = vi.hoisted(() => vi.fn());
const recordInboundSession = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../gateway/workspace-routing.js", () => ({
  resolveWorkspaceRoute,
}));

vi.mock("../channels/session.js", () => ({
  recordInboundSession,
}));

import { buildTelegramMessageContext } from "./bot-message-context.js";

describe("telegram message context workspace routing", () => {
  beforeEach(() => {
    resolveWorkspaceRoute.mockReset();
    recordInboundSession.mockReset();
  });

  it("records inbound sessions using the workspace-effective store path", async () => {
    resolveWorkspaceRoute.mockResolvedValue({
      workspaceId: "ws-telegram",
      cfg: {
        session: {
          store: "~/.openclaw/workspaces/ws-telegram/agents/{agentId}/sessions/sessions.json",
        },
        messages: {},
      },
      route: {
        agentId: "workspace-assistant",
        channel: "telegram",
        accountId: "rohit",
        sessionKey: "agent:workspace-assistant:main",
        mainSessionKey: "agent:workspace-assistant:main",
        matchedBy: "binding.peer",
      },
    });

    await buildTelegramMessageContext({
      primaryCtx: {
        message: {
          message_id: 1,
          chat: { id: 1234, type: "private" },
          date: 1700000000,
          text: "hello",
          from: { id: 42, first_name: "Rohit" },
        },
        me: { id: 7, username: "bot" },
      } as never,
      allMedia: [],
      storeAllowFrom: [],
      options: {},
      bot: {
        api: {
          sendChatAction: vi.fn(),
          setMessageReaction: vi.fn(),
        },
      } as never,
      cfg: {
        session: {
          store: "~/.openclaw/agents/{agentId}/sessions/sessions.json",
        },
        channels: { telegram: {} },
        messages: { groupChat: { mentionPatterns: [] } },
      } as never,
      account: { accountId: "rohit" } as never,
      historyLimit: 0,
      groupHistories: new Map(),
      dmPolicy: "open",
      allowFrom: [],
      groupAllowFrom: [],
      ackReactionScope: "off",
      logger: { info: vi.fn() },
      resolveGroupActivation: () => undefined,
      resolveGroupRequireMention: () => false,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: false },
        topicConfig: undefined,
      }),
    });

    expect(recordInboundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        storePath: expect.stringContaining(
          path.join("workspaces", "ws-telegram", "agents", "workspace-assistant", "sessions", "sessions.json"),
        ),
      }),
    );
  });
});
