import type { OpenClawPluginApi } from "../../src/plugins/types.js";

type ActivepiecesConfig = {
  baseUrl?: string;
  apiKey?: string;
};

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function resolveActivepiecesConfig(api: OpenClawPluginApi): Required<ActivepiecesConfig> {
  const cfg = (api.pluginConfig ?? {}) as ActivepiecesConfig;
  const baseUrl = normalizeUrl(
    cfg.baseUrl ??
      process.env.ACTIVEPIECES_URL ??
      process.env.FLOW_URL ??
      "https://flow.wickedlab.io",
  );
  const apiKey = (cfg.apiKey ?? process.env.ACTIVEPIECES_API_KEY ?? "").trim();
  return { baseUrl, apiKey };
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
      "ACTIVEPIECES_API_KEY is not configured. Set env ACTIVEPIECES_API_KEY or plugins.entries.pmos-activepieces.config.apiKey.",
    );
  }
  if (!baseUrl) {
    throw new Error(
      "ACTIVEPIECES_URL is not configured. Set env ACTIVEPIECES_URL or plugins.entries.pmos-activepieces.config.baseUrl.",
    );
  }

  const endpoint = params.endpoint.replace(/^\/+/, "");
  const url = `${baseUrl}/api/v1/${endpoint}`;
  const method = (params.method ?? "GET").toUpperCase();

  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
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

export default {
  id: "pmos-activepieces",
  name: "PMOS Activepieces",
  register(api: OpenClawPluginApi) {
    api.logger.info("[pmos-activepieces] registering tools");

    api.registerTool({
      name: "flow_projects_list",
      description: "List Activepieces projects.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      async execute() {
        const data = await apRequest({ api, endpoint: "projects" });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_pieces_list",
      description: "List available Activepieces pieces (integrations).",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      async execute() {
        const data = await apRequest({ api, endpoint: "pieces" });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_connections_list",
      description: "List Activepieces connections. Optionally filter by projectId.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          projectId: { type: "string" },
        },
      },
      async execute(params: unknown) {
        const projectId = readOptionalString(params, "projectId");
        const endpoint = projectId ? `connections?projectId=${encodeURIComponent(projectId)}` : "connections";
        const data = await apRequest({ api, endpoint });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_flows_list",
      description: "List Activepieces flows. Optionally filter by projectId.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          projectId: { type: "string" },
        },
      },
      async execute(params: unknown) {
        const projectId = readOptionalString(params, "projectId");
        const endpoint = projectId ? `flows?projectId=${encodeURIComponent(projectId)}` : "flows";
        const data = await apRequest({ api, endpoint });
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
      async execute(params: unknown) {
        const flowId = readOptionalString(params, "flowId");
        if (!flowId) {
          throw new Error("flowId required");
        }
        const data = await apRequest({ api, endpoint: `flows/${encodeURIComponent(flowId)}` });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_flow_trigger",
      description:
        "Trigger an Activepieces flow by id. Provide payload for the trigger if needed.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          flowId: { type: "string" },
          payload: { type: "object" },
        },
        required: ["flowId"],
      },
      async execute(params: unknown) {
        const flowId = readOptionalString(params, "flowId");
        if (!flowId) {
          throw new Error("flowId required");
        }
        const payload =
          params && typeof params === "object" && !Array.isArray(params)
            ? ((params as Record<string, unknown>).payload ?? {})
            : {};
        const data = await apRequest({
          api,
          endpoint: `flows/${encodeURIComponent(flowId)}/trigger`,
          method: "POST",
          body: payload,
        });
        return jsonToolResult(data);
      },
    });

    api.registerTool({
      name: "flow_flow_runs_list",
      description: "List Activepieces flow runs for a given flowId.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          flowId: { type: "string" },
          limit: { type: "number" },
        },
        required: ["flowId"],
      },
      async execute(params: unknown) {
        const flowId = readOptionalString(params, "flowId");
        if (!flowId) {
          throw new Error("flowId required");
        }
        const limit = readOptionalNumber(params, "limit");
        const query = new URLSearchParams();
        query.set("flowId", flowId);
        if (limit && limit > 0) {
          query.set("limit", String(Math.trunc(limit)));
        }
        const data = await apRequest({ api, endpoint: `flow-runs?${query.toString()}` });
        return jsonToolResult(data);
      },
    });
  },
};

