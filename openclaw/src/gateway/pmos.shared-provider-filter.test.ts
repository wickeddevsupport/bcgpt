import { describe, expect, it } from "vitest";
import { __test } from "./server-methods/pmos.js";

describe("pmos shared provider filtering", () => {
  it("keeps shared Kilo providers and primary model in effective config for workspace users", () => {
    const filtered = __test.filterEffectiveConfigForWorkspaceUi(
      {
        agents: {
          defaults: {
            model: {
              primary: "kilo/minimax/minimax-m2.5:free",
            },
            models: {
              "kilo/minimax/minimax-m2.5:free": {
                alias: "Kilo Free",
              },
            },
          },
        },
        models: {
          providers: {
            kilo: {
              baseUrl: "https://api.kilo.ai/api/gateway",
              api: "openai-completions",
              models: [{ id: "minimax/minimax-m2.5:free" }],
            },
          },
        },
      },
      {},
    ) as Record<string, any>;

    expect(filtered.models?.providers?.kilo).toBeTruthy();
    expect(filtered.agents?.defaults?.model?.primary).toBe("kilo/minimax/minimax-m2.5:free");
    expect(filtered.agents?.defaults?.models?.["kilo/minimax/minimax-m2.5:free"]).toEqual(
      expect.objectContaining({ alias: "Kilo Free" }),
    );
  });
});
