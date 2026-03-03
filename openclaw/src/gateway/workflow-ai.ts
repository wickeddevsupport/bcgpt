/**
 * Workflow AI calls the workspace-effective configured model.
 *
 * Source of truth:
 * - Workspace effective config (global openclaw.json merged with workspace config)
 * - agents.defaults.model.primary
 * - models.providers.<provider>.apiKey
 * - BYOK store key for the workspace (fallback)
 * - env fallback when missing
 */

import { getCustomProviderApiKey, resolveEnvApiKey } from "../agents/model-auth.js";
import { loadConfig, type OpenClawConfig } from "../config/config.js";
import { loadEffectiveWorkspaceConfig } from "./workspace-config.js";

type Message = { role: "user" | "assistant" | "system"; content: string };

interface ModelConfig {
  provider: string;
  modelId: string;
  apiKey: string;
}

const WORKFLOW_MODEL_CANDIDATE_LIMIT = 3;
const WORKFLOW_MODEL_CALL_TIMEOUT_MS = 90_000;
const API_KEY_OPTIONAL_PROVIDERS = new Set(["ollama", "local-ollama"]);

/**
 * Wraps res.json() in a Promise.race so slow body streaming cannot block indefinitely.
 * The AbortSignal on fetch() only cancels the initial connection; once headers are received
 * the body can still stream at any rate. This helper enforces a hard deadline on body parsing.
 */
function resJsonWithTimeout<T>(res: Response, timeoutMs: number): Promise<T> {
  return Promise.race([
    res.json() as Promise<T>,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`json_body_timeout_${timeoutMs}ms — model may be streaming too slowly`)),
        timeoutMs,
      )
    ),
  ]);
}

function appendV1(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1`;
}

function resolveKiloBaseUrl(): string {
  const raw = (process.env.KILO_API_URL ?? "https://api.kilo.ai/api/gateway").trim();
  const normalized = raw.replace(/\/+$/, "");
  return normalized.replace(/\/chat\/completions$/, "");
}

function resolveOllamaBaseUrl(rawBaseUrl?: string | null): string {
  const raw = (rawBaseUrl ?? process.env.OLLAMA_API_URL ?? process.env.OPENCLAW_OLLAMA_API_URL ?? "http://host.docker.internal:11434/v1").trim();
  const normalized = raw.replace(/\/+$/, "");
  if (/\/v1$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}/v1`;
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
    if (provider === "ollama" || provider === "local-ollama") {
      return resolveOllamaBaseUrl(configuredBaseUrl);
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
    case "ollama":
    case "local-ollama":
      return resolveOllamaBaseUrl();
    case "openai":
    default:
      return "https://api.openai.com/v1";
  }
}

function normalizeProviderAlias(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  switch (normalized) {
    case "open-router":
      return "openrouter";
    case "nvidia-nim":
      return "nvidia";
    case "local_ollama":
      return "local-ollama";
    case "z-ai":
      return "zai";
    default:
      return normalized;
  }
}

/**
 * Parse "provider/modelId" format stored in agents.defaults.model.primary
 */
function parsePrimaryRef(ref: unknown): { provider: string; modelId: string } | null {
  if (typeof ref !== "string" || !ref.includes("/")) return null;
  const slash = ref.indexOf("/");
  const provider = normalizeProviderAlias(ref.slice(0, slash).trim());
  const modelId = ref.slice(slash + 1).trim().replace(/^\/+/, "");
  if (!provider || !modelId) return null;
  return { provider, modelId };
}

function resolvePrimaryRefFromConfig(cfg: OpenClawConfig): unknown {
  return cfg?.agents?.defaults?.model?.primary;
}

function resolveFallbackRefsFromConfig(cfg: OpenClawConfig): unknown[] {
  const raw = cfg?.agents?.defaults?.model?.fallbacks;
  return Array.isArray(raw) ? raw : [];
}

function resolveSavedModelRefsFromConfig(cfg: OpenClawConfig): unknown[] {
  const raw = cfg?.agents?.defaults?.models;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }
  return Object.keys(raw as Record<string, unknown>);
}

function resolveProviderModelRefsFromConfig(cfg: OpenClawConfig): string[] {
  const providers = cfg?.models?.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return [];
  }

  const refs: string[] = [];
  for (const [providerKey, providerValue] of Object.entries(providers as Record<string, unknown>)) {
    if (!providerValue || typeof providerValue !== "object" || Array.isArray(providerValue)) {
      continue;
    }
    const provider = normalizeProviderAlias(providerKey);
    const models = (providerValue as { models?: unknown }).models;
    if (!Array.isArray(models)) {
      continue;
    }
    for (const model of models) {
      if (!model || typeof model !== "object" || Array.isArray(model)) {
        continue;
      }
      const id = typeof (model as { id?: unknown }).id === "string"
        ? (model as { id: string }).id.trim()
        : "";
      if (!id) {
        continue;
      }
      refs.push(`${provider}/${id}`);
    }
  }
  return refs;
}

function isTemplatedSecretValue(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return true;
  }
  if (/\$\{[^}]+\}/.test(normalized)) {
    return true;
  }
  if (/^<[^>]+>$/.test(normalized)) {
    return true;
  }
  return /^(change[-_ ]?me|replace[-_ ]?me|your[-_ ]?api[-_ ]?key)$/i.test(normalized);
}

async function resolveProviderApiKey(
  provider: string,
  cfg: OpenClawConfig,
  workspaceId?: string | null,
): Promise<string | null> {
  const configApiKey = getCustomProviderApiKey(cfg, provider);
  if (configApiKey) {
    return configApiKey;
  }
  if (workspaceId) {
    try {
      const { getKey } = await import("./byok-store.js");
      const byokKey = await getKey(workspaceId, provider as import("./byok-store.js").AIProvider);
      if (typeof byokKey === "string" && byokKey.trim()) {
        return byokKey.trim();
      }
    } catch {
      // Best-effort BYOK lookup; fallback below.
    }
  }
  const envResolved = resolveEnvApiKey(provider);
  const envApiKey = typeof envResolved?.apiKey === "string" ? envResolved.apiKey.trim() : "";
  return envApiKey || null;
}

function resolveConfiguredModelRefs(
  cfg: OpenClawConfig,
): Array<{ provider: string; modelId: string }> {
  const refs: Array<{ provider: string; modelId: string }> = [];
  const seen = new Set<string>();
  const pushRef = (candidate: unknown) => {
    const parsed = parsePrimaryRef(candidate);
    if (!parsed) return;
    const key = `${parsed.provider}/${parsed.modelId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(parsed);
  };
  pushRef(resolvePrimaryRefFromConfig(cfg));
  for (const fallback of resolveFallbackRefsFromConfig(cfg)) {
    pushRef(fallback);
  }
  for (const modelRef of resolveSavedModelRefsFromConfig(cfg)) {
    pushRef(modelRef);
  }
  for (const modelRef of resolveProviderModelRefsFromConfig(cfg)) {
    pushRef(modelRef);
  }
  return refs;
}

async function resolveModelConfigs(
  cfg: OpenClawConfig,
  workspaceId?: string | null,
): Promise<ModelConfig[]> {
  const refs = resolveConfiguredModelRefs(cfg);
  if (refs.length === 0) {
    return [];
  }
  const resolved: ModelConfig[] = [];
  for (const ref of refs) {
    const apiKey = await resolveProviderApiKey(ref.provider, cfg, workspaceId);
    const requiresApiKey = !API_KEY_OPTIONAL_PROVIDERS.has(ref.provider);
    if (requiresApiKey && (!apiKey || isTemplatedSecretValue(apiKey))) {
      continue;
    }
    resolved.push({
      provider: ref.provider,
      modelId: ref.modelId,
      apiKey: apiKey ?? "",
    });
  }
  if (resolved.length <= 1) {
    return resolved.slice(0, WORKFLOW_MODEL_CANDIDATE_LIMIT);
  }

  const primary = resolved[0];
  const remaining = resolved.slice(1);
  const ordered: ModelConfig[] = [primary];
  const seenProvider = new Set<string>([primary.provider]);

  // Prefer trying different providers before retrying multiple models from one provider.
  for (const candidate of remaining) {
    if (seenProvider.has(candidate.provider)) {
      continue;
    }
    ordered.push(candidate);
    seenProvider.add(candidate.provider);
    if (ordered.length >= WORKFLOW_MODEL_CANDIDATE_LIMIT) {
      return ordered;
    }
  }

  for (const candidate of remaining) {
    if (ordered.includes(candidate)) {
      continue;
    }
    ordered.push(candidate);
    if (ordered.length >= WORKFLOW_MODEL_CANDIDATE_LIMIT) {
      return ordered;
    }
  }

  return ordered.slice(0, WORKFLOW_MODEL_CANDIDATE_LIMIT);
}

async function callModelWithConfig(
  cfg: OpenClawConfig,
  config: ModelConfig,
  systemPrompt: string,
  messages: Message[],
  opts: { maxTokens?: number; jsonMode?: boolean } = {},
): Promise<{ ok: boolean; text?: string; error?: string; providerUsed?: string }> {
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
      case "ollama":
      case "local-ollama":
      case "custom": {
        const baseUrl = resolveOpenAiCompatibleBaseUrl(provider, cfg);

        const callOpenAiCompatible = async (
          targetProvider: string,
          targetBaseUrl: string,
          targetApiKey: string,
          targetModelId: string,
        ): Promise<{ ok: boolean; text?: string; status?: number; error?: string }> => {
          const openAiBody: Record<string, unknown> = {
            model: targetModelId,
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
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (targetApiKey.trim()) {
            headers.Authorization = `Bearer ${targetApiKey}`;
          }
          let res: Response;
          try {
            res = await fetch(`${targetBaseUrl}/chat/completions`, {
              method: "POST",
              headers,
              body: JSON.stringify(openAiBody),
              signal: AbortSignal.timeout(WORKFLOW_MODEL_CALL_TIMEOUT_MS),
            });
          } catch (err) {
            const errorText = err instanceof Error ? err.message : String(err);
            return {
              ok: false,
              status: 408,
              error: `${targetProvider} API timeout/error: ${errorText.slice(0, 300)}`,
            };
          }
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            return {
              ok: false,
              status: res.status,
              error: `${targetProvider} API error ${res.status}: ${text.slice(0, 300)}`,
            };
          }
          const data = await resJsonWithTimeout<{ choices?: Array<{ message?: { content?: string } }> }>(res, WORKFLOW_MODEL_CALL_TIMEOUT_MS);
          return { ok: true, text: data.choices?.[0]?.message?.content ?? "" };
        };

        const primary = await callOpenAiCompatible(provider, baseUrl, apiKey, modelId);
        if (primary.ok) {
          return { ok: true, text: primary.text, providerUsed: provider };
        }

        const shouldTryOpenRouterFallback =
          (provider === "kilo" || provider === "moonshot" || provider === "nvidia") &&
          (primary.status === 404 || primary.status === 405);
        if (shouldTryOpenRouterFallback) {
          const openRouterKey = await resolveProviderApiKey("openrouter", cfg);
          if (openRouterKey && !isTemplatedSecretValue(openRouterKey)) {
            const fallback = await callOpenAiCompatible(
              "openrouter",
              "https://openrouter.ai/api/v1",
              openRouterKey,
              modelId,
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

        let res: Response;
        try {
          res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(WORKFLOW_MODEL_CALL_TIMEOUT_MS),
          });
        } catch (err) {
          const errorText = err instanceof Error ? err.message : String(err);
          return { ok: false, error: `Anthropic API timeout/error: ${errorText.slice(0, 300)}` };
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: `Anthropic API error ${res.status}: ${text.slice(0, 300)}` };
        }
        const data = await resJsonWithTimeout<{ content?: Array<{ type: string; text?: string }> }>(res, WORKFLOW_MODEL_CALL_TIMEOUT_MS);
        const text = data.content?.find(c => c.type === "text")?.text ?? "";
        return { ok: true, text, providerUsed: "anthropic" };
      }

      case "google": {
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
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(WORKFLOW_MODEL_CALL_TIMEOUT_MS),
          });
        } catch (err) {
          const errorText = err instanceof Error ? err.message : String(err);
          return { ok: false, error: `Google API timeout/error: ${errorText.slice(0, 300)}` };
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: `Google API error ${res.status}: ${text.slice(0, 300)}` };
        }
        const data = await resJsonWithTimeout<{
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        }>(res, WORKFLOW_MODEL_CALL_TIMEOUT_MS);
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
  const wsId = String(workspaceId ?? "").trim();
  const cfg = wsId
    ? ((await loadEffectiveWorkspaceConfig(wsId)) as OpenClawConfig)
    : loadConfig();
  const configs = await resolveModelConfigs(cfg, wsId || null);
  if (!configs.length) {
    return {
      ok: false,
      error:
        "No AI model configured for this workspace (set agents.defaults.model.primary and provider apiKey in workspace config, or add a BYOK key).",
    };
  }

  const errors: string[] = [];
  for (const modelConfig of configs) {
    const result = await callModelWithConfig(cfg, modelConfig, systemPrompt, messages, opts);
    if (result.ok) {
      return result;
    }
    errors.push(`${modelConfig.provider}/${modelConfig.modelId}: ${result.error ?? "unknown error"}`);
  }
  const compact = errors.slice(0, 2).join(" | ");
  return { ok: false, error: compact || "Model call failed for configured workflow assistant models." };
}

// ─── Agentic tool-calling loop ────────────────────────────────────────────────

export type ChatToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type AssistantToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/**
 * Agentic model call with tool support (OpenAI-compatible providers).
 * Loops up to maxIterations times, executing tool calls and feeding results back.
 * Falls back to plain callWorkspaceModel for non-OpenAI-compatible providers (Anthropic, Google).
 */
export async function callWorkspaceModelAgentLoop(
  workspaceId: string,
  systemPrompt: string,
  userMessages: Array<{ role: "user" | "assistant"; content: string }>,
  tools: ChatToolDefinition[],
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  opts: { maxTokens?: number; maxIterations?: number } = {},
): Promise<{ ok: boolean; text?: string; error?: string; providerUsed?: string }> {
  const wsId = String(workspaceId ?? "").trim();
  const cfg = wsId
    ? ((await loadEffectiveWorkspaceConfig(wsId)) as OpenClawConfig)
    : loadConfig();
  const configs = await resolveModelConfigs(cfg, wsId || null);
  if (!configs.length) {
    return {
      ok: false,
      error:
        "No AI model configured for this workspace (set agents.defaults.model.primary and provider apiKey in workspace config, or add a BYOK key).",
    };
  }

  const maxIterations = opts.maxIterations ?? 6;
  const maxTokens = opts.maxTokens ?? 2048;

  for (const modelConfig of configs) {
    const { provider, modelId, apiKey } = modelConfig;

    // Non-OpenAI-compatible providers: fall back to plain text call (no tool support)
    if (provider === "anthropic" || provider === "google") {
      const fallback = await callModelWithConfig(cfg, modelConfig, systemPrompt, userMessages, { maxTokens });
      if (fallback.ok) return fallback;
      continue;
    }

    const baseUrl = resolveOpenAiCompatibleBaseUrl(provider, cfg);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey}`;

    // Build message array — tool messages interleaved after each tool call round
    const agentMessages: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
      ...userMessages.map((m) => ({ role: m.role, content: m.content })),
    ];

    let providerUsed = provider;
    let succeeded = false;

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        const body: Record<string, unknown> = {
          model: modelId,
          messages: agentMessages,
          max_tokens: maxTokens,
          temperature: 0.35,
          tools,
          tool_choice: "auto",
        };

        let res: Response;
        try {
          res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(WORKFLOW_MODEL_CALL_TIMEOUT_MS),
          });
        } catch {
          break; // network error, try next model
        }

        if (!res.ok) {
          break; // API error, try next model
        }

        const data = await resJsonWithTimeout<{
          choices?: Array<{
            message?: {
              role?: string;
              content?: string | null;
              tool_calls?: AssistantToolCall[];
            };
            finish_reason?: string;
          }>;
        }>(res, WORKFLOW_MODEL_CALL_TIMEOUT_MS);

        const assistantMsg = data.choices?.[0]?.message;
        if (!assistantMsg) break;

        const toolCalls = assistantMsg.tool_calls;

        if (!toolCalls?.length) {
          // No tool calls — final text response
          return {
            ok: true,
            text: assistantMsg.content ?? "",
            providerUsed,
          };
        }

        // Add assistant message (with tool_calls) to context
        agentMessages.push({
          role: "assistant",
          content: assistantMsg.content ?? null,
          tool_calls: toolCalls,
        });

        // Execute each tool and append results
        for (const tc of toolCalls) {
          let toolResult: string;
          try {
            const args = JSON.parse(tc.function.arguments ?? "{}") as Record<string, unknown>;
            toolResult = await executeTool(tc.function.name, args);
          } catch (err) {
            toolResult = JSON.stringify({
              error: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
          agentMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: toolResult,
          });
        }
        // Loop continues with tool results injected
      }

      // Max iterations reached — return last assistant text if any
      const lastText = [...agentMessages]
        .reverse()
        .find((m) => m.role === "assistant" && m.content);
      if (lastText?.content) {
        return { ok: true, text: String(lastText.content), providerUsed };
      }
      succeeded = false;
    } catch {
      // try next model config
    }

    if (succeeded) break;
  }

  return { ok: false, error: "Model call failed for all configured providers." };
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

// ─── Basecamp node cheatsheet (always injected — authoritative reference) ──────

const BASECAMP_NODE_CHEATSHEET = `
## ⭐ Custom Basecamp Node — Complete Reference (n8n-nodes-basecamp.basecamp)

This is YOUR custom Basecamp integration node. It is ALWAYS available when Basecamp is connected.
Node type: \`n8n-nodes-basecamp.basecamp\`
Credential type: \`basecampApi\` (auto-linked — include "credentials" key in every Basecamp node)

### All Resources and Operations

#### Resource: \`project\`
| Operation | Key Parameters |
|-----------|---------------|
| \`getAll\` | \`includeArchived: false\` |
| \`get\` | \`projectId: "ID"\` |
| \`findByName\` | \`projectName: "My Project"\` |
| \`create\` | \`name: "Name"\`, \`description: "Desc"\` |
| \`update\` | \`projectId: "ID"\`, \`name: "New Name"\` |
| \`trash\` | \`projectId: "ID"\` |

#### Resource: \`todo\`
| Operation | Key Parameters |
|-----------|---------------|
| \`create\` | \`projectId\`, \`todolistId\`, \`content\` (required); additionalFields: \`due_on\`, \`assignee_ids\`, \`notes\` |
| \`get\` | \`projectId\`, \`todoId\` |
| \`update\` | \`projectId\`, \`todoId\`, \`content\`; additionalFields optional |
| \`complete\` | \`projectId\`, \`todoId\` |
| \`uncomplete\` | \`projectId\`, \`todoId\` |
| \`delete\` | \`projectId\`, \`todoId\` |

#### Resource: \`todolist\`
| Operation | Key Parameters |
|-----------|---------------|
| \`getAll\` | \`projectId\` |
| \`get\` | \`projectId\`, \`todolistId\` |
| \`create\` | \`projectId\`, \`name\`; optional \`description\` |
| \`update\` | \`projectId\`, \`todolistId\`, optional \`name\` |
| \`delete\` | \`projectId\`, \`todolistId\` |

#### Resource: \`message\`
| Operation | Key Parameters |
|-----------|---------------|
| \`create\` | \`projectId\`, \`subject\`; optional \`content\` (HTML) |
| \`get\` | \`projectId\`, \`messageId\` |
| \`update\` | \`projectId\`, \`messageId\`; optional \`subject\`, \`content\` |
| \`delete\` | \`projectId\`, \`messageId\` |

#### Resource: \`person\`
| Operation | Key Parameters |
|-----------|---------------|
| \`getAll\` | no params needed (lists all account people) |

#### Resource: \`card\` (Kanban)
| Operation | Key Parameters |
|-----------|---------------|
| \`getAll\` | \`projectId\` |
| \`get\` | \`projectId\`, \`cardId\` |
| \`create\` | \`projectId\`, \`title\`; optional \`content\`, \`due_on\`, \`assignee_ids\` |
| \`update\` | \`projectId\`, \`cardId\`; optional fields |

#### Resource: \`comment\`
| Operation | Key Parameters |
|-----------|---------------|
| \`getAll\` | \`projectId\`, \`recordingId\`, \`recordingType\` (e.g. "Todo") |
| \`create\` | \`projectId\`, \`recordingId\`, \`recordingType\`, \`content\` |
| \`delete\` | \`projectId\`, \`commentId\` |

### Complete Node JSON Examples

#### Get All Projects
\`\`\`json
{
  "id": "bc-1",
  "name": "Get Basecamp Projects",
  "type": "n8n-nodes-basecamp.basecamp",
  "typeVersion": 1,
  "position": [500, 300],
  "parameters": {
    "resource": "project",
    "operation": "getAll",
    "includeArchived": false
  },
  "credentials": { "basecampApi": { "id": "CRED_ID", "name": "CRED_NAME" } }
}
\`\`\`

#### Create a Todo (with dynamic project/list from previous node)
\`\`\`json
{
  "id": "bc-2",
  "name": "Create Basecamp Todo",
  "type": "n8n-nodes-basecamp.basecamp",
  "typeVersion": 1,
  "position": [750, 300],
  "parameters": {
    "resource": "todo",
    "operation": "create",
    "projectId": "={{ $json.projectId }}",
    "todolistId": "={{ $json.todolistId }}",
    "content": "={{ $json.title }}",
    "additionalFields": {
      "due_on": "={{ $json.dueDate }}",
      "notes": "={{ $json.description }}"
    }
  },
  "credentials": { "basecampApi": { "id": "CRED_ID", "name": "CRED_NAME" } }
}
\`\`\`

#### Post a Message to a Project
\`\`\`json
{
  "id": "bc-3",
  "name": "Post Basecamp Message",
  "type": "n8n-nodes-basecamp.basecamp",
  "typeVersion": 1,
  "position": [750, 300],
  "parameters": {
    "resource": "message",
    "operation": "create",
    "projectId": "={{ $json.projectId }}",
    "subject": "={{ $json.title }}",
    "content": "<p>={{ $json.body }}</p>"
  },
  "credentials": { "basecampApi": { "id": "CRED_ID", "name": "CRED_NAME" } }
}
\`\`\`

#### Find Project by Name then Get its Todo Lists
Chain these two nodes: first find project by name, then get its todo lists.
\`\`\`json
[
  {
    "id": "bc-find-1",
    "name": "Find Project",
    "type": "n8n-nodes-basecamp.basecamp",
    "typeVersion": 1,
    "position": [500, 300],
    "parameters": { "resource": "project", "operation": "findByName", "projectName": "My Project Name" },
    "credentials": { "basecampApi": { "id": "CRED_ID", "name": "CRED_NAME" } }
  },
  {
    "id": "bc-lists-1",
    "name": "Get Todo Lists",
    "type": "n8n-nodes-basecamp.basecamp",
    "typeVersion": 1,
    "position": [750, 300],
    "parameters": { "resource": "todolist", "operation": "getAll", "projectId": "={{ $json.id.toString() }}" },
    "credentials": { "basecampApi": { "id": "CRED_ID", "name": "CRED_NAME" } }
  }
]
\`\`\`

### Expression Reference for Chaining Nodes
- \`={{ $json.id.toString() }}\` — convert numeric Basecamp ID to string
- \`={{ $json.projectId }}\` — pass projectId from previous node output
- \`={{ $node["Get Projects"].json[0].id.toString() }}\` — access first item from a named node
- \`={{ $json.name }}\` — use the name field from previous output
- \`={{ $json.title }}\` — use the title field (for todos, cards)

### Design Patterns for Basecamp Workflows

**Pattern 1: Create todo from webhook data**
Webhook Trigger → Set (format data) → Basecamp (todo: create) → Respond to Webhook

**Pattern 2: Auto-notify on new Basecamp data**
Schedule Trigger → Basecamp (project: getAll) → Split In Batches → Basecamp (todo: getAll) → Filter (check due soon) → Slack (notify) / Gmail (send email)

**Pattern 3: Sync between Basecamp and other tools**
Webhook → Basecamp (findByName project) → Basecamp (todolist: getAll) → Code (pick first list) → Basecamp (todo: create) → GitHub (issue: create)

**Pattern 4: Status board update**  
Schedule Trigger → Basecamp (todo: getAll) → Filter (completed) → Google Sheets (append) → Slack (summary)

### CRITICAL: When User Mentions Basecamp
- ALWAYS use \`n8n-nodes-basecamp.basecamp\` — never invent a different type name
- ALWAYS include the \`credentials\` key — the credential name will be auto-linked
- Use \`findByName\` operation when the user mentions a project by name (so runtime resolves the ID)
- Chain nodes: get project → get todolists → create todo (3-node pattern for full context)
- For numeric IDs from previous nodes always call \`.toString()\` in the expression
`;
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

  // Always inject the custom Basecamp node at the top — even if n8n's REST API doesn't surface it.
  const basecampCustomEntry = "- n8n-nodes-basecamp.basecamp | Basecamp (Custom BCgpt Node) | ALWAYS use this for ALL Basecamp operations";
  const customSection = customLines.length > 0
    ? [basecampCustomEntry, ...customLines.filter(l => !l.includes("n8n-nodes-basecamp"))].join("\n")
    : basecampCustomEntry;

  return `
## Available n8n Node Types (live from this workspace)
Use this live catalog as the source of truth for node type names.
⚠️ IMPORTANT: ALWAYS use \`n8n-nodes-basecamp.basecamp\` for ANY Basecamp operation — this is the custom BCgpt node. NEVER use \`n8n-nodes-base.basecamp\` or any other basecamp variant.

### Custom/Community Nodes (ALWAYS AVAILABLE)
${customSection}

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
- n8n-nodes-base.webhook — HTTP webhook (any inbound HTTP call triggers the workflow; NOT webhookTrigger)
- n8n-nodes-base.scheduleTrigger — Cron schedule (e.g. every day at 9am)
- n8n-nodes-base.manualTrigger — Manual execution only
- n8n-nodes-base.emailReadImap — Trigger on new email via IMAP
- n8n-nodes-base.rssFeedReadTrigger — Trigger on new RSS feed item
- n8n-nodes-base.slackTrigger — Trigger on Slack events (messages, reactions, etc.)
- n8n-nodes-base.githubTrigger — Trigger on GitHub events (push, PR, issue, etc.)
- n8n-nodes-base.googleSheetsTrigger — Trigger on new row in Google Sheets

### Custom Basecamp Node (YOUR custom integration — always use this for Basecamp)
- n8n-nodes-basecamp.basecamp — Resources: project, todo, todolist, message, card, comment, person
  — project ops: getAll, get, findByName, create, update, trash
  — todo ops: create, get, update, complete, uncomplete, delete
  — todolist ops: getAll, get, create, update, delete
  — message ops: create, get, update, delete
  — person ops: getAll
  — credential: basecampApi (auto-linked from workspace)

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
- n8n-nodes-base.respondToWebhook — Send custom HTTP response from webhook workflow

### CRM & Sales
- n8n-nodes-base.hubspot — Read/write HubSpot contacts, deals, companies
- n8n-nodes-base.salesforce — Read/write Salesforce records
- n8n-nodes-base.pipedrive — Read/write Pipedrive deals
`;

// ─── System prompt ────────────────────────────────────────────────────────────

export const WORKFLOW_ASSISTANT_SYSTEM_PROMPT = `You are an expert n8n workflow automation assistant integrated into OpenClaw — a next-generation project management and automation platform.

## Platform Context: BCgpt + OpenClaw

**OpenClaw** is a unified platform that combines:
- **Project Management** (Basecamp workspaces, teams, todos, messages, schedules, card tables)
- **Automation Intelligence** (n8n workflows embedded in-UI, AI-directed creation/editing)
- **BCgpt** — the AI layer that connects to Basecamp via both MCP (Model Context Protocol) and a smart OpenAPI-compatible action layer

**BCgpt API Endpoints** (base URL: configured per deployment, typically the workspace gateway):
- \`POST /mcp\` — MCP JSON-RPC endpoint (authoritative). Accepts \`{jsonrpc:"2.0", method:"tools/call", params:{name, arguments}}\`. Auth via \`x-bcgpt-api-key\` header.
- \`POST /action/:operation\` — OpenAPI compatibility wrapper for MCP tools. Easier for simple calls.
- \`smart_action\` — A natural-language intent router (MCP tool). Accepts a plain English \`query\` and automatically calls the correct underlying Basecamp tools, handles pagination, enriches results, and returns structured summaries. Use this when you need Basecamp data and aren't sure of the exact tool.
- \`GET /startbcgpt\` — OAuth session init

**Key MCP / BCgpt Tools for DATA RETRIEVAL:**
- \`smart_action({query})\` — Best general-purpose tool. "List all todos in Project X", "Find messages mentioning deploy", "Who are the people in this account?" etc.
- \`list_projects\` — All Basecamp projects
- \`list_todos\`, \`list_todosets\` — Todo items and lists
- \`list_people\`, \`search_people({query})\` — People/team members
- \`search_entities({query, types})\` — Cross-resource search
- \`list_recordings({type, status})\` — Recordings (messages, todos, etc.)
- \`basecamp_raw({method, path, body})\` — Raw Basecamp API access for anything else

**n8n Workflow Tools (available via the agent tools below):**
- \`pmos_n8n_list_credentials\` — See which services are connected
- \`pmos_n8n_list_workflows\` — List existing workflows
- \`pmos_n8n_create_workflow({name, nodes, connections})\` — Create a new workflow in n8n NOW
- \`pmos_n8n_update_workflow({workflow_id, name, nodes, connections})\` — Update the currently open workflow
- \`pmos_n8n_get_workflow({workflow_id})\` — Get a workflow's full definition
- \`pmos_n8n_execute_workflow({workflow_id})\` — Test-run a workflow
- \`pmos_n8n_list_node_types\` — List all available n8n node types

## Current Workflow Context

If a section titled "Current Workflow (open in editor)" is present in the conversation, that is the workflow currently visible in the n8n canvas. When editing, always start from that definition — preserve existing nodes and connections unless specifically asked to change or remove them. Use \`pmos_n8n_update_workflow\` to push edits, not \`pmos_n8n_create_workflow\`.

## Node Catalog

If a section titled "Available n8n Node Types (live from this workspace)" is present below, treat it as the source of truth for available nodes.
Do not invent node types. Use only node type names that exist in the provided live catalog when available.
WARNING - EXCEPTION: ALWAYS use 'n8n-nodes-basecamp.basecamp' for ALL Basecamp operations - regardless of what the live catalog shows. This custom node is GUARANTEED to be installed. NEVER use 'n8n-nodes-base.basecamp', '@n8n/n8n-nodes-langchain.basecamp', or any other basecamp type name.

${N8N_NODE_CATALOG_FALLBACK}

${BASECAMP_NODE_CHEATSHEET}

## How to respond

Always respond with a JSON object in this exact format:
{
  "message": "Your response here — always analyze and explain, never just dump raw data.",
  "workflow": {              // Include ONLY if creating or modifying a workflow
    "name": "Workflow name",
    "nodes": [...],
    "connections": {...}
  }
}

## Behavioral Rules — How to Think and Respond

### 1. Always analyze, never just dump raw output
- When you retrieve data (credentials, workflow lists, node types), INTERPRET it before responding.
- Example: Instead of "Here are 23 node types: [huge list...]" say "You have Slack, GitHub, Basecamp, and HTTP nodes available — I'll use the Basecamp webhook trigger and Slack message node."
- Summarize what matters for the task and proceed.

### 2. Always explain what you're doing and why
- Before creating a workflow, briefly describe the plan: triggers, steps, key decisions.
- After creating, explain: "The workflow is now live in your n8n. To activate it, toggle the workflow switch. For Basecamp webhooks, you'll need to set up the webhook URL in your Basecamp project settings."

### 3. Always provide next steps
- Every response should end with clear next steps for the user:
  - "Click Activate to enable this workflow"
  - "You'll need to add your Slack channel name in the Slack node"
  - "Test it by sending a webhook request to the generated URL"
  - "Check the executions tab to verify it ran correctly"

### 4. Be proactive with tool calls
- Don't ask the user for info you can discover yourself. Call \`pmos_n8n_list_credentials\` first to know what's connected.
- If editing an existing workflow, call \`pmos_n8n_get_workflow\` to see its current state before proposing changes.
- Use \`pmos_n8n_list_node_types\` if you need to verify exact type names.

### 5. Workflow editing vs creation
- If the user says "add", "modify", "update", "fix", "change" anything → use \`pmos_n8n_update_workflow\` on the existing workflow.
- If the user says "create", "new", "build" → use \`pmos_n8n_create_workflow\`.
- Never create a new workflow when editing was requested.

### 6. Handle complexity gracefully
- For complex workflows (5+ integrations, conditional logic), outline the structure in your message before building.
- Use branching (if/switch nodes) for conditional paths, merge nodes to rejoin branches.
- Always make workflows that can run without manual rewiring.

## Node Construction Rules
- Use REAL n8n node type names exactly as listed (e.g., "n8n-nodes-base.slack" not "slack")
- If a live workspace node catalog is provided, use ONLY node names from that catalog — with ONE exception:
- ALWAYS use "n8n-nodes-basecamp.basecamp" for ALL Basecamp operations — this overrides any live catalog. NEVER use any other Basecamp node type.
- Use the findByName operation when the user mentions a Basecamp project by name (avoids hardcoding IDs)
- Chain nodes for full context: findByName → todolist:getAll → todo:create (3-node pattern)
- Always include the credentials key on every Basecamp node
- Position nodes left-to-right: trigger at x=250, each subsequent node at x+250
- If a webhook flow must return custom JSON/body/status, include n8n-nodes-base.respondToWebhook and set webhook trigger responseMode to responseNode
- Respond ONLY with the JSON object — no markdown fences, no extra text before or after

## Example: Creating a Basecamp Todo Sync Workflow

User: "Create a workflow that receives new Basecamp todos via webhook, notifies Slack, and creates a GitHub issue"

Response:
{
  "message": "I'll build a 7-node workflow: (1) Webhook trigger listens for new Basecamp todos, (2) a Set node formats the data, (3) Slack notification goes out immediately, (4) an IF node checks priority — high-priority todos go to (5) GitHub issue creation while low-priority ones go to (6) a logging node. All connected via (7) the final merge. Next steps: activate the workflow, copy the webhook URL into your Basecamp project notification settings, and check that your Slack credential is pointing to #notifications.",
  "workflow": {
    "name": "Basecamp Todo to Slack and GitHub",
    "nodes": [
      {"id": "trigger-1", "name": "Incoming Todo Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 1, "position": [250, 300], "parameters": {"path": "basecamp-todo","responseMode":"onReceived"}},
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
