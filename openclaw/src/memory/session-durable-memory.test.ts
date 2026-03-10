import { describe, expect, it } from "vitest";
import {
  extractSessionDurableMemory,
  type ResolvedSessionMemoryConfig,
} from "./session-durable-memory.js";

const CONFIG: ResolvedSessionMemoryConfig = {
  includeAssistant: true,
  recentTurns: 4,
  durableFacts: {
    enabled: true,
    generatedDir: "memory/.derived-sessions",
    maxFactsPerSession: 12,
    minChars: 24,
    includeCompactions: true,
  },
};

describe("session durable memory extraction", () => {
  it("preserves durable user requirements and compaction summaries", () => {
    const raw = [
      JSON.stringify({ type: "session", version: 1, id: "sess-1" }),
      JSON.stringify({
        message: {
          role: "user",
          content:
            "We need to use FM MCP for file management tasks and keep official Figma access for document audits.",
        },
      }),
      JSON.stringify({
        message: {
          role: "assistant",
          content:
            "Decision: use PAT-backed REST audit as the fallback when official Figma MCP auth fails.",
        },
      }),
      JSON.stringify({
        type: "compaction",
        id: "comp-1",
        summary: "Preserved routing decision between FM MCP and official Figma access.",
      }),
    ].join("\n");

    const extracted = extractSessionDurableMemory({
      raw,
      sessionPath: "sessions/sess-1.jsonl",
      config: CONFIG,
    });

    expect(extracted.sessionIndexText).toContain("Durable facts:");
    expect(extracted.sessionIndexText).toContain("Compaction summaries:");
    expect(extracted.sessionIndexText).toContain("User requirement:");
    expect(extracted.sessionIndexText).toContain("Assistant decision:");
    expect(extracted.durableMemoryText).toContain("Preserved routing decision");
    expect(extracted.stats.durableFacts).toBe(2);
    expect(extracted.stats.compactions).toBe(1);
  });

  it("filters short noise and still keeps recent turns", () => {
    const raw = [
      JSON.stringify({ type: "session", version: 1, id: "sess-2" }),
      JSON.stringify({ message: { role: "user", content: "hi" } }),
      JSON.stringify({
        message: {
          role: "user",
          content: "Please make sure memory persists across deployments and container rebuilds.",
        },
      }),
      JSON.stringify({ message: { role: "assistant", content: "Okay" } }),
    ].join("\n");

    const extracted = extractSessionDurableMemory({
      raw,
      sessionPath: "sessions/sess-2.jsonl",
      config: CONFIG,
    });

    expect(extracted.sessionIndexText).toContain("Recent turns:");
    expect(extracted.sessionIndexText).toContain("memory persists across deployments");
    expect(extracted.durableMemoryText).not.toContain("- User requirement: hi");
  });
});
