import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import type { SessionsListResult } from "../types.ts";
import type { ChatItem, MessageGroup } from "../types/chat-types.ts";
import type { ChatAttachment, ChatQueueItem } from "../ui-types.ts";
import {
  renderMessageGroup,
  renderReadingIndicatorGroup,
  renderStreamingGroup,
} from "../chat/grouped-render.ts";
import { normalizeMessage, normalizeRoleForGrouping } from "../chat/message-normalizer.ts";
import { icons } from "../icons.ts";
import {
  isSpeechInputSupported,
  isTtsSupported,
  toggleVoiceInput,
  toggleTtsEnabled,
} from "../app-voice.ts";
import { renderMarkdownSidebar } from "./markdown-sidebar.ts";
import { pathForTab } from "../navigation.ts";
import "../components/resizable-divider.ts";

export type CompactionIndicatorStatus = {
  active: boolean;
  startedAt: number | null;
  completedAt: number | null;
};

export type ChatProps = {
  sessionKey: string;
  onSessionKeyChange: (next: string) => void;
  thinkingLevel: string | null;
  showThinking: boolean;
  loading: boolean;
  sending: boolean;
  canAbort?: boolean;
  compactionStatus?: CompactionIndicatorStatus | null;
  messages: unknown[];
  toolMessages: unknown[];
  stream: string | null;
  streamStartedAt: number | null;
  assistantAvatarUrl?: string | null;
  draft: string;
  queue: ChatQueueItem[];
  connected: boolean;
  canSend: boolean;
  disabledReason: string | null;
  error: string | null;
  sessions: SessionsListResult | null;
  // Focus mode
  focusMode: boolean;
  // Sidebar state
  sidebarOpen?: boolean;
  sidebarContent?: string | null;
  sidebarError?: string | null;
  splitRatio?: number;
  assistantName: string;
  assistantAvatar: string | null;
  // Agent context (for agent-specific chat)
  agentId?: string | null;
  agentName?: string | null;
  agentEmoji?: string | null;
  agentTheme?: string | null;
  headerCollapsed?: boolean;
  // Image attachments
  attachments?: ChatAttachment[];
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  // Scroll control
  showNewMessages?: boolean;
  onScrollToBottom?: () => void;
  // Event handlers
  onRefresh: () => void;
  onToggleFocusMode: () => void;
  onDraftChange: (next: string) => void;
  onSend: () => void;
  onCreateWorkflow?: () => void;
  createWorkflowBusy?: boolean;
  onAbort?: () => void;
  onQueueRemove: (id: string) => void;
  onNewSession: () => void;
  onOpenSidebar?: (content: string) => void;
  onCloseSidebar?: () => void;
  onSplitRatioChange?: (ratio: number) => void;
  onChatScroll?: (event: Event) => void;
  onViewMemory?: () => void;
  onToggleHeaderCollapsed?: () => void;
};

const COMPACTION_TOAST_DURATION_MS = 5000;
type ChatStatusTone = "ready" | "busy" | "warn";

function adjustTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function renderCompactionIndicator(status: CompactionIndicatorStatus | null | undefined) {
  if (!status) {
    return nothing;
  }

  // Show "compacting..." while active
  if (status.active) {
    return html`
      <div class="compaction-indicator compaction-indicator--active" role="status" aria-live="polite">
        ${icons.loader} Compacting context...
      </div>
    `;
  }

  // Show "compaction complete" briefly after completion
  if (status.completedAt) {
    const elapsed = Date.now() - status.completedAt;
    if (elapsed < COMPACTION_TOAST_DURATION_MS) {
      return html`
        <div class="compaction-indicator compaction-indicator--complete" role="status" aria-live="polite">
          ${icons.check} Context compacted
        </div>
      `;
    }
  }

  return nothing;
}

function resolveActiveTool(toolMessages: unknown[]): string | null {
  // Walk backwards to find the most recent tool that has a call but no result yet
  for (let i = toolMessages.length - 1; i >= 0; i--) {
    const msg = toolMessages[i];
    if (!msg || typeof msg !== "object") continue;
    const content = (msg as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    let toolName: string | null = null;
    let hasResult = false;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "toolcall" && typeof b.name === "string") toolName = b.name;
      if (b.type === "toolresult") hasResult = true;
    }
    if (toolName && !hasResult) return toolName;
  }
  return null;
}

function resolveThinkingSnippet(stream: string): string | null {
  // If the model has finished thinking, don't extract a snippet
  if (stream.includes("</thinking>")) return null;
  const start = stream.lastIndexOf("<thinking>");
  if (start === -1) return null;
  const content = stream.slice(start + "<thinking>".length).trim();
  if (!content) return null;
  const lines = content.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) return null;
  return lastLine.length > 80 ? `${lastLine.slice(0, 77)}...` : lastLine;
}

function resolveChatStatus(props: ChatProps): {
  label: string;
  detail: string;
  tone: ChatStatusTone;
} {
  const activeSession = props.sessions?.sessions?.find((row) => row.key === props.sessionKey);
  const sessionHasActiveRun =
    activeSession?.hasActiveRun === true || Boolean(activeSession?.activeRunId);

  if (!props.connected) {
    return {
      label: "Offline",
      detail: "Reconnect to resume chat activity.",
      tone: "warn",
    };
  }

  if (props.compactionStatus?.active) {
    return {
      label: "Working",
      detail: "Compacting context for the next turn.",
      tone: "busy",
    };
  }

  if (props.stream !== null) {
    const activeTool = resolveActiveTool(props.toolMessages);
    if (activeTool) {
      return {
        label: "Working",
        detail: `Calling ${activeTool.replace(/_/g, " ")}...`,
        tone: "busy",
      };
    }
    const thinkingSnippet = resolveThinkingSnippet(props.stream);
    if (thinkingSnippet) {
      return {
        label: "Thinking",
        detail: thinkingSnippet,
        tone: "busy",
      };
    }
    return {
      label: "Working",
      detail: "Streaming the current response.",
      tone: "busy",
    };
  }

  if (sessionHasActiveRun) {
    return {
      label: "Working",
      detail: "Restoring the active run after refresh.",
      tone: "busy",
    };
  }

  if (props.sending || props.queue.length > 0 || props.loading) {
    return {
      label: "Working",
      detail: "Preparing the next step in this thread.",
      tone: "busy",
    };
  }

  return {
    label: "Ready",
    detail: "Waiting for the next message.",
    tone: "ready",
  };
}

const CHAT_ATTACHMENT_ACCEPT = [
  // Images (all, including HEIC/BMP/TIFF which get converted server-side)
  "image/*",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  // Text / data
  "text/plain",
  "text/markdown",
  "text/html",
  "text/csv",
  "application/json",
  // Code files by extension (browsers may not have MIME registered for these)
  ".ts,.tsx,.js,.jsx,.py,.rb,.go,.java,.c,.cpp,.h,.cs,.php,.swift,.kt,.rs",
  ".sh,.bash,.zsh,.sql,.yaml,.yml,.xml,.toml,.ini,.env,.config",
  ".md,.markdown",
  // Office by extension
  ".docx,.doc,.xlsx,.xls,.ods,.pptx,.ppt,.odp",
  // HEIC/BMP/TIFF by extension
  ".heic,.heif,.bmp,.tiff,.tif",
].join(",");

function isSupportedMime(mimeType: string): boolean {
  // Allow unknown / generic binary — gateway decides via file extension
  if (!mimeType || mimeType === "application/octet-stream") return true;
  if (mimeType.startsWith("image/")) return true;
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/pdf") return true;
  if (mimeType === "application/json" || mimeType === "application/xml") return true;
  // Office documents
  if (mimeType.startsWith("application/vnd.openxmlformats-officedocument")) return true;
  if (mimeType.startsWith("application/vnd.oasis.opendocument")) return true;
  if (mimeType === "application/msword" || mimeType === "application/vnd.ms-excel" ||
      mimeType === "application/vnd.ms-powerpoint") return true;
  return false;
}

function generateAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readFileAsAttachment(file: File, onDone: (att: ChatAttachment) => void) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    onDone({
      id: generateAttachmentId(),
      dataUrl: reader.result as string,
      mimeType: file.type || "application/octet-stream",
      fileName: file.name,
    });
  });
  reader.readAsDataURL(file);
}

function handlePaste(e: ClipboardEvent, props: ChatProps) {
  const items = e.clipboardData?.items;
  if (!items || !props.onAttachmentsChange) {
    return;
  }

  // Only intercept file-kind items (images, PDFs, etc).
  // text/plain and text/html have kind="string" — let them through normally.
  const fileItems: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== "file") {
      continue;
    }
    if (isSupportedMime(item.type)) {
      const file = item.getAsFile();
      if (file) {
        fileItems.push(file);
      }
    }
  }

  if (fileItems.length === 0) {
    return;
  }

  e.preventDefault();

  for (const file of fileItems) {
    readFileAsAttachment(file, (att) => {
      const current = props.attachments ?? [];
      props.onAttachmentsChange?.([...current, att]);
    });
  }
}

function handleDrop(e: DragEvent, props: ChatProps) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files || !props.onAttachmentsChange) {
    return;
  }
  const current = props.attachments ?? [];
  const additions: ChatAttachment[] = [];
  let pending = 0;
  for (const file of files) {
    if (!isSupportedMime(file.type)) {
      continue;
    }
    pending++;
    readFileAsAttachment(file, (att) => {
      additions.push(att);
      pending--;
      if (pending === 0) {
        props.onAttachmentsChange?.([...current, ...additions]);
      }
    });
  }
}

function handleFileSelect(e: Event, props: ChatProps) {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files || !props.onAttachmentsChange) {
    return;
  }
  const current = props.attachments ?? [];
  for (const file of files) {
    readFileAsAttachment(file, (att) => {
      props.onAttachmentsChange?.([...current, att]);
    });
  }
  input.value = "";
}

function renderAttachmentPreview(props: ChatProps) {
  const attachments = props.attachments ?? [];
  if (attachments.length === 0) {
    return nothing;
  }

  return html`
    <div class="chat-attachments">
      ${attachments.map(
        (att) => html`
          <div class="chat-attachment">
            ${att.mimeType.startsWith("image/")
              ? html`<img src=${att.dataUrl} alt="Attachment preview" class="chat-attachment__img" />`
              : html`<div class="chat-attachment__file-label" title=${att.fileName ?? att.mimeType}>
                  ${icons.paperclip}
                  <span>${att.fileName ?? att.mimeType}</span>
                </div>`}
            <button
              class="chat-attachment__remove"
              type="button"
              aria-label="Remove attachment"
              @click=${() => {
                const next = (props.attachments ?? []).filter((a) => a.id !== att.id);
                props.onAttachmentsChange?.(next);
              }}
            >
              ${icons.x}
            </button>
          </div>
        `,
      )}
    </div>
  `;
}

export function renderChat(props: ChatProps) {
  const canCompose = props.connected;
  const isBusy = props.sending || props.stream !== null;
  const canAbort = Boolean(props.canAbort && props.onAbort);
  const activeSession = props.sessions?.sessions?.find((row) => row.key === props.sessionKey);
  const reasoningLevel = activeSession?.reasoningLevel ?? "off";
  // Show reasoning whenever the toggle is on, regardless of session's configured reasoningLevel.
  // reasoningLevel is the budget setting for HOW MUCH thinking to do — not whether the model
  // is sending thinking tokens. Models may stream thinking regardless of this field.
  // We keep reading reasoningLevel for other uses (e.g. toolbar icon state), but decouple
  // reasoning display from it so the toggle always works.
  const showReasoning = props.showThinking;
  const chatStatus = resolveChatStatus(props);
  const assistantIdentity = {
    name: props.assistantName,
    avatar: props.assistantAvatar ?? props.assistantAvatarUrl ?? null,
  };
  const agentHeaderCollapsed = props.headerCollapsed === true;

  const hasAttachments = (props.attachments?.length ?? 0) > 0;
  const composePlaceholder = props.connected
    ? hasAttachments
      ? "Add a message or attach more files..."
      : "Message (↩ to send, Shift+↩ for newline — drag or paste images/PDFs/code)"
    : "Connect to the gateway to start chatting…";

  const splitRatio = props.splitRatio ?? 0.6;
  const sidebarOpen = Boolean(props.sidebarOpen && props.onCloseSidebar);
  const thread = html`
    <div
      class="chat-thread"
      role="log"
      aria-live="polite"
      @scroll=${props.onChatScroll}
    >
      ${
        props.loading
          ? html`
              <div class="muted">Loading chat…</div>
            `
          : nothing
      }
      ${repeat(
        buildChatItems(props),
        (item) => item.key,
        (item) => {
          if (item.kind === "divider") {
            return html`
              <div class="chat-divider" role="separator" data-ts=${String(item.timestamp)}>
                <span class="chat-divider__line"></span>
                <span class="chat-divider__label">${item.label}</span>
                <span class="chat-divider__line"></span>
              </div>
            `;
          }

          if (item.kind === "reading-indicator") {
            return renderReadingIndicatorGroup(assistantIdentity);
          }

          if (item.kind === "stream") {
            return renderStreamingGroup(
              item.text,
              item.startedAt,
              props.onOpenSidebar,
              assistantIdentity,
              showReasoning,
            );
          }

          if (item.kind === "group") {
            return renderMessageGroup(item, {
              onOpenSidebar: props.onOpenSidebar,
              showReasoning,
              assistantName: props.assistantName,
              assistantAvatar: assistantIdentity.avatar,
              contextWindow:
                activeSession?.contextTokens ?? props.sessions?.defaults?.contextTokens ?? null,
            });
          }

          return nothing;
        },
      )}
    </div>
  `;

  return html`
    <section
      class="card chat"
      @drop=${(e: DragEvent) => handleDrop(e, props)}
      @dragover=${(e: DragEvent) => e.preventDefault()}
    >
      ${props.disabledReason ? html`<div class="callout">${props.disabledReason}</div>` : nothing}

      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}

      ${
        props.agentId && props.agentName && !agentHeaderCollapsed
          ? html`
              <div class="chat-agent-card">
                <div class="chat-agent-card__identity">
                  <div class="chat-agent-card__emoji">${props.agentEmoji || "🤖"}</div>
                  <div class="chat-agent-card__copy">
                    <div class="chat-agent-card__name">${props.agentName}</div>
                    <div class="chat-agent-card__meta">${props.agentTheme || "AI Agent"}</div>
                  </div>
                </div>
                <div class="chat-agent-card__actions">
                  ${
                    props.onViewMemory
                      ? html`
                          <button class="btn btn--sm btn--secondary" @click=${props.onViewMemory}>
                            Memory
                          </button>
                        `
                      : nothing
                  }
                  <a href="${pathForTab("agents")}" class="btn btn--sm btn--secondary">Settings</a>
                  ${
                    props.onToggleHeaderCollapsed
                      ? html`
                          <button
                            class="btn btn--sm btn--secondary chat-agent-card__toggle"
                            type="button"
                            @click=${props.onToggleHeaderCollapsed}
                            aria-label="Collapse agent header"
                            title="Collapse agent header"
                          >
                            ${icons.arrowDown}
                          </button>
                        `
                      : nothing
                  }
                </div>
              </div>
            `
          : nothing
      }

      ${
        props.focusMode
          ? html`
            <button
              class="chat-focus-exit"
              type="button"
              @click=${props.onToggleFocusMode}
              aria-label="Exit focus mode"
              title="Exit focus mode"
            >
              ${icons.x}
            </button>
          `
          : nothing
      }

      <div
        class="chat-split-container ${sidebarOpen ? "chat-split-container--open" : ""}"
      >
        <div
          class="chat-main"
          style="flex: ${sidebarOpen ? `0 0 ${splitRatio * 100}%` : "1 1 100%"}"
        >
          ${thread}
        </div>

        ${
          sidebarOpen
            ? html`
              <resizable-divider
                .splitRatio=${splitRatio}
                @resize=${(e: CustomEvent) => props.onSplitRatioChange?.(e.detail.splitRatio)}
              ></resizable-divider>
              <div class="chat-sidebar">
                ${renderMarkdownSidebar({
                  content: props.sidebarContent ?? null,
                  error: props.sidebarError ?? null,
                  onClose: props.onCloseSidebar!,
                  onViewRawText: () => {
                    if (!props.sidebarContent || !props.onOpenSidebar) {
                      return;
                    }
                    props.onOpenSidebar(`\`\`\`\n${props.sidebarContent}\n\`\`\``);
                  },
                })}
              </div>
            `
            : nothing
        }
      </div>

      ${
        props.queue.length
          ? html`
            <div class="chat-queue" role="status" aria-live="polite">
              <div class="chat-queue__title">Queued (${props.queue.length})</div>
              <div class="chat-queue__list">
                ${props.queue.map(
                  (item) => html`
                    <div class="chat-queue__item">
                      <div class="chat-queue__text">
                        ${
                          item.text ||
                          (item.attachments?.length ? `Image (${item.attachments.length})` : "")
                        }
                      </div>
                      <button
                        class="btn chat-queue__remove"
                        type="button"
                        aria-label="Remove queued message"
                        @click=${() => props.onQueueRemove(item.id)}
                      >
                        ${icons.x}
                      </button>
                    </div>
                  `,
                )}
              </div>
            </div>
          `
          : nothing
      }

      ${
        props.showNewMessages
          ? html`
            <button
              class="btn chat-new-messages"
              type="button"
              @click=${props.onScrollToBottom}
            >
              New messages ${icons.arrowDown}
            </button>
          `
          : nothing
      }

      <div class="chat-compose">
        <div class="chat-compose__meta">
          ${renderCompactionIndicator(props.compactionStatus)}
          <div class="chat-status-row" role="status" aria-live="polite">
            <span class="chat-status-badge chat-status-badge--${chatStatus.tone}">
              <span class="chat-status-badge__dot"></span>
              ${chatStatus.label}
            </span>
            <span class="chat-status-detail">${chatStatus.detail}</span>
          </div>
        </div>
        ${renderAttachmentPreview(props)}
        <input
          type="file"
          accept=${CHAT_ATTACHMENT_ACCEPT}
          multiple
          class="chat-file-input"
          style="display:none"
          @change=${(e: Event) => handleFileSelect(e, props)}
        />
        <div class="chat-compose__row" style="flex-direction: column;">
          <label class="field chat-compose__field" style="width: 100%;">
            <span>Message</span>
            <textarea
              ${ref((el) => el && adjustTextareaHeight(el as HTMLTextAreaElement))}
              .value=${props.draft}
              ?disabled=${!props.connected}
              style="width: 100%;"
              @keydown=${(e: KeyboardEvent) => {
                if (e.key !== "Enter") {
                  return;
                }
                if (e.isComposing || e.keyCode === 229) {
                  return;
                }
                if (e.shiftKey) {
                  return;
                } // Allow Shift+Enter for line breaks
                if (!props.connected) {
                  return;
                }
                e.preventDefault();
                if (canCompose) {
                  props.onSend();
                }
              }}
              @input=${(e: Event) => {
                const target = e.target as HTMLTextAreaElement;
                adjustTextareaHeight(target);
                props.onDraftChange(target.value);
              }}
              @paste=${(e: ClipboardEvent) => handlePaste(e, props)}
              placeholder=${composePlaceholder}
            ></textarea>
          </label>
          <div class="chat-compose__actions">
            <button
              class="btn"
              type="button"
              title="Attach file (images, PDFs, Office docs, code)"
              ?disabled=${!props.connected}
              @click=${() => {
                const input = document.querySelector<HTMLInputElement>(".chat-file-input");
                input?.click();
              }}
            >
              ${icons.paperclip}
            </button>
            ${isSpeechInputSupported() ? html`
              <button
                class="btn chat-mic-btn"
                type="button"
                title="Voice input"
                aria-pressed="false"
                ?disabled=${!props.connected}
                @click=${() => toggleVoiceInput(props.draft, props.onDraftChange)}
              >${icons.mic}</button>
            ` : nothing}
            ${isTtsSupported() ? html`
              <button
                class="btn chat-tts-btn"
                type="button"
                title="Read responses aloud"
                aria-pressed="false"
                @click=${() => toggleTtsEnabled()}
              >${icons.volume2}</button>
            ` : nothing}
            <button
              class="btn"
              ?disabled=${!props.connected || (!canAbort && props.sending)}
              @click=${canAbort ? props.onAbort : props.onNewSession}
            >
              ${canAbort ? "Stop" : "New session"}
            </button>
            <button
              class="btn primary"
              ?disabled=${!props.connected}
              @click=${props.onSend}
            >
              ${isBusy ? "Queue" : "Send"}<kbd class="btn-kbd">↵</kbd>
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

const CHAT_HISTORY_RENDER_LIMIT = 200;

function groupMessages(items: ChatItem[]): Array<ChatItem | MessageGroup> {
  const result: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;

  for (const item of items) {
    if (item.kind !== "message") {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(item);
      continue;
    }

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
    } else {
      currentGroup.messages.push({ message: item.message, key: item.key });
    }
  }

  if (currentGroup) {
    result.push(currentGroup);
  }
  return result;
}

function buildChatItems(props: ChatProps): Array<ChatItem | MessageGroup> {
  const items: ChatItem[] = [];
  const history = Array.isArray(props.messages) ? props.messages : [];
  const tools = Array.isArray(props.toolMessages) ? props.toolMessages : [];
  const historyStart = Math.max(0, history.length - CHAT_HISTORY_RENDER_LIMIT);
  if (historyStart > 0) {
    items.push({
      kind: "message",
      key: "chat:history:notice",
      message: {
        role: "system",
        content: `Showing last ${CHAT_HISTORY_RENDER_LIMIT} messages (${historyStart} hidden).`,
        timestamp: Date.now(),
      },
    });
  }
  for (let i = historyStart; i < history.length; i++) {
    const msg = history[i];
    if (!msg) continue;
    const normalized = normalizeMessage(msg);
    const raw = msg as Record<string, unknown>;
    const marker = raw.__openclaw as Record<string, unknown> | undefined;
    if (marker && marker.kind === "compaction") {
      items.push({
        kind: "divider",
        key:
          typeof marker.id === "string"
            ? `divider:compaction:${marker.id}`
            : `divider:compaction:${normalized.timestamp}:${i}`,
        label: "Compaction",
        timestamp: normalized.timestamp ?? Date.now(),
      });
      continue;
    }

    if (!props.showThinking && normalized.role.toLowerCase() === "toolresult") {
      continue;
    }

    items.push({
      kind: "message",
      key: messageKey(msg, i),
      message: msg,
    });
  }
  if (props.showThinking) {
    for (let i = 0; i < tools.length; i++) {
      items.push({
        kind: "message",
        key: messageKey(tools[i], i + history.length),
        message: tools[i],
      });
    }
  }

  if (props.stream !== null) {
    const key = `stream:${props.sessionKey}:${props.streamStartedAt ?? "live"}`;
    if (props.stream.trim().length > 0) {
      items.push({
        kind: "stream",
        key,
        text: props.stream,
        startedAt: props.streamStartedAt ?? Date.now(),
      });
    } else {
      items.push({ kind: "reading-indicator", key });
    }
  }

  return groupMessages(items);
}

function messageKey(message: unknown, index: number): string {
  const m = message as Record<string, unknown>;
  const toolCallId = typeof m.toolCallId === "string" ? m.toolCallId : "";
  if (toolCallId) {
    return `tool:${toolCallId}`;
  }
  const id = typeof m.id === "string" ? m.id : "";
  if (id) {
    return `msg:${id}`;
  }
  const messageId = typeof m.messageId === "string" ? m.messageId : "";
  if (messageId) {
    return `msg:${messageId}`;
  }
  const timestamp = typeof m.timestamp === "number" ? m.timestamp : null;
  const role = typeof m.role === "string" ? m.role : "unknown";
  if (timestamp != null) {
    return `msg:${role}:${timestamp}:${index}`;
  }
  return `msg:${role}:${index}`;
}
