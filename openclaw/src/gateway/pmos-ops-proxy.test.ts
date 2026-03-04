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

const readWorkspaceConnectorsMock = vi.fn();
vi.mock("./workspace-connectors.js", () => ({
  readWorkspaceConnectors: readWorkspaceConnectorsMock,
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
  let ended = false;
  const res = {
    statusCode: 200,
    get writableEnded() {
      return ended;
    },
    setHeader(key: string, value: unknown) {
      headers.set(key.toLowerCase(), String(value));
      return this;
    },
    end(chunk?: unknown) {
      body = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : "";
      ended = true;
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
    delete process.env.N8N_LOCAL_URL;
    delete process.env.ACTIVEPIECES_USER_PASSWORD;
    delete process.env.OPS_USER_PASSWORD;
    resolvePmosSessionFromRequestMock.mockResolvedValue({
      ok: true,
      user: {
        id: "super-1",
        email: "super@example.com",
        role: "super_admin",
        workspaceId: "ws-super",
      },
    });
    readWorkspaceConnectorsMock.mockResolvedValue({});
  });

  it("proxies legacy /api/ops/workflows to Activepieces /api/v1/flows", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "wf-1" }, { id: "wf-2" }], count: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    const { handleOpsProxyRequest } = await import("./pmos-ops-proxy.js");
    const req = makeReq("/api/ops/workflows?limit=500");
    const { res, getBody } = makeRes();

    const handled = await handleOpsProxyRequest(req, res);
    expect(handled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/v1/flows?limit=500");

    const body = JSON.parse(getBody()) as { data?: Array<{ id: string }>; count?: number };
    expect(body.count).toBe(2);
    expect(body.data?.map((w) => w.id)).toEqual(["wf-1", "wf-2"]);
  });

  it("proxies legacy /api/ops/workflows/:id/execute to Activepieces webhooks", async () => {
    readWorkspaceConnectorsMock.mockResolvedValue({
      ops: {
        url: "https://flow.example.test",
        apiKey: "workspace-token-123",
        projectId: "proj_abc123",
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "run-789", status: "RUNNING" }));
    vi.stubGlobal("fetch", fetchMock);

    const { handleOpsProxyRequest } = await import("./pmos-ops-proxy.js");
    const req = makeReq("/api/ops/workflows/wf-123/execute?source=compat", "POST");
    const { res, getBody } = makeRes();

    const handled = await handleOpsProxyRequest(req, res);
    expect(handled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://flow.example.test/api/v1/webhooks/wf-123/sync?source=compat",
    );
    const payload = JSON.parse(getBody()) as { id?: string; status?: string };
    expect(payload.id).toBe("run-789");
    expect(payload.status).toBe("RUNNING");
  });

  it("injects workspace token bootstrap into /ops-ui html when no user login creds exist", async () => {
    readWorkspaceConnectorsMock.mockResolvedValue({
      ops: {
        url: "https://flow.example.test",
        apiKey: "workspace-token-123",
        projectId: "proj_abc123",
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html><head></head><body>ok</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { handleLocalN8nRequest } = await import("./pmos-ops-proxy.js");
    const req = makeReq("/ops-ui");
    const { res, getBody } = makeRes();

    const handled = await handleLocalN8nRequest(req, res);
    expect(handled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://flow.example.test/");

    const html = getBody();
    expect(html).toContain("openclaw-ap-bootstrap");
    expect(html).toContain("workspace-token-123");
    expect(html).toContain("proj_abc123");
  });
});
