import { describe, expect, it } from "vitest";
import { __test } from "./server-methods/pmos.js";

describe("pmos figma mcp tool normalization", () => {
  it("builds mcporter env without leaking empty PAT variables", () => {
    expect(
      __test.buildMcporterEnvForFigma({
        personalAccessToken: null,
        hasPersonalAccessToken: false,
        source: null,
        mcpServerUrl: "https://mcp.figma.com/mcp",
      }),
    ).toEqual({
      MCP_FIGMA_SERVER_URL: "https://mcp.figma.com/mcp",
    });

    expect(
      __test.buildMcporterEnvForFigma({
        personalAccessToken: "figd_pat_123",
        hasPersonalAccessToken: true,
        source: "fm-team-pat",
        mcpServerUrl: "https://mcp.figma.com/mcp",
      }),
    ).toMatchObject({
      MCP_FIGMA_SERVER_URL: "https://mcp.figma.com/mcp",
      FIGMA_API_KEY: "figd_pat_123",
      FIGMA_PERSONAL_ACCESS_TOKEN: "figd_pat_123",
    });
  });

  it("classifies official MCP probe auth failures separately from reachability failures", () => {
    expect(__test.classifyFigmaMcpProbeError("SSE error: Non-200 status code (405)")).toEqual({
      authRequired: true,
      reachable: true,
    });
    expect(__test.classifyFigmaMcpProbeError("connect ECONNREFUSED 127.0.0.1:443")).toEqual({
      authRequired: false,
      reachable: false,
    });
  });

  it("accepts fully qualified figma MCP tool names", () => {
    expect(__test.normalizeFigmaMcpToolName("figma.get_design_context")).toBe(
      "get_design_context",
    );
    expect(__test.normalizeFigmaMcpToolName("get_metadata")).toBe("get_metadata");
  });

  it("adds short-name summaries and recommended starter tools to list output", () => {
    const result = __test.normalizeFigmaMcpToolListResult({
      tools: [
        {
          name: "figma.get_design_context",
          description: "Get design context for a node",
          inputSchema: { type: "object" },
        },
        {
          name: "figma.get_screenshot",
          description: "Capture screenshot",
          inputSchema: { type: "object" },
        },
        {
          name: "figma.get_comments",
          description: "Read comments",
          inputSchema: { type: "object" },
        },
      ],
    }) as Record<string, unknown>;

    expect(result.toolNames).toEqual([
      "get_design_context",
      "get_screenshot",
      "get_comments",
    ]);
    expect(result.recommendedStartingTools).toEqual([
      "get_design_context",
      "get_screenshot",
    ]);
    expect(result.callConvention).toContain("short MCP tool name");
    expect(result.availableTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shortName: "get_design_context",
          qualifiedName: "figma.get_design_context",
        }),
      ]),
    );
  });

  it("defers PAT audit for deep-context Figma requests until MCP is attempted or fails", () => {
    expect(
      __test.shouldDeferFigmaPatAudit({
        latestUserMessage:
          "Inspect comments, annotations, variables, and screenshot context for this Figma file",
        figmaMcpCallAttempted: false,
        figmaMcpFailureSeen: false,
      }),
    ).toBe(true);

    expect(
      __test.shouldDeferFigmaPatAudit({
        latestUserMessage:
          "Inspect comments, annotations, variables, and screenshot context for this Figma file",
        figmaMcpCallAttempted: true,
        figmaMcpFailureSeen: false,
      }),
    ).toBe(false);

    expect(
      __test.shouldDeferFigmaPatAudit({
        latestUserMessage: "Run a structural component audit on this Figma file",
        figmaMcpCallAttempted: false,
        figmaMcpFailureSeen: false,
      }),
    ).toBe(false);
  });
});
