import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import type { CronJob, CronStoreFile } from "../cron/types.js";
import { resolveCronStorePath } from "../cron/store.js";
import { CONFIG_DIR } from "../utils.js";
import { workspaceConfigPath } from "./workspace-config.js";

const RUNTIME_CRON_STORE_FILENAME = "runtime-jobs.json";

function readCronStoreSync(storePath: string): CronStoreFile {
  try {
    const raw = fs.readFileSync(storePath, "utf-8");
    const parsed = JSON5.parse(raw) as unknown;
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const jobs = Array.isArray(record.jobs) ? (record.jobs as CronJob[]) : [];
    return { version: 1, jobs: jobs.filter(Boolean) };
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ENOENT") {
      return { version: 1, jobs: [] };
    }
    throw err;
  }
}

function saveCronStoreSync(storePath: string, store: CronStoreFile) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmp, storePath);
  try {
    fs.copyFileSync(storePath, `${storePath}.bak`);
  } catch {
    // best-effort
  }
}

function listWorkspaceIdsSync(): string[] {
  const workspacesDir = path.join(CONFIG_DIR, "workspaces");
  try {
    return fs
      .readdirSync(workspacesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.trim())
      .filter(Boolean)
      .toSorted();
  } catch {
    return [];
  }
}

function resolveWorkspaceCronStorePathSync(workspaceId: string): string {
  const fallback = path.join(CONFIG_DIR, "workspaces", workspaceId, "cron", "jobs.json");
  try {
    const raw = fs.readFileSync(workspaceConfigPath(workspaceId), "utf-8");
    const parsed = JSON5.parse(raw) as unknown;
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const cron =
      record.cron && typeof record.cron === "object" && !Array.isArray(record.cron)
        ? (record.cron as Record<string, unknown>)
        : null;
    const store = typeof cron?.store === "string" ? cron.store.trim() : "";
    if (!store || !store.includes(`/workspaces/${workspaceId}/`)) {
      return fallback;
    }
    return resolveCronStorePath(store);
  } catch {
    return fallback;
  }
}

function dedupeJobsById(jobs: CronJob[]): CronJob[] {
  const byId = new Map<string, CronJob>();
  for (const job of jobs) {
    if (typeof job?.id !== "string" || !job.id.trim()) {
      continue;
    }
    byId.set(job.id, job);
  }
  return Array.from(byId.values());
}

function normalizeWorkspaceJobs(jobs: CronJob[], workspaceId: string): CronJob[] {
  return jobs
    .filter(Boolean)
    .map((job) => {
      const jobWorkspaceId = typeof job.workspaceId === "string" ? job.workspaceId.trim() : "";
      if (jobWorkspaceId === workspaceId) {
        return job;
      }
      return {
        ...job,
        workspaceId,
      };
    });
}

export function resolveCronRuntimeStorePath(globalStorePath?: string): string {
  const source = resolveCronStorePath(globalStorePath);
  return path.join(path.dirname(source), RUNTIME_CRON_STORE_FILENAME);
}

export function syncCronRuntimeStoreFromSourcesSync(params?: {
  globalStorePath?: string;
}): {
  globalStorePath: string;
  runtimeStorePath: string;
  workspaceIds: string[];
  jobs: number;
} {
  const globalStorePath = resolveCronStorePath(params?.globalStorePath);
  const runtimeStorePath = resolveCronRuntimeStorePath(globalStorePath);
  const workspaceIds = listWorkspaceIdsSync();
  const globalStore = readCronStoreSync(globalStorePath);
  const workspaceJobsFromGlobal = new Map<string, CronJob[]>();
  const globalRootJobs = globalStore.jobs.filter((job) => {
    const workspaceId = typeof job.workspaceId === "string" ? job.workspaceId.trim() : "";
    if (!workspaceId) {
      return true;
    }
    const bucket = workspaceJobsFromGlobal.get(workspaceId) ?? [];
    bucket.push(job);
    workspaceJobsFromGlobal.set(workspaceId, bucket);
    return false;
  });

  const mergedRuntimeJobs = [...globalRootJobs];
  for (const workspaceId of workspaceIds) {
    const storePath = resolveWorkspaceCronStorePathSync(workspaceId);
    const workspaceStore = readCronStoreSync(storePath);
    const normalizedWorkspaceJobs = normalizeWorkspaceJobs(workspaceStore.jobs, workspaceId);
    const migrated = dedupeJobsById([
      ...normalizedWorkspaceJobs,
      ...(workspaceJobsFromGlobal.get(workspaceId) ?? []),
    ]);
    const workspaceStoreChanged =
      migrated.length !== workspaceStore.jobs.length ||
      normalizedWorkspaceJobs.some((job, index) => job !== workspaceStore.jobs[index]);
    if (workspaceStoreChanged) {
      saveCronStoreSync(storePath, { version: 1, jobs: migrated });
    }
    mergedRuntimeJobs.push(...migrated);
  }

  saveCronStoreSync(runtimeStorePath, {
    version: 1,
    jobs: dedupeJobsById(mergedRuntimeJobs),
  });
  return {
    globalStorePath,
    runtimeStorePath,
    workspaceIds,
    jobs: mergedRuntimeJobs.length,
  };
}

export function syncCronSourceStoresFromRuntimeJobsSync(params: {
  jobs: CronJob[];
  globalStorePath?: string;
  workspaceIds?: string[];
}): {
  globalStorePath: string;
  runtimeStorePath: string;
  workspaceIds: string[];
  jobs: number;
} {
  const globalStorePath = resolveCronStorePath(params.globalStorePath);
  const workspaceIds = new Set<string>(params.workspaceIds ?? []);
  for (const job of params.jobs) {
    const workspaceId = typeof job.workspaceId === "string" ? job.workspaceId.trim() : "";
    if (workspaceId) {
      workspaceIds.add(workspaceId);
    }
  }

  saveCronStoreSync(globalStorePath, {
    version: 1,
    jobs: dedupeJobsById(
      params.jobs.filter((job) => {
        const workspaceId = typeof job.workspaceId === "string" ? job.workspaceId.trim() : "";
        return !workspaceId;
      }),
    ),
  });

  for (const workspaceId of workspaceIds) {
    const storePath = resolveWorkspaceCronStorePathSync(workspaceId);
    saveCronStoreSync(storePath, {
      version: 1,
      jobs: dedupeJobsById(
        params.jobs.filter(
          (job) =>
            (typeof job.workspaceId === "string" ? job.workspaceId.trim() : "") === workspaceId,
        ),
      ),
    });
  }

  return syncCronRuntimeStoreFromSourcesSync({ globalStorePath });
}
