import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { renderMessageGroup } from "../chat/grouped-render.ts";
import { normalizeMessage, normalizeRoleForGrouping } from "../chat/message-normalizer.ts";
import type { ChatItem, MessageGroup } from "../types/chat-types.ts";
import {
  type PmosLibreChatAgent,
  type PmosLibreChatConversation,
  type PmosLibreChatMessage,
} from "../controllers/pmos-librechat.ts";
import { icons } from "../icons.ts";

export type LibreChatProps = {
  url: string | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  autologinConfigured: boolean;
  availableModels: string[];
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
  onSelectModel: (agentId: string, model: string) => void;
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

function selectedConversationForProps(props: LibreChatProps): PmosLibreChatConversation | null {
  const selectedConversationId = props.selectedConversationId?.trim() ?? "";
  if (!selectedConversationId) {
    return null;
  }
  return (
    props.conversations.find(
      (conversation) => conversation.conversationId === selectedConversationId,
    ) ?? null
  );
}

function modelLabel(value: string): string {
  return value
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join(" / ");
}

function renderEmptyState(props: LibreChatProps) {
  return html`
    <section class="card" style="padding:32px 24px; text-align:center;">
      <div style="font-weight:700; font-size:24px; letter-spacing:-0.03em; margin-bottom:8px;">
        PMOS bots are not ready yet.
      </div>
      <div class="muted" style="max-width:680px; margin:0 auto 18px;">
        ${props.autologinConfigured
          ? "This workspace does not have any PMOS bots exposed to the LibreChat bridge yet. Refresh once the workspace config is present."
          : "The LibreChat bridge is up, but PMOS auto-login is not configured yet. Add PMOS_LIBRECHAT_AUTOLOGIN_PASSWORD so users land in chat without a second sign-in."}
      </div>
      <div style="display:flex; align-items:center; justify-content:center; gap:8px; flex-wrap:wrap;">
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

function renderModelSelect(
  props: LibreChatProps,
  selectedAgent: PmosLibreChatAgent | null,
  selectedConversation: PmosLibreChatConversation | null,
) {
  const activeModel = selectedConversation?.model ?? selectedAgent?.model ?? props.availableModels[0] ?? "";
  const disabled = !selectedAgent || props.availableModels.length === 0 || Boolean(selectedConversation);
  return html`
    <label style="display:flex; flex-direction:column; gap:6px; min-width:220px;">
      <span class="muted" style="font-size:11px; text-transform:uppercase; letter-spacing:0.12em;">
        Model
      </span>
      <select
        .value=${activeModel}
        ?disabled=${disabled}
        title=${selectedConversation
          ? "Start a new session to switch models for this bot."
          : "Choose the model used for the next session under this bot."}
        style="min-height:40px; padding:0 12px; border-radius:12px; border:1px solid var(--border); background:var(--panel); color:var(--text);"
        @change=${(event: Event) => {
          const next = (event.target as HTMLSelectElement).value;
          if (selectedAgent && next) {
            props.onSelectModel(selectedAgent.id, next);
          }
        }}
      >
        ${props.availableModels.length === 0
          ? html`<option value="">No models available</option>`
          : repeat(
              props.availableModels,
              (model) => model,
              (model) => html`<option value=${model}>${model}</option>`,
            )}
      </select>
    </label>
  `;
}

export function renderLibreChat(props: LibreChatProps) {
  const selectedAgent = props.agents.find((agent) => agent.id === props.selectedAgentId) ?? null;
  const selectedConversation = selectedConversationForProps(props);
  const messages = resolveMessages(props);
  const groupedMessages = groupMessages(messages);
  const conversationsByAgent = new Map<string, PmosLibreChatConversation[]>();

  for (const agent of props.agents) {
    conversationsByAgent.set(
      agent.id,
      props.conversations.filter((conversation) => conversation.agentId === agent.id),
    );
  }

  const canCompose = Boolean(selectedAgent) && props.availableModels.length > 0;

  return html`
    <div style="display:flex; flex-direction:column; gap:12px; min-height:calc(100dvh - var(--shell-topbar-height, 56px) - 28px);">
      <section class="card" style="padding:14px 16px; flex-shrink:0;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div style="display:flex; flex-direction:column; gap:8px; min-width:0; flex:1 1 540px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="font-size:22px; font-weight:700; letter-spacing:-0.03em; line-height:1;">
                PMOS Bots
              </div>
              <span class="chip chip-ok">LibreChat Runtime</span>
              ${props.connected
                ? html`<span class="chip">Gateway Connected</span>`
                : html`<span class="chip chip-warn">Gateway Offline</span>`}
              ${selectedAgent ? html`<span class="chip">${selectedAgent.name}</span>` : nothing}
              ${selectedConversation?.model
                ? html`<span class="chip">${modelLabel(selectedConversation.model)}</span>`
                : selectedAgent?.model
                  ? html`<span class="chip">${modelLabel(selectedAgent.model)}</span>`
                  : nothing}
            </div>
            <div class="muted" style="font-size:13px; max-width:840px;">
              This tab now uses Diwakar's PMOS bots and stores sessions under each bot on the left.
              Model choice happens per bot for new sessions, while active sessions stay pinned to the model they started with.
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <button class="btn btn--secondary" @click=${() => props.onOpenChat()}>
              Open PMOS Chat
            </button>
            <button class="btn btn--primary" @click=${() => props.onRefresh()}>
              ${props.loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        ${!props.autologinConfigured
          ? html`
              <div
                class="muted"
                style="margin-top:10px; padding:10px 12px; border-radius:12px; border:1px solid rgba(220, 170, 60, 0.25); background:rgba(220, 170, 60, 0.08);"
              >
                Auto-login is not configured yet, so this workspace may still fall back to a second LibreChat sign-in.
              </div>
            `
          : nothing}
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
            <div style="display:grid; grid-template-columns:minmax(280px, 340px) minmax(0, 1fr); gap:12px; min-height:0; flex:1 1 auto;">
              <section class="card" style="display:flex; flex-direction:column; min-height:0; overflow:hidden;">
                <div style="padding:14px 14px 10px; border-bottom:1px solid var(--border);">
                  <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.12em; opacity:0.72;">
                    Bots
                  </div>
                  <div class="muted" style="font-size:12px; margin-top:6px;">
                    Threads stay grouped under each PMOS bot so parallel work is easier to manage.
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
                        <article
                          class="card"
                          style="padding:12px; border-color:${isSelected ? "rgba(94,164,255,0.35)" : "var(--border)"}; background:${isSelected ? "rgba(94,164,255,0.05)" : "rgba(255,255,255,0.02)"};"
                        >
                          <button
                            class="btn btn--ghost"
                            style="width:100%; justify-content:space-between; padding:0; background:none; border:none; gap:12px;"
                            @click=${() => {
                              props.onSelectAgent(agent.id);
                              props.onToggleAgent(agent.id);
                            }}
                          >
                            <span style="display:flex; flex-direction:column; align-items:flex-start; gap:4px; min-width:0; text-align:left;">
                              <span style="font-weight:700; display:flex; align-items:center; gap:8px; min-width:0;">
                                <span
                                  style="display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:999px; background:rgba(94,164,255,0.14); color:var(--accent, currentColor);"
                                >
                                  ${icons.brain}
                                </span>
                                <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                  ${agent.name}
                                </span>
                              </span>
                              <span class="muted" style="font-size:12px; line-height:1.35;">
                                ${agent.description ?? "PMOS workspace bot"}
                              </span>
                              <span class="muted" style="font-size:11px;">
                                ${(agent.model && modelLabel(agent.model)) || "Choose a model for the next session"}
                              </span>
                            </span>
                            <span style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                              <span class="chip">${conversations.length}</span>
                              <span
                                style="display:inline-flex; width:18px; height:18px; transform:${isOpen ? "rotate(180deg)" : "rotate(0deg)"}; transition:transform 0.18s ease;"
                              >
                                ${icons.arrowDown}
                              </span>
                            </span>
                          </button>

                          <div style="display:flex; gap:8px; margin-top:10px;">
                            <button
                              class="btn btn--secondary"
                              style="flex:1 1 auto;"
                              @click=${() => props.onNewConversation(agent.id)}
                            >
                              New Session
                            </button>
                          </div>

                          ${isOpen
                            ? html`
                                <div style="display:flex; flex-direction:column; gap:6px; margin-top:10px;">
                                  ${conversations.length === 0
                                    ? html`
                                        <div class="muted" style="font-size:12px; padding:8px 2px;">
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
                                              style="width:100%; justify-content:flex-start; text-align:left; padding:10px; border:1px solid ${active ? "rgba(94,164,255,0.35)" : "var(--border)"}; background:${active ? "rgba(94,164,255,0.08)" : "transparent"};"
                                              @click=${() =>
                                                props.onSelectConversation(
                                                  conversation.conversationId,
                                                )}
                                            >
                                              <span style="display:flex; flex-direction:column; align-items:flex-start; gap:4px; min-width:0;">
                                                <span style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;">
                                                  ${conversation.title || "New Chat"}
                                                </span>
                                                <span class="muted" style="font-size:11px;">
                                                  ${conversation.model
                                                    ? `${modelLabel(conversation.model)} • `
                                                    : ""}${formatRelativeTime(
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
                        </article>
                      `;
                    },
                  )}
                </div>
              </section>

              <section class="card" style="display:flex; flex-direction:column; min-height:0; overflow:hidden;">
                <div style="padding:16px; border-bottom:1px solid var(--border); display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                  <div style="display:flex; flex-direction:column; gap:6px; min-width:0; flex:1 1 320px;">
                    <div style="font-weight:700; font-size:18px;">
                      ${selectedAgent?.name ?? "Select a Bot"}
                    </div>
                    <div class="muted" style="font-size:12px;">
                      ${selectedConversation
                        ? selectedConversation.title || "Active session"
                        : selectedAgent
                          ? "Choose the model for the next session, or start chatting right away."
                          : "Pick a bot from the left panel to start a session."}
                    </div>
                    ${selectedConversation
                      ? html`
                          <div class="muted" style="font-size:12px;">
                            This session is pinned to
                            <strong>${modelLabel(selectedConversation.model ?? selectedAgent?.model ?? "") || "its original model"}</strong>.
                            Start a new session to switch models.
                          </div>
                        `
                      : nothing}
                  </div>

                  <div style="display:flex; align-items:flex-end; gap:10px; flex-wrap:wrap;">
                    ${renderModelSelect(props, selectedAgent, selectedConversation)}
                    ${selectedAgent
                      ? html`
                          <button
                            class="btn btn--secondary"
                            @click=${() => props.onNewConversation(selectedAgent.id)}
                          >
                            New Session
                          </button>
                        `
                      : nothing}
                  </div>
                </div>

                <div style="flex:1 1 auto; min-height:0; overflow:auto; padding:18px 18px 12px; display:flex; flex-direction:column; gap:12px;">
                  ${groupedMessages.length === 0
                    ? html`
                        <div style="margin:auto; max-width:560px; text-align:center;">
                          <div style="font-size:24px; font-weight:700; letter-spacing:-0.03em; margin-bottom:8px;">
                            ${selectedAgent ? `Start with ${selectedAgent.name}` : "Choose a bot"}
                          </div>
                          <div class="muted">
                            ${selectedAgent
                              ? "This chat keeps PMOS bot grouping on the left while using LibreChat for stronger file and multimodal handling behind the scenes."
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
                            assistantName: selectedAgent?.name ?? "PMOS Bot",
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
                      ?disabled=${!canCompose || props.loading}
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
                            props.onAbort();
                            return;
                          }
                          props.onSend();
                        }
                      }}
                    ></textarea>

                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                      <div class="muted" style="font-size:12px;">
                        ${props.sending
                          ? "LibreChat is responding. Press Stop to cancel the current run."
                          : !selectedAgent
                            ? "Select a bot to unlock the composer."
                            : props.availableModels.length === 0
                              ? "No LibreChat models are available for this workspace yet."
                              : selectedConversation
                                ? "You are continuing an existing bot session."
                                : "Your next message will start a new session for this bot using the selected model."}
                      </div>
                      <div style="display:flex; align-items:center; gap:8px;">
                        ${props.sending
                          ? html`
                              <button class="btn btn--secondary" @click=${() => props.onAbort()}>
                                Stop
                              </button>
                            `
                          : nothing}
                        <button
                          class="btn btn--primary"
                          ?disabled=${!canCompose || !props.draft.trim() || props.loading}
                          @click=${() => props.onSend()}
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
