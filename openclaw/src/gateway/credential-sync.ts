/**
 * Credential Sync — Auto-configure n8n credentials from OpenClaw BYOK keys.
 *
 * When a user saves an AI API key in OpenClaw (via Integrations), this module
 * automatically creates or updates matching credentials in the embedded n8n
 * instance. This means LangChain/AI nodes in n8n workflows can use the user's
 * keys without any manual configuration in the n8n editor.
 *
 * Provider → n8n credential type mapping:
 *   openai     → openAiApi
 *   anthropic  → anthropicApi
 *   google     → googlePalmApi
 *   openrouter → openAiApi  (with custom base URL)
 *   kilo       → openAiApi  (with custom base URL)
 */

import { getKey } from "./byok-store.js";
import {
  createWorkflowEngineConnection as upsertWorkflowConnection,
  listWorkflowEngineConnections as listWorkflowEngineConnectionsViaApi,
} from "./workflow-api-client.js";
import { readWorkspaceConnectors } from "./workspace-connectors.js";

const BASECAMP_ENSURE_SUCCESS_TTL_MS = 30_000;
const BASECAMP_ENSURE_FAILURE_TTL_MS = 5_000;
const basecampEnsureCache = new Map<string, { fingerprint: string; at: number; ok: boolean }>();

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
  const trimmed = raw.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : null;
}

type WorkflowConnectionType = "openAiApi" | "anthropicApi" | "googlePalmApi";

type ProviderMapping = {
  credentialType: WorkflowConnectionType;
  buildData: (apiKey: string, customUrl?: string) => Record<string, unknown>;
};

const PROVIDER_MAPPINGS: Record<string, ProviderMapping> = {
  openai: {
    credentialType: "openAiApi",
    buildData: (apiKey) => ({ apiKey, url: "https://api.openai.com/v1" }),
  },
  anthropic: {
    credentialType: "anthropicApi",
    buildData: (apiKey) => ({ apiKey }),
  },
  google: {
    credentialType: "googlePalmApi",
    buildData: (apiKey) => ({ apiKey }),
  },
  openrouter: {
    credentialType: "openAiApi",
    buildData: (apiKey) => ({ apiKey, url: "https://openrouter.ai/api/v1" }),
  },
  kilo: {
    credentialType: "openAiApi",
    buildData: (apiKey) => ({
      apiKey,
      url: (process.env.KILO_API_URL ?? "https://api.kilo.ai").replace(/\/+$/, "") + "/v1",
    }),
  },
  zai: {
    credentialType: "openAiApi",
    buildData: (apiKey) => ({ apiKey, url: "https://open.bigmodel.cn/api/paas/v4" }),
  },
  azure: {
    credentialType: "openAiApi",
    buildData: (apiKey) => ({ apiKey }),
  },
};

// ── Node type → credential type map (for auto-linking) ────────────────────────

/** Maps n8n node types to the credential type they require. */
const NODE_CREDENTIAL_MAP: Record<string, string> = {
  "n8n-nodes-base.openAi": "openAiApi",
  "n8n-nodes-base.slack": "slackApi",
  "n8n-nodes-base.slackTrigger": "slackApi",
  "n8n-nodes-base.github": "githubApi",
  "n8n-nodes-base.githubTrigger": "githubApi",
  "n8n-nodes-base.gmail": "googleMail",
  "n8n-nodes-base.googleSheets": "googleSheetsOAuth2Api",
  "n8n-nodes-base.googleSheetsRowTrigger": "googleSheetsOAuth2Api",
  "n8n-nodes-base.notion": "notionApi",
  "n8n-nodes-base.airtable": "airtableApi",
  "n8n-nodes-base.postgres": "postgres",
  "n8n-nodes-base.mysql": "mySql",
  "n8n-nodes-base.redis": "redis",
  "n8n-nodes-base.microsoftTeams": "microsoftTeamsOAuth2Api",
  "n8n-nodes-base.discord": "discordWebhookApi",
  "n8n-nodes-base.telegramBot": "telegramApi",
  "n8n-nodes-base.hubspot": "hubspotApi",
  "n8n-nodes-base.salesforce": "salesforceOAuth2Api",
  "n8n-nodes-base.linear": "linearApi",
  "n8n-nodes-base.jira": "jiraSoftwareCloudApi",
  "n8n-nodes-base.trello": "trelloApi",
  "n8n-nodes-base.asana": "asanaApi",
  "n8n-nodes-base.emailReadImap": "imap",
  "n8n-nodes-base.emailSend": "smtp",
  "n8n-nodes-base.pipedrive": "pipedriveApi",
  "n8n-nodes-basecamp.basecamp": "basecampApi",
  "n8n-nodes-basecamp.basecampTrigger": "basecampApi",
};

// ── Public credential info type ────────────────────────────────────────────────

export type CredentialInfo = { id: string; name: string; type: string };
export type BasecampCredentialEnsureResult = {
  configured: boolean;
  ok: boolean;
  credentialId?: string;
  error?: string;
  skippedReason?: "missing_api_key";
};

async function resolveBasecampConnectorConfig(
  workspaceId: string,
): Promise<{ baseUrl: string; apiKey: string } | null> {
  const wc = await readWorkspaceConnectors(workspaceId).catch(() => null);

  const workspaceBaseUrl = normalizeBaseUrl(
    typeof wc?.bcgpt?.url === "string" ? wc.bcgpt.url : null,
  );
  const baseUrl = workspaceBaseUrl ?? "https://bcgpt.wickedlab.io";

  const workspaceApiKey =
    typeof wc?.bcgpt?.apiKey === "string" ? wc.bcgpt.apiKey.trim() : null;
  const apiKey = (workspaceApiKey ?? "").trim();
  if (!apiKey) {
    return null;
  }

  return { baseUrl, apiKey };
}

/**
 * Ensure Basecamp credential (basecampApi) exists in workspace n8n using configured connector key.
 * Best-effort and cached to avoid repeated upserts on every request.
 */
export async function ensureWorkspaceBasecampCredential(
  workspaceId: string,
): Promise<BasecampCredentialEnsureResult> {
  const cfg = await resolveBasecampConnectorConfig(workspaceId);
  if (!cfg) {
    return {
      configured: false,
      ok: false,
      skippedReason: "missing_api_key",
    };
  }

  const fingerprint = `${cfg.baseUrl}|${cfg.apiKey.length}|${cfg.apiKey.slice(-6)}`;
  const cached = basecampEnsureCache.get(workspaceId);
  const now = Date.now();
  if (cached && cached.fingerprint === fingerprint) {
    const ttl = cached.ok ? BASECAMP_ENSURE_SUCCESS_TTL_MS : BASECAMP_ENSURE_FAILURE_TTL_MS;
    if (now - cached.at < ttl) {
      return {
        configured: true,
        ok: cached.ok,
        ...(cached.ok ? {} : { error: "Basecamp connection sync is still retrying." }),
      };
    }
  }

  try {
    // Ensure the workspace's AP user exists (self-healing: re-run parity if needed).
    // This prevents sign-in failures inside upsertBasecampWorkflowConnection from falling
    // back to the platform API key and creating the connection in the wrong project.
    try {
      const wc = await readWorkspaceConnectors(workspaceId).catch(() => null);
      const userEmail = wc?.ops?.user?.email?.trim() || null;
      const userPassword = wc?.ops?.user?.password || null;
      const opsUrl = normalizeBaseUrl(wc?.ops?.url ?? null);
      if (userEmail && userPassword && opsUrl) {
        const { ensureActivepiecesCredentialParity } = await import("./pmos-auth-http.js");
        await ensureActivepiecesCredentialParity({
          baseUrl: opsUrl,
          email: userEmail,
          password: userPassword,
        }).catch(() => undefined);
      }
    } catch {
      // best-effort user parity — never block the main sync
    }

    const { upsertBasecampWorkflowConnection } = await import("./workflow-api-client.js");
    const result = await upsertBasecampWorkflowConnection(workspaceId, cfg.apiKey);
    const ok = Boolean(result.ok);
    if (!ok) {
      console.warn(
        `[credential-sync] Basecamp connection sync failed for workspace ${workspaceId}: ${result.error ?? "unknown error"}`,
      );
    }
    basecampEnsureCache.set(workspaceId, { fingerprint, at: now, ok });
    return {
      configured: true,
      ok,
      ...(result.credentialId ? { credentialId: result.credentialId } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[credential-sync] Basecamp connection sync threw for workspace ${workspaceId}: ${errorMsg}`,
    );
    basecampEnsureCache.set(workspaceId, { fingerprint, at: now, ok: false });
    return {
      configured: true,
      ok: false,
      error: errorMsg,
    };
  }
}

/**
 * Fetch all credentials available in a workspace's n8n instance.
 * Returns all credentials (not just OpenClaw-managed ones).
 */
export async function fetchWorkspaceCredentials(workspaceId: string): Promise<CredentialInfo[]> {
  try {
    await ensureWorkspaceBasecampCredential(workspaceId);
    return await listWorkflowConnections(workspaceId);
  } catch {
    return [];
  }
}

/**
 * Build a credential context string to inject into the AI system prompt.
 * Tells the AI which credentials are available so it can reference them in workflows.
 */
export function buildCredentialContext(credentials: CredentialInfo[]): string {
  if (credentials.length === 0) return "";
  const visibleCredentials = credentials.slice(0, 16);

  // Build reverse map: credentialType → node types that use it
  const credTypeToNodes = new Map<string, string[]>();
  for (const [nodeType, credType] of Object.entries(NODE_CREDENTIAL_MAP)) {
    const list = credTypeToNodes.get(credType) ?? [];
    list.push(nodeType);
    credTypeToNodes.set(credType, list);
  }

  const lines = visibleCredentials.map(c => {
    const nodeTypes = credTypeToNodes.get(c.type) ?? [];
    const usedBy = nodeTypes.length > 0
      ? ` — for nodes: ${nodeTypes.map(t => t.split(".").pop()).join(", ")}`
      : "";
    return `  - name: "${c.name}", credentialType: "${c.type}", id: "${c.id}"${usedBy}`;
  });
  if (credentials.length > visibleCredentials.length) {
    lines.push(`  - ... plus ${credentials.length - visibleCredentials.length} more credentials already connected`);
  }

  return `
## Available Workspace Credentials
The following credentials are already configured in this workspace.
When building workflows that use these services, ALWAYS include the credential in the node JSON.
Format: "credentials": { "<credentialType>": { "id": "<id>", "name": "<name>" } }

${lines.join("\n")}

Example — linking OpenAI credential to a node:
  "credentials": { "openAiApi": { "id": "123", "name": "OpenClaw - Openai" } }

ALWAYS use the exact id and name shown above when the service matches a node type.`;
}

/**
 * Auto-link credentials to workflow nodes based on node type.
 * Called after AI generates a workflow — injects credential IDs into nodes
 * that don't already have credentials set.
 */
export function autoLinkNodeCredentials(
  nodes: Array<Record<string, unknown>>,
  credentials: CredentialInfo[],
): Array<Record<string, unknown>> {
  if (credentials.length === 0) return nodes;

  // Build map: credentialType → first matching credential
  const credByType = new Map<string, CredentialInfo>();
  for (const cred of credentials) {
    if (!credByType.has(cred.type)) {
      credByType.set(cred.type, cred);
    }
  }

  return nodes.map(node => {
    const nodeType = node.type as string | undefined;
    if (!nodeType) return node;

    const credType = NODE_CREDENTIAL_MAP[nodeType];
    if (!credType) return node;

    const cred = credByType.get(credType);
    if (!cred) return node;

    // Skip if node already has credentials configured
    const existing = node.credentials as Record<string, unknown> | undefined;
    if (existing && Object.keys(existing).length > 0) return node;

    return {
      ...node,
      credentials: {
        [credType]: { id: cred.id, name: cred.name },
      },
    };
  });
}

/**
 * The credential name convention we use in n8n.
 * Using a predictable name allows upsert (find-then-update or create).
 */
function credentialName(provider: string): string {
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
  return `OpenClaw - ${providerLabel}`;
}

/**
 * Get all credentials from workflow engine for a workspace.
 */
async function listWorkflowConnections(
  workspaceId: string,
): Promise<Array<{ id: string; name: string; type: string }>> {
  try {
    const result = await listWorkflowEngineConnectionsViaApi(workspaceId);
    return result.ok ? (result.credentials ?? []) : [];
  } catch {
    return [];
  }
}

/**
 * Upsert a managed credential in workflow engine.
 */
async function createWorkflowConnection(params: {
  workspaceId: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
}): Promise<{ id: string } | null> {
  try {
    const result = await upsertWorkflowConnection(
      params.workspaceId,
      params.name,
      params.type,
      params.data,
    );
    if (!result.ok) {
      return null;
    }
    return result.credentialId ? { id: result.credentialId } : { id: "" };
  } catch {
    return null;
  }
}

/**
 * Sync a BYOK key to n8n credentials.
 *
 * Called after a user saves a BYOK key in OpenClaw.
 * Creates or updates the matching n8n credential automatically.
 * Errors are logged but not thrown — credential sync is best-effort.
 */
export async function syncByokToN8n(
  workspaceId: string,
  provider: string,
): Promise<{ ok: boolean; action?: "created" | "updated" | "skipped"; error?: string }> {
  const mapping = PROVIDER_MAPPINGS[provider];
  if (!mapping) {
    // Provider not mapped to n8n credentials — that's OK
    return { ok: true, action: "skipped" };
  }

  const apiKey = await getKey(workspaceId, provider as import("./byok-store.js").AIProvider);
  if (!apiKey) {
    return { ok: false, error: `No key stored for provider: ${provider}` };
  }

  const name = credentialName(provider);
  const credData = mapping.buildData(apiKey);

  try {
    // Find existing credential by name
    const existing = await listWorkflowConnections(workspaceId);
    const found = existing.find((c) => c.name === name);

    const created = await createWorkflowConnection({
      workspaceId,
      name,
      type: mapping.credentialType,
      data: credData,
    });
    return created
      ? { ok: true, action: found ? "updated" : "created" }
      : { ok: false, error: "Failed to upsert workflow-engine credential" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[credential-sync] Failed to sync ${provider} for workspace ${workspaceId}: ${msg}`);
    return { ok: false, error: msg };
  }
}

/**
 * Sync ALL configured BYOK keys for a workspace to n8n.
 * Call this on workspace init / login to ensure credentials are always in sync.
 */
export async function syncAllByokToN8n(workspaceId: string): Promise<void> {
  const providers = Object.keys(PROVIDER_MAPPINGS);
  await Promise.allSettled(
    providers.map(provider => syncByokToN8n(workspaceId, provider)),
  );
}
