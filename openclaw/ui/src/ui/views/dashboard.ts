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
  configHref?: string;
  modelAuthConfigured?: boolean;

  // ops provisioning UI state (workspace-scoped n8n project + API key)
  opsProvisioning?: boolean;
  opsProvisioned?: boolean;
  opsProvisioningResult?: { projectId?: string; apiKey?: string } | null;
  opsProvisioningError?: string | null;
  opsManualApiKeyDraft?: string;
  onOpsManualApiKeyChange?: (next: string) => void;
  onSaveOpsApiKey?: () => Promise<void>;

  onNavigateTab: (tab: "integrations" | "automations" | "runs" | "chat" | "config") => void;
  onSettingsChange: (next: UiSettings) => void;
  onConnect: () => void;
  onRefreshConnectors: () => void;
  onRefreshDashboard: () => void;
  onClearTrace: () => void;
  onProvisionOps?: () => Promise<void>;
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

type SetupStep = {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  href?: string;
  actionLabel?: string;
  actionKind?: "connect" | "refresh";
};

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

  const showAccessCard = !props.connected;
  const flows = props.flows ?? [];
  const runs = props.runs ?? [];
  const trace = props.traceEvents ?? [];
  const configuredProjectId = String(ap?.projectId ?? props.projectId ?? "").trim();
  const projectConfigured = Boolean(configuredProjectId);
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
  const setupSteps: SetupStep[] = [
    {
      id: "gateway",
      title: "Connect Wicked OS",
      detail: "Sign in and connect once. Access key is only needed for legacy/manual pairing.",
      done: props.connected,
      actionKind: "connect",
      actionLabel: "Connect now",
    },
    {
      id: "flowpieces",
      title: "Connect Flow Pieces",
      detail: "Set URL + API key so PMOS can create and edit flows natively.",
      done: apStatus.tone === "ok",
      href: props.integrationsHref,
      actionLabel: "Open integrations",
    },
    {
      id: "ops",
      title: "Provision Wicked Ops",
      detail: "Create a per-workspace n8n Project and API key for workspace isolation.",
      done: Boolean(props.opsProvisioned),
      actionLabel: "Provision",
    },
    {
      id: "bcgpt",
      title: "Connect BCGPT",
      detail: "Add your BCGPT API key so chat can use Basecamp and MCP tools.",
      done: bcgptStatus.tone === "ok",
      href: props.integrationsHref,
      actionLabel: "Open integrations",
    },
    {
      id: "project",
      title: "Set Flow Project",
      detail: "Pick your Flow Pieces project ID to scope automations and runs.",
      done: projectConfigured,
      href: props.integrationsHref,
      actionLabel: "Set project",
    },
    {
      id: "model-auth",
      title: "Add AI Model Key",
      detail: "Integrations -> AI Model Setup",
      done: Boolean(props.modelAuthConfigured),
      href: props.integrationsHref,
      actionLabel: "Configure model",
    },
    {
      id: "first-flow",
      title: "Create First Automation",
      detail: "Build your first flow in Automations.",
      done: flows.length > 0,
      href: props.automationsHref,
      actionLabel: "Open automations",
    },
    {
      id: "first-run",
      title: "Run First Test",
      detail: "Trigger a flow and confirm a successful run appears in Runs.",
      done: runs.length > 0,
      href: props.runsHref,
      actionLabel: "Open runs",
    },
    {
      id: "chat-ready",
      title: "Start Using Chat",
      detail: "Use chat to build and run workflows in plain language.",
      done:
        props.connected &&
        Boolean(props.modelAuthConfigured) &&
        apStatus.tone === "ok" &&
        bcgptStatus.tone === "ok",
      href: props.chatHref,
      actionLabel: "Open chat",
    },
  ];
  const setupCompleted = setupSteps.filter((step) => step.done).length;
  const allSetupDone = setupCompleted === setupSteps.length;
  const nextSetupStep = setupSteps.find((step) => !step.done) ?? null;
  // Auto-collapse wizard if all steps are done
  const wizardOpen = !allSetupDone;
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
    <details class="card setup-wizard" style="margin-bottom: 18px;" ?open=${wizardOpen}>
      <summary class="setup-wizard__summary">
        <div class="setup-wizard__summary-main">
          <div class="card-title">Quick Setup Wizard</div>
          <div class="card-sub">
            Follow these steps once. After setup, your team can run nearly everything by chat.
          </div>
        </div>
        <span class="chip ${setupCompleted === setupSteps.length ? "chip-ok" : "chip-warn"}">
          ${setupCompleted}/${setupSteps.length}
        </span>
      </summary>

      <div class="setup-wizard__body">
        <div class="row" style="margin-top: 12px; align-items: center;">
          <button class="btn btn--secondary" @click=${() => props.onRefreshDashboard()} ?disabled=${refreshBusy || !props.connected}>
            ${refreshBusy ? "Checking..." : "Run setup check"}
          </button>
          ${nextSetupStep
            ? html`
                <span class="muted">
                  Next: <strong>${nextSetupStep.title}</strong>
                </span>
              `
            : html`<span class="muted">Setup complete. <a href=${props.chatHref} class="btn btn--primary" style="margin-left:8px;">Start Using Chat</a></span>`}
        </div>

        <!-- Provisioning result (shown after provisioning completes) -->
        ${props.opsProvisioningResult && props.opsProvisioningResult.apiKey
          ? html`<div class="callout success" style="margin-top:12px;">
              <div><strong>Wicked Ops provisioned</strong></div>
              <div style="margin-top:6px;">Project ID: <code>${props.opsProvisioningResult.projectId ?? "(n/a)"}</code></div>
              <div style="margin-top:6px;">API key: <code class="mono">${props.opsProvisioningResult.apiKey}</code></div>
              <div style="margin-top:8px;">
                <button class="btn btn--secondary" @click=${() => navigator.clipboard?.writeText(props.opsProvisioningResult?.apiKey ?? "")}>Copy API key</button>
                <button class="btn" @click=${() => props.onNavigateTab("integrations")}>Open integrations</button>
              </div>
            </div>`
          : nothing}

        <!-- Manual API-key fallback when automated provisioning is blocked (license-gated or API missing) -->
        ${props.opsProvisioningError
          ? html`<div class="callout warn" style="margin-top:12px;">
              <div><strong>Automated provisioning failed</strong></div>
              <div style="margin-top:6px;">${props.opsProvisioningError}</div>
              <div style="margin-top:8px;">You can create a Project in Wicked Ops (n8n) manually and paste its API key below to scope workflows to this workspace.</div>
            </div>
            <div class="form-grid" style="margin-top:8px;">
              <label class="field">
                <span>Wicked Ops API key</span>
                <input
                  type="password"
                  .value=${props.opsManualApiKeyDraft ?? ""}
                  @input=${(e: Event) => props.onOpsManualApiKeyChange?.((e.target as HTMLInputElement).value)}
                  placeholder="Paste API key here"
                  autocomplete="off"
                />
              </label>
            </div>
            <div class="row" style="margin-top:8px;">
              <button class="btn" @click=${() => props.onSaveOpsApiKey?.()} ?disabled=${!props.opsManualApiKeyDraft}>Save API key</button>
              <button class="btn btn--secondary" @click=${() => props.onNavigateTab("integrations")}>Open integrations</button>
            </div>`
          : nothing}

        <div style="margin-top:12px;">
          ${setupSteps.map((step) => html`
            <div class="setup-step" style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;">
              <div>
                <div style="font-weight:600">${step.title}</div>
                <div class="muted" style="margin-top:4px">${step.detail}</div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                ${step.done ? html`<span class="chip chip-ok">Done</span>` : html`<span class="chip">Pending</span>`}

                ${step.actionKind === "connect"
                  ? html`<button class="btn btn--sm" @click=${() => props.onConnect()} ?disabled=${props.connected}>${step.actionLabel ?? "Connect"}</button>`
                  : step.id === "ops"
                    ? html`<button class="btn btn--sm" @click=${() => props.onProvisionOps?.()} ?disabled=${props.opsProvisioning || !props.connected}>${props.opsProvisioning ? "Provisioning..." : step.actionLabel ?? "Provision"}</button>`
                    : step.href
                      ? html`<button class="btn btn--sm" @click=${() => {
                          if (step.id === "flowpieces" || step.id === "bcgpt" || step.id === "project" || step.id === "model-auth") {
                            props.onNavigateTab("integrations");
                            return;
                          }
                          if (step.id === "first-flow") {
                            props.onNavigateTab("automations");
                            return;
                          }
                          if (step.id === "first-run") {
                            props.onNavigateTab("runs");
                            return;
                          }
                          if (step.id === "chat-ready") {
                            props.onNavigateTab("chat");
                          }
                        }}>${step.actionLabel ?? "Open"}</button>`
                      : nothing}
              </div>
            </div>
          `)}
        </div>        </div>
      </div>
    </details>

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
          <button class="btn btn--secondary" @click=${() => props.onNavigateTab("integrations")}>
            Open integrations
          </button>
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
          <button class="btn" @click=${() => props.onNavigateTab("automations")}>Automations</button>
          <button class="btn" @click=${() => props.onNavigateTab("runs")}>Runs</button>
          <button class="btn btn--secondary" @click=${() => props.onNavigateTab("chat")}>Chat</button>
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
          <button class="btn btn--secondary" @click=${() => props.onNavigateTab("runs")}>Open runs</button>
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
                  <button
                    class="btn btn--sm"
                    @click=${() => {
                      if (item.href === props.integrationsHref) {
                        props.onNavigateTab("integrations");
                        return;
                      }
                      if (item.href === props.automationsHref) {
                        props.onNavigateTab("automations");
                        return;
                      }
                      if (item.href === props.runsHref) {
                        props.onNavigateTab("runs");
                        return;
                      }
                      props.onNavigateTab("chat");
                    }}
                  >
                    Open
                  </button>
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
          <button class="btn" @click=${() => props.onNavigateTab("chat")}>Open chat</button>
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
                    <span>Wicked OS Access Key (optional)</span>
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
                  <button class="btn" @click=${() => props.onConnect()} ?disabled=${props.connected}>
                    Connect
                  </button>
                  <span class="muted">Needed only for legacy/manual gateway access.</span>
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
