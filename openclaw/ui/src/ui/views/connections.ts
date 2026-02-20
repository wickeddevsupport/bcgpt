import { html, nothing } from "lit";

export type ConnectionsProps = {
  credentials: Array<{ id: string; name: string; type: string }>;
  credentialsLoading: boolean;
  credentialsError: string | null;
  opsProvisioned: boolean;
  onRefresh: () => void;
  onAddCredential: () => void;
  onOpenIntegrations: () => void;
  opsUiHref?: string;
};

// Human-readable labels + icons for common n8n credential types
const CRED_TYPE_META: Record<string, { label: string; icon: string; category: string }> = {
  openAiApi:                { label: "OpenAI",           icon: "⬡", category: "AI" },
  anthropicApi:             { label: "Anthropic",        icon: "◆", category: "AI" },
  googlePalmApi:            { label: "Google AI",        icon: "✦", category: "AI" },
  basecampApi:              { label: "Basecamp",         icon: "🏕️", category: "Productivity" },
  slackApi:                 { label: "Slack",            icon: "💬", category: "Communication" },
  githubApi:                { label: "GitHub",           icon: "🐙", category: "Development" },
  googleMail:               { label: "Gmail",            icon: "📧", category: "Communication" },
  googleSheetsOAuth2Api:    { label: "Google Sheets",   icon: "📊", category: "Productivity" },
  notionApi:                { label: "Notion",           icon: "📝", category: "Productivity" },
  airtableApi:              { label: "Airtable",        icon: "🗃️", category: "Data" },
  postgres:                 { label: "PostgreSQL",       icon: "🐘", category: "Data" },
  mySql:                    { label: "MySQL",            icon: "🐬", category: "Data" },
  redis:                    { label: "Redis",            icon: "🔴", category: "Data" },
  microsoftTeamsOAuth2Api:  { label: "MS Teams",        icon: "💼", category: "Communication" },
  discordWebhookApi:        { label: "Discord",          icon: "🎮", category: "Communication" },
  telegramApi:              { label: "Telegram",         icon: "✈️", category: "Communication" },
  hubspotApi:               { label: "HubSpot",         icon: "🧡", category: "CRM" },
  salesforceOAuth2Api:      { label: "Salesforce",      icon: "☁️", category: "CRM" },
  linearApi:                { label: "Linear",           icon: "📐", category: "Development" },
  jiraSoftwareCloudApi:     { label: "Jira",            icon: "🧭", category: "Development" },
  trelloApi:                { label: "Trello",           icon: "📌", category: "Development" },
  asanaApi:                 { label: "Asana",            icon: "🗂️", category: "Development" },
  pipedriveApi:             { label: "Pipedrive",       icon: "🔁", category: "CRM" },
  imap:                     { label: "Email (IMAP)",    icon: "📨", category: "Communication" },
  smtp:                     { label: "Email (SMTP)",    icon: "📤", category: "Communication" },
};

// Auto-generate metadata for unknown credential types
function credentialMeta(type: string): { label: string; icon: string; category: string } {
  const known = CRED_TYPE_META[type];
  if (known) return known;

  // Auto-generate for unknown types (e.g., basecampApi → Basecamp)
  const label = type
    .replace(/Api$/i, "")
    .replace(/([A-Z])/g, " $1")
    .trim();
  return {
    label: label || type,
    icon: "🔗",
    category: "Other",
  };
}

export function renderConnections(props: ConnectionsProps) {
  const { credentials, credentialsLoading, credentialsError, opsProvisioned } = props;

  const grouped = new Map<string, Array<{ id: string; name: string; type: string }>>();
  for (const cred of credentials) {
    const { category } = credentialMeta(cred.type);
    const list = grouped.get(category) ?? [];
    list.push(cred);
    grouped.set(category, list);
  }
  const categories = Array.from(grouped.keys()).sort();

  return html`
    <div class="page-header">
      <div class="page-title">Connections</div>
      <div class="page-subtitle">Services connected to your automation workspace</div>
    </div>

    <!-- Status bar -->
    <section class="card" style="margin-bottom: 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <div>
          <div style="font-size: 13px; font-weight: 600;">Workflow Engine</div>
          <div class="muted" style="font-size: 12px;">${opsProvisioned ? "Ready — n8n running" : "Not yet provisioned"}</div>
        </div>
        <span class="chip ${opsProvisioned ? "chip-ok" : "chip-warn"}">
          ${opsProvisioned ? "Online" : "Offline"}
        </span>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button class="btn btn--secondary" ?disabled=${credentialsLoading} @click=${() => props.onRefresh()}>
          ${credentialsLoading ? "Loading…" : "Refresh"}
        </button>
        ${opsProvisioned
          ? html`
            <a
              class="btn btn--primary"
              href="${props.opsUiHref ?? "/ops-ui/credentials"}"
              target="_parent"
              style="text-decoration: none;"
            >
              + Add Credential
            </a>`
          : html`
            <button class="btn btn--primary" @click=${() => props.onOpenIntegrations()}>
              Set up Workflow Engine →
            </button>`}
      </div>
    </section>

    ${credentialsError
      ? html`<div class="callout danger" style="margin-bottom: 16px;">${credentialsError}</div>`
      : nothing}

    ${credentialsLoading && credentials.length === 0
      ? html`
        <div style="display: flex; align-items: center; gap: 12px; padding: 32px; justify-content: center;">
          <span class="spinner"></span>
          <span class="muted">Loading credentials from Workflow Engine…</span>
        </div>`
      : credentials.length === 0
        ? html`
          <section class="card" style="text-align: center; padding: 40px 24px;">
            <div style="font-size: 32px; margin-bottom: 12px;">🔗</div>
            <div style="font-weight: 600; margin-bottom: 8px;">No credentials configured yet</div>
            <div class="muted" style="margin-bottom: 20px; max-width: 400px; margin-left: auto; margin-right: auto;">
              Credentials let your workflows connect to external services.
              AI keys you save in Integrations are synced here automatically.
              Add more via the Workflow Engine.
            </div>
            ${opsProvisioned
              ? html`
                <a
                  class="btn btn--primary"
                  href="${props.opsUiHref ?? "/ops-ui/credentials"}"
                  target="_parent"
                  style="text-decoration: none;"
                >
                  Open Workflow Engine to add credentials
                </a>`
              : html`
                <button class="btn btn--primary" @click=${() => props.onOpenIntegrations()}>
                  Go to Integrations to configure
                </button>`}
          </section>`
        : html`
          ${categories.map(category => html`
            <section style="margin-bottom: 18px;">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-secondary, #a0a0b0); margin-bottom: 10px; padding: 0 2px;">
                ${category}
              </div>
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px;">
                ${(grouped.get(category) ?? []).map(cred => {
                  const meta = credentialMeta(cred.type);
                  return html`
                    <div class="card" style="padding: 14px 16px; display: flex; align-items: center; gap: 12px;">
                      <div style="font-size: 22px; flex-shrink: 0;">${meta.icon}</div>
                      <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${cred.name}</div>
                        <div class="muted" style="font-size: 11px;">${meta.label}</div>
                      </div>
                      <span class="chip chip-ok" style="flex-shrink: 0;">Configured</span>
                    </div>
                  `;
                })}
              </div>
            </section>
          `)}

          <!-- "Add more" footer -->
          <div class="muted" style="font-size: 12px; text-align: center; margin-top: 8px;">
            ${opsProvisioned
              ? html`To add more credentials, <a href="${props.opsUiHref ?? "/ops-ui/credentials"}" target="_parent">open the Workflow Engine</a>.`
              : html`Set up the Workflow Engine in <button class="link-btn" @click=${() => props.onOpenIntegrations()}>Integrations</button> to add more.`}
          </div>
        `}
  `;
}

export default renderConnections;
