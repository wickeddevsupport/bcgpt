const BASECAMP_URL_RE = /\bhttps?:\/\/(?:\d+\.)?basecamp\.com\/[^\s)]+/i;

function extractFirstBasecampUrl(text) {
  const source = String(text ?? "");
  const match = source.match(BASECAMP_URL_RE);
  return match?.[0]?.trim() || null;
}

function extractLabeledNumber(text, label) {
  const source = String(text ?? "");
  const match = source.match(new RegExp(`${label}\\s*:\\s*(\\d+)`, "i"));
  return match?.[1] || null;
}

function extractCardPath(text) {
  const source = String(text ?? "");
  const match = source.match(/Exact Basecamp card path\s*:\s*(\/buckets\/\d+\/card_tables\/cards\/\d+)/i);
  return match?.[1] || null;
}

function parseBasecampUrlDetails(url) {
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

export function extractSmartActionBasecampTarget(text) {
  const url = extractFirstBasecampUrl(text);
  const parsed = parseBasecampUrlDetails(url);
  const accountId = extractLabeledNumber(text, "Basecamp account_id") || parsed.accountId;
  const bucketId = extractLabeledNumber(text, "Basecamp bucket_id") || parsed.bucketId;
  const cardId = extractLabeledNumber(text, "Basecamp card_id") || parsed.cardId;
  const recordingId =
    extractLabeledNumber(text, "Basecamp recording_id") || parsed.recordingId;
  const cardPath = extractCardPath(text) || parsed.cardPath;

  return {
    url,
    accountId: accountId ? Number(accountId) : null,
    bucketId: bucketId ? Number(bucketId) : null,
    cardId: cardId ? Number(cardId) : null,
    recordingId: recordingId ? Number(recordingId) : null,
    commentId: recordingId ? Number(recordingId) : null,
    cardPath,
    hasExactCardTarget: Boolean(bucketId && cardId),
    hasExactResource: Boolean(
      url || cardPath || (bucketId && cardId) || (bucketId && recordingId)
    ),
  };
}
