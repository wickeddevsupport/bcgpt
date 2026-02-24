import type { GatewayRequestHandlers } from "./types.js";
import { loadConfig, writeConfigFile, type OpenClawConfig } from "../../config/config.js";
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
  identity?: {
    connected: boolean;
    name?: string | null;
    email?: string | null;
    selectedAccountId?: string | null;
    accountsCount?: number;
    message?: string | null;
  };
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function deepMergeJson(base: unknown, patch: unknown): unknown {
  if (!isJsonObject(base) || !isJsonObject(patch)) {
    return patch;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = deepMergeJson(out[key], value);
  }
  return out;
}

type PmosProjectHealth = "at_risk" | "attention" | "on_track" | "quiet";

type PmosProjectTodoItem = {
  id: string | null;
  title: string;
  status: string | null;
  dueOn: string | null;
  projectId: string | null;
  projectName: string | null;
  appUrl: string | null;
};

type PmosProjectCard = {
  id: string;
  name: string;
  status: string;
  appUrl: string | null;
  todoLists: number;
  openTodos: number;
  overdueTodos: number;
  dueTodayTodos: number;
  nextDueOn: string | null;
  health: PmosProjectHealth;
};

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberStringOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return stringOrNull(value);
}

function parseProjectIdFromAppUrl(appUrl: string | null): string | null {
  if (!appUrl) return null;
  const bucketMatch = appUrl.match(/\/buckets\/(\d+)/i);
  if (bucketMatch?.[1]) return bucketMatch[1];
  const projectMatch = appUrl.match(/\/projects\/(\d+)/i);
  if (projectMatch?.[1]) return projectMatch[1];
  return null;
}

function normalizeBcgptToolResult(result: unknown): unknown {
  if (!isJsonObject(result)) {
    return result;
  }
  const content = result.content;
  if (!Array.isArray(content)) {
    return result;
  }
  for (const item of content) {
    if (!isJsonObject(item)) continue;
    const text = stringOrNull(item.text);
    if (!text) continue;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Keep scanning; some content entries are plain text.
    }
  }
  return result;
}

async function callBcgptTool(params: {
  bcgptUrl: string;
  apiKey: string;
  toolName: string;
  toolArgs?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ ok: boolean; result: unknown | null; error: string | null }> {
  const body = {
    jsonrpc: "2.0",
    id: `pmos-${params.toolName}-${Date.now()}`,
    method: "tools/call",
    params: {
      name: params.toolName,
      arguments: params.toolArgs ?? {},
    },
  };
  const rpc = await fetchJson(`${params.bcgptUrl}/mcp`, {
    method: "POST",
    timeoutMs: params.timeoutMs ?? 15_000,
    headers: {
      "content-type": "application/json",
      "x-bcgpt-api-key": params.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!rpc.ok || !isJsonObject(rpc.json)) {
    return { ok: false, result: null, error: rpc.error || `${params.toolName} request failed` };
  }

  const payload = rpc.json as Record<string, unknown>;
  if (isJsonObject(payload.error)) {
    const code = stringOrNull(payload.error.code);
    const message = stringOrNull(payload.error.message);
    return {
      ok: false,
      result: null,
      error: [code, message].filter(Boolean).join(": ") || `${params.toolName} failed`,
    };
  }

  const rawResult = payload.result ?? null;
  return { ok: true, result: normalizeBcgptToolResult(rawResult), error: null };
}

function parseProjectList(result: unknown): Array<{ id: string; name: string; status: string; appUrl: string | null }> {
  const listRaw = (() => {
    if (isJsonObject(result) && Array.isArray(result.projects)) return result.projects;
    if (Array.isArray(result)) return result;
    return [];
  })();

  const out: Array<{ id: string; name: string; status: string; appUrl: string | null }> = [];
  for (const item of listRaw) {
    if (!isJsonObject(item)) continue;
    const id = numberStringOrNull(item.id);
    const name = stringOrNull(item.name);
    if (!id || !name) continue;
    out.push({
      id,
      name,
      status: stringOrNull(item.status) ?? "active",
      appUrl: stringOrNull(item.app_url) ?? stringOrNull(item.appUrl),
    });
  }
  return out;
}

function parseTodoItems(
  result: unknown,
  key: string,
  projectNameById: Map<string, string>,
): PmosProjectTodoItem[] {
  if (!isJsonObject(result) || !Array.isArray(result[key])) {
    return [];
  }
  const todos = result[key];
  const items: PmosProjectTodoItem[] = [];
  for (const raw of todos) {
    if (!isJsonObject(raw)) continue;
    const title = stringOrNull(raw.title);
    if (!title) continue;
    const appUrl = stringOrNull(raw.app_url) ?? stringOrNull(raw.appUrl);
    const project = isJsonObject(raw.project) ? raw.project : null;
    const projectId =
      numberStringOrNull(project?.id) ??
      parseProjectIdFromAppUrl(appUrl);
    const projectName =
      stringOrNull(project?.name) ??
      (projectId ? projectNameById.get(projectId) ?? null : null);
    items.push({
      id: numberStringOrNull(raw.id),
      title,
      status: stringOrNull(raw.status),
      dueOn: stringOrNull(raw.due_on),
      projectId,
      projectName,
      appUrl,
    });
  }
  return items;
}

function projectHealthFromCounts(counts: {
  openTodos: number;
  overdueTodos: number;
  dueTodayTodos: number;
}): PmosProjectHealth {
  if (counts.overdueTodos > 0) return "at_risk";
  if (counts.dueTodayTodos > 0 || counts.openTodos >= 12) return "attention";
  if (counts.openTodos === 0) return "quiet";
  return "on_track";
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

        // Fetch Basecamp identity/account status for richer UI cards.
        const bcgptIdentity = await fetchJson(`${bcgptUrl}/action/startbcgpt`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bcgpt-api-key": bcgptKey,
          },
          body: JSON.stringify({}),
        });
        if (bcgptIdentity.ok && isJsonObject(bcgptIdentity.json)) {
          const payload = bcgptIdentity.json as Record<string, unknown>;
          const user = isJsonObject(payload.user) ? payload.user : null;
          const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
          bcgpt.identity = {
            connected: payload.connected === true,
            name: typeof user?.name === "string" ? user.name : null,
            email: typeof user?.email === "string" ? user.email : null,
            selectedAccountId:
              typeof payload.selected_account_id === "string" ||
              typeof payload.selected_account_id === "number"
                ? String(payload.selected_account_id)
                : null,
            accountsCount: accounts.length,
            message: typeof payload.message === "string" ? payload.message : null,
          };
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

  "pmos.config.global.get": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      if (!isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "super_admin role required"));
        return;
      }
      const config = loadConfig() as unknown;
      respond(
        true,
        { config: isJsonObject(config) ? config : {} },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.config.global.set": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      if (!isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "super_admin role required"));
        return;
      }
      const p = params as Record<string, unknown> | undefined;
      const patch = p?.patch;
      if (!isJsonObject(patch)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "patch must be an object"));
        return;
      }
      const replace = p?.replace === true;
      const current = loadConfig() as unknown;
      const base = isJsonObject(current) ? current : {};
      const merged = replace ? patch : deepMergeJson(base, patch);
      if (!isJsonObject(merged)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid config payload"));
        return;
      }
      await writeConfigFile(merged as OpenClawConfig);
      const next = loadConfig() as unknown;
      respond(
        true,
        { ok: true, config: isJsonObject(next) ? next : {} },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
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

  "pmos.context.workspace.get": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const target = typeof params?.workspaceId === "string" ? params.workspaceId.trim() : undefined;
      if (target && !isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "access denied"));
        return;
      }
      const workspaceId = target ?? requireWorkspaceId(client);
      const { readWorkspaceAiContext, workspaceAiContextPath } = await import(
        "../workspace-ai-context.js"
      );
      const contextMarkdown = (await readWorkspaceAiContext(workspaceId)) ?? "";
      respond(
        true,
        {
          workspaceId,
          path: workspaceAiContextPath(workspaceId),
          context: contextMarkdown,
          exists: Boolean(contextMarkdown.trim()),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "pmos.context.workspace.refresh": async ({ params, respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const target = typeof params?.workspaceId === "string" ? params.workspaceId.trim() : undefined;
      if (target && !isSuperAdmin(client)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "access denied"));
        return;
      }
      const workspaceId = target ?? requireWorkspaceId(client);
      const { refreshWorkspaceAiContext } = await import("../workspace-ai-context.js");
      const refreshed = await refreshWorkspaceAiContext(workspaceId, {
        includeLiveCredentials: true,
      });
      respond(
        true,
        {
          ok: true,
          workspaceId: refreshed.workspaceId,
          path: refreshed.path,
          generatedAt: refreshed.generatedAt,
          context: refreshed.markdown,
        },
        undefined,
      );
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
      const merged = deepMergeJson(existing, connectors as Record<string, unknown>);
      const next = isJsonObject(merged) ? merged : existing;
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
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "No workspace context"));
      return;
    }
    const { loadEffectiveWorkspaceConfig } = await import("../workspace-config.js");
    const config = await loadEffectiveWorkspaceConfig(workspaceId);
    respond(true, { ok: true, config }, undefined);
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

  "pmos.auth.check": async ({ params, respond, client }) => {
    // Check if a provider has API key available from global auth sources.
    try {
      const p = params as Record<string, unknown> | undefined;
      const provider = typeof p?.provider === "string" ? p.provider.trim() : "";
      if (!provider) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "provider is required"));
        return;
      }

      const { resolveApiKeyForProvider } = await import("../../agents/model-auth.js");
      const result = await resolveApiKeyForProvider({ provider, cfg: loadConfig() });
      respond(true, {
        provider,
        configured: Boolean(result.apiKey) || result.mode === "aws-sdk",
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

  // ── AI Workflow Assistant (uses global openclaw.json model config) ─────────────

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
      const latestUserPrompt =
        [...messages].reverse().find((entry) => entry.role === "user")?.content ?? "";

      const {
        callWorkspaceModel,
        WORKFLOW_ASSISTANT_SYSTEM_PROMPT,
        getWorkspaceN8nNodeCatalog,
      } = await import("../workflow-ai.js");
      const { getWorkspaceAiContextForPrompt } = await import("../workspace-ai-context.js");

      // Fetch available credentials and inject into system prompt so AI can reference them
      const {
        fetchWorkspaceCredentials,
        buildCredentialContext,
        autoLinkNodeCredentials,
      } = await import("../credential-sync.js");
      const withTimeout = async <T>(
        promise: Promise<T>,
        timeoutMs: number,
        fallback: T,
      ): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
          return await Promise.race([
            promise,
            new Promise<T>((resolve) => {
              timer = setTimeout(() => resolve(fallback), timeoutMs);
            }),
          ]);
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
        }
      };

      const availableCredentials = await withTimeout(
        fetchWorkspaceCredentials(workspaceId).catch(() => []),
        6000,
        [] as Awaited<ReturnType<typeof fetchWorkspaceCredentials>>,
      );
      const credentialContext = buildCredentialContext(availableCredentials);
      const liveNodeCatalog = await withTimeout(
        getWorkspaceN8nNodeCatalog(workspaceId).catch(() => ""),
        6000,
        "",
      );
      const workspaceAiContext = await withTimeout(
        getWorkspaceAiContextForPrompt(workspaceId, {
          ensureFresh: true,
          maxChars: 12_000,
          credentials: availableCredentials,
        }).catch(() => ""),
        4000,
        "",
      );
      const workspaceContext = `## Workspace Context
- Workspace ID: ${workspaceId}
- Use node type names from the live workspace catalog when available.
- Treat openclaw.json + workspace connector data as the source of truth for integration configuration.
- Treat AI_CONTEXT.md as current workspace memory for connectors, models, and agent assignments.
- If required credentials are missing, explicitly tell the user which provider config to add in openclaw.json.
- If a live node catalog is unavailable, explicitly say so instead of inventing node names.`;
      const workspaceMemoryContext = workspaceAiContext
        ? `## Workspace Memory Snapshot (AI_CONTEXT.md)\n${workspaceAiContext}`
        : "";
      const systemPrompt = [
        WORKFLOW_ASSISTANT_SYSTEM_PROMPT,
        liveNodeCatalog,
        credentialContext,
        workspaceContext,
        workspaceMemoryContext,
      ]
        .filter((part) => part && part.trim().length > 0)
        .join("\n\n");

      const buildDeterministicWorkflowFromPrompt = (promptRaw: string) => {
        const prompt = String(promptRaw ?? "").trim();
        if (!prompt) {
          return null;
        }
        const lower = prompt.toLowerCase();
        if (!/(workflow|webhook|automation|n8n|basecamp)/.test(lower)) {
          return null;
        }

        const now = Date.now();
        const nameMatch = prompt.match(/(?:exact\s+name|name)\s+([A-Za-z0-9._:-]+)/i);
        const workflowName = (nameMatch?.[1] ?? `Workflow_${now}`).trim();

        const pathMatch = prompt.match(
          /(?:webhook\s+(?:trigger\s+)?path|trigger\s+path|path)\s+([A-Za-z0-9/_-]+)/i,
        );
        const webhookPathRaw = (pathMatch?.[1] ?? `wf-${now}`).trim();
        const webhookPath = webhookPathRaw.replace(/[^A-Za-z0-9/_-]/g, "") || `wf-${now}`;

        let responseBody = JSON.stringify({ ok: true });
        const jsonMatch = prompt.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            responseBody = JSON.stringify(JSON.parse(jsonMatch[0]));
          } catch {
            // Keep default response body if user-provided snippet isn't valid JSON.
          }
        }

        const includeBasecamp = /\bbasecamp\b/.test(lower);
        const includeIfNode = /\bif\b|\bbranch\b/.test(lower);

        const nodes: Array<Record<string, unknown>> = [];
        const connections: Record<string, unknown> = {};
        const connect = (from: string, to: string) => {
          connections[from] = {
            main: [[{ node: to, type: "main", index: 0 }]],
          };
        };

        const webhookNodeName = "Webhook Trigger";
        nodes.push({
          id: `wf-node-webhook-${now}`,
          name: webhookNodeName,
          type: "n8n-nodes-base.webhookTrigger",
          typeVersion: 1,
          position: [280, 280],
          parameters: {
            path: webhookPath,
            httpMethod: "POST",
            responseMode: "responseNode",
          },
        });

        let previousNodeName = webhookNodeName;

        if (includeBasecamp) {
          const basecampNodeName = "Basecamp";
          nodes.push({
            id: `wf-node-basecamp-${now}`,
            name: basecampNodeName,
            type: "n8n-nodes-basecamp.basecamp",
            typeVersion: 1,
            position: [520, 280],
            parameters: {
              resource: "project",
              operation: "getAll",
            },
          });
          connect(previousNodeName, basecampNodeName);
          previousNodeName = basecampNodeName;
        }

        if (includeIfNode) {
          const ifNodeName = "If";
          nodes.push({
            id: `wf-node-if-${now}`,
            name: ifNodeName,
            type: "n8n-nodes-base.if",
            typeVersion: 1,
            position: [760, 280],
            parameters: {
              conditions: {
                options: {
                  caseSensitive: true,
                  typeValidation: "strict",
                  version: 2,
                },
                conditions: [
                  {
                    leftValue: "={{$json.ok}}",
                    rightValue: true,
                    operator: {
                      type: "boolean",
                      operation: "equal",
                    },
                  },
                ],
                combinator: "and",
              },
            },
          });
          connect(previousNodeName, ifNodeName);
          previousNodeName = ifNodeName;
        }

        const respondNodeName = "Respond to Webhook";
        nodes.push({
          id: `wf-node-respond-${now}`,
          name: respondNodeName,
          type: "n8n-nodes-base.respondToWebhook",
          typeVersion: 1,
          position: [1000, 280],
          parameters: {
            respondWith: "json",
            responseBody,
          },
        });

        if (previousNodeName === "If") {
          connections[previousNodeName] = {
            main: [
              [{ node: respondNodeName, type: "main", index: 0 }],
              [],
            ],
          };
        } else {
          connect(previousNodeName, respondNodeName);
        }

        return {
          name: workflowName,
          nodes,
          connections,
        };
      };

      const result = await callWorkspaceModel(workspaceId, systemPrompt, messages, {
        maxTokens: 2048,
        jsonMode: true,
      });

      if (!result.ok) {
        const fallbackWorkflow = buildDeterministicWorkflowFromPrompt(latestUserPrompt);
        if (fallbackWorkflow) {
          respond(
            true,
            {
              ok: true,
              message:
                "Primary workflow model is unavailable. Generated a deterministic workflow scaffold from your request.",
              workflow: {
                ...fallbackWorkflow,
                nodes: autoLinkNodeCredentials(fallbackWorkflow.nodes, availableCredentials),
              },
              providerError: true,
            },
            undefined,
          );
          return;
        }

        respond(
          true,
          { ok: true, message: result.error ?? "AI model unavailable", workflow: null, providerError: true },
          undefined,
        );
        return;
      }

      let parsed: { message?: string; workflow?: unknown } = {};
      try {
        parsed = JSON.parse(result.text ?? "{}") as typeof parsed;
      } catch {
        parsed = { message: result.text ?? "" };
      }

      const assistantMessage = typeof parsed.message === "string" ? parsed.message : result.text ?? "";
      let workflow = parsed.workflow && typeof parsed.workflow === "object" ? parsed.workflow : null;
      if (workflow && Array.isArray((workflow as { nodes?: unknown[] }).nodes)) {
        const wf = workflow as { nodes: Array<Record<string, unknown>> };
        workflow = {
          ...(workflow as Record<string, unknown>),
          nodes: autoLinkNodeCredentials(wf.nodes, availableCredentials),
        };
      }

      respond(true, { ok: true, message: assistantMessage, workflow, providerUsed: result.providerUsed }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  // ── Connections: Real n8n credential list ─────────────────────────

  "pmos.projects.snapshot": async ({ respond, client }) => {
    try {
      if (!client) throw new Error("client context required");
      const workspaceId = requireWorkspaceId(client);
      const cfg = loadConfig() as unknown;
      const allowGlobalSecrets = isSuperAdmin(client);

      const { readWorkspaceConnectors } = await import("../workspace-connectors.js");
      const workspaceConnectors = await readWorkspaceConnectors(workspaceId);

      const bcgptUrl = normalizeBaseUrl(
        (workspaceConnectors?.bcgpt?.url as string | undefined) ??
          readConfigString(cfg, ["pmos", "connectors", "bcgpt", "url"]) ??
          process.env.BCGPT_URL ??
          null,
        "https://bcgpt.wickedlab.io",
      );
      const bcgptApiKey =
        (workspaceConnectors?.bcgpt?.apiKey as string | undefined)?.trim() ??
        (allowGlobalSecrets
          ? readConfigString(cfg, ["pmos", "connectors", "bcgpt", "apiKey"]) ??
            (process.env.BCGPT_API_KEY?.trim() || null)
          : null);

      const emptySnapshot = {
        workspaceId,
        configured: false,
        connected: false,
        connectorUrl: bcgptUrl,
        identity: null,
        totals: {
          projectCount: 0,
          syncedProjects: 0,
          openTodos: 0,
          overdueTodos: 0,
          dueTodayTodos: 0,
        },
        projects: [] as PmosProjectCard[],
        urgentTodos: [] as PmosProjectTodoItem[],
        dueTodayTodos: [] as PmosProjectTodoItem[],
        errors: [] as string[],
        refreshedAtMs: Date.now(),
      };

      if (!bcgptApiKey) {
        respond(
          true,
          {
            ...emptySnapshot,
            errors: ["BCGPT key is not configured for this workspace."],
          },
          undefined,
        );
        return;
      }

      const errors: string[] = [];
      const start = await fetchJson(`${bcgptUrl}/action/startbcgpt`, {
        method: "POST",
        timeoutMs: 12_000,
        headers: {
          "content-type": "application/json",
          "x-bcgpt-api-key": bcgptApiKey,
        },
        body: JSON.stringify({}),
      });

      const startPayload = isJsonObject(start.json) ? start.json : {};
      if (!start.ok && start.error) {
        errors.push(`Basecamp identity check failed: ${start.error}`);
      }
      const startUser = isJsonObject(startPayload.user) ? startPayload.user : null;
      const identity = {
        connected: startPayload.connected === true,
        name: stringOrNull(startUser?.name),
        email: stringOrNull(startUser?.email),
        selectedAccountId:
          numberStringOrNull(startPayload.selected_account_id),
        accountsCount: Array.isArray(startPayload.accounts) ? startPayload.accounts.length : 0,
        message: stringOrNull(startPayload.message),
      };

      const listProjectsResult = await callBcgptTool({
        bcgptUrl,
        apiKey: bcgptApiKey,
        toolName: "list_projects",
        toolArgs: {},
      });
      if (!listProjectsResult.ok) {
        errors.push(`Failed to list projects: ${listProjectsResult.error ?? "unknown error"}`);
      }

      const projects = parseProjectList(listProjectsResult.result);
      const projectNameById = new Map<string, string>();
      for (const project of projects) {
        projectNameById.set(project.id, project.name);
      }

      const focusProjects = projects.slice(0, 12);
      const detailsByProjectId = new Map<string, unknown>();
      await Promise.all(
        focusProjects.map(async (project) => {
          const detail = await callBcgptTool({
            bcgptUrl,
            apiKey: bcgptApiKey,
            toolName: "list_todos_for_project",
            toolArgs: { project: project.id, compact: true, preview_limit: 20 },
            timeoutMs: 12_000,
          });
          if (!detail.ok) {
            errors.push(`Failed to load todos for ${project.name}: ${detail.error ?? "unknown error"}`);
            return;
          }
          detailsByProjectId.set(project.id, detail.result);
        }),
      );

      const todayIso = new Date().toISOString().slice(0, 10);
      const [overdueRpc, dueTodayRpc] = await Promise.all([
        callBcgptTool({
          bcgptUrl,
          apiKey: bcgptApiKey,
          toolName: "report_todos_overdue",
          toolArgs: {},
          timeoutMs: 15_000,
        }),
        callBcgptTool({
          bcgptUrl,
          apiKey: bcgptApiKey,
          toolName: "list_todos_due",
          toolArgs: { date: todayIso, include_overdue: false },
          timeoutMs: 15_000,
        }),
      ]);

      if (!overdueRpc.ok) {
        errors.push(`Failed to load overdue todos: ${overdueRpc.error ?? "unknown error"}`);
      }
      if (!dueTodayRpc.ok) {
        errors.push(`Failed to load due-today todos: ${dueTodayRpc.error ?? "unknown error"}`);
      }

      const overdueTodos = parseTodoItems(overdueRpc.result, "overdue", projectNameById);
      const dueTodayTodos = parseTodoItems(dueTodayRpc.result, "todos", projectNameById).filter(
        (todo) => !todo.dueOn || todo.dueOn === todayIso,
      );

      const overdueByProject = new Map<string, number>();
      for (const todo of overdueTodos) {
        if (!todo.projectId) continue;
        overdueByProject.set(todo.projectId, (overdueByProject.get(todo.projectId) ?? 0) + 1);
      }
      const dueTodayByProject = new Map<string, number>();
      for (const todo of dueTodayTodos) {
        if (!todo.projectId) continue;
        dueTodayByProject.set(todo.projectId, (dueTodayByProject.get(todo.projectId) ?? 0) + 1);
      }

      const cards: PmosProjectCard[] = focusProjects.map((project) => {
        const detail = detailsByProjectId.get(project.id);
        const groups = isJsonObject(detail) && Array.isArray(detail.groups) ? detail.groups : [];
        let openTodos = 0;
        let todoLists = 0;
        const dueDates: string[] = [];
        for (const groupRaw of groups) {
          if (!isJsonObject(groupRaw)) continue;
          todoLists += 1;
          const todosCount = typeof groupRaw.todos_count === "number" && Number.isFinite(groupRaw.todos_count)
            ? groupRaw.todos_count
            : 0;
          openTodos += todosCount;
          const preview = Array.isArray(groupRaw.todos_preview) ? groupRaw.todos_preview : [];
          for (const todoRaw of preview) {
            if (!isJsonObject(todoRaw)) continue;
            const due = stringOrNull(todoRaw.due_on);
            if (due) dueDates.push(due);
          }
        }
        const nextDueOn = dueDates
          .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
          .sort((a, b) => a.localeCompare(b))[0] ?? null;
        const overdueCount = overdueByProject.get(project.id) ?? 0;
        const dueTodayCount = dueTodayByProject.get(project.id) ?? 0;
        return {
          id: project.id,
          name: project.name,
          status: project.status,
          appUrl: project.appUrl,
          todoLists,
          openTodos,
          overdueTodos: overdueCount,
          dueTodayTodos: dueTodayCount,
          nextDueOn,
          health: projectHealthFromCounts({
            openTodos,
            overdueTodos: overdueCount,
            dueTodayTodos: dueTodayCount,
          }),
        };
      });

      cards.sort((a, b) => {
        if (b.overdueTodos !== a.overdueTodos) return b.overdueTodos - a.overdueTodos;
        if (b.dueTodayTodos !== a.dueTodayTodos) return b.dueTodayTodos - a.dueTodayTodos;
        if (b.openTodos !== a.openTodos) return b.openTodos - a.openTodos;
        return a.name.localeCompare(b.name);
      });

      const totals = {
        projectCount: projects.length,
        syncedProjects: cards.length,
        openTodos: cards.reduce((sum, card) => sum + card.openTodos, 0),
        overdueTodos: overdueTodos.length,
        dueTodayTodos: dueTodayTodos.length,
      };

      respond(
        true,
        {
          workspaceId,
          configured: true,
          connected: identity.connected,
          connectorUrl: bcgptUrl,
          identity,
          totals,
          projects: cards,
          urgentTodos: overdueTodos.slice(0, 20),
          dueTodayTodos: dueTodayTodos.slice(0, 20),
          errors: errors.slice(0, 20),
          refreshedAtMs: Date.now(),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

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
