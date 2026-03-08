/**
 * PMOS MCP HTTP handler
 *
 * Exposes workflow tools (pmos_ops_*) as MCP-compatible endpoints for the
 * bcgpt gateway router. Legacy `pmos_n8n_*` aliases are still accepted.
 *
 * Auth: x-session-key header (PMOS session token set by gateway-router.js)
 * Protocol: JSON-RPC 2.0 MCP tools/call
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { resolvePmosSessionFromToken } from "./pmos-auth.js";
import {
  createWorkflowEngineWorkflow,
  executeWorkflowEngineWorkflow,
  getWorkflowEngineWorkflow,
  listWorkflowEngineConnections,
  listWorkflowEngineNodeTypes,
  listWorkflowEngineWorkflows,
} from "./workflow-api-client.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += String(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function mcpResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function mcpError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function contentResult(text: string) {
  return { content: [{ type: "text", text }], isError: false };
}

function errorResult(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Handle POST /mcp requests from bcgpt gateway router.
 * Authenticates via x-session-key header, resolves workspaceId, dispatches workflow tools.
 */
export async function handlePmosMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/mcp") {
    return false;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return true;
  }

  // Authenticate via x-session-key header (set by gateway-router.js)
  const sessionKeyRaw = req.headers["x-session-key"];
  const sessionKey = Array.isArray(sessionKeyRaw) ? sessionKeyRaw[0] : sessionKeyRaw;
  if (!sessionKey || typeof sessionKey !== "string" || !sessionKey.trim()) {
    sendJson(res, 401, mcpError(null, -32001, "x-session-key header required"));
    return true;
  }

  const sessionResult = await resolvePmosSessionFromToken(sessionKey.trim());
  if (!sessionResult.ok) {
    sendJson(res, 401, mcpError(null, -32001, sessionResult.error));
    return true;
  }

  const workspaceId = sessionResult.user.workspaceId;
  if (!workspaceId) {
    sendJson(res, 403, mcpError(null, -32002, "No workspaceId for session user"));
    return true;
  }

  const body = await readBody(req);
  if (!body) {
    sendJson(res, 400, mcpError(null, -32700, "Invalid JSON body"));
    return true;
  }

  const { id, method, params } = body as {
    id?: unknown;
    method?: unknown;
    params?: unknown;
  };

  if (method !== "tools/call") {
    sendJson(res, 200, mcpError(id ?? null, -32601, `Method not supported: ${String(method)}`));
    return true;
  }

  const p = params as { name?: unknown; arguments?: unknown } | null | undefined;
  const toolName = typeof p?.name === "string" ? p.name.trim() : "";
  const args =
    p?.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments)
      ? (p.arguments as Record<string, unknown>)
      : {};

  try {
    const result = await dispatchTool(workspaceId, toolName, args);
    sendJson(res, 200, mcpResult(id ?? null, result));
  } catch (err) {
    sendJson(res, 200, mcpResult(id ?? null, errorResult(`Tool error: ${String(err)}`)));
  }

  return true;
}

async function dispatchTool(
  workspaceId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const normalizedToolName = toolName.startsWith("pmos_n8n_")
    ? `pmos_ops_${toolName.slice("pmos_n8n_".length)}`
    : toolName;

  switch (normalizedToolName) {
    case "pmos_ops_list_workflows": {
      const r = await listWorkflowEngineWorkflows(workspaceId);
      if (!r.ok) return errorResult(r.error ?? "Failed to list workflows");
      const summary = (r.workflows ?? []).map((w) => ({
        id: w.id,
        name: w.name,
        active: w.active,
        updatedAt: w.updatedAt,
      }));
      return contentResult(JSON.stringify({ workflows: summary, count: summary.length }, null, 2));
    }

    case "pmos_ops_get_workflow": {
      const wfId = String(args.workflow_id ?? "").trim();
      if (!wfId) return errorResult("workflow_id is required");
      const r = await getWorkflowEngineWorkflow(workspaceId, wfId);
      if (!r.ok) return errorResult(r.error ?? "Failed to get workflow");
      return contentResult(JSON.stringify(r.workflow, null, 2));
    }

    case "pmos_ops_create_workflow": {
      const name = String(args.name ?? "").trim();
      const nodes = Array.isArray(args.nodes) ? args.nodes : [];
      const connections =
        args.connections && typeof args.connections === "object"
          ? (args.connections as Record<string, unknown>)
          : {};
      if (!name) return errorResult("name is required");
      if (!nodes.length) return errorResult("nodes array is required and must not be empty");
      const r = await createWorkflowEngineWorkflow(workspaceId, {
        name,
        active: false,
        nodes: nodes as Parameters<typeof createWorkflowEngineWorkflow>[1]["nodes"],
        connections,
      });
      if (!r.ok) return errorResult(r.error ?? "Failed to create workflow");
      return contentResult(
        `Workflow created successfully!\nID: ${r.workflow?.id}\nName: ${name}\n\nView and edit it in the Automations tab.`,
      );
    }

    case "pmos_ops_execute_workflow": {
      const wfId = String(args.workflow_id ?? "").trim();
      if (!wfId) return errorResult("workflow_id is required");
      const r = await executeWorkflowEngineWorkflow(workspaceId, wfId);
      if (!r.ok) return errorResult(r.error ?? "Failed to execute workflow");
      return contentResult(
        `Workflow executed! Execution ID: ${r.executionId ?? "unknown"}. Check the Automations panel for execution results.`,
      );
    }

    case "pmos_ops_list_credentials": {
      const r = await listWorkflowEngineConnections(workspaceId);
      if (!r.ok) return errorResult(r.error ?? "Failed to list credentials");
      const creds = (r.credentials ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type }));
      return contentResult(JSON.stringify({ credentials: creds, count: creds.length }, null, 2));
    }

    case "pmos_ops_list_node_types": {
      const r = await listWorkflowEngineNodeTypes(workspaceId);
      if (!r.ok) return errorResult(r.error ?? "Failed to list node types");
      // Return condensed list — skip internal/meta nodes
      const allTypes = r.nodeTypes ?? [];
      const useful = allTypes
        .filter(
          (n) =>
            !n.name.endsWith(".noOp") &&
            !n.name.includes("n8n-nodes-base.executionData") &&
            !n.name.includes(".stickyNote"),
        )
        .slice(0, 80);
      return contentResult(
        JSON.stringify(
          {
            nodeTypes: useful.map((n) => ({ name: n.name, displayName: n.displayName })),
            count: useful.length,
            total: allTypes.length,
          },
          null,
          2,
        ),
      );
    }

    case "pmos_web_search": {
      const query = String(args.query ?? "").trim();
      if (!query) return errorResult("query is required");
      const maxResults = typeof args.max_results === "number" ? Math.min(args.max_results, 10) : 5;
      return await duckDuckGoSearch(query, maxResults);
    }

    default:
      return errorResult(
        `Unknown tool: ${toolName}. Supported tools: ` +
          `pmos_ops_list_workflows, pmos_ops_create_workflow, pmos_ops_execute_workflow, ` +
          `pmos_ops_get_workflow, pmos_ops_list_credentials, pmos_ops_list_node_types, ` +
          `pmos_web_search (legacy pmos_n8n_* aliases are also accepted)`,
      );
  }
}

/**
 * DuckDuckGo Lite search — no API key needed.
 * Fetches https://lite.duckduckgo.com/lite/?q=<query> and parses result links.
 * Exported for reuse by other modules (pmos.chat.send, etc.)
 */
export async function duckDuckGoSearch(query: string, maxResults: number): Promise<unknown> {
  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OpenClaw/1.0; +https://wickedlab.io)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return errorResult(`DuckDuckGo search failed: HTTP ${res.status}`);
    }

    const html = await res.text();

    // Parse result links from DuckDuckGo Lite HTML
    // Results are in <a class="result-link"> tags
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const linkRe = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetRe = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

    const links: Array<{ url: string; title: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(html)) !== null && links.length < maxResults) {
      const href = match[1] ?? "";
      const title = match[2] ?? "";
      // DuckDuckGo lite wraps URLs — decode uddg= param
      try {
        const urlObj = new URL(href, "https://lite.duckduckgo.com");
        const realUrl = urlObj.searchParams.get("uddg") ?? urlObj.searchParams.get("u") ?? href;
        links.push({ url: decodeURIComponent(realUrl), title: title.trim() });
      } catch {
        links.push({ url: href, title: title.trim() });
      }
    }

    const snippets: string[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = snippetRe.exec(html)) !== null) {
      const raw = (sm[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (raw) snippets.push(raw);
    }

    for (let i = 0; i < links.length; i++) {
      results.push({
        title: links[i]!.title,
        url: links[i]!.url,
        snippet: snippets[i] ?? "",
      });
    }

    if (!results.length) {
      return contentResult(`No results found for: ${query}`);
    }

    const text = [
      `Search results for: ${query}`,
      "",
      ...results.map(
        (r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`,
      ),
    ].join("\n");

    return contentResult(text);
  } catch (err) {
    return errorResult(`Web search error: ${String(err)}`);
  }
}
