import { describe, expect, it, vi } from "vitest";
import {
  hydratePmosConnectorDraftsFromConfig,
  savePmosConnectorsConfig,
  type PmosConnectorsState,
} from "./pmos-connectors.ts";

function createBaseState(): PmosConnectorsState {
  return {
    client: null,
    connected: true,
    configSnapshot: null,
    pmosOpsUrl: "https://ops.wickedlab.io",
    pmosBcgptUrl: "https://bcgpt.wickedlab.io",
    pmosBcgptApiKeyDraft: "",
    pmosConnectorDraftsInitialized: false,
    pmosConnectorsLoading: false,
    pmosConnectorsStatus: null,
    pmosConnectorsError: null,
    pmosConnectorsLastChecked: null,
    pmosIntegrationsSaving: false,
    pmosIntegrationsError: null,
  };
}

describe("pmos-connectors", () => {
  it("uses ops default URL when ops URL is missing", () => {
    const state = createBaseState();
    state.configSnapshot = {
      hash: "h1",
      raw: "{}",
      config: {
        pmos: {
          connectors: {
            bcgpt: { url: "https://bcgpt.example.test" },
          },
        },
      },
    } as any;

    hydratePmosConnectorDraftsFromConfig(state);

    expect(state.pmosOpsUrl).toBe("https://ops.wickedlab.io");
  });

  it("saves ops + bcgpt config and prunes deprecated activepieces connector keys", async () => {
    const state = createBaseState();
    state.pmosOpsUrl = "https://ops.example.test/";
    state.pmosBcgptUrl = "https://bcgpt.example.test/";
    state.pmosBcgptApiKeyDraft = "bcgpt-key";

    let latestConfig: Record<string, unknown> = {
      pmos: {
        connectors: {
          activepieces: {
            url: "https://flow.example.test",
            projectId: "legacy-project",
            apiKey: "legacy-key",
          },
          bcgpt: {
            url: "https://bcgpt.old.test",
          },
        },
      },
    };

    let persistedRaw = "";
    const request = vi.fn(async (method: string, params: any) => {
      if (method === "config.get") {
        return {
          hash: "h1",
          raw: JSON.stringify(latestConfig),
          config: latestConfig,
        };
      }
      if (method === "config.set") {
        persistedRaw = String(params?.raw ?? "");
        latestConfig = JSON.parse(persistedRaw) as Record<string, unknown>;
        return { ok: true };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    state.client = { request } as any;

    await savePmosConnectorsConfig(state);

    const parsed = JSON.parse(persistedRaw) as any;
    expect(parsed.pmos.connectors.ops.url).toBe("https://ops.example.test");
    expect(parsed.pmos.connectors.bcgpt.url).toBe("https://bcgpt.example.test");
    expect(parsed.pmos.connectors.bcgpt.apiKey).toBe("bcgpt-key");
    expect(parsed.pmos.connectors.activepieces).toBeUndefined();
  });
});
