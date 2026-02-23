import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

const resolvePmosSessionFromRequestMock = vi.fn();
vi.mock("./pmos-auth.js", () => ({
  resolvePmosSessionFromRequest: resolvePmosSessionFromRequestMock,
}));

vi.mock("./workspace-connectors.js", () => ({
  readWorkspaceConnectors: vi.fn(async () => ({})),
}));

vi.mock("./n8n-auth-bridge.js", () => ({
  buildN8nAuthHeaders: vi.fn(async () => ({ Cookie: "n8n-auth=test" })),
  getOwnerCookie: vi.fn(async () => "owner=test"),
}));

function makeReq(url: string, method = "GET"): IncomingMessage {
  const req = new Readable({
    read() {
      this.push(null);
    },
  }) as IncomingMessage;
  (req as unknown as { url: string }).url = url;
  (req as unknown as { method: string }).method = method;
  (req as unknown as { headers: Record<string, string> }).headers = {};
  return req;
}

function makeRes() {
  const headers = new Map<string, string>();
  let body = "";
  const res = {
    statusCode: 200,
    setHeader(key: string, value: unknown) {
      headers.set(key.toLowerCase(), String(value));
      return this;
    },
    end(chunk?: unknown) {
      body = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : "";
      return this;
    },
  } as unknown as ServerResponse;
  return { res, headers, getBody: () => body };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pmos ops proxy workflow list behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.N8N_LOCAL_URL = "http://127.0.0.1:5678";
    resolvePmosSessionFromRequestMock.mockResolvedValue({
      ok: true,
      user: {
        id: "super-1",
        email: "super@example.com",
        role: "super_admin",
        workspaceId: "ws-super",
      },
    });
  });

  it("aggregates and deduplicates workflows across projects for super admin", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "p1" }, { id: "p2" }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "wf-1" }, { id: "wf-shared" }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "wf-2" }, { id: "wf-shared" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const { handleOpsProxyRequest } = await import("./pmos-ops-proxy.js");
    const req = makeReq("/api/ops/workflows?limit=500");
    const { res, getBody } = makeRes();

    const handled = await handleOpsProxyRequest(req, res);
    expect(handled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const body = JSON.parse(getBody()) as { data?: Array<{ id: string }>; count?: number };
    expect(body.count).toBe(3);
    expect(body.data?.map((w) => w.id)).toEqual(["wf-1", "wf-shared", "wf-2"]);
  });
});
