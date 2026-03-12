import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchWorkspaceFigmaMcpRpc,
  listWorkspaceFigmaMcpServiceTools,
} from "./figma-mcp-service.js";
import { workspaceConnectorsPath, writeWorkspaceConnectors } from "./workspace-connectors.js";

describe("figma mcp service", () => {
  const workspaceId = `figma-service-${Date.now()}`;
  const connectorPath = workspaceConnectorsPath(workspaceId);

  afterEach(async () => {
    vi.unstubAllGlobals();
    try {
      await fs.rm(path.dirname(connectorPath), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("lists normalized tools through the shared service boundary", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
      },
    });

    const result = (await listWorkspaceFigmaMcpServiceTools(workspaceId)) as Record<string, unknown>;
    expect(result.transport).toBe("rest_compat");
    expect(result.toolNames).toEqual(
      expect.arrayContaining(["get_design_context", "get_metadata", "get_comments"]),
    );
    expect(result.availableTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shortName: "get_design_context",
          qualifiedName: "figma.get_design_context",
        }),
      ]),
    );
  });

  it("dispatches tools/call through the service RPC contract", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
        identity: {
          selectedFileUrl:
            "https://www.figma.com/design/3INmNiG3X3NKAZtCI3SMg6/OKA-Online-Audit?node-id=0-1",
          selectedFileId: "3INmNiG3X3NKAZtCI3SMg6",
          selectedFileName: "OKA Online Audit",
        },
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/comments")) {
          return new Response(
            JSON.stringify({
              comments: [
                {
                  id: "c1",
                  message: "Audit this hero block",
                  client_meta: { node_id: "0:1" },
                  user: { handle: "design" },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const rpc = await dispatchWorkspaceFigmaMcpRpc({
      workspaceId,
      id: "req-1",
      method: "tools/call",
      rpcParams: {
        name: "figma.get_comments",
        arguments: {
          url: "https://www.figma.com/design/3INmNiG3X3NKAZtCI3SMg6/OKA-Online-Audit?node-id=0-1",
        },
      },
    });

    expect(rpc).toEqual({
      jsonrpc: "2.0",
      id: "req-1",
      result: expect.objectContaining({
        source: "pmos-figma-rest-compat",
        totalComments: 1,
        comments: [
          expect.objectContaining({
            id: "c1",
            nodeId: "0:1",
          }),
        ],
      }),
    });
  });

  it("returns the service tool list even when PAT sync is missing", async () => {
    const rpc = await dispatchWorkspaceFigmaMcpRpc({
      workspaceId,
      id: "req-2",
      method: "tools/list",
    });

    expect(rpc).toEqual({
      jsonrpc: "2.0",
      id: "req-2",
      result: expect.objectContaining({
        authRequired: true,
        availableWithoutPersonalAccessToken: expect.arrayContaining([
          "figma.whoami",
          "figma.generate_diagram",
        ]),
      }),
    });
  });

  it("dispatches generate_diagram through the service RPC contract", async () => {
    const rpc = await dispatchWorkspaceFigmaMcpRpc({
      workspaceId,
      id: "req-3",
      method: "tools/call",
      rpcParams: {
        name: "figma.generate_diagram",
        arguments: {
          name: "Roadmap",
          mermaidSyntax: 'flowchart LR\nA["Plan"] --> B["Ship"]',
        },
      },
    });

    expect(rpc).toEqual({
      jsonrpc: "2.0",
      id: "req-3",
      result: expect.objectContaining({
        status: "completed",
        compatibilityMode: true,
        name: "Roadmap",
      }),
    });
  });
});
