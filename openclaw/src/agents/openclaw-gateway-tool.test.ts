import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";
import { resolveAgentWorkspaceDir } from "./agent-scope.js";

vi.mock("./tools/gateway.js", () => ({
  callGatewayTool: vi.fn(async (method: string) => {
    if (method === "config.get") {
      return { hash: "hash-1" };
    }
    return { ok: true };
  }),
}));

describe("gateway tool", () => {
  it("schedules SIGUSR1 restart", async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    const previousProfile = process.env.OPENCLAW_PROFILE;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-test-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENCLAW_PROFILE = "isolated";

    try {
      const tool = createOpenClawTools({
        config: { commands: { restart: true } },
      }).find((candidate) => candidate.name === "gateway");
      expect(tool).toBeDefined();
      if (!tool) {
        throw new Error("missing gateway tool");
      }

      const result = await tool.execute("call1", {
        action: "restart",
        delayMs: 0,
      });
      expect(result.details).toMatchObject({
        ok: true,
        pid: process.pid,
        signal: "SIGUSR1",
        delayMs: 0,
      });

      const sentinelPath = path.join(stateDir, "restart-sentinel.json");
      const raw = await fs.readFile(sentinelPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        payload?: { kind?: string; doctorHint?: string | null };
      };
      expect(parsed.payload?.kind).toBe("restart");
      expect(parsed.payload?.doctorHint).toBe(
        "Run: openclaw --profile isolated doctor --non-interactive",
      );

      expect(kill).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(kill).toHaveBeenCalledWith(process.pid, "SIGUSR1");
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
      if (previousProfile === undefined) {
        delete process.env.OPENCLAW_PROFILE;
      } else {
        process.env.OPENCLAW_PROFILE = previousProfile;
      }
    }
  });

  it("passes config.apply through gateway call", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const tool = createOpenClawTools({
      agentSessionKey: "agent:main:whatsapp:dm:+15555550123",
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing gateway tool");
    }

    const raw = '{\n  agents: { defaults: { workspace: "~/openclaw" } }\n}\n';
    await tool.execute("call2", {
      action: "config.apply",
      raw,
    });

    expect(callGatewayTool).toHaveBeenCalledWith("config.get", expect.any(Object), {});
    expect(callGatewayTool).toHaveBeenCalledWith(
      "config.apply",
      expect.any(Object),
      expect.objectContaining({
        raw: raw.trim(),
        baseHash: "hash-1",
        sessionKey: "agent:main:whatsapp:dm:+15555550123",
      }),
    );
  });

  it("applies workspace config locally for workspace-scoped agents", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    vi.mocked(callGatewayTool).mockClear();

    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-ws-config-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;

    try {
      const tool = createOpenClawTools({
        agentSessionKey: "agent:assistant:webchat:session:abc",
        config: {
          agents: {
            list: [{ id: "assistant", workspaceId: "ws-rohit", default: true }],
          },
        },
      }).find((candidate) => candidate.name === "gateway");
      expect(tool).toBeDefined();
      if (!tool) {
        throw new Error("missing gateway tool");
      }

      const applyResult = await tool.execute("call-ws-apply", {
        action: "config.apply",
        raw: JSON.stringify({
          agents: {
            defaults: {
              model: {
                primary: "github-copilot/gpt-4.1",
              },
            },
          },
          models: {
            providers: {
              local: {
                apiKey: "secret-local-key",
              },
            },
          },
        }),
      });

      expect(applyResult.details).toMatchObject({
        ok: true,
        result: {
          ok: true,
          restart: {
            scheduled: false,
            reason: "workspace-config-no-gateway-restart",
          },
        },
      });
      expect(vi.mocked(callGatewayTool)).not.toHaveBeenCalled();

      const getResult = await tool.execute("call-ws-get", {
        action: "config.get",
      });
      expect(getResult.details).toMatchObject({
        ok: true,
        result: {
          path: expect.stringContaining(path.join("workspaces", "ws-rohit", "config.json")),
          config: {
            models: {
              providers: {
                local: {
                  apiKey: "__OPENCLAW_REDACTED__",
                },
              },
            },
          },
        },
      });

      const savedPath = (applyResult.details as { result?: { path?: string } }).result?.path;
      expect(typeof savedPath).toBe("string");
      const savedRaw = await fs.readFile(
        String(savedPath),
        "utf-8",
      );
      const saved = JSON.parse(savedRaw) as {
        models?: { providers?: { local?: { apiKey?: string } } };
      };
      expect(saved.models?.providers?.local?.apiKey).toBe("secret-local-key");
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  });

  it("refreshes the live workspace tool config after local config.apply", async () => {
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-ws-office-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;

    try {
      const sharedConfig = {
        agents: {
          list: [{ id: "assistant", workspaceId: "ws-rohit", default: true }],
        },
      };
      const tools = createOpenClawTools({
        agentSessionKey: "agent:assistant:webchat:session:abc",
        config: sharedConfig,
      });
      const gatewayTool = tools.find((candidate) => candidate.name === "gateway");
      const agentsListTool = tools.find((candidate) => candidate.name === "agents_list");
      expect(gatewayTool).toBeDefined();
      expect(agentsListTool).toBeDefined();
      if (!gatewayTool || !agentsListTool) {
        throw new Error("missing workspace tools");
      }

      await gatewayTool.execute("call-ws-office-apply", {
        action: "config.apply",
        raw: JSON.stringify({
          tools: {
            agentToAgent: {
              enabled: false,
            },
          },
          agents: {
            list: [
              { id: "assistant", workspaceId: "ws-rohit", default: true },
              { id: "marketing-agent", workspaceId: "ws-rohit" },
            ],
          },
        }),
      });

      const agentListResult = await agentsListTool.execute("call-ws-office-list", {});
      expect(agentListResult.details).toMatchObject({
        requester: "assistant",
        allowAny: true,
        agents: expect.arrayContaining([
          expect.objectContaining({ id: "assistant", configured: true }),
          expect.objectContaining({ id: "marketing-agent", configured: true }),
        ]),
      });

      expect(sharedConfig).toMatchObject({
        tools: {
          agentToAgent: {
            enabled: true,
            allow: ["*"],
          },
        },
        agents: {
          list: expect.arrayContaining([
            expect.objectContaining({
              id: "assistant",
              subagents: { allowAgents: ["*"] },
            }),
            expect.objectContaining({
              id: "marketing-agent",
              subagents: { allowAgents: ["*"] },
            }),
          ]),
        },
      });
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  });

  it("lets workspace agents inspect coworker files locally", async () => {
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-ws-files-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;

    try {
      const sharedConfig = {
        agents: {
          list: [
            { id: "assistant", workspaceId: "ws-rohit", default: true },
            { id: "marketing-agent", workspaceId: "ws-rohit" },
          ],
        },
      };
      const marketingWorkspace = resolveAgentWorkspaceDir(
        sharedConfig as any,
        "marketing-agent",
      );
      await fs.mkdir(path.join(marketingWorkspace, "memory"), { recursive: true });
      await fs.writeFile(path.join(marketingWorkspace, "MEMORY.md"), "# Marketing memory\n", "utf-8");
      await fs.writeFile(
        path.join(marketingWorkspace, "memory", "campaign.md"),
        "# Campaign notes\n",
        "utf-8",
      );

      const gatewayTool = createOpenClawTools({
        agentSessionKey: "agent:assistant:webchat:session:abc",
        config: sharedConfig,
      }).find((candidate) => candidate.name === "gateway");
      expect(gatewayTool).toBeDefined();
      if (!gatewayTool) {
        throw new Error("missing workspace gateway tool");
      }

      const listResult = await gatewayTool.execute("call-ws-files-list", {
        action: "agents.files.list",
        agentId: "marketing-agent",
      });
      expect(listResult.details).toMatchObject({
        ok: true,
        result: {
          agentId: "marketing-agent",
          workspaceId: "ws-rohit",
          files: expect.arrayContaining([
            expect.objectContaining({ name: "MEMORY.md", missing: false }),
            expect.objectContaining({ name: "memory/campaign.md", missing: false }),
          ]),
        },
      });

      const getResult = await gatewayTool.execute("call-ws-files-get", {
        action: "agents.files.get",
        agentId: "marketing-agent",
        name: "memory/campaign.md",
      });
      expect(getResult.details).toMatchObject({
        ok: true,
        result: {
          agentId: "marketing-agent",
          workspaceId: "ws-rohit",
          file: expect.objectContaining({
            name: "memory/campaign.md",
            missing: false,
            content: "# Campaign notes\n",
          }),
        },
      });
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
    }
  });

  it("allows workspace-scoped agents to request gateway restart", async () => {
    vi.useFakeTimers();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const previousStateDir = process.env.OPENCLAW_STATE_DIR;
    const previousProfile = process.env.OPENCLAW_PROFILE;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-test-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENCLAW_PROFILE = "isolated";

    try {
      const tool = createOpenClawTools({
        agentSessionKey: "agent:assistant:webchat:session:abc",
        config: {
          commands: { restart: false },
          agents: {
            list: [{ id: "assistant", workspaceId: "ws-rohit", default: true }],
          },
        },
      }).find((candidate) => candidate.name === "gateway");
      expect(tool).toBeDefined();
      if (!tool) {
        throw new Error("missing gateway tool");
      }

      const result = await tool.execute("call-ws-restart", {
        action: "restart",
        delayMs: 0,
      });
      expect(result.details).toMatchObject({
        ok: true,
        pid: process.pid,
        signal: "SIGUSR1",
      });
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
      if (previousStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousStateDir;
      }
      if (previousProfile === undefined) {
        delete process.env.OPENCLAW_PROFILE;
      } else {
        process.env.OPENCLAW_PROFILE = previousProfile;
      }
    }
  });

  it("passes config.patch through gateway call", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const tool = createOpenClawTools({
      agentSessionKey: "agent:main:whatsapp:dm:+15555550123",
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing gateway tool");
    }

    const raw = '{\n  channels: { telegram: { groups: { "*": { requireMention: false } } } }\n}\n';
    await tool.execute("call4", {
      action: "config.patch",
      raw,
    });

    expect(callGatewayTool).toHaveBeenCalledWith("config.get", expect.any(Object), {});
    expect(callGatewayTool).toHaveBeenCalledWith(
      "config.patch",
      expect.any(Object),
      expect.objectContaining({
        raw: raw.trim(),
        baseHash: "hash-1",
        sessionKey: "agent:main:whatsapp:dm:+15555550123",
      }),
    );
  });

  it("passes update.run through gateway call", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const tool = createOpenClawTools({
      agentSessionKey: "agent:main:whatsapp:dm:+15555550123",
    }).find((candidate) => candidate.name === "gateway");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("missing gateway tool");
    }

    await tool.execute("call3", {
      action: "update.run",
      note: "test update",
    });

    expect(callGatewayTool).toHaveBeenCalledWith(
      "update.run",
      expect.any(Object),
      expect.objectContaining({
        note: "test update",
        sessionKey: "agent:main:whatsapp:dm:+15555550123",
      }),
    );
    const updateCall = vi
      .mocked(callGatewayTool)
      .mock.calls.find((call) => call[0] === "update.run");
    expect(updateCall).toBeDefined();
    if (updateCall) {
      const [, opts, params] = updateCall;
      expect(opts).toMatchObject({ timeoutMs: 20 * 60_000 });
      expect(params).toMatchObject({ timeoutMs: 20 * 60_000 });
    }
  });
});
