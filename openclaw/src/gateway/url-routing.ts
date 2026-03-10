import { parseFigmaFileKey } from "./figma-rest-audit.js";

const FIGMA_URL_RE = /\bhttps?:\/\/(?:www\.)?figma\.com\/[^\s)]+/i;
const BASECAMP_URL_RE = /\bhttps?:\/\/(?:\d+\.)?basecamp\.com\/[^\s)]+/i;

type BasecampUrlDetails = {
  accountId: string | null;
  bucketId: string | null;
  cardId: string | null;
  recordingId: string | null;
  cardPath: string | null;
};

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

export function parseBasecampUrlDetails(url: string | null | undefined): BasecampUrlDetails {
  if (typeof url !== "string" || !url.trim()) {
    return {
      accountId: null,
      bucketId: null,
      cardId: null,
      recordingId: null,
      cardPath: null,
    };
  }

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const accountId = /^\d+$/.test(segments[0] ?? "") ? segments[0] : null;
    const bucketIndex = segments.indexOf("buckets");
    const bucketId =
      bucketIndex >= 0 && /^\d+$/.test(segments[bucketIndex + 1] ?? "")
        ? segments[bucketIndex + 1]
        : null;
    const cardTablesIndex = segments.indexOf("card_tables");
    const cardId =
      cardTablesIndex >= 0 &&
      segments[cardTablesIndex + 1] === "cards" &&
      /^\d+$/.test(segments[cardTablesIndex + 2] ?? "")
        ? segments[cardTablesIndex + 2]
        : null;
    const recordingId = parsed.hash.match(/^#__recording_(\d+)$/i)?.[1] ?? null;
    return {
      accountId,
      bucketId,
      cardId,
      recordingId,
      cardPath:
        bucketId && cardId ? `/buckets/${bucketId}/card_tables/cards/${cardId}` : null,
    };
  } catch {
    return {
      accountId: null,
      bucketId: null,
      cardId: null,
      recordingId: null,
      cardPath: null,
    };
  }
}

export function inspectWorkspaceChatUrls(text: string | null | undefined): {
  figmaUrl: string | null;
  figmaFileKey: string | null;
  basecampUrl: string | null;
  basecampAccountId: string | null;
  basecampBucketId: string | null;
  basecampCardId: string | null;
  basecampRecordingId: string | null;
  basecampCardPath: string | null;
} {
  const figmaUrl = extractFirstFigmaUrl(text);
  const basecampUrl = extractFirstBasecampUrl(text);
  const basecampDetails = parseBasecampUrlDetails(basecampUrl);
  return {
    figmaUrl,
    figmaFileKey: parseFigmaFileKey(figmaUrl),
    basecampUrl,
    basecampAccountId: basecampDetails.accountId,
    basecampBucketId: basecampDetails.bucketId,
    basecampCardId: basecampDetails.cardId,
    basecampRecordingId: basecampDetails.recordingId,
    basecampCardPath: basecampDetails.cardPath,
  };
}
