import { describe, expect, it } from "vitest";
import { summarizeAgentLoopToolResult } from "./workflow-ai.js";

describe("workflow-ai Basecamp summarization", () => {
  it("summarizes project lists for early agent-loop exit", () => {
    const summary = summarizeAgentLoopToolResult("bcgpt_list_projects", {
      projects: [
        { name: "BCGPT Test Project", status: "active" },
        { name: "Client Ops", status: "active" },
      ],
    });

    expect(summary).toContain("Basecamp projects (2)");
    expect(summary).toContain("BCGPT Test Project");
  });

  it("prefers direct smart_action summaries when present", () => {
    const summary = summarizeAgentLoopToolResult("bcgpt_smart_action", {
      summary: "BCGPT Test Project: 3 open Basecamp tasks.",
      result: {
        action: "project_summary",
      },
    });

    expect(summary).toBe("BCGPT Test Project: 3 open Basecamp tasks.");
  });

  it("honors sufficient tool summaries from the PMOS bridge payload", () => {
    const summary = summarizeAgentLoopToolResult("bcgpt_smart_action", {
      sufficient: true,
      summary: "BCGPT Test Project is healthy with 32 open tasks.",
      result: {
        action: "project_summary",
      },
    });

    expect(summary).toBe("BCGPT Test Project is healthy with 32 open tasks.");
  });

  it("summarizes figma PAT audit reports for deterministic fallback output", () => {
    const summary = summarizeAgentLoopToolResult("figma_pat_audit_file", {
      requestedFocus: "components",
      file: { name: "Untitled UI" },
      summary: {
        pages: 3,
        totalNodes: 1284,
        componentsDefined: 42,
        componentSetsDefined: 8,
      },
      autoLayout: {
        autoLayoutContainers: 96,
      },
      typography: {
        uniqueFontFamilies: 3,
      },
      issues: [
        "14 container layers look like manual layout candidates.",
      ],
    });

    expect(summary).toContain("Figma components audit for Untitled UI");
    expect(summary).toContain("42 components");
    expect(summary).toContain("14 container layers");
  });

  it("summarizes FM tags for direct file-manager answers", () => {
    const summary = summarizeAgentLoopToolResult("fm_list_tags", [
      { id: 1, name: "Design System", fileCount: 12 },
      { id: 2, name: "Landing Page", fileCount: 4 },
    ]);

    expect(summary).toBe("FM tags (2): Design System (12), Landing Page (4).");
  });

  it("summarizes FM context readiness", () => {
    const summary = summarizeAgentLoopToolResult("fm_get_context", {
      user: { handle: "design" },
      activeConnection: { name: "Wicked Lab Team" },
      stats: { files: 88, tags: 14, folders: 5, categories: 7 },
    });

    expect(summary).toContain("FM is ready for design on Wicked Lab Team");
    expect(summary).toContain("88 files");
  });
});
