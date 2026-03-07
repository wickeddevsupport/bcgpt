import { html, nothing } from "lit";
import type { PmosConnectorsStatus } from "../controllers/pmos-connectors.ts";
import type { PmosModelRow } from "../controllers/pmos-model-auth.ts";

export type IntegrationsProps = {
  connected: boolean;
  saving: boolean;
  error: string | null;
  bcgptUrl: string;
  figmaUrl: string;
  bcgptApiKeyDraft: string;
  connectorsLoading: boolean;
  connectorsStatus: PmosConnectorsStatus | null;
  connectorsError: string | null;
  modelRows: PmosModelRow[];

  bcgptSavedOk?: boolean;
  onBcgptUrlChange: (next: string) => void;
  onFigmaUrlChange: (next: string) => void;
  onBcgptApiKeyDraftChange: (next: string) => void;
  onSave: () => void;
  onClearBcgptKey: () => void;
  onRefreshConnectors: () => void;
  onOpenModels: () => void;
  onOpenAutomations: () => void;
  onOpenFigma: () => void;

  // Workflow engine provisioning status
  opsProvisioned?: boolean;
  opsProjectId?: string | null;
  opsUiHref?: string;

  // Basecamp credential setup in workflow engine
  basecampSetupPending?: boolean;
  basecampSetupOk?: boolean;
  basecampSetupError?: string | null;
  onSetupBasecamp?: () => void;

  // Workflow credentials
  workflowCredentials?: Array<{ id: string; name: string; type: string }>;
  workflowCredentialsLoading?: boolean;
  workflowCredentialsError?: string | null;
  onRefreshWorkflowCredentials?: () => void;
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

function renderChip(text: string, tone: "ok" | "warn" | "muted" = "muted") {
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

export function renderIntegrations(props: IntegrationsProps) {
  const bcgpt = props.connectorsStatus?.bcgpt ?? null;
  const bcgptIdentity = bcgpt?.identity ?? null;
  const ops = props.connectorsStatus?.ops ?? null;
  const figma = props.connectorsStatus?.figma ?? null;
  const figmaIdentity = figma?.identity ?? null;
  const modelRows = props.modelRows ?? [];
  const activeModel = modelRows.find((row) => row.active) ?? null;
  const configuredModelCount = modelRows.filter((row) => row.workspaceOverride).length;

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
  const bcgptConnectHref = `${(props.bcgptUrl || "https://bcgpt.wickedlab.io").replace(/\/+$/, "")}/connect`;

  const projectIdShort = props.opsProjectId ? String(props.opsProjectId).slice(0, 8) : null;
  return html`
    <section class="grid grid-cols-2" style="margin-bottom: 18px;">
      <div class="card">
        <div class="card-title">Model Management</div>
        <div class="card-sub">
          Models moved to a dedicated tab for cleaner UX and card-based editing.
        </div>

        <div class="row" style="margin-top:12px; gap:8px; flex-wrap:wrap;">
          ${activeModel
            ? renderChip(`Active: ${activeModel.ref}`, "ok")
            : renderChip("No active model", "warn")}
          ${renderChip(`Configured: ${configuredModelCount}`, "muted")}
        </div>

        <div class="row" style="margin-top:12px;">
          <button class="btn btn--primary" ?disabled=${!props.connected} @click=${() => props.onOpenModels()}>
            Open Models Tab
          </button>
        </div>

        ${disabledReason
          ? html`<div class="muted" style="margin-top: 10px; font-size: 13px;">${disabledReason}</div>`
          : nothing}
      </div>

      <div class="card">
        <div class="card-title">Workflow Engine</div>
        <div class="card-sub">
          Your private workflow engine runtime for automations in your workspace.
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

        <div class="muted" style="font-size:12px; margin-top:8px;">
          Workflow users are auto-provisioned from PMOS logins. Password changes in PMOS are synced automatically.
        </div>

        <div class="row" style="margin-top: 12px; gap:8px;">
          <button class="btn btn--secondary" @click=${() => props.onOpenAutomations()}>
            Open Automations
          </button>
        </div>

        ${ops?.reachable === false
          ? html`<div class="callout warn" style="margin-top: 12px; font-size: 13px;">
              Workflow runtime is offline. If it just started, wait and refresh status.
            </div>`
          : nothing}
      </div>
    </section>

    <section class="grid grid-cols-2" style="margin-bottom: 18px;">
      <div class="card">
        <div class="card-title">Figma File Manager</div>
        <div class="card-sub">
          Embed your Figma workspace, sync active team/file context into PMOS, and use design audit prompts.
        </div>

        <div class="form-grid" style="margin-top: 16px;">
          <label class="field">
            <span>Figma App URL</span>
            <input
              type="url"
              .value=${props.figmaUrl}
              @input=${(e: Event) => props.onFigmaUrlChange((e.target as HTMLInputElement).value)}
              placeholder="https://fm.wickedwebsites.us"
              ?disabled=${!props.connected}
            />
          </label>
        </div>

        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">Status</div>
            <div class="stat-value ${figma?.reachable === true ? "ok" : figma?.reachable === false ? "warn" : ""}">
              ${figma?.reachable === true ? "Online" : figma?.reachable === false ? "Offline" : "Unknown"}
            </div>
            <div class="muted" style="font-size:11px;">${figma?.url ?? props.figmaUrl}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Context</div>
            <div class="stat-value ${figmaIdentity?.connected ? "ok" : "warn"}">
              ${figmaIdentity?.connected ? "Synced" : "Pending"}
            </div>
            <div class="muted" style="font-size:11px;">
              ${figmaIdentity?.activeConnectionName ?? figmaIdentity?.handle ?? "No active connection synced yet."}
            </div>
          </div>
        </div>

        ${figmaIdentity
          ? html`
              <div class="callout" style="margin-top: 12px; font-size: 12px;">
                <div><strong>User:</strong> ${figmaIdentity.handle ?? figmaIdentity.email ?? "Unknown"}</div>
                <div><strong>Team:</strong> ${figmaIdentity.activeConnectionName ?? figmaIdentity.activeTeamId ?? "Not synced"}</div>
                ${figmaIdentity.selectedFileUrl
                  ? html`<div><strong>Selected file:</strong> <span class="mono">${figmaIdentity.selectedFileName ?? figmaIdentity.selectedFileUrl}</span></div>`
                  : nothing}
              </div>
            `
          : nothing}

        <div class="row" style="margin-top: 14px; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn--primary" ?disabled=${props.saving || !props.connected} @click=${() => props.onSave()}>
            ${props.saving ? "Saving..." : "Save"}
          </button>
          <button class="btn btn--secondary" ?disabled=${!props.connected} @click=${() => props.onOpenFigma()}>
            Open Figma Panel
          </button>
        </div>

        ${figma?.error
          ? html`<div class="callout warn" style="margin-top: 12px; font-size: 12px;">${figma.error}</div>`
          : nothing}
      </div>

      <div class="card">
        <div class="card-title">Basecamp</div>
        <div class="card-sub">
          Save your BCGPT key once. PMOS uses it for chat and auto-syncs the same connection into Flow.
        </div>
        <div class="row" style="margin-top: 10px; gap: 8px; flex-wrap: wrap; align-items: center;">
          <a
            href=${bcgptConnectHref}
            target="_blank"
            rel="noreferrer"
            class="btn btn--secondary"
            title="Open BCGPT connect page to generate/manage your Basecamp connection key"
          >
            Open BCGPT Connect
          </a>
          <span class="muted mono" style="font-size: 12px;">${bcgptConnectHref}</span>
        </div>
        <div class="muted mono" style="font-size: 12px; margin-top: 8px;">
          Endpoint: https://bcgpt.wickedlab.io
        </div>
        <div class="muted" style="font-size: 12px; margin-top: 8px;">
          Flow sync is automatic after save. If Basecamp OAuth is not linked yet, complete it in BCGPT first.
        </div>

        <div class="form-grid" style="margin-top: 16px;">
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
          ${props.basecampSetupOk ? html`<span class="chip chip-ok">Synced to Flow</span>` : nothing}
        </div>

        ${bcgptIdentity
          ? html`
              <div class="callout" style="margin-top: 10px; font-size: 12px;">
                <div><strong>API Key:</strong> ${bcgptIdentity.connected ? html`<span style="color:#22c55e">[OK] Valid</span>` : html`<span style="color:#f87171">[X] Not recognized</span>`}</div>
                <div><strong>Basecamp OAuth:</strong> ${bcgptIdentity.basecampConnected ? html`<span style="color:#22c55e">[OK] Linked</span>` : html`<span style="color:#f59e0b">[!] Not linked - <a href=${`${(props.bcgptUrl || "https://bcgpt.wickedlab.io").replace(/\/+$/, "")}/connect`} target="_blank" rel="noreferrer">Connect Basecamp</a></span>`}</div>
                ${bcgptIdentity.name || bcgptIdentity.email
                  ? html`<div><strong>User:</strong> ${bcgptIdentity.name ?? "-"} ${bcgptIdentity.email ? html`<span class="mono">(${bcgptIdentity.email})</span>` : nothing}</div>`
                  : nothing}
                ${bcgptIdentity.selectedAccountId
                  ? html`<div><strong>Selected account:</strong> <span class="mono">${bcgptIdentity.selectedAccountId}</span></div>`
                  : nothing}
                ${typeof bcgptIdentity.accountsCount === "number" && bcgptIdentity.accountsCount > 0
                  ? html`<div><strong>Authorized accounts:</strong> ${bcgptIdentity.accountsCount}</div>`
                  : nothing}
                ${bcgptIdentity.message
                  ? html`<div class="muted" style="margin-top:4px;">${bcgptIdentity.message}</div>`
                  : nothing}
              </div>
            `
          : nothing}

        ${props.onSetupBasecamp
          ? html`
              <div class="row" style="margin-top: 10px; align-items: center; gap: 10px;">
                <button
                  class="btn btn--secondary"
                  ?disabled=${!props.connected || props.basecampSetupPending}
                  @click=${() => props.onSetupBasecamp?.()}
                  title="Retry Basecamp sync into the workflow engine"
                >
                  ${props.basecampSetupPending ? "Syncing..." : "Retry Flow Sync"}
                </button>
              </div>
              ${props.basecampSetupError
                ? html`<div class="callout danger" style="margin-top: 8px; font-size: 12px;">Saved in PMOS, but Flow sync failed: ${props.basecampSetupError}</div>`
                : nothing}
            `
          : nothing}
      </div>

      <div class="card">
        <div class="card-title">Flow Connections</div>
        <div class="card-sub">
          Connections currently available inside your Activepieces workspace.
        </div>

        <div class="row" style="margin-top: 16px; align-items: center; gap: 10px;">
          <button
            class="btn btn--secondary"
            ?disabled=${!props.connected || props.workflowCredentialsLoading}
            @click=${() => props.onRefreshWorkflowCredentials?.()}
          >
            ${props.workflowCredentialsLoading ? "Loading..." : "Refresh Connections"}
          </button>
        </div>

        ${props.workflowCredentialsError
          ? html`<div class="callout danger" style="margin-top: 12px; font-size: 12px;">${props.workflowCredentialsError}</div>`
          : nothing}
        ${!props.workflowCredentialsLoading && (props.workflowCredentials?.length ?? 0) === 0
          ? html`<div class="muted" style="margin-top: 12px;">No connections found in your Activepieces workspace.</div>`
          : nothing}
        ${props.workflowCredentials && props.workflowCredentials.length > 0
          ? html`
              <div class="list" style="margin-top: 12px;">
                ${props.workflowCredentials.slice(0, 8).map(
                  (cred) => html`
                    <div class="list-item" style="display:flex;justify-content:space-between;gap:10px;">
                      <div class="mono">${cred.name}</div>
                      <div class="muted">${cred.type}</div>
                    </div>
                  `,
                )}
              </div>
            `
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
      ${disabledReason
        ? html`<div class="muted" style="margin-top: 10px; font-size: 13px;">${disabledReason}</div>`
        : nothing}
    </section>
  `;
}

