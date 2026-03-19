import { html, nothing } from "lit";
import {
  PMOS_MODEL_PROVIDER_OPTIONS,
  type PmosAgentModelAssignment,
  type PmosModelRow,
} from "../controllers/pmos-model-auth.ts";

export type ModelsProps = {
  connected: boolean;
  modelAlias: string;
  modelApiKeyDraft: string;
  modelApiKeyEditable: boolean;
  modelApiKeyStored: boolean;
  modelBaseUrl: string;
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

function statusDot(tone: "ok" | "warn" | "muted") {
  const colors = { ok: "#22c55e", warn: "#f59e0b", muted: "#64748b" };
  return html`<span class="model-status-dot" style="background:${colors[tone]}"></span>`;
}

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  return normalized === "local-ollama" ? "ollama" : normalized;
}

function providerEmoji(provider: string): string {
  const map: Record<string, string> = {
    openai: "O",
    anthropic: "A",
    google: "G",
    kilo: "K",
    zai: "Z",
    openrouter: "R",
    moonshot: "M",
    nvidia: "N",
    ollama: "L",
    "ollama-cloud": "L",
    custom: "C",
  };
  return map[normalizeProvider(provider)] ?? provider.charAt(0).toUpperCase();
}

function providerLabel(provider: string): string {
  const normalized = normalizeProvider(provider);
  const known = PMOS_MODEL_PROVIDER_OPTIONS.find(
    (entry) => normalizeProvider(entry.value) === normalized,
  );
  if (known) {
    return known.label;
  }
  if (!normalized) {
    return "Provider";
  }
  return normalized
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildModelOptions(rows: PmosModelRow[], options: string[]): string[] {
  const set = new Set<string>();
  rows.forEach((row) => {
    if (row.ref.trim()) {
      set.add(row.ref.trim());
    }
  });
  options.forEach((option) => {
    if (option.trim()) {
      set.add(option.trim());
    }
  });
  return Array.from(set).sort((left, right) => left.localeCompare(right));
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
  const provider = normalizeProvider(raw.slice(0, split));
  const modelId = raw.slice(split + 1).trim();
  if (!provider || !modelId) {
    return null;
  }
  return { provider, modelId };
}

function splitModelRefDraft(
  value: string | null | undefined,
): { provider: string; modelId: string } {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return { provider: "", modelId: "" };
  }
  const split = raw.indexOf("/");
  if (split < 0) {
    return { provider: normalizeProvider(raw), modelId: "" };
  }
  return {
    provider: normalizeProvider(raw.slice(0, split)),
    modelId: raw.slice(split + 1).trim(),
  };
}

function composeModelRef(provider: string, modelId: string): string {
  const normalizedProvider = normalizeProvider(provider);
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

function buildProviderOptions(modelOptions: string[], rows: PmosModelRow[]): string[] {
  const set = new Set<string>(
    PMOS_MODEL_PROVIDER_OPTIONS.map((entry) => normalizeProvider(entry.value)),
  );
  rows.forEach((row) => {
    if (row.provider.trim()) {
      set.add(normalizeProvider(row.provider));
    }
  });
  modelOptions.forEach((ref) => {
    const parsed = parseModelRef(ref);
    if (parsed?.provider) {
      set.add(parsed.provider);
    }
  });
  return Array.from(set).sort((left, right) => left.localeCompare(right));
}

function buildModelIdOptionsForProvider(provider: string, modelOptions: string[]): string[] {
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider) {
    return [];
  }
  const set = new Set<string>();
  modelOptions.forEach((ref) => {
    const parsed = parseModelRef(ref);
    if (parsed && parsed.provider === normalizedProvider) {
      set.add(parsed.modelId);
    }
  });
  return Array.from(set).sort((left, right) => left.localeCompare(right));
}

function modelStatus(row: PmosModelRow): {
  tone: "ok" | "warn" | "muted";
  label: string;
} {
  if (row.active) {
    return { tone: "ok", label: "Default" };
  }
  if (row.keyConfigured || row.providerReady) {
    return { tone: "ok", label: "Ready" };
  }
  return { tone: "warn", label: "Needs key" };
}

export function renderModels(props: ModelsProps) {
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
    assignments.map((assignment) => assignment.modelRef?.trim() ?? "").filter(Boolean),
  );
  const savedRows = modelRows.filter(
    (row) => row.workspaceOverride || row.active || assignedRefs.has(row.ref),
  );
  const readyRows = savedRows.filter((row) => row.keyConfigured || row.providerReady);
  const providerCount = new Set(savedRows.map((row) => normalizeProvider(row.provider))).size;
  const draftAssignments = draftRef
    ? assignments.filter((assignment) => assignment.modelRef === draftRef)
    : [];
  const isEditing = savedRows.some((row) => row.ref === draftRef);

  const keyLocked =
    props.modelApiKeyStored && !props.modelApiKeyEditable && !props.modelApiKeyDraft.trim();
  const modelKeyPlaceholder = keyLocked
    ? "Stored (click Edit to replace)"
    : props.modelApiKeyStored
      ? "Stored (leave blank to keep)"
      : "Paste provider API key";

  const providerCards = PMOS_MODEL_PROVIDER_OPTIONS.map((provider) => {
    const normalizedProvider = normalizeProvider(provider.value);
    const rowsForProvider = savedRows.filter(
      (row) => normalizeProvider(row.provider) === normalizedProvider,
    );
    const selected = normalizedProvider === draft.provider;
    const suggestedIds = buildModelIdOptionsForProvider(normalizedProvider, modelOptions);
    const suggestedModelId = draft.provider === normalizedProvider && draft.modelId
      ? draft.modelId
      : suggestedIds[0] ?? provider.defaultModelId ?? "";
    return {
      ...provider,
      normalizedProvider,
      selected,
      active: rowsForProvider.some((row) => row.active),
      ready: rowsForProvider.some((row) => row.keyConfigured || row.providerReady),
      savedCount: rowsForProvider.length,
      suggestedModelId,
    };
  });

  if (!props.connected) {
    return html`
      <div class="models-page">
        <section class="card">
          <div class="models-empty">
            <div class="models-empty__icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4">
                <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                <path d="M2 17l10 5 10-5"></path>
                <path d="M2 12l10 5 10-5"></path>
              </svg>
            </div>
            <div class="models-empty__text">Sign in to your workspace to manage AI models.</div>
          </div>
        </section>
      </div>
    `;
  }

  return html`
    <div class="models-page">
      <section class="card models-overview">
        <div class="models-overview__header">
          <div>
            <div class="card-title">Workspace Model Stack</div>
            <div class="card-sub">
              Pick a provider, save a model, then choose whether it becomes the workspace default or stays available for specific agents.
            </div>
          </div>
          <div class="models-overview__active">
            <span class="models-provider-badge models-provider-badge--lg">
              ${providerEmoji(activeModel?.provider ?? (draft.provider || "model"))}
            </span>
            <div>
              <div class="models-overview__active-label">Current Default</div>
              <div class="models-overview__active-ref mono">
                ${activeModel?.ref ?? "No default model selected"}
              </div>
            </div>
          </div>
        </div>

        <div class="models-stats-grid">
          <div class="models-stat">
            <span class="models-stat__value">${savedRows.length}</span>
            <span class="models-stat__label">configured models</span>
          </div>
          <div class="models-stat">
            <span class="models-stat__value">${readyRows.length}</span>
            <span class="models-stat__label">ready to use</span>
          </div>
          <div class="models-stat">
            <span class="models-stat__value">${providerCount}</span>
            <span class="models-stat__label">providers in workspace</span>
          </div>
          <div class="models-stat">
            <span class="models-stat__value">${assignments.filter((assignment) => !assignment.inherited).length}</span>
            <span class="models-stat__label">agent-specific pins</span>
          </div>
        </div>
      </section>

      <section class="card models-provider-section">
        <div class="models-section-head">
          <div>
            <div class="card-title">1. Choose A Provider</div>
            <div class="card-sub">
              Start here. We’ll prefill the editor with the provider and its suggested starter model.
            </div>
          </div>
          ${props.modelCatalogLoading
            ? html`<span class="muted" style="font-size:12px;">Loading catalog…</span>`
            : nothing}
        </div>
        <div class="models-provider-grid">
          ${providerCards.map((provider) => html`
            <button
              type="button"
              class="models-provider-card ${provider.selected ? "models-provider-card--selected" : ""}"
              @click=${() =>
                props.onModelRefDraftChange(
                  composeModelRef(provider.normalizedProvider, provider.suggestedModelId),
                )}
            >
              <div class="models-provider-card__top">
                <span class="models-provider-badge">${providerEmoji(provider.normalizedProvider)}</span>
                <span class="models-provider-card__name">${provider.label}</span>
              </div>
              <div class="models-provider-card__meta">
                <span>${provider.savedCount} saved</span>
                <span>${provider.ready ? "ready" : "needs key"}</span>
                ${provider.active ? html`<span>default</span>` : nothing}
              </div>
              <div class="models-provider-card__hint mono">
                ${provider.suggestedModelId || "Enter model manually"}
              </div>
            </button>
          `)}
        </div>
      </section>

      <section class="card models-workbench">
        <div class="models-section-head">
          <div>
            <div class="card-title">${isEditing ? "2. Edit Selected Model" : "2. Configure Model"}</div>
            <div class="card-sub">
              ${isEditing
                ? "Update the selected model, key, alias, or provider settings."
                : "Choose a model, add the provider key if needed, then save it to the workspace."}
            </div>
          </div>
          ${props.modelSavedOk ? html`<span class="chip chip-ok">Saved</span>` : nothing}
        </div>

        <div class="models-workbench__layout">
          <div class="models-workbench__editor">
            <div class="models-editor__row">
              <label class="field models-field">
                <span>Provider</span>
                <input
                  list="pmos-model-provider-options"
                  .value=${draft.provider}
                  @input=${(event: Event) => {
                    const next = (event.target as HTMLInputElement).value;
                    props.onModelRefDraftChange(composeModelRef(next, draft.modelId));
                  }}
                  placeholder="openai, anthropic, ollama..."
                  ?disabled=${props.modelSaving}
                />
                <datalist id="pmos-model-provider-options">
                  ${providerOptions.map((option) => html`<option value=${option}></option>`)}
                </datalist>
              </label>
              <label class="field models-field models-field--wide">
                <span>Model</span>
                <input
                  list="pmos-model-id-options"
                  .value=${draft.modelId}
                  @input=${(event: Event) => {
                    const next = (event.target as HTMLInputElement).value;
                    props.onModelRefDraftChange(composeModelRef(draft.provider, next));
                  }}
                  placeholder=${draft.provider ? "Select or type a model id" : "Pick a provider first"}
                  ?disabled=${props.modelSaving || !draft.provider}
                />
                <datalist id="pmos-model-id-options">
                  ${modelIdOptions.map((option) => html`<option value=${option}></option>`)}
                </datalist>
              </label>
            </div>

            ${modelIdOptions.length > 0
              ? html`
                  <div class="models-suggestion-row">
                    ${modelIdOptions.slice(0, 8).map((option) => html`
                      <button
                        type="button"
                        class="models-suggestion-chip"
                        @click=${() =>
                          props.onModelRefDraftChange(composeModelRef(draft.provider, option))}
                      >
                        ${option}
                      </button>
                    `)}
                  </div>
                `
              : nothing}

            <div class="models-editor__row">
              <label class="field models-field">
                <span>API Key</span>
                <div class="models-key-field">
                  <input
                    type="password"
                    .value=${props.modelApiKeyDraft}
                    @input=${(event: Event) =>
                      props.onModelApiKeyDraftChange((event.target as HTMLInputElement).value)}
                    placeholder=${modelKeyPlaceholder}
                    autocomplete="off"
                    ?disabled=${props.modelSaving || keyLocked}
                  />
                  ${props.modelApiKeyStored
                    ? html`
                        <button
                          type="button"
                          class="btn btn--sm"
                          ?disabled=${props.modelSaving}
                          @click=${() => props.onModelApiKeyEditToggle(keyLocked)}
                        >
                          ${keyLocked ? "Edit" : "Lock"}
                        </button>
                      `
                    : nothing}
                </div>
              </label>
              <label class="field models-field">
                <span>Alias</span>
                <input
                  .value=${props.modelAlias}
                  @input=${(event: Event) =>
                    props.onModelAliasChange((event.target as HTMLInputElement).value)}
                  placeholder="Optional display name"
                  ?disabled=${props.modelSaving}
                />
              </label>
            </div>

            <details class="models-advanced">
              <summary>Advanced provider settings</summary>
              <div class="models-editor__row" style="margin-top:10px;">
                <label class="field models-field">
                  <span>API Base URL</span>
                  <input
                    type="url"
                    .value=${props.modelBaseUrl}
                    @input=${(event: Event) =>
                      props.onModelBaseUrlChange((event.target as HTMLInputElement).value)}
                    placeholder="Auto-filled for known providers"
                    ?disabled=${props.modelSaving}
                  />
                </label>
                <label class="field models-field">
                  <span>API Type</span>
                  <input
                    list="pmos-model-api-type-options"
                    .value=${props.modelApiType}
                    @input=${(event: Event) =>
                      props.onModelApiTypeChange((event.target as HTMLInputElement).value)}
                    placeholder="Auto-filled for known providers"
                    ?disabled=${props.modelSaving}
                  />
                  <datalist id="pmos-model-api-type-options">
                    <option value="openai-completions"></option>
                    <option value="openai-responses"></option>
                    <option value="anthropic-messages"></option>
                    <option value="google-generative-ai"></option>
                  </datalist>
                </label>
              </div>
            </details>

            <div class="models-editor__actions">
              <button
                type="button"
                class="btn primary"
                ?disabled=${props.modelSaving || !modelRefReady}
                @click=${() => props.onModelSave()}
              >
                ${props.modelSaving ? "Saving…" : "Save & Activate"}
              </button>
              <button
                type="button"
                class="btn"
                ?disabled=${props.modelSaving || !modelRefReady}
                @click=${() => props.onModelSaveWithoutActivate()}
              >
                Save Only
              </button>
              ${props.modelApiKeyStored
                ? html`
                    <button
                      type="button"
                      class="btn btn--sm"
                      ?disabled=${props.modelSaving}
                      @click=${() => props.onModelClearKey()}
                    >
                      Remove Key
                    </button>
                  `
                : nothing}
            </div>

            ${props.modelCatalogError
              ? html`<div class="callout warn" style="margin-top:10px;">${props.modelCatalogError}</div>`
              : nothing}
            ${props.modelError
              ? html`<div class="callout danger" style="margin-top:10px;">${props.modelError}</div>`
              : nothing}
          </div>

          <aside class="models-summary">
            <div class="models-summary__card">
              <div class="models-summary__eyebrow">Reference</div>
              <div class="models-reference-pill mono">${draftRef || "provider/model-id"}</div>
            </div>
            <div class="models-summary__card">
              <div class="models-summary__eyebrow">Provider</div>
              <div class="models-summary__value">
                ${draft.provider ? providerLabel(draft.provider) : "Choose a provider"}
              </div>
              <div class="models-summary__sub">
                ${draft.provider
                  ? `${modelIdOptions.length} known model option${modelIdOptions.length === 1 ? "" : "s"}`
                  : "Provider selection unlocks curated suggestions"}
              </div>
            </div>
            <div class="models-summary__card">
              <div class="models-summary__eyebrow">Assignments</div>
              <div class="models-summary__value">${draftAssignments.length}</div>
              <div class="models-summary__sub">
                agent${draftAssignments.length === 1 ? "" : "s"} pinned to this exact model
              </div>
            </div>
            ${draftAssignments.length > 0
              ? html`
                  <div class="models-summary__card">
                    <div class="models-summary__eyebrow">Pinned Agents</div>
                    <div class="models-summary__list">
                      ${draftAssignments.map((assignment) => html`
                        <div class="models-summary__row">
                          <span>${assignment.label}</span>
                          <button
                            type="button"
                            class="btn btn--sm"
                            ?disabled=${props.modelSaving}
                            @click=${() => props.onAssignAgentModel(assignment.agentId, null)}
                          >
                            Unpin
                          </button>
                        </div>
                      `)}
                    </div>
                  </div>
                `
              : nothing}
          </aside>
        </div>
      </section>

      <section class="card models-library">
        <div class="models-section-head">
          <div>
            <div class="card-title">3. Configured Models</div>
            <div class="card-sub">
              Default models, workspace-specific overrides, and any model pinned to an agent live here.
            </div>
          </div>
        </div>

        ${savedRows.length === 0
          ? html`
              <div class="models-empty">
                <div class="models-empty__icon">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.35">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                    <path d="M2 17l10 5 10-5"></path>
                    <path d="M2 12l10 5 10-5"></path>
                  </svg>
                </div>
                <div class="models-empty__text">
                  No models configured yet. Start with a provider above, save a model, and it will show up here.
                </div>
              </div>
            `
          : html`
              <div class="models-library__grid">
                ${savedRows.map((row) => {
                  const assignmentsForRow = assignments
                    .filter((assignment) => assignment.modelRef === row.ref)
                    .sort((left, right) => left.label.localeCompare(right.label));
                  const status = modelStatus(row);
                  const isBeingEdited = draftRef === row.ref;
                  return html`
                    <article class="model-card ${row.active ? "model-card--active" : ""} ${isBeingEdited ? "model-card--editing" : ""}">
                      <div class="model-card__main">
                        <div class="model-card__left">
                          <span class="models-provider-badge models-provider-badge--lg">
                            ${providerEmoji(row.provider)}
                          </span>
                          <div>
                            <div class="model-card__name">${row.alias || row.modelId || row.ref}</div>
                            <div class="model-card__meta mono">${row.ref}</div>
                          </div>
                        </div>
                        <div class="model-card__right">
                          <div class="model-card__status">
                            ${statusDot(status.tone)}
                            <span class="model-card__status-text">${status.label}</span>
                          </div>
                          ${assignmentsForRow.length > 0
                            ? html`<span class="model-card__agents-badge">${assignmentsForRow.length} agent${assignmentsForRow.length === 1 ? "" : "s"}</span>`
                            : nothing}
                        </div>
                      </div>

                      <div class="model-card__details">
                        <div class="model-card__detail">
                          <span class="muted">Provider</span>
                          <span>${providerLabel(row.provider)}</span>
                        </div>
                        <div class="model-card__detail">
                          <span class="muted">Scope</span>
                          <span>${row.workspaceOverride ? "Workspace override" : row.sharedProvider ? "Shared provider" : "Inherited"}</span>
                        </div>
                        <div class="model-card__detail">
                          <span class="muted">Auth</span>
                          <span>${row.keyConfigured || row.providerReady ? "Ready" : "Needs API key"}</span>
                        </div>
                      </div>

                      <div class="model-card__actions">
                        <button
                          type="button"
                          class="btn btn--sm"
                          ?disabled=${props.modelSaving}
                          @click=${() => props.onModelEdit(row.ref)}
                        >
                          ${isBeingEdited ? "Editing" : "Edit"}
                        </button>
                        ${!row.active
                          ? html`
                              <button
                                type="button"
                                class="btn btn--sm primary"
                                ?disabled=${props.modelSaving}
                                @click=${() => props.onModelActivate(row.ref)}
                              >
                                Set Default
                              </button>
                            `
                          : html`
                              <button
                                type="button"
                                class="btn btn--sm"
                                ?disabled=${props.modelSaving}
                                @click=${() => props.onModelDeactivate(row.ref)}
                              >
                                Unset Default
                              </button>
                            `}
                        ${row.keyConfigured
                          ? html`
                              <button
                                type="button"
                                class="btn btn--sm"
                                ?disabled=${props.modelSaving}
                                @click=${() => props.onModelClearKeyForRef(row.ref)}
                              >
                                Remove Key
                              </button>
                            `
                          : nothing}
                        ${row.workspaceOverride
                          ? html`
                              <button
                                type="button"
                                class="btn btn--sm"
                                ?disabled=${props.modelSaving}
                                @click=${() => {
                                  if (window.confirm(`Delete ${row.ref} from the workspace?`)) {
                                    props.onModelDelete(row.ref);
                                  }
                                }}
                              >
                                Delete
                              </button>
                            `
                          : nothing}
                      </div>

                      ${assignments.length > 0
                        ? html`
                            <details class="model-card__assignments">
                              <summary>Agent assignments (${assignmentsForRow.length})</summary>
                              <div class="model-card__assignment-list">
                                ${assignments
                                  .sort((left, right) => left.label.localeCompare(right.label))
                                  .map((assignment) => {
                                    const isCurrent = assignment.modelRef === row.ref;
                                    const isExplicit = isCurrent && !assignment.inherited;
                                    return html`
                                      <div class="model-card__assignment-row">
                                        <div>
                                          <div style="font-size:12px;font-weight:600;">${assignment.label}</div>
                                          <div class="muted" style="font-size:11px;">
                                            ${isCurrent
                                              ? assignment.inherited
                                                ? "Using workspace default"
                                                : "Pinned to this model"
                                              : assignment.modelRef
                                                ? `Using ${assignment.modelRef}`
                                                : "Inheriting workspace default"}
                                          </div>
                                        </div>
                                        ${isCurrent
                                          ? isExplicit
                                            ? html`
                                                <button
                                                  type="button"
                                                  class="btn btn--sm"
                                                  ?disabled=${props.modelSaving}
                                                  @click=${() => props.onAssignAgentModel(assignment.agentId, null)}
                                                >
                                                  Unpin
                                                </button>
                                              `
                                            : html`
                                                <button
                                                  type="button"
                                                  class="btn btn--sm"
                                                  ?disabled=${props.modelSaving}
                                                  @click=${() => props.onAssignAgentModel(assignment.agentId, row.ref)}
                                                >
                                                  Pin
                                                </button>
                                              `
                                          : html`
                                              <button
                                                type="button"
                                                class="btn btn--sm"
                                                ?disabled=${props.modelSaving}
                                                @click=${() => props.onAssignAgentModel(assignment.agentId, row.ref)}
                                              >
                                                Assign
                                              </button>
                                            `}
                                      </div>
                                    `;
                                  })}
                              </div>
                            </details>
                          `
                        : nothing}
                    </article>
                  `;
                })}
              </div>
            `}
      </section>
    </div>
  `;
}
