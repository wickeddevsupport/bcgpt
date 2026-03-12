import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleFigmaPluginBridgeHttpRequest } from "./figma-plugin-bridge-http.js";
import { workspaceConnectorsPath } from "./workspace-connectors.js";

const { resolvePmosSessionFromRequestMock } = vi.hoisted(() => ({
  resolvePmosSessionFromRequestMock: vi.fn(),
}));

vi.mock("./pmos-auth.js", () => ({
  resolvePmosSessionFromRequest: resolvePmosSessionFromRequestMock,
}));

function createResponseRecorder() {
  let statusCode = 200;
  const headers = new Map<string, string>();
  let body = "";
  let ended = false;

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
      return { statusCode, headers, body, ended };
    },
  };
}

function createJsonRequest(params: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}) {
  const req = new PassThrough() as never;
  req.method = params.method;
  req.url = params.url;
  req.headers = params.headers ?? {};
  process.nextTick(() => {
    if (params.body !== undefined) {
      req.write(JSON.stringify(params.body));
    }
    req.end();
  });
  return req;
}

describe("figma plugin bridge http", () => {
  const workspaceId = `figma-plugin-http-${Date.now()}`;
  const connectorPath = workspaceConnectorsPath(workspaceId);

  afterEach(async () => {
    resolvePmosSessionFromRequestMock.mockReset();
    try {
      await fs.rm(path.dirname(connectorPath), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("prepares a bridge token for an authenticated PMOS session", async () => {
    resolvePmosSessionFromRequestMock.mockResolvedValue({
      ok: true,
      user: { workspaceId },
    });

    const req = createJsonRequest({
      method: "POST",
      url: "/api/pmos/figma/plugin-bridge/prepare",
      headers: { host: "os.wickedlab.io", "x-forwarded-proto": "https" },
    });
    const recorder = createResponseRecorder();

    const handled = await handleFigmaPluginBridgeHttpRequest(req, recorder.res as never);
    const body = JSON.parse(recorder.snapshot().body) as Record<string, unknown>;

    expect(handled).toBe(true);
    expect(recorder.snapshot().statusCode).toBe(200);
    expect(body.bridgeToken).toMatch(/^figpb_/);
    expect(body.syncUrl).toBe("https://os.wickedlab.io/figma/plugin-bridge/sync");
  });

  it("syncs plugin annotations with a valid bridge token", async () => {
    resolvePmosSessionFromRequestMock.mockResolvedValue({
      ok: true,
      user: { workspaceId },
    });

    const prepareReq = createJsonRequest({
      method: "POST",
      url: "/api/pmos/figma/plugin-bridge/prepare",
      headers: { host: "os.wickedlab.io", "x-forwarded-proto": "https" },
    });
    const prepareRes = createResponseRecorder();
    await handleFigmaPluginBridgeHttpRequest(prepareReq, prepareRes.res as never);
    const prepared = JSON.parse(prepareRes.snapshot().body) as { bridgeToken: string };

    const syncReq = createJsonRequest({
      method: "POST",
      url: "/figma/plugin-bridge/sync",
      headers: {
        authorization: `Bearer ${prepared.bridgeToken}`,
        "content-type": "application/json",
      },
      body: {
        workspaceId,
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
        fileName: "OKA Online Audit",
        scope: "document",
        annotations: [{ id: "ann-1", nodeId: "0-1", labelMarkdown: "Review the CTA flow" }],
      },
    });
    const syncRes = createResponseRecorder();

    const handled = await handleFigmaPluginBridgeHttpRequest(syncReq, syncRes.res as never);
    const body = JSON.parse(syncRes.snapshot().body) as Record<string, unknown>;

    expect(handled).toBe(true);
    expect(syncRes.snapshot().statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.snapshot).toEqual(
      expect.objectContaining({
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
        annotations: [expect.objectContaining({ id: "ann-1", nodeId: "0:1" })],
      }),
    );
  });
});
