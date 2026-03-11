import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  auth as runOAuthFlow,
  UnauthorizedError,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  readWorkspaceConnectors,
  writeWorkspaceConnectors,
  type WorkspaceConnectors,
} from "./workspace-connectors.js";

export const DEFAULT_FIGMA_MCP_SERVER_URL = "https://mcp.figma.com/mcp";
export const DEFAULT_FIGMA_MCP_SCOPE = "mcp:connect";

type StoredFigmaMcpOauth = {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  pendingState?: string;
  discoveryState?: OAuthDiscoveryState;
  redirectUrl?: string;
  updatedAt?: string;
};

type StoredWorkspaceFigmaMcpAuth = {
  mcpServerUrl: string;
  source: string | null;
  hasPersonalAccessToken: boolean;
  oauth: StoredFigmaMcpOauth;
};

type FigmaMcpAuthStartResult =
  | { ok: true; alreadyAuthorized: true; authorizationUrl: null }
  | { ok: true; alreadyAuthorized: false; authorizationUrl: string };

export type FigmaMcpProbeStatus = {
  url: string;
  configured: boolean;
  reachable: boolean | null;
  authOk: boolean;
  authRequired: boolean;
  transport: "streamable_http";
  source: string | null;
  hasPersonalAccessToken: boolean;
  fallbackAvailable: boolean;
  error: string | null;
};

type ProviderOptions = {
  workspaceId: string;
  redirectUrl?: string | null;
  onRedirect?: (url: URL) => void;
};

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

function buildClientMetadata(redirectUrl: string): OAuthClientMetadata {
  return {
    client_name: "PMOS Figma MCP",
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
    scope: DEFAULT_FIGMA_MCP_SCOPE,
  };
}

function readWorkspaceFigmaMcpAuthFromConnectors(connectors: WorkspaceConnectors | null): StoredWorkspaceFigmaMcpAuth {
  const figma = isJsonObject(connectors?.figma) ? connectors.figma : {};
  const auth = isJsonObject(figma.auth) ? figma.auth : {};
  const identity = isJsonObject(figma.identity) ? figma.identity : {};
  const oauth = isJsonObject(auth.mcpOAuth) ? (auth.mcpOAuth as StoredFigmaMcpOauth) : {};
  const personalAccessToken = stringOrNull(auth.personalAccessToken);
  const hasPersonalAccessToken =
    Boolean(personalAccessToken) ||
    auth.hasPersonalAccessToken === true ||
    identity.hasPersonalAccessToken === true;

  return {
    mcpServerUrl: stringOrNull(auth.mcpServerUrl) ?? DEFAULT_FIGMA_MCP_SERVER_URL,
    source: stringOrNull(auth.source),
    hasPersonalAccessToken,
    oauth,
  };
}

async function mutateWorkspaceFigmaMcpAuth(
  workspaceId: string,
  mutate: (connectors: WorkspaceConnectors) => void,
): Promise<void> {
  const connectors = (await readWorkspaceConnectors(workspaceId)) ?? {};
  mutate(connectors);
  await writeWorkspaceConnectors(workspaceId, connectors);
}

async function patchWorkspaceFigmaMcpOauth(
  workspaceId: string,
  patch: Partial<StoredFigmaMcpOauth>,
): Promise<void> {
  await mutateWorkspaceFigmaMcpAuth(workspaceId, (connectors) => {
    const figma = isJsonObject(connectors.figma) ? { ...connectors.figma } : {};
    const auth = isJsonObject(figma.auth) ? { ...figma.auth } : {};
    const oauth = isJsonObject(auth.mcpOAuth) ? { ...auth.mcpOAuth } : {};
    Object.assign(oauth, patch, { updatedAt: new Date().toISOString() });
    auth.mcpOAuth = oauth;
    figma.auth = auth;
    connectors.figma = figma;
  });
}

async function clearWorkspaceFigmaMcpPendingState(workspaceId: string): Promise<void> {
  await mutateWorkspaceFigmaMcpAuth(workspaceId, (connectors) => {
    const figma = isJsonObject(connectors.figma) ? { ...connectors.figma } : {};
    const auth = isJsonObject(figma.auth) ? { ...figma.auth } : {};
    const oauth = isJsonObject(auth.mcpOAuth) ? { ...auth.mcpOAuth } : {};
    delete oauth.pendingState;
    delete oauth.codeVerifier;
    oauth.updatedAt = new Date().toISOString();
    auth.mcpOAuth = oauth;
    figma.auth = auth;
    connectors.figma = figma;
  });
}

async function invalidateWorkspaceFigmaMcpCredentials(
  workspaceId: string,
  scope: "all" | "client" | "tokens" | "verifier" | "discovery",
): Promise<void> {
  await mutateWorkspaceFigmaMcpAuth(workspaceId, (connectors) => {
    const figma = isJsonObject(connectors.figma) ? { ...connectors.figma } : {};
    const auth = isJsonObject(figma.auth) ? { ...figma.auth } : {};
    const oauth = isJsonObject(auth.mcpOAuth) ? { ...auth.mcpOAuth } : {};
    if (scope === "all" || scope === "client") {
      delete oauth.clientInformation;
    }
    if (scope === "all" || scope === "tokens") {
      delete oauth.tokens;
    }
    if (scope === "all" || scope === "verifier") {
      delete oauth.codeVerifier;
      delete oauth.pendingState;
    }
    if (scope === "all" || scope === "discovery") {
      delete oauth.discoveryState;
    }
    oauth.updatedAt = new Date().toISOString();
    auth.mcpOAuth = oauth;
    figma.auth = auth;
    connectors.figma = figma;
  });
}

class WorkspaceFigmaOAuthProvider implements OAuthClientProvider {
  readonly clientMetadataUrl = undefined;

  constructor(private readonly options: ProviderOptions) {}

  get redirectUrl(): string | undefined {
    return this.options.redirectUrl ?? undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    if (!this.options.redirectUrl) {
      throw new Error("redirectUrl is required for Figma MCP OAuth");
    }
    return buildClientMetadata(this.options.redirectUrl);
  }

  async state(): Promise<string> {
    const stored = await readWorkspaceConnectors(this.options.workspaceId);
    const auth = readWorkspaceFigmaMcpAuthFromConnectors(stored);
    if (auth.oauth.pendingState && auth.oauth.redirectUrl === this.options.redirectUrl) {
      return auth.oauth.pendingState;
    }
    const nextState = `${this.options.workspaceId}:${randomUUID()}`;
    await patchWorkspaceFigmaMcpOauth(this.options.workspaceId, {
      pendingState: nextState,
      redirectUrl: this.options.redirectUrl ?? undefined,
    });
    return nextState;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const stored = await readWorkspaceConnectors(this.options.workspaceId);
    return readWorkspaceFigmaMcpAuthFromConnectors(stored).oauth.clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await patchWorkspaceFigmaMcpOauth(this.options.workspaceId, { clientInformation });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const stored = await readWorkspaceConnectors(this.options.workspaceId);
    return readWorkspaceFigmaMcpAuthFromConnectors(stored).oauth.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await patchWorkspaceFigmaMcpOauth(this.options.workspaceId, {
      tokens,
      redirectUrl: this.options.redirectUrl ?? undefined,
    });
    await clearWorkspaceFigmaMcpPendingState(this.options.workspaceId);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.options.onRedirect?.(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await patchWorkspaceFigmaMcpOauth(this.options.workspaceId, {
      codeVerifier,
      redirectUrl: this.options.redirectUrl ?? undefined,
    });
  }

  async codeVerifier(): Promise<string> {
    const stored = await readWorkspaceConnectors(this.options.workspaceId);
    const codeVerifier = readWorkspaceFigmaMcpAuthFromConnectors(stored).oauth.codeVerifier;
    if (!codeVerifier) {
      throw new Error("Missing Figma MCP PKCE verifier");
    }
    return codeVerifier;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await patchWorkspaceFigmaMcpOauth(this.options.workspaceId, { discoveryState: state });
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const stored = await readWorkspaceConnectors(this.options.workspaceId);
    return readWorkspaceFigmaMcpAuthFromConnectors(stored).oauth.discoveryState;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    await invalidateWorkspaceFigmaMcpCredentials(this.options.workspaceId, scope);
  }
}

async function readWorkspaceFigmaMcpStorage(workspaceId: string): Promise<StoredWorkspaceFigmaMcpAuth> {
  const connectors = await readWorkspaceConnectors(workspaceId);
  return readWorkspaceFigmaMcpAuthFromConnectors(connectors);
}

export async function beginWorkspaceFigmaMcpOAuth(params: {
  workspaceId: string;
  redirectUrl: string;
}): Promise<FigmaMcpAuthStartResult> {
  let authorizationUrl: string | null = null;
  const provider = new WorkspaceFigmaOAuthProvider({
    workspaceId: params.workspaceId,
    redirectUrl: params.redirectUrl,
    onRedirect: (url) => {
      authorizationUrl = url.toString();
    },
  });
  const authState = await readWorkspaceFigmaMcpStorage(params.workspaceId);
  const result = await runOAuthFlow(provider, {
    serverUrl: authState.mcpServerUrl,
    scope: DEFAULT_FIGMA_MCP_SCOPE,
  });
  if (result === "AUTHORIZED") {
    return { ok: true, alreadyAuthorized: true, authorizationUrl: null };
  }
  if (!authorizationUrl) {
    throw new Error("Figma MCP OAuth redirect URL was not provided");
  }
  return { ok: true, alreadyAuthorized: false, authorizationUrl };
}

export async function finishWorkspaceFigmaMcpOAuth(params: {
  workspaceId: string;
  code: string;
  state: string;
}): Promise<void> {
  const stored = await readWorkspaceFigmaMcpStorage(params.workspaceId);
  if (!stored.oauth.pendingState || stored.oauth.pendingState !== params.state) {
    throw new Error("Figma MCP OAuth state mismatch");
  }
  const redirectUrl = stored.oauth.redirectUrl;
  if (!redirectUrl) {
    throw new Error("Figma MCP OAuth redirect URL is missing");
  }
  const provider = new WorkspaceFigmaOAuthProvider({
    workspaceId: params.workspaceId,
    redirectUrl,
  });
  const result = await runOAuthFlow(provider, {
    serverUrl: stored.mcpServerUrl,
    authorizationCode: params.code,
    scope: DEFAULT_FIGMA_MCP_SCOPE,
  });
  if (result !== "AUTHORIZED") {
    throw new Error("Figma MCP OAuth did not complete authorization");
  }
}

function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal ?? AbortSignal.timeout(timeoutMs);
    return fetch(input, { ...init, signal });
  };
}

async function withWorkspaceFigmaMcpClient<T>(
  workspaceId: string,
  run: (client: Client, transport: StreamableHTTPClientTransport) => Promise<T>,
): Promise<T> {
  const stored = await readWorkspaceFigmaMcpStorage(workspaceId);
  const hasStoredOauthState = Boolean(
    stored.oauth.tokens || stored.oauth.clientInformation || stored.oauth.discoveryState,
  );
  const provider = hasStoredOauthState
    ? new WorkspaceFigmaOAuthProvider({
        workspaceId,
        redirectUrl: stored.oauth.redirectUrl ?? undefined,
      })
    : undefined;
  const transport = new StreamableHTTPClientTransport(new URL(stored.mcpServerUrl), {
    authProvider: provider,
    fetch: createTimeoutFetch(15_000),
    requestInit: {
      headers: {
        accept: "application/json, text/event-stream",
      },
    },
  });
  const client = new Client(
    {
      name: "pmos-figma-mcp-client",
      version: "1.0.0",
    },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    return await run(client, transport);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      throw new Error("FIGMA_MCP_AUTH_REQUIRED");
    }
    throw err;
  } finally {
    await transport.close().catch(() => undefined);
  }
}

export async function listWorkspaceFigmaMcpTools(workspaceId: string): Promise<unknown> {
  return withWorkspaceFigmaMcpClient(workspaceId, async (client) => client.listTools());
}

export async function callWorkspaceFigmaMcpTool(params: {
  workspaceId: string;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<unknown> {
  return withWorkspaceFigmaMcpClient(params.workspaceId, async (client) =>
    client.callTool({
      name: params.toolName,
      arguments: params.args,
    }),
  );
}

export async function probeWorkspaceFigmaMcpStatus(workspaceId: string): Promise<FigmaMcpProbeStatus> {
  const stored = await readWorkspaceFigmaMcpStorage(workspaceId);
  try {
    await listWorkspaceFigmaMcpTools(workspaceId);
    return {
      url: stored.mcpServerUrl,
      configured: true,
      reachable: true,
      authOk: true,
      authRequired: false,
      transport: "streamable_http",
      source: stored.source,
      hasPersonalAccessToken: stored.hasPersonalAccessToken,
      fallbackAvailable: stored.hasPersonalAccessToken,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("FIGMA_MCP_AUTH_REQUIRED")) {
      return {
        url: stored.mcpServerUrl,
        configured: true,
        reachable: true,
        authOk: false,
        authRequired: true,
        transport: "streamable_http",
        source: stored.source,
        hasPersonalAccessToken: stored.hasPersonalAccessToken,
        fallbackAvailable: stored.hasPersonalAccessToken,
        error: "Official Figma MCP auth is required in PMOS.",
      };
    }
    const reachable = /\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET)\b|timed out|timeout|fetch failed/i.test(
      message,
    )
      ? false
      : null;
    return {
      url: stored.mcpServerUrl,
      configured: true,
      reachable,
      authOk: false,
      authRequired: false,
      transport: "streamable_http",
      source: stored.source,
      hasPersonalAccessToken: stored.hasPersonalAccessToken,
      fallbackAvailable: stored.hasPersonalAccessToken,
      error: message,
    };
  }
}

export function resolveWorkspaceIdFromFigmaMcpState(state: string): string | null {
  const trimmed = state.trim();
  if (!trimmed) {
    return null;
  }
  const separator = trimmed.indexOf(":");
  if (separator <= 0) {
    return null;
  }
  const workspaceId = trimmed.slice(0, separator).trim();
  return workspaceId || null;
}

export type FigmaMcpConnectUrlParams = {
  basePath: string;
};

export function buildFigmaMcpConnectPath(params: FigmaMcpConnectUrlParams): string {
  const basePath = params.basePath.trim().replace(/\/+$/, "");
  return `${basePath}/api/pmos/auth/figma-mcp/start`;
}
