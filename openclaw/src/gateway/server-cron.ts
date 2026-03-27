import fs from "node:fs";
import type { CliDeps } from "../cli/deps.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { resolveAgentMainSessionKey } from "../config/sessions.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { runCronIsolatedAgentTurn } from "../cron/isolated-agent.js";
import { appendCronRunLog, resolveCronRunLogPath } from "../cron/run-log.js";
import { CronService } from "../cron/service.js";
import { resolveCronStorePath } from "../cron/store.js";
import { runHeartbeatOnce } from "../infra/heartbeat-runner.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { getChildLogger } from "../logging.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { resolveCronRuntimeStorePath, syncCronRuntimeStoreFromSourcesSync } from "./cron-runtime-store.js";
import { workspaceConfigPath } from "./workspace-config.js";

export type GatewayCronState = {
  cron: CronService;
  storePath: string;
  cronEnabled: boolean;
};

export function buildGatewayCronService(params: {
  cfg: ReturnType<typeof loadConfig>;
  deps: CliDeps;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
}): GatewayCronState {
  const cronLogger = getChildLogger({ module: "cron" });
  const sourceStorePath = resolveCronStorePath(params.cfg.cron?.store);
  try {
    syncCronRuntimeStoreFromSourcesSync({ globalStorePath: sourceStorePath });
  } catch (err) {
    cronLogger.warn({ err: String(err), sourceStorePath }, "cron: failed to sync runtime store");
  }
  const storePath = resolveCronRuntimeStorePath(sourceStorePath);
  const cronEnabled = process.env.OPENCLAW_SKIP_CRON !== "1" && params.cfg.cron?.enabled !== false;

  const readWorkspaceConfigSync = (
    workspaceId?: string,
  ): Record<string, unknown> | null => {
    const wsId = workspaceId?.trim();
    if (!wsId) {
      return null;
    }
    try {
      const raw = fs.readFileSync(workspaceConfigPath(wsId), "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const workspaceSessionStorePath = (workspaceId: string) =>
    `~/.openclaw/workspaces/${workspaceId}/agents/{agentId}/sessions/sessions.json`;

  const resolveWorkspaceCronAgentSync = (params: {
    requestedAgentId?: string | null;
    workspaceId?: string;
  }) => {
    const runtimeConfig = loadConfig();
    const workspaceCfg = readWorkspaceConfigSync(params.workspaceId);
    const cfgForAgentResolution = workspaceCfg
      ? ({
          agents: workspaceCfg.agents,
          session: workspaceCfg.session,
        } as ReturnType<typeof loadConfig>)
      : runtimeConfig;
    const normalizedRequested =
      typeof params.requestedAgentId === "string" && params.requestedAgentId.trim()
        ? normalizeAgentId(params.requestedAgentId)
        : undefined;
    const hasRequestedAgent =
      normalizedRequested !== undefined &&
      Array.isArray((cfgForAgentResolution.agents?.list as Array<{ id?: string }> | undefined)) &&
      (cfgForAgentResolution.agents?.list as Array<{ id?: string }>).some(
        (entry) =>
          entry && typeof entry.id === "string" && normalizeAgentId(entry.id) === normalizedRequested,
      );
    const agentId = hasRequestedAgent
      ? normalizedRequested
      : resolveDefaultAgentId(cfgForAgentResolution);
    const mergedSession =
      workspaceCfg && workspaceCfg.session && typeof workspaceCfg.session === "object" && !Array.isArray(workspaceCfg.session)
        ? { ...runtimeConfig.session, ...workspaceCfg.session }
        : { ...runtimeConfig.session };
    if (
      params.workspaceId?.trim() &&
      (!mergedSession.store ||
        typeof mergedSession.store !== "string" ||
        !mergedSession.store.includes(`/workspaces/${params.workspaceId.trim()}/`))
    ) {
      mergedSession.store = workspaceSessionStorePath(params.workspaceId.trim());
    }
    return {
      agentId,
      cfg: {
        ...runtimeConfig,
        session: mergedSession,
      } as ReturnType<typeof loadConfig>,
    };
  };

  const resolveCronAgent = (requested?: string | null) => {
    const runtimeConfig = loadConfig();
    const normalized =
      typeof requested === "string" && requested.trim() ? normalizeAgentId(requested) : undefined;
    const hasAgent =
      normalized !== undefined &&
      Array.isArray(runtimeConfig.agents?.list) &&
      runtimeConfig.agents.list.some(
        (entry) =>
          entry && typeof entry.id === "string" && normalizeAgentId(entry.id) === normalized,
      );
    const agentId = hasAgent ? normalized : resolveDefaultAgentId(runtimeConfig);
    return { agentId, cfg: runtimeConfig };
  };

  const defaultAgentId = resolveDefaultAgentId(params.cfg);
  const resolveSessionStorePath = (agentId?: string, workspaceId?: string) => {
    const resolvedAgentId = agentId ?? defaultAgentId;
    if (workspaceId?.trim()) {
      const { cfg } = resolveWorkspaceCronAgentSync({
        requestedAgentId: resolvedAgentId,
        workspaceId,
      });
      return resolveStorePath(cfg.session?.store, { agentId: resolvedAgentId });
    }
    return resolveStorePath(params.cfg.session?.store, {
      agentId: resolvedAgentId,
    });
  };
  const sessionStorePath = resolveSessionStorePath(defaultAgentId);

  const cron = new CronService({
    storePath,
    cronEnabled,
    cronConfig: params.cfg.cron,
    defaultAgentId,
    resolveSessionStorePath,
    sessionStorePath,
    enqueueSystemEvent: (text, opts) => {
      const { agentId, cfg: runtimeConfig } = resolveWorkspaceCronAgentSync({
        requestedAgentId: opts?.agentId,
        workspaceId: opts?.workspaceId,
      });
      const sessionKey = resolveAgentMainSessionKey({
        cfg: runtimeConfig,
        agentId,
      });
      enqueueSystemEvent(text, { sessionKey });
    },
    requestHeartbeatNow,
    runHeartbeatOnce: async (opts) => {
      let runtimeConfig = loadConfig();
      if (opts?.workspaceId?.trim()) {
        try {
          const { loadEffectiveWorkspaceConfig } = await import("./workspace-config.js");
          runtimeConfig = (await loadEffectiveWorkspaceConfig(
            opts.workspaceId.trim(),
          )) as ReturnType<typeof loadConfig>;
        } catch {
          runtimeConfig = resolveWorkspaceCronAgentSync({
            requestedAgentId: opts?.agentId,
            workspaceId: opts?.workspaceId,
          }).cfg;
        }
      }
      const { agentId } = resolveWorkspaceCronAgentSync({
        requestedAgentId: opts?.agentId,
        workspaceId: opts?.workspaceId,
      });
      return await runHeartbeatOnce({
        cfg: runtimeConfig,
        agentId,
        reason: opts?.reason,
        deps: { ...params.deps, runtime: defaultRuntime },
      });
    },
    runIsolatedAgentJob: async ({ job, message }) => {
      let runtimeConfig = loadConfig();
      if (typeof job.workspaceId === "string" && job.workspaceId.trim()) {
        try {
          const { loadEffectiveWorkspaceConfig } = await import("./workspace-config.js");
          const effective = await loadEffectiveWorkspaceConfig(job.workspaceId);
          runtimeConfig = effective as ReturnType<typeof loadConfig>;
        } catch {
          runtimeConfig = loadConfig();
        }
      }
      const normalized =
        typeof job.agentId === "string" && job.agentId.trim() ? normalizeAgentId(job.agentId) : undefined;
      const hasAgent =
        normalized !== undefined &&
        Array.isArray(runtimeConfig.agents?.list) &&
        runtimeConfig.agents.list.some(
          (entry) =>
            entry && typeof entry.id === "string" && normalizeAgentId(entry.id) === normalized,
        );
      const agentId = hasAgent ? normalized : resolveDefaultAgentId(runtimeConfig);
      return await runCronIsolatedAgentTurn({
        cfg: runtimeConfig,
        deps: params.deps,
        job,
        message,
        agentId,
        sessionKey: `cron:${job.id}`,
        lane: "cron",
      });
    },
    log: getChildLogger({ module: "cron", storePath }),
    onEvent: (evt) => {
      params.broadcast("cron", evt, { dropIfSlow: true });
      if (evt.action === "finished") {
        const logPath = resolveCronRunLogPath({
          storePath,
          jobId: evt.jobId,
        });
        void appendCronRunLog(logPath, {
          ts: Date.now(),
          jobId: evt.jobId,
          action: "finished",
          status: evt.status,
          error: evt.error,
          summary: evt.summary,
          sessionId: evt.sessionId,
          sessionKey: evt.sessionKey,
          runAtMs: evt.runAtMs,
          durationMs: evt.durationMs,
          nextRunAtMs: evt.nextRunAtMs,
        }).catch((err) => {
          cronLogger.warn({ err: String(err), logPath }, "cron: run log append failed");
        });
      }
    },
  });

  return { cron, storePath, cronEnabled };
}
