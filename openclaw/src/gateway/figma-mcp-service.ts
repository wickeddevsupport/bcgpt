import {
  callWorkspaceFigmaMcpTool,
  listWorkspaceFigmaMcpTools,
  probeWorkspaceFigmaMcpStatus,
} from "./figma-mcp-client.js";

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeFigmaMcpToolName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "";
  }
  return raw.replace(/^(?:figma\.)+/i, "");
}

function extractFigmaMcpToolList(result: unknown): Array<Record<string, unknown>> {
  const listRaw = (() => {
    if (Array.isArray(result)) return result;
    if (isJsonObject(result) && Array.isArray(result.tools)) return result.tools;
    if (isJsonObject(result) && isJsonObject(result.result) && Array.isArray(result.result.tools)) {
      return result.result.tools;
    }
    if (isJsonObject(result) && isJsonObject(result.data) && Array.isArray(result.data.tools)) {
      return result.data.tools;
    }
    return [];
  })();

  return listRaw.filter((item): item is Record<string, unknown> => isJsonObject(item));
}

export function normalizeFigmaMcpToolListResult(result: unknown): unknown {
  const tools = extractFigmaMcpToolList(result);
  if (!tools.length) {
    return result;
  }

  const availableTools = tools
    .map((tool) => {
      const originalName = stringOrNull(tool.name);
      const shortName = normalizeFigmaMcpToolName(originalName);
      if (!shortName) {
        return null;
      }
      const qualifiedName = originalName?.startsWith("figma.")
        ? originalName
        : `figma.${shortName}`;
      return {
        shortName,
        qualifiedName,
        description: stringOrNull(tool.description),
        inputSchema: tool.inputSchema ?? tool.schema ?? tool.parameters ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!availableTools.length) {
    return result;
  }

  const recommendedStartingTools = availableTools
    .filter((tool) =>
      ["get_design_context", "get_metadata", "get_screenshot", "get_variable_defs"].includes(
        tool.shortName,
      ),
    )
    .map((tool) => tool.shortName);

  const basePayload = isJsonObject(result) ? result : { result };
  return {
    ...basePayload,
    availableTools,
    toolNames: availableTools.map((tool) => tool.shortName),
    recommendedStartingTools,
    callConvention:
      "Pass either a short MCP tool name like `get_design_context` or a fully qualified name like `figma.get_design_context` to `figma_mcp_call`.",
  };
}

export async function buildWorkspaceFigmaMcpFailurePayload(params: {
  workspaceId: string;
  err: unknown;
  requestedTool?: string | null;
}): Promise<Record<string, unknown>> {
  const message = params.err instanceof Error ? params.err.message : String(params.err);
  const requiredScope = (() => {
    const match = message.match(/requires(?:\s+the)?\s+([a-z_]+:[a-z_]+)/i);
    return match?.[1] ?? null;
  })();
  const authRequired =
    /FIGMA_MCP_AUTH_REQUIRED|OAuth auth is required|state mismatch|FIGMA_PAT_REQUIRED/i.test(
      message,
    );
  const patRequired = /FIGMA_PAT_REQUIRED/i.test(message);
  const status = await probeWorkspaceFigmaMcpStatus(params.workspaceId);

  return {
    error: message,
    code: requiredScope
      ? "FIGMA_SCOPE_REQUIRED"
      : patRequired
      ? "FIGMA_PAT_REQUIRED"
      : authRequired
        ? "FIGMA_MCP_AUTH_REQUIRED"
        : "FIGMA_MCP_CALL_FAILED",
    requestedTool: params.requestedTool ?? null,
    requiredScope,
    hasPersonalAccessToken: status.hasPersonalAccessToken,
    source: status.source,
    mcpServerUrl: status.url,
    fallbackSuggested: requiredScope ? null : "figma_pat_audit_file",
    fallbackReason: requiredScope
      ? `The current workspace Figma token is missing the ${requiredScope} scope required by this capability.`
      : patRequired
      ? "PMOS needs the workspace Figma PAT from the embedded Figma panel before the MCP-compatible bridge can read comments, metadata, screenshots, or variables."
      : authRequired
        ? "PMOS needs the workspace Figma PAT-backed compatibility bridge to be ready before deeper Figma operations can run."
        : "The PMOS Figma MCP service call failed; use the workspace PAT-backed audit fallback.",
    authCommand: null,
  };
}

export async function listWorkspaceFigmaMcpServiceTools(workspaceId: string): Promise<unknown> {
  return normalizeFigmaMcpToolListResult(await listWorkspaceFigmaMcpTools(workspaceId));
}

export async function callWorkspaceFigmaMcpServiceTool(params: {
  workspaceId: string;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  const tool = normalizeFigmaMcpToolName(params.toolName);
  if (!tool) {
    throw new Error("tool is required");
  }
  return callWorkspaceFigmaMcpTool({
    workspaceId: params.workspaceId,
    toolName: `figma.${tool}`,
    args: params.args ?? {},
  });
}

export async function probeWorkspaceFigmaMcpServiceStatus(workspaceId: string) {
  return probeWorkspaceFigmaMcpStatus(workspaceId);
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export async function dispatchWorkspaceFigmaMcpRpc(params: {
  workspaceId: string;
  id?: unknown;
  method: unknown;
  rpcParams?: unknown;
}): Promise<Record<string, unknown>> {
  const id = params.id ?? null;
  const method = typeof params.method === "string" ? params.method.trim() : "";
  const rpcParams = isJsonObject(params.rpcParams) ? params.rpcParams : {};

  if (method === "tools/list") {
    try {
      return jsonRpcResult(id, await listWorkspaceFigmaMcpServiceTools(params.workspaceId));
    } catch (err) {
      return jsonRpcResult(
        id,
        await buildWorkspaceFigmaMcpFailurePayload({
          workspaceId: params.workspaceId,
          err,
          requestedTool: "list_tools",
        }),
      );
    }
  }

  if (method === "tools/call") {
    const toolName = stringOrNull(rpcParams.name) ?? stringOrNull(rpcParams.toolName) ?? "";
    const toolArgs =
      rpcParams.arguments && isJsonObject(rpcParams.arguments)
        ? (rpcParams.arguments as Record<string, unknown>)
        : rpcParams.args && isJsonObject(rpcParams.args)
          ? (rpcParams.args as Record<string, unknown>)
          : {};
    if (!toolName) {
      return jsonRpcResult(id, {
        error: "Tool name is required.",
        code: "INVALID_TOOL_NAME",
      });
    }
    try {
      return jsonRpcResult(
        id,
        await callWorkspaceFigmaMcpServiceTool({
          workspaceId: params.workspaceId,
          toolName,
          args: toolArgs,
        }),
      );
    } catch (err) {
      return jsonRpcResult(
        id,
        await buildWorkspaceFigmaMcpFailurePayload({
          workspaceId: params.workspaceId,
          err,
          requestedTool: toolName,
        }),
      );
    }
  }

  if (method === "pmos/status") {
    return jsonRpcResult(id, await probeWorkspaceFigmaMcpServiceStatus(params.workspaceId));
  }

  return jsonRpcError(id, -32601, `Method not supported: ${String(method)}`);
}
