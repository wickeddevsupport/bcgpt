import type { CronJobCreate, CronJobPatch } from "../../cron/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { normalizeCronJobCreate, normalizeCronJobPatch } from "../../cron/normalize.js";
import { readCronRunLogEntries, resolveCronRunLogPath } from "../../cron/run-log.js";
import { resolveCronStorePath, saveCronStore } from "../../cron/store.js";
import { validateScheduleTimestamp } from "../../cron/validate-timestamp.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateCronAddParams,
  validateCronListParams,
  validateCronRemoveParams,
  validateCronRunParams,
  validateCronRunsParams,
  validateCronStatusParams,
  validateCronUpdateParams,
  validateWakeParams,
} from "../protocol/index.js";
import {
  filterByWorkspace,
  isSuperAdmin,
  requireWorkspaceOwnership,
} from "../workspace-context.js";
import { loadEffectiveWorkspaceConfig } from "../workspace-config.js";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";

async function syncWorkspaceCronShadowStore(
  context: Parameters<GatewayRequestHandlers["cron.add"]>[0]["context"],
  workspaceId: string,
) {
  const effectiveCfg = await loadEffectiveWorkspaceConfig(workspaceId);
  const storePath = resolveCronStorePath(
    (effectiveCfg as { cron?: { store?: string } }).cron?.store,
  );
  const jobs = (await context.cron.list({ includeDisabled: true })).filter(
    (job) => job.workspaceId === workspaceId,
  );
  await saveCronStore(storePath, {
    version: 1,
    jobs,
  });
  return storePath;
}

export const cronHandlers: GatewayRequestHandlers = {
  wake: ({ params, respond, context }) => {
    if (!validateWakeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wake params: ${formatValidationErrors(validateWakeParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      mode: "now" | "next-heartbeat";
      text: string;
    };
    const result = context.cron.wake({ mode: p.mode, text: p.text });
    respond(true, result, undefined);
  },
  "cron.list": async ({ params, respond, context, client }) => {
    if (!validateCronListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.list params: ${formatValidationErrors(validateCronListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { includeDisabled?: boolean };
    const jobs = await context.cron.list({
      includeDisabled: p.includeDisabled,
    });
    
    // Apply workspace filtering for PMOS multi-tenant isolation
    if (client?.pmosWorkspaceId && !isSuperAdmin(client)) {
      const filteredJobs = filterByWorkspace(jobs, client);
      respond(true, { jobs: filteredJobs }, undefined);
      return;
    }
    
    respond(true, { jobs }, undefined);
  },
  "cron.status": async ({ params, respond, context, client }) => {
    if (!validateCronStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.status params: ${formatValidationErrors(validateCronStatusParams.errors)}`,
        ),
      );
      return;
    }
    const status = await context.cron.status();
    if (client?.pmosWorkspaceId && !isSuperAdmin(client)) {
      const jobs = filterByWorkspace(await context.cron.list({ includeDisabled: true }), client);
      const enabledJobs = jobs.filter((job) => job.enabled);
      const nextWakeAtMs = enabledJobs.reduce<number | null>((soonest, job) => {
        const next = typeof job.state?.nextRunAtMs === "number" ? job.state.nextRunAtMs : null;
        if (next === null) {
          return soonest;
        }
        return soonest === null ? next : Math.min(soonest, next);
      }, null);
      respond(
        true,
        {
          ...status,
          jobs: jobs.length,
          nextWakeAtMs,
        },
        undefined,
      );
      return;
    }
    respond(true, status, undefined);
  },
  "cron.add": async ({ params, respond, context, client }) => {
    const normalized = normalizeCronJobCreate(params) ?? params;
    if (!validateCronAddParams(normalized)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.add params: ${formatValidationErrors(validateCronAddParams.errors)}`,
        ),
      );
      return;
    }
    const jobCreate = normalized as unknown as CronJobCreate;
    const timestampValidation = validateScheduleTimestamp(jobCreate.schedule);
    if (!timestampValidation.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, timestampValidation.message),
      );
      return;
    }
    
    // Add workspaceId for multi-tenant isolation
    if (client?.pmosWorkspaceId) {
      (jobCreate as CronJobCreate & { workspaceId?: string }).workspaceId = client.pmosWorkspaceId;
      if (!jobCreate.agentId?.trim()) {
        try {
          const workspaceCfg = await loadEffectiveWorkspaceConfig(client.pmosWorkspaceId);
          const workspaceAgentId = resolveDefaultAgentId(workspaceCfg as never);
          if (workspaceAgentId?.trim()) {
            jobCreate.agentId = workspaceAgentId;
          }
        } catch {
          // Fall back to the cron runtime resolver if the workspace config
          // cannot be loaded right now.
        }
      }
    }
    
    const job = await context.cron.add(jobCreate);
    if (client?.pmosWorkspaceId && !isSuperAdmin(client)) {
      await syncWorkspaceCronShadowStore(context, client.pmosWorkspaceId);
    }
    respond(true, job, undefined);
  },
  "cron.update": async ({ params, respond, context, client }) => {
    const normalizedPatch = normalizeCronJobPatch((params as { patch?: unknown } | null)?.patch);
    const candidate =
      normalizedPatch && typeof params === "object" && params !== null
        ? { ...params, patch: normalizedPatch }
        : params;
    if (!validateCronUpdateParams(candidate)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.update params: ${formatValidationErrors(validateCronUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const p = candidate as {
      id?: string;
      jobId?: string;
      patch: Record<string, unknown>;
    };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.update params: missing id"),
      );
      return;
    }
    
    // Check workspace ownership for non-super-admin users
    if (client?.pmosWorkspaceId && !isSuperAdmin(client)) {
      const jobs = await context.cron.list({ includeDisabled: true });
      const job = jobs.find((j) => j.id === jobId);
      if (!job) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `cron job "${jobId}" not found`),
        );
        return;
      }
      try {
        requireWorkspaceOwnership(client, job.workspaceId, "cron job");
      } catch {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `cron job "${jobId}" not found`),
        );
        return;
      }
    }
    
    const patch = p.patch as unknown as CronJobPatch;
    if (patch.schedule) {
      const timestampValidation = validateScheduleTimestamp(patch.schedule);
      if (!timestampValidation.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, timestampValidation.message),
        );
        return;
      }
    }
    const job = await context.cron.update(jobId, patch);
    if (client?.pmosWorkspaceId && !isSuperAdmin(client)) {
      await syncWorkspaceCronShadowStore(context, client.pmosWorkspaceId);
    }
    respond(true, job, undefined);
  },
  "cron.remove": async ({ params, respond, context, client }) => {
    if (!validateCronRemoveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.remove params: ${formatValidationErrors(validateCronRemoveParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.remove params: missing id"),
      );
      return;
    }
    
    // Check workspace ownership for non-super-admin users
    if (client?.pmosWorkspaceId && !isSuperAdmin(client)) {
      const jobs = await context.cron.list({ includeDisabled: true });
      const job = jobs.find((j) => j.id === jobId);
      if (!job) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `cron job "${jobId}" not found`),
        );
        return;
      }
      try {
        requireWorkspaceOwnership(client, job.workspaceId, "cron job");
      } catch {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `cron job "${jobId}" not found`),
        );
        return;
      }
    }
    
    const result = await context.cron.remove(jobId);
    if (client?.pmosWorkspaceId && !isSuperAdmin(client)) {
      await syncWorkspaceCronShadowStore(context, client.pmosWorkspaceId);
    }
    respond(true, result, undefined);
  },
  "cron.run": async ({ params, respond, context, client }) => {
    if (!validateCronRunParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.run params: ${formatValidationErrors(validateCronRunParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string; mode?: "due" | "force" };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.run params: missing id"),
      );
      return;
    }
    
    // Check workspace ownership for non-super-admin users
    if (client?.pmosWorkspaceId && !isSuperAdmin(client)) {
      const jobs = await context.cron.list({ includeDisabled: true });
      const job = jobs.find((j) => j.id === jobId);
      if (!job) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `cron job "${jobId}" not found`),
        );
        return;
      }
      try {
        requireWorkspaceOwnership(client, job.workspaceId, "cron job");
      } catch {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `cron job "${jobId}" not found`),
        );
        return;
      }
    }
    
    const result = await context.cron.run(jobId, p.mode ?? "force");
    respond(true, result, undefined);
  },
  "cron.runs": async ({ params, respond, context, client }) => {
    if (!validateCronRunsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.runs params: ${formatValidationErrors(validateCronRunsParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string; limit?: number };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.runs params: missing id"),
      );
      return;
    }
    
    // Check workspace ownership for non-super-admin users
    if (client?.pmosWorkspaceId && !isSuperAdmin(client)) {
      const jobs = await context.cron.list({ includeDisabled: true });
      const job = jobs.find((j) => j.id === jobId);
      if (!job) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `cron job "${jobId}" not found`),
        );
        return;
      }
      try {
        requireWorkspaceOwnership(client, job.workspaceId, "cron job");
      } catch {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `cron job "${jobId}" not found`),
        );
        return;
      }
    }
    
    const logPath = resolveCronRunLogPath({
      storePath: context.cronStorePath,
      jobId,
    });
    const entries = await readCronRunLogEntries(logPath, {
      limit: p.limit,
      jobId,
    });
    respond(true, { entries }, undefined);
  },
};
