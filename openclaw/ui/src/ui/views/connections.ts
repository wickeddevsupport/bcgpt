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
  selectedConnectionId?: string | null;
  credentialsLoading: boolean;
  credentialsError: string | null;
  addConnectionUrl: string;
  onRefresh: () => void;
  onSelectConnection: (connectionId: string | null) => void;
  onOpenIntegrations: () => void;
  onAddConnection: () => void;
};

const CONNECTION_LOAD_RETRY_MS = 220;
const CONNECTION_LOAD_MAX_ATTEMPTS = 12;

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

function pieceNameFromCredentialType(type: string): string | null {
  const map: Record<string, string> = {
    basecampApi: "basecamp",
    openAiApi: "openai",
    anthropicApi: "anthropic",
    googlePalmApi: "google-gemini",
    slackApi: "slack",
    githubApi: "github",
    notionApi: "notion",
    airtableApi: "airtable",
    googleSheetsOAuth2Api: "google-sheets",
    gmailOAuth2: "gmail",
  };
  return map[type] ?? null;
}

function toHref(url: URL): string {
  if (typeof window !== "undefined" && url.origin === window.location.origin) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return url.toString();
}

function buildConnectionsManagerUrl(baseUrl: string, selected?: ConnectionItem | null): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://os.wickedlab.io";
  const url = new URL(baseUrl, origin);
  url.searchParams.set("limit", "10");
  if (selected?.name?.trim()) {
    url.searchParams.set("displayName", selected.name.trim());
  } else {
    url.searchParams.delete("displayName");
  }
  const pieceName = selected ? pieceNameFromCredentialType(selected.type) : null;
  if (pieceName) {
    url.searchParams.set("pieceName", pieceName);
  } else {
    url.searchParams.delete("pieceName");
  }
  return toHref(url);
}

function buildFrameNavigationUrl(currentHref: string, selected?: ConnectionItem | null): string {
  const url = new URL(currentHref);
  if (!/\/connections(?:\/)?$/i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/(flows|tables|runs)(?:\/[^/]*)?$/i, "/connections");
  }
  url.searchParams.set("limit", "10");
  if (selected?.name?.trim()) {
    url.searchParams.set("displayName", selected.name.trim());
  } else {
    url.searchParams.delete("displayName");
  }
  const pieceName = selected ? pieceNameFromCredentialType(selected.type) : null;
  if (pieceName) {
    url.searchParams.set("pieceName", pieceName);
  } else {
    url.searchParams.delete("pieceName");
  }
  return url.toString();
}

function textButtonMatch(root: ParentNode, text: string): HTMLElement | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("button, [role='tab'], [role='menuitem'], a"));
  return (
    candidates.find((candidate) => candidate.textContent?.trim().toLowerCase() === text.toLowerCase()) ?? null
  );
}

function steerConnectionsFrame(
  frame: HTMLIFrameElement,
  selected?: ConnectionItem | null,
  attempt = 0,
): void {
  const win = frame.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    if (attempt < CONNECTION_LOAD_MAX_ATTEMPTS) {
      window.setTimeout(() => steerConnectionsFrame(frame, selected, attempt + 1), CONNECTION_LOAD_RETRY_MS);
    }
    return;
  }

  try {
    const currentHref = win.location.href;
    const desiredHref = buildFrameNavigationUrl(currentHref, selected);
    const current = new URL(currentHref);
    const desired = new URL(desiredHref);
    if (current.pathname !== desired.pathname || current.search !== desired.search) {
      win.location.replace(desiredHref);
      return;
    }
    if (/\/connections(?:\/)?$/i.test(current.pathname)) {
      return;
    }
  } catch {
    // fall through to UI click fallback
  }

  const moreButton = textButtonMatch(doc, "More");
  if (moreButton) {
    moreButton.click();
    window.setTimeout(() => {
      const menuConnections = textButtonMatch(doc, "Connections");
      menuConnections?.click();
    }, 40);
  } else {
    const directConnections = textButtonMatch(doc, "Connections");
    directConnections?.click();
  }

  if (attempt < CONNECTION_LOAD_MAX_ATTEMPTS) {
    window.setTimeout(() => steerConnectionsFrame(frame, selected, attempt + 1), CONNECTION_LOAD_RETRY_MS);
  }
}

export function renderConnections(props: ConnectionsProps) {
  const selectedConnection =
    props.selectedConnectionId && props.credentials.length
      ? props.credentials.find((credential) => credential.id === props.selectedConnectionId) ?? null
      : null;
  const iframeUrl = buildConnectionsManagerUrl(props.addConnectionUrl, selectedConnection);

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
          <div class="page-header" style="margin-bottom: 0;">
            <div>
              <div class="page-title">Connections</div>
              <div class="page-subtitle">Compact connection rail on the left, full Flow manager on the right.</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="chip chip-ok">Flow Online</span>
              <button class="btn btn--secondary" ?disabled=${props.credentialsLoading} @click=${() => props.onRefresh()}>
                ${props.credentialsLoading ? "Refreshing..." : "Refresh"}
              </button>
              <button class="btn btn--sm btn--secondary" @click=${() => props.onAddConnection()}>
                Open in Popup
              </button>
            </div>
          </div>

          ${props.credentialsError
            ? html`<div class="callout danger" style="margin-bottom: 12px;">${props.credentialsError}</div>`
            : nothing}

          <section
            style="display:grid; grid-template-columns:240px minmax(0, 1fr); gap:16px; align-items:stretch; min-height:calc(100dvh - var(--shell-topbar-height, 56px) - 140px);"
          >
            <aside
              style="display:flex; flex-direction:column; gap:10px; min-width:0; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--surface); padding:12px;"
            >
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                <div>
                  <div style="font-size:13px; font-weight:600;">Workspace connections</div>
                  <div class="muted" style="font-size:12px;">Quick filter into Flow.</div>
                </div>
                <span class="chip">${props.credentials.length}</span>
              </div>

              <button
                class="btn btn--sm ${props.selectedConnectionId ? "" : "btn--primary"}"
                style="justify-content:flex-start;"
                @click=${() => props.onSelectConnection(null)}
              >
                All connections
              </button>

              <div style="display:flex; flex-direction:column; gap:8px; min-height:0; overflow:auto; padding-right:2px;">
                ${props.credentialsLoading && props.credentials.length === 0
                  ? html`<div class="callout" style="padding:18px; text-align:center;">Loading...</div>`
                  : nothing}

                ${props.credentials.length > 0
                  ? props.credentials.map((credential) => {
                      const selected = credential.id === props.selectedConnectionId;
                      return html`
                        <button
                          class="btn ${selected ? "btn--primary" : "btn--secondary"}"
                          style="display:grid; gap:4px; justify-items:start; text-align:left; padding:10px 12px;"
                          @click=${() => props.onSelectConnection(credential.id)}
                          title=${credential.name}
                        >
                          <span style="font-weight:600; width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${credential.name}
                          </span>
                          <span class="muted" style="font-size:11px;">${credentialLabel(credential.type)}</span>
                        </button>
                      `;
                    })
                  : !props.credentialsLoading
                    ? html`
                        <div class="callout" style="padding:18px; text-align:center;">
                          No connections yet. Use the manager to create one.
                        </div>
                      `
                    : nothing}
              </div>
            </aside>

            <div
              class="card"
              style="padding:0; overflow:hidden; display:grid; grid-template-rows:auto minmax(0, 1fr); min-height:0;"
            >
              <div
                style="padding:12px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;"
              >
                <div>
                  <div style="font-weight:600; font-size:14px;">Flow connections manager</div>
                  <div class="muted" style="font-size:12px;">
                    ${selectedConnection
                      ? html`Focused on <strong>${selectedConnection.name}</strong>.`
                      : "Full connections view with filters preserved in the iframe."}
                  </div>
                </div>
                <span class="chip">${selectedConnection ? credentialLabel(selectedConnection.type) : "All"}</span>
              </div>

              <iframe
                name="pmos-connections-frame"
                src=${iframeUrl}
                title="Flow Connections Manager"
                style="width:100%; height:100%; border:0; display:block; background:var(--bg, #0a0a0f);"
                allow="clipboard-read; clipboard-write"
                @load=${(event: Event) =>
                  steerConnectionsFrame(event.currentTarget as HTMLIFrameElement, selectedConnection)}
              ></iframe>
            </div>
          </section>
        `}
  `;
}

export default renderConnections;
