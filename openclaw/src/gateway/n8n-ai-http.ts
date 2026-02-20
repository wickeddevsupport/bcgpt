/**
 * HTTP handler for the n8n AI proxy endpoints.
 * These endpoints are called by the vendored n8n's OpenClawAiClient.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  INTERNAL_TOKEN_HEADER,
  handleN8nAiChat,
  handleN8nAiAskAi,
  handleN8nAiApplySuggestion,
  STREAM_SEPARATOR,
} from "./n8n-ai-proxy.js";

function getInternalToken(): string {
  return process.env.OPENCLAW_INTERNAL_TOKEN ?? "openclaw-internal-dev-token";
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += String(chunk); });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/**
 * Handle internal n8n AI proxy requests.
 * Routes:
 *   POST /api/internal/n8n-ai/chat
 *   POST /api/internal/n8n-ai/ask-ai
 *   POST /api/internal/n8n-ai/apply-suggestion
 */
export async function handleN8nAiHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/api/internal/n8n-ai/")) {
    return false;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return true;
  }

  // Validate internal token
  const token = req.headers[INTERNAL_TOKEN_HEADER];
  if (!token || token !== getInternalToken()) {
    sendJson(res, 401, { error: "Unauthorized" });
    return true;
  }

  const body = await readBody(req);
  if (!body) {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return true;
  }

  const subPath = url.pathname.slice("/api/internal/n8n-ai/".length);

  if (subPath === "chat") {
    const { n8nUserEmail, payload, sessionId } = body as {
      n8nUserEmail?: string;
      payload?: Record<string, unknown>;
      sessionId?: string;
    };

    if (!n8nUserEmail || !payload) {
      sendJson(res, 400, { error: "Missing n8nUserEmail or payload" });
      return true;
    }

    const result = await handleN8nAiChat({ n8nUserEmail, payload, sessionId });
    if (!result.ok || !result.stream) {
      sendJson(res, 500, { error: result.error ?? "AI chat failed" });
      return true;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json-lines");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering

    const writer = new WritableStream({
      write(chunk: Uint8Array) {
        res.write(Buffer.from(chunk));
      },
      close() {
        res.end();
      },
    });

    await result.stream.pipeTo(writer);
    return true;
  }

  if (subPath === "ask-ai") {
    const { n8nUserEmail, question, context, forNode } = body as {
      n8nUserEmail?: string;
      question?: string;
      context?: Record<string, unknown>;
      forNode?: string;
    };

    if (!n8nUserEmail || !question) {
      sendJson(res, 400, { error: "Missing n8nUserEmail or question" });
      return true;
    }

    const result = await handleN8nAiAskAi({
      n8nUserEmail,
      question,
      context: context ?? {},
      forNode: forNode ?? "code",
    });

    if (!result.ok) {
      sendJson(res, 500, { error: result.error ?? "Ask AI failed" });
      return true;
    }

    sendJson(res, 200, { code: result.code ?? "" });
    return true;
  }

  if (subPath === "apply-suggestion") {
    const { n8nUserEmail, sessionId, suggestionId } = body as {
      n8nUserEmail?: string;
      sessionId?: string;
      suggestionId?: string;
    };

    if (!n8nUserEmail || !sessionId || !suggestionId) {
      sendJson(res, 400, { error: "Missing required fields" });
      return true;
    }

    const result = await handleN8nAiApplySuggestion({ n8nUserEmail, sessionId, suggestionId });
    if (!result.ok) {
      sendJson(res, 500, { error: result.error ?? "Apply suggestion failed" });
      return true;
    }

    sendJson(res, 200, { sessionId: result.sessionId, parameters: result.parameters ?? {} });
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}
