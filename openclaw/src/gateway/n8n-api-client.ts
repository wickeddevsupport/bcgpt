/**
 * n8n API Client
 *
 * Provides a clean interface for n8n REST API operations.
 * Used by chat-to-workflow, live-flow-builder, and other modules.
 */

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
  hasWorkspaceCredentials: boolean;
}> {
  const localN8n = readLocalN8nConfig();
  const baseUrl = localN8n?.url || process.env.OPS_URL || "https://ops.wickedlab.io";
  
  // Try workspace-scoped credentials first
  const wc = await readWorkspaceConnectors(workspaceId);
  const opsUser = wc?.ops?.user as { email?: string; password?: string } | undefined;
  const opsApiKey = wc?.ops?.apiKey as string | undefined;
  
  let cookie: string | null = null;
  let hasWorkspaceCredentials = false;
  
  if (opsUser?.email && opsUser?.password && localN8n) {
    hasWorkspaceCredentials = true;
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
      // Fall back to API key if login fails
    }
  }
  
  // Use workspace API key if available
  if (opsApiKey?.trim()) {
    hasWorkspaceCredentials = true;
  }
  
  // DO NOT fall back to owner cookie - workspace isolation must be enforced
  // If no workspace credentials, the caller should inform the user to configure n8n
  
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    cookie,
    apiKey: opsApiKey?.trim() || null,
    hasWorkspaceCredentials,
  };
}

/**
 * Create a workflow in n8n
 */
export async function createN8nWorkflow(
  workspaceId: string,
  workflow: Omit<N8nWorkflow, 'id'>,
): Promise<{ ok: boolean; workflow?: N8nWorkflow; error?: string }> {
  const { baseUrl, cookie, apiKey, hasWorkspaceCredentials } = await getN8nContext(workspaceId);
  
  if (!hasWorkspaceCredentials) {
    return { 
      ok: false, 
      error: "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first." 
    };
  }
  
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
  const { baseUrl, cookie, apiKey, hasWorkspaceCredentials } = await getN8nContext(workspaceId);

  if (!hasWorkspaceCredentials) {
    return { ok: false, error: "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first." };
  }
  
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
  const { baseUrl, cookie, apiKey, hasWorkspaceCredentials } = await getN8nContext(workspaceId);

  if (!hasWorkspaceCredentials) {
    return { ok: false, error: "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first." };
  }
  
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
  const { baseUrl, cookie, apiKey, hasWorkspaceCredentials } = await getN8nContext(workspaceId);

  if (!hasWorkspaceCredentials) {
    return { ok: false, error: "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first." };
  }
  
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
  const { baseUrl, cookie, apiKey, hasWorkspaceCredentials } = await getN8nContext(workspaceId);

  if (!hasWorkspaceCredentials) {
    return { ok: false, error: "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first." };
  }
  
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
  const { baseUrl, cookie, apiKey, hasWorkspaceCredentials } = await getN8nContext(workspaceId);

  if (!hasWorkspaceCredentials) {
    return { ok: false, error: "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first." };
  }
  
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
  const { baseUrl, cookie, apiKey, hasWorkspaceCredentials } = await getN8nContext(workspaceId);

  if (!hasWorkspaceCredentials) {
    return { ok: false, error: "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first." };
  }
  
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
  const { baseUrl, cookie, apiKey, hasWorkspaceCredentials } = await getN8nContext(workspaceId);

  if (!hasWorkspaceCredentials) {
    return { ok: false, error: "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first." };
  }
  
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

/**
 * Upsert the Basecamp credential (basecampApi) in n8n.
 * Creates if not found, updates if already exists.
 * This lets users automatically configure the Basecamp node after saving their BCGPT key.
 */
export async function upsertBasecampCredential(
  workspaceId: string,
  bcgptUrl: string,
  bcgptApiKey: string,
): Promise<{ ok: boolean; credentialId?: string; error?: string }> {
  const { baseUrl, cookie, hasWorkspaceCredentials } = await getN8nContext(workspaceId);

  if (!hasWorkspaceCredentials) {
    return { ok: false, error: "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first." };
  }

  if (!cookie) {
    return { ok: false, error: "n8n not reachable or not authenticated" };
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "accept": "application/json",
    "Cookie": cookie,
  };

  // Fetch existing credentials to see if basecampApi already exists
  let existingId: string | null = null;
  try {
    const listRes = await fetch(`${baseUrl}/rest/credentials`, { method: "GET", headers });
    if (listRes.ok) {
      const listData = await listRes.json() as { data?: Array<{ id: string; type: string; name: string }> } | Array<{ id: string; type: string; name: string }>;
      const list = Array.isArray(listData) ? listData : (listData.data ?? []);
      const found = list.find((c) => c.type === "basecampApi");
      if (found) existingId = found.id;
    }
  } catch {
    // ignore list error — will try create
  }

  const credentialBody = {
    name: "Basecamp (OpenClaw)",
    type: "basecampApi",
    data: { baseUrl: bcgptUrl, apiKey: bcgptApiKey },
  };

  try {
    if (existingId) {
      const res = await fetch(`${baseUrl}/rest/credentials/${existingId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ data: credentialBody.data }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `Failed to update credential: ${res.status} ${text.slice(0, 200)}` };
      }
      return { ok: true, credentialId: existingId };
    } else {
      const res = await fetch(`${baseUrl}/rest/credentials`, {
        method: "POST",
        headers,
        body: JSON.stringify(credentialBody),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: `Failed to create credential: ${res.status} ${text.slice(0, 200)}` };
      }
      const data = await res.json() as { id?: string; data?: { id: string } };
      const credentialId = data.id || data.data?.id;
      return { ok: true, credentialId };
    }
  } catch (err) {
    return { ok: false, error: `Credential upsert failed: ${err}` };
  }
}

/**
 * List all credentials in n8n
 */
export async function listN8nCredentials(
  workspaceId: string,
): Promise<{ ok: boolean; credentials?: Array<{ id: string; name: string; type: string }>; error?: string }> {
  const { baseUrl, cookie, hasWorkspaceCredentials } = await getN8nContext(workspaceId);

  if (!hasWorkspaceCredentials) {
    return { ok: false, error: "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first." };
  }

  if (!cookie) {
    return { ok: false, error: "n8n not reachable or not authenticated" };
  }

  try {
    const res = await fetch(`${baseUrl}/rest/credentials`, {
      method: "GET",
      headers: {
        "accept": "application/json",
        "Cookie": cookie,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Failed to list credentials: ${res.status} ${text.slice(0, 200)}` };
    }

    const data = await res.json() as { data?: Array<{ id: string; name: string; type: string }> } | Array<{ id: string; name: string; type: string }>;
    const credentials = Array.isArray(data) ? data : (data.data ?? []);
    return { ok: true, credentials };
  } catch (err) {
    return { ok: false, error: `Failed to list credentials: ${err}` };
  }
}

/**
 * Create a credential in n8n
 */
export async function createN8nCredential(
  workspaceId: string,
  name: string,
  type: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; credentialId?: string; error?: string }> {
  const { baseUrl, cookie, hasWorkspaceCredentials } = await getN8nContext(workspaceId);

  if (!hasWorkspaceCredentials) {
    return { ok: false, error: "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first." };
  }

  if (!cookie) {
    return { ok: false, error: "n8n not reachable or not authenticated" };
  }

  try {
    const res = await fetch(`${baseUrl}/rest/credentials`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "Cookie": cookie,
      },
      body: JSON.stringify({ name, type, data }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Failed to create credential: ${res.status} ${text.slice(0, 200)}` };
    }

    const respData = await res.json() as { id?: string; data?: { id: string } };
    const credentialId = respData.id || respData.data?.id;
    return { ok: true, credentialId };
  } catch (err) {
    return { ok: false, error: `Failed to create credential: ${err}` };
  }
}

/**
 * Delete a credential in n8n
 */
export async function deleteN8nCredential(
  workspaceId: string,
  credentialId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { baseUrl, cookie, hasWorkspaceCredentials } = await getN8nContext(workspaceId);

  if (!hasWorkspaceCredentials) {
    return { ok: false, error: "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first." };
  }

  if (!cookie) {
    return { ok: false, error: "n8n not reachable or not authenticated" };
  }

  try {
    const res = await fetch(`${baseUrl}/rest/credentials/${credentialId}`, {
      method: "DELETE",
      headers: {
        "accept": "application/json",
        "Cookie": cookie,
      },
    });

    if (!res.ok && res.status !== 204) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Failed to delete credential: ${res.status} ${text.slice(0, 200)}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Failed to delete credential: ${err}` };
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
  upsertBasecampCredential,
};
