import { html, nothing } from "lit";

export type LibreChatProps = {
  url: string | null;
  embedUrl: string | null;
  connected: boolean;
  reloading: boolean;
  onReload: () => void;
  onOpenChat: () => void;
};

export function renderLibreChat(props: LibreChatProps) {
  if (!props.url || !props.embedUrl) {
    return html`
      <section class="card" style="padding: 32px 24px; text-align: center;">
        <div style="font-weight: 700; font-size: 24px; letter-spacing: -0.03em; margin-bottom: 8px;">
          LibreChat is not configured yet.
        </div>
        <div class="muted" style="max-width: 620px; margin: 0 auto 18px;">
          Set <span class="mono">PMOS_LIBRECHAT_URL</span> on the PMOS deployment to surface the embedded
          LibreChat workspace here without replacing the native PMOS chat.
        </div>
        <button class="btn btn--secondary" @click=${() => props.onOpenChat()}>
          Open PMOS Chat
        </button>
      </section>
    `;
  }

  return html`
    <div style="display:flex; flex-direction:column; gap:12px; min-height:calc(100dvh - var(--shell-topbar-height, 56px) - 28px);">
      <section class="card" style="padding:12px 14px; flex-shrink:0;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; flex:1 1 420px;">
            <div style="font-size:22px; font-weight:700; letter-spacing:-0.03em; line-height:1;">
              LibreChat
            </div>
            <span class="chip chip-ok">Parallel Chat Ready</span>
            ${props.connected ? html`<span class="chip">Gateway Connected</span>` : html`<span class="chip chip-warn">Gateway Offline</span>`}
          </div>
          <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap;">
            <a
              class="btn btn--secondary"
              href=${props.url}
              target="_blank"
              rel="noreferrer"
            >
              Open in New Tab
            </a>
            <button class="btn btn--secondary" @click=${() => props.onOpenChat()}>
              Open PMOS Chat
            </button>
            <button class="btn btn--primary" @click=${() => props.onReload()}>
              ${props.reloading ? "Reloading..." : "Reload Embed"}
            </button>
          </div>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-top:10px;">
          <div class="muted" style="font-size:12px; flex:1 1 520px;">
            LibreChat runs as a separate surface so PMOS chat stays untouched. Use this tab for richer file and
            multimodal chat while keeping the original PMOS chat available beside it.
          </div>
          <div class="mono" style="font-size:11px; opacity:0.75; max-width:420px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title=${props.url}>
            ${props.url}
          </div>
        </div>
      </section>

      <section
        class="card"
        style="flex:1 1 auto; min-height:0; padding:0; overflow:hidden; position:relative; display:flex; flex-direction:column;"
      >
        <iframe
          src=${props.embedUrl}
          title="LibreChat"
          style="flex:1 1 auto; width:100%; height:100%; border:0; display:block; background:#0d1117;"
          referrerpolicy="strict-origin-when-cross-origin"
          allow="clipboard-read; clipboard-write"
        ></iframe>
        ${!props.connected
          ? html`
              <div
                style="position:absolute; right:16px; bottom:16px; background:rgba(14,17,22,0.88); border:1px solid var(--border); border-radius:12px; padding:10px 12px; max-width:320px;"
              >
                <div style="font-size:12px; font-weight:600; margin-bottom:4px;">PMOS gateway is disconnected</div>
                <div class="muted" style="font-size:12px;">
                  LibreChat can still load, but requests routed into the PMOS gateway may fail until the gateway reconnects.
                </div>
              </div>
            `
          : nothing}
      </section>
    </div>
  `;
}

export default renderLibreChat;
