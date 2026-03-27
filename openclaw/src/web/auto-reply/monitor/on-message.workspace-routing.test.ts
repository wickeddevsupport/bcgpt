import { beforeEach, describe, expect, it, vi } from "vitest";

const processMessage = vi.hoisted(() => vi.fn(async () => true));
const maybeBroadcastMessage = vi.hoisted(() => vi.fn(async () => false));
const applyGroupGating = vi.hoisted(() => vi.fn(() => ({ shouldProcess: true })));
const updateLastRouteInBackground = vi.hoisted(() => vi.fn());
const resolvePeerId = vi.hoisted(() => vi.fn(() => "group-123"));

vi.mock("./process-message.js", () => ({
  processMessage,
}));

vi.mock("./broadcast.js", () => ({
  maybeBroadcastMessage,
}));

vi.mock("./group-gating.js", () => ({
  applyGroupGating,
}));

vi.mock("./last-route.js", () => ({
  updateLastRouteInBackground,
}));

vi.mock("./peer.js", () => ({
  resolvePeerId,
}));

import { createWebOnMessageHandler } from "./on-message.js";

describe("web on-message workspace routing", () => {
  beforeEach(() => {
    processMessage.mockClear();
    maybeBroadcastMessage.mockClear();
    applyGroupGating.mockClear();
    updateLastRouteInBackground.mockClear();
    resolvePeerId.mockClear();
  });

  it("threads workspace-effective config through gating, route updates, and processing", async () => {
    const workspaceCfg = {
      session: {
        store: "~/.openclaw/workspaces/ws-rohit/agents/{agentId}/sessions/sessions.json",
      },
      agents: {
        list: [{ id: "assistant", workspaceId: "ws-rohit" }],
      },
    };

    const handler = createWebOnMessageHandler({
      cfg: {
        session: { store: "~/.openclaw/agents/{agentId}/sessions/sessions.json" },
      } as never,
      verbose: false,
      connectionId: "conn-1",
      maxMediaBytes: 1024,
      groupHistoryLimit: 10,
      groupHistories: new Map(),
      groupMemberNames: new Map(),
      echoTracker: {
        has: () => false,
        forget: () => {},
        rememberText: () => {},
        buildCombinedKey: () => "combined",
      } as never,
      backgroundTasks: new Set(),
      replyResolver: vi.fn() as never,
      replyLogger: { warn: vi.fn() } as never,
      baseMentionConfig: {} as never,
      account: { authDir: "/tmp/auth", accountId: "rohit" },
      resolveRoute: async () => ({
        workspaceId: "ws-rohit",
        cfg: workspaceCfg as never,
        route: {
          agentId: "assistant",
          channel: "whatsapp",
          accountId: "rohit",
          sessionKey: "agent:assistant:whatsapp:group:group-123",
          mainSessionKey: "agent:assistant:main",
          matchedBy: "binding.peer",
        },
      }),
    });

    await handler({
      body: "hello team",
      from: "+15551234567",
      to: "+15557654321",
      accountId: "rohit",
      chatType: "group",
      groupSubject: "Ops",
      senderName: "Rohit",
      senderJid: "123@s.whatsapp.net",
      senderE164: "+15551234567",
      conversationId: "ops-room",
    } as never);

    expect(updateLastRouteInBackground).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: workspaceCfg,
      }),
    );
    expect(applyGroupGating).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: workspaceCfg,
      }),
    );
    expect(maybeBroadcastMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: workspaceCfg,
      }),
    );
    expect(processMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: workspaceCfg,
      }),
    );
  });
});
