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
});
