import { html } from "lit";

export type AutomationsProps = {
  integrationsHref: string;
};

export function renderAutomations(props: AutomationsProps) {
  return html`
    <section class="card">
      <div class="card-title">Automations</div>
      <div class="card-sub">Flows, schedules, and AI-built pipelines.</div>
      <div class="muted" style="margin-top: 14px;">
        Phase 1 focuses on the PMOS UX shell and connector onboarding. Next we embed the full
        Activepieces flow experience directly inside PMOS (no app switching).
      </div>
      <div class="row" style="margin-top: 14px;">
        <a class="btn" href=${props.integrationsHref}>Connect Activepieces</a>
        <span class="muted">Once connected, this page will show your flows and builders.</span>
      </div>
    </section>
  `;
}

