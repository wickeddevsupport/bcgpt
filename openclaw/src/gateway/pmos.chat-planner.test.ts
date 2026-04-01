import { describe, expect, it } from "vitest";
import { buildPmosChatExecutionPlan } from "./server-methods/pmos.js";

describe("buildPmosChatExecutionPlan", () => {
  it("keeps greeting-only chat in lean general mode", () => {
    const plan = buildPmosChatExecutionPlan({
      latestUserMessage: "hello",
      urlHints: {},
      pastedUrlCount: 0,
      hasScreenContext: false,
    });

    expect(plan.mode).toBe("general");
    expect(plan.needsLiveData).toBe(false);
    expect(plan.includeWorkspaceMemory).toBe(false);
    expect(plan.includeCredentials).toBe(false);
    expect(plan.responseStyle).toBe("concise");
  });

  it("classifies assigned-todo requests as project-manager briefings", () => {
    const plan = buildPmosChatExecutionPlan({
      latestUserMessage: "what are my overdue todos assigned to me today?",
      urlHints: {},
      pastedUrlCount: 0,
      hasScreenContext: false,
    });

    expect(plan.mode).toBe("basecamp_manager");
    expect(plan.needsLiveData).toBe(true);
    expect(plan.includeWorkspaceMemory).toBe(false);
    expect(plan.includeCredentials).toBe(false);
    expect(plan.responseStyle).toBe("project_manager");
    expect(plan.guidance.join("\n")).toContain("world-class project manager");
  });

  it("anchors figma requests to explicit files and screen context", () => {
    const plan = buildPmosChatExecutionPlan({
      latestUserMessage:
        "review comments and annotations on https://www.figma.com/file/abc123/Design-System?node-id=1-2",
      urlHints: {
        figmaUrl: "https://www.figma.com/file/abc123/Design-System?node-id=1-2",
      },
      pastedUrlCount: 1,
      hasScreenContext: true,
    });

    expect(plan.mode).toBe("figma");
    expect(plan.includeScreenContext).toBe(true);
    expect(plan.includeUrlHints).toBe(true);
    expect(plan.responseStyle).toBe("design_analyst");
  });

  it("uses cross-system mode for mixed Basecamp and Figma resources", () => {
    const plan = buildPmosChatExecutionPlan({
      latestUserMessage:
        "compare this Basecamp card with this Figma file and tell me what changed",
      urlHints: {
        basecampUrl: "https://3.basecamp.com/1/buckets/2/card_tables/cards/3",
        figmaUrl: "https://www.figma.com/file/abc123/Product",
      },
      pastedUrlCount: 2,
      hasScreenContext: false,
    });

    expect(plan.mode).toBe("cross_system");
    expect(plan.responseStyle).toBe("orchestrator");
    expect(plan.guidance.join("\n")).toContain("multiple systems");
  });

  it("loads workspace memory only for explicit workspace-ops questions", () => {
    const plan = buildPmosChatExecutionPlan({
      latestUserMessage: "what connectors are configured in this workspace?",
      urlHints: {},
      pastedUrlCount: 0,
      hasScreenContext: false,
    });

    expect(plan.mode).toBe("general");
    expect(plan.includeWorkspaceMemory).toBe(true);
    expect(plan.needsLiveData).toBe(true);
  });
});
