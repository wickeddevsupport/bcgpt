/**
 * n8n API Client
 *
 * Provides a clean interface for n8n REST API operations.
 * Used by chat-to-workflow, live-flow-builder, and other modules.
 */

import { readWorkspaceConnectors, writeWorkspaceConnectors } from "./workspace-connectors.js";
import { readLocalN8nConfig } from "./pmos-ops-proxy.js";
import { getOrCreateWorkspaceN8nCookie } from "./n8n-auth-bridge.js";
import { loadConfig } from "../config/config.js";

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

export interface N8nNodeType {
  name: string;
  displayName?: string;
  description?: string;
}

function readConfigString(cfg: unknown, path: string[]): string | null {
  let current: unknown = cfg;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== "string") {
    return null;
  }
  const trimmed = current.trim();
  return trimmed ? trimmed : null;
}

function normalizeBaseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  return value.replace(/\/+$/, "");
}

function resolveGlobalOpsUrlFromConfig(): string | null {
  const cfg = loadConfig() as unknown;
  return normalizeBaseUrl(readConfigString(cfg, ["pmos", "connectors", "ops", "url"]));
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
  const wc = await readWorkspaceConnectors(workspaceId);
  const workspaceOpsUrl = normalizeBaseUrl(
    typeof wc?.ops?.url === "string" ? wc.ops.url : null,
  );
  const localN8n = readLocalN8nConfig();
  const baseUrl =
    workspaceOpsUrl ??
    normalizeBaseUrl(localN8n?.url ?? null) ??
    resolveGlobalOpsUrlFromConfig() ??
    "https://ops.wickedlab.io";
  
  // Use the auto-provisioning flow from n8n-auth-bridge
  // This will create workspace credentials if they don't exist yet
  const cookie = await getOrCreateWorkspaceN8nCookie({ 
    workspaceId, 
    n8nBaseUrl: baseUrl 
  });
  
  // Also check for API key
  const opsApiKey = wc?.ops?.apiKey as string | undefined;
  
  const hasWorkspaceCredentials = Boolean(cookie || opsApiKey?.trim());
  
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
 * List node types available in n8n for a workspace.
 * This uses workspace authentication and includes custom nodes loaded in that runtime.
 */
function parseNodeTypeRows(payload: unknown): Array<{ row: Record<string, unknown>; fallbackName?: string }> {
  const rows: Array<{ row: Record<string, unknown>; fallbackName?: string }> = [];

  if (Array.isArray(payload)) {
    for (const value of payload) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        rows.push({ row: value as Record<string, unknown> });
      }
    }
    return rows;
  }

  if (!payload || typeof payload !== "object") {
    return rows;
  }

  const obj = payload as Record<string, unknown>;
  const listFields = ["data", "nodeTypes", "types", "items"];
  for (const key of listFields) {
    const value = obj[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        rows.push({ row: entry as Record<string, unknown> });
      }
    }
  }
  if (rows.length > 0) {
    return rows;
  }

  const mapSource =
    obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)
      ? (obj.data as Record<string, unknown>)
      : obj;
  for (const [name, value] of Object.entries(mapSource)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    rows.push({
      row: value as Record<string, unknown>,
      fallbackName: name,
    });
  }

  return rows;
}

function parseN8nNodeTypes(payload: unknown): N8nNodeType[] {
  const rows = parseNodeTypeRows(payload);
  const byName = new Map<string, N8nNodeType>();

  for (const { row, fallbackName } of rows) {
    const nameCandidate =
      (typeof row.name === "string" && row.name.trim()) ||
      (fallbackName && fallbackName.trim()) ||
      "";
    if (!nameCandidate || byName.has(nameCandidate)) {
      continue;
    }

    byName.set(nameCandidate, {
      name: nameCandidate,
      displayName: typeof row.displayName === "string" ? row.displayName : undefined,
      description: typeof row.description === "string" ? row.description : undefined,
    });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listN8nNodeTypes(
  workspaceId: string,
): Promise<{ ok: boolean; nodeTypes?: N8nNodeType[]; error?: string }> {
  const { baseUrl, cookie, apiKey, hasWorkspaceCredentials } = await getN8nContext(workspaceId);

  if (!hasWorkspaceCredentials) {
    return {
      ok: false,
      error:
        "No n8n credentials configured for your workspace. Please go to Integrations and configure your n8n connection first.",
    };
  }

  const authVariants: Array<{ label: "cookie" | "apiKey"; headers: Record<string, string> }> = [];
  if (cookie) {
    authVariants.push({ label: "cookie", headers: { Cookie: cookie } });
  }
  if (apiKey) {
    authVariants.push({ label: "apiKey", headers: { "X-N8N-API-KEY": apiKey } });
  }
  if (authVariants.length === 0) {
    return { ok: false, error: "No n8n authentication available" };
  }

  const endpointVariants: Array<{ path: string; cookieOnly?: boolean }> = [
    { path: "/rest/node-types" },
    // n8n UI catalog endpoint in recent versions (cookie auth).
    { path: "/types/nodes.json", cookieOnly: true },
    { path: "/api/v1/node-types" },
    { path: "/rest/types/nodes" },
  ];

  const attempts: string[] = [];
  for (const endpoint of endpointVariants) {
    for (const auth of authVariants) {
      if (endpoint.cookieOnly && auth.label !== "cookie") {
        continue;
      }
      try {
        const res = await fetch(`${baseUrl}${endpoint.path}`, {
          method: "GET",
          headers: {
            accept: "application/json",
            ...auth.headers,
          },
        });
        const text = await res.text().catch(() => "");
        attempts.push(`${endpoint.path}(${auth.label})=${res.status}`);
        if (!res.ok) {
          continue;
        }

        let payload: unknown = null;
        try {
          payload = text ? (JSON.parse(text) as unknown) : null;
        } catch {
          payload = null;
        }
        const nodeTypes = parseN8nNodeTypes(payload);
        if (nodeTypes.length > 0) {
          return { ok: true, nodeTypes };
        }
      } catch (err) {
        attempts.push(`${endpoint.path}(${auth.label})=ERR:${String(err).slice(0, 80)}`);
      }
    }
  }

  return {
    ok: false,
    error: `Failed to list node types. Tried ${attempts.join(", ") || "no endpoints"}`,
  };
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
  listN8nNodeTypes,
  cancelN8nExecution,
  upsertBasecampCredential,
};
