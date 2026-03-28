import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { parseConfigJson5 } from "../../config/config.js";
import { loadConfig, resolveConfigSnapshotHash } from "../../config/io.js";
import { applyMergePatch } from "../../config/merge-patch.js";
import {
  redactConfigObject,
  restoreRedactedValues,
} from "../../config/redact-snapshot.js";
import { loadSessionStore, resolveStorePath } from "../../config/sessions.js";
import {
  formatDoctorNonInteractiveHint,
  type RestartSentinelPayload,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import {
  applyWorkspaceAgentCollaborationDefaults,
  readWorkspaceConfig,
  workspaceConfigPath,
  writeWorkspaceConfig,
} from "../../gateway/workspace-config.js";
import { listAgentIds, resolveAgentConfig, resolveAgentWorkspaceDir, resolveSessionAgentId } from "../agent-scope.js";
import {
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_AGENTS_FILENAME,
} from "../workspace.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const DEFAULT_UPDATE_TIMEOUT_MS = 20 * 60_000;

function resolveBaseHashFromSnapshot(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object") {
    return undefined;
  }
  const hashValue = (snapshot as { hash?: unknown }).hash;
  const rawValue = (snapshot as { raw?: unknown }).raw;
  const hash = resolveConfigSnapshotHash({
    hash: typeof hashValue === "string" ? hashValue : undefined,
    raw: typeof rawValue === "string" ? rawValue : undefined,
  });
  return hash ?? undefined;
}

function resolveWorkspaceIdFromToolOptions(opts?: {
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): string | undefined {
  const cfg = opts?.config;
  if (!cfg) {
    return undefined;
  }
  const agentId = opts?.agentSessionKey
    ? resolveSessionAgentId({ sessionKey: opts.agentSessionKey, config: cfg })
    : undefined;
  if (!agentId) {
    return undefined;
  }
  const workspaceId = resolveAgentConfig(cfg, agentId)?.workspaceId?.trim();
  return workspaceId || undefined;
}

const WORKSPACE_AGENT_FILE_NAMES = new Set<string>([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
]);

function isAllowedWorkspaceAgentFileName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) {
    return false;
  }
  if (WORKSPACE_AGENT_FILE_NAMES.has(trimmed)) {
    return true;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  if (!normalized.startsWith("memory/") || normalized.includes("..")) {
    return false;
  }
  const baseName = path.posix.basename(normalized);
  return Boolean(baseName) && baseName.toLowerCase().endsWith(".md");
}

function resolveWorkspaceScopedAgentId(params: {
  cfg?: OpenClawConfig;
  workspaceId: string;
  requestedAgentId?: string;
}) {
  const cfg = params.cfg;
  if (!cfg) {
    throw new Error("workspace config unavailable");
  }
  const requested = params.requestedAgentId?.trim();
  if (!requested) {
    throw new Error("agentId is required");
  }
  const match = listAgentIds(cfg).find((agentId) => {
    if (agentId !== requested) {
      return false;
    }
    return resolveAgentConfig(cfg, agentId)?.workspaceId?.trim() === params.workspaceId;
  });
  if (!match) {
    throw new Error(`unknown workspace agent id: ${requested}`);
  }
  return match;
}

async function listWorkspaceScopedAgentFiles(workspaceDir: string) {
  const names = [
    DEFAULT_AGENTS_FILENAME,
    DEFAULT_SOUL_FILENAME,
    DEFAULT_TOOLS_FILENAME,
    DEFAULT_IDENTITY_FILENAME,
    DEFAULT_USER_FILENAME,
    DEFAULT_HEARTBEAT_FILENAME,
    DEFAULT_BOOTSTRAP_FILENAME,
    DEFAULT_MEMORY_FILENAME,
    DEFAULT_MEMORY_ALT_FILENAME,
  ];
  const files: Array<{
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
  }> = [];

  for (const name of names) {
    const filePath = path.join(workspaceDir, name);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        throw new Error("not file");
      }
      files.push({
        name,
        path: filePath,
        missing: false,
        size: stat.size,
        updatedAtMs: Math.floor(stat.mtimeMs),
      });
    } catch {
      if (name === DEFAULT_MEMORY_ALT_FILENAME) {
        continue;
      }
      files.push({ name, path: filePath, missing: true });
    }
  }

  const memoryDir = path.join(workspaceDir, "memory");
  try {
    const entries = await fs.readdir(memoryDir, { withFileTypes: true });
    const extraFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    for (const name of extraFiles) {
      const filePath = path.join(memoryDir, name);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }
      files.push({
        name: path.posix.join("memory", name),
        path: filePath,
        missing: false,
        size: stat.size,
        updatedAtMs: Math.floor(stat.mtimeMs),
      });
    }
  } catch {
    // optional memory dir
  }

  return files;
}

async function readWorkspaceScopedConfigSnapshot(workspaceId: string) {
  const existing = await readWorkspaceConfig(workspaceId);
  const config =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const raw = JSON.stringify(config, null, 2);
  return {
    path: workspaceConfigPath(workspaceId),
    config,
    raw,
    hash: resolveConfigSnapshotHash({ raw }) ?? undefined,
  };
}

async function buildWorkspaceScopedConfigResponse(workspaceId: string) {
  const snapshot = await readWorkspaceScopedConfigSnapshot(workspaceId);
  const redactedConfig = redactConfigObject(snapshot.config);
  const redactedRaw =
    redactedConfig && typeof redactedConfig === "object"
      ? JSON.stringify(redactedConfig, null, 2)
      : snapshot.raw;
  return {
    path: snapshot.path,
    config: redactedConfig,
    raw: redactedRaw,
    valid: true,
    issues: [],
    hash: snapshot.hash,
  };
}

function normalizeWorkspaceScopedConfig(
  workspaceId: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  return applyWorkspaceAgentCollaborationDefaults(config, workspaceId) as Record<string, unknown>;
}

function syncConfigObjectInPlace(
  target: OpenClawConfig | undefined,
  next: Record<string, unknown>,
): void {
  if (!target || typeof target !== "object") {
    return;
  }
  const merged = applyMergePatch(target as Record<string, unknown>, next);
  if (!merged || typeof merged !== "object" || Array.isArray(merged)) {
    return;
  }
  for (const key of Object.keys(target as Record<string, unknown>)) {
    delete (target as Record<string, unknown>)[key];
  }
  Object.assign(target as Record<string, unknown>, merged as Record<string, unknown>);
}

function requireMatchingBaseHash(params: { provided?: string; actual?: string }) {
  const provided = params.provided?.trim();
  const actual = params.actual?.trim();
  if (!provided || !actual) {
    return;
  }
  if (provided !== actual) {
    throw new Error("config changed on disk; reload before applying edits");
  }
}

async function applyWorkspaceConfigReplace(
  workspaceId: string,
  raw: string,
  baseHash?: string,
  targetConfig?: OpenClawConfig,
) {
  const parsedRes = parseConfigJson5(raw);
  if (!parsedRes.ok) {
    throw new Error(parsedRes.error);
  }
  if (!parsedRes.parsed || typeof parsedRes.parsed !== "object" || Array.isArray(parsedRes.parsed)) {
    throw new Error("config.apply raw must be an object");
  }
  const snapshot = await readWorkspaceScopedConfigSnapshot(workspaceId);
  requireMatchingBaseHash({ provided: baseHash, actual: snapshot.hash });
  const restored = restoreRedactedValues(
    parsedRes.parsed,
    snapshot.config,
  ) as Record<string, unknown>;
  const normalized = normalizeWorkspaceScopedConfig(workspaceId, restored);
  await writeWorkspaceConfig(workspaceId, normalized);
  syncConfigObjectInPlace(targetConfig, normalized);
  return {
    ok: true,
    ...(await buildWorkspaceScopedConfigResponse(workspaceId)),
    restart: { scheduled: false, reason: "workspace-config-no-gateway-restart" },
  };
}

async function applyWorkspaceConfigPatch(
  workspaceId: string,
  raw: string,
  baseHash?: string,
  targetConfig?: OpenClawConfig,
) {
  const parsedRes = parseConfigJson5(raw);
  if (!parsedRes.ok) {
    throw new Error(parsedRes.error);
  }
  if (!parsedRes.parsed || typeof parsedRes.parsed !== "object" || Array.isArray(parsedRes.parsed)) {
    throw new Error("config.patch raw must be an object");
  }
  const snapshot = await readWorkspaceScopedConfigSnapshot(workspaceId);
  requireMatchingBaseHash({ provided: baseHash, actual: snapshot.hash });
  const merged = applyMergePatch(snapshot.config, parsedRes.parsed);
  const restored = restoreRedactedValues(merged, snapshot.config);
  if (!restored || typeof restored !== "object" || Array.isArray(restored)) {
    throw new Error("config.patch raw must be an object");
  }
  const normalized = normalizeWorkspaceScopedConfig(
    workspaceId,
    restored as Record<string, unknown>,
  );
  await writeWorkspaceConfig(workspaceId, normalized);
  syncConfigObjectInPlace(targetConfig, normalized);
  return {
    ok: true,
    ...(await buildWorkspaceScopedConfigResponse(workspaceId)),
  };
}

const GATEWAY_ACTIONS = [
  "restart",
  "config.get",
  "config.schema",
  "config.apply",
  "config.patch",
  "agents.list",
  "agents.files.list",
  "agents.files.get",
  "update.run",
] as const;

// NOTE: Using a flattened object schema instead of Type.Union([Type.Object(...), ...])
// because Claude API on Vertex AI rejects nested anyOf schemas as invalid JSON Schema.
// The discriminator (action) determines which properties are relevant; runtime validates.
const GatewayToolSchema = Type.Object({
  action: stringEnum(GATEWAY_ACTIONS),
  // restart
  delayMs: Type.Optional(Type.Number()),
  reason: Type.Optional(Type.String()),
  // config.get, config.schema, config.apply, update.run
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  // config.apply, config.patch
  raw: Type.Optional(Type.String()),
  baseHash: Type.Optional(Type.String()),
  // agents.files.*
  agentId: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  // config.apply, config.patch, update.run
  sessionKey: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  restartDelayMs: Type.Optional(Type.Number()),
});
// NOTE: We intentionally avoid top-level `allOf`/`anyOf`/`oneOf` conditionals here:
// - OpenAI rejects tool schemas that include these keywords at the *top-level*.
// - Claude/Vertex has other JSON Schema quirks.
// Conditional requirements (like `raw` for config.apply) are enforced at runtime.

export function createGatewayTool(opts?: {
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "Gateway",
    name: "gateway",
    description:
      "Restart, inspect/apply workspace config, inspect workspace agents and agent files, or update the gateway in-place (SIGUSR1). Use config.patch for safe partial config updates (merges with existing). Use config.apply only when replacing entire config. Workspace agents can also use actions agents.list, agents.files.list, and agents.files.get for office collaboration.",
    parameters: GatewayToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "restart") {
        const workspaceId = resolveWorkspaceIdFromToolOptions(opts);
        if (opts?.config?.commands?.restart !== true && !workspaceId) {
          throw new Error("Gateway restart is disabled. Set commands.restart=true to enable.");
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const delayMs =
          typeof params.delayMs === "number" && Number.isFinite(params.delayMs)
            ? Math.floor(params.delayMs)
            : undefined;
        const reason =
          typeof params.reason === "string" && params.reason.trim()
            ? params.reason.trim().slice(0, 200)
            : undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        // Extract channel + threadId for routing after restart
        let deliveryContext: { channel?: string; to?: string; accountId?: string } | undefined;
        let threadId: string | undefined;
        if (sessionKey) {
          const threadMarker = ":thread:";
          const threadIndex = sessionKey.lastIndexOf(threadMarker);
          const baseSessionKey = threadIndex === -1 ? sessionKey : sessionKey.slice(0, threadIndex);
          const threadIdRaw =
            threadIndex === -1 ? undefined : sessionKey.slice(threadIndex + threadMarker.length);
          threadId = threadIdRaw?.trim() || undefined;
          try {
            const cfg = loadConfig();
            const storePath = resolveStorePath(cfg.session?.store);
            const store = loadSessionStore(storePath);
            let entry = store[sessionKey];
            if (!entry?.deliveryContext && threadIndex !== -1 && baseSessionKey) {
              entry = store[baseSessionKey];
            }
            if (entry?.deliveryContext) {
              deliveryContext = {
                channel: entry.deliveryContext.channel,
                to: entry.deliveryContext.to,
                accountId: entry.deliveryContext.accountId,
              };
            }
          } catch {
            // ignore: best-effort
          }
        }
        const payload: RestartSentinelPayload = {
          kind: "restart",
          status: "ok",
          ts: Date.now(),
          sessionKey,
          deliveryContext,
          threadId,
          message: note ?? reason ?? null,
          doctorHint: formatDoctorNonInteractiveHint(),
          stats: {
            mode: "gateway.restart",
            reason,
          },
        };
        try {
          await writeRestartSentinel(payload);
        } catch {
          // ignore: sentinel is best-effort
        }
        console.info(
          `gateway tool: restart requested (delayMs=${delayMs ?? "default"}, reason=${reason ?? "none"})`,
        );
        const scheduled = scheduleGatewaySigusr1Restart({
          delayMs,
          reason,
        });
        return jsonResult(scheduled);
      }

      const gatewayUrl =
        typeof params.gatewayUrl === "string" && params.gatewayUrl.trim()
          ? params.gatewayUrl.trim()
          : undefined;
      const gatewayToken =
        typeof params.gatewayToken === "string" && params.gatewayToken.trim()
          ? params.gatewayToken.trim()
          : undefined;
      const timeoutMs =
        typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
          ? Math.max(1, Math.floor(params.timeoutMs))
          : undefined;
      const gatewayOpts = { gatewayUrl, gatewayToken, timeoutMs };
      const workspaceId = resolveWorkspaceIdFromToolOptions(opts);

      if (action === "config.get") {
        if (workspaceId) {
          const result = await buildWorkspaceScopedConfigResponse(workspaceId);
          return jsonResult({ ok: true, result });
        }
        const result = await callGatewayTool("config.get", gatewayOpts, {});
        return jsonResult({ ok: true, result });
      }
      if (action === "config.schema") {
        const result = await callGatewayTool("config.schema", gatewayOpts, {});
        return jsonResult({ ok: true, result });
      }
      if (action === "config.apply") {
        const raw = readStringParam(params, "raw", { required: true });
        let baseHash = readStringParam(params, "baseHash");
        if (workspaceId) {
          const result = await applyWorkspaceConfigReplace(
            workspaceId,
            raw,
            baseHash,
            opts?.config,
          );
          return jsonResult({ ok: true, result });
        }
        if (!baseHash) {
          const snapshot = await callGatewayTool("config.get", gatewayOpts, {});
          baseHash = resolveBaseHashFromSnapshot(snapshot);
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        const restartDelayMs =
          typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
            ? Math.floor(params.restartDelayMs)
            : undefined;
        const result = await callGatewayTool("config.apply", gatewayOpts, {
          raw,
          baseHash,
          sessionKey,
          note,
          restartDelayMs,
        });
        return jsonResult({ ok: true, result });
      }
      if (action === "config.patch") {
        const raw = readStringParam(params, "raw", { required: true });
        let baseHash = readStringParam(params, "baseHash");
        if (workspaceId) {
          const result = await applyWorkspaceConfigPatch(
            workspaceId,
            raw,
            baseHash,
            opts?.config,
          );
          return jsonResult({ ok: true, result });
        }
        if (!baseHash) {
          const snapshot = await callGatewayTool("config.get", gatewayOpts, {});
          baseHash = resolveBaseHashFromSnapshot(snapshot);
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        const restartDelayMs =
          typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
            ? Math.floor(params.restartDelayMs)
            : undefined;
        const result = await callGatewayTool("config.patch", gatewayOpts, {
          raw,
          baseHash,
          sessionKey,
          note,
          restartDelayMs,
        });
        return jsonResult({ ok: true, result });
      }
      if (action === "agents.list") {
        if (workspaceId) {
          const cfg = opts?.config;
          const agents = cfg
            ? listAgentIds(cfg)
                .filter(
                  (agentId) =>
                    resolveAgentConfig(cfg, agentId)?.workspaceId?.trim() === workspaceId,
                )
                .map((agentId) => {
                  const agentConfig = resolveAgentConfig(cfg, agentId);
                  return {
                    id: agentId,
                    name: agentConfig?.name ?? agentId,
                    workspaceId,
                    workspace: resolveAgentWorkspaceDir(cfg, agentId),
                    default: cfg.agents?.list?.some(
                      (entry) => entry?.id === agentId && entry?.default === true,
                    ),
                  };
                })
            : [];
          return jsonResult({ ok: true, result: { agents } });
        }
        const result = await callGatewayTool("agents.list", gatewayOpts, {});
        return jsonResult({ ok: true, result });
      }
      if (action === "agents.files.list") {
        const agentId = readStringParam(params, "agentId", { required: true });
        if (workspaceId) {
          const cfg = opts?.config;
          if (!cfg) {
            throw new Error("workspace config unavailable");
          }
          const scopedAgentId = resolveWorkspaceScopedAgentId({
            cfg,
            workspaceId,
            requestedAgentId: agentId,
          });
          const workspaceDir = resolveAgentWorkspaceDir(cfg, scopedAgentId);
          const files = await listWorkspaceScopedAgentFiles(workspaceDir);
          return jsonResult({
            ok: true,
            result: { agentId: scopedAgentId, workspaceId, workspace: workspaceDir, files },
          });
        }
        const result = await callGatewayTool("agents.files.list", gatewayOpts, { agentId });
        return jsonResult({ ok: true, result });
      }
      if (action === "agents.files.get") {
        const agentId = readStringParam(params, "agentId", { required: true });
        const name = readStringParam(params, "name", { required: true });
        if (workspaceId) {
          const cfg = opts?.config;
          if (!cfg) {
            throw new Error("workspace config unavailable");
          }
          if (!isAllowedWorkspaceAgentFileName(name)) {
            throw new Error(`unsupported file "${name}"`);
          }
          const scopedAgentId = resolveWorkspaceScopedAgentId({
            cfg,
            workspaceId,
            requestedAgentId: agentId,
          });
          const workspaceDir = resolveAgentWorkspaceDir(cfg, scopedAgentId);
          const filePath = path.resolve(workspaceDir, name.replace(/\\/g, "/"));
          try {
            const stat = await fs.stat(filePath);
            if (!stat.isFile()) {
              throw new Error("not file");
            }
            const content = await fs.readFile(filePath, "utf-8");
            return jsonResult({
              ok: true,
              result: {
                agentId: scopedAgentId,
                workspaceId,
                workspace: workspaceDir,
                file: {
                  name,
                  path: filePath,
                  missing: false,
                  size: stat.size,
                  updatedAtMs: Math.floor(stat.mtimeMs),
                  content,
                },
              },
            });
          } catch {
            return jsonResult({
              ok: true,
              result: {
                agentId: scopedAgentId,
                workspaceId,
                workspace: workspaceDir,
                file: {
                  name,
                  path: filePath,
                  missing: true,
                },
              },
            });
          }
        }
        const result = await callGatewayTool("agents.files.get", gatewayOpts, { agentId, name });
        return jsonResult({ ok: true, result });
      }
      if (action === "update.run") {
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        const restartDelayMs =
          typeof params.restartDelayMs === "number" && Number.isFinite(params.restartDelayMs)
            ? Math.floor(params.restartDelayMs)
            : undefined;
        const updateGatewayOpts = {
          ...gatewayOpts,
          timeoutMs: timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS,
        };
        const result = await callGatewayTool("update.run", updateGatewayOpts, {
          sessionKey,
          note,
          restartDelayMs,
          timeoutMs: timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS,
        });
        return jsonResult({ ok: true, result });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}
