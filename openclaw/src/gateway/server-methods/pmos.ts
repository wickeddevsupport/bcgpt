import type { GatewayRequestHandlers } from "./types.js";
import { loadConfig } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import { requireWorkspaceId, isSuperAdmin } from "../workspace-context.js";

type ConnectorResult = {
  url: string | null;
  projectId?: string | null;
  configured: boolean;
  reachable: boolean | null;
  authOk: boolean | null;
  error: string | null;
  flagsUrl?: string | null;
  authUrl?: string | null;
  healthUrl?: string | null;
  mcpUrl?: string | null;
  editorUrl?: string | null;
  mode?: "embedded" | "remote";
  vendoredRepo?: string | null;
};

async function fetchJson(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; json: unknown | null; error: string | null }> {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        ...(opts.headers ?? {}),
        // Always request JSON; caller may override content-type.
        accept: "application/json",
      },
    });
    const text = await res.text().catch(() => "");
    const json = (() => {
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    })();
    return { ok: res.ok, status: res.status, json, error: res.ok ? null : text || res.statusText };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, json: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBaseUrl(raw: unknown, fallback: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  const normalized = value || fallback;
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function readConfigString(cfg: unknown, path: string[]): string | null {
  let cur: unknown = cfg;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
      return null;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  if (typeof cur !== "string") {
    return null;
  }
  const trimmed = cur.trim();
  return trimmed ? trimmed : null;
}

function isReachableStatus(code: number): boolean {
  // 401/403/404 still prove the upstream is alive.
  return code === 401 || code === 403 || code === 404;
}

export const pmosHandlers: GatewayRequestHandlers = {
  "pmos.connectors.status": async ({ respond, client }) => {
    try {
      const cfg = loadConfig() as unknown;

      // --- lookup workspace-scoped connectors (override global config when present)
      // workspace connectors live at: ~/.openclaw/workspaces/{workspaceId}/connectors.json
      // readWorkspaceConnectors returns null when not present.
      // NOTE: prefer workspace-specific entries when available.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
      const workspaceId = client?.pmosWorkspaceId ?? undefined;
      const workspaceConnectors = workspaceId ? await readWorkspaceConnectors(workspaceId) : null;

      const allowGlobalSecrets = Boolean(client && isSuperAdmin(client));
      const opsUrlRaw =
        (workspaceConnectors?.ops?.url as string | undefined) ??
        readConfigString(cfg, ["pmos", "connectors", "ops", "url"]) ??
        process.env.OPS_URL ??
        null;
      const opsUrl = normalizeBaseUrl(opsUrlRaw, "https://ops.wickedlab.io");
      const opsProjectId =
        (workspaceConnectors?.ops?.projectId as string | undefined) ??
        readConfigString(cfg, ["pmos", "connectors", "ops", "projectId"]) ??
        null;

      const bcgptUrl = normalizeBaseUrl(
        (workspaceConnectors?.bcgpt?.url as string | undefined) ??
          readConfigString(cfg, ["pmos", "connectors", "bcgpt", "url"]) ??
          process.env.BCGPT_URL ??
          null,
        "https://bcgpt.wickedlab.io",
      );
      const bcgptKey =
        (workspaceConnectors?.bcgpt?.apiKey as string | undefined) ??
        (allowGlobalSecrets
          ? readConfigString(cfg, ["pmos", "connectors", "bcgpt", "apiKey"]) ??
            (process.env.BCGPT_API_KEY?.trim() || null)
          : null);

      const { readLocalN8nConfig } = await import("../pmos-ops-proxy.js");
      const { findVendoredN8nRepo } = await import("../n8n-embed.js");
      const localN8n = readLocalN8nConfig();
      const vendoredRepo = findVendoredN8nRepo();

      const ops: ConnectorResult = {
        url: localN8n?.url ?? opsUrl,
        projectId: opsProjectId,
        configured: Boolean(localN8n || vendoredRepo || (opsUrlRaw && opsUrlRaw.trim())),
        reachable: null,
        authOk: null,
        mode: localN8n || vendoredRepo ? "embedded" : "remote",
        editorUrl: "/ops-ui/",
        vendoredRepo,
        healthUrl: localN8n ? `${localN8n.url}/healthz` : null,
        error: null,
      };

      const bcgpt: ConnectorResult = {
        url: bcgptUrl,
        configured: Boolean(bcgptKey),
        reachable: null,
        authOk: bcgptKey ? null : false,
        healthUrl: `${bcgptUrl}/health`,
        mcpUrl: `${bcgptUrl}/mcp`,
        error: null,
      };

      // Embedded n8n / ops runtime reachability.
      if (localN8n) {
        const localHealth = await fetchJson(`${localN8n.url}/healthz`, { method: "GET", timeoutMs: 3500 });
        ops.reachable = localHealth.ok || isReachableStatus(localHealth.status);
        if (!ops.reachable) {
          ops.error = localHealth.error || "EMBEDDED_N8N_UNREACHABLE";
        }
      } else if (vendoredRepo) {
        ops.reachable = false;
        ops.error = "Vendored n8n is present but runtime is not running (N8N_LOCAL_URL missing).";
      } else if (opsUrlRaw && opsUrlRaw.trim()) {
        const remoteHealth = await fetchJson(`${opsUrl}/healthz`, { method: "GET", timeoutMs: 3500 });
        ops.reachable = remoteHealth.ok || isReachableStatus(remoteHealth.status);
        if (!ops.reachable) {
          ops.error = remoteHealth.error || "OPS_REMOTE_UNREACHABLE";
        }
      }

      // BCGPT reachability
      const bcgptHealth = await fetchJson(bcgpt.healthUrl!, { method: "GET" });
      bcgpt.reachable = bcgptHealth.ok;
      if (!bcgptHealth.ok) {
        bcgpt.error = bcgptHealth.error || "BCGPT_UNREACHABLE";
      }

      // BCGPT API key check (MCP tools/list is the lightest auth probe)
      if (bcgptKey) {
        const bcgptAuth = await fetchJson(bcgpt.mcpUrl!, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bcgpt-api-key": bcgptKey,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "pmos-connectors-status",
            method: "tools/list",
            params: {},
          }),
        });
        const json = bcgptAuth.json as { error?: unknown } | null;
        const hasError = Boolean(json && typeof json === "object" && "error" in json && json.error);
        bcgpt.authOk = bcgptAuth.ok && !hasError;
        if ((!bcgptAuth.ok || hasError) && !bcgpt.error) {
          bcgpt.error = bcgptAuth.error || "BCGPT_AUTH_FAILED";
        }
      }

      respond(
        true,
        {
          checkedAtMs: Date.now(),
          ops,
          bcgpt,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  "pmos.config.workspace.get": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const target =
        typeof params?.workspaceId === "string" ? params.workspaceId.trim() : undefined;
      if (target && !isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "access denied"));
        return;
      }
      const workspaceId = target ?? requireWorkspaceId(client);
      const { readWorkspaceConfig, loadEffectiveWorkspaceConfig } = await import(
        "../workspace-config.js"
      );
      const workspaceConfig = (await readWorkspaceConfig(workspaceId)) ?? {};
      const effectiveConfig = await loadEffectiveWorkspaceConfig(workspaceId);
      respond(true, { workspaceId, workspaceConfig, effectiveConfig }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.config.workspace.set": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const p = params as Record<string, unknown> | undefined;
      const target = typeof p?.workspaceId === "string" ? p.workspaceId.trim() : undefined;
      if (target && !isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "access denied"));
        return;
      }
      const workspaceId = target ?? requireWorkspaceId(client);
      const patch = p?.patch;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "patch must be an object"));
        return;
      }
      const replace = p?.replace === true;
      const { patchWorkspaceConfig, writeWorkspaceConfig, loadEffectiveWorkspaceConfig } =
        await import("../workspace-config.js");
      const workspaceConfig = replace
        ? (patch as Record<string, unknown>)
        : await patchWorkspaceConfig(workspaceId, patch as Record<string, unknown>);
      if (replace) {
        await writeWorkspaceConfig(workspaceId, workspaceConfig);
      }
      const effectiveConfig = await loadEffectiveWorkspaceConfig(workspaceId);
      respond(true, { ok: true, workspaceId, workspaceConfig, effectiveConfig }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // Persist or read per-workspace connectors (workspace-admins can set for their workspace)
  "pmos.connectors.workspace.set": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      if (!params || typeof params !== "object") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing params"));
        return;
      }
      // Accept a `connectors` object (partial). Merge with existing.
      const connectors = (params as Record<string, unknown>).connectors as Record<string, unknown> | undefined;
      if (!connectors || typeof connectors !== "object") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "connectors must be an object"));
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { readWorkspaceConnectors, writeWorkspaceConnectors } = await import("../workspace-connectors.js");
      const existing = (await readWorkspaceConnectors(workspaceId)) ?? {};
      const next = { ...existing, ...(connectors as Record<string, unknown>) };
      await writeWorkspaceConnectors(workspaceId, next);
      respond(true, { ok: true, workspaceId, connectors: next }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.connectors.workspace.get": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const target = typeof params?.workspaceId === "string" ? params.workspaceId.trim() : undefined;
      // super_admin may request other workspace; non-super admins may only read their own
      if (target && !isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "access denied"));
        return;
      }
      const workspaceId = target ?? requireWorkspaceId(client);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
      const connectors = (await readWorkspaceConnectors(workspaceId)) ?? {};
      respond(true, { workspaceId, connectors }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // Provision legacy remote n8n fallback credentials for a workspace when needed.
  // - Attempts to create a Project using the global OPS API key
  // - Attempts to create a workspace-scoped API key (if supported)
  // - Persists `ops.url`, `ops.apiKey` and `ops.projectId` into the workspace connectors file
  // - Returns { projectId?, apiKey? } on success; responds with an explanatory error on failure
  "pmos.connectors.workspace.provision_ops": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const projectName =
        typeof params?.projectName === "string" && params.projectName.trim()
          ? params.projectName.trim()
          : undefined;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { provisionWorkspaceOps } = await import("../pmos-provision-ops.js");
      const result = await provisionWorkspaceOps(workspaceId, projectName);
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── BYOK (Bring Your Own Keys) ──────────────────────────────────────

  "pmos.config.get": async ({ respond, client }) => {
    const workspaceId = client?.pmosWorkspaceId;
    if (!workspaceId) {
      respond({ ok: false, error: "No workspace context" });
      return;
    }
    const { loadEffectiveWorkspaceConfig } = await import("../workspace-config.js");
    const config = await loadEffectiveWorkspaceConfig(workspaceId);
    respond({ ok: true, config });
  },

  "pmos.byok.list": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { listKeys } = await import("../byok-store.js");
      const keys = await listKeys(workspaceId);
      respond(true, { workspaceId, keys }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.byok.set": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as Record<string, unknown> | undefined;
      const provider = typeof p?.provider === "string" ? p.provider.trim() : "";
      const apiKey = typeof p?.apiKey === "string" ? p.apiKey.trim() : "";
      if (!provider || !apiKey) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "provider and apiKey are required"));
        return;
      }
      const label = typeof p?.label === "string" ? p.label.trim() : undefined;
      const defaultModel = typeof p?.defaultModel === "string" ? p.defaultModel.trim() : undefined;
      const { setKey } = await import("../byok-store.js");
      await setKey(workspaceId, provider as import("../byok-store.js").AIProvider, apiKey, { label, defaultModel });
      respond(true, { ok: true, workspaceId, provider }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.byok.remove": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const provider = typeof (params as Record<string, unknown>)?.provider === "string"
        ? ((params as Record<string, unknown>).provider as string).trim()
        : "";
      if (!provider) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "provider is required"));
        return;
      }
      const { removeKey } = await import("../byok-store.js");
      const removed = await removeKey(workspaceId, provider as import("../byok-store.js").AIProvider);
      respond(true, { ok: true, removed, workspaceId, provider }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.byok.validate": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as Record<string, unknown> | undefined;
      const provider = typeof p?.provider === "string" ? p.provider.trim() : "";
      // Accept either an inline apiKey or validate the stored key
      let apiKey = typeof p?.apiKey === "string" ? p.apiKey.trim() : "";
      if (!provider) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "provider is required"));
        return;
      }
      if (!apiKey) {
        // Try to read the stored key
        const { getKey } = await import("../byok-store.js");
        const stored = await getKey(workspaceId, provider as import("../byok-store.js").AIProvider);
        if (!stored) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `No key stored for provider "${provider}"`));
          return;
        }
        apiKey = stored;
      }
      const { validateKey, markValidated } = await import("../byok-store.js");
      const result = await validateKey(provider as import("../byok-store.js").AIProvider, apiKey);
      // If validating a stored key, mark it
      if (!p?.apiKey) {
        await markValidated(workspaceId, provider as import("../byok-store.js").AIProvider, result.valid);
      }
      respond(true, { ...result, provider, workspaceId }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.auth.check": async ({ params, respond, context, client }) => {
    // Check if a provider has API key available from ANY source (not just BYOK)
    try {
      const p = params as Record<string, unknown> | undefined;
      const provider = typeof p?.provider === "string" ? p.provider.trim() : "";
      if (!provider) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "provider is required"));
        return;
      }

      // Set BYOK workspace context for resolution
      const { setByokWorkspaceContext } = await import("../../agents/model-auth.js");
      setByokWorkspaceContext(client?.pmosWorkspaceId ?? null);

      const { resolveApiKeyForProvider } = await import("../../agents/model-auth.js");
      const result = await resolveApiKeyForProvider({
        provider,
        cfg: context.cfg,
        api: context.api,
      });
      respond(true, {
        provider,
        configured: result.mode !== "none",
        source: result.source ?? null,
        mode: result.mode,
      }, undefined);
    } catch (err) {
      respond(true, { provider: "", configured: false, source: null, mode: "none" }, undefined);
    }
  },

  // ── Chat-to-Workflow Creation ──────────────────────────────────────

  "pmos.workflow.create": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleWorkflowCreate } = await import("./chat-to-workflow.js");
      const result = await handleWorkflowCreate(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message || "Failed to create workflow"));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.workflow.template.list": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTemplateList } = await import("./chat-to-workflow.js");
      const result = await handleTemplateList(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.workflow.template.deploy": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTemplateDeploy } = await import("./chat-to-workflow.js");
      const result = await handleTemplateDeploy(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message || "Failed to deploy template"));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.workflow.confirm": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleWorkflowConfirm } = await import("./chat-to-workflow.js");
      const result = await handleWorkflowConfirm(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.workflow.intent.parse": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleIntentParse } = await import("./chat-to-workflow.js");
      const result = await handleIntentParse(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Multi-Agent Orchestration ──────────────────────────────────────

  "pmos.agent.parallel": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleParallelExecution } = await import("./agent-orchestration.js");
      const result = await handleParallelExecution(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message || "Parallel execution failed"));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.broadcast": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleAgentBroadcast } = await import("./agent-orchestration.js");
      const result = await handleAgentBroadcast(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.coordinate": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleOrchestration } = await import("./agent-orchestration.js");
      const result = await handleOrchestration(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message || "Orchestration failed"));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.task.status": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTaskStatusQuery } = await import("./agent-orchestration.js");
      const result = await handleTaskStatusQuery(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.task.cancel": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTaskCancel } = await import("./agent-orchestration.js");
      const result = await handleTaskCancel(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.task.list": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleAgentTasksQuery } = await import("./agent-orchestration.js");
      const result = await handleAgentTasksQuery(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.running.list": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleRunningTasksQuery } = await import("./agent-orchestration.js");
      const result = await handleRunningTasksQuery(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.broadcast.history": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleBroadcastHistoryQuery } = await import("./agent-orchestration.js");
      const result = await handleBroadcastHistoryQuery(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.template.list": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTemplateListQuery } = await import("./agent-orchestration.js");
      const result = await handleTemplateListQuery(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.agent.template.create": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTemplateCreate } = await import("./agent-orchestration.js");
      const result = await handleTemplateCreate(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message || "Failed to create agent from template"));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Live Flow Builder ──────────────────────────────────────────────

  "pmos.flow.canvas.subscribe": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleCanvasSubscribe } = await import("./live-flow-builder.js");
      const result = await handleCanvasSubscribe(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.canvas.unsubscribe": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleCanvasUnsubscribe } = await import("./live-flow-builder.js");
      const result = await handleCanvasUnsubscribe(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.execution.subscribe": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleExecutionSubscribe } = await import("./live-flow-builder.js");
      const result = await handleExecutionSubscribe(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.execution.unsubscribe": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleExecutionUnsubscribe } = await import("./live-flow-builder.js");
      const result = await handleExecutionUnsubscribe(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.updates.fetch": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handlePendingUpdatesFetch } = await import("./live-flow-builder.js");
      const result = await handlePendingUpdatesFetch(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.execution.history": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleExecutionHistoryFetch } = await import("./live-flow-builder.js");
      const result = await handleExecutionHistoryFetch(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.control": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleFlowControl } = await import("./live-flow-builder.js");
      const result = await handleFlowControl(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.node.move": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleNodeMove } = await import("./live-flow-builder.js");
      const result = await handleNodeMove(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.node.add": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleNodeAdd } = await import("./live-flow-builder.js");
      const result = await handleNodeAdd(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.node.remove": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleNodeRemove } = await import("./live-flow-builder.js");
      const result = await handleNodeRemove(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.connection.add": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleConnectionAdd } = await import("./live-flow-builder.js");
      const result = await handleConnectionAdd(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.connection.remove": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleConnectionRemove } = await import("./live-flow-builder.js");
      const result = await handleConnectionRemove(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.template.search": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTemplateSearch } = await import("./live-flow-builder.js");
      const result = await handleTemplateSearch(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.template.featured": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleFeaturedTemplatesFetch } = await import("./live-flow-builder.js");
      const result = await handleFeaturedTemplatesFetch(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.template.deploy": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleTemplateDeployment } = await import("./live-flow-builder.js");
      const result = await handleTemplateDeployment(params, client);
      respond(result.success, result, result.success ? undefined : errorShape(ErrorCodes.INVALID_REQUEST, result.message));
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.status": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleFlowBuilderStatusQuery } = await import("./live-flow-builder.js");
      const result = await handleFlowBuilderStatusQuery(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.flow.library.list": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const { handleWorkflowLibraryList } = await import("./live-flow-builder.js");
      const result = await handleWorkflowLibraryList(params, client);
      respond(result.success, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── AI Workflow Assistant (uses workspace BYOK model) ─────────────

  "pmos.workflow.assist": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);

      const p = params as {
        messages?: Array<{ role: string; content: string }>;
        message?: string;
      } | null;

      const rawMessages: Array<{ role: string; content: string }> = Array.isArray(p?.messages) ? [...p.messages] : [];
      if (p?.message && typeof p.message === "string") {
        rawMessages.push({ role: "user", content: p.message });
      }
      if (rawMessages.length === 0) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "messages required"));
        return;
      }

      const messages = rawMessages
        .filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({ role: m.role as "user" | "assistant", content: String(m.content) }));

      const { callWorkspaceModel, WORKFLOW_ASSISTANT_SYSTEM_PROMPT } = await import("../workflow-ai.js");

      // Fetch available credentials and inject into system prompt so AI can reference them
      const { fetchWorkspaceCredentials, buildCredentialContext } = await import("../credential-sync.js");
      const availableCredentials = await fetchWorkspaceCredentials(workspaceId).catch(() => []);
      const credentialContext = buildCredentialContext(availableCredentials);
      const systemPrompt = credentialContext
        ? `${WORKFLOW_ASSISTANT_SYSTEM_PROMPT}\n${credentialContext}`
        : WORKFLOW_ASSISTANT_SYSTEM_PROMPT;

      const result = await callWorkspaceModel(workspaceId, systemPrompt, messages, {
        maxTokens: 2048,
        jsonMode: true,
      });

      if (!result.ok) {
        respond(true, { ok: true, message: result.error ?? "AI model unavailable", workflow: null, providerError: true }, undefined);
        return;
      }

      let parsed: { message?: string; workflow?: unknown } = {};
      try {
        parsed = JSON.parse(result.text ?? "{}") as typeof parsed;
      } catch {
        parsed = { message: result.text ?? "" };
      }

      const assistantMessage = typeof parsed.message === "string" ? parsed.message : result.text ?? "";
      const workflow = parsed.workflow && typeof parsed.workflow === "object" ? parsed.workflow : null;

      respond(true, { ok: true, message: assistantMessage, workflow, providerUsed: result.providerUsed }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Connections: Real n8n credential list ─────────────────────────

  "pmos.connections.list": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { fetchWorkspaceCredentials } = await import("../credential-sync.js");
      const credentials = await fetchWorkspaceCredentials(workspaceId);
      respond(true, { credentials }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Super-admin: Workspace List ────────────────────────────────────

  "pmos.workspaces.list": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      if (!isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "super_admin role required"));
        return;
      }
      const { listPmosWorkspaces } = await import("../pmos-auth.js");
      const workspaces = await listPmosWorkspaces();
      respond(true, { workspaces }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Basecamp credential setup in n8n ──────────────────────────────

  "pmos.ops.setup.basecamp": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
      const wc = await readWorkspaceConnectors(workspaceId);
      const bcgptUrl = (wc?.bcgpt?.url as string | undefined)?.trim() || "https://bcgpt.wickedlab.io";
      const bcgptApiKey = (wc?.bcgpt?.apiKey as string | undefined)?.trim();
      if (!bcgptApiKey) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "No BCGPT API key stored. Save your Basecamp connection key in Integrations first."));
        return;
      }
      const { upsertBasecampCredential } = await import("../n8n-api-client.js");
      const result = await upsertBasecampCredential(workspaceId, bcgptUrl, bcgptApiKey);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to configure Basecamp credential in n8n"));
        return;
      }
      respond(true, { ok: true, credentialId: result.credentialId, message: "Basecamp credential configured in your workflow engine." }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── n8n Credentials Management ─────────────────────────────────────

  "pmos.n8n.credentials.list": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const { listN8nCredentials } = await import("../n8n-api-client.js");
      const result = await listN8nCredentials(workspaceId);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to list n8n credentials"));
        return;
      }
      respond(true, { credentials: result.credentials }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.n8n.credentials.create": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as { name?: string; type?: string; data?: Record<string, unknown> } | null;
      if (!p?.name || !p?.type) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "name and type required"));
        return;
      }
      const { createN8nCredential } = await import("../n8n-api-client.js");
      const result = await createN8nCredential(workspaceId, p.name, p.type, p.data || {});
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to create n8n credential"));
        return;
      }
      respond(true, { ok: true, credentialId: result.credentialId }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.n8n.credentials.delete": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const p = params as { credentialId?: string } | null;
      if (!p?.credentialId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "credentialId required"));
        return;
      }
      const { deleteN8nCredential } = await import("../n8n-api-client.js");
      const result = await deleteN8nCredential(workspaceId, p.credentialId);
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error || "Failed to delete n8n credential"));
        return;
      }
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
