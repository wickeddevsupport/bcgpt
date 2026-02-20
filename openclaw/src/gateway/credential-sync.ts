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
import { getOrCreateWorkspaceN8nCookie } from "./n8n-auth-bridge.js";

const N8N_BASE_URL = (process.env.N8N_LOCAL_URL ?? "http://localhost:5678").replace(/\/+$/, "");

type N8nCredentialType = "openAiApi" | "anthropicApi" | "googlePalmApi";

type ProviderMapping = {
  credentialType: N8nCredentialType;
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

/**
 * Fetch all credentials available in a workspace's n8n instance.
 * Returns all credentials (not just OpenClaw-managed ones).
 */
export async function fetchWorkspaceCredentials(workspaceId: string): Promise<CredentialInfo[]> {
  try {
    return await listN8nCredentials(workspaceId);
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

  // Build reverse map: credentialType → node types that use it
  const credTypeToNodes = new Map<string, string[]>();
  for (const [nodeType, credType] of Object.entries(NODE_CREDENTIAL_MAP)) {
    const list = credTypeToNodes.get(credType) ?? [];
    list.push(nodeType);
    credTypeToNodes.set(credType, list);
  }

  const lines = credentials.map(c => {
    const nodeTypes = credTypeToNodes.get(c.type) ?? [];
    const usedBy = nodeTypes.length > 0
      ? ` — for nodes: ${nodeTypes.map(t => t.split(".").pop()).join(", ")}`
      : "";
    return `  - name: "${c.name}", credentialType: "${c.type}", id: "${c.id}"${usedBy}`;
  });

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
 * Get all credentials from n8n for a workspace, filtered to OpenClaw-managed ones.
 */
async function listN8nCredentials(
  workspaceId: string,
): Promise<Array<{ id: string; name: string; type: string }>> {
  const cookie = await getOrCreateWorkspaceN8nCookie({
    workspaceId,
    n8nBaseUrl: N8N_BASE_URL,
  });

  if (!cookie) return [];

  try {
    const res = await fetch(`${N8N_BASE_URL}/rest/credentials`, {
      headers: {
        Cookie: cookie,
        Accept: "application/json",
      },
    });

    if (!res.ok) return [];

    const data = await res.json() as { data?: Array<{ id: string; name: string; type: string }> };
    return data.data ?? [];
  } catch {
    return [];
  }
}

/**
 * Create a new managed credential in n8n.
 */
async function createN8nCredential(params: {
  workspaceId: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
}): Promise<{ id: string } | null> {
  const cookie = await getOrCreateWorkspaceN8nCookie({
    workspaceId: params.workspaceId,
    n8nBaseUrl: N8N_BASE_URL,
  });
  if (!cookie) return null;

  try {
    const res = await fetch(`${N8N_BASE_URL}/rest/credentials`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name: params.name,
        type: params.type,
        data: params.data,
      }),
    });

    if (!res.ok) return null;
    const result = await res.json() as { data?: { id: string }; id?: string };
    const id = result.data?.id ?? result.id;
    return id ? { id: String(id) } : null;
  } catch {
    return null;
  }
}

/**
 * Update an existing credential in n8n.
 */
async function updateN8nCredential(params: {
  workspaceId: string;
  credentialId: string;
  data: Record<string, unknown>;
}): Promise<boolean> {
  const cookie = await getOrCreateWorkspaceN8nCookie({
    workspaceId: params.workspaceId,
    n8nBaseUrl: N8N_BASE_URL,
  });
  if (!cookie) return false;

  try {
    const res = await fetch(`${N8N_BASE_URL}/rest/credentials/${params.credentialId}`, {
      method: "PATCH",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ data: params.data }),
    });

    return res.ok;
  } catch {
    return false;
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
    const existing = await listN8nCredentials(workspaceId);
    const found = existing.find(c => c.name === name);

    if (found) {
      // Update existing credential
      const updated = await updateN8nCredential({
        workspaceId,
        credentialId: found.id,
        data: credData,
      });
      return updated
        ? { ok: true, action: "updated" }
        : { ok: false, error: "Failed to update n8n credential" };
    } else {
      // Create new credential
      const created = await createN8nCredential({
        workspaceId,
        name,
        type: mapping.credentialType,
        data: credData,
      });
      return created
        ? { ok: true, action: "created" }
        : { ok: false, error: "Failed to create n8n credential" };
    }
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
