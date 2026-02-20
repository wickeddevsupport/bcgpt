/**
 * n8n AI Proxy — OpenClaw gateway endpoint for n8n's AI Assistant.
 *
 * n8n's built-in AI Assistant normally calls n8n's cloud SDK. We replace it
 * with this endpoint so the same BYOK model configured in OpenClaw powers the
 * n8n in-editor AI chat, Ask AI, and error helper — without any n8n license.
 *
 * n8n's ai-service.ts calls us at:
 *   POST /api/internal/n8n-ai/chat
 *   POST /api/internal/n8n-ai/ask-ai
 *   POST /api/internal/n8n-ai/apply-suggestion
 *
 * Protected by X-OpenClaw-Internal-Token header.
 *
 * Streaming format matches n8n's expected format exactly:
 *   application/json-lines, chunks separated by STREAM_SEPARATOR
 */

import { callWorkspaceModel } from "./workflow-ai.js";
import { readWorkspaceConnectors } from "./workspace-connectors.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const STREAM_SEPARATOR = "⧉⇋⇋➽⌑⧉§§\n";
export const INTERNAL_TOKEN_HEADER = "x-openclaw-internal-token";

// In-memory session store for multi-turn AI conversations
const sessionStore = new Map<string, { workspaceId: string; messages: Array<{ role: string; content: string }> }>();

function getInternalToken(): string {
  return process.env.OPENCLAW_INTERNAL_TOKEN ?? "openclaw-internal-dev-token";
}

/**
 * Resolve a workspaceId from an n8n user's email.
 * Scans workspace connectors to find a match.
 */
async function resolveWorkspaceByN8nEmail(email: string): Promise<string | null> {
  const home = process.env.OPENCLAW_HOME ?? path.join(process.env.HOME ?? "~", ".openclaw");
  const workspacesDir = path.join(home, "workspaces");

  let entries: string[];
  try {
    entries = await fs.readdir(workspacesDir);
  } catch {
    return null;
  }

  for (const workspaceId of entries) {
    try {
      const wc = await readWorkspaceConnectors(workspaceId);
      const user = (wc?.ops as Record<string, unknown> | undefined)?.user as { email?: string } | undefined;
      if (user?.email && user.email.toLowerCase() === email.toLowerCase()) {
        return workspaceId;
      }
      // Also match the fallback pattern: pmos-{workspaceId}@openclaw.local
      const fallbackEmail = `pmos-${workspaceId}@openclaw.local`;
      if (email.toLowerCase() === fallbackEmail) {
        return workspaceId;
      }
    } catch {
      // skip invalid workspace dirs
    }
  }

  return null;
}

/**
 * Build n8n-compatible streaming response chunks.
 * Returns a ReadableStream that n8n's controller can pipe to the HTTP response.
 */
function buildStreamingResponse(sessionId: string, text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  // Split response into chunks to simulate streaming
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    current += word;
    if (current.length > 40) {
      chunks.push(current);
      current = "";
    }
  }
  if (current) chunks.push(current);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // Send intermediate step to show we're thinking
      const thinkingChunk = JSON.stringify({
        sessionId,
        messages: [{
          role: "assistant",
          type: "intermediate-step",
          text: "Analyzing with OpenClaw AI...",
          step: "openclaw_analysis",
        }],
      }) + STREAM_SEPARATOR;
      controller.enqueue(encoder.encode(thinkingChunk));

      // Stream the actual response in chunks
      let accumulated = "";
      for (let i = 0; i < chunks.length; i++) {
        accumulated += chunks[i];
        const isLast = i === chunks.length - 1;

        if (isLast || accumulated.length > 80) {
          const msgChunk = JSON.stringify({
            sessionId,
            messages: [{
              role: "assistant",
              type: "message",
              text: accumulated,
            }],
          }) + STREAM_SEPARATOR;
          controller.enqueue(encoder.encode(msgChunk));
          accumulated = "";

          // Small delay to allow flushing
          await new Promise(r => setTimeout(r, 5));
        }
      }

      // End session
      const endChunk = JSON.stringify({
        sessionId,
        messages: [{
          role: "assistant",
          type: "event",
          eventName: "end-session",
        }],
      }) + STREAM_SEPARATOR;
      controller.enqueue(encoder.encode(endChunk));
      controller.close();
    },
  });
}

/**
 * Build n8n AI system prompt enriched with context from the request payload.
 */
function buildN8nAiSystemPrompt(payload: Record<string, unknown>): string {
  const requestPayload = payload.payload as Record<string, unknown> | undefined;
  const type = requestPayload?.type as string | undefined;

  let contextSection = "";

  if (requestPayload?.error) {
    const err = requestPayload.error as Record<string, unknown>;
    contextSection += `\n\n## Current Error\nType: ${err.name ?? "Unknown"}\nMessage: ${err.message ?? ""}\n${err.description ? `Description: ${err.description}` : ""}\n${err.lineNumber ? `Line: ${err.lineNumber}` : ""}`;
  }

  if (requestPayload?.node) {
    const node = requestPayload.node as Record<string, unknown>;
    contextSection += `\n\n## Current Node\nName: ${node.name ?? ""}\nType: ${node.type ?? ""}`;
  }

  if (requestPayload?.context) {
    const ctx = requestPayload.context as Record<string, unknown>;
    if (ctx.currentWorkflow) {
      const wf = ctx.currentWorkflow as Record<string, unknown>;
      contextSection += `\n\n## Current Workflow\nName: ${wf.name ?? "Untitled"}`;
    }
  }

  const roleContext = type === "init-error-helper"
    ? "You are an expert n8n workflow debugging assistant. Help the user understand and fix the error in their n8n workflow."
    : type === "init-cred-help"
    ? "You are an expert n8n credentials configuration assistant. Help the user set up their credentials correctly."
    : "You are an expert n8n workflow automation assistant integrated into OpenClaw. Help users create, debug, and optimize their n8n workflows.";

  return `${roleContext}

You have deep knowledge of all n8n nodes, their parameters, credentials requirements, and common error patterns.

When suggesting workflow changes, be specific about node parameters and connections.
When debugging errors, explain what likely went wrong and provide concrete fix steps.
Keep responses concise and actionable.
${contextSection}

## Key Information
- This is OpenClaw's embedded n8n instance (version 1.76.1)
- Users have BYOK AI configured — you are their AI assistant
- All standard n8n nodes are available plus custom Basecamp and OpenClaw nodes
- Respond helpfully in plain text (no JSON needed here — this is the in-editor assistant)`;
}

export type N8nAiChatRequest = {
  n8nUserEmail: string;
  payload: Record<string, unknown>;
  sessionId?: string;
};

export type N8nAiAskRequest = {
  n8nUserEmail: string;
  question: string;
  context: Record<string, unknown>;
  forNode: string;
};

export type N8nAiApplySuggestionRequest = {
  n8nUserEmail: string;
  sessionId: string;
  suggestionId: string;
};

/**
 * Handle POST /api/internal/n8n-ai/chat
 */
export async function handleN8nAiChat(req: N8nAiChatRequest): Promise<{
  ok: boolean;
  stream?: ReadableStream<Uint8Array>;
  error?: string;
}> {
  const { n8nUserEmail, payload, sessionId: existingSessionId } = req;

  // Resolve workspace from n8n user email
  const workspaceId = await resolveWorkspaceByN8nEmail(n8nUserEmail);
  if (!workspaceId) {
    return { ok: false, error: `No workspace found for n8n user: ${n8nUserEmail}` };
  }

  // Session management
  const sessionId = existingSessionId ?? `n8n-ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const session = sessionStore.get(sessionId) ?? { workspaceId, messages: [] };

  // Extract user's question from payload
  const requestPayload = payload.payload as Record<string, unknown> | undefined;
  const userText = (requestPayload?.question as string) ??
    (requestPayload?.text as string) ??
    (requestPayload?.type === "init-error-helper" ? "Help me fix this error" : "How can you help me?");

  // Add user message to session history
  session.messages.push({ role: "user", content: userText });
  sessionStore.set(sessionId, session);

  // Build system prompt with n8n context
  const systemPrompt = buildN8nAiSystemPrompt(payload);

  // Call workspace BYOK model
  const result = await callWorkspaceModel(
    workspaceId,
    systemPrompt,
    session.messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    { maxTokens: 1024 },
  );

  if (!result.ok) {
    // Return a friendly error in n8n's streaming format
    const encoder = new TextEncoder();
    const errorStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = JSON.stringify({
          sessionId,
          messages: [{
            role: "assistant",
            type: "message",
            text: result.error ?? "No AI model configured. Go to OpenClaw Integrations → AI Model Setup to add your API key.",
          }],
        }) + STREAM_SEPARATOR;
        controller.enqueue(encoder.encode(chunk));

        const endChunk = JSON.stringify({
          sessionId,
          messages: [{ role: "assistant", type: "event", eventName: "end-session" }],
        }) + STREAM_SEPARATOR;
        controller.enqueue(encoder.encode(endChunk));
        controller.close();
      },
    });
    return { ok: true, stream: errorStream };
  }

  // Store assistant response in session
  session.messages.push({ role: "assistant", content: result.text ?? "" });
  sessionStore.set(sessionId, session);

  // Clean up old sessions (keep last 100)
  if (sessionStore.size > 100) {
    const oldest = sessionStore.keys().next().value;
    if (oldest) sessionStore.delete(oldest);
  }

  const stream = buildStreamingResponse(sessionId, result.text ?? "");
  return { ok: true, stream };
}

/**
 * Handle POST /api/internal/n8n-ai/ask-ai
 * Used by n8n's "Ask AI" feature in code/transform nodes.
 */
export async function handleN8nAiAskAi(req: N8nAiAskRequest): Promise<{
  ok: boolean;
  code?: string;
  error?: string;
}> {
  const { n8nUserEmail, question, context, forNode } = req;

  const workspaceId = await resolveWorkspaceByN8nEmail(n8nUserEmail);
  if (!workspaceId) {
    return { ok: false, error: `No workspace found for n8n user: ${n8nUserEmail}` };
  }

  const systemPrompt = `You are an expert n8n ${forNode} node code writer.
The user needs JavaScript code for an n8n ${forNode} node.

Input schema context:
${JSON.stringify(context, null, 2)}

Return ONLY valid JavaScript code that can run in n8n's ${forNode} node.
No markdown fences, no explanation — just the code.
The code should return an array of items: return items.map(item => ({ json: { ...item.json } }));`;

  const result = await callWorkspaceModel(
    workspaceId,
    systemPrompt,
    [{ role: "user", content: question }],
    { maxTokens: 512 },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // Strip markdown code fences if present
  let code = result.text ?? "";
  code = code.replace(/^```(?:javascript|js)?\n?/m, "").replace(/\n?```$/m, "").trim();

  return { ok: true, code };
}

/**
 * Handle POST /api/internal/n8n-ai/apply-suggestion
 * Returns node parameters from a stored suggestion.
 * (We don't implement full suggestion storage — return empty params with a message)
 */
export async function handleN8nAiApplySuggestion(req: N8nAiApplySuggestionRequest): Promise<{
  ok: boolean;
  sessionId?: string;
  parameters?: Record<string, unknown>;
  error?: string;
}> {
  // For now, return the session info without stored parameters
  // A full implementation would store code diffs by suggestionId
  return {
    ok: true,
    sessionId: req.sessionId,
    parameters: {},
  };
}
