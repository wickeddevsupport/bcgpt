import { html, nothing } from "lit";
import type { PmosConnectorsStatus } from "../controllers/pmos-connectors.ts";

export type IntegrationsProps = {
  connected: boolean;
  saving: boolean;
  error: string | null;
  activepiecesUrl: string;
  activepiecesApiKeyDraft: string;
  bcgptUrl: string;
  bcgptApiKeyDraft: string;
  connectorsLoading: boolean;
  connectorsStatus: PmosConnectorsStatus | null;
  connectorsError: string | null;
  onActivepiecesUrlChange: (next: string) => void;
  onActivepiecesApiKeyDraftChange: (next: string) => void;
  onBcgptUrlChange: (next: string) => void;
  onBcgptApiKeyDraftChange: (next: string) => void;
  onSave: () => void;
  onClearActivepiecesKey: () => void;
  onClearBcgptKey: () => void;
  onRefreshConnectors: () => void;
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
  const ap = props.connectorsStatus?.activepieces ?? null;
  const bcgpt = props.connectorsStatus?.bcgpt ?? null;

  const apConfigured = ap?.configured ?? false;
  const bcgptConfigured = bcgpt?.configured ?? false;

  const activepiecesKeyPlaceholder = apConfigured
    ? "Stored (leave blank to keep)"
    : "Paste Activepieces API key (ap_...)";
  const bcgptKeyPlaceholder = bcgptConfigured
    ? "Stored (leave blank to keep)"
    : "Paste BCGPT API key";

  const disabledReason = !props.connected
    ? "Connect to PMOS first (Dashboard -> Access Key -> Connect)."
    : null;

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">Activepieces (Flow Engine)</div>
        <div class="card-sub">Used for flows, pieces, connections, and run logs.</div>

        <div class="form-grid" style="margin-top: 16px;">
          <label class="field">
            <span>Base URL</span>
            <input
              .value=${props.activepiecesUrl}
              @input=${(e: Event) => props.onActivepiecesUrlChange((e.target as HTMLInputElement).value)}
              placeholder="https://flow.wickedlab.io"
              ?disabled=${!props.connected}
            />
          </label>
          <label class="field">
            <span>API Key</span>
            <input
              type="password"
              .value=${props.activepiecesApiKeyDraft}
              @input=${(e: Event) =>
                props.onActivepiecesApiKeyDraftChange((e.target as HTMLInputElement).value)}
              placeholder=${activepiecesKeyPlaceholder}
              autocomplete="off"
              ?disabled=${!props.connected}
            />
          </label>
        </div>

        <div class="row" style="margin-top: 14px;">
          <button class="btn" ?disabled=${props.saving || !props.connected} @click=${() => props.onSave()}>
            ${props.saving ? "Saving..." : "Save"}
          </button>
          <button
            class="btn btn--secondary"
            ?disabled=${props.saving || !props.connected}
            @click=${() => props.onClearActivepiecesKey()}
            title="Remove the stored Activepieces API key"
          >
            Clear key
          </button>
          <button
            class="btn btn--secondary"
            ?disabled=${props.connectorsLoading || !props.connected}
            @click=${() => props.onRefreshConnectors()}
          >
            ${props.connectorsLoading ? "Checking..." : "Test"}
          </button>
        </div>

        ${disabledReason ? html`<div class="muted" style="margin-top: 10px;">${disabledReason}</div>` : nothing}
      </div>

      <div class="card">
        <div class="card-title">BCGPT (MCP Connector)</div>
        <div class="card-sub">Basecamp OAuth + MCP tool surface. PMOS uses it as a connector.</div>

        <div class="form-grid" style="margin-top: 16px;">
          <label class="field">
            <span>Base URL</span>
            <input
              .value=${props.bcgptUrl}
              @input=${(e: Event) => props.onBcgptUrlChange((e.target as HTMLInputElement).value)}
              placeholder="https://bcgpt.wickedlab.io"
              ?disabled=${!props.connected}
            />
          </label>
          <label class="field">
            <span>API Key</span>
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
          <button class="btn" ?disabled=${props.saving || !props.connected} @click=${() => props.onSave()}>
            ${props.saving ? "Saving..." : "Save"}
          </button>
          <button
            class="btn btn--secondary"
            ?disabled=${props.saving || !props.connected}
            @click=${() => props.onClearBcgptKey()}
            title="Remove the stored BCGPT API key"
          >
            Clear key
          </button>
          <a
            class="btn btn--secondary"
            href=${props.bcgptUrl.replace(/\/$/, "") + "/connect"}
            target="_blank"
            rel="noreferrer"
            title="Open Basecamp connect flow in a new tab"
          >
            Connect Basecamp
          </a>
        </div>

        ${disabledReason ? html`<div class="muted" style="margin-top: 10px;">${disabledReason}</div>` : nothing}
      </div>
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">Status</div>
      <div class="card-sub">Server-side checks (no browser CORS issues).</div>

      <div class="stat-grid" style="margin-top: 16px;">
        ${renderConnectorStatus("Activepieces reachable", ap?.reachable ?? null, ap?.flagsUrl ?? null)}
        ${renderConnectorStatus("Activepieces auth", ap?.authOk ?? null, ap?.authUrl ?? null)}
        ${renderConnectorStatus("BCGPT reachable", bcgpt?.reachable ?? null, bcgpt?.healthUrl ?? null)}
        ${renderConnectorStatus("BCGPT auth", bcgpt?.authOk ?? null, bcgpt?.mcpUrl ?? null)}
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
