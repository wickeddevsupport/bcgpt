import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfigSnapshotHash } from "../../config/config.js";
import { REDACTED_SENTINEL } from "../../config/redact-snapshot.js";
import { installGatewayTestHooks } from "../test-helpers.server.js";
import { readWorkspaceConfig, workspaceConfigPath } from "../workspace-config.js";
import { configHandlers } from "./config.js";

installGatewayTestHooks();

async function cleanupWorkspace(workspaceId: string) {
  await fs.rm(path.dirname(workspaceConfigPath(workspaceId)), {
    recursive: true,
    force: true,
  });
}

describe("config handlers for workspace tenants", () => {
  const touchedWorkspaces = new Set<string>();

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const workspaceId of touchedWorkspaces) {
      await cleanupWorkspace(workspaceId);
    }
    touchedWorkspaces.clear();
  });

  it("lets workspace admins patch workspace config without super-admin and preserves secrets", async () => {
    const workspaceId = `cfg-patch-${Date.now()}`;
    touchedWorkspaces.add(workspaceId);
    const secret = "ws-secret-token";

    const respondSet = vi.fn();
    await configHandlers["config.set"]({
      params: {
        raw: JSON.stringify({
          models: {
            providers: {
              local: {
                apiKey: secret,
              },
            },
          },
        }),
      },
      respond: respondSet,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: workspaceId } as any,
    } as any);
    expect(respondSet.mock.calls[0]?.[0]).toBe(true);

    const respondGet = vi.fn();
    await configHandlers["config.get"]({
      params: {},
      respond: respondGet,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: workspaceId } as any,
    } as any);
    expect(respondGet.mock.calls[0]?.[0]).toBe(true);
    const getPayload = respondGet.mock.calls[0]?.[1] as Record<string, any>;
    expect(getPayload?.path).toBe(workspaceConfigPath(workspaceId));
    expect(getPayload?.config?.models?.providers?.local?.apiKey).toBe(REDACTED_SENTINEL);
    expect(String(getPayload?.raw ?? "")).toContain(REDACTED_SENTINEL);

    const baseHash = resolveConfigSnapshotHash({
      hash: getPayload?.hash,
      raw: getPayload?.raw,
    });
    expect(typeof baseHash).toBe("string");

    const respondPatch = vi.fn();
    await configHandlers["config.patch"]({
      params: {
        raw: JSON.stringify({
          agents: {
            defaults: {
              model: {
                primary: "local/demo",
              },
            },
          },
        }),
        baseHash,
      },
      respond: respondPatch,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: workspaceId } as any,
    } as any);
    expect(respondPatch.mock.calls[0]?.[0]).toBe(true);

    const saved = await readWorkspaceConfig(workspaceId);
    expect(saved?.models?.providers?.local?.apiKey).toBe(secret);
    expect(saved?.agents?.defaults?.model?.primary).toBe("local/demo");
  });

  it("lets workspace admins apply workspace config without scheduling a gateway restart", async () => {
    const workspaceId = `cfg-apply-${Date.now()}`;
    touchedWorkspaces.add(workspaceId);
    const secret = "ws-secret-apply";

    const respondSet = vi.fn();
    await configHandlers["config.set"]({
      params: {
        raw: JSON.stringify({
          models: {
            providers: {
              local: {
                apiKey: secret,
              },
            },
          },
          agents: {
            defaults: {
              model: {
                primary: "local/first",
              },
            },
          },
        }),
      },
      respond: respondSet,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: workspaceId } as any,
    } as any);
    expect(respondSet.mock.calls[0]?.[0]).toBe(true);

    const respondGet = vi.fn();
    await configHandlers["config.get"]({
      params: {},
      respond: respondGet,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: workspaceId } as any,
    } as any);
    const getPayload = respondGet.mock.calls[0]?.[1] as Record<string, any>;
    const redactedConfig = getPayload?.config as Record<string, unknown>;
    const baseHash = resolveConfigSnapshotHash({
      hash: getPayload?.hash,
      raw: getPayload?.raw,
    });

    const respondApply = vi.fn();
    await configHandlers["config.apply"]({
      params: {
        raw: JSON.stringify({
          ...redactedConfig,
          agents: {
            ...((redactedConfig?.agents as Record<string, unknown>) ?? {}),
            defaults: {
              ...((((redactedConfig?.agents as Record<string, unknown>) ?? {})
                .defaults as Record<string, unknown>) ?? {}),
              model: {
                primary: "local/second",
              },
            },
          },
        }),
        baseHash,
      },
      respond: respondApply,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: workspaceId } as any,
    } as any);
    expect(respondApply.mock.calls[0]?.[0]).toBe(true);
    const applyPayload = respondApply.mock.calls[0]?.[1] as Record<string, any>;
    expect(applyPayload?.restart).toEqual({
      scheduled: false,
      reason: "workspace-config-no-gateway-restart",
    });

    const saved = await readWorkspaceConfig(workspaceId);
    expect(saved?.models?.providers?.local?.apiKey).toBe(secret);
    expect(saved?.agents?.defaults?.model?.primary).toBe("local/second");
  });

  it("auto-enables office collaboration defaults for workspace agent configs", async () => {
    const workspaceId = `cfg-office-${Date.now()}`;
    touchedWorkspaces.add(workspaceId);

    const respondSet = vi.fn();
    await configHandlers["config.set"]({
      params: {
        raw: JSON.stringify({
          agents: {
            list: [
              { id: "assistant", workspaceId, default: true },
              { id: "marketing-agent", workspaceId },
              { id: "pm-agent", workspaceId, subagents: { allowAgents: ["marketing-agent"] } },
            ],
          },
          tools: {
            agentToAgent: {
              enabled: false,
            },
          },
        }),
      },
      respond: respondSet,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: workspaceId } as any,
    } as any);

    expect(respondSet.mock.calls[0]?.[0]).toBe(true);

    const saved = await readWorkspaceConfig(workspaceId);
    const tools = saved?.tools as Record<string, any> | undefined;
    const agents = (saved?.agents?.list ?? []) as Array<Record<string, any>>;
    const assistant = agents.find((entry) => entry.id === "assistant");
    const marketing = agents.find((entry) => entry.id === "marketing-agent");
    const pm = agents.find((entry) => entry.id === "pm-agent");

    expect(tools?.agentToAgent?.enabled).toBe(true);
    expect(tools?.agentToAgent?.allow).toEqual(["*"]);
    expect(assistant?.subagents?.allowAgents).toEqual(["*"]);
    expect(marketing?.subagents?.allowAgents).toEqual(["*"]);
    expect(pm?.subagents?.allowAgents).toEqual(["marketing-agent"]);
  });
});
