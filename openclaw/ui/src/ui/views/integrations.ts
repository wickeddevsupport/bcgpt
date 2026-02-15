import { html, nothing } from "lit";
import type { PmosConnectorsStatus } from "../controllers/pmos-connectors.ts";
import type {
  ActivepiecesConnectionSummary,
  ActivepiecesPieceSummary,
} from "../controllers/pmos-activepieces.ts";

export type IntegrationsProps = {
  connected: boolean;
  saving: boolean;
  error: string | null;
  activepiecesUrl: string;
  activepiecesProjectId: string;
  activepiecesApiKeyDraft: string;
  bcgptUrl: string;
  bcgptApiKeyDraft: string;
  connectorsLoading: boolean;
  connectorsStatus: PmosConnectorsStatus | null;
  connectorsError: string | null;
  onActivepiecesUrlChange: (next: string) => void;
  onActivepiecesProjectIdChange: (next: string) => void;
  onActivepiecesApiKeyDraftChange: (next: string) => void;
  onBcgptUrlChange: (next: string) => void;
  onBcgptApiKeyDraftChange: (next: string) => void;
  onSave: () => void;
  onClearActivepiecesKey: () => void;
  onClearBcgptKey: () => void;
  onRefreshConnectors: () => void;

  // Phase 2: Activepieces native embed
  apPiecesLoading: boolean;
  apPiecesError: string | null;
  apPiecesQuery: string;
  apPieces: ActivepiecesPieceSummary[];
  onApPiecesQueryChange: (next: string) => void;
  onApPiecesRefresh: () => void;

  apConnectionsLoading: boolean;
  apConnectionsError: string | null;
  apConnections: ActivepiecesConnectionSummary[];
  apConnectionCreateSaving: boolean;
  apConnectionCreateError: string | null;
  apConnectionCreatePieceName: string;
  apConnectionCreateDisplayName: string;
  apConnectionCreateType: "secret_text" | "basic_auth" | "no_auth";
  apConnectionCreateSecretText: string;
  apConnectionCreateBasicUser: string;
  apConnectionCreateBasicPass: string;
  onApConnectionsRefresh: () => void;
  onApConnectionCreate: () => void;
  onApConnectionDelete: (connectionId: string) => void;
  onApConnectionCreatePieceNameChange: (next: string) => void;
  onApConnectionCreateDisplayNameChange: (next: string) => void;
  onApConnectionCreateTypeChange: (next: "secret_text" | "basic_auth" | "no_auth") => void;
  onApConnectionCreateSecretTextChange: (next: string) => void;
  onApConnectionCreateBasicUserChange: (next: string) => void;
  onApConnectionCreateBasicPassChange: (next: string) => void;
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
            <span>Project ID (optional)</span>
            <input
              .value=${props.activepiecesProjectId}
              @input=${(e: Event) => props.onActivepiecesProjectIdChange((e.target as HTMLInputElement).value)}
              placeholder="Used for flow CRUD later"
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

    <section class="grid grid-cols-2" style="margin-top: 18px;">
      <div class="card">
        <div class="card-title">Pieces Catalog</div>
        <div class="card-sub">Browse Activepieces integrations (200+).</div>

        <div class="form-grid" style="margin-top: 14px;">
          <label class="field full">
            <span>Search</span>
            <input
              .value=${props.apPiecesQuery}
              @input=${(e: Event) => props.onApPiecesQueryChange((e.target as HTMLInputElement).value)}
              placeholder="e.g. Slack, Gmail, Notion"
              ?disabled=${!props.connected}
            />
          </label>
        </div>

        <div class="row" style="margin-top: 12px;">
          <button
            class="btn"
            ?disabled=${!props.connected || props.apPiecesLoading}
            @click=${() => props.onApPiecesRefresh()}
          >
            ${props.apPiecesLoading ? "Loading..." : "Load pieces"}
          </button>
        </div>

        ${props.apPiecesError ? html`<div class="callout danger" style="margin-top: 12px;">${props.apPiecesError}</div>` : nothing}

        <div class="list" style="margin-top: 14px; max-height: 420px; overflow: auto;">
          ${props.apPieces.map((piece) => {
            const title = piece.displayName || piece.name || "Piece";
            const sub = piece.name || "";
            const desc = piece.description || "";
            return html`
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">${title}</div>
                  <div class="list-sub mono">${sub}</div>
                  ${desc ? html`<div class="list-sub">${desc}</div>` : nothing}
                </div>
              </div>
            `;
          })}
          ${props.apPieces.length === 0 && !props.apPiecesLoading ? html`<div class="muted">No pieces loaded.</div>` : nothing}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Connections</div>
        <div class="card-sub">Create and manage Activepieces app connections for your project.</div>

        <div class="form-grid" style="margin-top: 14px;">
          <label class="field">
            <span>Piece name</span>
            <input
              .value=${props.apConnectionCreatePieceName}
              @input=${(e: Event) => props.onApConnectionCreatePieceNameChange((e.target as HTMLInputElement).value)}
              placeholder="e.g. slack"
              ?disabled=${!props.connected}
            />
          </label>
          <label class="field">
            <span>Display name</span>
            <input
              .value=${props.apConnectionCreateDisplayName}
              @input=${(e: Event) => props.onApConnectionCreateDisplayNameChange((e.target as HTMLInputElement).value)}
              placeholder="e.g. Slack (Prod)"
              ?disabled=${!props.connected}
            />
          </label>
          <label class="field">
            <span>Auth type</span>
            <select
              .value=${props.apConnectionCreateType}
              @change=${(e: Event) =>
                props.onApConnectionCreateTypeChange((e.target as HTMLSelectElement).value as any)}
              ?disabled=${!props.connected}
            >
              <option value="secret_text">Secret Text</option>
              <option value="basic_auth">Basic Auth</option>
              <option value="no_auth">No Auth</option>
            </select>
          </label>

          ${
            props.apConnectionCreateType === "secret_text"
              ? html`
                  <label class="field full">
                    <span>Secret</span>
                    <input
                      type="password"
                      .value=${props.apConnectionCreateSecretText}
                      @input=${(e: Event) =>
                        props.onApConnectionCreateSecretTextChange((e.target as HTMLInputElement).value)}
                      placeholder="token / api key"
                      autocomplete="off"
                      ?disabled=${!props.connected}
                    />
                  </label>
                `
              : nothing
          }

          ${
            props.apConnectionCreateType === "basic_auth"
              ? html`
                  <label class="field">
                    <span>Username</span>
                    <input
                      .value=${props.apConnectionCreateBasicUser}
                      @input=${(e: Event) =>
                        props.onApConnectionCreateBasicUserChange((e.target as HTMLInputElement).value)}
                      placeholder="username"
                      ?disabled=${!props.connected}
                    />
                  </label>
                  <label class="field">
                    <span>Password</span>
                    <input
                      type="password"
                      .value=${props.apConnectionCreateBasicPass}
                      @input=${(e: Event) =>
                        props.onApConnectionCreateBasicPassChange((e.target as HTMLInputElement).value)}
                      placeholder="password"
                      autocomplete="off"
                      ?disabled=${!props.connected}
                    />
                  </label>
                `
              : nothing
          }
        </div>

        <div class="row" style="margin-top: 12px;">
          <button
            class="btn primary"
            ?disabled=${!props.connected || props.apConnectionCreateSaving}
            @click=${() => props.onApConnectionCreate()}
          >
            ${props.apConnectionCreateSaving ? "Creating..." : "Create connection"}
          </button>
          <button
            class="btn btn--secondary"
            ?disabled=${!props.connected || props.apConnectionsLoading}
            @click=${() => props.onApConnectionsRefresh()}
          >
            ${props.apConnectionsLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        ${props.apConnectionCreateError ? html`<div class="callout danger" style="margin-top: 12px;">${props.apConnectionCreateError}</div>` : nothing}
        ${props.apConnectionsError ? html`<div class="callout danger" style="margin-top: 12px;">${props.apConnectionsError}</div>` : nothing}

        <div class="list" style="margin-top: 14px; max-height: 420px; overflow: auto;">
          ${props.apConnections.map((conn) => {
            const title = conn.displayName || conn.id;
            const sub = [conn.pieceName ? `piece ${conn.pieceName}` : null, conn.status ? conn.status : null]
              .filter(Boolean)
              .join(" · ");
            return html`
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">${title}</div>
                  <div class="list-sub mono">${conn.id}</div>
                  ${sub ? html`<div class="list-sub">${sub}</div>` : nothing}
                </div>
                <div class="list-meta">
                  <div></div>
                  <div>
                    <button class="btn btn--sm danger" @click=${() => props.onApConnectionDelete(conn.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            `;
          })}
          ${props.apConnections.length === 0 && !props.apConnectionsLoading ? html`<div class="muted">No connections loaded.</div>` : nothing}
        </div>
      </div>
    </section>
  `;
}
