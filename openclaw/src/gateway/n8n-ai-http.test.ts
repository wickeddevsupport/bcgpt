import { describe, expect, it } from "vitest";
import { handleN8nAiHttpRequest } from "./n8n-ai-http.js";

function createResponseRecorder() {
  let statusCode = 200;
  const headers = new Map<string, string>();
  let ended = false;
  let body = "";

  return {
    res: {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
      end(value?: string) {
        ended = true;
        body = value ?? "";
      },
      get statusCode() {
        return statusCode;
      },
      set statusCode(value: number) {
        statusCode = value;
      },
    },
    snapshot() {
      return { statusCode, headers, ended, body };
    },
  };
}

describe("n8n-ai-http legacy gating", () => {
  it("ignores legacy n8n AI routes when embedded n8n is disabled", async () => {
    delete process.env.PMOS_ENABLE_LEGACY_EMBEDDED_N8N;
    delete process.env.N8N_EMBED_ENABLED;

    const recorder = createResponseRecorder();
    const handled = await handleN8nAiHttpRequest(
      {
        method: "POST",
        url: "/api/internal/n8n-ai/chat",
        headers: {},
      } as never,
      recorder.res as never,
    );

    expect(handled).toBe(false);
    expect(recorder.snapshot().ended).toBe(false);
  });

  it("keeps the route available when legacy embedded n8n is explicitly enabled", async () => {
    process.env.PMOS_ENABLE_LEGACY_EMBEDDED_N8N = "1";

    const recorder = createResponseRecorder();
    const handled = await handleN8nAiHttpRequest(
      {
        method: "POST",
        url: "/api/internal/n8n-ai/chat",
        headers: {},
      } as never,
      recorder.res as never,
    );

    expect(handled).toBe(true);
    expect(recorder.snapshot().statusCode).toBe(401);

    delete process.env.PMOS_ENABLE_LEGACY_EMBEDDED_N8N;
  });
});
