// API service for PMOS frontend
// In dev, proxy to OpenClaw gateway. In production, same-origin (deployed together).
const API_BASE = import.meta.env.DEV ? '' : '';

// Get stored API key
export function getApiKey(): string | null {
  return localStorage.getItem('pmos_api_key');
}

// Set API key
export function setApiKey(key: string): void {
  localStorage.setItem('pmos_api_key', key);
}

// Clear API key
export function clearApiKey(): void {
  localStorage.removeItem('pmos_api_key');
}

// Make authenticated request
async function apiRequest(
  path: string, 
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = getApiKey();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include', // Include cookies for OAuth
  });
}

// Chat API
export async function sendChatMessage(
  message: string, 
  options: { 
    sessionId?: string;
    projectContext?: string;
  } = {}
): Promise<{
  response: string;
  sessionId: string;
  toolsUsed: string[];
  iterations: number;
}> {
  const response = await apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message,
      sessionId: options.sessionId,
      projectContext: options.projectContext,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  return response.json();
}

// Stream chat message with SSE
export function streamChatMessage(
  message: string,
  options: {
    projectContext?: string;
    onStart?: () => void;
    onTool?: (tool: { name: string; success: boolean }) => void;
    onResponse?: (content: string) => void;
    onError?: (error: string) => void;
    onDone?: (iterations: number) => void;
  } = {}
): () => void {
  const apiKey = getApiKey();
  const params = new URLSearchParams({
    message,
    ...(options.projectContext && { projectContext: options.projectContext }),
  });
  
  const url = `${API_BASE}/api/chat/stream?${params}`;
  const eventSource = new EventSource(
    apiKey ? `${url}&apiKey=${encodeURIComponent(apiKey)}` : url
  );
  
  eventSource.addEventListener('start', () => options.onStart?.());
  
  eventSource.addEventListener('tool', (e) => {
    const data = JSON.parse(e.data);
    options.onTool?.(data);
  });
  
  eventSource.addEventListener('response', (e) => {
    const data = JSON.parse(e.data);
    options.onResponse?.(data.content);
  });
  
  eventSource.addEventListener('error', (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data);
      options.onError?.(data.message);
    } catch {
      options.onError?.('Connection error');
    }
    eventSource.close();
  });
  
  eventSource.addEventListener('done', (e) => {
    const data = JSON.parse(e.data);
    options.onDone?.(data.iterations);
    eventSource.close();
  });
  
  // Return cleanup function
  return () => eventSource.close();
}

// Session API
export async function listChatSessions(): Promise<Array<{
  id: string;
  title: string;
  created_at: string;
}>> {
  const response = await apiRequest('/api/chat/sessions');
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function getChatSession(sessionId: string): Promise<{
  id: string;
  title: string;
  messages: Array<{ role: string; content: string; created_at: string }>;
}> {
  const response = await apiRequest(`/api/chat/sessions/${sessionId}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// Config API
export async function getUserConfig(): Promise<{
  llm_provider?: string;
  llm_api_key?: string;
  default_project_id?: string;
}> {
  const response = await apiRequest('/api/config');
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function updateUserConfig(config: {
  llmProvider?: string;
  llmApiKey?: string;
  defaultProjectId?: string;
}): Promise<void> {
  const response = await apiRequest('/api/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
}

// Health check
export async function checkHealth(): Promise<{
  ok: boolean;
  build: string;
}> {
  const response = await fetch(`${API_BASE}/health`);
  return response.json();
}

// Projects API (via MCP)
export async function listProjects(): Promise<Array<{
  id: string;
  name: string;
  description?: string;
}>> {
  // Use the MCP endpoint directly
  const response = await apiRequest('/mcp', {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'list_projects',
        arguments: {},
      },
      id: Date.now(),
    }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to list projects');
  }
  
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'MCP error');
  }
  
  return data.result?.content?.[0]?.text
    ? JSON.parse(data.result.content[0].text).projects || []
    : [];
}

// ---- PMOS Auth API ----
// Uses cookie-based sessions (pmos_session). Works from any machine/IP.

export interface AuthUser {
  id: string
  name: string
  email: string
  role: string
  workspaceId: string
}

export async function authMe(): Promise<AuthUser | null> {
  const response = await fetch(`${API_BASE}/api/pmos/auth/me`, {
    credentials: 'include',
  })
  if (!response.ok) return null
  const data = await response.json()
  return data.user ?? null
}

export async function authLogin(email: string, password: string): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
  const response = await fetch(`${API_BASE}/api/pmos/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await response.json()
  if (!response.ok) {
    return { ok: false, error: data.error || `Login failed (${response.status})` }
  }
  return { ok: true, user: data.user }
}

export async function authSignup(name: string, email: string, password: string): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
  const response = await fetch(`${API_BASE}/api/pmos/auth/signup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  })
  const data = await response.json()
  if (!response.ok) {
    return { ok: false, error: data.error || `Signup failed (${response.status})` }
  }
  return { ok: true, user: data.user }
}

export async function authLogout(): Promise<void> {
  await fetch(`${API_BASE}/api/pmos/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}
