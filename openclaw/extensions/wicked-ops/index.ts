import type { OpenClawPluginApi } from "../../src/plugins/types.js";

type OpsConfig = {
  baseUrl?: string;
  apiKey?: string;
};

type PmosOpsConnectorConfig = {
  url?: string;
  apiKey?: string;
};

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function readPmosOpsConnector(api: OpenClawPluginApi): PmosOpsConnectorConfig | null {
  const cfg = api.config as unknown;
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pmos = (cfg as any).pmos;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops = pmos && typeof pmos === "object" ? (pmos as any).connectors?.ops : null;
  if (!ops || typeof ops !== "object" || Array.isArray(ops)) {
    return null;
  }
  return ops as PmosOpsConnectorConfig;
}

function resolveOpsConfig(api: OpenClawPluginApi): Required<OpsConfig> {
  const pmos = readPmosOpsConnector(api);
  const cfg = (api.pluginConfig ?? {}) as OpsConfig;
  const baseUrl = normalizeUrl(
    pmos?.url ??
      cfg.baseUrl ??
      process.env.OPS_URL ??
      "https://ops.wickedlab.io",
  );
  const apiKey = (pmos?.apiKey ?? cfg.apiKey ?? process.env.OPS_API_KEY ?? "").trim();
  return { baseUrl, apiKey };
}

async function opsRequest(params: {
  api: OpenClawPluginApi;
  endpoint: string;
  method?: string;
  body?: unknown;
  // optional: prefer workspace-scoped connectors when provided
  workspaceId?: string | null;
}) {
  // Workspace override (if provided) takes precedence.
  let baseUrl: string;
  let apiKey: string;

  if (params.workspaceId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { readWorkspaceConnectors } = await import("../../src/gateway/workspace-connectors.js");
      const wc = await readWorkspaceConnectors(String(params.workspaceId));
      if (wc?.ops?.apiKey) {
        baseUrl = (wc.ops.url ?? "").trim();
        apiKey = (wc.ops.apiKey ?? "").trim();
      }
    } catch {
      // Fall through to global resolution if workspace read fails
    }
  }

  if (!apiKey || !baseUrl) {
    const resolved = resolveOpsConfig(params.api);
    baseUrl = baseUrl || resolved.baseUrl;
    apiKey = apiKey || resolved.apiKey;
  }

  if (!apiKey) {
    throw new Error(
      "Wicked Ops API key is not configured. Set it in PMOS -> Integrations, or set env OPS_API_KEY.",
    );
  }
  if (!baseUrl) {
    throw new Error(
      "Wicked Ops URL is not configured. Set it in PMOS -> Integrations, or set env OPS_URL.",
    );
  }

  const endpoint = params.endpoint.replace(/^\/+/, "");
  const url = `${baseUrl}/api/v1/${endpoint}`;
  const method = (params.method ?? "GET").toUpperCase();
  const hasBody = params.body !== undefined;
  const headers: Record<string, string> = {
    "X-N8N-API-KEY": apiKey,
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
    throw new Error(`Wicked Ops API ${res.status} ${res.statusText}: ${text}`.trim());
  }

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
  return maybeParams === undefined ? toolCallIdOrParams : maybeParams;
}

export default {
  id: "wicked-ops",
  name: "Wicked Ops (n8n)",
  register(api: OpenClawPluginApi) {
    api.logger.info("[wicked-ops] registering tools");

    // ========================================
    //         WORKFLOW MANAGEMENT
    // ========================================

    api.registerTool({
      name: "ops_workflows_list",
      description: "List all n8n workflows in Wicked Ops.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          active: { type: "boolean", description: "Filter by active status" },
          tags: { type: "string", description: "Comma-separated tag names to filter by" },
          workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const active = params && typeof params === "object" && !Array.isArray(params)
          ? ((params as Record<string, unknown>).active as boolean | undefined)
          : undefined;
        const tags = readOptionalString(params, "tags");
        const workspaceId = readOptionalString(params, "workspaceId");

        const query = new URLSearchParams();
        if (typeof active === "boolean") query.set("active", active ? "true" : "false");
        if (tags) query.set("tags", tags);

        const endpoint = query.toString() ? `workflows?${query.toString()}` : "workflows";
        const data = await opsRequest({ api, endpoint, workspaceId });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "ops_workflow_get",
      description: "Get details of a specific n8n workflow by ID.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string", description: "The workflow ID" },
          workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) {
          throw new Error("workflowId is required");
        }
        const data = await opsRequest({ api, endpoint: `workflows/${workflowId}`, workspaceId });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "ops_workflow_create",
      description: "Create a new n8n workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string", description: "Workflow name" },
          nodes: { type: "array", description: "Array of workflow nodes (JSON)" },
          connections: { type: "object", description: "Workflow connections object (JSON)" },
          settings: { type: "object", description: "Workflow settings (JSON)" },
          tags: { type: "array", description: "Array of tag names" },
          workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams) as Record<string, any>;
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!params || typeof params !== "object" || !params.name) {
          throw new Error("name is required");
        }
        const data = await opsRequest({
          api,
          endpoint: "workflows",
          method: "POST",
          body: params,
          workspaceId,
        });
        return jsonToolResult(data);
      },
    });

    // Simple natural-language → workflow helper (pragmatic starter):
    // creates a minimal workflow skeleton from a short description so chat can
    // quickly create a workflow and the user can open it in the editor.
    api.registerTool({
      name: "ops_workflow_generate",
      description: "Generate a simple n8n workflow from a short natural-language description.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams) as Record<string, any>;
        const name = readOptionalString(params, "name");
        const desc = readOptionalString(params, "description");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!name || !desc) throw new Error("name and description are required");

        // Minimal n8n workflow skeleton: Start node -> Function node that contains the description
        const workflowBody = {
          name,
          nodes: [
            {
              name: "Start",
              type: "n8n-nodes-base.start",
              typeVersion: 1,
              position: [250, 300],
              parameters: {},
            },
            {
              name: "Describe",
              type: "n8n-nodes-base.function",
              typeVersion: 1,
              position: [450, 300],
              parameters: {
                functionCode: `// Natural language description:\n// ${desc.replace(/`/g, "\\`")}\nreturn [{ json: { description: ${JSON.stringify(
                desc,
              )} } }];`,
              },
            },
          ],
          connections: {},
        } as unknown as Record<string, unknown>;

        const data = await opsRequest({ api, endpoint: "workflows", method: "POST", body: workflowBody, workspaceId });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "ops_workflow_update",
      description: "Update an existing n8n workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string", description: "The workflow ID" },
          name: { type: "string", description: "Workflow name" },
          nodes: { type: "array", description: "Array of workflow nodes (JSON)" },
          connections: { type: "object", description: "Workflow connections object (JSON)" },
          settings: { type: "object", description: "Workflow settings (JSON)" },
          tags: { type: "array", description: "Array of tag names" },
          active: { type: "boolean", description: "Whether workflow is active" },
          workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams) as Record<string, any>;
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) {
          throw new Error("workflowId is required");
        }
        const { workflowId: _, ...updateBody } = params;
        const data = await opsRequest({
          api,
          endpoint: `workflows/${workflowId}`,
          method: "PATCH",
          body: updateBody,
          workspaceId,
        });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "ops_workflow_delete",
      description: "Delete an n8n workflow by ID.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string", description: "The workflow ID to delete" },
          workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) {
          throw new Error("workflowId is required");
        }
        const data = await opsRequest({
          api,
          endpoint: `workflows/${workflowId}`,
          method: "DELETE",
          workspaceId,
        });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "ops_workflow_activate",
      description: "Activate an n8n workflow to start running.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string", description: "The workflow ID to activate" },
          workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) {
          throw new Error("workflowId is required");
        }
        const data = await opsRequest({
          api,
          endpoint: `workflows/${workflowId}`,
          method: "PATCH",
          body: { active: true },
          workspaceId,
        });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "ops_workflow_deactivate",
      description: "Deactivate an n8n workflow to stop it from running.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string", description: "The workflow ID to deactivate" },
          workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) {
          throw new Error("workflowId is required");
        }
        const data = await opsRequest({
          api,
          endpoint: `workflows/${workflowId}`,
          method: "PATCH",
          body: { active: false },
          workspaceId,
        });
        return jsonToolResult(data);
      },
    });

    // ========================================
    //         WORKFLOW EXECUTIONS
    // ========================================

    api.registerTool({
      name: "ops_executions_list",
      description: "List workflow executions (runs). Optional: filter by workflow ID.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          workflowId: { type: "string", description: "Filter by workflow ID" },
          status: { type: "string", description: "Filter by status: success, error, waiting" },
          limit: { type: "number", description: "Maximum number of results" },
          workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workflowId = readOptionalString(params, "workflowId");
        const status = readOptionalString(params, "status");
        const limit = readOptionalNumber(params, "limit");
        const workspaceId = readOptionalString(params, "workspaceId");

        const query = new URLSearchParams();
        if (workflowId) query.set("workflowId", workflowId);
        if (status) query.set("status", status);
        if (limit && limit > 0) query.set("limit", String(Math.trunc(limit)));

        const endpoint = query.toString() ? `executions?${query.toString()}` : "executions";
        const data = await opsRequest({ api, endpoint, workspaceId });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "ops_execution_get",
      description: "Get details of a specific workflow execution by ID.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["executionId"],
        properties: {
          executionId: { type: "string", description: "The execution ID" },
          workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const executionId = readOptionalString(params, "executionId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!executionId) {
          throw new Error("executionId is required");
        }
        const data = await opsRequest({ api, endpoint: `executions/${executionId}`, workspaceId });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "ops_workflow_execute",
      description: "Manually trigger execution of an n8n workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["workflowId"],
        properties: {
          workflowId: { type: "string", description: "The workflow ID to execute" },
          data: { type: "object", description: "Input data to pass to the workflow (JSON)" },
          workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams) as Record<string, any>;
        const workflowId = readOptionalString(params, "workflowId");
        const workspaceId = readOptionalString(params, "workspaceId");
        if (!workflowId) {
          throw new Error("workflowId is required");
        }
        const data = await opsRequest({
          api,
          endpoint: `workflows/${workflowId}/execute`,
          method: "POST",
          body: params.data || {},
          workspaceId,
        });
        return jsonToolResult(data);
      },
    });

    // ========================================
    //         CREDENTIALS
    // ========================================

    api.registerTool({
      name: "ops_credentials_list",
      description: "List stored credentials in n8n.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", description: "Filter by credential type" },
          workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const type = readOptionalString(params, "type");
        const workspaceId = readOptionalString(params, "workspaceId");

        const query = new URLSearchParams();
        if (type) query.set("type", type);

        const endpoint = query.toString() ? `credentials?${query.toString()}` : "credentials";
        const data = await opsRequest({ api, endpoint, workspaceId });
        return jsonToolResult(data);
      },
    });

    // ========================================
    //         CONNECTION TEST
    // ========================================

    api.registerTool({
      name: "ops_test_connection",
      description: "Test connection to Wicked Ops (n8n). Returns success if API key is valid.",
      parameters: { type: "object", additionalProperties: false, properties: { workspaceId: { type: "string", description: "(optional) PMOS workspace id to use workspace-scoped API key" } } },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveToolParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readOptionalString(params, "workspaceId");
        const data = await opsRequest({ api, endpoint: "workflows?limit=1", workspaceId });
        return jsonToolResult({ success: true, message: "Connected to Wicked Ops", data });
      },
    });

    api.logger.info("[wicked-ops] registered 16 tools");
  },
};
