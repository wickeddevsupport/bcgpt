import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { AssistantIdentity } from "../assistant-identity.ts";
import type { MessageGroup } from "../types/chat-types.ts";
import { stripThinkingTags } from "../format.ts";
import { toSanitizedMarkdownHtml, toStreamingHtml } from "../markdown.ts";
import { renderCopyAsMarkdownButton } from "./copy-as-markdown.ts";
import { isTtsSupported, speakText } from "../app-voice.ts";
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

type VideoEmbed = { src: string; title: string };

const YT_PATTERNS = [
  /https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:[^#\s"')]*&)?v=([a-zA-Z0-9_-]{11})/g,
  /https?:\/\/youtu\.be\/([a-zA-Z0-9_-]{11})/g,
  /https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/g,
];
const VIMEO_PATTERN = /https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/g;

function extractVideoEmbeds(text: string): VideoEmbed[] {
  const embeds: VideoEmbed[] = [];
  const seen = new Set<string>();

  for (const pattern of YT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const id = match[1];
      if (id && !seen.has(id)) {
        seen.add(id);
        embeds.push({
          src: `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`,
          title: "YouTube video",
        });
      }
    }
  }

  VIMEO_PATTERN.lastIndex = 0;
  let match;
  while ((match = VIMEO_PATTERN.exec(text)) !== null) {
    const id = match[1];
    if (id && !seen.has(`vimeo:${id}`)) {
      seen.add(`vimeo:${id}`);
      embeds.push({
        src: `https://player.vimeo.com/video/${id}`,
        title: "Vimeo video",
      });
    }
  }

  return embeds;
}

function renderVideoEmbed(embed: VideoEmbed) {
  return html`
    <div class="chat-video-embed">
      <iframe
        src="${embed.src}"
        title="${embed.title}"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        loading="lazy"
      ></iframe>
    </div>
  `;
}

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
    contextWindow?: number | null;
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
  const meta = extractGroupMeta(group, opts.contextWindow ?? null);

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
        ${roleClass === "user"
          ? renderGroupFooter(who, timestamp)
          : renderGroupFooter(who, timestamp, meta)}
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

type GroupMeta = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  model: string | null;
  contextPercent: number | null;
};

function extractGroupMeta(group: MessageGroup, contextWindow: number | null): GroupMeta | null {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let model: string | null = null;
  let hasUsage = false;

  for (const { message } of group.messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const m = message as Record<string, unknown>;
    if (m.role !== "assistant") {
      continue;
    }
    const usage = m.usage as Record<string, number> | undefined;
    if (usage) {
      hasUsage = true;
      input += usage.input ?? usage.inputTokens ?? 0;
      output += usage.output ?? usage.outputTokens ?? 0;
      cacheRead += usage.cacheRead ?? usage.cache_read_input_tokens ?? 0;
      cacheWrite += usage.cacheWrite ?? usage.cache_creation_input_tokens ?? 0;
    }
    const c = m.cost as Record<string, number> | undefined;
    if (typeof c?.total === "number") {
      cost += c.total;
    }
    if (typeof m.model === "string" && m.model !== "gateway-injected") {
      model = m.model;
    }
  }

  if (!hasUsage && !model) {
    return null;
  }

  const contextPercent =
    contextWindow && input > 0 ? Math.min(Math.round((input / contextWindow) * 100), 100) : null;

  return { input, output, cacheRead, cacheWrite, cost, model, contextPercent };
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

function renderMessageMeta(meta: GroupMeta | null) {
  if (!meta) {
    return nothing;
  }

  const parts: Array<ReturnType<typeof html>> = [];

  if (meta.input) {
    parts.push(html`<span class="msg-meta__tokens">↑${fmtTokens(meta.input)}</span>`);
  }
  if (meta.output) {
    parts.push(html`<span class="msg-meta__tokens">↓${fmtTokens(meta.output)}</span>`);
  }
  if (meta.cacheRead) {
    parts.push(html`<span class="msg-meta__cache">R${fmtTokens(meta.cacheRead)}</span>`);
  }
  if (meta.cacheWrite) {
    parts.push(html`<span class="msg-meta__cache">W${fmtTokens(meta.cacheWrite)}</span>`);
  }
  if (meta.cost > 0) {
    parts.push(html`<span class="msg-meta__cost">$${meta.cost.toFixed(4)}</span>`);
  }
  if (meta.contextPercent !== null) {
    const pct = meta.contextPercent;
    const cls =
      pct >= 90
        ? "msg-meta__ctx msg-meta__ctx--danger"
        : pct >= 75
          ? "msg-meta__ctx msg-meta__ctx--warn"
          : "msg-meta__ctx";
    parts.push(html`<span class="${cls}">${pct}% ctx</span>`);
  }
  if (meta.model) {
    const shortModel = meta.model.includes("/") ? meta.model.split("/").pop()! : meta.model;
    parts.push(html`<span class="msg-meta__model">${shortModel}</span>`);
  }

  if (parts.length === 0) {
    return nothing;
  }

  return html`<span class="msg-meta">${parts}</span>`;
}

function renderGroupFooter(name: string, timestamp: string | null, meta?: GroupMeta | null) {
  return html`
    <div class="chat-group-footer">
      <span class="chat-sender-name">${name}</span>
      ${timestamp ? html`<span class="chat-group-timestamp">${timestamp}</span>` : nothing}
      ${renderMessageMeta(meta ?? null)}
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
  // Only embed videos for final (non-streaming) assistant messages
  const videoEmbeds = !opts.isStreaming && role === "assistant" && markdown
    ? extractVideoEmbeds(markdown)
    : [];

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
    videoEmbeds?: VideoEmbed[];
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
        ${content.canCopy && content.markdown && isTtsSupported()
          ? html`<button class="chat-copy-btn chat-speak-btn" type="button" title="Read aloud" aria-label="Read aloud"
              @click=${() => speakText(content.markdown!, { requireEnabled: false })}>
              <span class="chat-copy-btn__icon" aria-hidden="true">${html`<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`}</span>
            </button>`
          : nothing}
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
        ${(content.videoEmbeds ?? []).map((embed) => renderVideoEmbed(embed))}
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
        videoEmbeds,
      })}
    `;
  }

  return renderBubble({
    markdown,
    reasoning: reasoningMarkdown,
    images,
    toolCards,
    canCopy: canCopyMarkdown,
    videoEmbeds,
  });
}
