import { html, nothing } from "lit";
import type { PmosConnectorsStatus } from "../controllers/pmos-connectors.ts";
import type {
  PmosAgentModelAssignment,
  PmosModelProvider,
  PmosModelRow,
} from "../controllers/pmos-model-auth.ts";

export type IntegrationsProps = {
  connected: boolean;
  saving: boolean;
  error: string | null;
  bcgptUrl: string;
  bcgptApiKeyDraft: string;
  connectorsLoading: boolean;
  connectorsStatus: PmosConnectorsStatus | null;
  connectorsError: string | null;

  // Model manager state
  modelProvider: PmosModelProvider;
  modelId: string;
  modelAlias: string;
  modelApiKeyDraft: string;
  modelSaving: boolean;
  modelConfigured: boolean;
  modelError: string | null;
  modelSavedOk?: boolean;
  modelRefDraft: string;
  modelRows: PmosModelRow[];
  modelCatalogLoading: boolean;
  modelCatalogError: string | null;
  modelOptions: string[];
  agentModelAssignments: PmosAgentModelAssignment[];

  bcgptSavedOk?: boolean;
  onBcgptUrlChange: (next: string) => void;
  onBcgptApiKeyDraftChange: (next: string) => void;
  onSave: () => void;
  onClearBcgptKey: () => void;
  onRefreshConnectors: () => void;

  // Model manager handlers
  onModelRefDraftChange: (next: string) => void;
  onModelAliasChange: (next: string) => void;
  onModelApiKeyDraftChange: (next: string) => void;
  onModelSave: () => void;
  onModelSaveWithoutActivate: () => void;
  onModelClearKey: () => void;
  onModelClearKeyForRef: (ref: string) => void;
  onModelActivate: (ref: string) => void;
  onModelDeactivate: (ref: string) => void;
  onModelDelete: (ref: string) => void;
  onAssignAgentModel: (agentId: string, ref: string | null) => void;
  onOpenAutomations: () => void;

  // n8n / Wicked Ops provisioning status
  opsProvisioned?: boolean;
  opsProjectId?: string | null;
  opsUiHref?: string;

  // Basecamp credential setup in n8n
  basecampSetupPending?: boolean;
  basecampSetupOk?: boolean;
  basecampSetupError?: string | null;
  onSetupBasecamp?: () => void;

  // n8n Credentials
  n8nCredentials?: Array<{ id: string; name: string; type: string }>;
  n8nCredentialsLoading?: boolean;
  n8nCredentialsError?: string | null;
  onRefreshN8nCredentials?: () => void;
};

function renderConnectorStatus(label: string, ok: boolean | null, detail?: string | null) {
  const tone = ok === true ? "ok" : ok === false ? "warn" : "";
  const value = ok === true ? "Connected" : ok === false ? "Failed" : "Unknown";
  return html`
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value ${tone}">${value}</div>
      ${detail ? html`<div class="muted mono" style="font-size:11px;">${detail}</div>` : nothing}
    </div>
  `;
}

function renderModelToneChip(text: string, tone: "ok" | "warn" | "muted" = "muted") {
  const color =
    tone === "ok"
      ? "rgba(34,197,94,0.15)"
      : tone === "warn"
        ? "rgba(245,158,11,0.15)"
        : "rgba(148,163,184,0.18)";
  const border =
    tone === "ok"
      ? "rgba(34,197,94,0.35)"
      : tone === "warn"
        ? "rgba(245,158,11,0.35)"
        : "rgba(148,163,184,0.28)";
  return html`
    <span
      style="
        display:inline-flex;
        align-items:center;
        gap:6px;
        padding:2px 8px;
        font-size:11px;
        border-radius:999px;
        background:${color};
        border:1px solid ${border};
      "
    >${text}</span>
  `;
}

function buildModelOptions(rows: PmosModelRow[], options: string[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.ref.trim()) {
      set.add(row.ref.trim());
    }
  }
  for (const opt of options) {
    if (opt.trim()) {
      set.add(opt.trim());
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function parseModelRef(
  value: string | null | undefined,
): { provider: string; modelId: string } | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const split = raw.indexOf("/");
  if (split <= 0) {
    return null;
  }
  const provider = raw.slice(0, split).trim().toLowerCase();
  const modelId = raw.slice(split + 1).trim();
  if (!provider || !modelId) {
    return null;
  }
  return { provider, modelId };
}

function buildProviderOptions(modelOptions: string[], rows: PmosModelRow[]): string[] {
  const set = new Set<string>([
    "openai",
    "anthropic",
    "google",
    "zai",
    "openrouter",
    "kilo",
    "moonshot",
    "nvidia",
    "custom",
  ]);
  for (const row of rows) {
    const provider = row.provider.trim().toLowerCase();
    if (provider) {
      set.add(provider);
    }
  }
  for (const ref of modelOptions) {
    const parsed = parseModelRef(ref);
    if (parsed?.provider) {
      set.add(parsed.provider);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function buildModelIdOptionsForProvider(provider: string, modelOptions: string[]): string[] {
  const normalizedProvider = provider.trim().toLowerCase();
  if (!normalizedProvider) {
    return [];
  }
  const set = new Set<string>();
  for (const ref of modelOptions) {
    const parsed = parseModelRef(ref);
    if (!parsed || parsed.provider !== normalizedProvider) {
      continue;
    }
    set.add(parsed.modelId);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function splitModelRefDraft(value: string | null | undefined): { provider: string; modelId: string } {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return { provider: "", modelId: "" };
  }
  const split = raw.indexOf("/");
  if (split < 0) {
    return { provider: raw.toLowerCase(), modelId: "" };
  }
  return {
    provider: raw.slice(0, split).trim().toLowerCase(),
    modelId: raw.slice(split + 1).trim(),
  };
}

function composeModelRef(provider: string, modelId: string): string {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModelId = modelId.trim();
  if (!normalizedProvider && !normalizedModelId) {
    return "";
  }
  if (!normalizedProvider) {
    return normalizedModelId;
  }
  if (!normalizedModelId) {
    return `${normalizedProvider}/`;
  }
  return `${normalizedProvider}/${normalizedModelId}`;
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
        detail: "Runtime probe not yet completed.",
      };
    }
    if (ops.reachable === true) {
      return { label: "Ready", tone: "ok" as const, detail: ops.url ?? "/ops-ui/" };
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
        detail: "Configured, waiting for health checks.",
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

  const projectIdShort = props.opsProjectId ? String(props.opsProjectId).slice(0, 8) : null;
  const modelRows = props.modelRows ?? [];
  const modelOptions = buildModelOptions(modelRows, props.modelOptions ?? []);
  const providerOptions = buildProviderOptions(modelOptions, modelRows);
  const draft = splitModelRefDraft(props.modelRefDraft);
  const modelIdOptions = buildModelIdOptionsForProvider(draft.provider, modelOptions);
  const draftRef = composeModelRef(draft.provider, draft.modelId);
  const modelRefReady = Boolean(parseModelRef(draftRef));
  const activeModel = modelRows.find((row) => row.active) ?? null;
  const opsUiHref = props.opsUiHref ?? "/ops-ui/credentials";

  return html`
    <section class="card" style="margin-bottom: 18px;">
      <div
        style="
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:16px;
          margin-bottom:16px;
        "
      >
        <div>
          <div class="card-title" style="margin-bottom:4px;">Model Manager</div>
          <div class="card-sub" style="margin:0;">
            Create or update models from config. Saved models and per-agent activation stay in one place.
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
          ${activeModel
            ? renderModelToneChip(`Active: ${activeModel.ref}`, "ok")
            : renderModelToneChip("No active model", "warn")}
          ${props.modelCatalogLoading ? renderModelToneChip("Catalog loading", "muted") : nothing}
        </div>
      </div>

      <div class="card-sub" style="margin: 0 0 12px 0;">
        Add a model with type-ahead suggestions. Free text is supported when no suggestion matches.
      </div>

      <div class="form-grid" style="margin-bottom: 14px; grid-template-columns: 1fr 2fr;">
        <label class="field">
          <span>Provider</span>
          <input
            list="pmos-model-provider-options"
            .value=${draft.provider}
            @input=${(e: Event) => {
              const nextProvider = (e.target as HTMLInputElement).value;
              props.onModelRefDraftChange(composeModelRef(nextProvider, draft.modelId));
            }}
            placeholder="e.g. zai, openai, anthropic"
            ?disabled=${!props.connected || props.modelSaving}
          />
          <datalist id="pmos-model-provider-options">
            ${providerOptions.map((opt) => html`<option value=${opt}></option>`)}
          </datalist>
        </label>
        <label class="field">
          <span>Model ID</span>
          <input
            list="pmos-model-id-options"
            .value=${draft.modelId}
            @input=${(e: Event) => {
              const nextModelId = (e.target as HTMLInputElement).value;
              props.onModelRefDraftChange(composeModelRef(draft.provider, nextModelId));
            }}
            placeholder=${draft.provider ? "e.g. glm-5, gpt-5, claude-opus-4-6" : "Select provider first"}
            ?disabled=${!props.connected || props.modelSaving || !draft.provider}
          />
          <datalist id="pmos-model-id-options">
            ${modelIdOptions.map((opt) => html`<option value=${opt}></option>`)}
          </datalist>
        </label>
        <label class="field">
          <span>Alias</span>
          <input
            .value=${props.modelAlias}
            @input=${(e: Event) => props.onModelAliasChange((e.target as HTMLInputElement).value)}
            placeholder="Optional alias"
            ?disabled=${!props.connected || props.modelSaving}
          />
        </label>
        <label class="field full">
          <span>API Key</span>
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
        <label class="field full">
          <span>Model reference preview</span>
          <input
            class="mono"
            .value=${draftRef}
            readonly
            placeholder="provider/model-id"
            ?disabled=${true}
          />
        </label>
      </div>

      <div class="row" style="gap: 8px; flex-wrap: wrap; align-items:center;">
        <button
          class="btn btn--primary"
          ?disabled=${!props.connected || props.modelSaving || !modelRefReady}
          @click=${() => props.onModelSave()}
        >
          ${props.modelSaving ? "Saving..." : "Save and Activate"}
        </button>
        <button
          class="btn btn--secondary"
          ?disabled=${!props.connected || props.modelSaving || !modelRefReady}
          @click=${() => props.onModelSaveWithoutActivate()}
        >
          Save Model
        </button>
        <button
          class="btn btn--secondary"
          ?disabled=${!props.connected || props.modelSaving || !props.modelConfigured}
          @click=${() => props.onModelClearKey()}
          title="Remove key for selected provider"
        >
          Remove provider key
        </button>
        ${props.modelSavedOk ? html`<span class="chip chip-ok">Saved</span>` : nothing}
      </div>

      ${props.modelCatalogError
        ? html`<div class="callout warn" style="margin-top: 10px; font-size: 12px;">${props.modelCatalogError}</div>`
        : nothing}
      ${props.modelError
        ? html`<div class="callout danger" style="margin-top: 10px; font-size: 12px;">${props.modelError}</div>`
        : nothing}

      ${disabledReason
        ? html`<div class="muted" style="margin-top: 10px; font-size: 13px;">${disabledReason}</div>`
        : nothing}
    </section>

    <section class="grid grid-cols-2" style="margin-bottom: 18px;">
      <div class="card">
        <div class="card-title">Workflow Engine</div>
        <div class="card-sub">
          Your private n8n runtime for automations in your workspace.
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
              ? html`<div class="muted" style="font-size:11px; font-family: monospace;">${projectIdShort}...</div>`
              : nothing}
          </div>
        </div>

        <div class="row" style="margin-top: 12px; gap:8px;">
          <button class="btn btn--secondary" @click=${() => props.onOpenAutomations()}>
            Open Automations
          </button>
          <a href=${opsUiHref} target="_blank" rel="noreferrer" class="btn btn--secondary">
            Open Credentials
          </a>
        </div>

        ${ops?.reachable === false
          ? html`<div class="callout warn" style="margin-top: 12px; font-size: 13px;">
              Workflow runtime is offline. If it just started, wait and refresh status.
            </div>`
          : nothing}
      </div>

      <div class="card">
        <div class="card-title">Basecamp</div>
        <div class="card-sub">Connect your Basecamp account for workflow and chat tools.</div>

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
              @input=${(e: Event) =>
                props.onBcgptApiKeyDraftChange((e.target as HTMLInputElement).value)}
              placeholder=${bcgptKeyPlaceholder}
              autocomplete="off"
              ?disabled=${!props.connected}
            />
          </label>
        </div>

        <div class="row" style="margin-top: 14px; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn--primary" ?disabled=${props.saving || !props.connected} @click=${() => props.onSave()}>
            ${props.saving ? "Saving..." : "Save"}
          </button>
          <button
            class="btn btn--secondary"
            ?disabled=${props.saving || !props.connected}
            @click=${() => props.onClearBcgptKey()}
          >
            Remove key
          </button>
          ${props.bcgptSavedOk ? html`<span class="chip chip-ok">Saved</span>` : nothing}
          ${props.basecampSetupOk ? html`<span class="chip chip-ok">Added to workflow engine</span>` : nothing}
        </div>

        ${props.onSetupBasecamp
          ? html`
              <div class="row" style="margin-top: 10px; align-items: center; gap: 10px;">
                <button
                  class="btn btn--secondary"
                  ?disabled=${!props.connected || props.basecampSetupPending}
                  @click=${() => props.onSetupBasecamp?.()}
                  title="Auto-configure Basecamp credentials in workflow engine"
                >
                  ${props.basecampSetupPending ? "Configuring..." : "Sync to Workflow Engine"}
                </button>
              </div>
              ${props.basecampSetupError
                ? html`<div class="callout danger" style="margin-top: 8px; font-size: 12px;">${props.basecampSetupError}</div>`
                : nothing}
            `
          : nothing}

        ${disabledReason
          ? html`<div class="muted" style="margin-top: 10px; font-size: 13px;">${disabledReason}</div>`
          : nothing}
      </div>
    </section>

    <section class="card">
      <div class="card-title">Connection Status</div>
      <div class="card-sub">Server-side health checks for external connectors.</div>

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
          ${props.connectorsLoading ? "Checking..." : "Refresh status"}
        </button>
      </div>

      ${props.connectorsError
        ? html`<div class="callout danger" style="margin-top: 14px;">${props.connectorsError}</div>`
        : nothing}

      ${props.error ? html`<div class="callout danger" style="margin-top: 14px;">${props.error}</div>` : nothing}
    </section>

    <section class="card">
      <div class="card-title">Workflow Credentials</div>
      <div class="card-sub">Credentials currently available inside your n8n workspace.</div>

      <div class="row" style="margin-top: 16px; align-items: center; gap: 10px;">
        <button
          class="btn btn--secondary"
          ?disabled=${!props.connected || props.n8nCredentialsLoading}
          @click=${() => props.onRefreshN8nCredentials?.()}
        >
          ${props.n8nCredentialsLoading ? "Loading..." : "Refresh Credentials"}
        </button>
        <a href=${opsUiHref} target="_blank" rel="noreferrer" class="btn btn--secondary">
          Manage in n8n
        </a>
      </div>

      ${props.n8nCredentialsError
        ? html`<div class="callout danger" style="margin-top: 12px; font-size: 12px;">${props.n8nCredentialsError}</div>`
        : nothing}

      ${props.n8nCredentials && props.n8nCredentials.length > 0
        ? html`
            <div class="list" style="margin-top: 12px;">
              ${props.n8nCredentials.map((cred) => html`
                <div
                  class="list-item"
                  style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 0;
                    border-bottom: 1px solid var(--border);
                  "
                >
                  <div>
                    <div style="font-weight: 500;">${cred.name}</div>
                    <div class="muted" style="font-size: 11px;">${cred.type}</div>
                  </div>
                  <span class="chip chip-ok" style="font-size: 10px;">Ready</span>
                </div>
              `)}
            </div>
          `
        : props.n8nCredentials && props.n8nCredentials.length === 0
          ? html`<div class="muted" style="margin-top: 12px; text-align: center; padding: 20px;">No credentials configured yet.</div>`
          : nothing}
    </section>
  `;
}
