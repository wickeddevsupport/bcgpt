import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { GatewayRequestHandlers } from "./types.js";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { abortEmbeddedPiRun, waitForEmbeddedPiRunEnd } from "../../agents/pi-embedded.js";
import { stopSubagentsForRequester } from "../../auto-reply/reply/abort.js";
import { clearSessionQueues } from "../../auto-reply/reply/queue.js";
import { loadConfig } from "../../config/config.js";
import {
  loadSessionStore,
  snapshotSessionOrigin,
  resolveMainSessionKey,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSessionsCompactParams,
  validateSessionsDeleteParams,
  validateSessionsListParams,
  validateSessionsPatchParams,
  validateSessionsPreviewParams,
  validateSessionsResetParams,
  validateSessionsResolveParams,
} from "../protocol/index.js";
import {
  annotateSessionsWithActiveRuns,
  archiveFileOnDisk,
  listAgentsForGateway,
  listSessionsFromStore,
  loadCombinedSessionStoreForGateway,
  loadSessionEntryForConfig,
  readSessionPreviewItemsFromTranscript,
  resolveGatewaySessionStoreTarget,
  resolveSessionModelRef,
  resolveSessionTranscriptCandidates,
  type SessionsPatchResult,
  type SessionsPreviewEntry,
  type SessionsPreviewResult,
} from "../session-utils.js";
import { applySessionsPatchToStore } from "../sessions-patch.js";
import { resolveSessionKeyFromResolveParams } from "../sessions-resolve.js";
import { isSuperAdmin } from "../workspace-context.js";
import { GLOBAL_EVENT_SCOPE_KEY, matchesWorkspaceEventScope, resolveWorkspaceEventScopeKey } from "../workspace-event-scope.js";
import { resolveEffectiveRequestWorkspaceId } from "../workspace-request.js";
import type { GatewayClient } from "./types.js";

async function loadSessionsConfigForClient(
  client?: GatewayClient,
  params?: unknown,
): Promise<ReturnType<typeof loadConfig>> {
  let cfg = loadConfig();
  const workspaceId = resolveEffectiveRequestWorkspaceId(client ?? null, params) ?? "";
  if (!workspaceId) {
    return cfg;
  }
  try {
    const { loadEffectiveWorkspaceConfig } = await import("../workspace-config.js");
    const effectiveCfg = await loadEffectiveWorkspaceConfig(workspaceId);
    if (effectiveCfg && typeof effectiveCfg === "object") {
      cfg = effectiveCfg as typeof cfg;
    }
  } catch {
    // Fall back to global config if workspace effective config cannot be loaded.
  }
  return cfg;
}

function resolveWorkspaceSessionAgentIds(
  cfg: ReturnType<typeof loadConfig>,
  client?: GatewayClient,
  params?: unknown,
): Set<string> | null {
  const workspaceId = resolveEffectiveRequestWorkspaceId(client ?? null, params) ?? "";
  if (!workspaceId) {
    return !client || isSuperAdmin(client) ? null : new Set<string>();
  }
  const { agents } = listAgentsForGateway(cfg);
  return new Set(
    agents
      .filter((a) => (typeof a.workspaceId === "string" ? a.workspaceId.trim() : "") === workspaceId)
      .map((a) => a.id),
  );
}

function isWorkspaceVisibleSessionKey(key: string, workspaceAgentIds: Set<string>): boolean {
  if (key === "global" || key === "unknown") {
    return false;
  }
  const parsed = parseAgentSessionKey(key);
  if (!parsed?.agentId) {
    return false;
  }
  const agentId = normalizeAgentId(parsed.agentId);
  return workspaceAgentIds.has(agentId);
}

function resolveClientMainSessionKey(
  cfg: ReturnType<typeof loadConfig>,
  client?: GatewayClient,
): string {
  if (!client || isSuperAdmin(client)) {
    return resolveMainSessionKey(cfg);
  }
  const workspaceId =
    typeof client.pmosWorkspaceId === "string" ? client.pmosWorkspaceId.trim() : "";
  if (!workspaceId) {
    return resolveMainSessionKey(cfg);
  }
  const listed = listAgentsForGateway(cfg);
  const workspaceAgents = listed.agents.filter(
    (agent) => (typeof agent.workspaceId === "string" ? agent.workspaceId.trim() : "") === workspaceId,
  );
  const defaultAgentId =
    (workspaceAgents.some((agent) => agent.id === listed.defaultId) ? listed.defaultId : undefined) ??
    workspaceAgents[0]?.id;
  if (!defaultAgentId) {
    return resolveMainSessionKey(cfg);
  }
  return resolveMainSessionKey({
    session: cfg.session,
    agents: { list: [{ id: defaultAgentId, default: true }] },
  } as any);
}

function withMainSessionFallback(params: {
  cfg: ReturnType<typeof loadConfig>;
  storePath: string;
  store: Record<string, SessionEntry>;
  opts: typeof validateSessionsListParams extends { } ? any : never;
  result: ReturnType<typeof listSessionsFromStore>;
  client?: GatewayClient;
}) {
  const { cfg, storePath, store, opts, result, client } = params;
  const activeMinutes =
    typeof opts.activeMinutes === "number" && Number.isFinite(opts.activeMinutes)
      ? Math.max(1, Math.floor(opts.activeMinutes))
      : undefined;
  if (activeMinutes === undefined || result.count > 0) {
    return result;
  }
  const mainKey = resolveClientMainSessionKey(cfg, client);
  if (!mainKey) {
    return result;
  }
  const fallbackResult = listSessionsFromStore({
    cfg,
    storePath,
    store,
    opts: { ...opts, activeMinutes: undefined, limit: undefined },
  });
  const mainRow =
    fallbackResult.sessions.find((row) => row.key === mainKey) ??
    (fallbackResult.sessions.length === 1 ? fallbackResult.sessions[0] : undefined);
  if (!mainRow) {
    return result;
  }
  return {
    ...result,
    count: 1,
    sessions: [mainRow],
  };
}

function collectActiveRunsBySessionKey(
  chatAbortControllers: ReadonlyMap<
    string,
    { sessionKey: string; scopeKey?: string; startedAtMs?: number }
  >,
  scopeKey: string,
): Map<string, { runId: string }> {
  const activeRuns = new Map<string, { runId: string; startedAtMs: number }>();
  for (const [runId, entry] of chatAbortControllers.entries()) {
    const sessionKey = typeof entry?.sessionKey === "string" ? entry.sessionKey.trim() : "";
    if (!sessionKey) {
      continue;
    }
    const entryScopeKey =
      typeof entry?.scopeKey === "string" && entry.scopeKey.trim()
        ? entry.scopeKey.trim()
        : GLOBAL_EVENT_SCOPE_KEY;
    if (!matchesWorkspaceEventScope(scopeKey, entryScopeKey)) {
      continue;
    }
    const startedAtMs =
      typeof entry?.startedAtMs === "number" && Number.isFinite(entry.startedAtMs)
        ? entry.startedAtMs
        : 0;
    const current = activeRuns.get(sessionKey);
    if (!current || startedAtMs >= current.startedAtMs) {
      activeRuns.set(sessionKey, { runId, startedAtMs });
    }
  }
  return new Map(
    Array.from(activeRuns.entries()).map(([sessionKey, value]) => [
      sessionKey,
      { runId: value.runId },
    ]),
  );
}

export const sessionsHandlers: GatewayRequestHandlers = {
  "sessions.list": async ({ params, respond, client, context }) => {
    if (!validateSessionsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.list params: ${formatValidationErrors(validateSessionsListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const cfg = await loadSessionsConfigForClient(client, p);
    const scopeKey = resolveWorkspaceEventScopeKey(client);
    const { storePath, store } = loadCombinedSessionStoreForGateway(cfg);
    
    // Apply workspace filtering for PMOS multi-tenant isolation
    const workspaceAgentIds = resolveWorkspaceSessionAgentIds(cfg, client, p);
    if (workspaceAgentIds) {
      // Filter store to only include sessions for workspace agents
      const filteredStore: Record<string, SessionEntry> = {};
      for (const [key, entry] of Object.entries(store)) {
        if (isWorkspaceVisibleSessionKey(key, workspaceAgentIds)) {
          filteredStore[key] = entry;
        }
      }
      
      const result = listSessionsFromStore({
        cfg,
        storePath,
        store: filteredStore,
        opts: p,
      });
      const withFallback = withMainSessionFallback({
        cfg,
        storePath,
        store: filteredStore,
        opts: p,
        result,
        client,
      });
      respond(
        true,
        annotateSessionsWithActiveRuns(
          withFallback,
          collectActiveRunsBySessionKey(context.chatAbortControllers, scopeKey),
        ),
        undefined,
      );
      return;
    }
    
    const result = listSessionsFromStore({
      cfg,
      storePath,
      store,
      opts: p,
    });
    const withFallback = withMainSessionFallback({
      cfg,
      storePath,
      store,
      opts: p,
      result,
      client,
    });
    respond(
      true,
      annotateSessionsWithActiveRuns(
        withFallback,
        collectActiveRunsBySessionKey(context.chatAbortControllers, scopeKey),
      ),
      undefined,
    );
  },
  "sessions.preview": async ({ params, respond, client }) => {
    if (!validateSessionsPreviewParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.preview params: ${formatValidationErrors(
            validateSessionsPreviewParams.errors,
          )}`,
        ),
      );
      return;
    }
    const p = params;
    const keysRaw = Array.isArray(p.keys) ? p.keys : [];
    const keys = keysRaw
      .map((key) => String(key ?? "").trim())
      .filter(Boolean)
      .slice(0, 64);
    const limit =
      typeof p.limit === "number" && Number.isFinite(p.limit) ? Math.max(1, p.limit) : 12;
    const maxChars =
      typeof p.maxChars === "number" && Number.isFinite(p.maxChars)
        ? Math.max(20, p.maxChars)
        : 240;

    if (keys.length === 0) {
      respond(true, { ts: Date.now(), previews: [] } satisfies SessionsPreviewResult, undefined);
      return;
    }

    const cfg = await loadSessionsConfigForClient(client, p);
    const workspaceAgentIds = resolveWorkspaceSessionAgentIds(cfg, client, p);
    
    const storeCache = new Map<string, Record<string, SessionEntry>>();
    const previews: SessionsPreviewEntry[] = [];

    for (const key of keys) {
      try {
        const target = resolveGatewaySessionStoreTarget({ cfg, key });
        
        // Check workspace ownership for non-super-admin users
        if (workspaceAgentIds && !workspaceAgentIds.has(target.agentId)) {
          previews.push({ key, status: "missing", items: [] });
          continue;
        }
        
        const store = storeCache.get(target.storePath) ?? loadSessionStore(target.storePath);
        storeCache.set(target.storePath, store);
        const entry =
          target.storeKeys.map((candidate) => store[candidate]).find(Boolean) ??
          store[target.canonicalKey];
        if (!entry?.sessionId) {
          previews.push({ key, status: "missing", items: [] });
          continue;
        }
        const items = readSessionPreviewItemsFromTranscript(
          entry.sessionId,
          target.storePath,
          entry.sessionFile,
          target.agentId,
          limit,
          maxChars,
        );
        previews.push({
          key,
          status: items.length > 0 ? "ok" : "empty",
          items,
        });
      } catch {
        previews.push({ key, status: "error", items: [] });
      }
    }

    respond(true, { ts: Date.now(), previews } satisfies SessionsPreviewResult, undefined);
  },
  "sessions.resolve": async ({ params, respond, client }) => {
    if (!validateSessionsResolveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.resolve params: ${formatValidationErrors(validateSessionsResolveParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const cfg = await loadSessionsConfigForClient(client, p);

    const resolved = resolveSessionKeyFromResolveParams({ cfg, p });
    if (!resolved.ok) {
      respond(false, undefined, resolved.error);
      return;
    }
    
    const workspaceAgentIds = resolveWorkspaceSessionAgentIds(cfg, client, p);
    if (workspaceAgentIds) {
      const target = resolveGatewaySessionStoreTarget({ cfg, key: resolved.key });
      if (!workspaceAgentIds.has(target.agentId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `session "${resolved.key}" not found`),
        );
        return;
      }
    }
    
    respond(true, { ok: true, key: resolved.key }, undefined);
  },
  "sessions.patch": async ({ params, respond, context, client }) => {
    if (!validateSessionsPatchParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.patch params: ${formatValidationErrors(validateSessionsPatchParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const key = String(p.key ?? "").trim();
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
      return;
    }

    const cfg = await loadSessionsConfigForClient(client, p);
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const workspaceAgentIds = resolveWorkspaceSessionAgentIds(cfg, client, p);
    if (workspaceAgentIds) {
      if (!workspaceAgentIds.has(target.agentId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `session "${key}" not found`),
        );
        return;
      }
    }
    
    const storePath = target.storePath;
    const applied = await updateSessionStore(storePath, async (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      return await applySessionsPatchToStore({
        cfg,
        store,
        storeKey: primaryKey,
        patch: p,
        loadGatewayModelCatalog: context.loadGatewayModelCatalog,
      });
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }
    const parsed = parseAgentSessionKey(target.canonicalKey ?? key);
    const agentId = normalizeAgentId(parsed?.agentId ?? resolveDefaultAgentId(cfg));
    const resolved = resolveSessionModelRef(cfg, applied.entry, agentId);
    const result: SessionsPatchResult = {
      ok: true,
      path: storePath,
      key: target.canonicalKey,
      entry: applied.entry,
      resolved: {
        modelProvider: resolved.provider,
        model: resolved.model,
      },
    };
    respond(true, result, undefined);
  },
  "sessions.reset": async ({ params, respond, client }) => {
    if (!validateSessionsResetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.reset params: ${formatValidationErrors(validateSessionsResetParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const key = String(p.key ?? "").trim();
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
      return;
    }

    const cfg = await loadSessionsConfigForClient(client, p);
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const workspaceAgentIds = resolveWorkspaceSessionAgentIds(cfg, client, p);
    if (workspaceAgentIds) {
      if (!workspaceAgentIds.has(target.agentId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `session "${key}" not found`),
        );
        return;
      }
    }
    
    const storePath = target.storePath;
    const next = await updateSessionStore(storePath, (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      const entry = store[primaryKey];
      const now = Date.now();
      const nextEntry: SessionEntry = {
        sessionId: randomUUID(),
        updatedAt: now,
        systemSent: false,
        abortedLastRun: false,
        thinkingLevel: entry?.thinkingLevel,
        verboseLevel: entry?.verboseLevel,
        reasoningLevel: entry?.reasoningLevel,
        responseUsage: entry?.responseUsage,
        model: entry?.model,
        contextTokens: entry?.contextTokens,
        sendPolicy: entry?.sendPolicy,
        label: entry?.label,
        origin: snapshotSessionOrigin(entry),
        lastChannel: entry?.lastChannel,
        lastTo: entry?.lastTo,
        skillsSnapshot: entry?.skillsSnapshot,
        // Reset token counts to 0 on session reset (#1523)
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
      store[primaryKey] = nextEntry;
      return nextEntry;
    });
    respond(true, { ok: true, key: target.canonicalKey, entry: next }, undefined);
  },
  "sessions.delete": async ({ params, respond, client }) => {
    if (!validateSessionsDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.delete params: ${formatValidationErrors(validateSessionsDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const key = String(p.key ?? "").trim();
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
      return;
    }

    const cfg = await loadSessionsConfigForClient(client, p);
    const mainKey = resolveMainSessionKey(cfg);
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    if (target.canonicalKey === mainKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Cannot delete the main session (${mainKey}).`),
      );
      return;
    }

    const workspaceAgentIds = resolveWorkspaceSessionAgentIds(cfg, client, p);
    if (workspaceAgentIds) {
      if (!workspaceAgentIds.has(target.agentId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `session "${key}" not found`),
        );
        return;
      }
    }

    const deleteTranscript = typeof p.deleteTranscript === "boolean" ? p.deleteTranscript : true;

    const storePath = target.storePath;
    const { entry } = loadSessionEntryForConfig(cfg, key);
    const sessionId = entry?.sessionId;
    const existed = Boolean(entry);
    const queueKeys = new Set<string>(target.storeKeys);
    queueKeys.add(target.canonicalKey);
    if (sessionId) {
      queueKeys.add(sessionId);
    }
    clearSessionQueues([...queueKeys]);
    stopSubagentsForRequester({ cfg, requesterSessionKey: target.canonicalKey });
    if (sessionId) {
      abortEmbeddedPiRun(sessionId);
      const ended = await waitForEmbeddedPiRunEnd(sessionId, 15_000);
      if (!ended) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `Session ${key} is still active; try again in a moment.`,
          ),
        );
        return;
      }
    }
    await updateSessionStore(storePath, (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      if (store[primaryKey]) {
        delete store[primaryKey];
      }
    });

    const archived: string[] = [];
    if (deleteTranscript && sessionId) {
      for (const candidate of resolveSessionTranscriptCandidates(
        sessionId,
        storePath,
        entry?.sessionFile,
        target.agentId,
      )) {
        if (!fs.existsSync(candidate)) {
          continue;
        }
        try {
          archived.push(archiveFileOnDisk(candidate, "deleted"));
        } catch {
          // Best-effort.
        }
      }
    }

    respond(true, { ok: true, key: target.canonicalKey, deleted: existed, archived }, undefined);
  },
  "sessions.compact": async ({ params, respond, client }) => {
    if (!validateSessionsCompactParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.compact params: ${formatValidationErrors(validateSessionsCompactParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const key = String(p.key ?? "").trim();
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
      return;
    }

    const maxLines =
      typeof p.maxLines === "number" && Number.isFinite(p.maxLines)
        ? Math.max(1, Math.floor(p.maxLines))
        : 400;

    const cfg = await loadSessionsConfigForClient(client, p);
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const workspaceAgentIds = resolveWorkspaceSessionAgentIds(cfg, client, p);
    if (workspaceAgentIds) {
      if (!workspaceAgentIds.has(target.agentId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `session "${key}" not found`),
        );
        return;
      }
    }
    
    const storePath = target.storePath;
    // Lock + read in a short critical section; transcript work happens outside.
    const compactTarget = await updateSessionStore(storePath, (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      return { entry: store[primaryKey], primaryKey };
    });
    const entry = compactTarget.entry;
    const sessionId = entry?.sessionId;
    if (!sessionId) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          reason: "no sessionId",
        },
        undefined,
      );
      return;
    }

    const filePath = resolveSessionTranscriptCandidates(
      sessionId,
      storePath,
      entry?.sessionFile,
      target.agentId,
    ).find((candidate) => fs.existsSync(candidate));
    if (!filePath) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          reason: "no transcript",
        },
        undefined,
      );
      return;
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= maxLines) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          kept: lines.length,
        },
        undefined,
      );
      return;
    }

    const archived = archiveFileOnDisk(filePath, "bak");
    const keptLines = lines.slice(-maxLines);
    fs.writeFileSync(filePath, `${keptLines.join("\n")}\n`, "utf-8");

    await updateSessionStore(storePath, (store) => {
      const entryKey = compactTarget.primaryKey;
      const entryToUpdate = store[entryKey];
      if (!entryToUpdate) {
        return;
      }
      delete entryToUpdate.inputTokens;
      delete entryToUpdate.outputTokens;
      delete entryToUpdate.totalTokens;
      entryToUpdate.updatedAt = Date.now();
    });

    respond(
      true,
      {
        ok: true,
        key: target.canonicalKey,
        compacted: true,
        archived,
        kept: keptLines.length,
      },
      undefined,
    );
  },
};
