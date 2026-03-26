import { detectMime } from "../media/mime.js";
import {
  extractFileContentFromSource,
  DEFAULT_INPUT_FILE_MAX_BYTES,
  DEFAULT_INPUT_FILE_MAX_CHARS,
  DEFAULT_INPUT_PDF_MAX_PAGES,
  DEFAULT_INPUT_PDF_MAX_PIXELS,
  DEFAULT_INPUT_PDF_MIN_TEXT_CHARS,
} from "../media/input-files.js";

export type ChatAttachment = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content?: unknown;
};

export type ChatImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type ParsedMessageWithImages = {
  message: string;
  images: ChatImageContent[];
};

type AttachmentLog = {
  warn: (message: string) => void;
};

function normalizeMime(mime?: string): string | undefined {
  if (!mime) {
    return undefined;
  }
  const cleaned = mime.split(";")[0]?.trim().toLowerCase();
  return cleaned || undefined;
}

async function sniffMimeFromBase64(base64: string): Promise<string | undefined> {
  const trimmed = base64.trim();
  if (!trimmed) {
    return undefined;
  }

  const take = Math.min(256, trimmed.length);
  const sliceLen = take - (take % 4);
  if (sliceLen < 8) {
    return undefined;
  }

  try {
    const head = Buffer.from(trimmed.slice(0, sliceLen), "base64");
    return await detectMime({ buffer: head });
  } catch {
    return undefined;
  }
}

function isImageMime(mime?: string): boolean {
  return typeof mime === "string" && mime.startsWith("image/");
}

const FILE_LIMITS = {
  allowUrl: false,
  allowedMimes: new Set([
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/html",
    "text/csv",
    "application/json",
    "text/javascript",
    "text/typescript",
    "text/x-python",
    "text/x-java",
    "text/x-c",
    "text/x-c++",
    "text/x-go",
    "text/x-ruby",
    "text/x-rust",
    "text/x-sh",
    "text/x-sql",
    "text/xml",
    "application/xml",
    "text/yaml",
    "application/x-yaml",
  ]),
  maxBytes: 20 * 1024 * 1024, // 20 MB
  maxChars: 500_000, // ~500K chars extracted text
  maxRedirects: 0,
  timeoutMs: 0,
  pdf: {
    maxPages: 50, // up to 50 pages
    maxPixels: DEFAULT_INPUT_PDF_MAX_PIXELS,
    minTextChars: DEFAULT_INPUT_PDF_MIN_TEXT_CHARS,
  },
};

function isFileMime(mime: string): boolean {
  return (
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/x-yaml" ||
    mime.includes("script") ||
    mime.includes("python") ||
    mime.includes("java") ||
    mime.includes("ruby") ||
    mime.includes("sql")
  );
}

function mimeFromExtension(filename?: string): string | undefined {
  if (!filename || !filename.includes(".")) return undefined;
  const ext = filename.split(".").pop()!.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "json") return "application/json";
  if (ext === "xml") return "application/xml";
  if (ext === "yaml" || ext === "yml") return "text/yaml";
  const textExts = new Set([
    "txt", "md", "markdown", "html", "htm", "css",
    "js", "jsx", "ts", "tsx", "py", "rb", "go",
    "java", "c", "cpp", "h", "cs", "php", "swift",
    "kt", "rs", "sh", "bash", "zsh", "sql", "toml",
    "ini", "env", "config", "csv",
  ]);
  if (textExts.has(ext)) return "text/plain";
  return undefined;
}

/**
 * Parse attachments and extract images and file text content.
 * - Images → structured image content blocks passed to the model vision input
 * - PDFs → text extracted (+ page images if text-sparse) prepended to the message
 * - Text/code files → content prepended to the message as code blocks
 */
export async function parseMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number; log?: AttachmentLog },
): Promise<ParsedMessageWithImages> {
  const maxBytes = opts?.maxBytes ?? 5_000_000; // 5 MB
  const log = opts?.log;
  if (!attachments || attachments.length === 0) {
    return { message, images: [] };
  }

  const images: ChatImageContent[] = [];
  const fileTextParts: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const mime = att.mimeType ?? "";
    const content = att.content;
    const label = att.fileName || att.type || `attachment-${idx + 1}`;

    if (typeof content !== "string") {
      throw new Error(`attachment ${label}: content must be base64 string`);
    }

    let b64 = content.trim();
    // Strip data URL prefix if present (e.g., "data:image/jpeg;base64,...")
    const dataUrlMatch = /^data:[^;]+;base64,(.*)$/.exec(b64);
    if (dataUrlMatch) {
      b64 = dataUrlMatch[1];
    }
    // Basic base64 sanity: length multiple of 4 and charset check.
    if (b64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(b64)) {
      throw new Error(`attachment ${label}: invalid base64 content`);
    }
    let sizeBytes = 0;
    try {
      sizeBytes = Buffer.from(b64, "base64").byteLength;
    } catch {
      throw new Error(`attachment ${label}: invalid base64 content`);
    }
    if (sizeBytes <= 0 || sizeBytes > maxBytes) {
      throw new Error(`attachment ${label}: exceeds size limit (${sizeBytes} > ${maxBytes} bytes)`);
    }

    const providedMime = normalizeMime(mime);
    const extMime = mimeFromExtension(att.fileName);
    const sniffedMime = normalizeMime(await sniffMimeFromBase64(b64));
    // Prefer sniffed > provided > extension-inferred
    const resolvedMime = sniffedMime ?? providedMime ?? extMime ?? "";

    // Route PDFs and text/code files through the file extractor
    // Use extension-inferred MIME as fallback for code files with unknown browser MIME
    const fileRouteMime = isFileMime(resolvedMime)
      ? resolvedMime
      : extMime && isFileMime(extMime)
        ? extMime
        : providedMime && isFileMime(providedMime)
          ? providedMime
          : null;

    if (fileRouteMime) {
      const limits = {
        ...FILE_LIMITS,
        allowedMimes: new Set([...FILE_LIMITS.allowedMimes, fileRouteMime]),
      };
      try {
        const extracted = await extractFileContentFromSource({
          source: { type: "base64", data: b64, mediaType: fileRouteMime, filename: label },
          limits,
        });
        if (extracted.text) {
          const ext = label.includes(".") ? label.split(".").pop()! : "";
          fileTextParts.push(`--- File: ${label} ---\n\`\`\`${ext}\n${extracted.text}\n\`\`\``);
        }
        if (extracted.images) {
          images.push(...extracted.images);
        }
      } catch (err) {
        log?.warn(`attachment ${label}: file extraction failed — ${String(err)}`);
      }
      continue;
    }

    // Image handling
    if (sniffedMime && !isImageMime(sniffedMime)) {
      log?.warn(`attachment ${label}: detected non-image (${sniffedMime}), dropping`);
      continue;
    }
    if (!sniffedMime && !isImageMime(providedMime)) {
      log?.warn(`attachment ${label}: unable to detect image mime type, dropping`);
      continue;
    }
    if (sniffedMime && providedMime && sniffedMime !== providedMime) {
      log?.warn(
        `attachment ${label}: mime mismatch (${providedMime} -> ${sniffedMime}), using sniffed`,
      );
    }

    images.push({
      type: "image",
      data: b64,
      mimeType: sniffedMime ?? providedMime ?? mime,
    });
  }

  const updatedMessage =
    fileTextParts.length > 0
      ? [message, ...fileTextParts].filter(Boolean).join("\n\n")
      : message;

  return { message: updatedMessage, images };
}

/**
 * @deprecated Use parseMessageWithAttachments instead.
 * This function converts images to markdown data URLs which Claude API cannot process as images.
 */
export function buildMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number },
): string {
  const maxBytes = opts?.maxBytes ?? 2_000_000; // 2 MB
  if (!attachments || attachments.length === 0) {
    return message;
  }

  const blocks: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }
    const mime = att.mimeType ?? "";
    const content = att.content;
    const label = att.fileName || att.type || `attachment-${idx + 1}`;

    if (typeof content !== "string") {
      throw new Error(`attachment ${label}: content must be base64 string`);
    }
    if (!mime.startsWith("image/")) {
      throw new Error(`attachment ${label}: only image/* supported`);
    }

    let sizeBytes = 0;
    const b64 = content.trim();
    // Basic base64 sanity: length multiple of 4 and charset check.
    if (b64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(b64)) {
      throw new Error(`attachment ${label}: invalid base64 content`);
    }
    try {
      sizeBytes = Buffer.from(b64, "base64").byteLength;
    } catch {
      throw new Error(`attachment ${label}: invalid base64 content`);
    }
    if (sizeBytes <= 0 || sizeBytes > maxBytes) {
      throw new Error(`attachment ${label}: exceeds size limit (${sizeBytes} > ${maxBytes} bytes)`);
    }

    const safeLabel = label.replace(/\s+/g, "_");
    const dataUrl = `![${safeLabel}](data:${mime};base64,${content})`;
    blocks.push(dataUrl);
  }

  if (blocks.length === 0) {
    return message;
  }
  const separator = message.trim().length > 0 ? "\n\n" : "";
  return `${message}${separator}${blocks.join("\n\n")}`;
}
