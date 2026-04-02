import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import {
  renderMessageGroup,
} from "../chat/grouped-render.ts";
import { normalizeMessage, normalizeRoleForGrouping } from "../chat/message-normalizer.ts";
import type { ChatItem, MessageGroup } from "../types/chat-types.ts";
import type {
  PmosLibreChatAgent,
  PmosLibreChatConversation,
  PmosLibreChatMessage,
} from "../controllers/pmos-librechat.ts";

export type LibreChatProps = {
  url: string | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  autologinConfigured: boolean;
  agents: PmosLibreChatAgent[];
  conversations: PmosLibreChatConversation[];
  messages: PmosLibreChatMessage[];
  streamingMessage: PmosLibreChatMessage | null;
  selectedAgentId: string | null;
  selectedConversationId: string | null;
  draft: string;
  sending: boolean;
  openAgentIds: string[];
  onRefresh: () => void;
  onOpenChat: () => void;
  onDraftChange: (next: string) => void;
  onSelectAgent: (agentId: string) => void;
  onToggleAgent: (agentId: string) => void;
  onNewConversation: (agentId: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onSend: () => void;
  onAbort: () => void;
};

type MessageLike = PmosLibreChatMessage;

function adjustTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
}

function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) {
    return "recently";
  }
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function groupMessages(messages: MessageLike[]): MessageGroup[] {
  const items: ChatItem[] = messages.map((message, index) => ({
    kind: "message",
    key: message.messageId || `librechat-msg-${index}-${message.timestamp}`,
    message,
  }));
  const result: MessageGroup[] = [];
  let currentGroup: MessageGroup | null = null;

  for (const item of items) {
    const normalized = normalizeMessage(item.message);
    const role = normalizeRoleForGrouping(normalized.role);
    const timestamp = normalized.timestamp || Date.now();

    if (!currentGroup || currentGroup.role !== role) {
      if (currentGroup) {
        result.push(currentGroup);
      }
      currentGroup = {
        kind: "group",
        key: `group:${role}:${item.key}`,
        role,
        messages: [{ message: item.message, key: item.key }],
        timestamp,
        isStreaming: false,
      };
      continue;
    }

    currentGroup.messages.push({ message: item.message, key: item.key });
  }

  if (currentGroup) {
    result.push(currentGroup);
  }
  return result;
}

function resolveMessages(props: LibreChatProps): MessageLike[] {
  const history = Array.isArray(props.messages) ? props.messages : [];
  return props.streamingMessage ? [...history, props.streamingMessage] : history;
}

function renderEmptyState(props: LibreChatProps) {
  return html`
    <section class="card" style="padding: 32px 24px; text-align: center;">
      <div style="font-weight: 700; font-size: 24px; letter-spacing: -0.03em; margin-bottom: 8px;">
        LibreChat bots are not ready yet.
      </div>
      <div class="muted" style="max-width: 640px; margin: 0 auto 18px;">
        ${props.autologinConfigured
          ? "No bots were returned for this account yet. Create or share agents in LibreChat, then refresh this tab."
          : "PMOS can see the LibreChat URL, but auto-login is not configured yet. Set PMOS_LIBRECHAT_AUTOLOGIN_PASSWORD on the deployment so this tab can sign users in automatically."}
      </div>
      <div style="display:flex; align-items:center; justify-content:center; gap:8px; flex-wrap:wrap;">
        ${props.url
          ? html`
              <a class="btn btn--secondary" href=${props.url} target="_blank" rel="noreferrer">
                Open LibreChat
              </a>
            `
          : nothing}
        <button class="btn btn--secondary" @click=${() => props.onOpenChat()}>
          Open PMOS Chat
        </button>
        <button class="btn btn--primary" @click=${() => props.onRefresh()}>
          ${props.loading ? "Refreshing..." : "Refresh Bots"}
        </button>
      </div>
    </section>
  `;
}

export function renderLibreChat(props: LibreChatProps) {
  const selectedAgent = props.agents.find((agent) => agent.id === props.selectedAgentId) ?? null;
  const messages = resolveMessages(props);
  const groupedMessages = groupMessages(messages);
  const conversationsByAgent = new Map<string, PmosLibreChatConversation[]>();

  for (const agent of props.agents) {
    conversationsByAgent.set(
      agent.id,
      props.conversations.filter((conversation) => conversation.agentId === agent.id),
    );
  }

  return html`
    <div style="display:flex; flex-direction:column; gap:12px; min-height:calc(100dvh - var(--shell-topbar-height, 56px) - 28px);">
      <section class="card" style="padding:12px 14px; flex-shrink:0;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; flex:1 1 420px;">
            <div style="font-size:22px; font-weight:700; letter-spacing:-0.03em; line-height:1;">
              LibreChat
            </div>
            <span class="chip chip-ok">Native Bot Mode</span>
            ${props.connected ? html`<span class="chip">Gateway Connected</span>` : html`<span class="chip chip-warn">Gateway Offline</span>`}
            ${selectedAgent
              ? html`<span class="chip">${selectedAgent.name}</span>`
              : html`<span class="chip chip-warn">No Bot Selected</span>`}
            ${selectedAgent?.model ? html`<span class="chip">${selectedAgent.model}</span>` : nothing}
          </div>
          <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap;">
            ${props.url
              ? html`
                  <a
                    class="btn btn--secondary"
                    href=${props.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Full LibreChat
                  </a>
                `
              : nothing}
            <button class="btn btn--secondary" @click=${() => props.onOpenChat()}>
              Open PMOS Chat
            </button>
            <button class="btn btn--primary" @click=${() => props.onRefresh()}>
              ${props.loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-top:10px;">
          <div class="muted" style="font-size:12px; flex:1 1 540px;">
            This tab uses LibreChat agents as the backend, but keeps a PMOS-style shell with bot-grouped sessions and no separate login step.
          </div>
          <div class="mono" style="font-size:11px; opacity:0.75; max-width:420px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title=${props.url ?? ""}>
            ${props.url ?? "LibreChat URL unavailable"}
          </div>
        </div>
      </section>

      ${props.error
        ? html`
            <section class="card" style="padding:14px 16px; border-color:rgba(220,53,69,0.32);">
              <div style="font-weight:600; margin-bottom:4px;">LibreChat Error</div>
              <div class="muted" style="white-space:pre-wrap; word-break:break-word;">${props.error}</div>
            </section>
          `
        : nothing}

      ${props.agents.length === 0
        ? renderEmptyState(props)
        : html`
            <div style="display:grid; grid-template-columns:minmax(260px, 320px) minmax(0, 1fr); gap:12px; min-height:0; flex:1 1 auto;">
              <section class="card" style="display:flex; flex-direction:column; min-height:0; overflow:hidden;">
                <div style="padding:14px 14px 10px; border-bottom:1px solid var(--border);">
                  <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.12em; opacity:0.72;">
                    Bots
                  </div>
                  <div class="muted" style="font-size:12px; margin-top:6px;">
                    Sessions are grouped by the LibreChat bot that owns them.
                  </div>
                </div>
                <div style="padding:10px; overflow:auto; display:flex; flex-direction:column; gap:10px;">
                  ${repeat(
                    props.agents,
                    (agent) => agent.id,
                    (agent) => {
                      const conversations = conversationsByAgent.get(agent.id) ?? [];
                      const isOpen = props.openAgentIds.includes(agent.id);
                      const isSelected = props.selectedAgentId === agent.id;
                      return html`
                        <div class="card" style="padding:10px; background:rgba(255,255,255,0.02); border-color:${isSelected ? "rgba(94,164,255,0.35)" : "var(--border)"};">
                          <button
                            class="btn btn--ghost"
                            style="width:100%; justify-content:space-between; padding:0; background:none; border:none;"
                            @click=${() => {
                              props.onSelectAgent(agent.id);
                              props.onToggleAgent(agent.id);
                            }}
                          >
                            <span style="display:flex; flex-direction:column; align-items:flex-start; gap:2px; text-align:left;">
                              <span style="font-weight:700;">${agent.name}</span>
                              <span class="muted" style="font-size:12px;">
                                ${agent.model || agent.provider || "LibreChat agent"}
                              </span>
                            </span>
                            <span class="chip">${conversations.length}</span>
                          </button>

                          <div style="display:flex; align-items:center; gap:8px; margin-top:10px;">
                            <button class="btn btn--secondary" style="flex:1 1 auto;" @click=${() => props.onNewConversation(agent.id)}>
                              New Chat
                            </button>
                          </div>

                          ${isOpen
                            ? html`
                                <div style="display:flex; flex-direction:column; gap:6px; margin-top:10px;">
                                  ${conversations.length === 0
                                    ? html`
                                        <div class="muted" style="font-size:12px; padding:6px 2px;">
                                          No sessions yet for this bot.
                                        </div>
                                      `
                                    : repeat(
                                        conversations,
                                        (conversation) => conversation.conversationId,
                                        (conversation) => {
                                          const active =
                                            props.selectedConversationId ===
                                            conversation.conversationId;
                                          return html`
                                            <button
                                              class="btn btn--ghost"
                                              style="width:100%; justify-content:flex-start; text-align:left; padding:10px 10px; border:1px solid ${active ? "rgba(94,164,255,0.35)" : "var(--border)"}; background:${active ? "rgba(94,164,255,0.08)" : "transparent"};"
                                              @click=${() =>
                                                void props.onSelectConversation(
                                                  conversation.conversationId,
                                                )}
                                            >
                                              <span style="display:flex; flex-direction:column; align-items:flex-start; gap:4px; min-width:0;">
                                                <span style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;">
                                                  ${conversation.title || "New Chat"}
                                                </span>
                                                  <span class="muted" style="font-size:11px;">
                                                  ${formatRelativeTime(
                                                    conversation.updatedAtMs ??
                                                      conversation.createdAtMs ??
                                                      Date.now(),
                                                  )}
                                                </span>
                                              </span>
                                            </button>
                                          `;
                                        },
                                      )}
                                </div>
                              `
                            : nothing}
                        </div>
                      `;
                    },
                  )}
                </div>
              </section>

              <section class="card" style="display:flex; flex-direction:column; min-height:0; overflow:hidden;">
                <div style="padding:14px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                  <div style="display:flex; flex-direction:column; gap:4px;">
                    <div style="font-weight:700; font-size:18px;">
                      ${selectedAgent?.name ?? "Select a Bot"}
                    </div>
                    <div class="muted" style="font-size:12px;">
                      ${props.selectedConversationId
                        ? props.conversations.find(
                            (conversation) =>
                              conversation.conversationId === props.selectedConversationId,
                          )?.title ?? "Active conversation"
                        : "Start a new conversation or pick a session from the left rail."}
                    </div>
                  </div>
                  ${selectedAgent?.description
                    ? html`
                        <div class="muted" style="font-size:12px; max-width:420px;">
                          ${selectedAgent.description}
                        </div>
                      `
                    : nothing}
                </div>

                <div style="flex:1 1 auto; min-height:0; overflow:auto; padding:18px 18px 12px; display:flex; flex-direction:column; gap:12px;">
                  ${groupedMessages.length === 0
                    ? html`
                        <div style="margin:auto; max-width:520px; text-align:center;">
                          <div style="font-size:22px; font-weight:700; letter-spacing:-0.03em; margin-bottom:8px;">
                            ${selectedAgent ? `Start with ${selectedAgent.name}` : "Choose a bot"}
                          </div>
                          <div class="muted">
                            ${selectedAgent
                              ? "New sessions stay grouped under this bot on the left, so you can keep parallel threads without losing the PMOS shell."
                              : "Pick a bot from the left panel to begin."}
                          </div>
                        </div>
                      `
                    : repeat(
                        groupedMessages,
                        (group) => group.key,
                        (group) =>
                          renderMessageGroup(group, {
                            onOpenSidebar: undefined,
                            showReasoning: true,
                            assistantName: selectedAgent?.name ?? "LibreChat",
                            assistantAvatar: selectedAgent?.avatarUrl ?? null,
                            contextWindow: null,
                          }),
                      )}
                </div>

                <div style="padding:14px 16px 16px; border-top:1px solid var(--border);">
                  <div style="display:flex; flex-direction:column; gap:10px;">
                    <textarea
                      ${ref((element) => {
                        if (element instanceof HTMLTextAreaElement) {
                          adjustTextareaHeight(element);
                        }
                      })}
                      .value=${props.draft}
                      ?disabled=${!selectedAgent || props.loading}
                      rows="1"
                      placeholder=${selectedAgent
                        ? `Message ${selectedAgent.name}...`
                        : "Select a bot to start chatting"}
                      style="width:100%; min-height:48px; max-height:220px; resize:none;"
                      @input=${(event: Event) => {
                        const target = event.target as HTMLTextAreaElement;
                        props.onDraftChange(target.value);
                        adjustTextareaHeight(target);
                      }}
                      @keydown=${(event: KeyboardEvent) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          if (props.sending) {
                            void props.onAbort();
                            return;
                          }
                          void props.onSend();
                        }
                      }}
                    ></textarea>

                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                      <div class="muted" style="font-size:12px;">
                        ${props.sending
                          ? "LibreChat is responding. Press Stop to cancel the current run."
                          : selectedAgent
                            ? "Sessions are persisted in LibreChat and grouped by this bot."
                            : "Select a bot to unlock the composer."}
                      </div>
                      <div style="display:flex; align-items:center; gap:8px;">
                        ${props.sending
                          ? html`
                              <button class="btn btn--secondary" @click=${() => void props.onAbort()}>
                                Stop
                              </button>
                            `
                          : nothing}
                        <button
                          class="btn btn--primary"
                          ?disabled=${!selectedAgent || !props.draft.trim() || props.loading}
                          @click=${() => void props.onSend()}
                        >
                          ${props.sending ? "Sending..." : "Send"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          `}
    </div>
  `;
}

export default renderLibreChat;
