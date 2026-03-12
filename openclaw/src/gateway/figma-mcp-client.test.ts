import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callWorkspaceFigmaMcpTool,
  listWorkspaceFigmaMcpTools,
  probeWorkspaceFigmaMcpStatus,
} from "./figma-mcp-client.js";
import { workspaceConnectorsPath, writeWorkspaceConnectors } from "./workspace-connectors.js";

describe("figma mcp compat bridge", () => {
  const workspaceId = `figma-compat-${Date.now()}`;
  const connectorPath = workspaceConnectorsPath(workspaceId);

  afterEach(async () => {
    vi.unstubAllGlobals();
    try {
      await fs.rm(path.dirname(connectorPath), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("lists local compatibility tools when a workspace PAT is available", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
      },
    });

    const result = (await listWorkspaceFigmaMcpTools(workspaceId)) as Record<string, unknown>;
    const tools = Array.isArray(result.tools) ? result.tools : [];
    expect(result.source).toBe("pmos-figma-rest-compat");
    expect(result.transport).toBe("rest_compat");
    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "figma.get_design_context" }),
        expect.objectContaining({ name: "figma.get_metadata" }),
        expect.objectContaining({ name: "figma.get_comments" }),
      ]),
    );
  });

  it("reports PAT-backed readiness instead of remote OAuth readiness", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
      },
    });

    const status = await probeWorkspaceFigmaMcpStatus(workspaceId);
    expect(status.transport).toBe("rest_compat");
    expect(status.authOk).toBe(true);
    expect(status.authRequired).toBe(false);
    expect(status.hasPersonalAccessToken).toBe(true);
  });

  it("returns filtered comments for a node through the compat tool call path", async () => {
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
                {
                  id: "c2",
                  message: "Unrelated note",
                  client_meta: { node_id: "9:9" },
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

    const result = (await callWorkspaceFigmaMcpTool({
      workspaceId,
      toolName: "get_comments",
      args: {
        url: "https://www.figma.com/design/3INmNiG3X3NKAZtCI3SMg6/OKA-Online-Audit?node-id=0-1",
      },
    })) as Record<string, unknown>;

    expect(result.source).toBe("pmos-figma-rest-compat");
    expect(result.totalComments).toBe(1);
    expect(result.comments).toEqual([
      expect.objectContaining({
        id: "c1",
        message: "Audit this hero block",
        nodeId: "0:1",
      }),
    ]);
  });
});
