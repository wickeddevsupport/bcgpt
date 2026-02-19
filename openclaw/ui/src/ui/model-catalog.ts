/**
 * Model Catalog - Central source of truth for available AI models per provider.
 *
 * This catalog powers the unified ModelSelector component and provides
 * metadata about each model (tier, capabilities, pricing hints).
 */

export type ModelTier = "free" | "paid" | "enterprise";

export type ModelInfo = {
  id: string;
  label: string;
  tier: ModelTier;
  description?: string;
  maxTokens?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
};

export type ModelCatalog = {
  [provider: string]: ModelInfo[];
};

export const MODEL_CATALOG: ModelCatalog = {
  google: [
    {
      id: "gemini-3-flash-preview",
      label: "Gemini 3 Flash (Preview)",
      tier: "free",
      description: "Fast, free preview model",
      supportsVision: true,
      supportsTools: true,
    },
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      tier: "paid",
      description: "Most capable Gemini model",
      supportsVision: true,
      supportsTools: true,
    },
    {
      id: "gemini-2.0-flash",
      label: "Gemini 2.0 Flash",
      tier: "paid",
      description: "Fast and efficient",
      supportsVision: true,
      supportsTools: true,
    },
  ],
  openai: [
    {
      id: "gpt-5.2",
      label: "GPT-5.2",
      tier: "paid",
      description: "Latest GPT model",
      supportsVision: true,
      supportsTools: true,
    },
    {
      id: "gpt-4.1",
      label: "GPT-4.1",
      tier: "paid",
      description: "Improved GPT-4",
      supportsVision: true,
      supportsTools: true,
    },
    {
      id: "gpt-4.1-mini",
      label: "GPT-4.1 Mini",
      tier: "paid",
      description: "Fast and affordable",
      supportsVision: true,
      supportsTools: true,
    },
    {
      id: "o3-mini",
      label: "O3 Mini",
      tier: "paid",
      description: "Reasoning model",
      supportsTools: true,
    },
  ],
  anthropic: [
    {
      id: "claude-opus-4-6",
      label: "Claude Opus 4.6",
      tier: "paid",
      description: "Most capable Claude",
      supportsVision: true,
      supportsTools: true,
    },
    {
      id: "claude-sonnet-4",
      label: "Claude Sonnet 4",
      tier: "paid",
      description: "Balanced performance",
      supportsVision: true,
      supportsTools: true,
    },
    {
      id: "claude-haiku-4-5-20251001",
      label: "Claude Haiku 4.5",
      tier: "paid",
      description: "Fast and affordable",
      supportsVision: true,
      supportsTools: true,
    },
  ],
  zai: [
    {
      id: "glm-4.7",
      label: "GLM 4.7",
      tier: "free",
      description: "Latest GLM model",
      supportsTools: true,
    },
    {
      id: "glm-5",
      label: "GLM 5",
      tier: "free",
      description: "Next-gen GLM",
      supportsVision: true,
      supportsTools: true,
    },
  ],
  openrouter: [
    {
      id: "google/gemini-2.0-flash:free",
      label: "Gemini 2.0 Flash (Free)",
      tier: "free",
      description: "Free via OpenRouter",
      supportsVision: true,
      supportsTools: true,
    },
    {
      id: "anthropic/claude-3.5-sonnet",
      label: "Claude 3.5 Sonnet",
      tier: "paid",
      description: "Via OpenRouter",
      supportsVision: true,
      supportsTools: true,
    },
    {
      id: "openai/gpt-4o",
      label: "GPT-4o",
      tier: "paid",
      description: "Via OpenRouter",
      supportsVision: true,
      supportsTools: true,
    },
  ],
  kilo: [
    {
      id: "kilo/z-ai/glm-5:free",
      label: "GLM 5 Free (Kilo)",
      tier: "free",
      description: "Free via Kilo gateway",
      supportsTools: true,
    },
    {
      id: "kilo/z-ai/glm-4:free",
      label: "GLM 4 Free (Kilo)",
      tier: "free",
      description: "Free via Kilo gateway",
      supportsTools: true,
    },
  ],
};

/**
 * Get models for a specific provider
 */
export function getModelsForProvider(provider: string): ModelInfo[] {
  return MODEL_CATALOG[provider] ?? [];
}

/**
 * Get model info by provider and model ID
 */
export function getModelInfo(provider: string, modelId: string): ModelInfo | undefined {
  const models = MODEL_CATALOG[provider];
  if (!models) return undefined;
  return models.find((m) => m.id === modelId);
}

/**
 * Check if a provider supports a specific model
 */
export function providerSupportsModel(provider: string, modelId: string): boolean {
  return getModelInfo(provider, modelId) !== undefined;
}

/**
 * Get all free models across all providers
 */
export function getFreeModels(): Array<{ provider: string; model: ModelInfo }> {
  const result: Array<{ provider: string; model: ModelInfo }> = [];
  for (const [provider, models] of Object.entries(MODEL_CATALOG)) {
    for (const model of models) {
      if (model.tier === "free") {
        result.push({ provider, model });
      }
    }
  }
  return result;
}

/**
 * Get label for a model ID (with fallback)
 */
export function getModelLabel(modelId: string): string {
  // Try to find in any provider
  for (const models of Object.values(MODEL_CATALOG)) {
    const found = models.find((m) => m.id === modelId);
    if (found) return found.label;
  }
  // Fallback: just return the ID
  return modelId;
}