import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cronHandlers } from "./cron.js";
import { writeWorkspaceConfig, workspaceConfigPath, loadEffectiveWorkspaceConfig } from "../workspace-config.js";
import { resolveCronStorePath } from "../../cron/store.js";

describe("cron workspace isolation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("assigns workspaceId and workspace default agent when PMOS adds a cron job", async () => {
    const workspaceId = `cron-ws-${Date.now()}`;
    await writeWorkspaceConfig(workspaceId, {
      agents: {
        list: [
          {
            id: "assistant",
            default: true,
            workspaceId,
          },
        ],
      },
    });

    const respond = vi.fn();
    const add = vi.fn(async (job) => job);

    await cronHandlers["cron.add"]({
      params: {
        name: "Workspace reminder",
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "hello" },
      },
      respond,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: workspaceId } as any,
      context: {
        cron: {
          add,
          list: async () => [
            {
              id: "job-1",
              enabled: true,
              workspaceId,
              agentId: "assistant",
              schedule: { kind: "every", everyMs: 60_000 },
            },
          ],
        },
      } as any,
    } as any);

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        agentId: "assistant",
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        workspaceId,
        agentId: "assistant",
      }),
      undefined,
    );
    const effectiveCfg = await loadEffectiveWorkspaceConfig(workspaceId);
    const cronStorePath = resolveCronStorePath(
      (effectiveCfg as { cron?: { store?: string } }).cron?.store,
    );
    const stored = JSON.parse(await fs.readFile(cronStorePath, "utf-8")) as {
      jobs?: Array<{ workspaceId?: string; agentId?: string }>;
    };
    expect(stored.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId,
          agentId: "assistant",
        }),
      ]),
    );

    await fs.rm(path.dirname(workspaceConfigPath(workspaceId)), {
      recursive: true,
      force: true,
    });
  });

  it("filters cron status to the caller workspace for non-super-admin users", async () => {
    const respond = vi.fn();
    const status = vi.fn(async () => ({
      enabled: true,
      storePath: "/tmp/cron/jobs.json",
      jobs: 5,
      nextWakeAtMs: 111,
    }));
    const list = vi.fn(async () => [
      {
        id: "job-a",
        enabled: true,
        workspaceId: "ws-a",
        state: { nextRunAtMs: 500 },
      },
      {
        id: "job-b",
        enabled: false,
        workspaceId: "ws-a",
        state: { nextRunAtMs: 200 },
      },
      {
        id: "job-c",
        enabled: true,
        workspaceId: "ws-b",
        state: { nextRunAtMs: 100 },
      },
    ]);

    await cronHandlers["cron.status"]({
      params: {},
      respond,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: "ws-a" } as any,
      context: { cron: { status, list } } as any,
    } as any);

    expect(respond).toHaveBeenCalledWith(
      true,
      {
        enabled: true,
        storePath: "/tmp/cron/jobs.json",
        jobs: 2,
        nextWakeAtMs: 500,
      },
      undefined,
    );
  });

  it("assigns workspaceId for backend cron adds when the caller passes an explicit workspaceId", async () => {
    const workspaceId = `cron-backend-${Date.now()}`;
    await writeWorkspaceConfig(workspaceId, {
      agents: {
        list: [
          {
            id: "assistant",
            default: true,
            workspaceId,
          },
        ],
      },
    });

    const respond = vi.fn();
    const add = vi.fn(async (job) => job);

    await cronHandlers["cron.add"]({
      params: {
        name: "Backend workspace reminder",
        enabled: true,
        workspaceId,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "hello" },
      },
      respond,
      client: undefined,
      context: {
        cron: {
          add,
          list: async () => [
            {
              id: "job-1",
              enabled: true,
              workspaceId,
              agentId: "assistant",
              schedule: { kind: "every", everyMs: 60_000 },
            },
          ],
        },
      } as any,
    } as any);

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        agentId: "assistant",
      }),
    );
  });

  it("filters cron list to an explicit workspaceId for backend callers", async () => {
    const respond = vi.fn();
    const list = vi.fn(async () => [
      { id: "job-a", workspaceId: "ws-a", enabled: true },
      { id: "job-b", workspaceId: "ws-b", enabled: true },
    ]);

    await cronHandlers["cron.list"]({
      params: { workspaceId: "ws-a", includeDisabled: true },
      respond,
      client: undefined,
      context: { cron: { list } } as any,
    } as any);

    expect(respond).toHaveBeenCalledWith(
      true,
      {
        jobs: [{ id: "job-a", workspaceId: "ws-a", enabled: true }],
      },
      undefined,
    );
  });
});
