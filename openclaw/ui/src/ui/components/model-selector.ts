/**
 * ModelSelector - Unified component for AI provider/model selection.
 *
 * This component provides a consistent UI for selecting AI providers and models
 * across Integrations, Agents, Onboarding, and chat panels.
 */

import { html, nothing } from "lit";
import type { PmosModelProvider } from "../controllers/pmos-model-auth.ts";

export type ModelSelectorProps = {
  provider: PmosModelProvider;
  modelId: string;
  configuredProviders: PmosModelProvider[];
  onProviderChange: (provider: PmosModelProvider) => void;
  onModelChange: (modelId: string) => void;
  showApiKeyInput?: boolean;
  apiKeyDraft?: string;
  onApiKeyChange?: (key: string) => void;
  onApiKeySave?: () => void;
  apiKeySaving?: boolean;
  disabled?: boolean;
  compact?: boolean;
};

const PROVIDER_OPTIONS: Array<{ value: PmosModelProvider; label: string }> = [
  { value: "google", label: "Google Gemini" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "zai", label: "GLM (Z.AI)" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "kilo", label: "Kilo" },
];

type ModelCatalogEntry = {
  id: string;
  label: string;
  tier?: "free" | "paid";
};

const MODEL_CATALOG: Record<PmosModelProvider, ModelCatalogEntry[]> = {
  google: [
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", tier: "paid" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", tier: "free" },
  ],
  openai: [
    { id: "gpt-5.2", label: "GPT-5.2", tier: "paid" },
    { id: "gpt-4o", label: "GPT-4o", tier: "paid" },
  ],
  anthropic: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", tier: "paid" },
    { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", tier: "paid" },
  ],
  zai: [
    { id: "glm-5", label: "GLM-5", tier: "paid" },
    { id: "glm-4.7", label: "GLM-4.7", tier: "free" },
  ],
  openrouter: [
    { id: "google/gemini-2.0-flash:free", label: "Gemini 2.0 Flash (Free)", tier: "free" },
    { id: "openai/gpt-4o", label: "GPT-4o via OpenRouter", tier: "paid" },
  ],
  kilo: [
    { id: "kilo/z-ai/glm-5:free", label: "Kilo GLM-5 (Free)", tier: "free" },
    { id: "kilo/openai/gpt-4o", label: "Kilo GPT-4o", tier: "paid" },
  ],
  moonshot: [{ id: "moonshotai/kimi-k2.5", label: "Kimi K2.5", tier: "paid" }],
  nvidia: [{ id: "minimaxai/minimax-m2.1", label: "MiniMax M2.1", tier: "paid" }],
  custom: [],
};

function getModelsForProvider(provider: PmosModelProvider): ModelCatalogEntry[] {
  return MODEL_CATALOG[provider] ?? [];
}

function getModelLabel(modelId: string): string {
  for (const entries of Object.values(MODEL_CATALOG)) {
    const match = entries.find((entry) => entry.id === modelId);
    if (match) {
      return match.label;
    }
  }
  return modelId || "Model";
}

export function renderModelSelector(props: ModelSelectorProps) {
  const models = getModelsForProvider(props.provider);
  const isConfigured = props.configuredProviders.includes(props.provider);
  const showModelDropdown = models.length > 0;

  return html`
    <div class="model-selector ${props.compact ? "compact" : ""}">
      <label class="field">
        <span>AI Provider</span>
        <select
          .value=${props.provider}
          @change=${(e: Event) =>
            props.onProviderChange((e.target as HTMLSelectElement).value as PmosModelProvider)}
          ?disabled=${props.disabled}
        >
          ${PROVIDER_OPTIONS.map((opt) => {
            const configured = props.configuredProviders.includes(opt.value);
            return html`
              <option value=${opt.value}>
                ${opt.label}${configured ? " (configured)" : ""}
              </option>
            `;
          })}
        </select>
        ${isConfigured
          ? html`<span class="chip chip-ok" style="margin-left: 6px;">Configured</span>`
          : html`<span class="chip chip-warn" style="margin-left: 6px;">Needs API key</span>`}
      </label>

      ${showModelDropdown
        ? html`
            <label class="field">
              <span>Model</span>
              <select
                .value=${props.modelId}
                @change=${(e: Event) => props.onModelChange((e.target as HTMLSelectElement).value)}
                ?disabled=${props.disabled}
              >
                ${models.map(
                  (m) => html`
                    <option value=${m.id}>
                      ${m.label}${m.tier === "free" ? " (Free)" : ""}
                    </option>
                  `,
                )}
              </select>
            </label>
          `
        : html`
            <label class="field">
              <span>Model ID</span>
              <input
                type="text"
                .value=${props.modelId}
                @input=${(e: Event) => props.onModelChange((e.target as HTMLInputElement).value)}
                placeholder="e.g. gpt-4o, claude-3-5-sonnet"
                ?disabled=${props.disabled}
              />
            </label>
          `}

      ${props.showApiKeyInput && !isConfigured
        ? html`
            <label class="field">
              <span>API Key</span>
              <input
                type="password"
                .value=${props.apiKeyDraft ?? ""}
                @input=${(e: Event) => props.onApiKeyChange?.((e.target as HTMLInputElement).value)}
                placeholder="Paste your API key"
                autocomplete="off"
                ?disabled=${props.disabled || props.apiKeySaving}
              />
            </label>
            <button
              class="btn btn--primary btn--sm"
              @click=${() => props.onApiKeySave?.()}
              ?disabled=${props.disabled || props.apiKeySaving || !(props.apiKeyDraft?.trim())}
            >
              ${props.apiKeySaving ? "Saving..." : "Save Key"}
            </button>
          `
        : nothing}

      ${!isConfigured && !props.showApiKeyInput
        ? html`
            <div class="muted" style="font-size: 11px; margin-top: 4px;">
              Configure this provider in <a href="#integrations">Integrations</a>
            </div>
          `
        : nothing}
    </div>
  `;
}

export type InlineModelSelectorProps = {
  provider: PmosModelProvider;
  modelId: string;
  configuredProviders: PmosModelProvider[];
  onChange: (provider: PmosModelProvider, modelId: string) => void;
  disabled?: boolean;
};

export function renderInlineModelSelector(props: InlineModelSelectorProps) {
  const models = getModelsForProvider(props.provider);
  const isConfigured = props.configuredProviders.includes(props.provider);

  return html`
    <div class="inline-model-selector" style="display:flex; gap:6px; align-items:center; font-size:12px;">
      <select
        .value=${props.provider}
        @change=${(e: Event) => {
          const newProvider = (e.target as HTMLSelectElement).value as PmosModelProvider;
          const newModels = getModelsForProvider(newProvider);
          const defaultModel = newModels[0]?.id ?? "";
          props.onChange(newProvider, defaultModel);
        }}
        ?disabled=${props.disabled}
        style="font-size:11px; padding:2px 6px;"
      >
        ${PROVIDER_OPTIONS.map((opt) => {
          const configured = props.configuredProviders.includes(opt.value);
          return html`
            <option value=${opt.value} ?selected=${props.provider === opt.value}>
              ${opt.label}${configured ? " (configured)" : ""}
            </option>
          `;
        })}
      </select>
      ${models.length > 1
        ? html`
            <select
              .value=${props.modelId}
              @change=${(e: Event) => props.onChange(props.provider, (e.target as HTMLSelectElement).value)}
              ?disabled=${props.disabled}
              style="font-size:11px; padding:2px 6px;"
            >
              ${models.map(
                (m) => html`
                  <option value=${m.id} ?selected=${props.modelId === m.id}>
                    ${m.tier === "free" ? "Free - " : ""}${getModelLabel(m.id)}
                  </option>
                `,
              )}
            </select>
          `
        : html`
            <span class="muted" style="font-size: 11px;">${getModelLabel(props.modelId)}</span>
          `}
      ${!isConfigured
        ? html`<span class="chip chip-warn" style="font-size:10px;">No key</span>`
        : nothing}
    </div>
  `;
}
