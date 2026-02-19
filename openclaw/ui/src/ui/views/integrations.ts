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

function renderConnectorStatus(label: string, ok: boolean | null, detail?: string | null) {
  const tone = ok === true ? "ok" : ok === false ? "warn" : "";
  const value = ok === true ? "OK" : ok === false ? "Fail" : "n/a";
  return html`
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value ${tone}">${value}</div>
      ${detail ? html`<div class="muted mono">${detail}</div>` : nothing}
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
    if (!ops) {
      return {
        label: "Unknown",
        tone: "warn" as const,
        detail: "Runtime probe has not completed yet.",
      };
    }
    if (ops.reachable === true) {
      return {
        label: "Ready",
        tone: "ok" as const,
        detail: ops.url ?? "/ops-ui/",
      };
    }
    if (ops.reachable === false) {
      return {
        label: "Offline",
        tone: "warn" as const,
        detail: ops.error ?? "Embedded runtime is unreachable.",
      };
    }
    if (ops.configured) {
      return {
        label: "Starting",
        tone: "warn" as const,
        detail: "Runtime configured, waiting for health checks.",
      };
    }
    return {
      label: "Not configured",
      tone: "warn" as const,
      detail: "No embedded runtime detected.",
    };
  })();

  const disabledReason = !props.connected
    ? "Sign in to your workspace to configure integrations."
    : null;
  const modelKeyPlaceholder = props.modelConfigured
    ? "Stored (leave blank to keep current key)"
    : "Paste provider API key";
  const modelProviderOptions: Array<{ value: PmosModelProvider; label: string }> = [
    { value: "google", label: "Google Gemini" },
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" },
    { value: "zai", label: "GLM (Z.AI)" },
    { value: "openrouter", label: "OpenRouter" },
  ];

  const projectIdShort = props.opsProjectId ? String(props.opsProjectId).slice(0, 8) : null;

  return html`
    <section class="card" style="margin-bottom: 18px;">
      <div class="card-title">AI Model Setup</div>
      <div class="card-sub">
        Choose your AI provider and paste one API key. All agents in your workspace will use this model.
      </div>

      <div class="form-grid" style="margin-top: 16px;">
        <label class="field">
          <span>Provider</span>
          <select
            .value=${props.modelProvider}
            @change=${(e: Event) =>
              props.onModelProviderChange((e.target as HTMLSelectElement).value as PmosModelProvider)}
            ?disabled=${!props.connected || props.modelSaving}
          >
            ${modelProviderOptions.map(
              (opt) => html`<option value=${opt.value}>${opt.label}</option>`,
            )}
          </select>
        </label>
        <label class="field">
          <span>Model ID</span>
          <input
            .value=${props.modelId}
            @input=${(e: Event) => props.onModelIdChange((e.target as HTMLInputElement).value)}
            placeholder="e.g. gemini-3-flash-preview"
            ?disabled=${!props.connected || props.modelSaving}
          />
        </label>
        <label class="field">
          <span>Nickname <span class="muted">(optional)</span></span>
          <input
            .value=${props.modelAlias}
            @input=${(e: Event) => props.onModelAliasChange((e.target as HTMLInputElement).value)}
            placeholder="e.g. support-assistant"
            ?disabled=${!props.connected || props.modelSaving}
          />
        </label>
        <label class="field full">
          <span>Provider API Key</span>
          <input
            type="password"
            .value=${props.modelApiKeyDraft}
            @input=${(e: Event) =>
              props.onModelApiKeyDraftChange((e.target as HTMLInputElement).value)}
            placeholder=${modelKeyPlaceholder}
            autocomplete="off"
            ?disabled=${!props.connected || props.modelSaving}
          />
        </label>
      </div>

      <div class="row" style="margin-top: 14px;">
        <button class="btn btn--primary" ?disabled=${!props.connected || props.modelSaving} @click=${() => props.onModelSave()}>
          ${props.modelSaving ? "Saving..." : "Save"}
        </button>
        <button
          class="btn btn--secondary"
          ?disabled=${!props.connected || props.modelSaving}
          @click=${() => props.onModelClearKey()}
          title="Remove the saved key for the selected provider"
        >
          Remove saved key
        </button>
        ${props.modelSavedOk
          ? html`<span class="chip chip-ok">✓ Saved</span>`
          : html`<span class="chip ${props.modelConfigured ? "chip-ok" : "chip-warn"}">
              ${props.modelConfigured ? "Configured" : "Not configured"}
            </span>`}
      </div>

      ${props.modelError ? html`<div class="callout danger" style="margin-top: 12px;">${props.modelError}</div>` : nothing}
      ${disabledReason ? html`<div class="muted" style="margin-top: 10px;">${disabledReason}</div>` : nothing}
    </section>

    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">Workflow Engine</div>
        <div class="card-sub">
          Runs your automations in an isolated workspace. Each account has its own private workflow runtime.
        </div>

        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">Workspace Access</div>
            <div class="stat-value ${props.opsProvisioned ? "ok" : "warn"}">
              ${props.opsProvisioned ? "Provisioned" : "Pending"}
            </div>
            ${projectIdShort
              ? html`<div class="muted" style="font-size:11px;">
                  Project ID: <span class="mono">${projectIdShort}…</span>
                </div>`
              : nothing}
          </div>
          <div class="stat">
            <div class="stat-label">Runtime</div>
            <div class="stat-value ${opsRuntime.tone === "ok" ? "ok" : "warn"}">${opsRuntime.label}</div>
            <div class="muted" style="font-size:11px;">${opsRuntime.detail}</div>
          </div>
        </div>

        <div class="row" style="margin-top: 12px;">
          <button class="btn btn--secondary" @click=${() => props.onOpenAutomations()}>
            Open in Automations →
          </button>
        </div>

        ${
          ops?.reachable === false
            ? html`
                <div class="callout warn" style="margin-top: 12px;">
                  Workflow runtime is unavailable. Try refreshing status — if the problem persists, contact support.
                </div>
              `
            : nothing
        }
      </div>

      <div class="card">
        <div class="card-title">Basecamp Connector</div>
        <div class="card-sub">Connect your Basecamp account so agents can access projects, todos, and messages.</div>

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

        <div class="row" style="margin-top: 14px;">
          <button class="btn btn--primary" ?disabled=${props.saving || !props.connected} @click=${() => props.onSave()}>
            ${props.saving ? "Saving..." : "Save"}
          </button>
          <button
            class="btn btn--secondary"
            ?disabled=${props.saving || !props.connected}
            @click=${() => props.onClearBcgptKey()}
            title="Remove the stored connection key"
          >
            Remove key
          </button>
          <a
            class="btn btn--secondary"
            href=${props.bcgptUrl.replace(/\/$/, "") + "/connect"}
            target="_blank"
            rel="noreferrer"
            title="Open Basecamp connect flow in a new tab"
          >
            Connect Basecamp ↗
          </a>
          ${props.bcgptSavedOk ? html`<span class="chip chip-ok">✓ Saved</span>` : nothing}
          ${props.basecampSetupOk ? html`<span class="chip chip-ok">✓ Added to Workflows</span>` : nothing}
        </div>

        ${props.onSetupBasecamp ? html`
          <div class="row" style="margin-top: 10px; align-items: center; gap: 10px;">
            <button
              class="btn btn--secondary"
              ?disabled=${!props.connected || props.basecampSetupPending}
              @click=${() => props.onSetupBasecamp?.()}
              title="Auto-create the Basecamp credential inside your workflow engine so you can use the Basecamp node immediately"
            >
              ${props.basecampSetupPending ? "Configuring..." : "Add to Workflow Engine"}
            </button>
            <span class="muted" style="font-size:11px;">Auto-configures Basecamp in n8n using your saved key</span>
          </div>
          ${props.basecampSetupError ? html`<div class="callout danger" style="margin-top: 8px; font-size:12px;">${props.basecampSetupError}</div>` : nothing}
        ` : nothing}

        ${disabledReason ? html`<div class="muted" style="margin-top: 10px;">${disabledReason}</div>` : nothing}
      </div>
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">Connection Status</div>
      <div class="card-sub">Live checks run server-side to avoid browser network restrictions.</div>

      <div class="stat-grid" style="margin-top: 16px;">
        ${renderConnectorStatus("Basecamp connection", bcgpt?.reachable ?? null, bcgpt?.healthUrl ?? null)}
        ${renderConnectorStatus("Basecamp auth", bcgpt?.authOk ?? null, bcgpt?.mcpUrl ?? null)}
      </div>

      <div class="row" style="margin-top: 14px;">
        <button
          class="btn"
          ?disabled=${props.connectorsLoading || !props.connected}
          @click=${() => props.onRefreshConnectors()}
        >
          ${props.connectorsLoading ? "Checking..." : "Refresh status"}
        </button>
      </div>

      ${
        props.connectorsError
          ? html`<div class="callout danger" style="margin-top: 14px;">
              <div>${props.connectorsError}</div>
            </div>`
          : nothing
      }

      ${
        props.error
          ? html`<div class="callout danger" style="margin-top: 14px;">
              <div>${props.error}</div>
            </div>`
          : nothing
      }
    </section>
  `;
}
