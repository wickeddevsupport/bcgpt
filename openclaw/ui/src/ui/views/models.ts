import { html, nothing } from "lit";
import type { PmosAgentModelAssignment, PmosModelRow } from "../controllers/pmos-model-auth.ts";

export type ModelsProps = {
  connected: boolean;
  modelAlias: string;
  modelApiKeyDraft: string;
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
  onModelSave: () => void;
  onModelSaveWithoutActivate: () => void;
  onModelClearKey: () => void;
  onModelClearKeyForRef: (ref: string) => void;
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

function readJsonEditor(trigger: Event): Record<string, unknown> | null {
  const root = (trigger.currentTarget as HTMLElement | null)?.closest(".model-json-editor");
  const editor = root?.querySelector("textarea[data-model-json]") as HTMLTextAreaElement | null;
  if (!editor) {
    window.alert("JSON editor not found.");
    return null;
  }
  try {
    const parsed = JSON.parse(editor.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      window.alert("JSON must be an object.");
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    window.alert(`Invalid JSON: ${String(err)}`);
    return null;
  }
}

export function renderModels(props: ModelsProps) {
  const disabledReason = !props.connected
    ? "Sign in to your workspace to configure models."
    : null;
  const modelKeyPlaceholder = props.modelConfigured
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

  const jsonTemplate = JSON.stringify(
    {
      ref: draftRef || "provider/model-id",
      alias: props.modelAlias || "",
      apiKey: props.modelApiKeyDraft || "",
      activate: true,
    },
    null,
    2,
  );

  return html`
    <section class="card" style="margin-bottom:18px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div class="card-title">Models</div>
          <div class="card-sub">Card-based model management for workspace defaults, keys, and agent usage.</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${activeModel
            ? renderModelToneChip(`Active: ${activeModel.ref}`, "ok")
            : renderModelToneChip("No active default", "warn")}
          ${props.modelCatalogLoading ? renderModelToneChip("Catalog loading", "muted") : nothing}
        </div>
      </div>
    </section>

    <section class="grid grid-cols-2" style="margin-bottom:18px;">
      <div class="card">
        <div class="card-title">Add Or Update Model</div>
        <div class="card-sub">Type-ahead form with provider/model suggestions. Save to config when ready.</div>

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
              ?disabled=${!props.connected || props.modelSaving}
            />
          </label>
          <label class="field full">
            <span>Model reference preview</span>
            <input class="mono" .value=${draftRef} readonly placeholder="provider/model-id" ?disabled=${true} />
          </label>
        </div>

        <div class="row" style="margin-top:8px; gap:8px; flex-wrap:wrap; align-items:center;">
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
            ?disabled=${!props.connected || props.modelSaving || !props.modelConfigured}
            @click=${() => props.onModelClearKey()}
            title="Remove key for selected provider"
          >
            Remove provider key
          </button>
          ${props.modelSavedOk ? html`<span class="chip chip-ok">Saved</span>` : nothing}
        </div>

        ${props.modelCatalogError
          ? html`<div class="callout warn" style="margin-top:10px; font-size:12px;">${props.modelCatalogError}</div>`
          : nothing}
        ${props.modelError
          ? html`<div class="callout danger" style="margin-top:10px; font-size:12px;">${props.modelError}</div>`
          : nothing}
      </div>

      <div class="card model-json-editor">
        <div class="card-title">JSON Editor</div>
        <div class="card-sub">Configure model fields in JSON and apply directly to the form.</div>
        <label class="field" style="margin-top:12px;">
          <span>Model JSON</span>
          <textarea
            data-model-json
            class="mono"
            style="min-height:260px;"
            .value=${jsonTemplate}
            ?disabled=${!props.connected || props.modelSaving}
          ></textarea>
        </label>
        <div class="row" style="margin-top:8px; gap:8px; flex-wrap:wrap;">
          <button
            class="btn btn--secondary"
            ?disabled=${!props.connected || props.modelSaving}
            @click=${(e: Event) => {
              const parsed = readJsonEditor(e);
              if (!parsed) {
                return;
              }
              const refFromJson = typeof parsed.ref === "string" ? parsed.ref.trim() : "";
              const provider = typeof parsed.provider === "string" ? parsed.provider.trim() : "";
              const modelId = typeof parsed.modelId === "string" ? parsed.modelId.trim() : "";
              const nextRef = refFromJson || composeModelRef(provider, modelId);
              if (!parseModelRef(nextRef)) {
                window.alert("JSON must include a valid `ref` (provider/model) or provider + modelId.");
                return;
              }
              props.onModelRefDraftChange(nextRef);
              props.onModelAliasChange(typeof parsed.alias === "string" ? parsed.alias : "");
              props.onModelApiKeyDraftChange(typeof parsed.apiKey === "string" ? parsed.apiKey : "");
            }}
          >
            Apply JSON To Form
          </button>
        </div>
      </div>
    </section>

    <section class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div class="card-title">Configured Model Cards</div>
          <div class="card-sub">Manage defaults, keys, and per-agent activation from each card.</div>
        </div>
        <div class="muted">${savedRows.length} card${savedRows.length === 1 ? "" : "s"}</div>
      </div>

      ${savedRows.length === 0
        ? html`
            <div class="callout" style="margin-top:12px;">
              No model cards configured yet. Add your first model above and click <span class="mono">Save Model</span>.
            </div>
          `
        : html`
            <div class="agent-cards-grid" style="margin-top:14px;">
              ${savedRows.map((row) => {
                const rowAssignments = assignments
                  .filter((assignment) => assignment.modelRef === row.ref)
                  .sort((a, b) => a.label.localeCompare(b.label));
                const explicitAssignments = rowAssignments.filter((assignment) => !assignment.inherited);
                const inheritedAssignments = rowAssignments.filter((assignment) => assignment.inherited);
                const jsonSnapshot = JSON.stringify(
                  {
                    ref: row.ref,
                    alias: row.alias || "",
                    workspaceDefault: row.active,
                    keyConfigured: row.configured,
                    explicitAgents: explicitAssignments.map((a) => a.agentId),
                    inheritedAgents: inheritedAssignments.map((a) => a.agentId),
                  },
                  null,
                  2,
                );
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
                      ${row.active ? renderModelToneChip("Workspace default", "ok") : nothing}
                      ${row.configured
                        ? renderModelToneChip("Key configured", "ok")
                        : renderModelToneChip("No key", "warn")}
                      ${row.workspaceOverride
                        ? renderModelToneChip("Saved in config", "muted")
                        : renderModelToneChip("Referenced only", "muted")}
                      ${rowAssignments.length > 0
                        ? renderModelToneChip(`Agents: ${rowAssignments.length}`, "muted")
                        : renderModelToneChip("Agents: 0", "muted")}
                    </div>

                    <div class="agent-card-actions">
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
                        ?disabled=${!props.connected || props.modelSaving}
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

                    <details style="margin-top:8px;">
                      <summary class="muted" style="cursor:pointer;">JSON snapshot</summary>
                      <pre class="mono" style="margin-top:8px; white-space:pre-wrap; font-size:12px;">${jsonSnapshot}</pre>
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
  `;
}
