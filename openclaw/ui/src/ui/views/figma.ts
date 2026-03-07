import { html, nothing } from "lit";
import type { ChatProps } from "./chat.ts";
import { renderChat } from "./chat.ts";
import type { PmosConnectorsStatus } from "../controllers/pmos-connectors.ts";

export type FigmaProps = {
  connected: boolean;
  figmaUrl: string;
  embedUrl: string;
  authUrl: string;
  connectorsLoading: boolean;
  connectorsError: string | null;
  connectorsStatus: PmosConnectorsStatus | null;
  syncing: boolean;
  syncError: string | null;
  syncedOk: boolean;
  chatProps: ChatProps;
  onOpenAuth: () => void;
  onSyncContext: () => void;
  onRefresh: () => void;
  onOpenIntegrations: () => void;
  onPrefillPrompt: (prompt: string) => void;
};

function buildPrompt(status: PmosConnectorsStatus["figma"] | null | undefined, mode: "audit" | "tokens" | "layout") {
  const identity = status?.identity;
  const connection = identity?.activeConnectionName ?? identity?.activeTeamId ?? "the active Figma workspace";
  const fileRef = identity?.selectedFileName ?? identity?.selectedFileUrl ?? "the currently selected Figma file";
  switch (mode) {
    case "tokens":
      return `Use the figma-design-audit skill mindset to review ${fileRef} from ${connection}. Focus on styles, variables, colors, fonts, and naming consistency.`;
    case "layout":
      return `Review ${fileRef} from ${connection}. Focus on component structure, auto-layout usage, spacing systems, constraints, and repeatable layout patterns.`;
    default:
      return `Audit ${fileRef} from ${connection}. Identify design-system drift, component duplication, missing variables, inconsistent typography, and the most important fixes.`;
  }
}

export function renderFigma(props: FigmaProps) {
  const figma = props.connectorsStatus?.figma ?? null;
  const identity = figma?.identity ?? null;
  const canEmbed = Boolean(props.figmaUrl?.trim());

  return html`
    ${props.connectorsError
      ? html`<div class="callout danger" style="margin-bottom: 16px;">${props.connectorsError}</div>`
      : nothing}

    ${!canEmbed
      ? html`
          <section class="card" style="padding: 32px 24px; text-align: center;">
            <div style="font-weight: 600; margin-bottom: 8px;">Figma File Manager is not configured.</div>
            <div class="muted" style="max-width: 520px; margin: 0 auto 18px;">
              Save the Figma File Manager URL in Integrations before opening the embedded panel.
            </div>
            <button class="btn btn--primary" @click=${() => props.onOpenIntegrations()}>
              Configure Integrations
            </button>
          </section>
        `
      : html`
          <div style="display:flex; flex-direction:column; gap:12px; min-height: calc(100vh - 140px);">
            <div class="page-header" style="margin-bottom: 0;">
              <div>
                <div class="page-title">Figma</div>
                <div class="page-subtitle">Embedded Figma File Manager with workspace-synced context for AI design reviews.</div>
              </div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                ${props.syncedOk ? html`<span class="chip chip-ok">Context Synced</span>` : nothing}
                <button class="btn btn--secondary" @click=${() => props.onOpenAuth()}>
                  Sign In Outside Panel
                </button>
                <button class="btn btn--secondary" ?disabled=${props.connectorsLoading} @click=${() => props.onRefresh()}>
                  ${props.connectorsLoading ? "Refreshing..." : "Reload"}
                </button>
                <button class="btn btn--primary" ?disabled=${props.syncing || !props.connected} @click=${() => props.onSyncContext()}>
                  ${props.syncing ? "Syncing..." : "Sync Figma Context"}
                </button>
              </div>
            </div>

            ${props.syncError
              ? html`<div class="callout warn" style="font-size: 12px;">${props.syncError}</div>`
              : nothing}

            ${!identity?.connected
              ? html`
                  <div class="callout" style="font-size: 12px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                    <span>
                      If the embedded login flow is blocked by your browser, start Figma sign-in from the top-level PMOS page instead.
                    </span>
                    <a href=${props.authUrl} class="btn btn--secondary" target="pmos-figma-auth">
                      Open Auth Window
                    </a>
                  </div>
                `
              : nothing}

            <div style="display:grid; grid-template-columns:minmax(0, 1.7fr) minmax(340px, 0.9fr); gap:12px; min-height: calc(100vh - 220px);">
              <div class="card" style="padding:0; overflow:hidden; min-height: calc(100vh - 220px);">
                <iframe
                  src=${props.embedUrl}
                  title="Figma File Manager"
                  style="width:100%; min-height: calc(100vh - 220px); border:0; display:block; background:#101418;"
                  allow="clipboard-read; clipboard-write"
                ></iframe>
              </div>

              <div style="display:flex; flex-direction:column; gap:12px; min-height: 0;">
                <section class="card">
                  <div class="card-title">Figma AI Assistant</div>
                  <div class="card-sub">
                    Keep the file manager open on the left, sync the active team/file context, then run focused design review prompts.
                  </div>

                  <div class="stat-grid" style="margin-top: 16px;">
                    <div class="stat">
                      <div class="stat-label">User</div>
                      <div class="stat-value ${identity?.connected ? "ok" : "warn"}">
                        ${identity?.handle ?? identity?.email ?? "Not synced"}
                      </div>
                    </div>
                    <div class="stat">
                      <div class="stat-label">Connection</div>
                      <div class="stat-value ${identity?.activeConnectionName ? "ok" : "warn"}">
                        ${identity?.activeConnectionName ?? identity?.activeTeamId ?? "Not synced"}
                      </div>
                    </div>
                  </div>

                  ${identity?.selectedFileUrl
                    ? html`
                        <div class="callout" style="margin-top: 12px; font-size: 12px;">
                          <div><strong>Selected file:</strong> ${identity.selectedFileName ?? identity.selectedFileUrl}</div>
                          <div class="muted mono" style="margin-top: 4px;">${identity.selectedFileUrl}</div>
                        </div>
                      `
                    : html`<div class="muted" style="margin-top: 12px; font-size: 12px;">Open a Figma file in the left panel, then run Sync Figma Context to capture it for AI.</div>`}

                  <div class="row" style="margin-top: 14px; gap: 8px; flex-wrap: wrap;">
                    <button class="btn btn--secondary" @click=${() => props.onPrefillPrompt(buildPrompt(figma, "audit"))}>Audit Current File</button>
                    <button class="btn btn--secondary" @click=${() => props.onPrefillPrompt(buildPrompt(figma, "tokens"))}>Review Tokens</button>
                    <button class="btn btn--secondary" @click=${() => props.onPrefillPrompt(buildPrompt(figma, "layout"))}>Review Auto-Layout</button>
                  </div>
                </section>

                <section class="card" style="display:flex; flex-direction:column; min-height: 0; flex:1 1 auto; overflow:hidden;">
                  <div class="card-title">Assistant Chat</div>
                  <div class="card-sub">Use the synced Figma context plus the design audit skill prompts inside the normal PMOS chat runtime.</div>
                  <div style="margin-top: 12px; min-height: 0; flex:1 1 auto; overflow:hidden;">
                    ${renderChat(props.chatProps)}
                  </div>
                </section>
              </div>
            </div>
          </div>
        `}
  `;
}

export default renderFigma;