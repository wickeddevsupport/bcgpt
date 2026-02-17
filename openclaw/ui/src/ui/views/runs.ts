import { html, nothing } from "lit";
import type { WorkflowRunSummary } from "../controllers/pmos-workflows.ts";

export type RunsProps = {
  connected: boolean;
  integrationsHref: string;
  projectId: string;
  onOpenIntegrations: () => void;

  loading: boolean;
  error: string | null;
  runs: WorkflowRunSummary[];
  selectedRunId: string | null;
  runDetailsLoading: boolean;
  runDetailsError: string | null;
  runDetails: unknown | null;
  retrying: boolean;
  retryError: string | null;

  onRefresh: () => void;
  onSelectRun: (runId: string) => void;
  onRetry: (strategy: "FROM_FAILED_STEP" | "ON_LATEST_VERSION") => void;
};

export function renderRuns(props: RunsProps) {
  const connectedReason = !props.connected
    ? "Sign in first, then wait for the Wicked OS gateway to connect."
    : null;
  const projectReason = props.projectId.trim()
    ? null
    : "Workflow project ID is required. Open Integrations and complete provisioning, then refresh.";

  return html`
    <section class="agents-layout">
      <div class="agents-sidebar">
        <div class="card">
          <div class="card-title">Runs</div>
          <div class="card-sub">Recent workflow executions (project scoped).</div>

          <div class="row" style="margin-top: 12px;">
            <button class="btn" @click=${() => props.onRefresh()} ?disabled=${!props.connected || !props.projectId.trim() || props.loading}>
              ${props.loading ? "Loading..." : "Refresh"}
            </button>
            <button class="btn btn--secondary" @click=${() => props.onOpenIntegrations()}>
              Integrations
            </button>
          </div>

          ${connectedReason ? html`<div class="muted" style="margin-top: 12px;">${connectedReason}</div>` : nothing}
          ${projectReason ? html`<div class="muted" style="margin-top: 12px;">${projectReason}</div>` : nothing}
          ${props.error ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>` : nothing}

          <div class="list" style="margin-top: 14px;">
            ${props.runs.map((run) => {
              const selected = props.selectedRunId === run.id;
              const status = run.status ?? "n/a";
              const meta = [run.flowId ? `flow ${run.flowId}` : null, run.created ? `created ${run.created}` : null]
                .filter(Boolean)
                .join(" | ");
              return html`
                <div
                  class="list-item list-item-clickable ${selected ? "list-item-selected" : ""}"
                  @click=${() => props.onSelectRun(run.id)}
                >
                  <div class="list-main">
                    <div class="list-title">${status}</div>
                    <div class="list-sub mono">${run.id}</div>
                  </div>
                  <div class="list-meta">
                    <div>${meta || " "}</div>
                    <div>
                      <button class="btn btn--sm" @click=${(e: Event) => {
                        e.stopPropagation();
                        props.onSelectRun(run.id);
                      }}>
                        Open
                      </button>
                    </div>
                  </div>
                </div>
              `;
            })}
            ${props.runs.length === 0 && !props.loading ? html`<div class="muted">No runs found.</div>` : nothing}
          </div>
        </div>
      </div>

      <div class="agents-main">
        <div class="card">
          <div class="card-title">Run Details</div>
          <div class="card-sub">Inspect steps, errors, and retry.</div>

          ${
            !props.selectedRunId
              ? html`<div class="muted" style="margin-top: 14px;">Select a run to inspect.</div>`
              : nothing
          }

          ${props.runDetailsLoading ? html`<div class="muted" style="margin-top: 14px;">Loading run...</div>` : nothing}
          ${props.runDetailsError && props.selectedRunId ? html`<div class="callout danger" style="margin-top: 12px;">${props.runDetailsError}</div>` : nothing}
          ${props.retryError ? html`<div class="callout danger" style="margin-top: 12px;">${props.retryError}</div>` : nothing}

          ${
            props.runDetails && props.selectedRunId
              ? html`
                  <div class="row" style="margin-top: 12px;">
                    <button class="btn" @click=${() => props.onRetry("FROM_FAILED_STEP")} ?disabled=${props.retrying}>
                      ${props.retrying ? "Retrying..." : "Retry from failed step"}
                    </button>
                    <button class="btn" @click=${() => props.onRetry("ON_LATEST_VERSION")} ?disabled=${props.retrying}>
                      Retry on latest version
                    </button>
                  </div>

                  <pre class="code-block" style="margin-top: 14px;">${JSON.stringify(props.runDetails, null, 2)}</pre>
                `
              : nothing
          }
        </div>
      </div>
    </section>
  `;
}
