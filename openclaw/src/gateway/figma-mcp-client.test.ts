import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __test,
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
        expect.objectContaining({ name: "figma.get_file_metadata" }),
        expect.objectContaining({ name: "figma.get_comments" }),
        expect.objectContaining({ name: "figma.get_versions" }),
        expect.objectContaining({ name: "figma.get_dev_resources" }),
        expect.objectContaining({ name: "figma.get_code_connect_map" }),
        expect.objectContaining({ name: "figma.get_code_connect_suggestions" }),
        expect.objectContaining({ name: "figma.send_code_connect_mappings" }),
        expect.objectContaining({ name: "figma.create_design_system_rules" }),
        expect.objectContaining({ name: "figma.generate_diagram" }),
        expect.objectContaining({ name: "figma.generate_figma_design" }),
      ]),
    );
  });

  it("lists tools even before PAT sync and marks auth as required", async () => {
    const result = (await listWorkspaceFigmaMcpTools(workspaceId)) as Record<string, unknown>;
    expect(result.authRequired).toBe(true);
    expect(result.availableWithoutPersonalAccessToken).toEqual(
      expect.arrayContaining([
        "figma.whoami",
        "figma.generate_diagram",
        "figma.generate_figma_design",
      ]),
    );
    expect(result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "figma.get_design_context" }),
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

  it("returns connector identity through whoami without requiring a PAT", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          hasPersonalAccessToken: false,
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

    const result = (await callWorkspaceFigmaMcpTool({
      workspaceId,
      toolName: "whoami",
      args: {},
    })) as Record<string, unknown>;

    expect(result.selectedFileName).toBe("OKA Online Audit");
    expect(result.fileKey).toBe("3INmNiG3X3NKAZtCI3SMg6");
    expect(result.hasPersonalAccessToken).toBe(false);
  });

  it("anchors whoami to the requested URL and enriches it with live Figma identity when PAT is available", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
        identity: {
          selectedFileUrl: "https://www.figma.com/design/t7Tuz7hnuyv2fifnRJZ0zN/806-Technologies-Internal",
          selectedFileId: "t7Tuz7hnuyv2fifnRJZ0zN",
          selectedFileName: "806 Technologies - Internal",
        },
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/me")) {
          return new Response(
            JSON.stringify({
              id: "u1",
              handle: "design",
              email: "design@wickedwebsites.us",
              img_url: "https://example.com/avatar.png",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/v1/files/3INmNiG3X3NKAZtCI3SMg6")) {
          return new Response(
            JSON.stringify({
              name: "OKA Online Audit",
              document: {
                id: "0:1",
                name: "Document",
                type: "CANVAS",
              },
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
      toolName: "whoami",
      args: {
        url: "https://www.figma.com/design/3INmNiG3X3NKAZtCI3SMg6/OKA-Online-Audit?node-id=0-1",
      },
    })) as Record<string, unknown>;

    expect(result.selectedFileName).toBe("806 Technologies - Internal");
    expect(result.effectiveFileName).toBe("OKA Online Audit");
    expect(result.effectiveFileId).toBe("3INmNiG3X3NKAZtCI3SMg6");
    expect(result.fileKey).toBe("3INmNiG3X3NKAZtCI3SMg6");
    expect(result.nodeId).toBe("0:1");
    expect(result.user).toEqual(
      expect.objectContaining({
        handle: "design",
        email: "design@wickedwebsites.us",
      }),
    );
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

  it("returns file metadata through the compat tool call path", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/meta")) {
          return new Response(
            JSON.stringify({
              name: "OKA Online Audit",
              editorType: "figma",
              thumbnailUrl: "https://example.com/thumb.png",
              version: "42",
              role: "editor",
              linkAccess: "view",
              branches: [{ key: "b1", name: "Exploration" }],
              components: { c1: { key: "c1", name: "Hero/Banner" } },
              styles: { s1: { key: "s1", name: "Text/Heading" } },
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
      toolName: "get_file_metadata",
      args: {
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
      },
    })) as Record<string, unknown>;

    expect(result.fileName).toBe("OKA Online Audit");
    expect(result.editorType).toBe("figma");
    expect(result.summary).toEqual({
      branches: 1,
      components: 1,
      styles: 1,
    });
  });

  it("returns file versions through the compat tool call path", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/versions")) {
          return new Response(
            JSON.stringify({
              versions: [
                {
                  id: "v1",
                  label: "Initial audit",
                  description: "First pass",
                  created_at: "2026-03-12T09:00:00Z",
                  user: { id: "u1", handle: "design", email: "design@wickedwebsites.us" },
                },
              ],
              pagination: { prev_page: null, next_page: null },
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
      toolName: "get_versions",
      args: {
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
      },
    })) as Record<string, unknown>;

    expect(result.totalVersions).toBe(1);
    expect(result.versions).toEqual([
      expect.objectContaining({
        id: "v1",
        label: "Initial audit",
      }),
    ]);
  });

  it("returns dev resources through the compat tool call path", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/dev_resources")) {
          return new Response(
            JSON.stringify({
              dev_resources: [
                {
                  id: "dr1",
                  node_id: "0:1",
                  file_key: "3INmNiG3X3NKAZtCI3SMg6",
                  name: "Homepage component spec",
                  url: "https://example.com/specs/homepage",
                  resource_type: "url",
                  description: "Engineering handoff spec",
                  language: "typescript",
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
      toolName: "get_dev_resources",
      args: {
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
        nodeId: "0:1",
      },
    })) as Record<string, unknown>;

    expect(result.totalDevResources).toBe(1);
    expect(result.devResources).toEqual([
      expect.objectContaining({
        id: "dr1",
        nodeId: "0:1",
        name: "Homepage component spec",
      }),
    ]);
  });

  it("falls back to the first renderable descendant when the requested screenshot node times out", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/files/") && !url.includes("/variables/local")) {
          return new Response(
            JSON.stringify({
              document: {
                id: "0:1",
                name: "Audit",
                type: "CANVAS",
                children: [
                  {
                    id: "4:155",
                    name: "Page Section",
                    type: "SECTION",
                    children: [
                      {
                        id: "4:2",
                        name: "1440w light",
                        type: "FRAME",
                      },
                    ],
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/v1/images/")) {
          if (url.includes("ids=0%3A1")) {
            throw new Error("The operation was aborted due to timeout");
          }
          return new Response(
            JSON.stringify({
              images: {
                "4:2": "https://example.com/fallback-frame.png",
              },
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
      toolName: "get_screenshot",
      args: {
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
        nodeId: "0:1",
      },
    })) as Record<string, unknown>;

    expect(result.requestedNodeId).toBe("0:1");
    expect(result.nodeId).toBe("4:2");
    expect(result.imageUrl).toBe("https://example.com/fallback-frame.png");
    expect(result.fallbackUsed).toBe(true);
    expect(result.attemptedNodeIds).toEqual(["0:1", "4:2"]);
    expect(result.fallbackCandidates).toEqual(
      expect.arrayContaining(["0:1", "4:2"]),
    );
  });

  it("returns a scope_required result for variable defs when the Figma token lacks file_variables:read", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/nodes?")) {
          return new Response(
            JSON.stringify({
              nodes: {
                "0:1": {
                  document: {
                    id: "0:1",
                    name: "Audit",
                    type: "FRAME",
                  },
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/variables/local")) {
          return new Response(
            JSON.stringify({
              status: 403,
              error: true,
              message:
                "Invalid scope(s): file_content:read. This endpoint requires the file_variables:read scope",
            }),
            { status: 403, headers: { "content-type": "application/json" } },
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
      toolName: "get_variable_defs",
      args: {
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
        nodeId: "0:1",
      },
    })) as Record<string, unknown>;

    expect(result.status).toBe("scope_required");
    expect(result.requiredScope).toBe("file_variables:read");
    expect(result.matchedCount).toBe(0);
    expect(result.definitions).toEqual({});
    expect(result.variables).toEqual([]);
  });

  it("stores and returns PMOS-managed code connect mappings", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
      },
    });

    const saved = (await callWorkspaceFigmaMcpTool({
      workspaceId,
      toolName: "add_code_connect_map",
      args: {
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
        nodeId: "0:1",
        componentName: "HeroBanner",
        source: "src/components/HeroBanner.tsx",
        label: "React",
      },
    })) as Record<string, unknown>;

    expect(saved.saved).toBe(true);

    const maps = (await callWorkspaceFigmaMcpTool({
      workspaceId,
      toolName: "get_code_connect_map",
      args: {
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
        nodeId: "0:1",
      },
    })) as Record<string, unknown>;

    expect(maps.totalMappings).toBe(1);
    expect(maps.mappings).toEqual([
      expect.objectContaining({
        componentName: "HeroBanner",
        source: "src/components/HeroBanner.tsx",
        label: "React",
      }),
    ]);

    const mappingPath = __test.workspaceFigmaCodeConnectPath(workspaceId);
    const raw = await fs.readFile(mappingPath, "utf-8");
    expect(raw).toContain("HeroBanner");
  });

  it("generates implementation-oriented design system rules from file data", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/variables/local")) {
          return new Response(
            JSON.stringify({
              meta: {
                variables: {
                  "1": { id: "1", name: "color/brand/primary" },
                  "2": { id: "2", name: "space/md" },
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("/v1/files/")) {
          return new Response(
            JSON.stringify({
              document: { id: "0:1", name: "Audit", type: "CANVAS" },
              components: {
                c1: { name: "Hero/Banner" },
                c2: { name: "Button/Primary" },
              },
              componentSets: {
                cs1: { name: "Button" },
              },
              styles: {
                s1: { name: "Text/Heading" },
                s2: { name: "Fill/Brand/Primary" },
              },
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
      toolName: "create_design_system_rules",
      args: {
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
        clientFrameworks: "react",
        clientLanguages: "typescript",
      },
    })) as Record<string, unknown>;

    expect(result.summary).toEqual({
      components: 2,
      componentSets: 1,
      styles: 2,
      variables: 2,
    });
    expect(String(result.rules)).toContain("Design system implementation rules");
    expect(String(result.rules)).toContain("react / typescript");
    expect(String(result.rules)).toContain("Hero/Banner");
  });

  it("suggests code connect mappings from the node name when none are saved", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            nodes: {
              "0:1": {
                document: {
                  id: "0:1",
                  name: "Hero Banner",
                  type: "FRAME",
                },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const result = (await callWorkspaceFigmaMcpTool({
      workspaceId,
      toolName: "get_code_connect_suggestions",
      args: {
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
        nodeId: "0:1",
        clientFrameworks: "React",
      },
    })) as Record<string, unknown>;

    expect(result.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentName: "HeroBanner",
          source: "src/components/HeroBanner.tsx",
          label: "React",
        }),
      ]),
    );
  });

  it("bulk-saves code connect mappings", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        auth: {
          personalAccessToken: "figd_pat_test",
          hasPersonalAccessToken: true,
          source: "fm-session",
        },
      },
    });

    const result = (await callWorkspaceFigmaMcpTool({
      workspaceId,
      toolName: "send_code_connect_mappings",
      args: {
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
        mappings: [
          {
            nodeId: "0:1",
            componentName: "HeroBanner",
            source: "src/components/HeroBanner.tsx",
            label: "React",
          },
          {
            nodeId: "0:2",
            componentName: "AuditFooter",
            source: "src/components/AuditFooter.tsx",
            label: "React",
          },
        ],
      },
    })) as Record<string, unknown>;

    expect(result.saved).toBe(true);
    expect(result.totalSaved).toBe(2);

    const maps = (await callWorkspaceFigmaMcpTool({
      workspaceId,
      toolName: "get_code_connect_map",
      args: {
        fileKey: "3INmNiG3X3NKAZtCI3SMg6",
      },
    })) as Record<string, unknown>;

    expect(maps.totalMappings).toBe(2);
  });

  it("creates a local Mermaid artifact for generate_diagram", async () => {
    const result = (await callWorkspaceFigmaMcpTool({
      workspaceId,
      toolName: "generate_diagram",
      args: {
        name: "Audit Flow",
        mermaidSyntax: 'flowchart LR\nA["Start"] --> B["Review"]',
        userIntent: "Map the audit flow",
      },
    })) as Record<string, unknown>;

    expect(result.status).toBe("completed");
    expect(String(result.artifactPath)).toContain("figma-artifacts");
    const raw = await fs.readFile(String(result.artifactPath), "utf-8");
    expect(raw).toContain('A["Start"] --> B["Review"]');
  });

  it("creates and reloads a local capture bundle for generate_figma_design", async () => {
    const completed = (await callWorkspaceFigmaMcpTool({
      workspaceId,
      toolName: "generate_figma_design",
      args: {
        outputMode: "newFile",
        url: "https://example.com/audit",
        html: "<html><head><title>Audit Page</title></head><body><main>Audit this page now.</main></body></html>",
      },
    })) as Record<string, unknown>;

    expect(completed.status).toBe("completed");
    expect(String(completed.artifactPath)).toContain("figma-artifacts");
    expect(completed.captureId).toBeTruthy();

    const reloaded = (await callWorkspaceFigmaMcpTool({
      workspaceId,
      toolName: "generate_figma_design",
      args: {
        captureId: completed.captureId,
      },
    })) as Record<string, unknown>;

    expect(reloaded.captureId).toBe(completed.captureId);
    expect(reloaded.summary).toEqual(
      expect.objectContaining({
        title: "Audit Page",
        outputMode: "newFile",
      }),
    );
  });
});
