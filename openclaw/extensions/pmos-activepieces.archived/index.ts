import type { OpenClawPluginApi } from "../../src/plugins/types.js";

type ActivepiecesConfig = {
  baseUrl?: string;
  apiKey?: string;
};

type PmosActivepiecesConnectorConfig = {
  url?: string;
  apiKey?: string;
  projectId?: string;
};

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function readPmosActivepiecesConnector(api: OpenClawPluginApi): PmosActivepiecesConnectorConfig | null {
  // The PMOS UI stores connector config under `pmos.connectors.activepieces.*` via config.set.
  // We treat this as the primary source of truth so UI + tools stay aligned.
  const cfg = api.config as unknown;
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pmos = (cfg as any).pmos;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activepieces = pmos && typeof pmos === "object" ? (pmos as any).connectors?.activepieces : null;
  if (!activepieces || typeof activepieces !== "object" || Array.isArray(activepieces)) {
    return null;
  }
  return activepieces as PmosActivepiecesConnectorConfig;
}

function resolveActivepiecesConfig(api: OpenClawPluginApi): Required<ActivepiecesConfig> & {
  projectId?: string;
} {
  const pmos = readPmosActivepiecesConnector(api);
  const cfg = (api.pluginConfig ?? {}) as ActivepiecesConfig;
  const baseUrl = normalizeUrl(
    pmos?.url ??
      cfg.baseUrl ??
      process.env.ACTIVEPIECES_URL ??
      process.env.FLOW_URL ??
      "https://flow.wickedlab.io",
  );
  const apiKey = (pmos?.apiKey ?? cfg.apiKey ?? process.env.ACTIVEPIECES_API_KEY ?? "").trim();
  const projectId = (pmos?.projectId ?? process.env.ACTIVEPIECES_PROJECT_ID ?? "").trim() || undefined;
  return { baseUrl, apiKey, projectId };
}

async function apRequest(params: {
  api: OpenClawPluginApi;
  endpoint: string;
  method?: string;
  body?: unknown;
}) {
  const { baseUrl, apiKey } = resolveActivepiecesConfig(params.api);
  if (!apiKey) {
    throw new Error(
      "Activepieces API key is not configured. Set it in PMOS -> Integrations, or set env ACTIVEPIECES_API_KEY.",
    );
  }
  if (!baseUrl) {
    throw new Error(
      "Activepieces URL is not configured. Set it in PMOS -> Integrations, or set env ACTIVEPIECES_URL.",
    );
  }

  const endpoint = params.endpoint.replace(/^\/+/, "");
  const url = `${baseUrl}/api/v1/${endpoint}`;
  const method = (params.method ?? "GET").toUpperCase();
  const hasBody = params.body !== undefined;
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
  };
  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(params.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Activepieces API ${res.status} ${res.statusText}: ${text}`.trim());
  }

  // Some endpoints may return 204; tolerate empty bodies.
  const text = await res.text().catch(() => "");
  if (!text) {
    return { ok: true };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function jsonToolResult(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function resolveProjectIdOrThrow(api: OpenClawPluginApi, params: unknown): string {
  const fromParams = readOptionalString(params, "projectId");
  if (fromParams) {
    return fromParams;
  }
  const { projectId } = resolveActivepiecesConfig(api);
  if (projectId) {
    return projectId;
  }
  throw new Error(
    "Activepieces projectId is required for this operation. Set it in PMOS -> Integrations (Activepieces -> Project ID).",
  );
}

function readOptionalString(params: unknown, key: string): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  const value = (params as Record<string, unknown>)[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
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
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resolveToolParams(toolCallIdOrParams: unknown, maybeParams?: unknown): unknown {
  // OpenClaw runtime invokes tools as execute(toolCallId, args).
  // Keep compatibility with any older single-arg call sites.
  return maybeParams === undefined ? toolCallIdOrParams : maybeParams;
}

export default {
  id: "pmos-activepieces",
  name: "PMOS Activepieces",
  register(api: OpenClawPluginApi) {
    api.logger.info("[pmos-activepieces] registering tools");

    api.registerTool({
      name: "flow_projects_list",
      description:
        "List Activepieces projects. Note: this often requires a USER principal; service keys may be forbidden.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      async execute() {
        const data = await apRequest({ api, endpoint: "projects" });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_pieces_list",
      description: "List available Activepieces pieces (integrations).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          projectId: { type: "string" },
          searchQuery: { type: "string" },
          includeTags: { type: "boolean" },
          includeHidden: { type: "boolean" },
          limit: { type: "number" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        // projectId is optional for pieces list, but including it can unlock scoped pieces for some installs.
        const projectId = readOptionalString(params, "projectId");
        const searchQuery = readOptionalString(params, "searchQuery");
        const includeTags =
          params && typeof params === "object" && !Array.isArray(params)
            ? ((params as Record<string, unknown>).includeTags as boolean | undefined)
            : undefined;
        const includeHidden =
          params && typeof params === "object" && !Array.isArray(params)
            ? ((params as Record<string, unknown>).includeHidden as boolean | undefined)
            : undefined;
        const limit = readOptionalNumber(params, "limit");
        const query = new URLSearchParams();
        if (projectId) query.set("projectId", projectId);
        if (searchQuery) query.set("searchQuery", searchQuery);
        if (typeof includeTags === "boolean") query.set("includeTags", includeTags ? "true" : "false");
        if (typeof includeHidden === "boolean") query.set("includeHidden", includeHidden ? "true" : "false");
        if (limit && limit > 0) query.set("limit", String(Math.trunc(limit)));

        const endpoint = query.toString() ? `pieces?${query.toString()}` : "pieces";
        const data = await apRequest({ api, endpoint });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_connections_list",
      description: "List Activepieces app connections. Requires projectId (param or configured default).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          projectId: { type: "string" },
          pieceName: { type: "string" },
          displayName: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const projectId = resolveProjectIdOrThrow(api, params);
        const pieceName = readOptionalString(params, "pieceName");
        const displayName = readOptionalString(params, "displayName");
        const limit = readOptionalNumber(params, "limit");
        const cursor = readOptionalString(params, "cursor");

        const query = new URLSearchParams();
        query.set("projectId", projectId);
        if (pieceName) query.set("pieceName", pieceName);
        if (displayName) query.set("displayName", displayName);
        if (cursor) query.set("cursor", cursor);
        if (limit && limit > 0) query.set("limit", String(Math.trunc(limit)));

        const data = await apRequest({ api, endpoint: `app-connections?${query.toString()}` });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_flows_list",
      description: "List Activepieces flows. Requires projectId (param or configured default).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          projectId: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
          name: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const projectId = resolveProjectIdOrThrow(api, params);
        const limit = readOptionalNumber(params, "limit");
        const cursor = readOptionalString(params, "cursor");
        const name = readOptionalString(params, "name");

        const query = new URLSearchParams();
        query.set("projectId", projectId);
        if (cursor) query.set("cursor", cursor);
        if (limit && limit > 0) query.set("limit", String(Math.trunc(limit)));
        if (name) query.set("name", name);

        const data = await apRequest({ api, endpoint: `flows?${query.toString()}` });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_flow_get",
      description: "Get an Activepieces flow by id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          flowId: { type: "string" },
        },
        required: ["flowId"],
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const flowId = readOptionalString(params, "flowId");
        if (!flowId) {
          throw new Error("flowId required");
        }
        const data = await apRequest({ api, endpoint: `flows/${encodeURIComponent(flowId)}` });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_flow_create",
      description: "Create an Activepieces flow (requires projectId).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          projectId: { type: "string" },
          displayName: { type: "string" },
          folderId: { type: "string" },
          folderName: { type: "string" },
          templateId: { type: "string" },
        },
        required: ["displayName"],
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const projectId = resolveProjectIdOrThrow(api, params);
        const displayName = readOptionalString(params, "displayName");
        if (!displayName) {
          throw new Error("displayName required");
        }
        const folderId = readOptionalString(params, "folderId");
        const folderName = readOptionalString(params, "folderName");
        const templateId = readOptionalString(params, "templateId");

        const body: Record<string, unknown> = { projectId, displayName };
        if (folderId) body.folderId = folderId;
        if (folderName) body.folderName = folderName;
        if (templateId) body.templateId = templateId;

        const data = await apRequest({ api, endpoint: "flows", method: "POST", body });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_flow_operation",
      description:
        "Apply a FlowOperationRequest to a flow (rename, enable/disable, publish, add/update steps).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          flowId: { type: "string" },
          operation: { type: "object" },
        },
        required: ["flowId", "operation"],
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const flowId = readOptionalString(params, "flowId");
        if (!flowId) {
          throw new Error("flowId required");
        }
        if (!params || typeof params !== "object" || Array.isArray(params)) {
          throw new Error("operation required");
        }
        const operation = (params as Record<string, unknown>).operation;
        if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
          throw new Error("operation must be an object");
        }
        const data = await apRequest({
          api,
          endpoint: `flows/${encodeURIComponent(flowId)}`,
          method: "POST",
          body: operation,
        });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_flow_delete",
      description: "Delete an Activepieces flow by id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          flowId: { type: "string" },
        },
        required: ["flowId"],
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const flowId = readOptionalString(params, "flowId");
        if (!flowId) {
          throw new Error("flowId required");
        }
        const data = await apRequest({
          api,
          endpoint: `flows/${encodeURIComponent(flowId)}`,
          method: "DELETE",
        });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_flow_trigger",
      description:
        "Trigger an Activepieces webhook flow by id (calls /api/v1/webhooks/:flowId). Use draft/sync flags for testing.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          flowId: { type: "string" },
          payload: { type: "object" },
          draft: { type: "boolean" },
          sync: { type: "boolean" },
        },
        required: ["flowId"],
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const flowId = readOptionalString(params, "flowId");
        if (!flowId) {
          throw new Error("flowId required");
        }
        const payload =
          params && typeof params === "object" && !Array.isArray(params)
            ? ((params as Record<string, unknown>).payload ?? {})
            : {};

        const draft =
          params && typeof params === "object" && !Array.isArray(params)
            ? ((params as Record<string, unknown>).draft as boolean | undefined)
            : undefined;
        const sync =
          params && typeof params === "object" && !Array.isArray(params)
            ? ((params as Record<string, unknown>).sync as boolean | undefined)
            : undefined;

        const suffix = draft && sync ? "draft/sync" : draft ? "draft" : sync ? "sync" : "";
        const endpoint = suffix
          ? `webhooks/${encodeURIComponent(flowId)}/${suffix}`
          : `webhooks/${encodeURIComponent(flowId)}`;
        const data = await apRequest({ api, endpoint, method: "POST", body: payload });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_flow_runs_list",
      description:
        "List Activepieces flow runs (requires projectId). Optionally filter by flowId.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          projectId: { type: "string" },
          flowId: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const projectId = resolveProjectIdOrThrow(api, params);
        const flowId = readOptionalString(params, "flowId");
        const limit = readOptionalNumber(params, "limit");
        const cursor = readOptionalString(params, "cursor");
        const query = new URLSearchParams();
        query.set("projectId", projectId);
        if (flowId) {
          query.append("flowId", flowId);
        }
        if (cursor) {
          query.set("cursor", cursor);
        }
        if (limit && limit > 0) {
          query.set("limit", String(Math.trunc(limit)));
        }
        const data = await apRequest({ api, endpoint: `flow-runs?${query.toString()}` });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_flow_run_get",
      description: "Get an Activepieces flow run by id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          runId: { type: "string" },
        },
        required: ["runId"],
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const runId = readOptionalString(params, "runId");
        if (!runId) {
          throw new Error("runId required");
        }
        const data = await apRequest({ api, endpoint: `flow-runs/${encodeURIComponent(runId)}` });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_flow_run_retry",
      description: "Retry an Activepieces flow run by id (requires projectId).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          runId: { type: "string" },
          projectId: { type: "string" },
          strategy: { type: "string" },
        },
        required: ["runId", "strategy"],
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const runId = readOptionalString(params, "runId");
        if (!runId) {
          throw new Error("runId required");
        }
        const projectId = resolveProjectIdOrThrow(api, params);
        const strategy = readOptionalString(params, "strategy");
        if (!strategy) {
          throw new Error("strategy required");
        }
        const data = await apRequest({
          api,
          endpoint: `flow-runs/${encodeURIComponent(runId)}/retry`,
          method: "POST",
          body: { projectId, strategy },
        });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_connection_upsert",
      description:
        "Upsert an Activepieces app connection (project scope). Body should match UpsertAppConnectionRequestBody.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          connection: { type: "object" },
        },
        required: ["connection"],
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        if (!params || typeof params !== "object" || Array.isArray(params)) {
          throw new Error("connection required");
        }
        const connection = (params as Record<string, unknown>).connection;
        if (!connection || typeof connection !== "object" || Array.isArray(connection)) {
          throw new Error("connection must be an object");
        }
        // Ensure projectId is present (so Activepieces securityAccess.project can resolve request.projectId).
        const projectId = resolveProjectIdOrThrow(api, connection);
        const data = await apRequest({
          api,
          endpoint: "app-connections",
          method: "POST",
          body: { ...connection, projectId },
        });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_connection_delete",
      description: "Delete an Activepieces app connection by id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          connectionId: { type: "string" },
        },
        required: ["connectionId"],
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const connectionId = readOptionalString(params, "connectionId");
        if (!connectionId) {
          throw new Error("connectionId required");
        }
        const data = await apRequest({
          api,
          endpoint: `app-connections/${encodeURIComponent(connectionId)}`,
          method: "DELETE",
        });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_connection_update",
      description:
        "Update an Activepieces app connection metadata/displayName by id (does not update secret value).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          connectionId: { type: "string" },
          displayName: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["connectionId", "displayName"],
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const connectionId = readOptionalString(params, "connectionId");
        const displayName = readOptionalString(params, "displayName");
        if (!connectionId) {
          throw new Error("connectionId required");
        }
        if (!displayName) {
          throw new Error("displayName required");
        }
        const metadata =
          params && typeof params === "object" && !Array.isArray(params)
            ? ((params as Record<string, unknown>).metadata as Record<string, unknown> | undefined)
            : undefined;
        const body: Record<string, unknown> = { displayName };
        if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
          body.metadata = metadata;
        }
        const data = await apRequest({
          api,
          endpoint: `app-connections/${encodeURIComponent(connectionId)}`,
          method: "POST",
          body,
        });
        return jsonToolResult(data);
      },
    });
  },
};
