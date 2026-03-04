import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { readWorkspaceConnectors } from "../../src/gateway/workspace-connectors.js";

const DEFAULT_BASE_URL = "https://flow.wickedlab.io";

type OpsConfig = {
  baseUrl?: string;
  apiKey?: string;
  projectId?: string;
};

type ResolvedOpsConfig = {
  baseUrl: string;
  apiKey: string | null;
  projectId?: string;
  userEmail?: string;
  userPassword?: string;
  workspaceKey: string;
};

type CachedUserToken = {
  token: string;
  expiresAt: number;
};

const userTokenCache = new Map<string, CachedUserToken>();

type MaybeObject = Record<string, unknown> | null;

type OpsRequestParams = {
  api: OpenClawPluginApi;
  endpoint: string;
  workspaceId?: string | null;
  method?: string;
  body?: unknown;
};

function normalizeUrl(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return DEFAULT_BASE_URL;
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readOptionalString(params: unknown, key: string): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  return readString((params as Record<string, unknown>)[key]);
}

function readOptionalNumber(params: unknown, key: string): number | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  const value = (params as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resolveToolParams(toolCallIdOrParams: unknown, maybeParams?: unknown): unknown {
  return maybeParams === undefined ? toolCallIdOrParams : maybeParams;
}

function toObject(value: unknown): MaybeObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function jsonToolResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

async function resolveOpsConfig(
  api: OpenClawPluginApi,
  workspaceId?: string | null,
): Promise<ResolvedOpsConfig> {
  const pluginCfg = (api.pluginConfig ?? {}) as OpsConfig;
  const rootCfg = api.config as unknown;

  let workspaceOps: Record<string, unknown> | null = null;
  let workspaceActivepieces: Record<string, unknown> | null = null;
  if (workspaceId) {
    const wc = await readWorkspaceConnectors(String(workspaceId)).catch(() => null);
    const ops = wc?.ops;
    const activepieces = wc?.activepieces;
    if (ops && typeof ops === "object" && !Array.isArray(ops)) {
      workspaceOps = ops as Record<string, unknown>;
    }
    if (activepieces && typeof activepieces === "object" && !Array.isArray(activepieces)) {
      workspaceActivepieces = activepieces as Record<string, unknown>;
    }
  }

  const pmosConnectors = (() => {
    if (!rootCfg || typeof rootCfg !== "object" || Array.isArray(rootCfg)) {
      return null;
    }
    const pmos = (rootCfg as Record<string, unknown>).pmos;
    if (!pmos || typeof pmos !== "object" || Array.isArray(pmos)) {
      return null;
    }
    const connectors = (pmos as Record<string, unknown>).connectors;
    if (!connectors || typeof connectors !== "object" || Array.isArray(connectors)) {
      return null;
    }
    return connectors as Record<string, unknown>;
  })();
  const pmosOps = toObject(pmosConnectors?.ops);
  const pmosActivepieces = toObject(pmosConnectors?.activepieces);

  const baseUrl = normalizeUrl(
    readString(workspaceActivepieces?.url) ??
      readString(workspaceOps?.url) ??
      readString(pmosActivepieces?.url) ??
      process.env.ACTIVEPIECES_URL ??
      process.env.FLOW_URL ??
      readString(pmosOps?.url) ??
      readString(pluginCfg.baseUrl) ??
      process.env.OPS_URL ??
      DEFAULT_BASE_URL,
  );

  const apiKey =
    readString(workspaceActivepieces?.apiKey) ??
    readString(workspaceOps?.apiKey) ??
    readString(pmosActivepieces?.apiKey) ??
    readString(process.env.ACTIVEPIECES_API_KEY) ??
    readString(pmosOps?.apiKey) ??
    readString(pluginCfg.apiKey) ??
    readString(process.env.OPS_API_KEY) ??
    null;

  const projectId =
    readString(workspaceActivepieces?.projectId) ??
    readString(workspaceOps?.projectId) ??
    readString(pmosActivepieces?.projectId) ??
    readString(process.env.ACTIVEPIECES_PROJECT_ID) ??
    readString(pmosOps?.projectId) ??
    readString(pluginCfg.projectId) ??
    readString(process.env.OPS_PROJECT_ID);

  const workspaceUser = toObject(workspaceOps?.user);
  const workspaceActivepiecesUser = toObject(workspaceActivepieces?.user);
  const userEmail =
    readString(workspaceActivepiecesUser?.email) ??
    readString(workspaceUser?.email) ??
    undefined;
  const userPassword =
    readString(workspaceActivepiecesUser?.password) ??
    readString(workspaceUser?.password) ??
    undefined;

  if (!apiKey && !(userEmail && userPassword)) {
    throw new Error(
      "Workflow engine authentication is not configured. Set workspace user credentials or an Activepieces API key.",
    );
  }

  return {
    baseUrl,
    apiKey,
    projectId: projectId || undefined,
    userEmail,
    userPassword,
    workspaceKey: workspaceId ? String(workspaceId) : "global",
  };
}

async function signInWithWorkspaceUser(cfg: ResolvedOpsConfig): Promise<string | null> {
  if (!cfg.userEmail || !cfg.userPassword) {
    return null;
  }

  const cacheKey = `${cfg.workspaceKey}:${cfg.baseUrl}:${cfg.userEmail}`;
  const cached = userTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const endpoints = [
    "/api/v1/authentication/sign-in",
    "/api/v1/users/sign-in",
    "/api/v1/users/login",
  ];
  const payloads = [
    { email: cfg.userEmail, password: cfg.userPassword },
    { emailOrLdapLoginId: cfg.userEmail, password: cfg.userPassword },
  ];

  for (const endpoint of endpoints) {
    for (const payload of payloads) {
      const res = await fetch(`${cfg.baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      }).catch(() => null);
      if (!res || !res.ok) {
        continue;
      }
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const token = readString(body?.token);
      if (!token) {
        continue;
      }
      userTokenCache.set(cacheKey, {
        token,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      return token;
    }
  }
  return null;
}

async function resolveAuthHeader(cfg: ResolvedOpsConfig): Promise<string> {
  const userToken = await signInWithWorkspaceUser(cfg);
  if (userToken) {
    return `Bearer ${userToken}`;
  }
  if (cfg.apiKey) {
    return `Bearer ${cfg.apiKey}`;
  }
  throw new Error("Workflow engine authentication failed: no usable user token or API key.");
}

async function opsRequest(params: OpsRequestParams): Promise<unknown> {
  const cfg = await resolveOpsConfig(params.api, params.workspaceId ?? null);
  const endpoint = params.endpoint.replace(/^\/+/, "");
  const url = `${cfg.baseUrl}/api/v1/${endpoint}`;
  const method = (params.method ?? "GET").toUpperCase();
  const hasBody = params.body !== undefined;
  const authHeader = await resolveAuthHeader(cfg);

  const headers: Record<string, string> = {
    authorization: authHeader,
    accept: "application/json",
  };
  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(params.body) : undefined,
  });

  const text = await res.text().catch(() => "");
  const parsed = (() => {
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  })();

  if (!res.ok) {
    const detail = typeof parsed === "string" ? parsed : text;
    throw new Error(`Workflow engine API ${res.status} ${res.statusText}: ${detail}`.trim());
  }

  return parsed ?? { ok: true };
}

async function resolveProjectIdOrThrow(api: OpenClawPluginApi, workspaceId?: string | null): Promise<string> {
  const cfg = await resolveOpsConfig(api, workspaceId ?? null);
  if (cfg.projectId) {
    return cfg.projectId;
  }

  const projectsPayload = await opsRequest({ api, workspaceId, endpoint: "projects" });
  const projectsObj = toObject(projectsPayload);
  const projectsData = Array.isArray(projectsObj?.data)
    ? projectsObj?.data
    : Array.isArray(projectsPayload)
      ? projectsPayload
      : [];

  const firstProject = projectsData.find(
    (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
  ) as Record<string, unknown> | undefined;
  const projectId = readString(firstProject?.id);
  if (!projectId) {
    throw new Error(
      "No projectId configured for workflow engine. Set PMOS ops.projectId in Integrations.",
    );
  }
  return projectId;
}

function toWorkflowSummary(entry: Record<string, unknown>): Record<string, unknown> {
  const id = readString(entry.id) ?? "";
  const displayName = readString(entry.displayName) ?? readString(entry.name) ?? id;
  const status = readString(entry.status) ?? "DISABLED";
  return {
    id,
    name: displayName,
    displayName,
    active: status.toUpperCase() === "ENABLED",
    status,
    createdAt: readString(entry.created) ?? readString(entry.createdAt),
    updatedAt: readString(entry.updated) ?? readString(entry.updatedAt),
    projectId: readString(entry.projectId),
  };
}

function getCompatNodes(flow: Record<string, unknown>): unknown[] {
  const metadata = toObject(flow.metadata);
  const compat = toObject(metadata?.n8nCompat);
  return Array.isArray(compat?.nodes) ? compat.nodes : [];
}

function getCompatConnections(flow: Record<string, unknown>): Record<string, unknown> {
  const metadata = toObject(flow.metadata);
  const compat = toObject(metadata?.n8nCompat);
  const value = toObject(compat?.connections);
  return value ?? {};
}

function toWorkflowDetails(entry: Record<string, unknown>): Record<string, unknown> {
  const base = toWorkflowSummary(entry);
  return {
    ...base,
    nodes: getCompatNodes(entry),
    connections: getCompatConnections(entry),
    settings: toObject(toObject(toObject(entry.metadata)?.n8nCompat)?.settings) ?? {},
    raw: entry,
  };
}

function toExecutionSummary(entry: Record<string, unknown>): Record<string, unknown> {
  const id = readString(entry.id) ?? "";
  const statusRaw = readString(entry.status) ?? "RUNNING";
  const lowered = statusRaw.toLowerCase();
  const status = lowered.includes("success")
    ? "success"
    : lowered.includes("fail") || lowered.includes("error")
      ? "failed"
      : lowered.includes("cancel")
        ? "canceled"
        : lowered.includes("wait")
          ? "waiting"
          : "running";
  const workflowId = readString(entry.flowId) ?? readString(toObject(entry.flowVersion)?.flowId);
  return {
    id,
    workflowId,
    flowId: workflowId,
    status,
    mode: readString(entry.environment) ?? "manual",
    finished: status !== "running" && status !== "waiting",
    startedAt: readString(entry.created) ?? readString(entry.createdAt),
    stoppedAt: readString(entry.finishTime) ?? readString(entry.updatedAt),
    raw: entry,
  };
}

async function setWorkflowStatus(params: {
  api: OpenClawPluginApi;
  workspaceId?: string | null;
  workflowId: string;
  enabled: boolean;
}): Promise<unknown> {
  return opsRequest({
    api: params.api,
    workspaceId: params.workspaceId,
    endpoint: `flows/${encodeURIComponent(params.workflowId)}`,
    method: "POST",
    body: {
      type: "CHANGE_STATUS",
      request: { status: params.enabled ? "ENABLED" : "DISABLED" },
    },
  });
}

async function updateCompatMetadata(params: {
  api: OpenClawPluginApi;
  workspaceId?: string | null;
  workflowId: string;
  metadataPatch: Record<string, unknown>;
}): Promise<unknown> {
  const current = await opsRequest({
    api: params.api,
    workspaceId: params.workspaceId,
    endpoint: `flows/${encodeURIComponent(params.workflowId)}`,
    method: "GET",
  });
  const currentObj = toObject(current) ?? {};
  const currentMetadata = toObject(currentObj.metadata) ?? {};
  const merged = {
    ...currentMetadata,
    ...params.metadataPatch,
  };

  return opsRequest({
    api: params.api,
    workspaceId: params.workspaceId,
    endpoint: `flows/${encodeURIComponent(params.workflowId)}`,
    method: "POST",
    body: {
      type: "UPDATE_METADATA",
      request: { metadata: merged },
    },
  });
}

export default {
  id: "wicked-ops",
  name: "Wicked Ops (Activepieces)",
  register(api: OpenClawPluginApi) {
    api.logger.info("[wicked-ops] registering Activepieces-backed tools");

    const registerTool = (tool: unknown, opts?: Parameters<OpenClawPluginApi['registerTool']>[1]) => {
      api.registerTool(tool as Parameters<OpenClawPluginApi["registerTool"]>[0], opts);
    };

    registerTool({
      name: "ops_workflows_list",
      description: "List workflows in the workspace workflow engine.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          active: { type: "boolean" },
          tags: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
          name: { type: "string" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId = readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        const limit = readOptionalNumber(params, "limit");
        const cursor = readOptionalString(params, "cursor");
        const name = readOptionalString(params, "name");
        const active =
          params && typeof params === "object" && !Array.isArray(params)
            ? ((params as Record<string, unknown>).active as boolean | undefined)
            : undefined;

        const query = new URLSearchParams();
        query.set("projectId", projectId);
        if (cursor) query.set("cursor", cursor);
        if (name) query.set("name", name);
        if (limit && limit > 0) query.set("limit", String(Math.trunc(limit)));

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flows?${query.toString()}`,
        });

        const obj = toObject(payload);
        const rows = Array.isArray(obj?.data) ? obj.data : [];
        const mapped = rows
          .filter((row) => row && typeof row === "object" && !Array.isArray(row))
          .map((row) => toWorkflowSummary(row as Record<string, unknown>))
          .filter((row) => (typeof active === "boolean" ? Boolean(row.active) === active : true));

        return jsonToolResult({
          data: mapped,
          next: readString(obj?.next),
          previous: readString(obj?.previous),
        });
      },
    });

    registerTool({
      name: "ops_workflow_get",
      description: "Get details of a workflow by ID.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) throw new Error("workflowId is required");

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flows/${encodeURIComponent(workflowId)}`,
        });

        return jsonToolResult(toWorkflowDetails(toObject(payload) ?? {}));
      },
    });

    registerTool({
      name: "ops_workflow_create",
      description: "Create a new workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string" },
          nodes: { type: "array" },
          connections: { type: "object" },
          settings: { type: "object" },
          tags: { type: "array" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const name = readOptionalString(params, "name");
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId = readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        if (!name) throw new Error("name is required");

        const created = await opsRequest({
          api,
          workspaceId,
          endpoint: "flows",
          method: "POST",
          body: {
            displayName: name,
            projectId,
          },
        });
        const flow = toObject(created);
        const flowId = readString(flow?.id);

        if (flowId && params && typeof params === "object" && !Array.isArray(params)) {
          const rawParams = params as Record<string, unknown>;
          if (Array.isArray(rawParams.nodes) || toObject(rawParams.connections) || toObject(rawParams.settings)) {
            await updateCompatMetadata({
              api,
              workspaceId,
              workflowId: flowId,
              metadataPatch: {
                n8nCompat: {
                  nodes: Array.isArray(rawParams.nodes) ? rawParams.nodes : [],
                  connections: toObject(rawParams.connections) ?? {},
                  settings: toObject(rawParams.settings) ?? {},
                  tags: Array.isArray(rawParams.tags) ? rawParams.tags : [],
                },
              },
            });
          }
        }

        return jsonToolResult(toWorkflowDetails(flow ?? {}));
      },
    });

    registerTool({
      name: "ops_workflow_generate",
      description: "Create a starter workflow from a short description.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const name = readOptionalString(params, "name");
        const description = readOptionalString(params, "description");
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId = readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        if (!name || !description) throw new Error("name and description are required");

        const created = await opsRequest({
          api,
          workspaceId,
          endpoint: "flows",
          method: "POST",
          body: { displayName: name, projectId },
        });
        const flow = toObject(created);
        const flowId = readString(flow?.id);
        if (flowId) {
          await updateCompatMetadata({
            api,
            workspaceId,
            workflowId: flowId,
            metadataPatch: { description },
          });
        }
        return jsonToolResult(toWorkflowDetails(flow ?? {}));
      },
    });

    registerTool({
      name: "ops_workflow_update",
      description: "Update workflow properties.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string" },
          name: { type: "string" },
          nodes: { type: "array" },
          connections: { type: "object" },
          settings: { type: "object" },
          tags: { type: "array" },
          active: { type: "boolean" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) throw new Error("workflowId is required");

        if (params && typeof params === "object" && !Array.isArray(params)) {
          const obj = params as Record<string, unknown>;
          const name = readString(obj.name);
          if (name) {
            await opsRequest({
              api,
              workspaceId,
              endpoint: `flows/${encodeURIComponent(workflowId)}`,
              method: "POST",
              body: { type: "CHANGE_NAME", request: { displayName: name } },
            });
          }
          if (typeof obj.active === "boolean") {
            await setWorkflowStatus({
              api,
              workspaceId,
              workflowId,
              enabled: obj.active,
            });
          }
          if (Array.isArray(obj.nodes) || toObject(obj.connections) || toObject(obj.settings) || Array.isArray(obj.tags)) {
            await updateCompatMetadata({
              api,
              workspaceId,
              workflowId,
              metadataPatch: {
                n8nCompat: {
                  nodes: Array.isArray(obj.nodes) ? obj.nodes : [],
                  connections: toObject(obj.connections) ?? {},
                  settings: toObject(obj.settings) ?? {},
                  tags: Array.isArray(obj.tags) ? obj.tags : [],
                },
              },
            });
          }
        }

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flows/${encodeURIComponent(workflowId)}`,
        });
        return jsonToolResult(toWorkflowDetails(toObject(payload) ?? {}));
      },
    });

    registerTool({
      name: "ops_workflow_delete",
      description: "Delete a workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) throw new Error("workflowId is required");

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flows/${encodeURIComponent(workflowId)}`,
          method: "DELETE",
        });
        return jsonToolResult(payload);
      },
    });

    registerTool({
      name: "ops_workflow_activate",
      description: "Activate a workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) throw new Error("workflowId is required");
        const payload = await setWorkflowStatus({ api, workspaceId, workflowId, enabled: true });
        return jsonToolResult(payload);
      },
    });

    registerTool({
      name: "ops_workflow_deactivate",
      description: "Deactivate a workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) throw new Error("workflowId is required");
        const payload = await setWorkflowStatus({ api, workspaceId, workflowId, enabled: false });
        return jsonToolResult(payload);
      },
    });

    registerTool({
      name: "ops_executions_list",
      description: "List workflow runs.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          workflowId: { type: "string" },
          status: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId = readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        const workflowId = readOptionalString(params, "workflowId");
        const status = readOptionalString(params, "status");
        const limit = readOptionalNumber(params, "limit");
        const cursor = readOptionalString(params, "cursor");

        const query = new URLSearchParams();
        query.set("projectId", projectId);
        if (workflowId) query.set("flowId", workflowId);
        if (status) query.set("status", status);
        if (cursor) query.set("cursor", cursor);
        if (limit && limit > 0) query.set("limit", String(Math.trunc(limit)));

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flow-runs?${query.toString()}`,
        });
        const obj = toObject(payload);
        const rows = Array.isArray(obj?.data) ? obj.data : [];
        const mapped = rows
          .filter((row) => row && typeof row === "object" && !Array.isArray(row))
          .map((row) => toExecutionSummary(row as Record<string, unknown>));

        return jsonToolResult({
          data: mapped,
          next: readString(obj?.next),
          previous: readString(obj?.previous),
        });
      },
    });

    registerTool({
      name: "ops_execution_get",
      description: "Get details of a workflow run.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["executionId"],
        properties: {
          executionId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const executionId = readOptionalString(params, "executionId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!executionId) throw new Error("executionId is required");

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `flow-runs/${encodeURIComponent(executionId)}`,
        });
        return jsonToolResult(toExecutionSummary(toObject(payload) ?? {}));
      },
    });

    registerTool({
      name: "ops_workflow_execute",
      description: "Trigger a webhook workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string" },
          data: { type: "object" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) throw new Error("workflowId is required");

        const input =
          params && typeof params === "object" && !Array.isArray(params)
            ? (toObject((params as Record<string, unknown>).data) ?? {})
            : {};

        const draft = Boolean(input.__draft);
        const sync = Boolean(input.__sync);
        delete input.__draft;
        delete input.__sync;

        const suffix = draft && sync ? "draft/sync" : draft ? "draft" : sync ? "sync" : "";
        const endpoint = suffix
          ? `webhooks/${encodeURIComponent(workflowId)}/${suffix}`
          : `webhooks/${encodeURIComponent(workflowId)}`;

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint,
          method: "POST",
          body: input,
        });

        return jsonToolResult(payload);
      },
    });

    registerTool({
      name: "ops_pieces_list",
      description: "List workflow-engine pieces (integrations).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
          cursor: { type: "string" },
          search: { type: "string" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId =
          readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        const limit = readOptionalNumber(params, "limit");
        const cursor = readOptionalString(params, "cursor");
        const search = readOptionalString(params, "search")?.toLowerCase();

        const query = new URLSearchParams();
        query.set("projectId", projectId);
        if (cursor) query.set("cursor", cursor);
        if (limit && limit > 0) query.set("limit", String(Math.trunc(limit)));

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `pieces?${query.toString()}`,
        });

        const obj = toObject(payload);
        const rows = Array.isArray(obj?.data)
          ? obj.data
          : Array.isArray(payload)
            ? payload
            : [];
        const mapped = rows
          .filter((row) => row && typeof row === "object" && !Array.isArray(row))
          .map((row) => {
            const entry = row as Record<string, unknown>;
            const name = readString(entry.name) ?? "";
            const displayName = readString(entry.displayName) ?? name;
            const description = readString(entry.description) ?? readString(entry.summary);
            return {
              name,
              displayName,
              description,
              version: readString(entry.version),
              logoUrl: readString(entry.logoUrl),
              releaseStage: readString(entry.releaseStage),
              minimumSupportedRelease: readString(entry.minimumSupportedRelease),
              raw: entry,
            };
          })
          .filter((entry) => {
            if (!search) return true;
            const haystack = `${entry.name} ${entry.displayName ?? ""} ${entry.description ?? ""}`.toLowerCase();
            return haystack.includes(search);
          });

        return jsonToolResult({
          data: mapped,
          next: readString(obj?.next),
          previous: readString(obj?.previous),
        });
      },
    });

    registerTool({
      name: "ops_piece_get",
      description: "Get workflow-engine piece details by piece name.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["pieceName"],
        properties: {
          pieceName: { type: "string" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const pieceName = readOptionalString(params, "pieceName");
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId =
          readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        if (!pieceName) throw new Error("pieceName is required");

        const query = new URLSearchParams();
        query.set("projectId", projectId);
        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `pieces/${encodeURIComponent(pieceName)}?${query.toString()}`,
        });
        return jsonToolResult(payload);
      },
    });

    registerTool({
      name: "ops_credentials_list",
      description: "List workflow-engine credentials (app connections).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string" },
          pieceName: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
          projectId: { type: "string" },
          workspaceId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId = readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        const typeFilter = readOptionalString(params, "type");
        const pieceName = readOptionalString(params, "pieceName");
        const limit = readOptionalNumber(params, "limit");
        const cursor = readOptionalString(params, "cursor");

        const query = new URLSearchParams();
        query.set("projectId", projectId);
        if (pieceName) query.set("pieceName", pieceName);
        if (cursor) query.set("cursor", cursor);
        if (limit && limit > 0) query.set("limit", String(Math.trunc(limit)));

        const payload = await opsRequest({
          api,
          workspaceId,
          endpoint: `app-connections?${query.toString()}`,
        });

        const obj = toObject(payload);
        const rows = Array.isArray(obj?.data) ? obj.data : [];
        const mapped = rows
          .filter((row) => row && typeof row === "object" && !Array.isArray(row))
          .map((row) => {
            const entry = row as Record<string, unknown>;
            return {
              id: readString(entry.id) ?? "",
              name: readString(entry.displayName) ?? readString(entry.externalId) ?? "",
              displayName: readString(entry.displayName),
              type: readString(entry.pieceName) ?? readString(entry.type) ?? "",
              pieceName: readString(entry.pieceName),
              status: readString(entry.status),
              createdAt: readString(entry.created),
            };
          })
          .filter((entry) => {
            if (!typeFilter) return true;
            const check = typeFilter.toLowerCase();
            return (
              entry.type.toLowerCase().includes(check) ||
              String(entry.pieceName ?? "").toLowerCase().includes(check)
            );
          });

        return jsonToolResult({
          data: mapped,
          next: readString(obj?.next),
          previous: readString(obj?.previous),
        });
      },
    });

    registerTool({
      name: "ops_test_connection",
      description: "Test workflow engine API connectivity.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          workspaceId: { type: "string" },
          projectId: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readOptionalString(params, "workspaceId");
        const projectId = readOptionalString(params, "projectId") ?? (await resolveProjectIdOrThrow(api, workspaceId));
        const query = new URLSearchParams();
        query.set("projectId", projectId);
        query.set("limit", "1");

        const data = await opsRequest({
          api,
          workspaceId,
          endpoint: `flows?${query.toString()}`,
        });

        return jsonToolResult({
          success: true,
          message: "Connected to workflow engine",
          data,
        });
      },
    });

    api.logger.info("[wicked-ops] Activepieces compatibility tools registered");
  },
};
