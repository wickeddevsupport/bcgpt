import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () =>
      ({
        session: { scope: "per-sender", mainKey: "main" },
      }) as never,
  };
});

import { createSessionsSpawnTool } from "./sessions-spawn-tool.js";

describe("sessions_spawn workspace scope", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
  });

  it("recovers workspaceId from workspace-scoped session store paths", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-1", acceptedAt: 1000 };
      }
      return { ok: true };
    });

    const tool = createSessionsSpawnTool({
      agentSessionKey: "discord:group:req",
      requesterAgentIdOverride: "assistant",
      config: {
        session: {
          scope: "per-sender",
          mainKey: "main",
          store: "~/.openclaw/workspaces/ws-rohit/agents/{agentId}/sessions/sessions.json",
        },
        agents: {
          list: [{ id: "assistant", default: true }],
        },
      } as never,
    });

    const result = await tool.execute("call-1", {
      task: "hello",
      thinking: "low",
    });

    expect(result.details).toMatchObject({ status: "accepted", runId: "run-1" });

    const requests = callGatewayMock.mock.calls.map(
      (call) => call[0] as { method?: string; params?: Record<string, unknown> },
    );
    expect(requests.find((request) => request.method === "sessions.patch")?.params?.workspaceId).toBe(
      "ws-rohit",
    );
    expect(requests.find((request) => request.method === "agent")?.params?.workspaceId).toBe(
      "ws-rohit",
    );
  });
});