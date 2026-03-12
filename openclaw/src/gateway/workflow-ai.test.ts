import { describe, expect, it } from "vitest";
import { buildAgentLoopEarlyExit, summarizeAgentLoopToolResult } from "./workflow-ai.js";

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

  it("summarizes Basecamp MCP tool discovery payloads", () => {
    const summary = summarizeAgentLoopToolResult("bcgpt_list_tools", {
      tools: [
        { name: "list_projects" },
        { name: "list_todolists" },
        { name: "list_todos_for_project" },
      ],
    });

    expect(summary).toContain("Basecamp MCP tools available (3)");
    expect(summary).toContain("list_todolists");
  });

  it("summarizes direct Basecamp MCP calls", () => {
    const summary = summarizeAgentLoopToolResult("bcgpt_mcp_call", {
      tool: "list_todolists",
      summary: "Rohit's ToDo's todo lists (26): EOD (23 open), By Next Day (14 open), ...",
    });

    expect(summary).toContain("Rohit's ToDo's todo lists (26)");
  });

  it("summarizes raw Basecamp bridge payloads when present", () => {
    const summary = summarizeAgentLoopToolResult("bcgpt_basecamp_raw", {
      method: "GET",
      path: "/buckets/45864540/card_tables/cards/9515058775",
      summary: "Card 9515058775 is blocked on missing copy approval.",
    });

    expect(summary).toBe("Card 9515058775 is blocked on missing copy approval.");
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

  it("does not early-exit when Basecamp results are marked as continuation context", () => {
    const summary = buildAgentLoopEarlyExit([
      {
        name: "bcgpt_smart_action",
        args: { query: "Summarize Project X and suggest next steps" },
        parsed: {
          continueAgentLoop: true,
          summary: "Project X has 3 overdue tasks.",
          result: {
            action: "project_summary",
          },
        },
        callCount: 1,
      },
    ]);

    expect(summary).toBeNull();
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

  it("does not early-exit on figma context alone", () => {
    const summary = buildAgentLoopEarlyExit([
      {
        name: "figma_get_context",
        args: {},
        parsed: {
          connected: true,
          selectedFileName: "Panel Selection",
          activeConnectionName: "Product Design",
        },
        callCount: 1,
      },
    ]);

    expect(summary).toBeNull();
  });

  it("can early-exit once a figma audit completes after context", () => {
    const summary = buildAgentLoopEarlyExit([
      {
        name: "figma_get_context",
        args: {},
        parsed: {
          connected: true,
          selectedFileName: "Panel Selection",
          activeConnectionName: "Product Design",
        },
        callCount: 1,
      },
      {
        name: "figma_pat_audit_file",
        args: { file_key: "3INmNiG3X3NKAZtCI3SMg6" },
        parsed: {
          requestedFocus: "general",
          file: { name: "OKA Online Audit" },
          summary: {
            pages: 2,
            totalNodes: 512,
            componentsDefined: 18,
          },
        },
        callCount: 1,
      },
    ]);

    expect(summary).toContain("Figma general audit for OKA Online Audit");
  });

  it("does not early-exit when a figma audit is marked as continuation context", () => {
    const summary = buildAgentLoopEarlyExit([
      {
        name: "figma_pat_audit_file",
        args: { file_key: "3INmNiG3X3NKAZtCI3SMg6" },
        parsed: {
          continueAgentLoop: true,
          requestedFocus: "general",
          file: { name: "OKA Online Audit" },
          summary: {
            pages: 1,
            totalNodes: 37,
            componentsDefined: 0,
          },
        },
        callCount: 1,
      },
    ]);

    expect(summary).toBeNull();
  });
});
