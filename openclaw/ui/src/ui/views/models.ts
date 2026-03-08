import { html, nothing } from "lit";
import type { PmosAgentModelAssignment, PmosModelRow } from "../controllers/pmos-model-auth.ts";

export type ModelsProps = {
  connected: boolean;
  modelAlias: string;
  modelApiKeyDraft: string;
  modelApiKeyEditable: boolean;
  modelApiKeyStored: boolean;
  /** API base URL for the selected provider (e.g. https://api.kilo.ai/v1) */
  modelBaseUrl: string;
  /** API type for the provider (e.g. openai-completions, anthropic-messages) */
  modelApiType: string;
  modelSaving: boolean;
  modelConfigured: boolean;
  modelError: string | null;
  modelSavedOk?: boolean;
  modelRefDraft: string;
  modelRows: PmosModelRow[];
  modelCatalogLoading: boolean;
  modelCatalogError: string | null;
  modelOptions: string[];
  agentModelAssignments: PmosAgentModelAssignment[];
  onModelRefDraftChange: (next: string) => void;
  onModelAliasChange: (next: string) => void;
  onModelApiKeyDraftChange: (next: string) => void;
  onModelApiKeyEditToggle: (editable: boolean) => void;
  onModelBaseUrlChange: (next: string) => void;
  onModelApiTypeChange: (next: string) => void;
  onModelSave: () => void;
  onModelSaveWithoutActivate: () => void;
  onModelClearKey: () => void;
  onModelClearKeyForRef: (ref: string) => void;
  onModelEdit: (ref: string) => void;
  onModelActivate: (ref: string) => void;
  onModelDeactivate: (ref: string) => void;
  onModelDelete: (ref: string) => void;
  onAssignAgentModel: (agentId: string, ref: string | null) => void;
};

function renderModelToneChip(text: string, tone: "ok" | "warn" | "muted" = "muted") {
  const color =
    tone === "ok"
      ? "rgba(34,197,94,0.15)"
      : tone === "warn"
        ? "rgba(245,158,11,0.15)"
        : "rgba(148,163,184,0.18)";
  const border =
    tone === "ok"
      ? "rgba(34,197,94,0.35)"
      : tone === "warn"
        ? "rgba(245,158,11,0.35)"
        : "rgba(148,163,184,0.28)";
  return html`
    <span
      style="
        display:inline-flex;
        align-items:center;
        gap:6px;
        padding:2px 8px;
        font-size:11px;
        border-radius:999px;
        background:${color};
        border:1px solid ${border};
      "
    >${text}</span>
  `;
}

function buildModelOptions(rows: PmosModelRow[], options: string[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.ref.trim()) {
      set.add(row.ref.trim());
    }
  }
  for (const opt of options) {
    if (opt.trim()) {
      set.add(opt.trim());
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function parseModelRef(
  value: string | null | undefined,
): { provider: string; modelId: string } | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const split = raw.indexOf("/");
  if (split <= 0) {
    return null;
  }
  const provider = raw.slice(0, split).trim().toLowerCase();
  const modelId = raw.slice(split + 1).trim();
  if (!provider || !modelId) {
    return null;
  }
  return { provider, modelId };
}

function buildProviderOptions(modelOptions: string[], rows: PmosModelRow[]): string[] {
  const set = new Set<string>([
    "openai",
    "anthropic",
    "google",
    "zai",
    "openrouter",
    "kilo",
    "moonshot",
    "nvidia",
    "custom",
  ]);
  for (const row of rows) {
    const provider = row.provider.trim().toLowerCase();
    if (provider) {
      set.add(provider);
    }
  }
  for (const ref of modelOptions) {
    const parsed = parseModelRef(ref);
    if (parsed?.provider) {
      set.add(parsed.provider);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function buildModelIdOptionsForProvider(provider: string, modelOptions: string[]): string[] {
  const normalizedProvider = provider.trim().toLowerCase();
  if (!normalizedProvider) {
    return [];
  }
  const set = new Set<string>();
  for (const ref of modelOptions) {
    const parsed = parseModelRef(ref);
    if (!parsed || parsed.provider !== normalizedProvider) {
      continue;
    }
    set.add(parsed.modelId);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function splitModelRefDraft(value: string | null | undefined): { provider: string; modelId: string } {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return { provider: "", modelId: "" };
  }
  const split = raw.indexOf("/");
  if (split < 0) {
    return { provider: raw.toLowerCase(), modelId: "" };
  }
  return {
    provider: raw.slice(0, split).trim().toLowerCase(),
    modelId: raw.slice(split + 1).trim(),
  };
}

function composeModelRef(provider: string, modelId: string): string {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModelId = modelId.trim();
  if (!normalizedProvider && !normalizedModelId) {
    return "";
  }
  if (!normalizedProvider) {
    return normalizedModelId;
  }
  if (!normalizedModelId) {
    return `${normalizedProvider}/`;
  }
  return `${normalizedProvider}/${normalizedModelId}`;
}

export function renderModels(props: ModelsProps) {
  const disabledReason = !props.connected
    ? "Sign in to your workspace to configure models."
    : null;
  const keyLocked =
    props.modelApiKeyStored && !props.modelApiKeyEditable && !props.modelApiKeyDraft.trim();
  const modelKeyPlaceholder = keyLocked
    ? "Stored (click Edit key to replace)"
    : props.modelApiKeyStored
      ? "Stored (leave blank to keep current key)"
      : "Paste provider API key";

  const modelRows = props.modelRows ?? [];
  const modelOptions = buildModelOptions(modelRows, props.modelOptions ?? []);
  const providerOptions = buildProviderOptions(modelOptions, modelRows);
  const draft = splitModelRefDraft(props.modelRefDraft);
  const modelIdOptions = buildModelIdOptionsForProvider(draft.provider, modelOptions);
  const draftRef = composeModelRef(draft.provider, draft.modelId);
  const modelRefReady = Boolean(parseModelRef(draftRef));
  const activeModel = modelRows.find((row) => row.active) ?? null;
  const assignments = props.agentModelAssignments ?? [];
  const assignedRefs = new Set(
    assignments
      .map((assignment) => assignment.modelRef?.trim() ?? "")
      .filter(Boolean),
  );
  const savedRows = modelRows.filter(
    (row) => row.workspaceOverride || row.active || assignedRefs.has(row.ref),
  );
  const selectedSavedRow = savedRows.find((row) => row.ref === draftRef) ?? null;
  const editorStatusText = props.modelApiKeyStored
    ? "A provider key is already stored for this provider. Use Edit Key only when you want to replace it."
    : selectedSavedRow?.sharedProvider
      ? "This provider is coming from shared workspace configuration. No workspace API key is stored here."
      : "No provider key is stored for this provider yet.";
  const editorStatusTone = props.modelApiKeyStored
    ? "ok"
    : selectedSavedRow?.sharedProvider
      ? "muted"
      : "warn";

  return html`
    <div style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.2fr); gap:18px; align-items:start;">

    <!-- Left column: configured model cards -->
    <div>
      <section class="card" style="margin-bottom:16px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <div class="card-title">Models</div>
            <div class="card-sub">Workspace defaults, keys, and agent assignments.</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${activeModel
              ? renderModelToneChip(`Active: ${activeModel.ref}`, "ok")
              : renderModelToneChip("No active default", "warn")}
            ${props.modelCatalogLoading ? renderModelToneChip("Catalog loading", "muted") : nothing}
          </div>
        </div>
      </section>

      <section class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <div class="card-title">Configured Model Cards</div>
            <div class="card-sub">Manage defaults, keys, and per-agent activation.</div>
          </div>
          <div class="muted">${savedRows.length} card${savedRows.length === 1 ? "" : "s"}</div>
        </div>

        ${savedRows.length === 0
          ? html`
              <div class="callout" style="margin-top:12px;">
                No model cards yet. Add a model in the editor and click <span class="mono">Save Model</span>.
              </div>
            `
          : html`
              <div class="agent-cards-grid" style="margin-top:14px;">
                ${savedRows.map((row) => {
                  const rowAssignments = assignments
                    .filter((assignment) => assignment.modelRef === row.ref)
                    .sort((a, b) => a.label.localeCompare(b.label));
                  return html`
                    <div class="agent-card ${row.active ? "agent-card--selected" : ""}">
                      <div class="agent-card-header">
                        <div class="agent-card-info">
                          <div class="agent-card-title mono">${row.ref}</div>
                          <div class="muted" style="font-size:12px; margin-top:4px;">
                            ${row.alias ? `Alias: ${row.alias}` : "No alias"}
                          </div>
                        </div>
                      </div>

                      <div class="chip-row" style="margin-top:10px;">
                        ${draftRef === row.ref ? renderModelToneChip("Editing", "ok") : nothing}
                        ${row.active ? renderModelToneChip("Workspace default", "ok") : nothing}
                        ${row.keyConfigured
                          ? renderModelToneChip("Key stored", "ok")
                          : row.sharedProvider
                            ? renderModelToneChip("Shared provider", "muted")
                            : renderModelToneChip("No key", "warn")}
                        ${row.workspaceOverride
                          ? renderModelToneChip("Saved in config", "muted")
                          : renderModelToneChip("Referenced only", "muted")}
                        ${!row.inCatalog
                          ? renderModelToneChip("Manual model", "muted")
                          : nothing}
                        ${rowAssignments.length > 0
                          ? renderModelToneChip(`Agents: ${rowAssignments.length}`, "muted")
                          : renderModelToneChip("Agents: 0", "muted")}
                      </div>

                      <div class="agent-card-actions">
                        <button
                          class="btn btn--sm"
                          ?disabled=${!props.connected || props.modelSaving}
                          @click=${() => props.onModelEdit(row.ref)}
                        >
                          Edit
                        </button>
                        ${!row.active
                          ? html`
                              <button
                                class="btn btn--sm"
                                ?disabled=${!props.connected || props.modelSaving}
                                @click=${() => props.onModelActivate(row.ref)}
                              >
                                Set Default
                              </button>
                            `
                          : nothing}
                        ${row.workspaceOverride
                          ? html`
                              <button
                                class="btn btn--sm"
                                ?disabled=${!props.connected || props.modelSaving}
                                @click=${() => props.onModelDeactivate(row.ref)}
                              >
                                Remove Default
                              </button>
                              <button
                                class="btn btn--sm"
                                ?disabled=${!props.connected || props.modelSaving}
                                @click=${() => {
                                  if (!window.confirm(`Delete model ${row.ref} from config?`)) {
                                    return;
                                  }
                                  props.onModelDelete(row.ref);
                                }}
                              >
                                Delete
                              </button>
                            `
                          : nothing}
                        <button
                          class="btn btn--sm"
                          ?disabled=${!props.connected || props.modelSaving || !row.keyConfigured}
                          @click=${() => props.onModelClearKeyForRef(row.ref)}
                        >
                          Remove Key
                        </button>
                      </div>

                      <details style="margin-top:10px;">
                        <summary class="muted" style="cursor:pointer;">
                          Agent assignments (${rowAssignments.length})
                        </summary>
                        <div style="display:grid; gap:8px; margin-top:10px;">
                          ${(props.agentModelAssignments ?? [])
                            .sort((a, b) => a.label.localeCompare(b.label))
                            .map((assignment) => {
                              const isCurrent = assignment.modelRef === row.ref;
                              const isExplicit = isCurrent && !assignment.inherited;
                              const statusText = isCurrent
                                ? (assignment.inherited ? "Using workspace default" : "Active in agent")
                                : (assignment.modelRef ? `Using ${assignment.modelRef}` : "Inherit workspace default");
                              return html`
                                <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
                                  <div style="min-width:0;">
                                    <div style="font-size:12px; font-weight:600;">${assignment.label}</div>
                                    <div class="muted mono" style="font-size:11px;">${statusText}</div>
                                  </div>
                                  <div class="row" style="gap:6px; flex-wrap:wrap;">
                                    ${isCurrent
                                      ? (isExplicit
                                        ? html`
                                            <button
                                              class="btn btn--sm"
                                              ?disabled=${!props.connected || props.modelSaving}
                                              @click=${() => props.onAssignAgentModel(assignment.agentId, null)}
                                            >
                                              Deactivate
                                            </button>
                                          `
                                        : html`
                                            <button
                                              class="btn btn--sm"
                                              ?disabled=${!props.connected || props.modelSaving}
                                              @click=${() => props.onAssignAgentModel(assignment.agentId, row.ref)}
                                            >
                                              Pin To Agent
                                            </button>
                                          `)
                                      : html`
                                          <button
                                            class="btn btn--sm"
                                            ?disabled=${!props.connected || props.modelSaving}
                                            @click=${() => props.onAssignAgentModel(assignment.agentId, row.ref)}
                                          >
                                            Activate
                                          </button>
                                        `}
                                  </div>
                                </div>
                              `;
                            })}
                        </div>
                      </details>
                    </div>
                  `;
                })}
              </div>
            `}

        ${disabledReason
          ? html`<div class="muted" style="margin-top:12px; font-size:13px;">${disabledReason}</div>`
          : nothing}
      </section>
    </div>

    <!-- Right column: model editor -->
    <div>
    <section class="card" style="margin-bottom:18px;">
        <div class="card-title">Model Editor</div>
        <div class="card-sub">Edit a saved card or define a new provider/model pair, then save it into the workspace.</div>

        <div class="form-grid" style="margin-top:14px; grid-template-columns: 1fr 2fr;">
          <label class="field">
            <span>Provider</span>
            <input
              list="pmos-model-provider-options"
              .value=${draft.provider}
              @input=${(e: Event) => {
                const nextProvider = (e.target as HTMLInputElement).value;
                props.onModelRefDraftChange(composeModelRef(nextProvider, draft.modelId));
              }}
              placeholder="e.g. zai, openai, anthropic"
              ?disabled=${!props.connected || props.modelSaving}
            />
            <datalist id="pmos-model-provider-options">
              ${providerOptions.map((opt) => html`<option value=${opt}></option>`)}
            </datalist>
          </label>
          <label class="field">
            <span>Model ID</span>
            <input
              list="pmos-model-id-options"
              .value=${draft.modelId}
              @input=${(e: Event) => {
                const nextModelId = (e.target as HTMLInputElement).value;
                props.onModelRefDraftChange(composeModelRef(draft.provider, nextModelId));
              }}
              placeholder=${draft.provider ? "e.g. glm-5, gpt-5, claude-opus-4-6" : "Select provider first"}
              ?disabled=${!props.connected || props.modelSaving || !draft.provider}
            />
            <datalist id="pmos-model-id-options">
              ${modelIdOptions.map((opt) => html`<option value=${opt}></option>`)}
            </datalist>
          </label>
          <label class="field">
            <span>Alias</span>
            <input
              .value=${props.modelAlias}
              @input=${(e: Event) => props.onModelAliasChange((e.target as HTMLInputElement).value)}
              placeholder="Optional alias"
              ?disabled=${!props.connected || props.modelSaving}
            />
          </label>
          <label class="field">
            <span>API Key</span>
            <input
              type="password"
              .value=${props.modelApiKeyDraft}
              @input=${(e: Event) =>
                props.onModelApiKeyDraftChange((e.target as HTMLInputElement).value)}
              placeholder=${modelKeyPlaceholder}
              autocomplete="off"
              ?disabled=${!props.connected || props.modelSaving || keyLocked}
            />
          </label>
          <label class="field">
            <span>API Base URL</span>
            <input
              type="url"
              .value=${props.modelBaseUrl}
              @input=${(e: Event) =>
                props.onModelBaseUrlChange((e.target as HTMLInputElement).value)}
              placeholder="e.g. https://api.kilo.ai/v1 (auto-filled for known providers)"
              ?disabled=${!props.connected || props.modelSaving}
            />
          </label>
          <label class="field">
            <span>API Type</span>
            <input
              list="pmos-model-api-type-options"
              .value=${props.modelApiType}
              @input=${(e: Event) =>
                props.onModelApiTypeChange((e.target as HTMLInputElement).value)}
              placeholder="e.g. openai-completions (auto-filled for known providers)"
              ?disabled=${!props.connected || props.modelSaving}
            />
            <datalist id="pmos-model-api-type-options">
              <option value="openai-completions"></option>
              <option value="openai-responses"></option>
              <option value="anthropic-messages"></option>
              <option value="google-generative-ai"></option>
            </datalist>
          </label>
          <label class="field full">
            <span>Model reference preview</span>
            <input class="mono" .value=${draftRef} readonly placeholder="provider/model-id" ?disabled=${true} />
          </label>
        </div>

        <div class="row" style="margin-top:8px; gap:8px; flex-wrap:wrap; align-items:center;">
          ${props.modelApiKeyStored
            ? html`
                <button
                  class="btn btn--secondary"
                  ?disabled=${!props.connected || props.modelSaving}
                  @click=${() => props.onModelApiKeyEditToggle(keyLocked)}
                >
                  ${keyLocked ? "Edit Key" : "Lock Key"}
                </button>
              `
            : nothing}
          <button
            class="btn btn--primary"
            ?disabled=${!props.connected || props.modelSaving || !modelRefReady}
            @click=${() => props.onModelSave()}
          >
            ${props.modelSaving ? "Saving..." : "Save and Activate"}
          </button>
          <button
            class="btn btn--secondary"
            ?disabled=${!props.connected || props.modelSaving || !modelRefReady}
            @click=${() => props.onModelSaveWithoutActivate()}
          >
            Save Model
          </button>
          <button
            class="btn btn--secondary"
            ?disabled=${!props.connected || props.modelSaving || !props.modelApiKeyStored}
            @click=${() => props.onModelClearKey()}
            title="Remove key for selected provider"
          >
            Remove provider key
          </button>
          ${props.modelSavedOk ? html`<span class="chip chip-ok">Saved</span>` : nothing}
        </div>
        <div style="margin-top:10px;">
          ${renderModelToneChip(editorStatusText, editorStatusTone)}
        </div>

        ${props.modelCatalogError
          ? html`<div class="callout warn" style="margin-top:10px; font-size:12px;">${props.modelCatalogError}</div>`
          : nothing}
        ${props.modelError
          ? html`<div class="callout danger" style="margin-top:10px; font-size:12px;">${props.modelError}</div>`
          : nothing}
    </section>
    </div><!-- end right column -->

    </div><!-- end 2-column grid -->
  `;
}
