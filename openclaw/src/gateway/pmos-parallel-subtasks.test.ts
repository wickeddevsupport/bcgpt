import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  runPmosParallelSubtasks,
  summarizePmosParallelSubtasks,
} from "./pmos-parallel-subtasks.js";
import { callWorkspaceModelAgentLoop } from "./workflow-ai.js";

vi.mock("./workflow-ai.js", () => ({
  callWorkspaceModelAgentLoop: vi.fn(),
}));

describe("pmos-parallel-subtasks", () => {
  beforeEach(() => {
    vi.mocked(callWorkspaceModelAgentLoop).mockReset();
  });

  it("runs each subtask through the workspace agent loop and removes recursive tool access", async () => {
    vi.mocked(callWorkspaceModelAgentLoop)
      .mockResolvedValueOnce({
        ok: true,
        text: "Figma findings memo",
        providerUsed: "kilo",
      })
      .mockResolvedValueOnce({
        ok: true,
        text: "Basecamp findings memo",
        providerUsed: "kilo",
      });

    const executeTool = vi.fn(async () => "{}");
    const result = await runPmosParallelSubtasks({
      workspaceId: "ws-1",
      baseSystemPrompt: "Base system prompt",
      userMessages: [{ role: "user", content: "Analyze these two URLs together." }],
      tasks: [
        { label: "Figma", task: "Inspect the Figma file comments and annotations." },
        { label: "Basecamp", task: "Inspect the Basecamp card and comments." },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "pmos_parallel_subtasks",
            description: "parallel",
            parameters: { type: "object", properties: {} },
          },
        },
        {
          type: "function",
          function: {
            name: "figma_pat_audit_file",
            description: "audit",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      executeTool,
      maxIterations: 3,
    });

    expect(result.summary).toContain("2/2");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.text).toBe("Figma findings memo");
    expect(result.results[1]?.text).toBe("Basecamp findings memo");

    const firstCall = vi.mocked(callWorkspaceModelAgentLoop).mock.calls[0];
    expect(firstCall?.[0]).toBe("ws-1");
    expect(firstCall?.[1]).toContain("## Subagent Mode");
    expect(firstCall?.[2][1]?.content).toContain("Label: Figma");
    expect(firstCall?.[3].map((tool) => tool.function.name)).toEqual(["figma_pat_audit_file"]);
    expect(firstCall?.[5]).toMatchObject({
      maxIterations: 3,
      allowToolResultEarlyExit: false,
    });
  });

  it("reports failures in the aggregate summary", () => {
    const summary = summarizePmosParallelSubtasks([
      { label: "Figma", task: "Inspect figma", ok: true, text: "done" },
      { label: "Basecamp", task: "Inspect basecamp", ok: false, error: "timeout" },
    ]);

    expect(summary).toContain("1/2");
    expect(summary).toContain("failed");
    expect(summary).toContain("Figma");
    expect(summary).toContain("Basecamp");
  });
});
