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
        () => reject(new Error(`json_body_timeout_${timeoutMs}ms â€” model may be streaming too slowly`)),
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

// â”€â”€â”€ Agentic tool-calling loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

export function summarizeAgentLoopToolResult(toolName: string, payload: unknown): string | null {
  if (isObjectRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
    return null;
  }
  switch (toolName) {
    case "bcgpt_list_projects":
      return summarizeProjectRows(readToolProjectRows(payload));
    case "bcgpt_smart_action":
      return summarizeSmartActionPayload(payload);
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
    "bcgpt_smart_action",
    "figma_get_context",
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

function buildAgentLoopEarlyExit(
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

  const terminalSummaries = successful
    .filter((result) => isTerminalToolSummary(result.name))
    .map((result) => summarizeAgentLoopToolResult(result.name, result.parsed))
    .filter((summary): summary is string => Boolean(summary));
  if (terminalSummaries.length === successful.length && terminalSummaries.length > 0) {
    return joinToolSummaries(terminalSummaries);
  }

  const basecampResults = successful.filter(
    (result) => result.name === "bcgpt_smart_action" || result.name === "bcgpt_list_projects",
  );
  if (!basecampResults.length || basecampResults.length !== successful.length) {
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
  } = {},
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

    // Build message array â€” tool messages interleaved after each tool call round
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
          // No tool calls â€” final text response
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

        // Execute each tool and append results
        for (const tc of toolCalls) {
          let toolResult: string;
          let parsedResult: unknown = null;
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments ?? "{}") as Record<string, unknown>;
            toolResult = await executeTool(tc.function.name, parsedArgs);
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

        const earlyExit = buildAgentLoopEarlyExit(roundResults);
        if (earlyExit) {
          return { ok: true, text: earlyExit, providerUsed };
        }
        // Loop continues with tool results injected
      }

      // Max iterations reached â€” return last assistant text if any
      const lastText = [...agentMessages]
        .reverse()
        .find((m) => m.role === "assistant" && m.content);
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
      succeeded = false;
    } catch {
      // try next model config
    }

    if (succeeded) break;
  }

  return { ok: false, error: "Model call failed for all configured providers." };
}

// â”€â”€â”€ n8n node catalog for the system prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
${triggers.map((n) => `- ${n.name} â€” ${n.description ?? n.displayName}`).join("\n")}

### Actions
${actions.map((n) => `- ${n.name} â€” ${n.description ?? n.displayName}`).join("\n")}
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

// â”€â”€â”€ Basecamp node cheatsheet (always injected â€” authoritative reference) â”€â”€â”€â”€â”€â”€

const BASECAMP_NODE_CHEATSHEET = `
## â­ Custom Basecamp Node â€” Complete Reference (n8n-nodes-basecamp.basecamp)

This is YOUR custom Basecamp integration node. It is ALWAYS available when Basecamp is connected.
Node type: \`n8n-nodes-basecamp.basecamp\`
Credential type: \`basecampApi\` (auto-linked â€” include "credentials" key in every Basecamp node)

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
- \`={{ $json.id.toString() }}\` â€” convert numeric Basecamp ID to string
- \`={{ $json.projectId }}\` â€” pass projectId from previous node output
- \`={{ $node["Get Projects"].json[0].id.toString() }}\` â€” access first item from a named node
- \`={{ $json.name }}\` â€” use the name field from previous output
- \`={{ $json.title }}\` â€” use the title field (for todos, cards)

### Design Patterns for Basecamp Workflows

**Pattern 1: Create todo from webhook data**
Webhook Trigger â†’ Set (format data) â†’ Basecamp (todo: create) â†’ Respond to Webhook

**Pattern 2: Auto-notify on new Basecamp data**
Schedule Trigger â†’ Basecamp (project: getAll) â†’ Split In Batches â†’ Basecamp (todo: getAll) â†’ Filter (check due soon) â†’ Slack (notify) / Gmail (send email)

**Pattern 3: Sync between Basecamp and other tools**
Webhook â†’ Basecamp (findByName project) â†’ Basecamp (todolist: getAll) â†’ Code (pick first list) â†’ Basecamp (todo: create) â†’ GitHub (issue: create)

**Pattern 4: Status board update**  
Schedule Trigger â†’ Basecamp (todo: getAll) â†’ Filter (completed) â†’ Google Sheets (append) â†’ Slack (summary)

### CRITICAL: When User Mentions Basecamp
- ALWAYS use \`n8n-nodes-basecamp.basecamp\` â€” never invent a different type name
- ALWAYS include the \`credentials\` key â€” the credential name will be auto-linked
- Use \`findByName\` operation when the user mentions a project by name (so runtime resolves the ID)
- Chain nodes: get project â†’ get todolists â†’ create todo (3-node pattern for full context)
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

  // Always inject the custom Basecamp node at the top â€” even if n8n's REST API doesn't surface it.
  const basecampCustomEntry = "- n8n-nodes-basecamp.basecamp | Basecamp (Custom BCgpt Node) | ALWAYS use this for ALL Basecamp operations";
  const customSection = customLines.length > 0
    ? [basecampCustomEntry, ...customLines.filter(l => !l.includes("n8n-nodes-basecamp"))].join("\n")
    : basecampCustomEntry;

  return `
## Available n8n Node Types (live from this workspace)
Use this live catalog as the source of truth for node type names.
âš ï¸ IMPORTANT: ALWAYS use \`n8n-nodes-basecamp.basecamp\` for ANY Basecamp operation â€” this is the custom BCgpt node. NEVER use \`n8n-nodes-base.basecamp\` or any other basecamp variant.

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
- n8n-nodes-base.webhook â€” HTTP webhook (any inbound HTTP call triggers the workflow; NOT webhookTrigger)
- n8n-nodes-base.scheduleTrigger â€” Cron schedule (e.g. every day at 9am)
- n8n-nodes-base.manualTrigger â€” Manual execution only
- n8n-nodes-base.emailReadImap â€” Trigger on new email via IMAP
- n8n-nodes-base.rssFeedReadTrigger â€” Trigger on new RSS feed item
- n8n-nodes-base.slackTrigger â€” Trigger on Slack events (messages, reactions, etc.)
- n8n-nodes-base.githubTrigger â€” Trigger on GitHub events (push, PR, issue, etc.)
- n8n-nodes-base.googleSheetsTrigger â€” Trigger on new row in Google Sheets

### Custom Basecamp Node (YOUR custom integration â€” always use this for Basecamp)
- n8n-nodes-basecamp.basecamp â€” Resources: project, todo, todolist, message, card, comment, person
  â€” project ops: getAll, get, findByName, create, update, trash
  â€” todo ops: create, get, update, complete, uncomplete, delete
  â€” todolist ops: getAll, get, create, update, delete
  â€” message ops: create, get, update, delete
  â€” person ops: getAll
  â€” credential: basecampApi (auto-linked from workspace)

### Communication
- n8n-nodes-base.slack â€” Send messages, create channels, update users (credentials: Slack OAuth)
- n8n-nodes-base.gmail â€” Send/read emails via Gmail (credentials: Google OAuth)
- n8n-nodes-base.emailSend â€” Send email via SMTP
- n8n-nodes-base.telegramBot â€” Send Telegram messages
- n8n-nodes-base.discord â€” Send Discord webhook messages
- n8n-nodes-base.microsoftTeams â€” Send Teams messages

### Data & Storage
- n8n-nodes-base.googleSheets â€” Read/write Google Sheets (credentials: Google OAuth)
- n8n-nodes-base.airtable â€” Read/write Airtable records
- n8n-nodes-base.notion â€” Read/write Notion pages/databases
- n8n-nodes-base.postgres â€” Query PostgreSQL databases
- n8n-nodes-base.mysql â€” Query MySQL databases
- n8n-nodes-base.redis â€” Get/set Redis values
- n8n-nodes-base.ftp â€” Upload/download files via FTP

### Project Management
- n8n-nodes-base.github â€” Issues, PRs, files, releases (credentials: GitHub PAT)
- n8n-nodes-base.jira â€” Create/update Jira issues
- n8n-nodes-base.trello â€” Manage Trello cards and lists
- n8n-nodes-base.asana â€” Create/update Asana tasks
- n8n-nodes-base.linear â€” Create/update Linear issues

### AI & Processing
- n8n-nodes-base.openAi â€” Call OpenAI API (chat, images, embeddings)
- n8n-nodes-base.httpRequest â€” Make any HTTP request (GET/POST/PUT/DELETE)
- n8n-nodes-base.code â€” Run custom JavaScript/Python code
- n8n-nodes-base.set â€” Set/transform field values
- n8n-nodes-base.if â€” Branch workflow based on a condition
- n8n-nodes-base.switch â€” Route to multiple branches
- n8n-nodes-base.merge â€” Merge data from multiple branches
- n8n-nodes-base.splitInBatches â€” Process items in batches
- n8n-nodes-base.filter â€” Keep only items matching a condition
- n8n-nodes-base.respondToWebhook â€” Send custom HTTP response from webhook workflow

### CRM & Sales
- n8n-nodes-base.hubspot â€” Read/write HubSpot contacts, deals, companies
- n8n-nodes-base.salesforce â€” Read/write Salesforce records
- n8n-nodes-base.pipedrive â€” Read/write Pipedrive deals
`;

// â”€â”€â”€ System prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const WORKFLOW_ASSISTANT_SYSTEM_PROMPT = `You are an expert workflow automation assistant integrated into OpenClaw.

## Platform Context

OpenClaw combines project management, BCgpt data access, and an embedded Activepieces / Flow workspace.
The workflow engine is Activepieces, not n8n.

## Data Sources And Tools

Use BCgpt tools when you need Basecamp or project data.
Use workflow-engine tools when you need Flow state:
- \`ops_credentials_list\` to inspect existing Activepieces connections
- \`ops_workflows_list\` to inspect workflows in the current workspace
- \`ops_workflow_get\` to inspect the open workflow or another workflow definition
- \`ops_pieces_list\` to inspect which pieces are available in this workspace
- \`ops_piece_get\` to inspect a specific piece's triggers and actions

If the runtime exposes additional workflow mutation tools in context, use them. Otherwise, return a draft workflow object for the UI to confirm and apply.

## Current Workflow Context

If a section titled "Current Workflow (open in editor)" is present in the conversation, that is the workflow currently visible in the Flow canvas. When editing, always start from that definition and preserve existing nodes and connections unless explicitly told to remove or replace them.

## Piece Catalog

If a section titled "Available Activepieces Pieces (live from this workspace)" is present, treat it as the source of truth.
Do not invent pieces, triggers, actions, or connection names.
If piece details are available, prefer those exact trigger and action identifiers.

Basecamp guidance:
- Prefer the real Basecamp piece when it exists in the live workspace catalog.
- If Basecamp is not available as a native piece, use webhook or HTTP-based patterns and say that clearly.
- Never refer to n8n-specific Basecamp node names.

${N8N_NODE_CATALOG_FALLBACK}

${BASECAMP_NODE_CHEATSHEET}

## Response Format

Always respond with a JSON object in this exact shape:
{
  "message": "Explain the plan, constraints, and next steps.",
  "workflow": {
    "name": "Workflow name",
    "nodes": [...],
    "connections": {...}
  }
}

Include \`workflow\` only when creating or modifying a workflow draft.

## Behavior Rules

1. Analyze before responding.
- Interpret connections, workflows, pieces, and piece details.
- Summarize what matters instead of dumping raw lists.

2. Use the current workspace reality.
- Prefer already-connected services from \`ops_credentials_list\`.
- If a required connection is missing, say so explicitly and still draft the workflow with a clear placeholder.

3. Editing vs creation.
- If the user wants to add, modify, update, fix, or change something, treat the current workflow as the base.
- If the user wants a new workflow, produce a new draft.
- Never replace an existing workflow with an unrelated one.

4. Keep Flow drafts practical.
- Prefer simple, reliable structures such as trigger -> transform -> action.
- Use webhook or schedule triggers when no native event trigger exists.
- Position nodes left-to-right with the trigger at x=250 and each following node at x+250.
- Keep nodes and connections valid JSON for the embedded Flow UI.

5. Always provide next steps in the message.
- Mention missing connections.
- Mention activation or testing.
- Mention where the user should verify runs.

6. Stay Activepieces-specific.
- Do not mention n8n nodes, n8n credentials, or n8n setup steps.
- Use real piece names and action/trigger identifiers from the workspace context.

Respond only with the JSON object. Do not add markdown fences or surrounding prose.`;
