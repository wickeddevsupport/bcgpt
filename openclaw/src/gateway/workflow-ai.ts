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
import { resolveMemoryOrchestrationConfig } from "../memory/orchestrator.js";
import { loadEffectiveWorkspaceConfig } from "./workspace-config.js";

type Message = { role: "user" | "assistant" | "system"; content: string };

interface ModelConfig {
  provider: string;
  modelId: string;
  apiKey: string;
}

const WORKFLOW_MODEL_CANDIDATE_LIMIT = 4;
const WORKFLOW_MODEL_CALL_TIMEOUT_MS = 25_000;
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
        () => reject(new Error(`json_body_timeout_${timeoutMs}ms â€" model may be streaming too slowly`)),
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
  opts: { preferredProviders?: string[] } = {},
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
  const preferredProviders = Array.isArray(opts.preferredProviders)
    ? opts.preferredProviders
        .map((provider) => normalizeProviderAlias(String(provider ?? "").trim()))
        .filter(Boolean)
    : [];

  const prioritizedResolved =
    preferredProviders.length > 0
      ? [
          ...resolved
            .filter((candidate) => preferredProviders.includes(candidate.provider))
            .sort(
              (a, b) =>
                preferredProviders.indexOf(a.provider) - preferredProviders.indexOf(b.provider),
            ),
          ...resolved.filter((candidate) => !preferredProviders.includes(candidate.provider)),
        ]
      : resolved;

  if (prioritizedResolved.length <= 1) {
    return prioritizedResolved.slice(0, WORKFLOW_MODEL_CANDIDATE_LIMIT);
  }

  const primary = prioritizedResolved[0];
  const remaining = prioritizedResolved.slice(1);
  const ordered: ModelConfig[] = [primary];
  const seenProvider = new Set<string>([primary.provider]);

  if (primary.provider === "kilo") {
    const alternateKilo = remaining.find((candidate) => candidate.provider === "kilo");
    if (alternateKilo) {
      ordered.push(alternateKilo);
    }
  }

  // Prefer trying different providers before retrying multiple models from one provider.
  for (const candidate of remaining) {
    if (ordered.includes(candidate) || seenProvider.has(candidate.provider)) {
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
  opts: { maxTokens?: number; jsonMode?: boolean; preferredProviders?: string[] } = {},
): Promise<{ ok: boolean; text?: string; error?: string; providerUsed?: string }> {
  const wsId = String(workspaceId ?? "").trim();
  const cfg = wsId
    ? ((await loadEffectiveWorkspaceConfig(wsId)) as OpenClawConfig)
    : loadConfig();
  const configs = await resolveModelConfigs(cfg, wsId || null, {
    preferredProviders: opts.preferredProviders,
  });
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

// â"€â"€â"€ Agentic tool-calling loop â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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

type AgentLoopToolRoundResult = {
  name: string;
  args: Record<string, unknown>;
  parsed: unknown;
  callCount: number;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  if (isObjectRecord(value)) {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseToolPayload(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function readToolProjectRows(payload: unknown): Array<{ name: string; status: string }> {
  const value = isObjectRecord(payload) && isObjectRecord(payload.result) ? payload.result : payload;
  if (isObjectRecord(value) && Array.isArray(value.projects)) {
    return value.projects
      .filter((project): project is Record<string, unknown> => isObjectRecord(project))
      .map((project) => ({
        name: typeof project.name === "string" ? project.name.trim() : "",
        status: typeof project.status === "string" && project.status.trim() ? project.status.trim() : "active",
      }))
      .filter((project) => project.name);
  }
  return [];
}

function summarizeProjectRows(projects: Array<{ name: string; status: string }>): string | null {
  if (!projects.length) {
    return "No Basecamp projects were found.";
  }
  const top = projects.slice(0, 5).map((project) => `${project.name} (${project.status})`);
  return `Basecamp projects (${projects.length}): ${top.join(", ")}${projects.length > top.length ? ", ..." : ""}.`;
}

function summarizeSmartActionPayload(payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  const result = isObjectRecord(payload.result) ? payload.result : payload;
  const directSummary =
    (typeof payload.summary === "string" && payload.summary.trim()) ||
    (typeof result.summary === "string" && result.summary.trim()) ||
    (typeof result.note === "string" && result.note.trim());
  if (directSummary) {
    return directSummary;
  }

  const projects = readToolProjectRows(result);
  if (projects.length) {
    return summarizeProjectRows(projects);
  }

  const project = isObjectRecord(result.project) ? result.project : null;
  const projectName = typeof project?.name === "string" ? project.name.trim() : "";
  const action = typeof result.action === "string" ? result.action.trim() : "";
  const todoSummary = isObjectRecord(result.result) && isObjectRecord(result.result.todo_summary)
    ? result.result.todo_summary
    : isObjectRecord(result.todo_summary)
      ? result.todo_summary
      : null;
  const totalOpen = typeof todoSummary?.total_open === "number" ? todoSummary.total_open : null;
  if (projectName && totalOpen != null) {
    return `${projectName}: ${totalOpen} open Basecamp tasks${action ? ` via ${action}` : ""}.`;
  }
  if (projectName && action) {
    return `${projectName}: Basecamp ${action.replace(/_/g, " ")} completed.`;
  }
  if (action) {
    return `Basecamp ${action.replace(/_/g, " ")} completed.`;
  }
  return null;
}

function summarizeBasecampRawPayload(payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  const summary =
    (typeof payload.summary === "string" && payload.summary.trim()) ||
    (typeof payload.contentText === "string" && payload.contentText.trim()) ||
    null;
  if (summary) {
    return summary;
  }
  const method = typeof payload.method === "string" ? payload.method.trim().toUpperCase() : "GET";
  const path = typeof payload.path === "string" ? payload.path.trim() : "";
  return path ? `Basecamp raw ${method} ${path} completed.` : null;
}

function summarizeBcgptToolCatalogPayload(payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  const directSummary = typeof payload.summary === "string" && payload.summary.trim()
    ? payload.summary.trim()
    : null;
  if (directSummary) {
    return directSummary;
  }
  const tools = Array.isArray(payload.tools)
    ? payload.tools
        .filter((tool): tool is Record<string, unknown> => isObjectRecord(tool))
        .map((tool) => (typeof tool.name === "string" ? tool.name.trim() : ""))
        .filter(Boolean)
    : [];
  if (!tools.length) {
    return null;
  }
  const top = tools.slice(0, 6);
  return `Basecamp MCP tools available (${tools.length}): ${top.join(", ")}${tools.length > top.length ? ", ..." : ""}.`;
}

function summarizeBcgptDirectCallPayload(payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  const directSummary = typeof payload.summary === "string" && payload.summary.trim()
    ? payload.summary.trim()
    : null;
  if (directSummary) {
    return directSummary;
  }
  const tool = typeof payload.tool === "string" ? payload.tool.trim() : "";
  return tool ? `Basecamp ${tool} completed.` : null;
}

function summarizeCountedNames(
  label: string,
  items: Array<{ name: string; count?: number | null }>,
): string | null {
  if (!items.length) {
    return `${label}: none found.`;
  }
  const top = items
    .slice(0, 5)
    .map((item) => `${item.name}${typeof item.count === "number" ? ` (${item.count})` : ""}`);
  return `${label} (${items.length}): ${top.join(", ")}${items.length > top.length ? ", ..." : ""}.`;
}

function flattenFolderTree(
  value: unknown,
  into: Array<{ name: string; count?: number | null }> = [],
): Array<{ name: string; count?: number | null }> {
  if (!Array.isArray(value)) {
    return into;
  }
  for (const entry of value) {
    if (!isObjectRecord(entry)) {
      continue;
    }
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const count =
      typeof entry.fileCount === "number"
        ? entry.fileCount
        : typeof entry.file_count === "number"
          ? entry.file_count
          : null;
    if (name) {
      into.push({ name, count });
    }
    flattenFolderTree(entry.children, into);
  }
  return into;
}

function summarizeFigmaContextPayload(payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  const connected = payload.connected === true;
  const fileName = typeof payload.selectedFileName === "string" ? payload.selectedFileName.trim() : "";
  const connectionName =
    typeof payload.activeConnectionName === "string" ? payload.activeConnectionName.trim() : "";
  const patReady = payload.hasPersonalAccessToken === true;
  if (connected && fileName) {
    return `Figma is connected${connectionName ? ` via ${connectionName}` : ""}. Selected file: ${fileName}. PAT audit ready: ${patReady ? "yes" : "no"}.`;
  }
  if (connected) {
    return `Figma is connected${connectionName ? ` via ${connectionName}` : ""}, but no selected file is synced yet.`;
  }
  return "Figma is not connected in this workspace yet.";
}

function summarizeFigmaRestAuditPayload(payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  const file = isObjectRecord(payload.file) ? payload.file : null;
  const summary = isObjectRecord(payload.summary) ? payload.summary : null;
  const autoLayout = isObjectRecord(payload.autoLayout) ? payload.autoLayout : null;
  const typography = isObjectRecord(payload.typography) ? payload.typography : null;
  const issues = Array.isArray(payload.issues)
    ? payload.issues.filter((value): value is string => typeof value === "string" && value.trim()).slice(0, 2)
    : [];
  const fileName = typeof file?.name === "string" ? file.name.trim() : "selected Figma file";
  const requestedFocus =
    typeof payload.requestedFocus === "string" && payload.requestedFocus.trim()
      ? payload.requestedFocus.trim()
      : "general";
  const summaryBits: string[] = [];
  if (typeof summary?.pages === "number" && typeof summary?.totalNodes === "number") {
    summaryBits.push(`${summary.pages} page(s), ${summary.totalNodes} nodes`);
  }
  if (typeof summary?.componentsDefined === "number") {
    summaryBits.push(`${summary.componentsDefined} components`);
  }
  if (typeof summary?.componentSetsDefined === "number") {
    summaryBits.push(`${summary.componentSetsDefined} component sets`);
  }
  if (typeof autoLayout?.autoLayoutContainers === "number") {
    summaryBits.push(`${autoLayout.autoLayoutContainers} auto-layout containers`);
  }
  if (typeof typography?.uniqueFontFamilies === "number") {
    summaryBits.push(`${typography.uniqueFontFamilies} font families`);
  }
  const firstSentence = `Figma ${requestedFocus} audit for ${fileName}: ${summaryBits.join(", ") || "audit completed"}.`;
  if (!issues.length) {
    return firstSentence;
  }
  return `${firstSentence} Key issue${issues.length === 1 ? "" : "s"}: ${issues.join(" ")}`;
}

function summarizeFmContextPayload(payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  const user = isObjectRecord(payload.user) ? payload.user : null;
  const activeConnection = isObjectRecord(payload.activeConnection) ? payload.activeConnection : null;
  const stats = isObjectRecord(payload.stats) ? payload.stats : null;
  const identity = typeof user?.handle === "string" ? user.handle.trim() : typeof user?.email === "string" ? user.email.trim() : "user";
  const connectionName = typeof activeConnection?.name === "string" ? activeConnection.name.trim() : "";
  const files = typeof stats?.files === "number" ? stats.files : 0;
  const tags = typeof stats?.tags === "number" ? stats.tags : 0;
  const folders = typeof stats?.folders === "number" ? stats.folders : 0;
  const categories = typeof stats?.categories === "number" ? stats.categories : 0;
  return `FM is ready for ${identity}${connectionName ? ` on ${connectionName}` : ""}. Indexed items: ${files} files, ${tags} tags, ${folders} folders, ${categories} categories.`;
}

function summarizeFmFileRows(payload: unknown): string | null {
  if (!isObjectRecord(payload) || !Array.isArray(payload.files)) {
    return null;
  }
  const rows = payload.files
    .filter((entry): entry is Record<string, unknown> => isObjectRecord(entry))
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name.trim() : "",
    }))
    .filter((entry) => entry.name)
    .map((entry) => ({ name: entry.name }));
  if (!rows.length) {
    return "FM files: none found for the current filter.";
  }
  const total = typeof payload.total === "number" ? payload.total : rows.length;
  const top = rows.slice(0, 5).map((entry) => entry.name);
  return `FM files (${total}): ${top.join(", ")}${total > top.length ? ", ..." : ""}.`;
}

function summarizeFmFilePayload(payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    return null;
  }
  const tags = Array.isArray(payload.tags) ? payload.tags.length : 0;
  const folders = Array.isArray(payload.folders) ? payload.folders.length : 0;
  const links = Array.isArray(payload.links) ? payload.links.length : 0;
  const category = isObjectRecord(payload.category) && typeof payload.category.name === "string"
    ? payload.category.name.trim()
    : "";
  return `${name}: category ${category || "none"}, ${tags} tag(s), ${folders} folder(s), ${links} link(s).`;
}

function summarizeFmSyncStatusPayload(payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  if (payload.queued === true) {
    return "FM team sync has been queued.";
  }
  const syncing = payload.syncing === true;
  const queued = payload.queued === true;
  const connectionName =
    typeof payload.connection_name === "string" ? payload.connection_name.trim() : "active connection";
  const lastSyncedAt =
    typeof payload.last_synced_at === "string" && payload.last_synced_at.trim()
      ? payload.last_synced_at.trim()
      : null;
  return `${connectionName}: sync status ${syncing ? "running" : queued ? "queued" : "idle"}${lastSyncedAt ? `, last synced ${lastSyncedAt}` : ""}.`;
}

function summarizeFmMutationPayload(prefix: string, payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  if (payload.deleted === true) {
    return `${prefix} deleted successfully.`;
  }
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const created = payload.created === true ? " created" : payload.created === false ? " already existed" : " updated";
  if (name) {
    return `${prefix} ${name}${created}.`;
  }
  return null;
}

function joinToolSummaries(summaries: string[]): string | null {
  const unique = [...new Set(summaries.map((summary) => summary.trim()).filter(Boolean))];
  if (!unique.length) {
    return null;
  }
  return unique.slice(0, 3).join(" ");
}

function truncateForSynthesis(value: string, maxChars = 2000): string {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
}

function summarizeToolResultForSynthesis(result: AgentLoopToolRoundResult): Record<string, unknown> {
  const parsedPreview =
    typeof result.parsed === "string"
      ? truncateForSynthesis(result.parsed, 1200)
      : truncateForSynthesis(JSON.stringify(result.parsed), 1200);
  return {
    tool: result.name,
    args: result.args,
    callCount: result.callCount,
    summary: summarizeAgentLoopToolResult(result.name, result.parsed),
    parsedPreview,
  };
}

function extractSufficientToolSummary(payload: unknown): string | null {
  if (!isObjectRecord(payload)) {
    return null;
  }
  if (payload.sufficient !== true) {
    return null;
  }
  const result = isObjectRecord(payload.result) ? payload.result : null;
  const directSummary =
    (typeof payload.summary === "string" && payload.summary.trim()) ||
    (typeof result?.summary === "string" && result.summary.trim()) ||
    (typeof result?.note === "string" && result.note.trim()) ||
    (typeof payload.note === "string" && payload.note.trim()) ||
    null;
  return directSummary;
}

function shouldContinueAgentLoop(payload: unknown): boolean {
  return isObjectRecord(payload) && payload.continueAgentLoop === true;
}

export function summarizeAgentLoopToolResult(toolName: string, payload: unknown): string | null {
  if (isObjectRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
    return null;
  }
  switch (toolName) {
    case "bcgpt_list_projects":
      return summarizeProjectRows(readToolProjectRows(payload));
    case "bcgpt_list_tools":
      return summarizeBcgptToolCatalogPayload(payload);
    case "bcgpt_mcp_call":
      return summarizeBcgptDirectCallPayload(payload);
    case "bcgpt_smart_action":
      return summarizeSmartActionPayload(payload);
    case "bcgpt_basecamp_raw":
      return summarizeBasecampRawPayload(payload);
    case "figma_get_context":
      return summarizeFigmaContextPayload(payload);
    case "figma_pat_audit_file":
      return summarizeFigmaRestAuditPayload(payload);
    case "fm_get_context":
      return summarizeFmContextPayload(payload);
    case "fm_list_files":
      return summarizeFmFileRows(payload);
    case "fm_get_file":
    case "fm_update_file":
      return summarizeFmFilePayload(payload);
    case "fm_list_tags":
      return summarizeCountedNames(
        "FM tags",
        Array.isArray(payload)
          ? payload
              .filter((entry): entry is Record<string, unknown> => isObjectRecord(entry))
              .map((entry) => ({
                name: typeof entry.name === "string" ? entry.name.trim() : "",
                count:
                  typeof entry.fileCount === "number"
                    ? entry.fileCount
                    : typeof entry.file_count === "number"
                      ? entry.file_count
                      : null,
              }))
              .filter((entry) => entry.name)
          : [],
      );
    case "fm_list_categories":
      return summarizeCountedNames(
        "FM categories",
        Array.isArray(payload)
          ? payload
              .filter((entry): entry is Record<string, unknown> => isObjectRecord(entry))
              .map((entry) => ({
                name: typeof entry.name === "string" ? entry.name.trim() : "",
                count:
                  typeof entry.fileCount === "number"
                    ? entry.fileCount
                    : typeof entry.file_count === "number"
                      ? entry.file_count
                      : null,
              }))
              .filter((entry) => entry.name)
          : [],
      );
    case "fm_list_folders":
      return summarizeCountedNames("FM folders", flattenFolderTree(payload));
    case "fm_get_sync_status":
    case "fm_sync_team":
      return summarizeFmSyncStatusPayload(payload);
    case "fm_create_tag":
    case "fm_rename_tag":
      return summarizeFmMutationPayload("FM tag", payload);
    case "fm_delete_tag":
      return summarizeFmMutationPayload("FM tag", payload);
    case "fm_create_folder":
    case "fm_rename_folder":
      return summarizeFmMutationPayload("FM folder", payload);
    case "fm_create_category":
      return summarizeFmMutationPayload("FM category", payload);
    case "fm_add_link":
      return isObjectRecord(payload) && typeof payload.url === "string"
        ? `FM link added: ${payload.url}.`
        : null;
    case "fm_delete_link":
      return summarizeFmMutationPayload("FM link", payload);
    default:
      return null;
  }
}

function isTerminalToolSummary(name: string): boolean {
  return new Set([
    "bcgpt_list_projects",
    "bcgpt_mcp_call",
    "bcgpt_smart_action",
    "bcgpt_basecamp_raw",
    "figma_pat_audit_file",
    "fm_get_context",
    "fm_list_files",
    "fm_get_file",
    "fm_update_file",
    "fm_list_tags",
    "fm_list_folders",
    "fm_list_categories",
    "fm_create_tag",
    "fm_rename_tag",
    "fm_delete_tag",
    "fm_create_folder",
    "fm_rename_folder",
    "fm_create_category",
    "fm_add_link",
    "fm_delete_link",
    "fm_sync_team",
    "fm_get_sync_status",
  ]).has(name);
}

function isPreparatoryToolSummary(name: string): boolean {
  return name === "figma_get_context" || name === "bcgpt_list_tools";
}

export function buildAgentLoopEarlyExit(
  toolResults: AgentLoopToolRoundResult[],
): string | null {
  const successful = toolResults.filter((result) => {
    const parsed = result.parsed;
    return !(isObjectRecord(parsed) && typeof parsed.error === "string" && parsed.error.trim());
  });
  if (!successful.length) {
    return null;
  }

  for (const result of successful) {
    const sufficientSummary = extractSufficientToolSummary(result.parsed);
    if (sufficientSummary) {
      return sufficientSummary;
    }
  }

  const repeatedSummaries = successful
    .filter((result) => result.callCount > 1)
    .map((result) => summarizeAgentLoopToolResult(result.name, result.parsed))
    .filter((summary): summary is string => Boolean(summary));
  const repeatedSummary = joinToolSummaries(repeatedSummaries);
  if (repeatedSummary) {
    return repeatedSummary;
  }

  const actionableSuccessful = successful.filter((result) => !isPreparatoryToolSummary(result.name));
  const terminalAutoExitCandidates = actionableSuccessful
    .filter((result) => isTerminalToolSummary(result.name) && !shouldContinueAgentLoop(result.parsed));
  const terminalSummaries = terminalAutoExitCandidates
    .map((result) => summarizeAgentLoopToolResult(result.name, result.parsed))
    .filter((summary): summary is string => Boolean(summary));
  if (terminalAutoExitCandidates.length > 0 && terminalSummaries.length === actionableSuccessful.length) {
    return joinToolSummaries(terminalSummaries);
  }

  const basecampResults = successful.filter(
    (result) =>
      result.name === "bcgpt_smart_action" ||
      result.name === "bcgpt_list_projects" ||
      result.name === "bcgpt_mcp_call",
  );
  if (!basecampResults.length || basecampResults.length !== successful.length) {
    return null;
  }
  if (basecampResults.some((result) => shouldContinueAgentLoop(result.parsed))) {
    return null;
  }

  const repeated = basecampResults.find((result) => result.callCount > 1);
  if (repeated) {
    return (
      summarizeAgentLoopToolResult(repeated.name, repeated.parsed) ??
      "Basecamp data was retrieved successfully."
    );
  }

  for (const result of basecampResults) {
    const summary = summarizeAgentLoopToolResult(result.name, result.parsed);
    if (summary) {
      return summary;
    }
  }
  return "Basecamp data was retrieved successfully.";
}

async function orchestrateAgentLoopEvidence(
  cfg: OpenClawConfig,
  userMessages: Array<{ role: "user" | "assistant"; content: string }>,
  evidence: Array<Record<string, unknown>>,
): Promise<{
  summary: string;
  results: Array<Record<string, unknown>>;
  provider: string;
  model: string;
} | null> {
  const resolved = resolveMemoryOrchestrationConfig(cfg);
  if (!resolved || evidence.length === 0 || resolved.provider !== "ollama") {
    return null;
  }

  const candidates = evidence.slice(0, resolved.maxCandidates);
  const query = [...userMessages]
    .reverse()
    .find((message) => message.role === "user")
    ?.content?.trim() ?? "";
  const lines = [
    "You are curating tool-result evidence for an AI orchestration loop.",
    "Return JSON only.",
    `Choose up to ${Math.min(resolved.maxResults, candidates.length)} evidence ids that best help answer the user's request.`,
    'Schema: {"keepIds":["1"],"summary":"short summary"}',
    `User request: ${query}`,
    "Evidence:",
    ...candidates.map((entry, index) => {
      const summary =
        typeof entry.summary === "string" ? entry.summary : JSON.stringify(entry.summary ?? "");
      const preview =
        typeof entry.parsedPreview === "string"
          ? entry.parsedPreview
          : JSON.stringify(entry.parsedPreview ?? "");
      return `${index + 1}|tool=${String(entry.tool ?? "").trim()}|summary=${truncateForSynthesis(summary, 200)}|preview=${truncateForSynthesis(preview, resolved.maxSnippetChars)}`;
    }),
    "Return the most useful evidence ids in ranked order and a concise summary under 160 characters.",
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolved.timeoutMs);
  try {
    const response = await fetch(`${resolved.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: resolved.model,
        stream: false,
        raw: true,
        format: "json",
        prompt: lines.join("\n"),
        options: {
          temperature: 0,
          num_predict: 220,
          stop: ["\n\n"],
        },
      }),
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { response?: string };
    const trimmed = typeof payload.response === "string" ? payload.response.trim() : "";
    if (!trimmed) {
      return null;
    }
    const parsed = JSON.parse(trimmed) as { keepIds?: unknown; summary?: unknown };
    const keepIds = Array.isArray(parsed.keepIds)
      ? parsed.keepIds.map((entry) => String(entry).trim()).filter(Boolean)
      : [];
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : null;
    if (!keepIds.length || !summary) {
      return null;
    }
    const byId = new Map(candidates.map((entry, index) => [String(index + 1), entry]));
    const selected = keepIds
      .map((id) => byId.get(id))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .slice(0, resolved.maxResults);
    if (!selected.length) {
      return null;
    }
    return {
      summary,
      results: selected,
      provider: resolved.provider,
      model: resolved.model,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesizeAgentLoopResult(
  cfg: OpenClawConfig,
  workspaceId: string,
  baseSystemPrompt: string,
  userMessages: Array<{ role: "user" | "assistant"; content: string }>,
  allToolResults: AgentLoopToolRoundResult[],
): Promise<{ ok: boolean; text?: string; error?: string; providerUsed?: string }> {
  if (!allToolResults.length) {
    return { ok: false, error: "No tool results available for synthesis." };
  }

  const evidence = allToolResults.slice(-10).map(summarizeToolResultForSynthesis);
  const orchestratedEvidence = await orchestrateAgentLoopEvidence(cfg, userMessages, evidence);
  const finalEvidence = orchestratedEvidence?.results ?? evidence;
  const synthesisSystemPrompt = [
    baseSystemPrompt,
    "",
    "## Synthesis Mode",
    "- The main agent loop already gathered tool evidence but did not finish with a final answer.",
    "- Use the tool evidence to produce the best possible final answer now.",
    "- Reconcile the evidence, identify what matters, and answer the user's actual request.",
    "- If evidence is incomplete, state the exact gap and the most useful next probe.",
    "- Do not output internal tool traces or ask the user to repeat the request.",
  ].join("\n");

  const synthesisMessages: Message[] = [
    ...userMessages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: "user",
      content: [
        orchestratedEvidence
          ? `Local tool-result orchestration via ${orchestratedEvidence.provider}/${orchestratedEvidence.model} selected ${finalEvidence.length} of ${evidence.length} evidence items. Summary: ${orchestratedEvidence.summary}`
          : "Tool evidence gathered by the prior orchestration loop:",
        JSON.stringify(finalEvidence, null, 2),
        "Produce the final answer from this evidence.",
      ].join("\n\n"),
    },
  ];

  return callWorkspaceModel(workspaceId, synthesisSystemPrompt, synthesisMessages, {
    maxTokens: 2048,
  });
}

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
  opts: {
    maxTokens?: number;
    maxIterations?: number;
    initialToolChoice?: "auto" | { type: "function"; function: { name: string } };
    allowToolResultEarlyExit?: boolean;
    agentId?: string;
  } = {},
): Promise<{ ok: boolean; text?: string; error?: string; providerUsed?: string }> {
  const wsId = String(workspaceId ?? "").trim();
  const cfg = wsId
    ? ((await loadEffectiveWorkspaceConfig(wsId)) as OpenClawConfig)
    : loadConfig();
  let configs = await resolveModelConfigs(cfg, wsId || null);

  // If an agentId is provided, resolve the agent's preferred model and prepend it.
  if (opts.agentId) {
    try {
      const { resolveAgentModelPrimary } = await import("../agents/agent-scope.js");
      const agentModelRef = resolveAgentModelPrimary(cfg, opts.agentId);
      if (agentModelRef) {
        const parsed = parsePrimaryRef(agentModelRef);
        if (parsed) {
          const apiKey = await resolveProviderApiKey(parsed.provider, cfg, wsId);
          if (apiKey) {
            const key = `${parsed.provider}/${parsed.modelId}`;
            configs = configs.filter((c) => `${c.provider}/${c.modelId}` !== key);
            configs.unshift({ provider: parsed.provider, modelId: parsed.modelId, apiKey });
          }
        }
      }
    } catch {
      // Best-effort agent model resolution; fall through to workspace defaults.
    }
  }

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

    // Build message array â€" tool messages interleaved after each tool call round
    const agentMessages: Array<Record<string, unknown>> = [
      { role: "system", content: systemPrompt },
      ...userMessages.map((m) => ({ role: m.role, content: m.content })),
    ];

    let providerUsed = provider;
    let succeeded = false;

    const toolCallCounts = new Map<string, number>();
    const allToolResults: AgentLoopToolRoundResult[] = [];

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        const body: Record<string, unknown> = {
          model: modelId,
          messages: agentMessages,
          max_tokens: maxTokens,
          temperature: 0.35,
          tools,
          tool_choice:
            iteration === 0 && opts.initialToolChoice
              ? opts.initialToolChoice
              : "auto",
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
              reasoning?: string | null;
              tool_calls?: AssistantToolCall[];
            };
            finish_reason?: string;
          }>;
        }>(res, WORKFLOW_MODEL_CALL_TIMEOUT_MS);

        const assistantMsg = data.choices?.[0]?.message;
        if (!assistantMsg) break;

        try {
          console.debug(
            "[workflow-ai] agent-loop response",
            JSON.stringify({
              workspaceId: wsId,
              provider,
              modelId,
              iteration,
              finishReason: data.choices?.[0]?.finish_reason ?? null,
              hasContent: typeof assistantMsg.content === "string" && assistantMsg.content.trim().length > 0,
              contentLength: typeof assistantMsg.content === "string" ? assistantMsg.content.length : 0,
              hasReasoning:
                typeof assistantMsg.reasoning === "string" && assistantMsg.reasoning.trim().length > 0,
              reasoningPreview:
                typeof assistantMsg.reasoning === "string"
                  ? assistantMsg.reasoning.slice(0, 160)
                  : null,
              toolCalls:
                Array.isArray(assistantMsg.tool_calls) && assistantMsg.tool_calls.length
                  ? assistantMsg.tool_calls.map((tc) => tc.function.name)
                  : [],
            }),
          );
        } catch {
          // best-effort debug logging only
        }

        const toolCalls = assistantMsg.tool_calls;

        if (!toolCalls?.length) {
          // No tool calls -- final text response
          const finalText = (assistantMsg.content ?? "").trim();
          if (!finalText && allToolResults.length) {
            // Model returned empty text but tools ran -- synthesize from results
            const toolFallback = joinToolSummaries(
              allToolResults
                .map((r) => summarizeAgentLoopToolResult(r.name, r.parsed))
                .filter((s): s is string => Boolean(s)),
            );
            return {
              ok: true,
              text: toolFallback || "I completed the requested operations successfully.",
              providerUsed,
            };
          }
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

        const roundResults: AgentLoopToolRoundResult[] = [];

        // Deduplicate tool calls within a single round -- if the model calls the
        // same tool with the same args multiple times, only execute once and reuse
        // the result for all duplicates.
        const roundCache = new Map<string, string>();

        // Execute each tool and append results
        for (const tc of toolCalls) {
          let toolResult: string;
          let parsedResult: unknown = null;
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments ?? "{}") as Record<string, unknown>;
            const roundSig = `${tc.function.name}:${stableSerialize(parsedArgs)}`;
            const cached = roundCache.get(roundSig);
            if (cached !== undefined) {
              toolResult = cached;
            } else {
              toolResult = await executeTool(tc.function.name, parsedArgs);
              roundCache.set(roundSig, toolResult);
            }
          } catch (err) {
            toolResult = JSON.stringify({
              error: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
          parsedResult = parseToolPayload(toolResult);
          const signature = `${tc.function.name}:${stableSerialize(parsedArgs)}`;
          const callCount = (toolCallCounts.get(signature) ?? 0) + 1;
          toolCallCounts.set(signature, callCount);
          roundResults.push({
            name: tc.function.name,
            args: parsedArgs,
            parsed: parsedResult,
            callCount,
          });
          allToolResults.push({
            name: tc.function.name,
            args: parsedArgs,
            parsed: parsedResult,
            callCount,
          });
          agentMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: toolResult,
          });
        }

        const earlyExit = opts.allowToolResultEarlyExit
          ? buildAgentLoopEarlyExit(roundResults)
          : null;
        if (earlyExit) {
          return { ok: true, text: earlyExit, providerUsed };
        }
        // Loop continues with tool results injected
      }

      if (allToolResults.length) {
        const synthesized = await synthesizeAgentLoopResult(
          cfg,
          workspaceId,
          systemPrompt,
          userMessages,
          allToolResults,
        );
        if (synthesized.ok && typeof synthesized.text === "string" && synthesized.text.trim()) {
          return synthesized;
        }
      }

      // Max iterations reached â€" return last assistant text if any
      const lastText = [...agentMessages]
        .reverse()
        .find((m) => m.role === "assistant" && m.content && !Array.isArray(m.tool_calls));
      if (lastText?.content) {
        return { ok: true, text: String(lastText.content), providerUsed };
      }
      const fallbackToolSummary = joinToolSummaries(
        allToolResults
          .map((result) => summarizeAgentLoopToolResult(result.name, result.parsed))
          .filter((summary): summary is string => Boolean(summary)),
      );
      if (fallbackToolSummary) {
        return { ok: true, text: fallbackToolSummary, providerUsed };
      }
      // Last resort: tools ran but no summary could be generated
      if (allToolResults.length) {
        return {
          ok: true,
          text: "I completed the requested operations successfully.",
          providerUsed,
        };
      }
      succeeded = false;
    } catch {
      // try next model config
    }

    if (succeeded) break;
  }

  return { ok: false, error: "Model call failed for all configured providers." };
}


