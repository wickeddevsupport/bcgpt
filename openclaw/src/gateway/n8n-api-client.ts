/**
 * n8n API Client
 *
 * Provides a clean interface for n8n REST API operations.
 * Used by chat-to-workflow, live-flow-builder, and other modules.
 */

import { getOwnerCookie } from "./n8n-auth-bridge.js";
import { readWorkspaceConnectors } from "./workspace-connectors.js";
import { readLocalN8nConfig } from "./pmos-ops-proxy.js";

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    typeVersion: number;
    position: [number, number];
    parameters?: Record<string, unknown>;
  }>;
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  staticData?: unknown;
  tags?: Array<string | { id: string; name?: string }>;
  triggerCount?: number;
  updatedAt?: string;
  versionId?: string;
}

export interface N8nExecution {
  id: string;
  finished: boolean;
  mode: string;
  retryOf?: string;
  retrySuccessId?: string;
  startedAt: string;
  stoppedAt?: string;
  workflowId: string;
  workflowName?: string;
  status: 'running' | 'success' | 'failed' | 'canceled' | 'crashed' | 'waiting';
  data?: {
    resultData?: {
      runData?: Record<string, unknown>;
      lastNodeExecuted?: string;
      error?: unknown;
    };
  };
}

export interface N8nTag {
  id: string;
  name: string;
}

/**
 * Get the n8n base URL and auth cookie for a workspace
 */
async function getN8nContext(workspaceId: string): Promise<{
  baseUrl: string;
  cookie: string | null;
  apiKey: string | null;
}> {
  const localN8n = readLocalN8nConfig();
  const baseUrl = localN8n?.url || process.env.OPS_URL || "https://ops.wickedlab.io";
  
  // Try workspace-scoped credentials first
  const wc = await readWorkspaceConnectors(workspaceId);
  const opsUser = wc?.ops?.user as { email?: string; password?: string } | undefined;
  const opsApiKey = wc?.ops?.apiKey as string | undefined;
  
  let cookie: string | null = null;
  
  if (opsUser?.email && opsUser?.password && localN8n) {
    // Login with workspace credentials
    try {
      const loginRes = await fetch(`${baseUrl}/rest/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: opsUser.email, password: opsUser.password }),
        redirect: "manual",
      });
      
      const setCookies = loginRes.headers.getSetCookie?.() || [];
      if (setCookies.length > 0) {
        cookie = setCookies.map(c => c.split(";")[0]).join("; ");
      }
    } catch {
      // Fall back to owner cookie or API key
    }
  }
  
  // Fall back to owner cookie
  if (!cookie && localN8n) {
    cookie = await getOwnerCookie(baseUrl);
  }
  
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    cookie,
    apiKey: opsApiKey?.trim() || null,
  };
}

/**
 * Create a workflow in n8n
 */
export async function createN8nWorkflow(
  workspaceId: string,
  workflow: Omit<N8nWorkflow, 'id'>,
): Promise<{ ok: boolean; workflow?: N8nWorkflow; error?: string }> {
  const { baseUrl, cookie, apiKey } = await getN8nContext(workspaceId);
  
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "accept": "application/json",
  };
  
  if (cookie) {
    headers["Cookie"] = cookie;
  } else if (apiKey) {
    headers["X-N8N-API-KEY"] = apiKey;
  } else {
    return { ok: false, error: "No n8n authentication available" };
  }
  
  try {
    const res = await fetch(`${baseUrl}/rest/workflows`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...workflow,
        active: false, // Ensure workflows are created inactive
      }),
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `n8n API error: ${res.status} ${text.slice(0, 200)}` };
    }
    
    const data = await res.json() as { id?: string; data?: { id: string } };
    const createdId = data.id || data.data?.id;
    
    if (!createdId) {
      return { ok: false, error: "n8n did not return workflow ID" };
    }
    
    return {
      ok: true,
      workflow: {
        ...workflow,
        id: createdId,
      },
    };
  } catch (err) {
    return { ok: false, error: `Failed to create workflow: ${err}` };
  }
}

/**
 * Update a workflow in n8n
 */
export async function updateN8nWorkflow(
  workspaceId: string,
  workflowId: string,
  updates: Partial<N8nWorkflow>,
): Promise<{ ok: boolean; workflow?: N8nWorkflow; error?: string }> {
  const { baseUrl, cookie, apiKey } = await getN8nContext(workspaceId);
  
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "accept": "application/json",
  };
  
  if (cookie) {
    headers["Cookie"] = cookie;
  } else if (apiKey) {
    headers["X-N8N-API-KEY"] = apiKey;
  } else {
    return { ok: false, error: "No n8n authentication available" };
  }
  
  try {
    const res = await fetch(`${baseUrl}/rest/workflows/${workflowId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(updates),
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `n8n API error: ${res.status} ${text.slice(0, 200)}` };
    }
    
    const data = await res.json() as N8nWorkflow | { data?: N8nWorkflow };
    const workflow = 'data' in data ? data.data : data;
    
    return { ok: true, workflow };
  } catch (err) {
    return { ok: false, error: `Failed to update workflow: ${err}` };
  }
}

/**
 * Get a workflow from n8n
 */
export async function getN8nWorkflow(
  workspaceId: string,
  workflowId: string,
): Promise<{ ok: boolean; workflow?: N8nWorkflow; error?: string }> {
  const { baseUrl, cookie, apiKey } = await getN8nContext(workspaceId);
  
  const headers: Record<string, string> = {
    "accept": "application/json",
  };
  
  if (cookie) {
    headers["Cookie"] = cookie;
  } else if (apiKey) {
    headers["X-N8N-API-KEY"] = apiKey;
  } else {
    return { ok: false, error: "No n8n authentication available" };
  }
  
  try {
    const res = await fetch(`${baseUrl}/rest/workflows/${workflowId}`, {
      method: "GET",
      headers,
    });
    
    if (!res.ok) {
      return { ok: false, error: `Workflow not found: ${workflowId}` };
    }
    
    const data = await res.json() as N8nWorkflow | { data?: N8nWorkflow };
    const workflow = 'data' in data ? data.data : data;
    
    return { ok: true, workflow };
  } catch (err) {
    return { ok: false, error: `Failed to get workflow: ${err}` };
  }
}

/**
 * Delete a workflow from n8n
 */
export async function deleteN8nWorkflow(
  workspaceId: string,
  workflowId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { baseUrl, cookie, apiKey } = await getN8nContext(workspaceId);
  
  const headers: Record<string, string> = {
    "accept": "application/json",
  };
  
  if (cookie) {
    headers["Cookie"] = cookie;
  } else if (apiKey) {
    headers["X-N8N-API-KEY"] = apiKey;
  } else {
    return { ok: false, error: "No n8n authentication available" };
  }
  
  try {
    const res = await fetch(`${baseUrl}/rest/workflows/${workflowId}`, {
      method: "DELETE",
      headers,
    });
    
    if (!res.ok && res.status !== 204) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `n8n API error: ${res.status} ${text.slice(0, 200)}` };
    }
    
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Failed to delete workflow: ${err}` };
  }
}

/**
 * Activate or deactivate a workflow
 */
export async function setWorkflowActive(
  workspaceId: string,
  workflowId: string,
  active: boolean,
): Promise<{ ok: boolean; workflow?: N8nWorkflow; error?: string }> {
  return updateN8nWorkflow(workspaceId, workflowId, { active });
}

/**
 * Execute a workflow manually
 */
export async function executeN8nWorkflow(
  workspaceId: string,
  workflowId: string,
): Promise<{ ok: boolean; executionId?: string; error?: string }> {
  const { baseUrl, cookie, apiKey } = await getN8nContext(workspaceId);
  
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "accept": "application/json",
  };
  
  if (cookie) {
    headers["Cookie"] = cookie;
  } else if (apiKey) {
    headers["X-N8N-API-KEY"] = apiKey;
  } else {
    return { ok: false, error: "No n8n authentication available" };
  }
  
  try {
    const res = await fetch(`${baseUrl}/rest/workflows/${workflowId}/execute`, {
      method: "POST",
      headers,
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `n8n API error: ${res.status} ${text.slice(0, 200)}` };
    }
    
    const data = await res.json() as { executionId?: string; data?: { executionId?: string } };
    const executionId = data.executionId || data.data?.executionId;
    
    return { ok: true, executionId };
  } catch (err) {
    return { ok: false, error: `Failed to execute workflow: ${err}` };
  }
}

/**
 * Get execution status
 */
export async function getN8nExecution(
  workspaceId: string,
  executionId: string,
): Promise<{ ok: boolean; execution?: N8nExecution; error?: string }> {
  const { baseUrl, cookie, apiKey } = await getN8nContext(workspaceId);
  
  const headers: Record<string, string> = {
    "accept": "application/json",
  };
  
  if (cookie) {
    headers["Cookie"] = cookie;
  } else if (apiKey) {
    headers["X-N8N-API-KEY"] = apiKey;
  } else {
    return { ok: false, error: "No n8n authentication available" };
  }
  
  try {
    const res = await fetch(`${baseUrl}/rest/executions/${executionId}`, {
      method: "GET",
      headers,
    });
    
    if (!res.ok) {
      return { ok: false, error: `Execution not found: ${executionId}` };
    }
    
    const data = await res.json() as N8nExecution | { data?: N8nExecution };
    const execution = 'data' in data ? data.data : data;
    
    return { ok: true, execution };
  } catch (err) {
    return { ok: false, error: `Failed to get execution: ${err}` };
  }
}

/**
 * List workflows for a workspace
 */
export async function listN8nWorkflows(
  workspaceId: string,
): Promise<{ ok: boolean; workflows?: N8nWorkflow[]; error?: string }> {
  const { baseUrl, cookie, apiKey } = await getN8nContext(workspaceId);
  
  const headers: Record<string, string> = {
    "accept": "application/json",
  };
  
  if (cookie) {
    headers["Cookie"] = cookie;
  } else if (apiKey) {
    headers["X-N8N-API-KEY"] = apiKey;
  } else {
    return { ok: false, error: "No n8n authentication available" };
  }
  
  try {
    const res = await fetch(`${baseUrl}/rest/workflows`, {
      method: "GET",
      headers,
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `n8n API error: ${res.status} ${text.slice(0, 200)}` };
    }
    
    const data = await res.json() as { data?: N8nWorkflow[] } | N8nWorkflow[];
    const workflows = Array.isArray(data) ? data : (data.data || []);
    
    return { ok: true, workflows };
  } catch (err) {
    return { ok: false, error: `Failed to list workflows: ${err}` };
  }
}

/**
 * Cancel a running execution
 */
export async function cancelN8nExecution(
  workspaceId: string,
  executionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { baseUrl, cookie, apiKey } = await getN8nContext(workspaceId);
  
  const headers: Record<string, string> = {
    "accept": "application/json",
  };
  
  if (cookie) {
    headers["Cookie"] = cookie;
  } else if (apiKey) {
    headers["X-N8N-API-KEY"] = apiKey;
  } else {
    return { ok: false, error: "No n8n authentication available" };
  }
  
  try {
    const res = await fetch(`${baseUrl}/rest/executions/${executionId}/stop`, {
      method: "POST",
      headers,
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `n8n API error: ${res.status} ${text.slice(0, 200)}` };
    }
    
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Failed to cancel execution: ${err}` };
  }
}

export default {
  createN8nWorkflow,
  updateN8nWorkflow,
  getN8nWorkflow,
  deleteN8nWorkflow,
  setWorkflowActive,
  executeN8nWorkflow,
  getN8nExecution,
  listN8nWorkflows,
  cancelN8nExecution,
};
