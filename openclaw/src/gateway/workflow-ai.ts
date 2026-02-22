/**
 * Workflow AI calls the globally configured model from openclaw.json.
 *
 * Source of truth:
 * - agents.defaults.model.primary
 * - models.providers.<provider>.apiKey (with env fallback when missing)
 */

import { getCustomProviderApiKey, resolveEnvApiKey } from "../agents/model-auth.js";
import { loadConfig, type OpenClawConfig } from "../config/config.js";

type Message = { role: "user" | "assistant" | "system"; content: string };

interface ModelConfig {
  provider: string;
  modelId: string;
  apiKey: string;
}

function appendV1(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1`;
}

function resolveKiloBaseUrl(): string {
  const raw = (process.env.KILO_API_URL ?? "https://api.kilo.ai/api/gateway").trim();
  const normalized = raw.replace(/\/+$/, "");
  return normalized.replace(/\/chat\/completions$/, "");
}

function resolveProviderBaseUrlFromConfig(
  cfg: OpenClawConfig,
  provider: string,
): string | null {
  const providers = cfg?.models?.providers as Record<string, unknown> | undefined;
  const entry = providers?.[provider];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const raw = typeof (entry as Record<string, unknown>).baseUrl === "string"
    ? ((entry as Record<string, unknown>).baseUrl as string).trim()
    : "";
  return raw ? raw.replace(/\/+$/, "") : null;
}

function resolveOpenAiCompatibleBaseUrl(provider: string, cfg: OpenClawConfig): string {
  const configuredBaseUrl = resolveProviderBaseUrlFromConfig(cfg, provider);
  if (configuredBaseUrl) {
    // Kilo may be stored with a fully-qualified endpoint; normalize back to base.
    if (provider === "kilo") {
      return configuredBaseUrl.replace(/\/chat\/completions$/, "");
    }
    return configuredBaseUrl;
  }
  switch (provider) {
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "zai":
      return "https://open.bigmodel.cn/api/paas/v4";
    case "kilo":
      // Kilo gateway is OpenAI-compatible at /api/gateway/chat/completions.
      return resolveKiloBaseUrl();
    case "moonshot":
      return appendV1(process.env.MOONSHOT_API_URL ?? "https://api.moonshot.ai");
    case "nvidia":
      return appendV1(process.env.NVIDIA_API_URL ?? "https://integrate.api.nvidia.com");
    case "azure":
      return (
        process.env.AZURE_OPENAI_BASE_URL ??
        process.env.OPENAI_API_BASE_URL ??
        "https://api.openai.com/v1"
      ).replace(/\/+$/, "");
    case "custom":
      return (
        process.env.CUSTOM_OPENAI_BASE_URL ??
        process.env.OPENAI_API_BASE_URL ??
        "https://api.openai.com/v1"
      ).replace(/\/+$/, "");
    case "openai":
    default:
      return "https://api.openai.com/v1";
  }
}

/**
 * Parse "provider/modelId" format stored in agents.defaults.model.primary
 */
function parsePrimaryRef(ref: unknown): { provider: string; modelId: string } | null {
  if (typeof ref !== "string" || !ref.includes("/")) return null;
  const slash = ref.indexOf("/");
  const provider = ref.slice(0, slash).trim();
  const modelId = ref.slice(slash + 1).trim();
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

function resolvePrimaryRefFromConfig(cfg: OpenClawConfig): unknown {
  return cfg?.agents?.defaults?.model?.primary;
}

async function resolveProviderApiKey(
  provider: string,
  cfg: OpenClawConfig,
): Promise<string | null> {
  const configApiKey = getCustomProviderApiKey(cfg, provider);
  if (configApiKey) {
    return configApiKey;
  }
  const envResolved = resolveEnvApiKey(provider);
  const envApiKey = typeof envResolved?.apiKey === "string" ? envResolved.apiKey.trim() : "";
  return envApiKey || null;
}

/**
 * Resolve model config from global openclaw.json. Returns null if no usable model is configured.
 */
async function resolveModelConfig(cfg: OpenClawConfig): Promise<ModelConfig | null> {
  const parsed = parsePrimaryRef(resolvePrimaryRefFromConfig(cfg));
  if (!parsed) return null;
  const apiKey = await resolveProviderApiKey(parsed.provider, cfg);
  if (!apiKey) return null;
  return { provider: parsed.provider, modelId: parsed.modelId, apiKey };
}

/**
 * Call the globally configured model with a system prompt + messages.
 * Returns the assistant's text response.
 */
export async function callWorkspaceModel(
  workspaceId: string,
  systemPrompt: string,
  messages: Message[],
  opts: { maxTokens?: number; jsonMode?: boolean } = {},
): Promise<{ ok: boolean; text?: string; error?: string; providerUsed?: string }> {
  void workspaceId;
  const cfg = loadConfig();
  const config = await resolveModelConfig(cfg);
  if (!config) {
    return {
      ok: false,
      error:
        "No AI model configured in openclaw.json (set agents.defaults.model.primary and provider apiKey).",
    };
  }

  const { provider, modelId, apiKey } = config;
  const maxTokens = opts.maxTokens ?? 2048;

  try {
    switch (provider) {
      case "openai":
      case "openrouter":
      case "zai":
      case "kilo":
      case "moonshot":
      case "nvidia":
      case "azure":
      case "custom": {
        const baseUrl = resolveOpenAiCompatibleBaseUrl(provider, cfg);
        const openAiBody: Record<string, unknown> = {
          model: modelId,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.map(m => ({ role: m.role === "system" ? "user" : m.role, content: m.content })),
          ],
          max_tokens: maxTokens,
          temperature: 0.4,
        };
        if (opts.jsonMode) {
          openAiBody.response_format = { type: "json_object" };
        }

        const callOpenAiCompatible = async (
          targetProvider: string,
          targetBaseUrl: string,
          targetApiKey: string,
        ): Promise<{ ok: boolean; text?: string; status?: number; error?: string }> => {
          const res = await fetch(`${targetBaseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${targetApiKey}`,
            },
            body: JSON.stringify(openAiBody),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            return {
              ok: false,
              status: res.status,
              error: `${targetProvider} API error ${res.status}: ${text.slice(0, 300)}`,
            };
          }
          const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
          return { ok: true, text: data.choices?.[0]?.message?.content ?? "" };
        };

        const primary = await callOpenAiCompatible(provider, baseUrl, apiKey);
        if (primary.ok) {
          return { ok: true, text: primary.text, providerUsed: provider };
        }

        // Some provider aliases (kilo/moonshot/nvidia) are often configured with OpenRouter model IDs.
        // If their native endpoint is unavailable for chat completions, fall back to OpenRouter when
        // a global OpenRouter key exists.
        const shouldTryOpenRouterFallback =
          (provider === "kilo" || provider === "moonshot" || provider === "nvidia") &&
          (primary.status === 404 || primary.status === 405);
        if (shouldTryOpenRouterFallback) {
          const openRouterKey = await resolveProviderApiKey("openrouter", cfg);
          if (openRouterKey) {
            const fallback = await callOpenAiCompatible(
              "openrouter",
              "https://openrouter.ai/api/v1",
              openRouterKey,
            );
            if (fallback.ok) {
              return {
                ok: true,
                text: fallback.text,
                providerUsed: "openrouter",
              };
            }
          }
        }

        return { ok: false, error: primary.error };
      }

      case "anthropic": {
        const body = {
          model: modelId,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: messages
            .filter(m => m.role !== "system")
            .map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
          temperature: 0.4,
        };

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: `Anthropic API error ${res.status}: ${text.slice(0, 300)}` };
        }
        const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
        const text = data.content?.find(c => c.type === "text")?.text ?? "";
        return { ok: true, text, providerUsed: "anthropic" };
      }

      case "google": {
        // Gemini API
        const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
        for (const m of messages) {
          if (m.role === "system") continue;
          contents.push({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          });
        }

        const body: Record<string, unknown> = {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.4,
            ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
          },
        };

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: `Google API error ${res.status}: ${text.slice(0, 300)}` };
        }
        const data = await res.json() as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        };
        const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
        return { ok: true, text, providerUsed: "google" };
      }

      default:
        return {
          ok: false,
          error: `Unknown provider: ${provider}. Configure a supported provider in openclaw.json.`,
        };
    }
  } catch (err) {
    return { ok: false, error: `Model call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── n8n node catalog for the system prompt ──────────────────────────────────

// Dynamic n8n node catalog - fetches from n8n API with caching
const NODE_CATALOG_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let nodeCatalogCache: { catalog: string; fetchedAt: number } | null = null;

async function fetchN8nNodeTypes(n8nBaseUrl: string): Promise<string> {
  try {
    const res = await fetch(`${n8nBaseUrl}/rest/node-types`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Failed to fetch node types: ${res.status}`);
    const data = (await res.json()) as {
      data?: Array<{ name: string; displayName: string; description?: string }>;
    };

    const nodes = data.data ?? [];
    const triggers = nodes.filter((n) => n.name.toLowerCase().includes("trigger"));
    const actions = nodes.filter((n) => !n.name.toLowerCase().includes("trigger"));

    return `
## Available n8n Node Types (fetched from your n8n instance)

### Triggers
${triggers.map((n) => `- ${n.name} — ${n.description ?? n.displayName}`).join("\n")}

### Actions
${actions.map((n) => `- ${n.name} — ${n.description ?? n.displayName}`).join("\n")}
`;
  } catch {
    return N8N_NODE_CATALOG_FALLBACK;
  }
}

export async function getN8nNodeCatalog(n8nBaseUrl?: string): Promise<string> {
  const now = Date.now();
  if (nodeCatalogCache && now - nodeCatalogCache.fetchedAt < NODE_CATALOG_CACHE_TTL_MS) {
    return nodeCatalogCache.catalog;
  }

  const url = n8nBaseUrl ?? process.env.N8N_EMBED_URL ?? "http://127.0.0.1:5678";
  const catalog = await fetchN8nNodeTypes(url);
  nodeCatalogCache = { catalog, fetchedAt: now };
  return catalog;
}

const WORKSPACE_NODE_CATALOG_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const WORKSPACE_NODE_CATALOG_MAX_ENTRIES = 180;
const workspaceNodeCatalogCacheByWorkspace = new Map<string, { catalog: string; fetchedAt: number }>();

type WorkspaceNodeCatalogRow = {
  name: string;
  displayName?: string;
  description?: string;
};

function isWorkspaceTriggerNode(nodeName: string): boolean {
  const lower = nodeName.toLowerCase();
  return lower.includes("trigger") || lower.endsWith(".trigger");
}

function formatWorkspaceNodeRow(row: WorkspaceNodeCatalogRow): string {
  const detail = (row.description ?? row.displayName ?? "").trim();
  return detail ? `- ${row.name} - ${detail}` : `- ${row.name}`;
}

function trimWorkspaceNodeRows(rows: string[], limit: number): string[] {
  if (rows.length <= limit) {
    return rows;
  }
  const shown = rows.slice(0, limit);
  shown.push(`- ... plus ${rows.length - limit} more node types`);
  return shown;
}

function buildWorkspaceNodeCatalog(nodeTypes: WorkspaceNodeCatalogRow[]): string {
  if (!nodeTypes.length) {
    return N8N_NODE_CATALOG_FALLBACK;
  }

  // Deduplicate by node name (some n8n builds can return repeated aliases).
  const byName = new Map<string, WorkspaceNodeCatalogRow>();
  for (const node of nodeTypes) {
    if (!node.name || byName.has(node.name)) {
      continue;
    }
    byName.set(node.name, node);
  }

  const unique = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const custom = unique.filter((node) => !node.name.startsWith("n8n-nodes-base."));
  const triggers = unique.filter((node) => isWorkspaceTriggerNode(node.name));
  const actions = unique.filter((node) => !isWorkspaceTriggerNode(node.name));

  const customLimit = Math.min(60, WORKSPACE_NODE_CATALOG_MAX_ENTRIES);
  const triggerLimit = Math.min(
    50,
    Math.max(0, WORKSPACE_NODE_CATALOG_MAX_ENTRIES - customLimit),
  );
  const actionLimit = Math.max(
    0,
    WORKSPACE_NODE_CATALOG_MAX_ENTRIES - customLimit - triggerLimit,
  );

  const customLines = trimWorkspaceNodeRows(custom.map(formatWorkspaceNodeRow), customLimit);
  const triggerLines = trimWorkspaceNodeRows(triggers.map(formatWorkspaceNodeRow), triggerLimit);
  const actionLines = trimWorkspaceNodeRows(actions.map(formatWorkspaceNodeRow), actionLimit);

  return `
## Available n8n Node Types (live from this workspace)
Use this live catalog as the source of truth for node type names.

### Custom/Community Nodes
${customLines.length > 0 ? customLines.join("\n") : "- None detected"}

### Triggers
${triggerLines.length > 0 ? triggerLines.join("\n") : "- None detected"}

### Actions
${actionLines.length > 0 ? actionLines.join("\n") : "- None detected"}
`;
}

export async function getWorkspaceN8nNodeCatalog(workspaceId: string): Promise<string> {
  const cacheKey = workspaceId.trim() || "__default__";
  const now = Date.now();
  const cached = workspaceNodeCatalogCacheByWorkspace.get(cacheKey);
  if (cached && now - cached.fetchedAt < WORKSPACE_NODE_CATALOG_CACHE_TTL_MS) {
    return cached.catalog;
  }

  try {
    const { listN8nNodeTypes } = await import("./n8n-api-client.js");
    const result = await listN8nNodeTypes(workspaceId);
    if (!result.ok || !result.nodeTypes?.length) {
      return N8N_NODE_CATALOG_FALLBACK;
    }
    const catalog = buildWorkspaceNodeCatalog(result.nodeTypes);
    workspaceNodeCatalogCacheByWorkspace.set(cacheKey, { catalog, fetchedAt: now });
    return catalog;
  } catch {
    return N8N_NODE_CATALOG_FALLBACK;
  }
}

// Fallback catalog if n8n is unavailable
const N8N_NODE_CATALOG_FALLBACK = `
## Available n8n Node Types

### Triggers (workflow starts with one of these)
- n8n-nodes-base.webhookTrigger — HTTP webhook (any HTTP call triggers the workflow)
- n8n-nodes-base.scheduleTrigger — Cron schedule (e.g. every day at 9am)
- n8n-nodes-base.manualTrigger — Manual execution only
- n8n-nodes-base.emailReadImap — Trigger on new email via IMAP
- n8n-nodes-base.rss — Trigger on new RSS feed item
- n8n-nodes-base.slackTrigger — Trigger on Slack events (messages, reactions, etc.)
- n8n-nodes-base.githubTrigger — Trigger on GitHub events (push, PR, issue, etc.)
- n8n-nodes-base.googleSheetsRowTrigger — Trigger on new row in Google Sheets

### Basecamp (custom node — uses connected Basecamp account)
- n8n-nodes-basecamp.basecamp — Resource: project, todo, todolist, message, card, comment, document, file, person
  Operations on todo: getAll, get, create, update, complete, uncomplete, delete
  Operations on project: getAll, get, create
  Operations on message: getAll, get, create, update, delete
  Operations on todolist: getAll, get, create, update, delete

### Communication
- n8n-nodes-base.slack — Send messages, create channels, update users (credentials: Slack OAuth)
- n8n-nodes-base.gmail — Send/read emails via Gmail (credentials: Google OAuth)
- n8n-nodes-base.emailSend — Send email via SMTP
- n8n-nodes-base.telegramBot — Send Telegram messages
- n8n-nodes-base.discord — Send Discord webhook messages
- n8n-nodes-base.microsoftTeams — Send Teams messages

### Data & Storage
- n8n-nodes-base.googleSheets — Read/write Google Sheets (credentials: Google OAuth)
- n8n-nodes-base.airtable — Read/write Airtable records
- n8n-nodes-base.notion — Read/write Notion pages/databases
- n8n-nodes-base.postgres — Query PostgreSQL databases
- n8n-nodes-base.mysql — Query MySQL databases
- n8n-nodes-base.redis — Get/set Redis values
- n8n-nodes-base.ftp — Upload/download files via FTP

### Project Management
- n8n-nodes-base.github — Issues, PRs, files, releases (credentials: GitHub PAT)
- n8n-nodes-base.jira — Create/update Jira issues
- n8n-nodes-base.trello — Manage Trello cards and lists
- n8n-nodes-base.asana — Create/update Asana tasks
- n8n-nodes-base.linear — Create/update Linear issues

### AI & Processing
- n8n-nodes-base.openAi — Call OpenAI API (chat, images, embeddings)
- n8n-nodes-base.httpRequest — Make any HTTP request (GET/POST/PUT/DELETE)
- n8n-nodes-base.code — Run custom JavaScript/Python code
- n8n-nodes-base.set — Set/transform field values
- n8n-nodes-base.if — Branch workflow based on a condition
- n8n-nodes-base.switch — Route to multiple branches
- n8n-nodes-base.merge — Merge data from multiple branches
- n8n-nodes-base.splitInBatches — Process items in batches
- n8n-nodes-base.filter — Keep only items matching a condition

### CRM & Sales
- n8n-nodes-base.hubspot — Read/write HubSpot contacts, deals, companies
- n8n-nodes-base.salesforce — Read/write Salesforce records
- n8n-nodes-base.pipedrive — Read/write Pipedrive deals
`;

// ─── System prompt ────────────────────────────────────────────────────────────

export const WORKFLOW_ASSISTANT_SYSTEM_PROMPT = `You are an expert n8n workflow automation assistant integrated into OpenClaw.

Your job is to help users create, understand, and improve n8n workflows. You know all available n8n nodes and their capabilities.

If a section titled "Available n8n Node Types (live from this workspace)" is present below, treat it as the source of truth.
Do not invent node types. Use only node type names that exist in the provided live catalog when available.

${N8N_NODE_CATALOG_FALLBACK}

## How to respond

Always respond with a JSON object in this exact format:
{
  "message": "Your conversational response here. Explain what you're building and why.",
  "workflow": {              // Include ONLY if the user wants to create or modify a workflow
    "name": "Workflow name",
    "nodes": [
      {
        "id": "uuid-here",
        "name": "Human-readable name",
        "type": "n8n-nodes-base.scheduleTrigger",
        "typeVersion": 1,
        "position": [250, 300],
        "parameters": {}    // Node-specific parameters
      }
    ],
    "connections": {
      "Trigger node name": {
        "main": [[{"node": "Next node name", "type": "main", "index": 0}]]
      }
    }
  }
}

## Rules
- Use REAL n8n node type names exactly as listed above (e.g., "n8n-nodes-base.slack" not "slack")
- If a live workspace node catalog is provided, use ONLY node names from that live catalog
- The Basecamp node is "n8n-nodes-basecamp.basecamp" — it uses the connected Basecamp account from Integrations
- Position nodes left-to-right: trigger at x=250, each subsequent node at x+250
- Keep node parameters minimal — the user can configure details in the n8n editor
- If the user asks a question, answer it clearly without generating a workflow
- If the request is ambiguous, ask a clarifying question instead of guessing
- Always explain what the workflow does in simple language
- Use as many nodes as needed for the task - can be 2 nodes or 20+ nodes depending on complexity
- Include data transformation nodes (set, code, filter) when needed
- Use branching (if, switch) to create multiple paths in the workflow
- Use merge nodes to combine data from multiple branches
- Prefer complete workflows that can execute without manual node rewiring
- If a webhook flow must return custom JSON/body/status, include n8n-nodes-base.respondToWebhook and set webhook trigger responseMode to responseNode
- Respond ONLY with the JSON object — no markdown fences, no extra text

## Example: Creating a Basecamp Todo Sync Workflow

User: "Create a workflow that receives new Basecamp todos via webhook, notifies Slack, and creates a GitHub issue"

Response:
{
  "message": "I'll create a workflow that: 1) Triggers when a new todo is created in Basecamp, 2) Formats the data, 3) Sends a notification to Slack, 4) Creates a GitHub issue for tracking. This uses 7 nodes for robust automation.",
  "workflow": {
    "name": "Basecamp Todo to Slack and GitHub",
    "nodes": [
      {"id": "trigger-1", "name": "Incoming Todo Webhook", "type": "n8n-nodes-base.webhookTrigger", "typeVersion": 1, "position": [250, 300], "parameters": {"path": "basecamp-todo","responseMode":"onReceived"}},
      {"id": "set-1", "name": "Format Todo Data", "type": "n8n-nodes-base.set", "typeVersion": 3, "position": [500, 300], "parameters": {"values": {"string": [{"name": "title", "value": "={{ $json.title }}"}, {"name": "description", "value": "={{ $json.content }}"}]}}},
      {"id": "slack-1", "name": "Notify Slack", "type": "n8n-nodes-base.slack", "typeVersion": 1, "position": [750, 300], "parameters": {"resource": "message", "operation": "post", "channel": "#notifications", "text": "New Basecamp Todo: {{$json.title}}"}},
      {"id": "filter-1", "name": "Check Priority", "type": "n8n-nodes-base.if", "typeVersion": 1, "position": [1000, 300], "parameters": {"conditions": {"string": [{"value1": "={{ $json.priority }}", "value2": "high"}]}}},
      {"id": "github-1", "name": "Create GitHub Issue", "type": "n8n-nodes-base.github", "typeVersion": 1, "position": [1250, 200], "parameters": {"resource": "issue", "operation": "create", "title": "={{ $json.title }}", "body": "={{ $json.description }}"}},
      {"id": "set-2", "name": "Log Skipped", "type": "n8n-nodes-base.set", "typeVersion": 3, "position": [1250, 400], "parameters": {"values": {"string": [{"name": "status", "value": "skipped_low_priority"}]}}}
    ],
    "connections": {
      "Incoming Todo Webhook": {"main": [[{"node": "Format Todo Data", "type": "main", "index": 0}]]},
      "Format Todo Data": {"main": [[{"node": "Notify Slack", "type": "main", "index": 0}]]},
      "Notify Slack": {"main": [[{"node": "Check Priority", "type": "main", "index": 0}]]},
      "Check Priority": {"main": [[{"node": "Create GitHub Issue", "type": "main", "index": 0}], [{"node": "Log Skipped", "type": "main", "index": 0}]]}
    }
  }
}`;
