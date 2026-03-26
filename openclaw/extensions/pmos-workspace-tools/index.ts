import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { readWorkspaceConnectors } from "../../src/gateway/workspace-connectors.js";
import {
  callWorkspaceFigmaMcpServiceTool,
  listWorkspaceFigmaMcpServiceTools,
  normalizeFigmaMcpToolListResult,
  normalizeFigmaMcpToolName,
} from "../../src/gateway/figma-mcp-service.js";
import { buildFigmaRestAuditReport, parseFigmaFileKey } from "../../src/gateway/figma-rest-audit.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveParams(
  toolCallIdOrParams: unknown,
  maybeParams?: unknown,
): Record<string, unknown> {
  const raw = maybeParams === undefined ? toolCallIdOrParams : maybeParams;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

function readStr(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t || undefined;
}

function readObj(params: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = params[key];
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

function readNum(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

// ---------------------------------------------------------------------------
// Basecamp / bcgpt helpers
// ---------------------------------------------------------------------------

function normalizeUrl(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "https://bcgpt.wickedlab.io";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function resolveBcgptAccess(
  api: OpenClawPluginApi,
  workspaceId: string,
): Promise<{ bcgptUrl: string; apiKey: string | null }> {
  const connectors = await readWorkspaceConnectors(workspaceId).catch(() => null);

  // Walk global config for fallback credentials.
  const cfg = api.config as Record<string, unknown> | null;
  const pmosSection = (cfg?.pmos && typeof cfg.pmos === "object" && !Array.isArray(cfg.pmos))
    ? (cfg.pmos as Record<string, unknown>)
    : null;
  const pmosConnectors = (pmosSection?.connectors && typeof pmosSection.connectors === "object" && !Array.isArray(pmosSection.connectors))
    ? (pmosSection.connectors as Record<string, unknown>)
    : null;
  const globalBcgpt = (pmosConnectors?.bcgpt && typeof pmosConnectors.bcgpt === "object" && !Array.isArray(pmosConnectors.bcgpt))
    ? (pmosConnectors.bcgpt as Record<string, unknown>)
    : null;

  const rawUrl =
    (typeof connectors?.bcgpt?.url === "string" ? connectors.bcgpt.url.trim() : undefined) ||
    (typeof globalBcgpt?.url === "string" ? globalBcgpt.url.trim() : undefined) ||
    process.env.BCGPT_URL?.trim() ||
    null;

  const bcgptUrl = normalizeUrl(rawUrl);

  const apiKey =
    (typeof connectors?.bcgpt?.apiKey === "string" ? connectors.bcgpt.apiKey.trim() : undefined) ||
    (typeof globalBcgpt?.apiKey === "string" ? globalBcgpt.apiKey.trim() : undefined) ||
    process.env.BCGPT_API_KEY?.trim() ||
    null;

  return { bcgptUrl, apiKey: apiKey || null };
}

async function callBcgptMcp(
  bcgptUrl: string,
  apiKey: string,
  toolName: string,
  toolArgs: Record<string, unknown> = {},
  timeoutMs = 45_000,
): Promise<{ ok: boolean; result: unknown; error: string | null }> {
  try {
    const resp = await fetch(`${bcgptUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bcgpt-api-key": apiKey,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `pmos-plugin-${toolName}-${Date.now()}`,
        method: "tools/call",
        params: { name: toolName, arguments: toolArgs },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, result: null, error: `bcgpt HTTP ${resp.status}: ${text.slice(0, 200)}` };
    }

    const json = (await resp.json()) as Record<string, unknown>;

    if (json.error && typeof json.error === "object" && json.error !== null) {
      const errObj = json.error as Record<string, unknown>;
      const msg = [
        typeof errObj.code === "number" || typeof errObj.code === "string" ? String(errObj.code) : null,
        typeof errObj.message === "string" ? errObj.message : null,
      ]
        .filter(Boolean)
        .join(": ");
      return { ok: false, result: null, error: msg || `${toolName} returned an error` };
    }

    const raw = json.result ?? null;
    return { ok: true, result: normalizeBcgptResult(raw), error: null };
  } catch (err) {
    return { ok: false, result: null, error: String(err) };
  }
}

// Unwrap MCP content arrays into plain objects the model can read.
function normalizeBcgptResult(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  const obj = result as Record<string, unknown>;
  const content = obj.content;
  if (!Array.isArray(content)) return result;

  const textBlocks: string[] = [];
  const parsedBlocks: unknown[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const text = (item as Record<string, unknown>).text;
    if (typeof text !== "string" || !text.trim()) continue;
    textBlocks.push(text);
    try {
      parsedBlocks.push(JSON.parse(text));
    } catch {
      // plain text block, not JSON
    }
  }

  if (parsedBlocks.length === 1 && textBlocks.length === 1) {
    return parsedBlocks[0];
  }
  if (!textBlocks.length) return result;
  return {
    ...obj,
    contentText: textBlocks.join("\n\n"),
    parsedContent:
      parsedBlocks.length > 1 ? parsedBlocks : parsedBlocks.length === 1 ? parsedBlocks[0] : undefined,
  };
}

// ---------------------------------------------------------------------------
// Figma helpers
// ---------------------------------------------------------------------------

type FigmaContext = {
  personalAccessToken: string | null;
  hasPersonalAccessToken: boolean;
  mcpServerUrl: string;
  selectedFileId: string | null;
  selectedFileName: string | null;
  selectedFileUrl: string | null;
  activeTeamId: string | null;
  activeConnectionId: string | null;
  activeConnectionName: string | null;
  connected: boolean;
  source: string | null;
};

async function readFigmaContext(workspaceId: string): Promise<FigmaContext> {
  const connectors = await readWorkspaceConnectors(workspaceId).catch(() => null);
  const figma = (connectors?.figma ?? {}) as Record<string, unknown>;
  const auth = (typeof figma.auth === "object" && figma.auth && !Array.isArray(figma.auth)
    ? (figma.auth as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const identity = (typeof figma.identity === "object" && figma.identity && !Array.isArray(figma.identity)
    ? (figma.identity as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const pat = typeof auth.personalAccessToken === "string" ? auth.personalAccessToken.trim() : null;

  return {
    personalAccessToken: pat || null,
    hasPersonalAccessToken:
      Boolean(pat) ||
      auth.hasPersonalAccessToken === true ||
      identity.hasPersonalAccessToken === true,
    mcpServerUrl:
      (typeof auth.mcpServerUrl === "string" ? auth.mcpServerUrl.trim() : null) ||
      "https://mcp.figma.com/mcp",
    selectedFileId:
      typeof identity.selectedFileId === "string" ? identity.selectedFileId.trim() || null : null,
    selectedFileName:
      typeof identity.selectedFileName === "string" ? identity.selectedFileName.trim() || null : null,
    selectedFileUrl:
      typeof identity.selectedFileUrl === "string" ? identity.selectedFileUrl.trim() || null : null,
    activeTeamId:
      typeof identity.activeTeamId === "string" ? identity.activeTeamId.trim() || null : null,
    activeConnectionId:
      identity.activeConnectionId != null ? String(identity.activeConnectionId).trim() || null : null,
    activeConnectionName:
      typeof identity.activeConnectionName === "string" ? identity.activeConnectionName.trim() || null : null,
    connected: identity.connected === true,
    source: typeof auth.source === "string" ? auth.source.trim() || null : null,
  };
}

// Fill in known context values that were left blank / null in toolArgs.
function hydrateFigmaArgs(
  rawArgs: Record<string, unknown>,
  ctx: FigmaContext,
): Record<string, unknown> {
  const next = { ...rawArgs };
  const fill = (keys: string[], value: string | null) => {
    if (!value) return;
    for (const key of keys) {
      if (!(key in next)) continue;
      const cur = next[key];
      if (cur === null || cur === undefined || (typeof cur === "string" && cur.trim() === "")) {
        next[key] = value;
      }
    }
  };
  fill(["fileId", "file_id", "selectedFileId", "selected_file_id"], ctx.selectedFileId);
  fill(["teamId", "team_id", "figmaTeamId", "figma_team_id"], ctx.activeTeamId);
  fill(["connectionId", "connection_id", "activeConnectionId", "active_connection_id"], ctx.activeConnectionId);
  return next;
}

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const WORKSPACE_ID_PROP = {
  type: "string",
  description:
    "The PMOS workspace ID. Provided in your system context under 'Workspace ID'. Always pass it when calling workspace tools.",
};

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export default {
  id: "pmos-workspace-tools",
  name: "PMOS Workspace Tools",

  register(api: OpenClawPluginApi) {
    api.logger.info("[pmos-workspace-tools] registering Basecamp and Figma tools");

    // -----------------------------------------------------------------------
    // BASECAMP TOOLS (via bcgpt MCP)
    // -----------------------------------------------------------------------

    // Generic gateway: call any named bcgpt MCP tool.
    api.registerTool({
      name: "bcgpt_mcp_call",
      description:
        "Call a named Basecamp MCP tool through the bcgpt server. Use this for deterministic Basecamp reads and writes: listing/creating/updating/completing todos, todolists, messages, schedule entries, card tables, and project people. Always prefer named MCP tools over bcgpt_smart_action when you know the exact operation. Available tools include: list_projects, list_todos_for_project, list_todolists, create_todolist, list_todos, list_todos_due, report_todos_overdue, create_todo, complete_todo, uncomplete_todo, trash_todo, move_todo, update_todo_details, list_messages, create_message, list_schedule_entries, create_schedule_entry, update_schedule_entry, trash_schedule_entry, list_card_tables, list_project_people.",
      parameters: {
        type: "object",
        required: ["workspaceId", "tool"],
        additionalProperties: false,
        properties: {
          workspaceId: WORKSPACE_ID_PROP,
          tool: {
            type: "string",
            description:
              "Exact bcgpt MCP tool name (e.g. list_todos_for_project, create_todo, complete_todo, trash_todo, move_todo).",
          },
          arguments: {
            type: "object",
            description:
              "JSON arguments for the selected tool. Refer to the tool's own schema (e.g. project name, todo_id, todolist_id, content, due_on).",
          },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readStr(params, "workspaceId");
        const toolName = readStr(params, "tool");
        const toolArgs = readObj(params, "arguments") ?? {};

        if (!workspaceId) {
          return jsonResult({ error: "workspaceId is required. Pass your PMOS workspace ID from the system context." });
        }
        if (!toolName) {
          return jsonResult({ error: "tool is required. Provide the exact bcgpt MCP tool name." });
        }

        const { bcgptUrl, apiKey } = await resolveBcgptAccess(api, workspaceId);
        if (!apiKey) {
          return jsonResult({
            error: "Basecamp is not configured for this workspace. Connect it in PMOS -> Integrations.",
            code: "BCGPT_NOT_CONFIGURED",
          });
        }

        const result = await callBcgptMcp(bcgptUrl, apiKey, toolName, toolArgs);
        if (!result.ok) {
          return jsonResult({ error: result.error ?? `${toolName} failed`, tool: toolName });
        }
        return jsonResult({ tool: toolName, arguments: toolArgs, result: result.result });
      },
    });

    // Natural language Basecamp action — for operations that need reasoning.
    api.registerTool({
      name: "bcgpt_smart_action",
      description:
        "Execute a natural-language Basecamp query or action through the bcgpt smart-action endpoint. Use this when the exact MCP tool or parameters are unclear, or for complex multi-step queries like 'summarize overdue todos across all projects'. For routine CRUD operations prefer bcgpt_mcp_call with a specific tool name.",
      parameters: {
        type: "object",
        required: ["workspaceId", "query"],
        additionalProperties: false,
        properties: {
          workspaceId: WORKSPACE_ID_PROP,
          query: {
            type: "string",
            description:
              "Natural language query or instruction for Basecamp (e.g. 'What todos are overdue in the Acme project?').",
          },
          project: {
            type: "string",
            description: "Optional Basecamp project name to scope the query.",
          },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readStr(params, "workspaceId");
        const query = readStr(params, "query");
        const project = readStr(params, "project");

        if (!workspaceId) {
          return jsonResult({ error: "workspaceId is required." });
        }
        if (!query) {
          return jsonResult({ error: "query is required." });
        }

        const { bcgptUrl, apiKey } = await resolveBcgptAccess(api, workspaceId);
        if (!apiKey) {
          return jsonResult({
            error: "Basecamp is not configured for this workspace. Connect it in PMOS -> Integrations.",
            code: "BCGPT_NOT_CONFIGURED",
          });
        }

        const toolArgs = project ? { query, project } : { query };
        const result = await callBcgptMcp(bcgptUrl, apiKey, "smart_action", toolArgs);
        if (!result.ok) {
          return jsonResult({ error: result.error ?? "smart_action failed", query, project });
        }
        return jsonResult({ query, project, result: result.result });
      },
    });

    // -----------------------------------------------------------------------
    // FIGMA TOOLS (via figma-mcp-service)
    // -----------------------------------------------------------------------

    // List available Figma MCP tools for the workspace.
    api.registerTool({
      name: "figma_mcp_list_tools",
      description:
        "List all Figma MCP tools available through the workspace Figma MCP service. Call this first if you are unsure which figma_mcp_call tool name to use.",
      parameters: {
        type: "object",
        required: ["workspaceId"],
        additionalProperties: false,
        properties: {
          workspaceId: WORKSPACE_ID_PROP,
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readStr(params, "workspaceId");
        if (!workspaceId) {
          return jsonResult({ error: "workspaceId is required." });
        }

        try {
          const result = await listWorkspaceFigmaMcpServiceTools(workspaceId);
          const normalized = normalizeFigmaMcpToolListResult(result);
          return jsonResult(normalized);
        } catch (err) {
          return jsonResult({
            error: String(err),
            hint: "Ensure Figma is connected in PMOS -> Integrations and your PAT is synced.",
          });
        }
      },
    });

    // Call a specific Figma MCP tool.
    api.registerTool({
      name: "figma_mcp_call",
      description:
        "Call a specific Figma MCP tool through the workspace Figma MCP service. Workspace file and team context (selectedFileId, activeTeamId, activeConnectionId) are auto-injected into tool arguments when blank. Use figma_mcp_list_tools to discover available tool names and their schemas.",
      parameters: {
        type: "object",
        required: ["workspaceId", "tool"],
        additionalProperties: false,
        properties: {
          workspaceId: WORKSPACE_ID_PROP,
          tool: {
            type: "string",
            description:
              "Figma MCP tool name (e.g. get_design_context, get_metadata, get_screenshot, get_variable_defs). Do not prefix with 'figma.' — it will be added automatically.",
          },
          arguments: {
            type: "object",
            description:
              "JSON arguments for the tool. Leave fileId / teamId blank to use the workspace-selected file and team.",
          },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readStr(params, "workspaceId");
        const tool = readStr(params, "tool");
        const rawArgs = readObj(params, "arguments") ?? {};

        if (!workspaceId) {
          return jsonResult({ error: "workspaceId is required." });
        }
        if (!tool) {
          return jsonResult({ error: "tool is required." });
        }

        try {
          const figmaContext = await readFigmaContext(workspaceId);
          const effectiveArgs = hydrateFigmaArgs(rawArgs, figmaContext);
          const normalizedTool = normalizeFigmaMcpToolName(tool);
          const result = await callWorkspaceFigmaMcpServiceTool({
            workspaceId,
            toolName: normalizedTool,
            args: effectiveArgs,
          });
          return jsonResult(result);
        } catch (err) {
          return jsonResult({
            error: String(err),
            tool,
            hint: "Ensure Figma is connected and your PAT is synced in PMOS -> Integrations.",
          });
        }
      },
    });

    // Figma REST audit using PAT — reliable fallback when MCP is unavailable.
    api.registerTool({
      name: "figma_pat_audit_file",
      description:
        "Run a Figma REST audit against the workspace-selected Figma file using the personal access token (PAT). Returns a structured report of components, frames, fonts, styles, and layout patterns. Does not require the Figma MCP service — works with just the PAT. Use this when figma_mcp_call fails or for a reliable design-quality overview.",
      parameters: {
        type: "object",
        required: ["workspaceId"],
        additionalProperties: false,
        properties: {
          workspaceId: WORKSPACE_ID_PROP,
          file_key: {
            type: "string",
            description:
              "Figma file key or URL to audit. Omit to use the workspace-selected file.",
          },
          focus: {
            type: "string",
            description:
              "Audit focus area: general, layout, autolayout, components, styles, fonts, or regression.",
          },
          depth: {
            type: "number",
            description: "Figma file traversal depth (1-8). Defaults to 2.",
          },
        },
      },
      async execute(toolCallIdOrParams: unknown, maybeParams?: unknown) {
        const params = resolveParams(toolCallIdOrParams, maybeParams);
        const workspaceId = readStr(params, "workspaceId");
        if (!workspaceId) {
          return jsonResult({ error: "workspaceId is required." });
        }

        const figmaContext = await readFigmaContext(workspaceId);
        if (!figmaContext.personalAccessToken) {
          return jsonResult({
            error:
              "Figma personal access token (PAT) is not configured. Connect Figma in PMOS -> Integrations and sync your PAT.",
            code: "FIGMA_PAT_MISSING",
            hasPersonalAccessToken: figmaContext.hasPersonalAccessToken,
            source: figmaContext.source,
          });
        }

        const requestedKey = readStr(params, "file_key");
        const fileKey =
          parseFigmaFileKey(requestedKey) ??
          parseFigmaFileKey(figmaContext.selectedFileId) ??
          parseFigmaFileKey(figmaContext.selectedFileUrl);

        if (!fileKey) {
          return jsonResult({
            error:
              "No Figma file selected. Select a file in the Figma tab and sync, or provide file_key.",
            code: "FIGMA_FILE_NOT_SELECTED",
            selectedFileName: figmaContext.selectedFileName,
          });
        }

        const focus = readStr(params, "focus") ?? null;
        const rawDepth = readNum(params, "depth");
        const depth =
          rawDepth !== undefined && Number.isFinite(rawDepth) && rawDepth >= 1 && rawDepth <= 8
            ? Math.trunc(rawDepth)
            : 2;

        try {
          const query = new URLSearchParams({ branch_data: "true", depth: String(depth) });
          const resp = await fetch(
            `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?${query.toString()}`,
            {
              headers: { "X-Figma-Token": figmaContext.personalAccessToken },
              signal: AbortSignal.timeout(25_000),
            },
          );

          if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            return jsonResult({
              error: `Figma API ${resp.status} ${resp.statusText}: ${text.slice(0, 300)}`,
              code: "FIGMA_API_ERROR",
              fileKey,
            });
          }

          const fileJson = (await resp.json()) as Record<string, unknown>;
          const audit = buildFigmaRestAuditReport(fileJson, { focus, fileKey });

          return jsonResult({
            ...audit,
            requestDepth: depth,
            selectedFileId: figmaContext.selectedFileId,
            selectedFileName: figmaContext.selectedFileName,
            selectedFileUrl: figmaContext.selectedFileUrl,
            activeConnectionId: figmaContext.activeConnectionId,
            activeConnectionName: figmaContext.activeConnectionName,
            activeTeamId: figmaContext.activeTeamId,
            connected: figmaContext.connected,
            mcpServerUrl: figmaContext.mcpServerUrl,
            patSource: figmaContext.source,
          });
        } catch (err) {
          return jsonResult({
            error: String(err),
            code: "FIGMA_FETCH_FAILED",
            fileKey,
          });
        }
      },
    });

    api.logger.info("[pmos-workspace-tools] Basecamp and Figma tools registered (5 tools)");
  },
};
