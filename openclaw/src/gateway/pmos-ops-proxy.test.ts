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

  it("uses workspace user login token for /api/v1 proxy when API key is absent", async () => {
    readWorkspaceConnectorsMock.mockResolvedValue({
      ops: {
        url: "https://flow.example.test",
        user: {
          email: "rajan@example.com",
          password: "secret-pass",
        },
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "workspace-user-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "user-1" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const { handleOpsProxyRequest } = await import("./pmos-ops-proxy.js");
    const req = makeReq("/api/v1/users/me");
    const { res, getBody } = makeRes();

    const handled = await handleOpsProxyRequest(req, res);
    expect(handled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://flow.example.test/api/v1/authentication/sign-in");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://flow.example.test/api/v1/users/me");

    const headers = fetchMock.mock.calls[1]?.[1] as { headers?: Record<string, string> } | undefined;
    expect(headers?.headers?.authorization).toBe("Bearer workspace-user-token");

    const body = JSON.parse(getBody()) as { id?: string };
    expect(body.id).toBe("user-1");
  });

  it("rewrites ops-ui html asset and route paths to stay under /ops-ui", async () => {
    readWorkspaceConnectorsMock.mockResolvedValue({
      ops: {
        url: "https://flow.example.test",
        apiKey: "workspace-token-123",
        projectId: "proj_abc123",
      },
    });

    const upstreamHtml = [
      "<html><head>",
      '<base href="/" />',
      '<script type="module" src="/assets/index.js"></script>',
      '<link rel="stylesheet" href="/assets/index.css">',
      "</head><body>",
      '<a href="/flows">Flows</a>',
      '<a href="/api/v1/flows">API</a>',
      "</body></html>",
    ].join("");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(upstreamHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { handleLocalN8nRequest } = await import("./pmos-ops-proxy.js");
    const req = makeReq("/ops-ui/flows");
    const { res, getBody } = makeRes();

    const handled = await handleLocalN8nRequest(req, res);
    expect(handled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://flow.example.test/flows");

    const html = getBody();
    expect(html).toContain('<base href="/ops-ui/" />');
    expect(html).toContain('src="/ops-ui/assets/index.js"');
    expect(html).toContain('href="/ops-ui/assets/index.css"');
    expect(html).toContain('href="/ops-ui/flows"');
    // API endpoints should remain untouched.
    expect(html).toContain('href="/api/v1/flows"');
  });
});
