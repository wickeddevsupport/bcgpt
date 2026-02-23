import { describe, expect, it, vi } from "vitest";

describe("config workspace agent id validation", () => {
  it("accepts agents.list entries with workspaceId", async () => {
    vi.resetModules();
    const { validateConfigObjectWithPlugins } = await import("./config.js");
    const res = validateConfigObjectWithPlugins({
      agents: {
        list: [
          {
            id: "alpha",
            workspaceId: "ws-test",
          },
        ],
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      throw new Error(
        `validation unexpectedly failed: ${JSON.stringify(res.errors?.map((e) => e.message))}`,
      );
    }
    expect(res.config.agents?.list?.[0]).toMatchObject({
      id: "alpha",
      workspaceId: "ws-test",
    });
  });
});
