import { html } from "lit";

export type RunsProps = {
  integrationsHref: string;
};

export function renderRuns(props: RunsProps) {
  return html`
    <section class="card">
      <div class="card-title">Runs</div>
      <div class="card-sub">Execution history and live run details.</div>
      <div class="muted" style="margin-top: 14px;">
        This view will become the unified run console for:
        <div style="margin-top: 10px;">
          <div>1) Activepieces flow runs (success/fail/retry + logs)</div>
          <div>2) Agent/tool executions (what changed and why)</div>
          <div>3) Pending approvals and policy decisions</div>
        </div>
      </div>
      <div class="row" style="margin-top: 14px;">
        <a class="btn" href=${props.integrationsHref}>Connect integrations</a>
        <span class="muted">Then we can stream live runs here.</span>
      </div>
    </section>
  `;
}

