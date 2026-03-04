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
    pmosOpsUserEmailDraft: "",
    pmosOpsUserPasswordDraft: "",
    pmosOpsUserHasSavedPassword: false,
    pmosBcgptUrl: "https://bcgpt.wickedlab.io",
    pmosBcgptApiKeyDraft: "",
    pmosConnectorDraftsInitialized: false,
    pmosConnectorsLoading: false,
    pmosConnectorsStatus: null,
    pmosConnectorsError: null,
    pmosConnectorsLastChecked: null,
    pmosIntegrationsSaving: false,
    pmosIntegrationsError: null,
    pmosN8nCredentials: null,
    pmosN8nCredentialsLoading: false,
    pmosN8nCredentialsError: null,
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

    expect(state.pmosOpsUrl).toBe("https://flow.wickedlab.io");
  });

  it("saves ops + bcgpt config into workspace connectors", async () => {
    const state = createBaseState();
    state.pmosOpsUrl = "https://ops.example.test/";
    state.pmosOpsUserEmailDraft = "ops@example.test";
    state.pmosOpsUserPasswordDraft = "secret-pass";
    state.pmosBcgptUrl = "https://bcgpt.example.test/";
    state.pmosBcgptApiKeyDraft = "bcgpt-key";

    const request = vi.fn(async (method: string, params: any) => {
      if (method === "pmos.connectors.workspace.set") {
        expect(params.connectors.ops.url).toBe("https://ops.example.test");
        expect(params.connectors.ops.user.email).toBe("ops@example.test");
        expect(params.connectors.ops.user.password).toBe("secret-pass");
        expect(params.connectors.bcgpt.url).toBe("https://bcgpt.example.test");
        expect(params.connectors.bcgpt.apiKey).toBe("bcgpt-key");
        return { ok: true };
      }
      if (method === "pmos.connectors.workspace.get") {
        return {
          workspaceId: "ws-test",
          connectors: {
            ops: {
              url: "https://ops.example.test",
              user: { email: "ops@example.test", hasPassword: true },
            },
            bcgpt: { url: "https://bcgpt.example.test" },
          },
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    state.client = { request } as any;

    await savePmosConnectorsConfig(state);

    expect(state.pmosOpsUrl).toBe("https://ops.example.test");
    expect(state.pmosOpsUserEmailDraft).toBe("ops@example.test");
    expect(state.pmosOpsUserHasSavedPassword).toBe(true);
    expect(state.pmosOpsUserPasswordDraft).toBe("");
    expect(state.pmosBcgptUrl).toBe("https://bcgpt.example.test");
    expect(state.pmosBcgptApiKeyDraft).toBe("");
    expect(request).toHaveBeenCalledWith("pmos.connectors.workspace.set", expect.any(Object));
    expect(request).toHaveBeenCalledWith("pmos.connectors.workspace.get", {});
  });

  it("clears workspace bcgpt api key explicitly", async () => {
    const state = createBaseState();
    state.pmosOpsUrl = "https://ops.example.test/";
    state.pmosBcgptUrl = "https://bcgpt.example.test/";
    state.pmosBcgptApiKeyDraft = "";

    const request = vi.fn(async (method: string, params: any) => {
      if (method === "pmos.connectors.workspace.set") {
        expect(params.connectors.ops.url).toBe("https://ops.example.test");
        expect(params.connectors.bcgpt.url).toBe("https://bcgpt.example.test");
        expect(params.connectors.bcgpt.apiKey).toBeNull();
        return { ok: true };
      }
      if (method === "pmos.connectors.workspace.get") {
        return {
          workspaceId: "ws-test",
          connectors: {
            ops: { url: "https://ops.example.test" },
            bcgpt: { url: "https://bcgpt.example.test", apiKey: null },
          },
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });

    state.client = { request } as any;

    await savePmosConnectorsConfig(state, { clearBcgptKey: true });

    expect(request).toHaveBeenCalledWith(
      "pmos.connectors.workspace.set",
      expect.objectContaining({
        connectors: expect.objectContaining({
          bcgpt: expect.objectContaining({ apiKey: null }),
        }),
      }),
    );
  });
});
