import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { AssistantIdentity } from "../assistant-identity.ts";
import type { MessageGroup } from "../types/chat-types.ts";
import { stripThinkingTags } from "../format.ts";
import { toSanitizedMarkdownHtml, toStreamingHtml } from "../markdown.ts";
import { renderCopyAsMarkdownButton } from "./copy-as-markdown.ts";
import {
  extractTextCached,
  extractThinkingCached,
  formatReasoningMarkdown,
} from "./message-extract.ts";
import { isToolResultMessage, normalizeRoleForGrouping } from "./message-normalizer.ts";
import { extractToolCards, renderToolCardSidebar } from "./tool-cards.ts";

type ImageBlock = {
  url: string;
  alt?: string;
};

function extractImages(message: unknown): ImageBlock[] {
  if (!message || typeof message !== "object") return [];
  const m = message as Record<string, unknown>;
  const content = m.content;
  const images: ImageBlock[] = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const b = block as Record<string, unknown>;

      if (b.type === "image") {
        // Handle source object format (from sendChatMessage)
        const source = b.source as Record<string, unknown> | undefined;
        if (source?.type === "base64" && typeof source.data === "string") {
          const data = source.data;
          const mediaType = (source.media_type as string) || "image/png";
          // If data is already a data URL, use it directly
          const url = data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
          images.push({ url });
        } else if (typeof b.url === "string") {
          images.push({ url: b.url });
        }
      } else if (b.type === "image_url") {
        // OpenAI format
        const imageUrl = b.image_url as Record<string, unknown> | undefined;
        if (typeof imageUrl?.url === "string") {
          images.push({ url: imageUrl.url });
        }
      }
    }
  }

  return images;
}

export function renderReadingIndicatorGroup(assistant?: AssistantIdentity) {
  return html`
    <div class="chat-group chat-group--timeline assistant">
      ${renderGroupLead("assistant", assistant)}
      <div class="chat-group-messages">
        ${renderGroupHeader(assistant?.name ?? "Assistant", null)}
        <div class="chat-bubble chat-reading-indicator" aria-hidden="true">
          <div class="chat-thinking__label">Thinking</div>
          <span class="chat-reading-indicator__dots">
            <span></span><span></span><span></span>
          </span>
        </div>
      </div>
    </div>
  `;
}

export function renderStreamingGroup(
  text: string,
  startedAt: number,
  onOpenSidebar?: (content: string) => void,
  assistant?: AssistantIdentity,
  showReasoning = false,
) {
  const timestamp = new Date(startedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const name = assistant?.name ?? "Assistant";
  const visibleText = stripThinkingTags(text).trim();
  const streamingMessage = {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: startedAt,
  };
  const extractedThinking = extractThinkingCached(streamingMessage);
  const thinkingMessage = extractedThinking
    ? {
        role: "assistant",
        content: [{ type: "thinking", thinking: extractedThinking }],
        timestamp: startedAt,
      }
    : null;
  const textMessage = visibleText
    ? {
        role: "assistant",
        content: [{ type: "text", text: visibleText }],
        timestamp: startedAt,
      }
    : null;

  return html`
    <div class="chat-group chat-group--timeline assistant">
      ${renderGroupLead("assistant", assistant)}
      <div class="chat-group-messages">
        ${renderGroupHeader(name, timestamp)}
        ${showReasoning && thinkingMessage
          ? renderGroupedMessage(
              thinkingMessage,
              { isStreaming: true, showReasoning: true },
              onOpenSidebar,
            )
          : nothing}
        ${textMessage
          ? renderGroupedMessage(
              textMessage,
              { isStreaming: true, showReasoning: false },
              onOpenSidebar,
            )
          : nothing}
      </div>
    </div>
  `;
}

export function renderMessageGroup(
  group: MessageGroup,
  opts: {
    onOpenSidebar?: (content: string) => void;
    showReasoning: boolean;
    assistantName?: string;
    assistantAvatar?: string | null;
  },
) {
  const normalizedRole = normalizeRoleForGrouping(group.role);
  const assistantName = opts.assistantName ?? "Assistant";
  const who =
    normalizedRole === "user"
      ? "You"
      : normalizedRole === "assistant"
        ? assistantName
        : normalizedRole;
  const roleClass =
    normalizedRole === "user" ? "user" : normalizedRole === "assistant" ? "assistant" : "other";
  const timestamp = new Date(group.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return html`
    <div class="chat-group ${roleClass} ${roleClass === "user" ? "" : "chat-group--timeline"}">
      ${renderGroupLead(group.role, {
        name: assistantName,
        avatar: opts.assistantAvatar ?? null,
      })}
      <div class="chat-group-messages">
        ${roleClass === "user" ? nothing : renderGroupHeader(who, timestamp)}
        ${group.messages.map((item, index) =>
          renderGroupedMessage(
            item.message,
            {
              isStreaming: group.isStreaming && index === group.messages.length - 1,
              showReasoning: opts.showReasoning,
            },
            opts.onOpenSidebar,
          ),
        )}
        ${roleClass === "user" ? renderGroupFooter(who, timestamp) : nothing}
      </div>
    </div>
  `;
}

function renderGroupLead(role: string, assistant?: Pick<AssistantIdentity, "name" | "avatar">) {
  const normalized = normalizeRoleForGrouping(role);
  if (normalized === "user") {
    return renderUserAvatar(role, assistant);
  }
  return html`
    <div class="chat-group-rail" aria-hidden="true">
      <span class="chat-group-rail__line"></span>
      <span class="chat-group-marker ${normalized}"></span>
    </div>
  `;
}

function renderUserAvatar(role: string, assistant?: Pick<AssistantIdentity, "name" | "avatar">) {
  const normalized = normalizeRoleForGrouping(role);
  const assistantName = assistant?.name?.trim() || "Assistant";
  const assistantAvatar = assistant?.avatar?.trim() || "";
  const initial =
    normalized === "user"
      ? "U"
      : normalized === "assistant"
        ? assistantName.charAt(0).toUpperCase() || "A"
        : normalized === "tool"
          ? "⚙"
          : "?";
  const className =
    normalized === "user"
      ? "user"
      : normalized === "assistant"
        ? "assistant"
        : normalized === "tool"
          ? "tool"
          : "other";

  if (assistantAvatar && normalized === "assistant") {
    if (isAvatarUrl(assistantAvatar)) {
      return html`<img
        class="chat-avatar ${className}"
        src="${assistantAvatar}"
        alt="${assistantName}"
      />`;
    }
    return html`<div class="chat-avatar ${className}">${assistantAvatar}</div>`;
  }

  return html`<div class="chat-avatar ${className}">${initial}</div>`;
}

function renderGroupHeader(name: string, timestamp: string | null) {
  return html`
    <div class="chat-group-header">
      <span class="chat-sender-name">${name}</span>
      ${timestamp ? html`<span class="chat-group-timestamp">${timestamp}</span>` : nothing}
    </div>
  `;
}

function renderGroupFooter(name: string, timestamp: string | null) {
  return html`
    <div class="chat-group-footer">
      <span class="chat-sender-name">${name}</span>
      ${timestamp ? html`<span class="chat-group-timestamp">${timestamp}</span>` : nothing}
    </div>
  `;
}

function isAvatarUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/") // Relative paths from avatar endpoint
  );
}

function renderMessageImages(images: ImageBlock[]) {
  if (images.length === 0) {
    return nothing;
  }

  return html`
    <div class="chat-message-images">
      ${images.map(
        (img) => html`
          <img
            src=${img.url}
            alt=${img.alt ?? "Attached image"}
            class="chat-message-image"
            @click=${() => window.open(img.url, "_blank")}
          />
        `,
      )}
    </div>
  `;
}

function renderGroupedMessage(
  message: unknown,
  opts: { isStreaming: boolean; showReasoning: boolean },
  onOpenSidebar?: (content: string) => void,
) {
  if (!message || typeof message !== "object") return nothing;
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "unknown";
  const isToolResult =
    isToolResultMessage(message) ||
    role.toLowerCase() === "toolresult" ||
    role.toLowerCase() === "tool_result" ||
    typeof m.toolCallId === "string" ||
    typeof m.tool_call_id === "string";

  const toolCards = extractToolCards(message);
  const hasToolCards = toolCards.length > 0;
  const images = extractImages(message);
  const hasImages = images.length > 0;

  const extractedText = extractTextCached(message);
  // During streaming, always extract thinking for full transparency (live reasoning display).
  // After streaming completes, respect the showReasoning toggle.
  const extractedThinking =
    (opts.isStreaming || opts.showReasoning) && role === "assistant"
      ? extractThinkingCached(message)
      : null;
  const markdownBase = extractedText?.trim() ? extractedText : null;
  const reasoningMarkdown = extractedThinking ? formatReasoningMarkdown(extractedThinking) : null;
  const markdown = markdownBase;
  const canCopyMarkdown = role === "assistant" && Boolean(markdown?.trim());

  if (!markdown && hasToolCards && isToolResult) {
    return html`${toolCards.map((card) => renderToolCardSidebar(card, onOpenSidebar))}`;
  }

  // Don't return nothing if there's reasoning to show (thinking-only phase during streaming).
  if (!markdown && !reasoningMarkdown && !hasToolCards && !hasImages) {
    return nothing;
  }

  const renderBubble = (content: {
    markdown?: string | null;
    reasoning?: string | null;
    images?: ImageBlock[];
    toolCards?: typeof toolCards;
    canCopy?: boolean;
    bubbleClass?: string;
  }) => {
    const normalizedRole = normalizeRoleForGrouping(role);
    const bubbleClasses = [
      "chat-bubble",
      normalizedRole !== "user" ? "chat-bubble--timeline" : "",
      normalizedRole === "assistant" ? "chat-bubble--assistant" : "",
      normalizedRole === "tool" || isToolResult ? "chat-bubble--tool" : "",
      content.bubbleClass ?? "",
      content.canCopy ? "has-copy" : "",
      opts.isStreaming ? "streaming" : "",
      "fade-in",
    ]
      .filter(Boolean)
      .join(" ");

    return html`
      <div class="${bubbleClasses}">
        ${content.canCopy && content.markdown ? renderCopyAsMarkdownButton(content.markdown) : nothing}
        ${content.images?.length ? renderMessageImages(content.images) : nothing}
        ${content.reasoning
          ? html`<div class="chat-thinking">
              <div class="chat-thinking__label">Thinking</div>
              ${unsafeHTML(toSanitizedMarkdownHtml(content.reasoning))}
            </div>`
          : nothing}
        ${content.markdown
          ? html`<div class="chat-text">${unsafeHTML(
              opts.isStreaming
                ? toStreamingHtml(content.markdown)
                : toSanitizedMarkdownHtml(content.markdown),
            )}</div>`
          : nothing}
        ${(content.toolCards ?? []).map((card) => renderToolCardSidebar(card, onOpenSidebar))}
      </div>
    `;
  };

  if (reasoningMarkdown && markdown) {
    return html`
      ${renderBubble({
        reasoning: reasoningMarkdown,
        bubbleClass: "chat-bubble--thinking-only",
      })}
      ${renderBubble({
        markdown,
        images,
        toolCards,
        canCopy: canCopyMarkdown,
      })}
    `;
  }

  return renderBubble({
    markdown,
    reasoning: reasoningMarkdown,
    images,
    toolCards,
    canCopy: canCopyMarkdown,
  });
}
