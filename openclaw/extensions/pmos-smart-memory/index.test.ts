import { describe, expect, it, vi } from "vitest";

describe("pmos-smart-memory plugin", () => {
  it("exposes disabled-by-default config", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.id).toBe("pmos-smart-memory");
    expect(plugin.name).toBe("PMOS Smart Memory");
    expect(plugin.configSchema?.parse?.({})).toMatchObject({
      enabled: false,
      recall: { enabled: true },
      capture: { enabled: true },
    });
  });

  it("registers lifecycle hooks", async () => {
    const { default: plugin } = await import("./index.js");
    const hooks = new Map<string, unknown>();

    plugin.register({
      pluginConfig: { enabled: true },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      on: (hookName: string, handler: unknown) => {
        hooks.set(hookName, handler);
      },
    } as never);

    expect(hooks.get("before_agent_start")).toBeTypeOf("function");
    expect(hooks.get("agent_end")).toBeTypeOf("function");
  });
});