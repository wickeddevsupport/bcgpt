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

function resolveAgentModelSelectValue(
  assignment: PmosAgentModelAssignment,
  options: string[],
): string {
  const current = assignment.modelRef?.trim() ?? "";
  if (!current) {
    return "";
  }
  return options.includes(current) ? current : current;
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
            Configure models directly from config, set workspace default, and map models to agents.
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
          ${activeModel
            ? renderModelToneChip(`Active: ${activeModel.ref}`, "ok")
            : renderModelToneChip("No active model", "warn")}
          ${props.modelCatalogLoading ? renderModelToneChip("Catalog loading", "muted") : nothing}
        </div>
      </div>

      <div class="form-grid" style="margin-bottom: 14px; grid-template-columns: 2fr 1fr;">
        <label class="field full">
          <span>Model reference (provider/model)</span>
          <input
            list="pmos-model-options"
            .value=${props.modelRefDraft}
            @input=${(e: Event) => props.onModelRefDraftChange((e.target as HTMLInputElement).value)}
            placeholder="e.g. zai/glm-5 or openai/gpt-5"
            ?disabled=${!props.connected || props.modelSaving}
          />
          <datalist id="pmos-model-options">
            ${modelOptions.map((opt) => html`<option value=${opt}></option>`)}
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
      </div>

      <div class="row" style="gap: 8px; flex-wrap: wrap; align-items:center;">
        <button
          class="btn btn--primary"
          ?disabled=${!props.connected || props.modelSaving || !props.modelRefDraft.trim()}
          @click=${() => props.onModelSave()}
        >
          ${props.modelSaving ? "Saving..." : "Save and Activate"}
        </button>
        <button
          class="btn btn--secondary"
          ?disabled=${!props.connected || props.modelSaving || !props.modelRefDraft.trim()}
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

      <div style="margin-top: 18px; border-top: 1px solid var(--border-color, rgba(255,255,255,0.08)); padding-top: 14px;">
        <div class="card-title" style="font-size: 14px; margin-bottom: 8px;">Configured Models</div>
        ${modelRows.length === 0
          ? html`<div class="muted" style="padding: 10px 0;">No configured models yet.</div>`
          : html`
              <div class="list" style="display:flex; flex-direction:column; gap:8px;">
                ${modelRows.map((row) => html`
                  <div class="list-item" style="padding:10px; border:1px solid var(--border-color, rgba(255,255,255,0.08)); border-radius:10px;">
                    <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
                      <div style="min-width:0; flex:1;">
                        <div style="font-weight:600;" class="mono">${row.ref}</div>
                        <div class="muted" style="font-size:12px; margin-top:2px;">
                          ${row.alias ? `Alias: ${row.alias}` : "No alias"}
                        </div>
                        <div class="muted" style="font-size:12px; margin-top:2px;">
                          ${row.usedBy.length > 0
                            ? `Used by: ${row.usedBy.join(", ")}`
                            : "Used by: none"}
                        </div>
                      </div>
                      <div class="row" style="gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                        ${row.active ? renderModelToneChip("Active", "ok") : nothing}
                        ${row.configured
                          ? renderModelToneChip("Key configured", "ok")
                          : renderModelToneChip("No key", "warn")}
                        ${row.inCatalog
                          ? renderModelToneChip("Catalog", "muted")
                          : renderModelToneChip("Custom", "muted")}
                        ${row.workspaceOverride
                          ? renderModelToneChip("Configured in JSON", "muted")
                          : renderModelToneChip("Catalog only", "muted")}
                      </div>
                    </div>
                    <div class="row" style="margin-top:8px; gap:6px; flex-wrap:wrap;">
                      ${!row.active
                        ? html`
                            <button
                              class="btn btn--secondary"
                              ?disabled=${!props.connected || props.modelSaving}
                              @click=${() => props.onModelActivate(row.ref)}
                            >
                              Activate
                            </button>
                          `
                        : nothing}
                      ${row.workspaceOverride
                        ? html`
                            <button
                              class="btn btn--secondary"
                              ?disabled=${!props.connected || props.modelSaving}
                              @click=${() => props.onModelDeactivate(row.ref)}
                            >
                              Deactivate
                            </button>
                            <button
                              class="btn btn--secondary"
                              ?disabled=${!props.connected || props.modelSaving}
                              @click=${() => {
                                if (!window.confirm(`Delete model ${row.ref} from openclaw config?`)) {
                                  return;
                                }
                                props.onModelDelete(row.ref);
                              }}
                            >
                              Delete
                            </button>
                          `
                        : nothing}
                      <button
                        class="btn btn--secondary"
                        ?disabled=${!props.connected || props.modelSaving}
                        @click=${() => props.onModelClearKeyForRef(row.ref)}
                      >
                        Remove key
                      </button>
                    </div>
                  </div>
                `)}
              </div>
            `}
      </div>

      <div style="margin-top: 18px; border-top: 1px solid var(--border-color, rgba(255,255,255,0.08)); padding-top: 14px;">
        <div class="card-title" style="font-size: 14px; margin-bottom: 8px;">Agent Model Assignment</div>
        ${props.agentModelAssignments.length === 0
          ? html`<div class="muted" style="padding: 10px 0;">No agents found.</div>`
          : html`
              <div class="list" style="display:flex; flex-direction:column; gap:8px;">
                ${props.agentModelAssignments.map((assignment) => {
                  const selected = resolveAgentModelSelectValue(assignment, modelOptions);
                  return html`
                    <div class="list-item" style="padding:10px; border:1px solid var(--border-color, rgba(255,255,255,0.08)); border-radius:10px; display:flex; gap:10px; align-items:center; justify-content:space-between;">
                      <div>
                        <div style="font-weight:600;">${assignment.label}</div>
                        <div class="muted" style="font-size:12px;">
                          ${assignment.inherited ? "Uses workspace default" : "Explicit model"}
                        </div>
                      </div>
                      <label class="field" style="margin:0; min-width:260px;">
                        <select
                          .value=${selected}
                          ?disabled=${!props.connected || props.modelSaving}
                          @change=${(e: Event) => {
                            const next = (e.target as HTMLSelectElement).value.trim();
                            props.onAssignAgentModel(assignment.agentId, next || null);
                          }}
                        >
                          <option value="">Use workspace default</option>
                          ${!selected || modelOptions.includes(selected)
                            ? nothing
                            : html`<option value=${selected}>${selected}</option>`}
                          ${modelOptions.map((opt) => html`<option value=${opt}>${opt}</option>`)}
                        </select>
                      </label>
                    </div>
                  `;
                })}
              </div>
            `}
      </div>

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
