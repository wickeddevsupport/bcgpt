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
};

const COMPACTION_TOAST_DURATION_MS = 5000;
type ChatStatusTone = "ready" | "busy" | "warn";

function adjustTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

const CHAT_TEXT_ATTACHMENT_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/sql",
]);

const CHAT_TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "xml",
  "yml",
  "yaml",
  "js",
  "jsx",
  "ts",
  "tsx",
  "html",
  "css",
  "sql",
  "log",
]);

const CHAT_UPLOAD_ACCEPT =
  "image/*,text/*,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.yml,.yaml,.js,.jsx,.ts,.tsx,.html,.css,.sql,.log";

function extensionFromName(fileName: string | null | undefined): string {
  const trimmed = String(fileName ?? "").trim();
  const idx = trimmed.lastIndexOf(".");
  if (idx < 0) {
    return "";
  }
  return trimmed.slice(idx + 1).toLowerCase();
}

function inferAttachmentKind(file: File): ChatAttachment["kind"] {
  const mimeType = String(file.type || "").toLowerCase();
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (
    mimeType.startsWith("text/") ||
    CHAT_TEXT_ATTACHMENT_MIMES.has(mimeType) ||
    CHAT_TEXT_ATTACHMENT_EXTENSIONS.has(extensionFromName(file.name))
  ) {
    return "text";
  }
  return "file";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("file_read_error")));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("file_read_error")));
    reader.readAsText(file);
  });
}

async function filesToAttachments(files: FileList | File[]): Promise<ChatAttachment[]> {
  const list = Array.from(files ?? []);
  const attachments = await Promise.all(
    list.map(async (file) => {
      const kind = inferAttachmentKind(file);
      const dataUrl = await readFileAsDataUrl(file);
      const textContent = kind === "text" ? await readFileAsText(file) : null;
      return {
        id: generateAttachmentId(),
        dataUrl,
        mimeType: file.type || "application/octet-stream",
        fileName: file.name || "attachment",
        kind,
        textContent,
        sizeBytes: Number.isFinite(file.size) ? file.size : undefined,
      } satisfies ChatAttachment;
    }),
  );
  return attachments;
}

async function appendFilesAsAttachments(
  files: FileList | File[] | null | undefined,
  props: ChatProps,
) {
  if (!files || !props.onAttachmentsChange) {
    return;
  }
  const nextAttachments = await filesToAttachments(files);
  if (nextAttachments.length === 0) {
    return;
  }
  const current = props.attachments ?? [];
  props.onAttachmentsChange([...current, ...nextAttachments]);
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

function generateAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function handlePaste(e: ClipboardEvent, props: ChatProps) {
  const items = e.clipboardData?.items;
  if (!items || !props.onAttachmentsChange) {
    return;
  }

  const fileItems: DataTransferItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file") {
      fileItems.push(item);
    }
  }

  if (fileItems.length === 0) {
    return;
  }

  e.preventDefault();
  const files = fileItems
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  void appendFilesAsAttachments(files, props);
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
          <div class="chat-attachment chat-attachment--${att.kind ?? "image"}">
            ${
              (att.kind ?? "image") === "image"
                ? html`
                    <img
                      src=${att.dataUrl}
                      alt=${att.fileName ?? "Attachment preview"}
                      class="chat-attachment__img"
                    />
                  `
                : html`
                    <div class="chat-attachment__file">
                      <div class="chat-attachment__file-icon">${icons.fileText}</div>
                      <div class="chat-attachment__file-name" title=${att.fileName ?? "Attachment"}>
                        ${att.fileName ?? "Attachment"}
                      </div>
                      <div class="chat-attachment__file-meta">
                        ${att.kind === "text" ? "Text file" : att.mimeType || "File"}
                      </div>
                    </div>
                  `
            }
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
  let fileInput: HTMLInputElement | null = null;
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

  const hasAttachments = (props.attachments?.length ?? 0) > 0;
  const composePlaceholder = props.connected
    ? hasAttachments
      ? "Add a message or upload more files..."
      : "Message (↩ to send, Shift+↩ for line breaks, paste or upload files)"
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
            });
          }

          return nothing;
        },
      )}
    </div>
  `;

  return html`
    <section class="card chat">
      ${props.disabledReason ? html`<div class="callout">${props.disabledReason}</div>` : nothing}

      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}

      ${
        props.agentId && props.agentName
          ? html`
            <div class="chat-agent-header" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border-color, #333); margin-bottom: 0;">
              <div style="font-size: 28px;">${props.agentEmoji || '🤖'}</div>
              <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 16px;">${props.agentName}</div>
                <div class="muted" style="font-size: 13px;">${props.agentTheme || 'AI Agent'}</div>
              </div>
              <div style="display:flex;gap:6px;">
                ${props.onViewMemory ? html`<button class="btn btn--sm btn--secondary" @click=${props.onViewMemory}>Memory</button>` : nothing}
                <a href="${pathForTab('agents')}" class="btn btn--sm btn--secondary">Settings</a>
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
              @dragover=${(e: DragEvent) => {
                if (e.dataTransfer?.files?.length) {
                  e.preventDefault();
                }
              }}
              @drop=${(e: DragEvent) => {
                if (!e.dataTransfer?.files?.length) {
                  return;
                }
                e.preventDefault();
                void appendFilesAsAttachments(e.dataTransfer.files, props);
              }}
              placeholder=${composePlaceholder}
            ></textarea>
          </label>
          <div class="chat-compose__actions">
            ${
              props.onAttachmentsChange
                ? html`
                    <input
                      ${ref((el) => {
                        fileInput = el as HTMLInputElement | null;
                      })}
                      class="chat-compose__file-input"
                      type="file"
                      accept=${CHAT_UPLOAD_ACCEPT}
                      multiple
                      @change=${async (e: Event) => {
                        const input = e.target as HTMLInputElement;
                        if (!input.files?.length) {
                          return;
                        }
                        await appendFilesAsAttachments(input.files, props);
                        input.value = "";
                      }}
                    />
                    <button
                      class="btn btn--secondary chat-compose__attach"
                      type="button"
                      ?disabled=${!props.connected}
                      title="Upload images or text files"
                      aria-label="Upload images or text files"
                      @click=${() => fileInput?.click()}
                    >
                      ${icons.paperclip}
                    </button>
                  `
                : nothing
            }
            <button
              class="btn"
              ?disabled=${!props.connected || (!canAbort && props.sending)}
              @click=${canAbort ? props.onAbort : props.onNewSession}
            >
              ${canAbort ? "Stop" : "New session"}
            </button>
            ${props.onCreateWorkflow
              ? html`<button
                  class="btn"
                  ?disabled=${!props.connected || props.createWorkflowBusy || !props.draft?.trim()}
                  @click=${props.onCreateWorkflow}
                  title="Generate a workflow from your message and open it in the Automations editor"
                >
                  ${props.createWorkflowBusy ? "Creating..." : "Automate"}
                </button>`
              : nothing}
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
