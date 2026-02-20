import { html, nothing } from "lit";
import type { PmosConnectorsStatus } from "../controllers/pmos-connectors.ts";
import type { PmosModelProvider } from "../controllers/pmos-model-auth.ts";

export type IntegrationsProps = {
  connected: boolean;
  saving: boolean;
  error: string | null;
  bcgptUrl: string;
  bcgptApiKeyDraft: string;
  connectorsLoading: boolean;
  connectorsStatus: PmosConnectorsStatus | null;
  connectorsError: string | null;
  modelProvider: PmosModelProvider;
  modelId: string;
  modelAlias: string;
  modelApiKeyDraft: string;
  modelSaving: boolean;
  modelConfigured: boolean;
  modelError: string | null;
  modelSavedOk?: boolean;
  bcgptSavedOk?: boolean;
  onBcgptUrlChange: (next: string) => void;
  onBcgptApiKeyDraftChange: (next: string) => void;
  onSave: () => void;
  onClearBcgptKey: () => void;
  onRefreshConnectors: () => void;
  onModelProviderChange: (next: PmosModelProvider) => void;
  onModelIdChange: (next: string) => void;
  onModelAliasChange: (next: string) => void;
  onModelApiKeyDraftChange: (next: string) => void;
  onModelSave: () => void;
  onModelClearKey: () => void;
  onOpenAutomations: () => void;

  // n8n / Wicked Ops provisioning status
  opsProvisioned?: boolean;
  opsProjectId?: string | null;

  // Basecamp credential setup in n8n
  basecampSetupPending?: boolean;
  basecampSetupOk?: boolean;
  basecampSetupError?: string | null;
  onSetupBasecamp?: () => void;
};

type ProviderOption = {
  value: PmosModelProvider;
  label: string;
  icon: string;
  defaultModel: string;
  hint: string;
};

const PROVIDER_OPTIONS: ProviderOption[] = [
  { value: "openai", label: "OpenAI", icon: "⬡", defaultModel: "gpt-4o", hint: "GPT-4o, o3, etc." },
  { value: "anthropic", label: "Anthropic", icon: "◆", defaultModel: "claude-opus-4-6", hint: "Claude 3.5 / 4 series" },
  { value: "google", label: "Google", icon: "✦", defaultModel: "gemini-2.0-flash-exp", hint: "Gemini 2.0 / 1.5" },
  { value: "openrouter", label: "OpenRouter", icon: "⇄", defaultModel: "openai/gpt-4o", hint: "Route to any model" },
  { value: "kilo", label: "Kilo", icon: "⚡", defaultModel: "claude-opus-4-6", hint: "Kilo proxy gateway" },
  { value: "zai", label: "GLM / Z.AI", icon: "◈", defaultModel: "glm-4-air", hint: "GLM-4 series" },
];

function renderConnectorStatus(label: string, ok: boolean | null, detail?: string | null) {
  const tone = ok === true ? "ok" : ok === false ? "warn" : "";
  const value = ok === true ? "Connected" : ok === false ? "Failed" : "—";
  return html`
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value ${tone}">${value}</div>
      ${detail ? html`<div class="muted mono" style="font-size:11px;">${detail}</div>` : nothing}
    </div>
  `;
}

export function renderIntegrations(props: IntegrationsProps) {
  const bcgpt = props.connectorsStatus?.bcgpt ?? null;
  const ops = props.connectorsStatus?.ops ?? null;

  const bcgptConfigured = bcgpt?.configured ?? false;
  const bcgptKeyPlaceholder = bcgptConfigured
    ? "Stored (leave blank to keep)"
    : "Paste connection key";

  const opsRuntime = (() => {
    if (!ops) return { label: "Unknown", tone: "warn" as const, detail: "Runtime probe not yet completed." };
    if (ops.reachable === true) return { label: "Ready", tone: "ok" as const, detail: ops.url ?? "/ops-ui/" };
    if (ops.reachable === false) return { label: "Offline", tone: "warn" as const, detail: ops.error ?? "Embedded runtime is unreachable." };
    if (ops.configured) return { label: "Starting", tone: "warn" as const, detail: "Configured, waiting for health checks." };
    return { label: "Not configured", tone: "warn" as const, detail: "No embedded runtime detected." };
  })();

  const disabledReason = !props.connected
    ? "Sign in to your workspace to configure integrations."
    : null;

  const modelKeyPlaceholder = props.modelConfigured
    ? "Stored (leave blank to keep current key)"
    : "Paste your provider API key";

  const selectedProvider = PROVIDER_OPTIONS.find(p => p.value === props.modelProvider) ?? PROVIDER_OPTIONS[0];
  const projectIdShort = props.opsProjectId ? String(props.opsProjectId).slice(0, 8) : null;

  return html`
    <!-- AI Model Configuration — primary card -->
    <section class="card" style="margin-bottom: 18px;">
      <!-- Status banner -->
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 16px;">
        <div>
          <div class="card-title" style="margin-bottom:4px;">AI Model</div>
          <div class="card-sub" style="margin:0;">
            Powers your Chat, Workflow Builder, and n8n AI Assistant — all from one key.
          </div>
        </div>
        ${props.modelConfigured
          ? html`
            <div style="display:flex; align-items:center; gap:8px; padding: 8px 14px; background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); border-radius: 10px;">
              <span style="color: #22c55e; font-size: 13px;">●</span>
              <span style="font-size: 13px; font-weight: 500; color: #22c55e;">Active</span>
              <span style="font-size: 12px; color: var(--text-secondary, #a0a0b0);">
                ${props.modelProvider} / ${props.modelId.split("/").pop()}
              </span>
            </div>`
          : html`
            <div style="display:flex; align-items:center; gap:8px; padding: 8px 14px; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); border-radius: 10px;">
              <span style="color: #f59e0b; font-size: 13px;">●</span>
              <span style="font-size: 13px; font-weight: 500; color: #f59e0b;">Not configured</span>
            </div>`}
      </div>

      <!-- Provider selection as cards -->
      <div style="margin-bottom: 16px;">
        <div style="font-size: 12px; color: var(--text-secondary, #a0a0b0); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.05em;">Provider</div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
          ${PROVIDER_OPTIONS.map(opt => html`
            <button
              class="provider-card ${props.modelProvider === opt.value ? "selected" : ""}"
              style="
                display: flex; flex-direction: column; align-items: flex-start;
                padding: 10px 12px; border-radius: 10px; cursor: pointer;
                border: 1.5px solid ${props.modelProvider === opt.value ? "var(--accent-primary, #6366f1)" : "var(--border-color, rgba(255,255,255,0.08))"};
                background: ${props.modelProvider === opt.value ? "rgba(99,102,241,0.08)" : "var(--bg-elevated, #1a1a24)"};
                transition: all 0.15s ease; text-align: left;
              "
              ?disabled=${!props.connected || props.modelSaving}
              @click=${() => {
                props.onModelProviderChange(opt.value);
                if (!props.modelId || props.modelId === selectedProvider.defaultModel) {
                  props.onModelIdChange(opt.defaultModel);
                }
              }}
            >
              <div style="font-size: 18px; margin-bottom: 4px;">${opt.icon}</div>
              <div style="font-size: 13px; font-weight: 600;">${opt.label}</div>
              <div style="font-size: 11px; color: var(--text-muted, #6a6a7a);">${opt.hint}</div>
            </button>
          `)}
        </div>
      </div>

      <!-- Model ID + API Key -->
      <div class="form-grid" style="margin-bottom: 14px;">
        <label class="field">
          <span>Model ID</span>
          <input
            .value=${props.modelId}
            @input=${(e: Event) => props.onModelIdChange((e.target as HTMLInputElement).value)}
            placeholder=${selectedProvider.defaultModel}
            ?disabled=${!props.connected || props.modelSaving}
          />
        </label>
        <label class="field">
          <span>Nickname <span class="muted">(optional)</span></span>
          <input
            .value=${props.modelAlias}
            @input=${(e: Event) => props.onModelAliasChange((e.target as HTMLInputElement).value)}
            placeholder="e.g. my-main-ai"
            ?disabled=${!props.connected || props.modelSaving}
          />
        </label>
        <label class="field full">
          <span>API Key</span>
          <input
            type="password"
            .value=${props.modelApiKeyDraft}
            @input=${(e: Event) => props.onModelApiKeyDraftChange((e.target as HTMLInputElement).value)}
            placeholder=${modelKeyPlaceholder}
            autocomplete="off"
            ?disabled=${!props.connected || props.modelSaving}
          />
        </label>
      </div>

      <!-- Actions row -->
      <div class="row" style="gap: 10px; flex-wrap: wrap; align-items: center;">
        <button
          class="btn btn--primary"
          ?disabled=${!props.connected || props.modelSaving}
          @click=${() => props.onModelSave()}
        >
          ${props.modelSaving ? "Saving…" : "Save & Activate"}
        </button>
        <button
          class="btn btn--secondary"
          ?disabled=${!props.connected || props.modelSaving || !props.modelConfigured}
          @click=${() => props.onModelClearKey()}
          title="Remove the saved key for the selected provider"
        >
          Remove key
        </button>
        ${props.modelSavedOk
          ? html`<span class="chip chip-ok" style="animation: fadeIn 0.3s ease;">✓ Saved & synced to Workflow Engine</span>`
          : nothing}
      </div>

      ${props.modelError
        ? html`<div class="callout danger" style="margin-top: 12px; font-size: 13px;">${props.modelError}</div>`
        : nothing}
      ${disabledReason
        ? html`<div class="muted" style="margin-top: 10px; font-size: 13px;">${disabledReason}</div>`
        : nothing}
    </section>

    <!-- Workflow Engine + Basecamp row -->
    <section class="grid grid-cols-2" style="margin-bottom: 18px;">
      <div class="card">
        <div class="card-title">Workflow Engine</div>
        <div class="card-sub">
          Your private n8n instance. Runs your automations in an isolated workspace.
        </div>

        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">Status</div>
            <div class="stat-value ${opsRuntime.tone === "ok" ? "ok" : "warn"}">${opsRuntime.label}</div>
            <div class="muted" style="font-size:11px;">${opsRuntime.detail}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Workspace</div>
            <div class="stat-value ${props.opsProvisioned ? "ok" : "warn"}">
              ${props.opsProvisioned ? "Provisioned" : "Pending"}
            </div>
            ${projectIdShort
              ? html`<div class="muted" style="font-size:11px; font-family: monospace;">${projectIdShort}…</div>`
              : nothing}
          </div>
        </div>

        <div class="row" style="margin-top: 12px;">
          <button class="btn btn--secondary" @click=${() => props.onOpenAutomations()}>
            Open Automations →
          </button>
        </div>

        ${ops?.reachable === false
          ? html`<div class="callout warn" style="margin-top: 12px; font-size: 13px;">
              Workflow runtime is offline. If it just started, wait a moment and refresh status.
            </div>`
          : nothing}
      </div>

      <div class="card">
        <div class="card-title">Basecamp</div>
        <div class="card-sub">Connect your Basecamp account to use it in workflows and chat.</div>

        <div class="form-grid" style="margin-top: 16px;">
          <label class="field">
            <span>Connector URL</span>
            <input
              .value=${props.bcgptUrl}
              @input=${(e: Event) => props.onBcgptUrlChange((e.target as HTMLInputElement).value)}
              placeholder="https://bcgpt.wickedlab.io"
              ?disabled=${!props.connected}
            />
          </label>
          <label class="field">
            <span>Connection Key</span>
            <input
              type="password"
              .value=${props.bcgptApiKeyDraft}
              @input=${(e: Event) => props.onBcgptApiKeyDraftChange((e.target as HTMLInputElement).value)}
              placeholder=${bcgptKeyPlaceholder}
              autocomplete="off"
              ?disabled=${!props.connected}
            />
          </label>
        </div>

        <div class="row" style="margin-top: 14px; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn--primary" ?disabled=${props.saving || !props.connected} @click=${() => props.onSave()}>
            ${props.saving ? "Saving…" : "Save"}
          </button>
          <button
            class="btn btn--secondary"
            ?disabled=${props.saving || !props.connected}
            @click=${() => props.onClearBcgptKey()}
          >
            Remove key
          </button>
          ${props.bcgptSavedOk ? html`<span class="chip chip-ok">✓ Saved</span>` : nothing}
          ${props.basecampSetupOk ? html`<span class="chip chip-ok">✓ Added to Workflow Engine</span>` : nothing}
        </div>

        ${props.onSetupBasecamp ? html`
          <div class="row" style="margin-top: 10px; align-items: center; gap: 10px;">
            <button
              class="btn btn--secondary"
              ?disabled=${!props.connected || props.basecampSetupPending}
              @click=${() => props.onSetupBasecamp?.()}
              title="Auto-configure Basecamp credentials in your workflow engine"
            >
              ${props.basecampSetupPending ? "Configuring…" : "Sync to Workflow Engine"}
            </button>
          </div>
          ${props.basecampSetupError
            ? html`<div class="callout danger" style="margin-top: 8px; font-size: 12px;">${props.basecampSetupError}</div>`
            : nothing}
        ` : nothing}

        ${disabledReason ? html`<div class="muted" style="margin-top: 10px; font-size: 13px;">${disabledReason}</div>` : nothing}
      </div>
    </section>

    <!-- Connection Status -->
    <section class="card">
      <div class="card-title">Connection Status</div>
      <div class="card-sub">Live checks run server-side to avoid browser network restrictions.</div>

      <div class="stat-grid" style="margin-top: 16px;">
        ${renderConnectorStatus("Basecamp API", bcgpt?.reachable ?? null, bcgpt?.healthUrl ?? null)}
        ${renderConnectorStatus("Basecamp Auth", bcgpt?.authOk ?? null, bcgpt?.mcpUrl ?? null)}
      </div>

      <div class="row" style="margin-top: 14px;">
        <button
          class="btn"
          ?disabled=${props.connectorsLoading || !props.connected}
          @click=${() => props.onRefreshConnectors()}
        >
          ${props.connectorsLoading ? "Checking…" : "Refresh status"}
        </button>
      </div>

      ${props.connectorsError
        ? html`<div class="callout danger" style="margin-top: 14px;">${props.connectorsError}</div>`
        : nothing}

      ${props.error
        ? html`<div class="callout danger" style="margin-top: 14px;">${props.error}</div>`
        : nothing}
    </section>
  `;
}
