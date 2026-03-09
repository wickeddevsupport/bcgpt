import { html, nothing } from "lit";

export type ConnectionItem = {
  id: string;
  name: string;
  type: string;
};

export type ConnectionsProps = {
  opsProvisioned: boolean;
  connectorsLoading: boolean;
  connectorsError: string | null;
  credentials: ConnectionItem[];
  credentialsLoading: boolean;
  credentialsError: string | null;
  addConnectionUrl: string;
  onRefresh: () => void;
  onOpenIntegrations: () => void;
  onAddConnection: () => void;
};

/** Human-readable label for credential types. */
function credentialLabel(type: string): string {
  const map: Record<string, string> = {
    basecampApi: "Basecamp",
    openAiApi: "OpenAI",
    anthropicApi: "Anthropic",
    googlePalmApi: "Google AI",
    slackApi: "Slack",
    githubApi: "GitHub",
    httpBasicAuth: "HTTP Basic Auth",
    httpHeaderAuth: "HTTP Header Auth",
    oAuth2Api: "OAuth2",
    notionApi: "Notion",
    airtableApi: "Airtable",
    googleSheetsOAuth2Api: "Google Sheets",
    gmailOAuth2: "Gmail",
  };
  return map[type] ?? type.replace(/Api$/, "").replace(/([A-Z])/g, " $1").trim();
}

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
              Save your Flow and Basecamp settings in Integrations first.
            </div>
            <button class="btn btn--primary" @click=${() => props.onOpenIntegrations()}>
              Configure Integrations
            </button>
          </section>
        `
      : html`
          <div class="page-header">
            <div>
              <div class="page-title">Connections</div>
              <div class="page-subtitle">Workflow engine credentials for this workspace.</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="chip chip-ok">Flow Online</span>
              <button
                class="btn btn--secondary"
                ?disabled=${props.credentialsLoading}
                @click=${() => props.onRefresh()}
              >
                ${props.credentialsLoading ? "Refreshing..." : "Refresh"}
              </button>
              <button class="btn btn--primary" @click=${() => props.onAddConnection()}>
                + Add Connection
              </button>
            </div>
          </div>

          ${props.credentialsError
            ? html`<div class="callout danger" style="margin-bottom: 12px;">${props.credentialsError}</div>`
            : nothing}

          ${props.credentialsLoading && props.credentials.length === 0
            ? html`<div class="callout" style="text-align:center;padding:32px;">Loading connections...</div>`
            : nothing}

          ${props.credentials.length > 0
            ? html`
                <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
                  ${props.credentials.map(
                    (cred) => html`
                      <div class="card" style="padding:16px;">
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                          <div>
                            <div style="font-weight:600;">${cred.name}</div>
                            <div class="muted" style="font-size:12px; margin-top:4px;">${credentialLabel(cred.type)}</div>
                          </div>
                          <span class="chip chip-ok" style="font-size:11px;">Active</span>
                        </div>
                        <div class="muted" style="font-size:11px; margin-top:8px;">
                          ID: <code>${cred.id.slice(0, 12)}</code>
                        </div>
                      </div>
                    `,
                  )}
                </div>
              `
            : !props.credentialsLoading
              ? html`
                  <section class="card" style="padding:32px 24px; text-align:center;">
                    <div style="font-weight:600; margin-bottom:8px;">No connections yet</div>
                    <div class="muted" style="max-width:420px; margin:0 auto 16px;">
                      Add a connection to enable workflows to interact with external services like Basecamp, Slack, or Google Sheets.
                    </div>
                    <button class="btn btn--primary" @click=${() => props.onAddConnection()}>
                      + Add Connection
                    </button>
                  </section>
                `
              : nothing}
        `}
  `;
}

export default renderConnections;
