import { html, nothing } from "lit";
import type { UiSettings } from "../storage.ts";
import type { PmosConnectorsStatus } from "../controllers/pmos-connectors.ts";
import type {
  ActivepiecesFlowSummary,
  ActivepiecesRunSummary,
} from "../controllers/pmos-activepieces.ts";
import type { PmosExecutionTraceEvent } from "../controllers/pmos-trace.ts";
import { formatRelativeTimestamp } from "../format.ts";

export type DashboardProps = {
  connected: boolean;
  settings: UiSettings;
  lastError: string | null;
  connectorsLoading: boolean;
  connectorsError: string | null;
  connectorsStatus: PmosConnectorsStatus | null;
  projectId: string;
  flowsLoading: boolean;
  flowsError: string | null;
  flows: ActivepiecesFlowSummary[];
  runsLoading: boolean;
  runsError: string | null;
  runs: ActivepiecesRunSummary[];
  traceEvents: PmosExecutionTraceEvent[];
  integrationsHref: string;
  automationsHref: string;
  runsHref: string;
  chatHref: string;
  onSettingsChange: (next: UiSettings) => void;
  onConnect: () => void;
  onRefreshConnectors: () => void;
  onRefreshDashboard: () => void;
  onClearTrace: () => void;
};

function renderStatusPill(label: string, value: string, status: "ok" | "warn") {
  return html`
    <div class="pill">
      <span class="statusDot ${status === "ok" ? "ok" : ""}"></span>
      <span>${label}</span>
      <span class="mono">${value}</span>
    </div>
  `;
}

function runStatusBucket(statusRaw: string) {
  const status = statusRaw.toUpperCase();
  if (status.includes("FAIL")) return "failed";
  if (status.includes("SUCCESS") || status.includes("SUCCEEDED")) return "succeeded";
  if (status.includes("RUNNING") || status.includes("EXECUTING") || status.includes("IN_PROGRESS")) {
    return "running";
  }
  return "other";
}

function traceStatusClass(status: PmosExecutionTraceEvent["status"]) {
  if (status === "success") return "chip chip-ok";
  if (status === "error") return "chip chip-danger";
  if (status === "running") return "chip chip-warn";
  return "chip";
}

function relativeFromAny(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatRelativeTimestamp(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return formatRelativeTimestamp(parsed);
    }
  }
  return "n/a";
}

export function renderDashboard(props: DashboardProps) {
  const ap = props.connectorsStatus?.activepieces ?? null;
  const bcgpt = props.connectorsStatus?.bcgpt ?? null;
  const checkedAt = props.connectorsStatus?.checkedAtMs ?? null;
  const checkedLabel = checkedAt ? formatRelativeTimestamp(checkedAt) : "n/a";

  const apStatus = (() => {
    if (!ap) return { label: "Unknown", tone: "warn" as const };
    if (!ap.configured) return { label: "Not connected", tone: "warn" as const };
    if (ap.reachable === false || ap.authOk === false) return { label: "Needs attention", tone: "warn" as const };
    if (ap.reachable === true && (ap.authOk === true || ap.authOk === null)) return { label: "OK", tone: "ok" as const };
    return { label: "Checking", tone: "warn" as const };
  })();

  const bcgptStatus = (() => {
    if (!bcgpt) return { label: "Unknown", tone: "warn" as const };
    if (!bcgpt.configured) return { label: "Not connected", tone: "warn" as const };
    if (bcgpt.reachable === false || bcgpt.authOk === false) return { label: "Needs attention", tone: "warn" as const };
    if (bcgpt.reachable === true && (bcgpt.authOk === true || bcgpt.authOk === null)) return { label: "OK", tone: "ok" as const };
    return { label: "Checking", tone: "warn" as const };
  })();

  const showAccessCard = !props.connected || !props.settings.token.trim();
  const flows = props.flows ?? [];
  const runs = props.runs ?? [];
  const trace = props.traceEvents ?? [];
  const projectConfigured = Boolean(props.projectId.trim());
  const enabledFlows = flows.filter((flow) => String(flow.status ?? "").toUpperCase() === "ENABLED").length;

  const runBuckets = runs.reduce(
    (acc, run) => {
      const key = runStatusBucket(String(run.status ?? ""));
      acc[key] += 1;
      return acc;
    },
    { succeeded: 0, failed: 0, running: 0, other: 0 },
  );

  const isConnectorHealthy = apStatus.tone === "ok" && bcgptStatus.tone === "ok";
  const pulse = (() => {
    if (!projectConfigured) return { label: "Project setup required", tone: "warn" as const };
    if (!isConnectorHealthy) return { label: "Connector risk", tone: "warn" as const };
    if (runBuckets.failed > 0) return { label: "Failures need review", tone: "warn" as const };
    if (flows.length === 0) return { label: "Ready to build", tone: "warn" as const };
    return { label: "Healthy", tone: "ok" as const };
  })();

  const refreshBusy = props.connectorsLoading || props.flowsLoading || props.runsLoading;
  const focusItems = [
    !projectConfigured
      ? {
          title: "Set Flow Pieces project",
          detail: "Integrations -> Flow Pieces -> Project ID",
          href: props.integrationsHref,
        }
      : null,
    apStatus.tone !== "ok"
      ? { title: "Fix Flow Pieces connector", detail: "Resolve auth or URL issues", href: props.integrationsHref }
      : null,
    bcgptStatus.tone !== "ok"
      ? { title: "Fix BCGPT connector", detail: "Restore MCP auth for project actions", href: props.integrationsHref }
      : null,
    runBuckets.failed > 0
      ? { title: "Investigate failed runs", detail: `${runBuckets.failed} failed recent runs`, href: props.runsHref }
      : null,
    flows.length === 0
      ? { title: "Create first automation", detail: "Build a flow in Automations", href: props.automationsHref }
      : null,
    {
      title: "Ask Wicked OS to execute",
      detail: "Use chat to plan and run multi-step automation",
      href: props.chatHref,
    },
  ].filter((item): item is { title: string; detail: string; href: string } => Boolean(item));

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">Integration Health</div>
        <div class="card-sub">Connector state for Flow Pieces and BCGPT.</div>

        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">Flow Pieces</div>
            <div class="stat-value ${apStatus.tone === "ok" ? "ok" : "warn"}">${apStatus.label}</div>
            <div class="muted mono">${ap?.url ?? "https://flow.wickedlab.io"}</div>
          </div>
          <div class="stat">
            <div class="stat-label">BCGPT</div>
            <div class="stat-value ${bcgptStatus.tone === "ok" ? "ok" : "warn"}">${bcgptStatus.label}</div>
            <div class="muted mono">${bcgpt?.url ?? "https://bcgpt.wickedlab.io"}</div>
          </div>
        </div>

        <div class="row" style="margin-top: 14px;">
          <button
            class="btn"
            ?disabled=${props.connectorsLoading || !props.connected}
            @click=${() => props.onRefreshConnectors()}
            title=${props.connected ? "Refresh connector checks" : "Connect first"}
          >
            ${props.connectorsLoading ? "Checking..." : "Refresh status"}
          </button>
          <a class="btn btn--secondary" href=${props.integrationsHref}>Open integrations</a>
          <span class="muted">Last check: ${checkedLabel}</span>
        </div>

        ${props.connectorsError ? html`<div class="callout danger" style="margin-top: 14px;">${props.connectorsError}</div>` : nothing}
      </div>

      <div class="card">
        <div class="card-title">Portfolio Pulse</div>
        <div class="card-sub">Cross-automation health and delivery pressure.</div>

        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">Flows</div>
            <div class="stat-value">${flows.length}</div>
            <div class="muted">${enabledFlows} enabled</div>
          </div>
          <div class="stat">
            <div class="stat-label">Recent Runs</div>
            <div class="stat-value">${runs.length}</div>
            <div class="muted">${runBuckets.failed} failed</div>
          </div>
          <div class="stat">
            <div class="stat-label">Pulse</div>
            <div class="stat-value ${pulse.tone === "ok" ? "ok" : "warn"}">${pulse.label}</div>
            <div class="muted">${projectConfigured ? "Project linked" : "Project missing"}</div>
          </div>
        </div>

        <div class="row" style="margin-top: 14px;">
          <a class="btn" href=${props.automationsHref}>Automations</a>
          <a class="btn" href=${props.runsHref}>Runs</a>
          <a class="btn btn--secondary" href=${props.chatHref}>Chat</a>
        </div>
      </div>
    </section>

    <section class="grid grid-cols-2" style="margin-top: 18px;">
      <div class="card">
        <div class="card-title">Automation Live</div>
        <div class="card-sub">Recent run activity with direct drill-down.</div>

        <div class="chip-row" style="margin-top: 12px;">
          <span class="chip chip-ok">Succeeded: ${runBuckets.succeeded}</span>
          <span class="chip chip-danger">Failed: ${runBuckets.failed}</span>
          <span class="chip chip-warn">Running: ${runBuckets.running}</span>
        </div>

        ${props.runsError ? html`<div class="callout danger" style="margin-top: 12px;">${props.runsError}</div>` : nothing}
        ${
          runs.length
            ? html`
                <div class="list" style="margin-top: 12px;">
                  ${runs.slice(0, 5).map((run) => {
                    const status = String(run.status ?? "UNKNOWN");
                    const bucket = runStatusBucket(status);
                    const toneClass =
                      bucket === "failed"
                        ? "chip chip-danger"
                        : bucket === "succeeded"
                          ? "chip chip-ok"
                          : bucket === "running"
                            ? "chip chip-warn"
                            : "chip";
                    return html`
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title mono">${run.id}</div>
                          <div class="list-sub">${run.flowId ? `flow ${run.flowId}` : "flow n/a"}</div>
                        </div>
                        <div class="list-meta">
                          <span class=${toneClass}>${status}</span>
                          <span>${relativeFromAny(run.created)}</span>
                        </div>
                      </div>
                    `;
                  })}
                </div>
              `
            : html`<div class="muted" style="margin-top: 12px;">No run events yet.</div>`
        }

        <div class="row" style="margin-top: 12px;">
          <button class="btn" @click=${() => props.onRefreshDashboard()} ?disabled=${refreshBusy || !props.connected}>
            ${refreshBusy ? "Refreshing..." : "Refresh all"}
          </button>
          <a class="btn btn--secondary" href=${props.runsHref}>Open runs</a>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Focus Today</div>
        <div class="card-sub">Prioritized actions to keep operations healthy.</div>
        <div class="list" style="margin-top: 12px;">
          ${focusItems.slice(0, 5).map(
            (item) => html`
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">${item.title}</div>
                  <div class="list-sub">${item.detail}</div>
                </div>
                <div class="list-meta">
                  <a class="btn btn--sm" href=${item.href}>Open</a>
                </div>
              </div>
            `,
          )}
        </div>
      </div>
    </section>

    <section class="grid grid-cols-2" style="margin-top: 18px;">
      <div class="card">
        <div class="card-title">Agent Timeline</div>
        <div class="card-sub">Live Wicked OS execution trace (model-agnostic schema).</div>
        ${
          trace.length
            ? html`
                <div class="list" style="margin-top: 12px;">
                  ${trace.slice(0, 8).map(
                    (entry) => html`
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">${entry.title}</div>
                          <div class="list-sub">${entry.detail ?? `${entry.source}:${entry.kind}`}</div>
                        </div>
                        <div class="list-meta">
                          <span class=${traceStatusClass(entry.status)}>${entry.status}</span>
                          <span>${formatRelativeTimestamp(entry.ts)}</span>
                        </div>
                      </div>
                    `,
                  )}
                </div>
              `
            : html`<div class="muted" style="margin-top: 12px;">No execution trace yet. Use Chat to start a run.</div>`
        }
        <div class="row" style="margin-top: 12px;">
          <a class="btn" href=${props.chatHref}>Open chat</a>
          <button class="btn btn--secondary" @click=${() => props.onClearTrace()} ?disabled=${trace.length === 0}>
            Clear trace
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">System</div>
        <div class="card-sub">Wicked OS access and gateway connection.</div>

        ${
          showAccessCard
            ? html`
                <div class="form-grid" style="margin-top: 16px;">
                  <label class="field">
                    <span>Wicked OS Access Key</span>
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
                  <span class="muted">Your key is stored locally in this browser only.</span>
                </div>
              `
            : html`
                <div style="margin-top: 16px; display: grid; gap: 8px;">
                  ${renderStatusPill("Gateway", props.connected ? "Connected" : "Offline", props.connected ? "ok" : "warn")}
                  ${renderStatusPill("Project", projectConfigured ? "Configured" : "Missing", projectConfigured ? "ok" : "warn")}
                </div>
              `
        }

        ${
          !projectConfigured
            ? html`
                <div class="callout" style="margin-top: 14px;">
                  Flow Pieces Project ID is not set. Configure it in Integrations to enable flow/runs widgets.
                </div>
              `
            : nothing
        }

        ${props.lastError ? html`<div class="callout danger" style="margin-top: 14px;">${props.lastError}</div>` : nothing}
        ${props.flowsError ? html`<div class="callout danger" style="margin-top: 14px;">${props.flowsError}</div>` : nothing}
      </div>
    </section>
  `;
}
