import type { OpenClawConfig } from "../config/config.js";
import type { MemorySearchResult } from "./types.js";

export type ResolvedMemoryOrchestrationConfig = {
  enabled: boolean;
  provider: "ollama";
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxCandidates: number;
  maxResults: number;
  maxSnippetChars: number;
};

export type MemoryOrchestrationResult = {
  summary: string;
  results: MemorySearchResult[];
  provider: string;
  model: string;
};

const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_MAX_CANDIDATES = 6;
const DEFAULT_MAX_RESULTS = 4;
const DEFAULT_MAX_SNIPPET_CHARS = 280;

export function resolveMemoryOrchestrationConfig(
  cfg: OpenClawConfig,
): ResolvedMemoryOrchestrationConfig | null {
  const raw = cfg.memory?.orchestration;
  if (!raw?.enabled) {
    return null;
  }
  const baseUrl = trimToNull(raw.baseUrl);
  const model = trimToNull(raw.model);
  if (!baseUrl || !model) {
    return null;
  }
  return {
    enabled: true,
    provider: raw.provider ?? "ollama",
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    timeoutMs: clampPositiveInt(raw.timeoutMs, DEFAULT_TIMEOUT_MS),
    maxCandidates: clampPositiveInt(raw.maxCandidates, DEFAULT_MAX_CANDIDATES),
    maxResults: clampPositiveInt(raw.maxResults, DEFAULT_MAX_RESULTS),
    maxSnippetChars: clampPositiveInt(raw.maxSnippetChars, DEFAULT_MAX_SNIPPET_CHARS),
  };
}

export async function orchestrateMemoryResults(params: {
  cfg: OpenClawConfig;
  query: string;
  results: MemorySearchResult[];
}): Promise<MemoryOrchestrationResult | null> {
  const resolved = resolveMemoryOrchestrationConfig(params.cfg);
  if (!resolved || params.results.length === 0) {
    return null;
  }
  if (resolved.provider !== "ollama") {
    return null;
  }
  const candidates = params.results.slice(0, resolved.maxCandidates);
  const prompt = buildPrompt({
    query: params.query,
    candidates,
    maxResults: Math.min(resolved.maxResults, candidates.length),
    maxSnippetChars: resolved.maxSnippetChars,
  });
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
        prompt,
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
    const parsed = parseResponse(payload.response);
    if (!parsed) {
      return null;
    }
    const byId = new Map(candidates.map((entry, index) => [String(index + 1), entry]));
    const selected = parsed.keepIds
      .map((id) => byId.get(id))
      .filter((entry): entry is MemorySearchResult => Boolean(entry))
      .slice(0, resolved.maxResults);
    if (selected.length === 0) {
      return null;
    }
    return {
      summary: parsed.summary,
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

function buildPrompt(params: {
  query: string;
  candidates: MemorySearchResult[];
  maxResults: number;
  maxSnippetChars: number;
}): string {
  const lines = [
    "You are ranking durable agent memory snippets for retrieval.",
    "Return JSON only.",
    `Choose up to ${params.maxResults} candidate ids that best answer the query.`,
    "Prefer snippets that are specific, durable, and directly relevant.",
    'Schema: {"keepIds":["1"],"summary":"short summary"}',
    `Query: ${params.query.trim()}`,
    "Candidates:",
    ...params.candidates.map((entry, index) => {
      const snippet = compressWhitespace(entry.snippet).slice(0, params.maxSnippetChars);
      return `${index + 1}|score=${entry.score.toFixed(3)}|source=${entry.source}|path=${entry.path}#L${entry.startLine}-L${entry.endLine}|snippet=${snippet}`;
    }),
    "Return the most relevant ids in ranked order and a summary under 160 characters.",
  ];
  return lines.join("\n");
}

function parseResponse(raw: string | undefined): { keepIds: string[]; summary: string } | null {
  const trimmed = trimToNull(raw);
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as { keepIds?: unknown; summary?: unknown };
    const keepIds = Array.isArray(parsed.keepIds)
      ? parsed.keepIds.map((entry) => String(entry).trim()).filter(Boolean)
      : [];
    const summary = trimToNull(typeof parsed.summary === "string" ? parsed.summary : "") ?? "";
    if (keepIds.length === 0 || !summary) {
      return null;
    }
    return { keepIds, summary };
  } catch {
    return null;
  }
}

function compressWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clampPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
