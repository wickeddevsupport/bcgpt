import { html, nothing } from "lit";

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic", defaultModel: "claude-opus-4-6" },
  { value: "openai", label: "OpenAI", defaultModel: "gpt-4o" },
  { value: "google", label: "Google Gemini", defaultModel: "gemini-2.0-flash" },
  { value: "openrouter", label: "OpenRouter", defaultModel: "google/gemini-2.0-flash:free" },
  { value: "zai", label: "GLM (Z.AI)", defaultModel: "glm-4.1" },
];

export type OnboardingStep = 1 | 2 | 3;

export type OnboardingProps = {
  currentStep?: OnboardingStep;
  modelAuthConfigured: boolean;
  // Step 3: Add AI Keys (inline BYOK form)
  modelProvider: string;
  modelId: string;
  modelApiKeyDraft: string;
  modelSaving: boolean;
  modelError: string | null;
  modelConfigured: boolean;
  onModelProviderChange: (provider: string) => void;
  onModelIdChange: (id: string) => void;
  onModelApiKeyChange: (key: string) => void;
  onModelSave: () => void;
  onComplete: () => void;
  onSkip: () => void;
};

export function renderOnboarding(props: OnboardingProps) {
  return html`
    <div class="onboarding-wizard">
      <div class="onboarding-header">
        <div class="onboarding-logo">
          <img src="/wicked-os-logo.svg" alt="Wicked OS" style="height: 40px;" />
        </div>
        <div style="margin-top: 12px;">
          <h2 style="margin: 0; font-size: 20px; font-weight: 600;">Add Your AI Keys</h2>
          <p class="muted" style="margin: 4px 0 0 0;">Bring your own API key to power your AI team. Keys are encrypted and stay in your workspace.</p>
        </div>
      </div>

      <div class="onboarding-content">
        <div class="onboarding-step">
          <div class="onboarding-keys-section">
            ${props.modelConfigured
              ? html`
                <div class="callout success" style="margin-bottom: 16px;">
                  <strong>✓ AI model configured</strong> — your agents are ready to use AI.
                </div>
              `
              : html`
                <div class="onboarding-key-card">
                  <div class="form-grid">
                    <label class="field full">
                      <span>AI Provider</span>
                      <select
                        @change=${(e: Event) => props.onModelProviderChange((e.target as HTMLSelectElement).value)}
                        ?disabled=${props.modelSaving}
                      >
                        ${PROVIDER_OPTIONS.map((p) => html`
                          <option value=${p.value} ?selected=${props.modelProvider === p.value}>${p.label}</option>
                        `)}
                      </select>
                    </label>
                    <label class="field full">
                      <span>API Key</span>
                      <input
                        type="password"
                        .value=${props.modelApiKeyDraft}
                        @input=${(e: Event) => props.onModelApiKeyChange((e.target as HTMLInputElement).value)}
                        placeholder="Paste your API key here"
                        ?disabled=${props.modelSaving}
                        autocomplete="off"
                      />
                    </label>
                  </div>
                  ${props.modelError ? html`<div class="callout danger" style="margin-top: 10px;">${props.modelError}</div>` : nothing}
                  <div class="row" style="margin-top: 12px;">
                    <button
                      class="btn btn--primary"
                      @click=${props.onModelSave}
                      ?disabled=${props.modelSaving || !props.modelApiKeyDraft.trim()}
                    >
                      ${props.modelSaving ? "Saving..." : "Save Key"}
                    </button>
                  </div>
                </div>
              `
            }

            <div class="onboarding-security-note">
              <h4>🔒 Your Data Stays Local</h4>
              <ul>
                <li>API keys are encrypted in your workspace</li>
                <li>Keys are never sent to external servers</li>
                <li>You can change or remove keys anytime in Integrations</li>
              </ul>
            </div>
          </div>

          <div class="onboarding-hint">
            <span class="muted">💡 Tip: You can skip this step and add keys later in Integrations → AI Provider Keys.</span>
          </div>
        </div>
      </div>

      <div class="onboarding-footer">
        <button class="btn btn--link" @click=${props.onSkip}>Skip for now</button>
        <button class="btn btn--primary" @click=${props.onComplete}>
          ${props.modelConfigured ? "Start Using Wicked OS" : "Skip & Start"}
        </button>
      </div>
    </div>
  `;
}

export default renderOnboarding;
