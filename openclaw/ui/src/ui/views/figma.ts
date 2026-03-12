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
  liveAuthVerified: boolean;
  chatProps: ChatProps;
  onOpenAuth: () => void;
  onSyncContext: () => void;
  onRefresh: () => void;
  onPrepareOfficialMcp: () => void;
  onOpenIntegrations: () => void;
  onPrefillPrompt: (prompt: string) => void;
};

function buildPrompt(
  status: PmosConnectorsStatus["figma"] | null | undefined,
  mode: "audit" | "tokens" | "layout",
) {
  const identity = status?.identity;
  const connection =
    identity?.activeConnectionName ?? identity?.activeTeamId ?? "the active Figma workspace";
  const fileRef =
    identity?.selectedFileName ?? identity?.selectedFileUrl ?? "the currently selected Figma file";
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
  const officialMcp = figma?.mcp ?? null;
  const canEmbed = Boolean(props.figmaUrl?.trim());
  const hasSyncedIdentity = identity?.connected === true;
  const hasLiveAuth = figma?.authOk === true;
  const requiresSignIn = !hasSyncedIdentity || !hasLiveAuth || !props.liveAuthVerified;
  const canRenderIframe = hasSyncedIdentity && hasLiveAuth && props.liveAuthVerified;
  const panelStatusLabel = canRenderIframe ? "Panel Sync Ready" : "Panel Sign-in Required";
  const bridgeReady = officialMcp?.authOk === true;
  const bridgeStatusLabel = bridgeReady
    ? "Bridge Ready"
    : officialMcp?.configured
      ? officialMcp?.authRequired
        ? "Bridge Needs PAT"
        : "Bridge Checking"
      : "Bridge Not Ready";
  const identitySummary = hasSyncedIdentity
    ? `${identity?.handle ?? identity?.email ?? "Connected"} · ${identity?.activeConnectionName ?? identity?.activeTeamId ?? "Team synced"}`
    : "Open the popup and sync the panel to unlock the embedded file manager.";
  const selectedFileLabel = identity?.selectedFileName ?? identity?.selectedFileUrl ?? null;
  const bridgeSummary = bridgeReady
    ? "Comments, screenshots, metadata, and design context are available."
    : officialMcp?.configured
      ? officialMcp?.authRequired
        ? "Sync the workspace PAT through the embedded panel to enable deeper bridge tools."
        : officialMcp?.error ?? "The bridge is configured, but the last live probe did not pass."
      : "Sync the embedded panel before relying on deeper Figma bridge tools.";

  return html`
    ${props.connectorsError
      ? html`<div class="callout danger" style="margin-bottom: 16px;">${props.connectorsError}</div>`
      : nothing}

    ${!canEmbed
      ? html`
          <section class="card" style="padding: 32px 24px; text-align: center;">
            <div style="font-weight: 600; margin-bottom: 8px;">Figma panel is not configured.</div>
            <div class="muted" style="max-width: 520px; margin: 0 auto 18px;">
              Save the Figma panel URL in Integrations before opening the embedded panel.
            </div>
            <button class="btn btn--primary" @click=${() => props.onOpenIntegrations()}>
              Configure Integrations
            </button>
          </section>
        `
      : html`
          <div style="display:flex; flex-direction:column; gap:10px; min-height:calc(100dvh - var(--shell-topbar-height, 56px) - 28px);">
            <section class="card" style="padding:12px 14px; flex-shrink:0;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; flex:1 1 420px;">
                  <div style="font-size:22px; font-weight:700; letter-spacing:-0.03em; line-height:1;">
                    Figma
                  </div>
                  <span class="chip">Auto Sync On</span>
                  ${props.syncedOk ? html`<span class="chip chip-ok">Context Synced</span>` : nothing}
                  <span class="chip ${canRenderIframe ? "chip-ok" : "chip-warn"}">
                    ${panelStatusLabel}
                  </span>
                  <span class="chip ${bridgeReady ? "chip-ok" : officialMcp?.configured ? "chip-warn" : ""}">
                    ${bridgeStatusLabel}
                  </span>
                </div>
                <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap;">
                  <button class="btn btn--secondary" @click=${() => props.onOpenAuth()}>
                    Open Sign-In Popup
                  </button>
                  <button
                    class="btn btn--secondary"
                    ?disabled=${props.connectorsLoading}
                    @click=${() => props.onRefresh()}
                  >
                    ${props.connectorsLoading ? "Refreshing..." : "Reload"}
                  </button>
                  <button
                    class="btn btn--primary"
                    ?disabled=${props.syncing || !props.connected}
                    @click=${() => props.onSyncContext()}
                  >
                    ${props.syncing ? "Syncing..." : "Sync Now"}
                  </button>
                </div>
              </div>

              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-top:10px;">
                <div style="display:flex; align-items:center; gap:10px 14px; flex-wrap:wrap; min-width:0; flex:1 1 460px; font-size:12px;">
                  <span class="muted">${identitySummary}</span>
                  ${selectedFileLabel
                    ? html`
                        <span
                          class="mono"
                          style="max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
                          title=${selectedFileLabel}
                        >
                          ${selectedFileLabel}
                        </span>
                      `
                    : nothing}
                  <span class="muted">${bridgeSummary}</span>
                </div>
                <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap;">
                  <button
                    class="btn btn--secondary"
                    ?disabled=${props.connectorsLoading}
                    @click=${() => props.onPrepareOfficialMcp()}
                  >
                    Recheck Bridge
                  </button>
                  <button
                    class="btn btn--secondary"
                    @click=${() => props.onPrefillPrompt(buildPrompt(figma, "audit"))}
                  >
                    Audit File
                  </button>
                  <button
                    class="btn btn--secondary"
                    @click=${() => props.onPrefillPrompt(buildPrompt(figma, "tokens"))}
                  >
                    Review Tokens
                  </button>
                  <button
                    class="btn btn--secondary"
                    @click=${() => props.onPrefillPrompt(buildPrompt(figma, "layout"))}
                  >
                    Review Layout
                  </button>
                </div>
              </div>
            </section>

            ${props.syncError
              ? html`<div class="callout warn" style="font-size: 12px; flex-shrink:0;">${props.syncError}</div>`
              : nothing}

            <div style="display:grid; grid-template-columns:minmax(0, 1.7fr) minmax(360px, 0.95fr); gap:14px; flex:1 1 auto; min-height:0; overflow:hidden;">
              <div
                class="card"
                style="min-height:0; padding:0; overflow:hidden; position:relative; display:flex; flex-direction:column;"
              >
                ${requiresSignIn
                  ? html`
                      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:16px; padding:32px 24px; text-align:center;">
                        <div style="font-size:30px; font-weight:700; letter-spacing:-0.03em;">Figma</div>
                        <div style="font-weight:600;">Sign in to Figma</div>
                        <div class="muted" style="max-width:360px; font-size:13px;">
                          Open the auth popup, finish sign-in, then click Sync Now. The embedded panel unlocks only after live auth is confirmed.
                        </div>
                        <button class="btn btn--primary" @click=${() => props.onOpenAuth()}>
                          Sign In with Figma (Popup)
                        </button>
                        <a
                          href=${props.authUrl}
                          class="btn btn--secondary"
                          target="pmos-figma-auth"
                          rel="noreferrer"
                        >
                          Open Sign-In in New Tab
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

              <div style="display:flex; flex-direction:column; min-height:0; overflow:hidden;">
                <section
                  class="card"
                  style="display:flex; flex-direction:column; flex:1 1 auto; min-height:0; overflow:hidden;"
                >
                  <div style="min-height:0; flex:1 1 auto; overflow:hidden;">
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
