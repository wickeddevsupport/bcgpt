import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { z } from "zod";
import { resolveSessionAgentId } from "../../src/agents/agent-scope.js";
import {
  resolveMemorySearchConfig,
  type ResolvedMemorySearchConfig,
} from "../../src/agents/memory-search.js";
import { loadEffectiveWorkspaceConfig } from "../../src/gateway/workspace-config.js";
import {
  extractSessionDurableMemory,
  type ResolvedSessionMemoryConfig,
} from "../../src/memory/session-durable-memory.js";
import {
  getMemorySearchManager,
  type MemorySearchManagerResult,
  type MemorySearchResult,
} from "../../src/memory/index.js";
import type {
  PluginHookAgentContext,
  PluginHookAgentEndEvent,
  PluginHookBeforeAgentStartEvent,
  PluginHookBeforeAgentStartResult,
  PluginLogger,
} from "../../src/plugins/types.js";
import { resolveUserPath } from "../../src/utils.js";

const WORKSPACE_PATH_RE = /(?:^|[\\/])workspaces[\\/]([^\\/]+)(?:[\\/]|$)/i;
const DEFAULT_CAPTURE_DIR = "memory/pmos-smart-memory";
const DEFAULT_RECALL_MAX_RESULTS = 3;
const RECALL_OVERFETCH_MULTIPLIER = 3;
const DEFAULT_RECALL_MIN_SCORE = 0.35;
const DEFAULT_RECALL_MAX_CHARS = 1600;
const DEFAULT_RECALL_MIN_QUERY_CHARS = 20;
const MAX_SESSION_KEY_CHARS = 96;

/** Paths containing this segment are PMOS smart-memory output and must not be recalled. */
const PMOS_MEMORY_PATH_SEGMENT = "pmos-smart-memory";

/**
 * Patterns that indicate injected/synthetic text which must be stripped before
 * durable fact extraction to prevent memory-on-memory contamination.
 */
const INJECTED_BLOCK_PATTERNS: RegExp[] = [
  // Recall blocks injected by this plugin or similar recall systems
  /Relevant workspace memory:[\s\S]*?(?=\n{2,}|$)/gi,
  // Untrusted content wrappers
  /<<<EXTERNAL_UNTRUSTED_CONTENT>>>[\s\S]*?<<<\/EXTERNAL_UNTRUSTED_CONTENT>>>/gi,
  /\[UNTRUSTED\][\s\S]*?\[\/UNTRUSTED\]/gi,
  // Standalone UNTRUSTED markers and surrounding block
  /^\s*UNTRUSTED\b[^\n]*$/gim,
];

const rawPluginConfigSchema = z.object({
  enabled: z.boolean().optional(),
  recall: z
    .object({
      enabled: z.boolean().optional(),
      maxResults: z.number().int().positive().max(8).optional(),
      minScore: z.number().min(0).max(1).optional(),
      maxChars: z.number().int().positive().max(12_000).optional(),
      minQueryChars: z.number().int().positive().max(4_000).optional(),
    })
    .optional(),
  capture: z
    .object({
      enabled: z.boolean().optional(),
      directory: z.string().trim().min(1).optional(),
    })
    .optional(),
});

export type PmosSmartMemoryConfig = {
  enabled: boolean;
  recall: {
    enabled: boolean;
    maxResults: number;
    minScore: number;
    maxChars: number;
    minQueryChars: number;
  };
  capture: {
    enabled: boolean;
    directory: string;
  };
};

export const pluginConfigSchema = {
  parse(value: unknown): PmosSmartMemoryConfig {
    return resolvePmosSmartMemoryConfig(value);
  },
  safeParse(value: unknown) {
    const raw = rawPluginConfigSchema.safeParse(value ?? {});
    if (!raw.success) {
      return {
        success: false,
        error: {
          issues: raw.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
      };
    }
    return {
      success: true,
      data: resolvePmosSmartMemoryConfig(raw.data),
    };
  },
  uiHints: {
    enabled: {
      label: "Enable PMOS Smart Memory",
      help: "Turn on workspace-scoped auto-recall and durable fact capture for PMOS chats.",
    },
    "recall.maxResults": {
      label: "Auto-Recall Results",
      help: "Maximum memory snippets to prepend before the agent starts.",
      advanced: true,
    },
    "recall.minScore": {
      label: "Auto-Recall Minimum Score",
      help: "Lower values recall more aggressively; higher values are stricter.",
      advanced: true,
    },
    "recall.maxChars": {
      label: "Auto-Recall Character Budget",
      advanced: true,
    },
    "recall.minQueryChars": {
      label: "Minimum Query Length",
      advanced: true,
    },
    "capture.directory": {
      label: "Capture Directory",
      help: "Relative to the agent workspace unless an absolute path or ~ path is provided.",
      advanced: true,
    },
  },
};

export type PmosSmartMemoryDeps = {
  loadWorkspaceConfig: (workspaceId: string) => Promise<OpenClawConfig>;
  getMemoryManager: (params: {
    cfg: OpenClawConfig;
    agentId: string;
  }) => Promise<MemorySearchManagerResult>;
  mkdir: typeof fs.mkdir;
  writeFile: typeof fs.writeFile;
  rm: typeof fs.rm;
  now: () => number;
};

type WorkspaceRuntimeContext = {
  workspaceId: string;
  workspaceDir: string;
  cfg: OpenClawConfig;
  agentId: string;
};

const defaultDeps: PmosSmartMemoryDeps = {
  loadWorkspaceConfig: async (workspaceId) =>
    (await loadEffectiveWorkspaceConfig(workspaceId)) as OpenClawConfig,
  getMemoryManager: getMemorySearchManager,
  mkdir: fs.mkdir,
  writeFile: fs.writeFile,
  rm: fs.rm,
  now: () => Date.now(),
};

export function resolvePmosSmartMemoryConfig(value: unknown): PmosSmartMemoryConfig {
  const raw = rawPluginConfigSchema.parse(value ?? {});
  return {
    enabled: raw.enabled ?? false,
    recall: {
      enabled: raw.recall?.enabled ?? true,
      maxResults: raw.recall?.maxResults ?? DEFAULT_RECALL_MAX_RESULTS,
      minScore: raw.recall?.minScore ?? DEFAULT_RECALL_MIN_SCORE,
      maxChars: raw.recall?.maxChars ?? DEFAULT_RECALL_MAX_CHARS,
      minQueryChars: raw.recall?.minQueryChars ?? DEFAULT_RECALL_MIN_QUERY_CHARS,
    },
    capture: {
      enabled: raw.capture?.enabled ?? true,
      directory: raw.capture?.directory?.trim() || DEFAULT_CAPTURE_DIR,
    },
  };
}

export function createBeforeAgentStartHandler(params: {
  config: PmosSmartMemoryConfig;
  logger?: PluginLogger;
  deps?: Partial<PmosSmartMemoryDeps>;
}) {
  const deps = { ...defaultDeps, ...params.deps };

  return async (
    event: PluginHookBeforeAgentStartEvent,
    ctx: PluginHookAgentContext,
  ): Promise<PluginHookBeforeAgentStartResult | void> => {
    if (!params.config.enabled || !params.config.recall.enabled) {
      return;
    }

    try {
      const query = normalizeRecallQuery(event.prompt, params.config.recall.minQueryChars);
      if (!query) {
        return;
      }

      const runtime = await resolveWorkspaceRuntimeContext(ctx, deps);
      if (!runtime) {
        return;
      }

      const memorySearchConfig = resolveMemorySearchConfig(runtime.cfg, runtime.agentId);
      if (!memorySearchConfig) {
        return;
      }

      const { manager } = await deps.getMemoryManager({
        cfg: runtime.cfg,
        agentId: runtime.agentId,
      });
      if (!manager) {
        return;
      }

      // Over-fetch to compensate for PMOS smart-memory results that will be filtered out
      const rawResults = await manager.search(query, {
        maxResults: params.config.recall.maxResults * RECALL_OVERFETCH_MULTIPLIER,
        minScore: params.config.recall.minScore,
        sessionKey: ctx.sessionKey,
      });
      // Exclude PMOS smart-memory output, then trim to the requested limit
      const results = filterRecallResults(rawResults).slice(
        0,
        params.config.recall.maxResults,
      );
      const prependContext = renderRecallContext(results, params.config.recall.maxChars);
      if (!prependContext) {
        return;
      }

      return { prependContext };
    } catch (err) {
      params.logger?.warn?.(`[pmos-smart-memory] auto-recall skipped: ${describeError(err)}`);
      return;
    }
  };
}

export function createAgentEndHandler(params: {
  config: PmosSmartMemoryConfig;
  logger?: PluginLogger;
  deps?: Partial<PmosSmartMemoryDeps>;
}) {
  const deps = { ...defaultDeps, ...params.deps };

  return async (event: PluginHookAgentEndEvent, ctx: PluginHookAgentContext): Promise<void> => {
    if (!params.config.enabled || !params.config.capture.enabled) {
      return;
    }

    // Skip capture on failed/aborted/partial turns to avoid junk facts
    if (!event.success) {
      return;
    }

    try {
      const runtime = await resolveWorkspaceRuntimeContext(ctx, deps);
      if (!runtime) {
        return;
      }

      const memorySearchConfig = resolveMemorySearchConfig(runtime.cfg, runtime.agentId);
      if (!memorySearchConfig) {
        return;
      }

      const raw = serializeAgentMessages(event.messages, { stripInjected: true });
      const captureDir = resolveCaptureDirectory(
        runtime.workspaceDir,
        params.config.capture.directory,
      );
      const capturePath = path.join(captureDir, `${sanitizeSessionKey(ctx.sessionKey)}.md`);

      if (!raw) {
        await deps.rm(capturePath, { force: true });
        await syncMemoryIndex(runtime, deps, params.logger);
        return;
      }

      const extraction = extractSessionDurableMemory({
        raw,
        sessionPath: sanitizeSessionKey(ctx.sessionKey),
        config: buildSessionMemoryConfig(memorySearchConfig),
      });

      if (!extraction.durableMemoryText) {
        await deps.rm(capturePath, { force: true });
        await syncMemoryIndex(runtime, deps, params.logger);
        return;
      }

      await deps.mkdir(captureDir, { recursive: true });
      const content = buildCapturedMemoryDocument({
        workspaceId: runtime.workspaceId,
        sessionKey: ctx.sessionKey,
        generatedAt: new Date(deps.now()).toISOString(),
        durableMemoryText: cleanDurableMemoryText(extraction.durableMemoryText),
      });
      await deps.writeFile(capturePath, content, "utf-8");
      await syncMemoryIndex(runtime, deps, params.logger);
    } catch (err) {
      params.logger?.warn?.(`[pmos-smart-memory] durable capture skipped: ${describeError(err)}`);
    }
  };
}

async function resolveWorkspaceRuntimeContext(
  ctx: PluginHookAgentContext,
  deps: PmosSmartMemoryDeps,
): Promise<WorkspaceRuntimeContext | null> {
  const workspaceDir = typeof ctx.workspaceDir === "string" ? ctx.workspaceDir.trim() : "";
  if (!workspaceDir) {
    return null;
  }

  const workspaceId = extractWorkspaceIdFromPath(workspaceDir);
  if (!workspaceId) {
    return null;
  }

  const cfg = await deps.loadWorkspaceConfig(workspaceId);
  const agentId =
    typeof ctx.agentId === "string" && ctx.agentId.trim()
      ? ctx.agentId.trim()
      : resolveSessionAgentId({ sessionKey: ctx.sessionKey, config: cfg });

  return {
    workspaceId,
    workspaceDir,
    cfg,
    agentId,
  };
}

function buildSessionMemoryConfig(
  config: ResolvedMemorySearchConfig,
): ResolvedSessionMemoryConfig {
  return {
    includeAssistant: config.sessions.includeAssistant,
    recentTurns: config.sessions.recentTurns,
    durableFacts: config.sessions.durableFacts,
  };
}

async function syncMemoryIndex(
  runtime: WorkspaceRuntimeContext,
  deps: PmosSmartMemoryDeps,
  logger?: PluginLogger,
): Promise<void> {
  try {
    const { manager } = await deps.getMemoryManager({
      cfg: runtime.cfg,
      agentId: runtime.agentId,
    });
    await manager?.sync?.({ reason: "pmos-smart-memory-capture" });
  } catch (err) {
    logger?.warn?.(`[pmos-smart-memory] memory sync skipped: ${describeError(err)}`);
  }
}

function renderRecallContext(results: MemorySearchResult[], maxChars: number): string | null {
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  let text =
    "Relevant workspace memory:\n" +
    "Use these notes only if they help with the current PMOS request. " +
    "If anything conflicts with the current request, follow the current request.";
  const seen = new Set<string>();
  let count = 0;

  for (const result of results) {
    const snippet = normalizeText(result.snippet);
    if (!snippet) {
      continue;
    }
    const citation = formatCitation(result);
    if (seen.has(citation)) {
      continue;
    }
    seen.add(citation);

    const block = `\n\n${count + 1}. ${snippet}\nSource: ${citation}`;
    if (text.length + block.length > maxChars) {
      if (count === 0) {
        const remaining = Math.max(0, maxChars - text.length - citation.length - 18);
        if (remaining < 40) {
          break;
        }
        const trimmedBlock = `\n\n1. ${snippet.slice(0, remaining).trimEnd()}...\nSource: ${citation}`;
        text += trimmedBlock;
        count += 1;
      }
      break;
    }

    text += block;
    count += 1;
  }

  return count > 0 ? text : null;
}

function buildCapturedMemoryDocument(params: {
  workspaceId: string;
  sessionKey?: string;
  generatedAt: string;
  durableMemoryText: string;
}): string {
  return [
    "# PMOS Smart Memory",
    "",
    `- Workspace ID: ${params.workspaceId}`,
    `- Session Key: ${params.sessionKey?.trim() || "main"}`,
    `- Updated At: ${params.generatedAt}`,
    "",
    params.durableMemoryText.trim(),
    "",
  ].join("\n");
}

function resolveCaptureDirectory(workspaceDir: string, rawDirectory: string): string {
  const trimmed = rawDirectory.trim();
  if (!trimmed) {
    return path.join(workspaceDir, DEFAULT_CAPTURE_DIR);
  }
  if (trimmed.startsWith("~") || path.isAbsolute(trimmed)) {
    return path.normalize(resolveUserPath(trimmed));
  }
  return path.normalize(path.resolve(workspaceDir, trimmed));
}

function extractWorkspaceIdFromPath(value: string): string | null {
  const match = WORKSPACE_PATH_RE.exec(value.trim());
  const workspaceId = match?.[1]?.trim();
  return workspaceId || null;
}

function sanitizeSessionKey(value?: string): string {
  const normalized = (value?.trim() || "main")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SESSION_KEY_CHARS);
  return normalized || "main";
}

function normalizeRecallQuery(prompt: string, minChars: number): string | null {
  const normalized = normalizeText(prompt);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("/")) {
    return null;
  }
  return normalized.length >= minChars ? normalized : null;
}

/** Filter out PMOS smart-memory results to prevent recursive memory ingestion. */
function filterRecallResults(results: MemorySearchResult[]): MemorySearchResult[] {
  if (!Array.isArray(results)) return [];
  return results.filter(
    (r) =>
      !r.path
        ?.split(/[\\/]/)
        .some((seg) => seg === PMOS_MEMORY_PATH_SEGMENT),
  );
}

/**
 * Remove the misleading "Source transcript:" line that the shared extractor adds,
 * since we pass a session key rather than a real file path.
 */
function cleanDurableMemoryText(text: string): string {
  return text
    .replace(/^Source transcript:.*$/gm, "")
    .replace(/^Transcript:.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Strip injected/synthetic blocks from text before durable memory extraction. */
function stripInjectedBlocks(text: string): string {
  let cleaned = text;
  for (const pattern of INJECTED_BLOCK_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    cleaned = cleaned.replace(pattern, "");
  }
  // Collapse excessive blank lines left by stripping
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

function serializeAgentMessages(
  messages: unknown[],
  opts?: { stripInjected?: boolean },
): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "";
  }

  const lines: string[] = [];
  for (const entry of messages) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const message = entry as { role?: unknown; content?: unknown };
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    const rawText = extractRawMessageText(message.content);
    if (!rawText) {
      continue;
    }
    // Strip injected blocks BEFORE normalization to preserve block boundaries
    const stripped = opts?.stripInjected ? stripInjectedBlocks(rawText) : rawText;
    if (!stripped) continue;
    const text = normalizeText(stripped);
    if (!text) continue;
    lines.push(
      JSON.stringify({
        type: "message",
        message: {
          role: message.role,
          content: text,
        },
      }),
    );
  }
  return lines.join("\n");
}

/** Extract raw (un-normalized) text from message content, preserving newlines for block stripping. */
function extractRawMessageText(content: unknown): string | null {
  if (typeof content === "string") {
    return content.trim() || null;
  }
  if (!Array.isArray(content)) {
    return null;
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const text = (block as { type?: unknown; text?: unknown }).type === "text"
      ? (block as { text?: unknown }).text
      : undefined;
    if (typeof text !== "string" || !text.trim()) {
      continue;
    }
    parts.push(text.trim());
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

function extractMessageText(content: unknown): string | null {
  const raw = extractRawMessageText(content);
  return raw ? normalizeText(raw) : null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function formatCitation(result: MemorySearchResult): string {
  if (result.startLine === result.endLine) {
    return `${result.path}#L${result.startLine}`;
  }
  return `${result.path}#L${result.startLine}-L${result.endLine}`;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}