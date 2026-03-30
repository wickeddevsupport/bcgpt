import { describe, expect, it, vi } from "vitest";
import {
  loadPmosModelWorkspaceState,
  selectPmosModelEditor,
  type PmosModelAuthState,
} from "./pmos-model-auth.ts";

function createState(): PmosModelAuthState {
  return {
    client: null,
    connected: true,
    pmosModelProvider: "openai",
    pmosModelId: "gpt-5.2",
    pmosModelAlias: "",
    pmosModelApiKeyDraft: "",
    pmosModelBaseUrl: "",
    pmosModelApiType: "",
    pmosModelSaving: false,
    pmosModelError: null,
    pmosModelConfigured: false,
    pmosModelApiKeyStored: false,
    pmosByokProviders: [],
    pmosWorkspaceConfig: null,
    pmosEffectiveConfig: null,
    pmosModelRows: [],
    pmosAgentModelAssignments: [],
    pmosModelCatalogLoading: false,
    pmosModelCatalogError: null,
    availableModels: [],
    pmosModelRefDraft: "",
  };
}

describe("pmos-model-auth", () => {
  it("distinguishes shared providers from stored API keys", async () => {
    const state = createState();
    state.client = {
      request: vi.fn(async (method: string) => {
        if (method === "pmos.config.workspace.get") {
          return {
            workspaceId: "ws-1",
            workspaceConfig: {},
            effectiveConfig: {
              agents: {
                defaults: {
                  model: {
                    primary: "ollama/qwen3:1.7b",
                  },
                  models: {
                    "openai/gpt-5.2": { alias: "Primary OpenAI" },
                    "ollama/qwen3:1.7b": { alias: "Shared Local" },
                  },
                },
                list: [
                  {
                    id: "assistant",
                    name: "Workspace Assistant",
                    model: "openai/gpt-5.2",
                  },
                ],
              },
              models: {
                providers: {
                  ollama: {
                    sharedForWorkspaces: true,
                    baseUrl: "http://127.0.0.1:11434/v1",
                    api: "openai-completions",
                  },
                  openai: {
                    apiKey: "sk-openai",
                    baseUrl: "https://api.openai.com/v1",
                    api: "openai-responses",
                  },
                },
              },
            },
          };
        }
        if (method === "models.list") {
          return {
            models: [
              { provider: "ollama", id: "qwen3:1.7b" },
              { provider: "openai", id: "gpt-5.2" },
            ],
          };
        }
        throw new Error(`Unexpected method ${method}`);
      }),
    } as any;

    await loadPmosModelWorkspaceState(state);

    expect(state.pmosModelProvider).toBe("ollama");
    expect(state.pmosModelConfigured).toBe(true);
    expect(state.pmosModelApiKeyStored).toBe(false);

    const rowByRef = new Map((state.pmosModelRows ?? []).map((row) => [row.ref, row]));
    expect(rowByRef.get("ollama/qwen3:1.7b")).toMatchObject({
      keyConfigured: false,
      sharedProvider: true,
      providerReady: true,
    });
    expect(rowByRef.get("openai/gpt-5.2")).toMatchObject({
      keyConfigured: true,
      sharedProvider: false,
      providerReady: true,
    });
  });

  it("loads a saved card into the editor without exposing the stored key", async () => {
    const state = createState();
    state.pmosByokProviders = ["openai"];
    state.pmosEffectiveConfig = {
      agents: {
        defaults: {
          models: {
            "openai/gpt-5.2": { alias: "Primary OpenAI" },
          },
        },
      },
      models: {
        providers: {
          openai: {
            apiKey: "sk-openai",
            baseUrl: "https://api.openai.com/v1",
            api: "openai-responses",
          },
        },
      },
    };
    state.pmosModelRows = [
      {
        ref: "openai/gpt-5.2",
        provider: "openai",
        modelId: "gpt-5.2",
        alias: "Primary OpenAI",
        active: true,
        keyConfigured: true,
        providerReady: true,
        sharedProvider: false,
        inCatalog: true,
        usedBy: ["Workspace Assistant"],
        workspaceOverride: true,
      },
    ];

    const loaded = selectPmosModelEditor(state, "openai/gpt-5.2");

    expect(loaded).toBe(true);
    expect(state.pmosModelProvider).toBe("openai");
    expect(state.pmosModelId).toBe("gpt-5.2");
    expect(state.pmosModelRefDraft).toBe("openai/gpt-5.2");
    expect(state.pmosModelAlias).toBe("Primary OpenAI");
    expect(state.pmosModelApiKeyDraft).toBe("");
    expect(state.pmosModelBaseUrl).toBe("https://api.openai.com/v1");
    expect(state.pmosModelApiType).toBe("openai-responses");
    expect(state.pmosModelApiKeyStored).toBe(true);
  });

  it("treats shared Kilo defaults as configured without a workspace key", async () => {
    const state = createState();
    state.client = {
      request: vi.fn(async (method: string) => {
        if (method === "pmos.config.workspace.get") {
          return {
            workspaceId: "ws-kilo",
            workspaceConfig: {
              agents: {
                defaults: {
                  model: {
                    primary: "kilo/minimax/minimax-m2.5:free",
                  },
                },
              },
            },
            effectiveConfig: {
              agents: {
                defaults: {
                  model: {
                    primary: "kilo/minimax/minimax-m2.5:free",
                  },
                  models: {
                    "kilo/minimax/minimax-m2.5:free": { alias: "Kilo Free" },
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
          };
        }
        if (method === "models.list") {
          return {
            models: [{ provider: "kilo", id: "minimax/minimax-m2.5:free" }],
          };
        }
        throw new Error(`Unexpected method ${method}`);
      }),
    } as any;

    await loadPmosModelWorkspaceState(state);

    expect(state.pmosModelProvider).toBe("kilo");
    expect(state.pmosModelId).toBe("minimax/minimax-m2.5:free");
    expect(state.pmosModelConfigured).toBe(true);
    expect(state.pmosModelApiKeyStored).toBe(false);

    const rowByRef = new Map((state.pmosModelRows ?? []).map((row) => [row.ref, row]));
    expect(rowByRef.get("kilo/minimax/minimax-m2.5:free")).toMatchObject({
      sharedProvider: true,
      providerReady: true,
      keyConfigured: false,
      active: true,
    });
  });

  it("keeps workspace model selectors scoped to the workspace allowlist", async () => {
    const state = createState();
    state.client = {
      request: vi.fn(async (method: string) => {
        if (method === "pmos.config.workspace.get") {
          return {
            workspaceId: "ws-copilot",
            workspaceConfig: {
              agents: {
                defaults: {
                  model: {
                    primary: "github-copilot/gpt-5.4",
                  },
                  models: {
                    "github-copilot/gpt-5.4": {},
                    "github-copilot/gpt-5-mini": {},
                  },
                },
              },
            },
            effectiveConfig: {
              agents: {
                defaults: {
                  model: {
                    primary: "github-copilot/gpt-5.4",
                  },
                  models: {
                    "github-copilot/gpt-5.4": {},
                    "github-copilot/gpt-5-mini": {},
                    "github-copilot/gpt-4o": {},
                    "openai/gpt-5.2": {},
                  },
                },
                list: [
                  {
                    id: "assistant",
                    name: "Workspace Assistant",
                    model: "github-copilot/gpt-5-mini",
                  },
                  {
                    id: "global-legacy",
                    name: "Global Legacy",
                    model: "openai/gpt-5.2",
                  },
                ],
              },
              models: {
                providers: {
                  "github-copilot": {
                    sharedForWorkspaces: true,
                    api: "openai-responses",
                    models: [{ id: "gpt-5.4" }, { id: "gpt-5-mini" }, { id: "gpt-4o" }],
                  },
                  openai: {
                    apiKey: "sk-openai",
                    baseUrl: "https://api.openai.com/v1",
                    api: "openai-responses",
                  },
                },
              },
            },
          };
        }
        if (method === "models.list") {
          return {
            models: [
              { provider: "github-copilot", id: "gpt-5.4" },
              { provider: "github-copilot", id: "gpt-5-mini" },
              { provider: "github-copilot", id: "gpt-4o" },
              { provider: "openai", id: "gpt-5.2" },
            ],
          };
        }
        throw new Error(`Unexpected method ${method}`);
      }),
    } as any;

    await loadPmosModelWorkspaceState(state);

    expect(state.availableModels).toEqual([
      "github-copilot/gpt-5-mini",
      "github-copilot/gpt-5.4",
    ]);
    expect((state.pmosModelRows ?? []).map((row) => row.ref)).toEqual([
      "github-copilot/gpt-5-mini",
      "github-copilot/gpt-5.4",
    ]);
  });
});
