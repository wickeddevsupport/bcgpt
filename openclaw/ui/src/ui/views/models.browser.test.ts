import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderModels } from "./models.ts";

function baseProps() {
  return {
    connected: true,
    modelAlias: "",
    modelApiKeyDraft: "",
    modelApiKeyEditable: false,
    modelApiKeyStored: false,
    modelBaseUrl: "",
    modelApiType: "",
    modelSaving: false,
    modelConfigured: false,
    modelError: null,
    modelSavedOk: false,
    modelRefDraft: "openai/gpt-5.2",
    modelRows: [],
    modelCatalogLoading: false,
    modelCatalogError: null,
    modelOptions: [],
    agentModelAssignments: [],
    onModelRefDraftChange: vi.fn(),
    onModelAliasChange: vi.fn(),
    onModelApiKeyDraftChange: vi.fn(),
    onModelApiKeyEditToggle: vi.fn(),
    onModelBaseUrlChange: vi.fn(),
    onModelApiTypeChange: vi.fn(),
    onModelSave: vi.fn(),
    onModelSaveWithoutActivate: vi.fn(),
    onModelClearKey: vi.fn(),
    onModelClearKeyForRef: vi.fn(),
    onModelEdit: vi.fn(),
    onModelActivate: vi.fn(),
    onModelDeactivate: vi.fn(),
    onModelDelete: vi.fn(),
    onAssignAgentModel: vi.fn(),
  };
}

describe("models view", () => {
  it("renders card editing without the raw JSON snapshot", () => {
    const container = document.createElement("div");
    const props = baseProps();
    render(
      renderModels({
        ...props,
        modelApiKeyStored: true,
        modelConfigured: true,
        modelRows: [
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
            usedBy: [],
            workspaceOverride: true,
          },
        ],
      }),
      container,
    );

    expect(container.textContent).toContain("Edit");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).not.toContain("JSON snapshot");

    const editButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Edit",
    );
    expect(editButton).not.toBeUndefined();
  });

  it("labels shared providers without claiming a missing workspace key", () => {
    const container = document.createElement("div");
    render(
      renderModels({
        ...baseProps(),
        modelRefDraft: "ollama/qwen3:1.7b",
        modelRows: [
          {
            ref: "ollama/qwen3:1.7b",
            provider: "ollama",
            modelId: "qwen3:1.7b",
            alias: "Local Shared",
            active: true,
            keyConfigured: false,
            providerReady: true,
            sharedProvider: true,
            inCatalog: true,
            usedBy: [],
            workspaceOverride: true,
          },
        ],
      }),
      container,
    );

    expect(container.textContent).toContain("Local Ollama (Shared)");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).not.toContain("Remove Key");
  });
});
