import { describe, expect, it } from "vitest";
import { mergeWorkspaceScopedAgents } from "./config.js";

describe("mergeWorkspaceScopedAgents", () => {
  it("replaces only the current workspace agent list and preserves others", () => {
    const current = {
      agents: {
        list: [
          { id: "alpha", workspaceId: "ws-a", model: "openai/gpt-4o" },
          { id: "beta", workspaceId: "ws-b", model: "openai/gpt-4.1" },
        ],
      },
    };
    const requested = {
      agents: {
        list: [{ id: "gamma", model: "kilo/z-ai/glm-5:free" }],
      },
    };
    const merged = mergeWorkspaceScopedAgents(current, requested, "ws-a");
    expect(merged.ok).toBe(true);
    if (!merged.ok) throw new Error(merged.error);
    const list = (merged.config.agents as { list?: unknown[] }).list ?? [];
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "beta", workspaceId: "ws-b" }),
        expect.objectContaining({ id: "gamma", workspaceId: "ws-a" }),
      ]),
    );
    expect(list.find((entry) => (entry as { id?: string }).id === "alpha")).toBeUndefined();
  });

  it("rejects collisions with agents from other workspaces", () => {
    const current = {
      agents: {
        list: [{ id: "shared-id", workspaceId: "ws-b" }],
      },
    };
    const requested = {
      agents: {
        list: [{ id: "shared-id" }],
      },
    };
    const merged = mergeWorkspaceScopedAgents(current, requested, "ws-a");
    expect(merged.ok).toBe(false);
    if (merged.ok) throw new Error("expected merge to fail");
    expect(merged.error).toContain("already exists in another workspace");
  });

  it("rejects duplicate ids inside a workspace request", () => {
    const requested = {
      agents: {
        list: [{ id: "dup" }, { id: "dup" }],
      },
    };
    const merged = mergeWorkspaceScopedAgents({}, requested, "ws-a");
    expect(merged.ok).toBe(false);
    if (merged.ok) throw new Error("expected merge to fail");
    expect(merged.error).toContain("duplicate agent id");
  });
});
