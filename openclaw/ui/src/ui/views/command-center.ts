import { html, nothing } from "lit";
import type {
  PmosCommandHistoryEntry,
  PmosCommandPendingApproval,
  PmosCommandPlanStep,
} from "../controllers/pmos-command-center.ts";
import { formatRelativeTimestamp } from "../format.ts";

export type CommandCenterProps = {
  connected: boolean;
  planning: boolean;
  executing: boolean;
  error: string | null;
  prompt: string;
  plan: PmosCommandPlanStep[];
  pendingApprovals: PmosCommandPendingApproval[];
  history: PmosCommandHistoryEntry[];

  onPromptChange: (next: string) => void;
  onPlan: () => void;
  onExecute: () => void;
  onApprove: (approvalId: string) => void;
  onClearHistory: () => void;
};

function stepStatusClass(status: PmosCommandPlanStep["status"]) {
  if (status === "success") return "chip chip-ok";
  if (status === "error") return "chip chip-danger";
  if (status === "running") return "chip chip-warn";
  if (status === "pending_approval") return "chip chip-warn";
  return "chip";
}

export function renderCommandCenter(props: CommandCenterProps) {
  const disabledReason = !props.connected
    ? "Connect to PMOS first (Dashboard -> Access Key -> Connect)."
    : null;

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">Objective</div>
        <div class="card-sub">Ask PMOS to plan and execute multi-step operations.</div>

        <label class="field" style="margin-top: 14px;">
          <span>Command</span>
          <textarea
            .value=${props.prompt}
            @input=${(e: Event) => props.onPromptChange((e.target as HTMLTextAreaElement).value)}
            placeholder="e.g. create flow for new leads and post updates to slack"
            ?disabled=${!props.connected || props.planning || props.executing}
          ></textarea>
        </label>

        <div class="row" style="margin-top: 12px;">
          <button class="btn" ?disabled=${!props.connected || props.planning || props.executing} @click=${() => props.onPlan()}>
            ${props.planning ? "Planning..." : "Plan"}
          </button>
          <button
            class="btn primary"
            ?disabled=${!props.connected || props.executing || props.planning || props.plan.length === 0}
            @click=${() => props.onExecute()}
          >
            ${props.executing ? "Executing..." : "Execute"}
          </button>
          <button class="btn btn--secondary" ?disabled=${props.history.length === 0} @click=${() => props.onClearHistory()}>
            Clear history
          </button>
        </div>

        ${disabledReason ? html`<div class="muted" style="margin-top: 12px;">${disabledReason}</div>` : nothing}
        ${props.error ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>` : nothing}
      </div>

      <div class="card">
        <div class="card-title">Plan</div>
        <div class="card-sub">Generated action steps with risk and execution status.</div>

        <div class="list" style="margin-top: 12px;">
          ${props.plan.map(
            (step) => html`
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">${step.title}</div>
                  <div class="list-sub">${step.detail ?? step.action}</div>
                  ${step.result ? html`<div class="list-sub mono">${step.result}</div>` : nothing}
                </div>
                <div class="list-meta">
                  <span class="chip ${step.risk === "high" ? "chip-danger" : "chip-ok"}">${step.risk}</span>
                  <span class=${stepStatusClass(step.status)}>${step.status}</span>
                </div>
              </div>
            `,
          )}
          ${props.plan.length === 0 ? html`<div class="muted">No plan generated yet.</div>` : nothing}
        </div>
      </div>
    </section>

    <section class="grid grid-cols-2" style="margin-top: 18px;">
      <div class="card">
        <div class="card-title">Pending Approvals</div>
        <div class="card-sub">High-risk actions require explicit confirmation.</div>
        <div class="list" style="margin-top: 12px;">
          ${props.pendingApprovals.map(
            (approval) => html`
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">${approval.step.title}</div>
                  <div class="list-sub">${approval.prompt}</div>
                </div>
                <div class="list-meta">
                  <span class="muted">${formatRelativeTimestamp(approval.ts)}</span>
                  <button class="btn btn--sm danger" @click=${() => props.onApprove(approval.id)}>
                    Approve
                  </button>
                </div>
              </div>
            `,
          )}
          ${props.pendingApprovals.length === 0
            ? html`<div class="muted">No approvals pending.</div>`
            : nothing}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Execution History</div>
        <div class="card-sub">Recent plans, outcomes, and replay context.</div>
        <div class="list" style="margin-top: 12px; max-height: 360px; overflow: auto;">
          ${props.history.map(
            (entry) => html`
              <div class="list-item">
                <div class="list-main">
                  <div class="list-title">${entry.summary}</div>
                  <div class="list-sub">${entry.prompt}</div>
                </div>
                <div class="list-meta">
                  <span class="chip ${entry.status === "failed"
                    ? "chip-danger"
                    : entry.status === "executed"
                      ? "chip-ok"
                      : entry.status === "needs_approval"
                        ? "chip-warn"
                        : ""}">${entry.status}</span>
                  <span class="muted">${formatRelativeTimestamp(entry.ts)}</span>
                </div>
              </div>
            `,
          )}
          ${props.history.length === 0 ? html`<div class="muted">No command runs yet.</div>` : nothing}
        </div>
      </div>
    </section>
  `;
}
