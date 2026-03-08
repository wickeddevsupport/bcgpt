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
          <div style="display:flex; flex-direction:column; gap:12px; height: calc(100dvh - 140px); min-height: 400px;">
            <div class="page-header" style="margin-bottom: 0; flex-shrink:0;">
              <div>
                <div class="page-title">Figma</div>
                <div class="page-subtitle">Embedded Figma File Manager with live workspace sync for AI design reviews.</div>
              </div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span class="chip">Auto Sync On</span>
                ${props.syncedOk ? html`<span class="chip chip-ok">Context Synced</span>` : nothing}
                <button class="btn btn--secondary" ?disabled=${props.connectorsLoading} @click=${() => props.onRefresh()}>
                  ${props.connectorsLoading ? "Refreshing..." : "Reload"}
                </button>
                <button class="btn btn--primary" ?disabled=${props.syncing || !props.connected} @click=${() => props.onSyncContext()}>
                  ${props.syncing ? "Syncing..." : "Sync Now"}
                </button>
              </div>
            </div>

            ${props.syncError
              ? html`<div class="callout warn" style="font-size: 12px; flex-shrink:0;">${props.syncError}</div>`
              : nothing}

            <!-- 2-column: left (assistant + iframe stacked), right (chat) -->
            <div style="display:grid; grid-template-columns:minmax(0, 1.7fr) minmax(320px, 0.9fr); gap:12px; flex:1 1 auto; min-height:0; overflow:hidden;">

              <!-- Left column: AI assistant card on top, iframe below -->
              <div style="display:flex; flex-direction:column; gap:12px; min-height:0; overflow:hidden;">
                <section class="card" style="flex-shrink:0;">
                  <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                    <div>
                      <div class="card-title">Figma AI Assistant</div>
                      <div class="card-sub">
                        ${identity?.connected
                          ? `${identity.handle ?? identity.email ?? "Connected"} · ${identity.activeConnectionName ?? identity.activeTeamId ?? "Team synced"}`
                          : "Sign in below to connect your Figma workspace."}
                      </div>
                    </div>
                    <div class="chip-row">
                      <span class="chip ${identity?.connected ? "chip-ok" : "chip-warn"}">${identity?.connected ? "Connected" : "Not connected"}</span>
                    </div>
                  </div>

                  ${identity?.selectedFileUrl
                    ? html`
                        <div class="callout" style="margin-top: 10px; font-size: 12px;">
                          <strong>Selected file:</strong> ${identity.selectedFileName ?? identity.selectedFileUrl}
                        </div>
                      `
                    : html`<div class="muted" style="margin-top: 8px; font-size: 12px;">Open a Figma file in the panel below and PMOS will capture it for AI context.</div>`}

                  <div class="row" style="margin-top: 12px; gap: 8px; flex-wrap: wrap;">
                    <button class="btn btn--secondary" @click=${() => props.onPrefillPrompt(buildPrompt(figma, "audit"))}>Audit File</button>
                    <button class="btn btn--secondary" @click=${() => props.onPrefillPrompt(buildPrompt(figma, "tokens"))}>Review Tokens</button>
                    <button class="btn btn--secondary" @click=${() => props.onPrefillPrompt(buildPrompt(figma, "layout"))}>Review Layout</button>
                  </div>
                </section>

                <!-- Iframe area — shows sign-in CTA when not connected -->
                <div class="card" style="flex:1 1 auto; min-height:0; padding:0; overflow:hidden; position:relative; display:flex; flex-direction:column;">
                  ${!identity?.connected
                    ? html`
                        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:16px; padding:32px 24px; text-align:center;">
                          <div style="font-size:32px;">🎨</div>
                          <div style="font-weight:600;">Sign in to Figma</div>
                          <div class="muted" style="max-width:360px; font-size:13px;">
                            Connect your Figma account to embed the file manager and enable AI design reviews.
                          </div>
                          <a href=${props.authUrl} class="btn btn--primary" target="pmos-figma-auth" @click=${() => props.onOpenAuth()}>
                            Sign In with Figma
                          </a>
                        </div>
                      `
                    : html`
                        <iframe
                          src=${props.embedUrl}
                          title="Figma File Manager"
                          style="flex:1 1 auto; width:100%; height:100%; border:0; display:block; background:#101418;"
                          allow="clipboard-read; clipboard-write"
                        ></iframe>
                      `}
                </div>
              </div>

              <!-- Right column: full-height chat panel -->
              <div style="display:flex; flex-direction:column; min-height:0; overflow:hidden;">
                <section class="card" style="display:flex; flex-direction:column; flex:1 1 auto; min-height:0; overflow:hidden;">
                  <div class="card-title">Assistant Chat</div>
                  <div class="card-sub">Chat with PMOS using synced Figma context and design audit skills.</div>
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