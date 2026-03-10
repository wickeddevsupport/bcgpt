import { parseFigmaFileKey } from "./figma-rest-audit.js";

const FIGMA_URL_RE = /\bhttps?:\/\/(?:www\.)?figma\.com\/[^\s)]+/i;
const BASECAMP_URL_RE = /\bhttps?:\/\/(?:\d+\.)?basecamp\.com\/[^\s)]+/i;

function extractFirstMatch(pattern: RegExp, text: string | null | undefined): string | null {
  if (typeof text !== "string") {
    return null;
  }
  const match = text.match(pattern);
  const value = match?.[0]?.trim();
  return value ? value : null;
}

export function extractFirstFigmaUrl(text: string | null | undefined): string | null {
  return extractFirstMatch(FIGMA_URL_RE, text);
}

export function extractFirstBasecampUrl(text: string | null | undefined): string | null {
  return extractFirstMatch(BASECAMP_URL_RE, text);
}

export function inspectWorkspaceChatUrls(text: string | null | undefined): {
  figmaUrl: string | null;
  figmaFileKey: string | null;
  basecampUrl: string | null;
} {
  const figmaUrl = extractFirstFigmaUrl(text);
  return {
    figmaUrl,
    figmaFileKey: parseFigmaFileKey(figmaUrl),
    basecampUrl: extractFirstBasecampUrl(text),
  };
}
