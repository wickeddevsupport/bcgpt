import { html, nothing } from "lit";

export type ConnectionsProps = {
  opsProvisioned: boolean;
  connectorsLoading: boolean;
  connectorsError: string | null;
  embedUrl: string;
  onRefresh: () => void;
  onOpenIntegrations: () => void;
};

export function renderConnections(props: ConnectionsProps) {
  return html`
    ${props.connectorsError
      ? html`<div class="callout danger" style="margin-bottom: 16px;">${props.connectorsError}</div>`
      : nothing}

    ${!props.opsProvisioned
      ? html`
          <div class="page-header">
            <div class="page-title">Connections</div>
            <div class="page-subtitle">Provision Flow in Integrations before adding workspace connections.</div>
          </div>
          <section class="card" style="padding: 32px 24px; text-align: center;">
            <div style="font-weight: 600; margin-bottom: 8px;">Flow is not ready for this workspace.</div>
            <div class="muted" style="max-width: 520px; margin: 0 auto 18px;">
              Save your Flow and Basecamp settings in Integrations first. Basecamp is auto-synced
              from PMOS when the workspace API key is available.
            </div>
            <button class="btn btn--primary" @click=${() => props.onOpenIntegrations()}>
              Configure Integrations
            </button>
          </section>
        `
      : html`
          <section style="display:flex; flex-direction:column; gap:12px; min-height: calc(100vh - 140px);">
            <div class="page-header" style="margin-bottom: 0;">
              <div>
                <div class="page-title">Connections</div>
                <div class="page-subtitle">Native Activepieces connections for this workspace.</div>
              </div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span class="chip chip-ok">Flow Online</span>
                <button
                  class="btn btn--secondary"
                  ?disabled=${props.connectorsLoading}
                  @click=${() => props.onRefresh()}
                >
                  ${props.connectorsLoading ? "Refreshing..." : "Reload"}
                </button>
              </div>
            </div>
            <iframe
              src=${props.embedUrl}
              title="Flow Connections"
              style="flex: 1 1 auto; width: 100%; min-height: calc(100vh - 180px); border: 0; display: block; background: #11131a; border-radius: 16px; overflow: hidden;"
              allow="clipboard-read; clipboard-write"
            ></iframe>
          </section>
        `}
  `;
}

export default renderConnections;
