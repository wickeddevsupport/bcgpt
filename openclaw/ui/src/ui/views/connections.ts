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
          <div class="page-header" style="margin-bottom:0;">
            <div>
              <div class="page-title">Connections</div>
              <div class="page-subtitle">Workflow engine credentials and connection manager.</div>
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
            </div>
          </div>

          ${props.credentialsError
            ? html`<div class="callout danger" style="margin-bottom: 12px;">${props.credentialsError}</div>`
            : nothing}

          <!-- Two-column split: left = configured connections, right = Flow connections manager iframe -->
          <div style="display:grid; grid-template-columns:minmax(280px, 1fr) minmax(0, 1.6fr); gap:16px; height:calc(100dvh - var(--topbar-height, 64px) - 120px); min-height:400px;">

            <!-- Left: Configured connections list -->
            <div style="overflow-y:auto; display:flex; flex-direction:column; gap:12px;">
              <div style="font-weight:600; font-size:14px; padding:4px 0;">
                Configured (${props.credentials.length})
              </div>

              ${props.credentialsLoading && props.credentials.length === 0
                ? html`<div class="callout" style="text-align:center;padding:24px;">Loading...</div>`
                : nothing}

              ${props.credentials.length > 0
                ? props.credentials.map(
                    (cred) => html`
                      <div class="card" style="padding:14px;">
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                          <div style="min-width:0;">
                            <div style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${cred.name}</div>
                            <div class="muted" style="font-size:12px; margin-top:3px;">${credentialLabel(cred.type)}</div>
                          </div>
                          <span class="chip chip-ok" style="font-size:11px; flex-shrink:0;">Active</span>
                        </div>
                        <div class="muted" style="font-size:11px; margin-top:6px;">
                          ID: <code>${cred.id.slice(0, 12)}</code>
                        </div>
                      </div>
                    `,
                  )
                : !props.credentialsLoading
                  ? html`
                      <div class="card" style="padding:24px; text-align:center;">
                        <div style="font-weight:600; margin-bottom:6px;">No connections yet</div>
                        <div class="muted" style="font-size:13px;">
                          Use the connection manager on the right to add your first connection.
                        </div>
                      </div>
                    `
                  : nothing}
            </div>

            <!-- Right: Flow connections manager iframe -->
            <div class="card" style="padding:0; overflow:hidden; display:flex; flex-direction:column; min-height:0;">
              <div style="padding:12px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; flex-shrink:0;">
                <div>
                  <div style="font-weight:600; font-size:14px;">Connection Manager</div>
                  <div class="muted" style="font-size:12px;">Add, edit, or test connections in Flow.</div>
                </div>
                <button class="btn btn--sm btn--secondary" @click=${() => props.onAddConnection()}>
                  Open in Popup
                </button>
              </div>
              <iframe
                src=${props.addConnectionUrl}
                title="Flow Connections Manager"
                style="flex:1 1 auto; width:100%; border:0; display:block; background:var(--bg, #0a0a0f);"
                allow="clipboard-read; clipboard-write"
              ></iframe>
            </div>
          </div>
        `}
  `;
}

export default renderConnections;
