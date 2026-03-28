import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveCronRuntimeStorePath,
  syncCronRuntimeStoreFromSourcesSync,
} from "./cron-runtime-store.js";
import { workspaceConfigPath } from "./workspace-config.js";

const cleanupPaths = new Set<string>();

afterEach(async () => {
  for (const target of cleanupPaths) {
    await fs.rm(target, { recursive: true, force: true });
  }
  cleanupPaths.clear();
});

describe("cron runtime store workspace migration", () => {
  it("stamps workspaceId onto legacy jobs loaded from workspace cron stores", async () => {
    const workspaceId = `cron-runtime-${Date.now()}`;
    const workspaceDir = path.dirname(workspaceConfigPath(workspaceId));
    const workspaceStorePath = path.join(workspaceDir, "cron", "jobs.json");
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cron-runtime-"));
    const globalStorePath = path.join(tempRoot, "cron", "jobs.json");
    cleanupPaths.add(workspaceDir);
    cleanupPaths.add(tempRoot);

    await fs.mkdir(path.dirname(workspaceConfigPath(workspaceId)), { recursive: true });
    await fs.writeFile(workspaceConfigPath(workspaceId), JSON.stringify({ version: 1 }, null, 2));
    await fs.mkdir(path.dirname(workspaceStorePath), { recursive: true });
    await fs.writeFile(
      workspaceStorePath,
      JSON.stringify(
        {
          version: 1,
          jobs: [
            {
              id: "job-legacy",
              name: "Legacy workspace job",
              enabled: true,
              schedule: { kind: "every", everyMs: 60_000 },
              sessionTarget: "main",
              wakeMode: "now",
              payload: { kind: "systemEvent", text: "hello" },
            },
          ],
        },
        null,
        2,
      ),
    );
    await fs.mkdir(path.dirname(globalStorePath), { recursive: true });
    await fs.writeFile(globalStorePath, JSON.stringify({ version: 1, jobs: [] }, null, 2));

    const result = syncCronRuntimeStoreFromSourcesSync({ globalStorePath });
    const runtimeStorePath = resolveCronRuntimeStorePath(globalStorePath);
    const runtimeStore = JSON.parse(await fs.readFile(runtimeStorePath, "utf-8")) as {
      jobs?: Array<{ id?: string; workspaceId?: string }>;
    };
    const workspaceStore = JSON.parse(await fs.readFile(workspaceStorePath, "utf-8")) as {
      jobs?: Array<{ id?: string; workspaceId?: string }>;
    };

    expect(result.workspaceIds).toContain(workspaceId);
    expect(runtimeStore.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "job-legacy", workspaceId }),
      ]),
    );
    expect(workspaceStore.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "job-legacy", workspaceId }),
      ]),
    );
  });

  it("falls back to the workspace cron store when the raw workspace config still points at global cron", async () => {
    const workspaceId = `cron-runtime-path-${Date.now()}`;
    const workspaceDir = path.dirname(workspaceConfigPath(workspaceId));
    const workspaceStorePath = path.join(workspaceDir, "cron", "jobs.json");
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cron-runtime-"));
    const globalStorePath = path.join(tempRoot, "cron", "jobs.json");
    const wrongWorkspaceStorePath = path.join(tempRoot, "wrong-workspace-store", "jobs.json");
    cleanupPaths.add(workspaceDir);
    cleanupPaths.add(tempRoot);

    await fs.mkdir(path.dirname(workspaceConfigPath(workspaceId)), { recursive: true });
    await fs.writeFile(
      workspaceConfigPath(workspaceId),
      JSON.stringify(
        {
          cron: {
            store: wrongWorkspaceStorePath,
          },
        },
        null,
        2,
      ),
    );
    await fs.mkdir(path.dirname(workspaceStorePath), { recursive: true });
    await fs.writeFile(
      workspaceStorePath,
      JSON.stringify(
        {
          version: 1,
          jobs: [
            {
              id: "workspace-job",
              enabled: true,
              schedule: { kind: "every", everyMs: 60_000 },
              sessionTarget: "main",
              wakeMode: "now",
              payload: { kind: "systemEvent", text: "hello" },
            },
          ],
        },
        null,
        2,
      ),
    );
    await fs.mkdir(path.dirname(globalStorePath), { recursive: true });
    await fs.writeFile(globalStorePath, JSON.stringify({ version: 1, jobs: [] }, null, 2));
    await fs.mkdir(path.dirname(wrongWorkspaceStorePath), { recursive: true });
    await fs.writeFile(
      wrongWorkspaceStorePath,
      JSON.stringify(
        {
          version: 1,
          jobs: [
            {
              id: "wrong-store-job",
              workspaceId,
              enabled: true,
            },
          ],
        },
        null,
        2,
      ),
    );

    syncCronRuntimeStoreFromSourcesSync({ globalStorePath });

    const runtimeStorePath = resolveCronRuntimeStorePath(globalStorePath);
    const runtimeStore = JSON.parse(await fs.readFile(runtimeStorePath, "utf-8")) as {
      jobs?: Array<{ id?: string; workspaceId?: string }>;
    };

    expect(runtimeStore.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "workspace-job", workspaceId }),
      ]),
    );
    expect(runtimeStore.jobs?.find((job) => job.id === "wrong-store-job")).toBeUndefined();
  });
});
