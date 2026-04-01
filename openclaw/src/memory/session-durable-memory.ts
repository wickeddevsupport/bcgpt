import path from "node:path";

export type ResolvedSessionDurableFactsConfig = {
  enabled: boolean;
  generatedDir: string;
  maxFactsPerSession: number;
  minChars: number;
  includeCompactions: boolean;
};

export type ResolvedSessionMemoryConfig = {
  includeAssistant: boolean;
  recentTurns: number;
  durableFacts: ResolvedSessionDurableFactsConfig;
};

type SessionMessage = {
  role: "user" | "assistant";
  text: string;
};

export type SessionDurableMemoryExtraction = {
  sessionId: string;
  sessionPath: string;
  sessionIndexText: string;
  durableMemoryText: string | null;
  stats: {
    recentTurns: number;
    durableFacts: number;
    compactions: number;
  };
};

const USER_DURABLE_RE =
  /\b(?:i|we)\s+(?:need|want|prefer|decided|will|should|must|won't|cannot|can't|need to)\b|\b(?:don't|do not|never|always|make sure|use|keep|avoid|fix|implement|enable|disable|preserve)\b/i;
const ASSISTANT_DURABLE_RE =
  /\b(?:decision|decided|plan|next step|constraint|requirement|preference|status|blocked|remaining|use|avoid|must|should|will|deployed|fallback|preserve)\b/i;
const NOISE_RE =
  /^(?:hi|hello|hey|thanks|thank you|ok|okay|sure|done|great|sounds good|working on it|let me check|i'?ll check|i'?ll do that)\b/i;

export function extractSessionDurableMemory(params: {
  raw: string;
  sessionPath: string;
  config: ResolvedSessionMemoryConfig;
}): SessionDurableMemoryExtraction {
  const sessionId = path.basename(params.sessionPath, path.extname(params.sessionPath));
  const messages: SessionMessage[] = [];
  const compactions: string[] = [];
  const durableFacts: string[] = [];
  const seenFacts = new Set<string>();

  for (const line of params.raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!record || typeof record !== "object") {
      continue;
    }

    const type = (record as { type?: unknown }).type;
    if (type === "compaction") {
      const summary = normalizeText((record as { summary?: unknown }).summary);
      if (summary && params.config.durableFacts.includeCompactions) {
        compactions.push(summary);
      }
      continue;
    }

    const message = (record as { message?: unknown }).message as
      | { role?: unknown; content?: unknown }
      | undefined;
    if (!message || (message.role !== "user" && message.role !== "assistant")) {
      continue;
    }

    const text = extractText(message.content);
    if (!text) {
      continue;
    }
    const role = message.role;
    messages.push({ role, text });

    const durable = pickDurableFact({
      role,
      text,
      includeAssistant: params.config.includeAssistant,
      minChars: params.config.durableFacts.minChars,
    });
    if (!durable) {
      continue;
    }
    const key = durable.toLowerCase();
    if (seenFacts.has(key)) {
      continue;
    }
    seenFacts.add(key);
    durableFacts.push(durable);
  }

  const recentTurns = selectRecentTurns(messages, params.config.recentTurns);
  const cappedFacts = durableFacts.slice(0, params.config.durableFacts.maxFactsPerSession);

  const sessionIndexText = buildSessionIndexText({
    sessionId,
    sessionPath: params.sessionPath,
    recentTurns,
    durableFacts: cappedFacts,
    compactions,
  });
  const durableMemoryText =
    params.config.durableFacts.enabled && (cappedFacts.length > 0 || compactions.length > 0)
      ? buildDurableMemoryText({
          sessionId,
          sessionPath: params.sessionPath,
          durableFacts: cappedFacts,
          compactions,
        })
      : null;

  return {
    sessionId,
    sessionPath: params.sessionPath,
    sessionIndexText,
    durableMemoryText,
    stats: {
      recentTurns: recentTurns.length,
      durableFacts: cappedFacts.length,
      compactions: compactions.length,
    },
  };
}

function extractText(content: unknown): string | null {
  if (typeof content === "string") {
    return normalizeText(content);
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const record = block as { type?: unknown; text?: unknown };
    if (record.type !== "text" || typeof record.text !== "string") {
      continue;
    }
    const normalized = normalizeText(record.text);
    if (normalized) {
      parts.push(normalized);
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\[.*?\]\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > 420 ? `${trimmed.slice(0, 417)}...` : trimmed;
}

function pickDurableFact(params: {
  role: "user" | "assistant";
  text: string;
  includeAssistant: boolean;
  minChars: number;
}): string | null {
  if (params.text.length < params.minChars || NOISE_RE.test(params.text)) {
    return null;
  }
  if (params.role === "assistant" && !params.includeAssistant) {
    return null;
  }
  const matches =
    params.role === "user" ? USER_DURABLE_RE.test(params.text) : ASSISTANT_DURABLE_RE.test(params.text);
  if (!matches) {
    return null;
  }
  const prefix = params.role === "user" ? "User requirement" : "Assistant decision";
  return `${prefix}: ${params.text}`;
}

function selectRecentTurns(messages: SessionMessage[], recentTurns: number): SessionMessage[] {
  if (recentTurns <= 0 || messages.length === 0) {
    return [];
  }
  return messages.slice(-recentTurns);
}

function buildSessionIndexText(params: {
  sessionId: string;
  sessionPath: string;
  recentTurns: SessionMessage[];
  durableFacts: string[];
  compactions: string[];
}): string {
  const refLabel = looksLikeFilePath(params.sessionPath) ? "Transcript" : "Session reference";
  const lines = [
    `Session: ${params.sessionId}`,
    `${refLabel}: ${params.sessionPath}`,
  ];
  if (params.compactions.length > 0) {
    lines.push("Compaction summaries:");
    for (const summary of params.compactions.slice(0, 6)) {
      lines.push(`- ${summary}`);
    }
  }
  if (params.durableFacts.length > 0) {
    lines.push("Durable facts:");
    for (const fact of params.durableFacts) {
      lines.push(`- ${fact}`);
    }
  }
  if (params.recentTurns.length > 0) {
    lines.push("Recent turns:");
    for (const turn of params.recentTurns) {
      lines.push(`- ${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`);
    }
  }
  return lines.join("\n");
}

function buildDurableMemoryText(params: {
  sessionId: string;
  sessionPath: string;
  durableFacts: string[];
  compactions: string[];
}): string {
  const refLabel = looksLikeFilePath(params.sessionPath)
    ? "Source transcript"
    : "Session reference";
  const lines = [
    `# Durable Session Memory: ${params.sessionId}`,
    "",
    `${refLabel}: ${params.sessionPath}`,
  ];
  if (params.durableFacts.length > 0) {
    lines.push("", "## Decisions, Requirements, And Preferences");
    for (const fact of params.durableFacts) {
      lines.push(`- ${fact}`);
    }
  }
  if (params.compactions.length > 0) {
    lines.push("", "## Compaction Summaries");
    for (const summary of params.compactions.slice(0, 10)) {
      lines.push(`- ${summary}`);
    }
  }
  return lines.join("\n");
}

/** Returns true if the value looks like a file path rather than a bare session key. */
function looksLikeFilePath(value: string): boolean {
  return /[/\\]/.test(value) || /\.[a-z]{1,6}$/i.test(value);
}
