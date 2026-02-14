/**
 * Gateway Router
 * Routes tool calls to appropriate services (PMOS, Flow, BCGPT)
 */

import fetch from 'node-fetch';

const PMOS_URL = process.env.PMOS_URL || 'http://localhost:10001';
const FLOW_URL = process.env.FLOW_URL || 'https://flow.wickedlab.io';

/**
 * Forward MCP tool call to another service
 */
async function forwardToolCall(targetUrl, toolName, args) {
  try {
    const response = await fetch(`${targetUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
export async function routeToolCall(toolName, args) {
  // PMOS tools (intelligence layer)
  if (toolName.startsWith('pmos_')) {
    console.log(`[Gateway] Routing ${toolName} to PMOS`);
    return await forwardToolCall(PMOS_URL, toolName, args);
  }
  
  // Flow tools are handled locally in BCGPT (native Activepieces integration)
  // BCGPT tools (data layer) - handled by caller
  return null;
}

/**
 * Check if a tool should be routed to another service
 */
export function shouldRoute(toolName) {
  return toolName.startsWith('pmos_');
}

export default { routeToolCall, shouldRoute };
