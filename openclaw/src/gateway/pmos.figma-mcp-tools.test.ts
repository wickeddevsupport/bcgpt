import { describe, expect, it } from "vitest";
import { __test } from "./server-methods/pmos.js";
import { resolveWorkspaceIdFromFigmaMcpState } from "./figma-mcp-client.js";
import {
  normalizeFigmaMcpToolListResult,
  normalizeFigmaMcpToolName,
} from "./figma-mcp-service.js";

describe("pmos figma mcp tool normalization", () => {
  it("extracts workspace ids from PMOS-owned Figma MCP OAuth state tokens", () => {
    expect(resolveWorkspaceIdFromFigmaMcpState("workspace-123:nonce-456")).toBe("workspace-123");
    expect(resolveWorkspaceIdFromFigmaMcpState("missing-separator")).toBeNull();
  });

  it("accepts fully qualified figma MCP tool names", () => {
    expect(normalizeFigmaMcpToolName("figma.get_design_context")).toBe("get_design_context");
    expect(normalizeFigmaMcpToolName("get_metadata")).toBe("get_metadata");
  });

  it("adds short-name summaries and recommended starter tools to list output", () => {
    const result = normalizeFigmaMcpToolListResult({
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
