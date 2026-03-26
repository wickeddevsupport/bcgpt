import type { ModelDefinitionConfig } from "../config/types.js";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8192;

// Only expose zero-premium-request models (0x multiplier on paid Copilot plans).
// GPT-4.1, GPT-4o, and GPT-5 mini are free/unlimited. All other models (gpt-4.1-mini,
// gpt-4.1-nano, Claude, Gemini, etc.) consume premium quota and are excluded.
const DEFAULT_MODEL_IDS = ["gpt-4.1", "gpt-4o", "gpt-5-mini"] as const;

const DEFAULT_MODEL_ID_SET = new Set(DEFAULT_MODEL_IDS.map((modelId) => modelId.toLowerCase()));

export function getDefaultCopilotModelIds(): string[] {
  return [...DEFAULT_MODEL_IDS];
}

export function isDefaultCopilotModelId(modelId: string): boolean {
  return DEFAULT_MODEL_ID_SET.has(modelId.trim().toLowerCase());
}

export function buildCopilotModelDefinition(modelId: string): ModelDefinitionConfig {
  const id = modelId.trim();
  if (!id) {
    throw new Error("Model id required");
  }
  return {
    id,
    name: id,
    // pi-coding-agent's registry schema doesn't know about a "github-copilot" API.
    // We use OpenAI-compatible responses API, while keeping the provider id as
    // "github-copilot" (pi-ai uses that to attach Copilot-specific headers).
    api: "openai-responses",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}
