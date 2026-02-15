import { html, nothing } from "lit";
import type { UiSettings } from "../storage.ts";
import type { PmosConnectorsStatus } from "../controllers/pmos-connectors.ts";
import { formatRelativeTimestamp } from "../format.ts";

export type DashboardProps = {
  connected: boolean;
  settings: UiSettings;
  lastError: string | null;
  connectorsLoading: boolean;
  connectorsError: string | null;
  connectorsStatus: PmosConnectorsStatus | null;
  integrationsHref: string;
  onSettingsChange: (next: UiSettings) => void;
  onConnect: () => void;
  onRefreshConnectors: () => void;
};

function renderStatusPill(label: string, value: string, status: "ok" | "warn" | "muted") {
  return html`
    <div class="pill">
      <span class="statusDot ${status === "ok" ? "ok" : ""}"></span>
      <span>${label}</span>
      <span class="mono">${value}</span>
    </div>
  `;
}

export function renderDashboard(props: DashboardProps) {
  const ap = props.connectorsStatus?.activepieces ?? null;
  const bcgpt = props.connectorsStatus?.bcgpt ?? null;

  const checkedAt = props.connectorsStatus?.checkedAtMs ?? null;
  const checkedLabel = checkedAt ? formatRelativeTimestamp(checkedAt) : "n/a";

  const apStatus = (() => {
    if (!ap) return { label: "Unknown", tone: "muted" as const };
    if (!ap.configured) return { label: "Not connected", tone: "warn" as const };
    if (ap.reachable === false || ap.authOk === false) return { label: "Needs attention", tone: "warn" as const };
    if (ap.reachable === true && (ap.authOk === true || ap.authOk === null)) return { label: "OK", tone: "ok" as const };
    return { label: "Checking", tone: "muted" as const };
  })();

  const bcgptStatus = (() => {
    if (!bcgpt) return { label: "Unknown", tone: "muted" as const };
    if (!bcgpt.configured) return { label: "Not connected", tone: "warn" as const };
    if (bcgpt.reachable === false || bcgpt.authOk === false) return { label: "Needs attention", tone: "warn" as const };
    if (bcgpt.reachable === true && (bcgpt.authOk === true || bcgpt.authOk === null)) return { label: "OK", tone: "ok" as const };
    return { label: "Checking", tone: "muted" as const };
  })();

  const showAccessCard = !props.connected || !props.settings.token.trim();

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">Integration Health</div>
        <div class="card-sub">Activepieces and BCGPT connector status.</div>

        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">Activepieces</div>
            <div class="stat-value ${apStatus.tone === "ok" ? "ok" : apStatus.tone === "warn" ? "warn" : ""}">
              ${apStatus.label}
            </div>
            <div class="muted mono">${ap?.url ?? "https://flow.wickedlab.io"}</div>
          </div>
          <div class="stat">
            <div class="stat-label">BCGPT</div>
            <div class="stat-value ${bcgptStatus.tone === "ok" ? "ok" : bcgptStatus.tone === "warn" ? "warn" : ""}">
              ${bcgptStatus.label}
            </div>
            <div class="muted mono">${bcgpt?.url ?? "https://bcgpt.wickedlab.io"}</div>
          </div>
        </div>

        <div class="row" style="margin-top: 14px;">
          <button
            class="btn"
            ?disabled=${props.connectorsLoading || !props.connected}
            @click=${() => props.onRefreshConnectors()}
            title=${props.connected ? "Refresh integration checks" : "Connect first"}
          >
            ${props.connectorsLoading ? "Checking..." : "Refresh"}
          </button>
          <a class="btn btn--secondary" href=${props.integrationsHref} title="Open Integrations">
            Connect integrations
          </a>
          <span class="muted">Last check: ${checkedLabel}</span>
        </div>

        ${
          props.connectorsError
            ? html`<div class="callout danger" style="margin-top: 14px;">
                <div>${props.connectorsError}</div>
              </div>`
            : nothing
        }
      </div>

      <div class="card">
        <div class="card-title">Automation Live</div>
        <div class="card-sub">Runs, failures, retries, and pending approvals.</div>
        <div class="muted" style="margin-top: 16px;">
          Coming next: a live runs feed (Activepieces + agent actions) and one-click drill-down.
        </div>
      </div>
    </section>

    <section class="grid grid-cols-2" style="margin-top: 18px;">
      <div class="card">
        <div class="card-title">Agent Timeline</div>
        <div class="card-sub">What the AI executed, what changed, and what needs approval.</div>
        <div class="muted" style="margin-top: 16px;">
          Phase 1 ships the UX shell and connector onboarding. Timeline and flow runs land in Phase 2.
        </div>
      </div>

      <div class="card">
        <div class="card-title">System</div>
        <div class="card-sub">PMOS access and gateway connection.</div>

        ${
          showAccessCard
            ? html`
                <div class="form-grid" style="margin-top: 16px;">
                  <label class="field">
                    <span>PMOS Access Key</span>
                    <input
                      type="password"
                      .value=${props.settings.token}
                      @input=${(e: Event) => {
                        const token = (e.target as HTMLInputElement).value;
                        props.onSettingsChange({ ...props.settings, token });
                      }}
                      placeholder="Paste your access key"
                      autocomplete="off"
                    />
                  </label>
                </div>
                <div class="row" style="margin-top: 14px;">
                  <button class="btn" @click=${() => props.onConnect()} ?disabled=${!props.settings.token.trim()}>
                    Connect
                  </button>
                  <span class="muted">
                    Your key is stored locally in this browser only.
                  </span>
                </div>
              `
            : html`
                <div style="margin-top: 16px;">
                  ${renderStatusPill("Gateway", props.connected ? "Connected" : "Offline", props.connected ? "ok" : "warn")}
                </div>
              `
        }

        ${
          props.lastError
            ? html`<div class="callout danger" style="margin-top: 14px;">
                <div>${props.lastError}</div>
              </div>`
            : nothing
        }
      </div>
    </section>
  `;
}

