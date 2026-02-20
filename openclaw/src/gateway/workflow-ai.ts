/**
 * Workflow AI — calls the workspace BYOK model to power the Automations AI chat.
 *
 * Reads the provider + model ID from workspace config (agents.defaults.model.primary)
 * and the encrypted API key from byok-store, then makes a direct API call so the
 * same model the user configured in Integrations powers the workflow assistant.
 */

import { getKey } from "./byok-store.js";
import { loadEffectiveWorkspaceConfig } from "./workspace-config.js";

type Message = { role: "user" | "assistant" | "system"; content: string };

interface ModelConfig {
  provider: string;
  modelId: string;
  apiKey: string;
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

/**
 * Resolve model config for a workspace. Returns null if no model is configured.
 */
async function resolveModelConfig(workspaceId: string): Promise<ModelConfig | null> {
  const cfg = await loadEffectiveWorkspaceConfig(workspaceId);
  const primaryRef = (cfg as Record<string, unknown>)?.agents
    ? ((cfg as Record<string, unknown>).agents as Record<string, unknown>)?.defaults
      ? (((cfg as Record<string, unknown>).agents as Record<string, unknown>).defaults as Record<string, unknown>)?.model
        ? ((((cfg as Record<string, unknown>).agents as Record<string, unknown>).defaults as Record<string, unknown>).model as Record<string, unknown>)?.primary
        : undefined
      : undefined
    : undefined;

  const parsed = parsePrimaryRef(primaryRef);
  if (!parsed) return null;

  const apiKey = await getKey(workspaceId, parsed.provider as import("./byok-store.js").AIProvider);
  if (!apiKey) return null;

  return { provider: parsed.provider, modelId: parsed.modelId, apiKey };
}

/**
 * Call the workspace's configured BYOK model with a system prompt + messages.
 * Returns the assistant's text response.
 */
export async function callWorkspaceModel(
  workspaceId: string,
  systemPrompt: string,
  messages: Message[],
  opts: { maxTokens?: number; jsonMode?: boolean } = {},
): Promise<{ ok: boolean; text?: string; error?: string; providerUsed?: string }> {
  const config = await resolveModelConfig(workspaceId);
  if (!config) {
    return { ok: false, error: "No AI model configured. Go to Integrations to add a provider API key." };
  }

  const { provider, modelId, apiKey } = config;
  const maxTokens = opts.maxTokens ?? 2048;

  try {
    switch (provider) {
      case "openai":
      case "openrouter":
      case "zai":
      case "azure":
      case "custom": {
        const baseUrl = provider === "openrouter"
          ? "https://openrouter.ai/api/v1"
          : provider === "zai"
          ? "https://open.bigmodel.cn/api/paas/v4"
          : "https://api.openai.com/v1";

        const body: Record<string, unknown> = {
          model: modelId,
          messages: [{ role: "system", content: systemPrompt }, ...messages.map(m => ({ role: m.role === "system" ? "user" : m.role, content: m.content }))],
          max_tokens: maxTokens,
          temperature: 0.4,
        };
        if (opts.jsonMode) {
          body.response_format = { type: "json_object" };
        }

        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: `${provider} API error ${res.status}: ${text.slice(0, 300)}` };
        }
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content ?? "";
        return { ok: true, text, providerUsed: provider };
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
        return { ok: false, error: `Unknown provider: ${provider}. Configure a supported provider in Integrations.` };
    }
  } catch (err) {
    return { ok: false, error: `Model call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── n8n node catalog for the system prompt ──────────────────────────────────

export const N8N_NODE_CATALOG = `
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
- n8n-nodes-basecamp.basecampTrigger — Trigger on Basecamp events (new todo, message, etc.) [custom node]

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

${N8N_NODE_CATALOG}

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
- Respond ONLY with the JSON object — no markdown fences, no extra text

## Example: Creating a Basecamp Todo Sync Workflow

User: "Create a workflow that syncs new Basecamp todos to Slack and creates a GitHub issue"

Response:
{
  "message": "I'll create a workflow that: 1) Triggers when a new todo is created in Basecamp, 2) Formats the data, 3) Sends a notification to Slack, 4) Creates a GitHub issue for tracking. This uses 7 nodes for robust automation.",
  "workflow": {
    "name": "Basecamp Todo to Slack and GitHub",
    "nodes": [
      {"id": "trigger-1", "name": "Basecamp Trigger", "type": "n8n-nodes-basecamp.basecampTrigger", "typeVersion": 1, "position": [250, 300], "parameters": {"event": "todo.created"}},
      {"id": "set-1", "name": "Format Todo Data", "type": "n8n-nodes-base.set", "typeVersion": 3, "position": [500, 300], "parameters": {"values": {"string": [{"name": "title", "value": "={{ $json.title }}"}, {"name": "description", "value": "={{ $json.content }}"}]}}},
      {"id": "slack-1", "name": "Notify Slack", "type": "n8n-nodes-base.slack", "typeVersion": 1, "position": [750, 300], "parameters": {"resource": "message", "operation": "post", "channel": "#notifications", "text": "New Basecamp Todo: {{$json.title}}"}},
      {"id": "filter-1", "name": "Check Priority", "type": "n8n-nodes-base.if", "typeVersion": 1, "position": [1000, 300], "parameters": {"conditions": {"string": [{"value1": "={{ $json.priority }}", "value2": "high"}]}}},
      {"id": "github-1", "name": "Create GitHub Issue", "type": "n8n-nodes-base.github", "typeVersion": 1, "position": [1250, 200], "parameters": {"resource": "issue", "operation": "create", "title": "={{ $json.title }}", "body": "={{ $json.description }}"}},
      {"id": "set-2", "name": "Log Skipped", "type": "n8n-nodes-base.set", "typeVersion": 3, "position": [1250, 400], "parameters": {"values": {"string": [{"name": "status", "value": "skipped_low_priority"}]}}}
    ],
    "connections": {
      "Basecamp Trigger": {"main": [[{"node": "Format Todo Data", "type": "main", "index": 0}]]},
      "Format Todo Data": {"main": [[{"node": "Notify Slack", "type": "main", "index": 0}]]},
      "Notify Slack": {"main": [[{"node": "Check Priority", "type": "main", "index": 0}]]},
      "Check Priority": {"main": [[{"node": "Create GitHub Issue", "type": "main", "index": 0}], [{"node": "Log Skipped", "type": "main", "index": 0}]]}
    }
  }
}`;
