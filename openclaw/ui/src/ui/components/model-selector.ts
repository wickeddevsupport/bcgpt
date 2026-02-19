/**
 * ModelSelector - Unified component for AI provider/model selection.
 *
 * This component provides a consistent UI for selecting AI providers and models
 * across Integrations, Agents, Onboarding, and any chat panels.
 *
 * It integrates with the BYOK system to show which providers are configured.
 */

import { html, nothing } from "lit";
import type { PmosModelProvider } from "./controllers/pmos-model-auth.ts";
import { getModelsForProvider, getModelLabel } from "./model-catalog.ts";

export type ModelSelectorProps = {
  // Current selection
  provider: PmosModelProvider;
  modelId: string;
  // Configured providers (from BYOK)
  configuredProviders: PmosModelProvider[];
  // Callbacks
  onProviderChange: (provider: PmosModelProvider) => void;
  onModelChange: (modelId: string) => void;
  // Optional: show API key input inline
  showApiKeyInput?: boolean;
  apiKeyDraft?: string;
  onApiKeyChange?: (key: string) => void;
  onApiKeySave?: () => void;
  apiKeySaving?: boolean;
  // UI state
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

export function renderModelSelector(props: ModelSelectorProps) {
  const models = getModelsForProvider(props.provider);
  const isConfigured = props.configuredProviders.includes(props.provider);
  const showModelDropdown = models.length > 0;

  return html`
    <div class="model-selector ${props.compact ? "compact" : ""}">
      <!-- Provider dropdown -->
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
                ${opt.label}${configured ? " ✓" : ""}
              </option>
            `;
          })}
        </select>
        ${isConfigured
          ? html`<span class="chip chip-ok" style="margin-left: 6px;">Configured</span>`
          : html`<span class="chip chip-warn" style="margin-left: 6px;">Needs API key</span>`}
      </label>

      <!-- Model dropdown (if catalog has models for this provider) -->
      ${showModelDropdown
        ? html`
            <label class="field">
              <span>Model</span>
              <select
                .value=${props.modelId}
                @change=${(e: Event) =>
                  props.onModelChange((e.target as HTMLSelectElement).value)}
                ?disabled=${props.disabled}
              >
                ${models.map((m) => html`
                  <option value=${m.id}>
                    ${m.label}${m.tier === "free" ? " (Free)" : ""}
                  </option>
                `)}
              </select>
            </label>
          `
        : html`
            <label class="field">
              <span>Model ID</span>
              <input
                type="text"
                .value=${props.modelId}
                @input=${(e: Event) =>
                  props.onModelChange((e.target as HTMLInputElement).value)}
                placeholder="e.g. gpt-4o, claude-3-5-sonnet"
                ?disabled=${props.disabled}
              />
            </label>
          `}

      <!-- API Key input (if not configured and showApiKeyInput is true) -->
      ${props.showApiKeyInput && !isConfigured
        ? html`
            <label class="field">
              <span>API Key</span>
              <input
                type="password"
                .value=${props.apiKeyDraft ?? ""}
                @input=${(e: Event) =>
                  props.onApiKeyChange?.((e.target as HTMLInputElement).value)}
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

/**
 * Compact inline model selector for chat panels
 */
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
    <div class="inline-model-selector" style="display: flex; gap: 6px; align-items: center; font-size: 12px;">
      <select
        .value=${props.provider}
        @change=${(e: Event) => {
          const newProvider = (e.target as HTMLSelectElement).value as PmosModelProvider;
          const newModels = getModelsForProvider(newProvider);
          const defaultModel = newModels[0]?.id ?? "";
          props.onChange(newProvider, defaultModel);
        }}
        ?disabled=${props.disabled}
        style="font-size: 11px; padding: 2px 6px;"
      >
        ${PROVIDER_OPTIONS.map((opt) => {
          const configured = props.configuredProviders.includes(opt.value);
          return html`
            <option value=${opt.value} ?selected=${props.provider === opt.value}>
              ${opt.label}${configured ? " ✓" : ""}
            </option>
          `;
        })}
      </select>
      ${models.length > 1
        ? html`
            <select
              .value=${props.modelId}
              @change=${(e: Event) =>
                props.onChange(props.provider, (e.target as HTMLSelectElement).value)}
              ?disabled=${props.disabled}
              style="font-size: 11px; padding: 2px 6px;"
            >
              ${models.map((m) => html`
                <option value=${m.id} ?selected=${props.modelId === m.id}>
                  ${m.tier === "free" ? "🆓 " : ""}${getModelLabel(m.id)}
                </option>
              `)}
            </select>
          `
        : html`
            <span class="muted" style="font-size: 11px;">${getModelLabel(props.modelId)}</span>
          `}
      ${!isConfigured
        ? html`<span class="chip chip-warn" style="font-size: 10px;">⚠ No key</span>`
        : nothing}
    </div>
  `;
}
