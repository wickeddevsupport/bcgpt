import { html, nothing } from "lit";
import type { UiSettings } from "../storage.ts";
import type { PmosConnectorsStatus } from "../controllers/pmos-connectors.ts";
import type { PmosExecutionTraceEvent } from "../controllers/pmos-trace.ts";
import { formatRelativeTimestamp } from "../format.ts";

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export type DashboardProps = {
  connected: boolean;
  settings: UiSettings;
  lastError: string | null;
  connectorsLoading: boolean;
  connectorsError: string | null;
  connectorsStatus: PmosConnectorsStatus | null;
  projectId?: string;
  flowsLoading?: boolean;
  flowsError?: string | null;
  flows?: Array<{ status?: unknown }>;
  runsLoading?: boolean;
  runsError?: string | null;
  runs?: Array<{ status?: unknown }>;
  traceEvents: PmosExecutionTraceEvent[];
  integrationsHref: string;
  automationsHref: string;
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

  onNavigateTab: (tab: "integrations" | "automations" | "chat" | "config") => void;
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
  const bcgpt = props.connectorsStatus?.bcgpt ?? null;
  const ops = props.connectorsStatus?.ops ?? null;
  const checkedAt = props.connectorsStatus?.checkedAtMs ?? null;
  const checkedLabel = checkedAt ? formatRelativeTimestamp(checkedAt) : "n/a";

  const bcgptStatus = (() => {
    if (!bcgpt) return { label: "Unknown", tone: "warn" as const };
    if (!bcgpt.configured) return { label: "Not connected", tone: "warn" as const };
    if (bcgpt.reachable === false || bcgpt.authOk === false) return { label: "Needs attention", tone: "warn" as const };
    if (bcgpt.reachable === true && (bcgpt.authOk === true || bcgpt.authOk === null)) return { label: "OK", tone: "ok" as const };
    return { label: "Checking", tone: "warn" as const };
  })();
  const opsRuntimeStatus = (() => {
    if (!ops) return { label: "Unknown", tone: "warn" as const };
    if (ops.reachable === true) return { label: "Ready", tone: "ok" as const };
    if (ops.reachable === false) return { label: "Offline", tone: "warn" as const };
    if (ops.configured) return { label: "Starting", tone: "warn" as const };
    return { label: "Not configured", tone: "warn" as const };
  })();

  const showAccessCard = !props.connected;
  const flows = props.flows ?? [];
  const runs = props.runs ?? [];
  const trace = props.traceEvents ?? [];
  const enabledFlows = flows.filter((flow) => String(flow.status ?? "").toUpperCase() === "ENABLED").length;

  const runBuckets = runs.reduce(
    (acc, run) => {
      const key = runStatusBucket(String(run.status ?? ""));
      acc[key] += 1;
      return acc;
    },
    { succeeded: 0, failed: 0, running: 0, other: 0 },
  );

  const pulse = (() => {
    if (!props.opsProvisioned) return { label: "Provisioning workflows...", tone: "warn" as const };
    if (opsRuntimeStatus.tone !== "ok") return { label: "Workflow runtime issue", tone: "warn" as const };
    if (bcgptStatus.tone !== "ok") return { label: "Connector risk", tone: "warn" as const };
    if (runBuckets.failed > 0) return { label: "Failures need review", tone: "warn" as const };
    return { label: "Healthy", tone: "ok" as const };
  })();

  const refreshBusy = props.connectorsLoading ?? false;
  // Core setup: only the 3 steps needed to start using the app.
  // BCGPT / AI model / first workflow are optional config — shown in Integrations tab.
  const setupSteps: SetupStep[] = [
    {
      id: "gateway",
      title: "Sign in",
      detail: "Authenticated and connected to your workspace.",
      done: props.connected,
      actionKind: "connect",
      actionLabel: "Reconnect",
    },
    {
      id: "ops",
      title: "Workflow engine ready",
      detail: "Your embedded workflow runtime is running. No provisioning needed.",
      done: Boolean(props.opsProvisioned),
      actionKind: "refresh",
      actionLabel: "Check status",
    },
    {
      id: "ops-runtime",
      title: "Workflows editor live",
      detail: "The n8n editor is embedded and accessible in the Workflows tab.",
      done: opsRuntimeStatus.tone === "ok",
      actionKind: "refresh",
      actionLabel: "Check runtime",
    },
  ];
  const setupCompleted = setupSteps.filter((step) => step.done).length;
  const allSetupDone = setupCompleted === setupSteps.length;
  const nextSetupStep = setupSteps.find((step) => !step.done) ?? null;
  // Collapse wizard automatically once core is ready (connected + workflow engine up).
  // Only keep it open if something is broken, so it doesn't distract on every login.
  const coreReady = props.connected && Boolean(props.opsProvisioned) && opsRuntimeStatus.tone === "ok";
  const wizardOpen = !coreReady && !allSetupDone;
  const focusItems = [
    bcgptStatus.tone !== "ok"
      ? { title: "Fix BCGPT connector", detail: "Restore MCP auth for project actions", href: props.integrationsHref }
      : null,
    runBuckets.failed > 0
      ? { title: "Check failed workflow runs", detail: `${runBuckets.failed} failed recent runs - review inside the Workflows editor`, href: props.automationsHref }
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
    <!-- Greeting header -->
    <section class="card" style="margin-bottom: 18px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h1 style="font-size: 24px; font-weight: 600; margin: 0;">
            ${getTimeGreeting()}! 👋
          </h1>
          <p class="muted" style="margin: 4px 0 0 0;">What would you like to do today?</p>
        </div>
      </div>
      
      <!-- Natural language input bar -->
      <div style="margin-top: 16px; display: flex; gap: 8px;">
        <input 
          type="text" 
          placeholder="Ask your AI team to do something..."
          style="flex: 1; padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border);"
        />
        <button class="btn primary">Ask</button>
      </div>
      
      <!-- Quick action buttons -->
      <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
        <button class="btn btn--secondary">Check leads</button>
        <button class="btn btn--secondary">Daily report</button>
        <button class="btn btn--secondary">Create workflow</button>
        <button class="btn btn--secondary">Settings</button>
      </div>
    </section>

    <!-- Your AI Team section -->
    <section class="card" style="margin-bottom: 18px;">
      <div class="card-title">Your AI Team</div>
      <div class="card-sub">4 agents ready to help</div>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 16px;">
        <!-- Agent cards -->
        <div class="card" style="padding: 16px;">
          <div style="font-weight: 600;">🤝 Sales Agent</div>
          <div class="muted">Lead qualification</div>
          <div style="margin-top: 8px;">
            <span class="chip chip-ok">Active</span>
            <span class="muted">3 tasks</span>
          </div>
          <button class="btn btn--sm" style="margin-top: 8px;">Chat</button>
        </div>
        
        <div class="card" style="padding: 16px;">
          <div style="font-weight: 600;">💻 Dev Agent</div>
          <div class="muted">Code & automation</div>
          <div style="margin-top: 8px;">
            <span class="chip chip-warn">Queued</span>
            <span class="muted">2 tasks</span>
          </div>
          <button class="btn btn--sm" style="margin-top: 8px;">Chat</button>
        </div>
        
        <div class="card" style="padding: 16px;">
          <div style="font-weight: 600;">📋 PM Agent</div>
          <div class="muted">Project management</div>
          <div style="margin-top: 8px;">
            <span class="chip chip-ok">Active</span>
            <span class="muted">1 task</span>
          </div>
          <button class="btn btn--sm" style="margin-top: 8px;">Chat</button>
        </div>
        
        <div class="card" style="padding: 16px;">
          <div style="font-weight: 600;">🎧 Support Agent</div>
          <div class="muted">Customer support</div>
          <div style="margin-top: 8px;">
            <span class="chip">Idle</span>
            <span class="muted">0 tasks</span>
          </div>
          <button class="btn btn--sm" style="margin-top: 8px;">Chat</button>
        </div>
      </div>
    </section>

    <details class="card setup-wizard" style="margin-bottom: 18px;" ?open=${wizardOpen}>
      <summary class="setup-wizard__summary">
        <div class="setup-wizard__summary-main">
          <div class="card-title">System Status</div>
          <div class="card-sub">
            ${coreReady ? "Everything is running. Click to expand for details." : "Check that core services are running before using the app."}
          </div>
        </div>
        <span class="chip ${coreReady ? "chip-ok" : "chip-warn"}">
          ${coreReady ? "Ready" : `${setupCompleted}/${setupSteps.length}`}
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
              <div><strong>Workflow project provisioned</strong></div>
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
              <div style="margin-top:8px;">You can create an n8n Project manually and paste its API key below to scope workflows to this workspace.</div>
            </div>
            <div class="form-grid" style="margin-top:8px;">
              <label class="field">
                <span>Workflow API key</span>
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
                  : step.actionKind === "refresh"
                    ? html`<button class="btn btn--sm" @click=${() => props.onRefreshConnectors()} ?disabled=${props.connectorsLoading || !props.connected}>${props.connectorsLoading ? "Checking..." : step.actionLabel ?? "Refresh"}</button>`
                  : step.id === "ops"
                    ? html`<button class="btn btn--sm" @click=${() => props.onProvisionOps?.()} ?disabled=${props.opsProvisioning || !props.connected}>${props.opsProvisioning ? "Provisioning..." : step.actionLabel ?? "Provision"}</button>`
                    : step.href
                      ? html`<button class="btn btn--sm" @click=${() => {
                          if (step.id === "bcgpt" || step.id === "model-auth") {
                            props.onNavigateTab("integrations");
                            return;
                          }
                          if (step.id === "first-flow") {
                            props.onNavigateTab("automations");
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
        <div class="card-sub">Connector state for Workflows and BCGPT.</div>

        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">Workflows</div>
            <div class="stat-value ${props.opsProvisioned && opsRuntimeStatus.tone === "ok" ? "ok" : "warn"}">
              ${props.opsProvisioned ? opsRuntimeStatus.label : "Pending"}
            </div>
            ${ops?.error ? html`<div class="muted">${ops.error}</div>` : nothing}
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
            <div class="muted">${props.opsProvisioned ? "Workflows ready" : "Provisioning..."}</div>
          </div>
        </div>

        <div class="row" style="margin-top: 14px;">
          <button class="btn" @click=${() => props.onNavigateTab("automations")}>Workflows</button>
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
          <button class="btn btn--secondary" @click=${() => props.onNavigateTab("automations")}>Open workflows</button>
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
                  ${renderStatusPill("Workflows", props.opsProvisioned ? "Provisioned" : "Pending", props.opsProvisioned ? "ok" : "warn")}
                </div>
              `
        }

        ${
          !props.opsProvisioned
            ? html`
                <div class="callout" style="margin-top: 14px;">
                  Workflow workspace is provisioning - workflows will be available shortly.
                </div>
              `
            : nothing
        }

        ${props.lastError ? html`<div class="callout danger" style="margin-top: 14px;">${props.lastError}</div>` : nothing}
      </div>
    </section>
  `;
}
