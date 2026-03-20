/**
 * Gateway Router
 * Routes tool calls to appropriate services (PMOS, Flow, BCGPT)
 */

import fetch from 'node-fetch';

const PMOS_URL = process.env.PMOS_URL || 'http://localhost:10001';
const FLOW_URL = process.env.FLOW_URL || 'https://flow.wickedlab.io';
const PMOS_ROUTED_TOOL_NAMES = new Set([
  'pmos_web_search',
]);

function isPmosRemoteTool(toolName) {
  if (typeof toolName !== 'string') return false;
  return (
    toolName.startsWith('pmos_ops_') ||
    toolName.startsWith('pmos_n8n_') ||
    PMOS_ROUTED_TOOL_NAMES.has(toolName)
  );
}

/**
 * Forward MCP tool call to another service
 */
async function forwardToolCall(targetUrl, toolName, args, ctx = {}) {
  try {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (ctx?.apiKey) {
      headers['x-api-key'] = String(ctx.apiKey);
      headers['x-bcgpt-api-key'] = String(ctx.apiKey);
      headers['authorization'] = `Bearer ${ctx.apiKey}`;
    }
    if (ctx?.sessionKey) {
      headers['x-session-key'] = String(ctx.sessionKey);
      headers['x-bcgpt-session-key'] = String(ctx.sessionKey);
    }
    if (ctx?.userKey) {
      headers['x-user-key'] = String(ctx.userKey);
    }

    const response = await fetch(`${targetUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Gateway forward failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`[Gateway] Error forwarding ${toolName} to ${targetUrl}:`, error.message);
    throw error;
  }
}

/**
 * Route tool call to appropriate service based on prefix
 * Returns null if tool should be handled by BCGPT
 */
export async function routeToolCall(toolName, args, ctx = {}) {
  // Only PMOS workflow/ops tools should be forwarded.
  // Basecamp-oriented PMOS tools such as pmos_workspace_sync,
  // pmos_project_sync, and pmos_entity_detail are implemented
  // locally in BCGPT and must not be hijacked here.
  if (isPmosRemoteTool(toolName)) {
    console.log(`[Gateway] Routing ${toolName} to PMOS`);
    return await forwardToolCall(PMOS_URL, toolName, args, ctx);
  }
  
  // Flow tools are handled locally in BCGPT (native Activepieces integration)
  // BCGPT tools (data layer) - handled by caller
  return null;
}

/**
 * Check if a tool should be routed to another service
 */
export function shouldRoute(toolName) {
  return isPmosRemoteTool(toolName);
}

export default { routeToolCall, shouldRoute };
