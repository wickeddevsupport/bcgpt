import { html, nothing } from "lit";
import type { ActivepiecesFlowSummary } from "../controllers/pmos-activepieces.ts";
import type {
  PmosFlowGraphEdge,
  PmosFlowGraphNode,
  PmosFlowGraphOp,
} from "../controllers/pmos-flow-builder.ts";

export type AutomationsProps = {
  connected: boolean;
  integrationsHref: string;
  projectId: string;

  loading: boolean;
  error: string | null;
  flowsQuery: string;
  flows: ActivepiecesFlowSummary[];

  createName: string;
  creating: boolean;
  createError: string | null;

  selectedFlowId: string | null;
  flowDetailsLoading: boolean;
  flowDetailsError: string | null;
  flowDetails: unknown | null;

  renameDraft: string;
  operationDraft: string;
  triggerPayloadDraft: string;
  mutating: boolean;
  mutateError: string | null;

  // Phase 5: AI flow builder stream
  builderPrompt: string;
  builderGenerating: boolean;
  builderCommitting: boolean;
  builderError: string | null;
  builderFlowName: string;
  builderNodes: PmosFlowGraphNode[];
  builderEdges: PmosFlowGraphEdge[];
  builderOps: PmosFlowGraphOp[];
  builderLastCommittedFlowId: string | null;

  onFlowsQueryChange: (next: string) => void;
  onRefresh: () => void;
  onCreateNameChange: (next: string) => void;
  onCreate: () => void;
  onSelectFlow: (flowId: string) => void;
  onRenameDraftChange: (next: string) => void;
  onRename: () => void;
  onSetStatus: (status: "ENABLED" | "DISABLED") => void;
  onPublish: () => void;
  onDelete: () => void;
  onOperationDraftChange: (next: string) => void;
  onApplyOperation: () => void;
  onTriggerPayloadDraftChange: (next: string) => void;
  onTriggerWebhook: (opts?: { draft?: boolean; sync?: boolean }) => void;

  onBuilderPromptChange: (next: string) => void;
  onBuilderGenerate: () => void;
  onBuilderCommit: () => void;
  onBuilderReset: () => void;
};

function formatFlowTitle(flow: ActivepiecesFlowSummary) {
  return flow.displayName || flow.id;
}

function formatFlowMeta(flow: ActivepiecesFlowSummary) {
  const parts: string[] = [];
  if (flow.status) parts.push(flow.status);
  if (flow.updated) parts.push(`updated ${flow.updated}`);
  if (flow.created) parts.push(`created ${flow.created}`);
  return parts.join(" | ");
}

export function renderAutomations(props: AutomationsProps) {
  const connectedReason = !props.connected
    ? "Connect to PMOS first (Dashboard -> Access Key -> Connect)."
    : null;
  const projectReason = props.projectId.trim()
    ? null
    : "Activepieces Project ID is required. Set it in Integrations -> Activepieces -> Project ID, then Save.";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flowStatus = props.flowDetails ? String((props.flowDetails as any).status ?? "") : "";
  const isEnabled = flowStatus.toUpperCase() === "ENABLED";

  return html`
    <section class="agents-layout">
      <div class="agents-sidebar">
        <div class="card">
          <div class="card-title">Create flow</div>
          <div class="card-sub">Create a new Activepieces flow in your configured project.</div>

          <div class="form-grid" style="margin-top: 14px;">
            <label class="field full">
              <span>Flow name</span>
              <input
                .value=${props.createName}
                @input=${(e: Event) => props.onCreateNameChange((e.target as HTMLInputElement).value)}
                placeholder="e.g. Onboard new lead"
                ?disabled=${!props.connected || !props.projectId.trim() || props.creating}
              />
            </label>
          </div>

          <div class="row" style="margin-top: 12px;">
            <button
              class="btn primary"
              @click=${() => props.onCreate()}
              ?disabled=${!props.connected || !props.projectId.trim() || props.creating || !props.createName.trim()}
            >
              ${props.creating ? "Creating..." : "Create flow"}
            </button>
            <a class="btn btn--secondary" href=${props.integrationsHref}>Integrations</a>
          </div>

          ${props.createError ? html`<div class="callout danger" style="margin-top: 12px;">${props.createError}</div>` : nothing}
          ${connectedReason ? html`<div class="muted" style="margin-top: 12px;">${connectedReason}</div>` : nothing}
          ${projectReason ? html`<div class="muted" style="margin-top: 12px;">${projectReason}</div>` : nothing}
        </div>

        <div class="card">
          <div class="card-title">Flows</div>
          <div class="card-sub">Your Activepieces flows (native inside PMOS).</div>

          <div class="form-grid" style="margin-top: 14px;">
            <label class="field full">
              <span>Search</span>
              <input
                .value=${props.flowsQuery}
                @input=${(e: Event) => props.onFlowsQueryChange((e.target as HTMLInputElement).value)}
                placeholder="filter by name"
                ?disabled=${!props.connected || !props.projectId.trim()}
              />
            </label>
          </div>

          <div class="row" style="margin-top: 12px;">
            <button
              class="btn"
              @click=${() => props.onRefresh()}
              ?disabled=${!props.connected || !props.projectId.trim() || props.loading}
            >
              ${props.loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          ${props.error ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>` : nothing}

          <div class="list" style="margin-top: 14px;">
            ${props.flows.map((flow) => {
              const selected = props.selectedFlowId === flow.id;
              return html`
                <div
                  class="list-item list-item-clickable ${selected ? "list-item-selected" : ""}"
                  @click=${() => props.onSelectFlow(flow.id)}
                >
                  <div class="list-main">
                    <div class="list-title">${formatFlowTitle(flow)}</div>
                    <div class="list-sub mono">${flow.id}</div>
                  </div>
                  <div class="list-meta">
                    <div>${formatFlowMeta(flow) || " "}</div>
                    <div>
                      <button class="btn btn--sm" @click=${(e: Event) => {
                        e.stopPropagation();
                        props.onSelectFlow(flow.id);
                      }}>
                        Open
                      </button>
                    </div>
                  </div>
                </div>
              `;
            })}
            ${props.flows.length === 0 && !props.loading ? html`<div class="muted">No flows found.</div>` : nothing}
          </div>
        </div>
      </div>

      <div class="agents-main">
        <div class="card">
          <div class="card-title">Flow Editor</div>
          <div class="card-sub">Rename, enable/disable, publish, and apply operations.</div>

          <div class="card" style="margin-top: 16px;">
            <div class="card-title">AI Flow Builder (Live)</div>
            <div class="card-sub">
              Describe your automation and watch PMOS stream graph operations before committing a flow shell.
            </div>

            <label class="field" style="margin-top: 12px;">
              <span>Prompt</span>
              <textarea
                .value=${props.builderPrompt}
                @input=${(e: Event) => props.onBuilderPromptChange((e.target as HTMLTextAreaElement).value)}
                placeholder="e.g. Create a lead intake flow that posts to Slack and writes rows to Google Sheets."
                ?disabled=${props.builderGenerating || props.builderCommitting}
              ></textarea>
            </label>

            <div class="row" style="margin-top: 12px;">
              <button class="btn" @click=${() => props.onBuilderGenerate()} ?disabled=${props.builderGenerating || !props.builderPrompt.trim()}>
                ${props.builderGenerating ? "Generating..." : "Generate graph"}
              </button>
              <button
                class="btn primary"
                @click=${() => props.onBuilderCommit()}
                ?disabled=${props.builderCommitting || props.builderNodes.length === 0}
              >
                ${props.builderCommitting ? "Committing..." : "Commit draft flow"}
              </button>
              <button class="btn btn--secondary" @click=${() => props.onBuilderReset()} ?disabled=${props.builderGenerating || props.builderCommitting}>
                Reset
              </button>
            </div>

            ${
              props.builderFlowName
                ? html`<div class="muted" style="margin-top: 10px;">Draft flow name: <span class="mono">${props.builderFlowName}</span></div>`
                : nothing
            }
            ${
              props.builderLastCommittedFlowId
                ? html`
                    <div class="callout" style="margin-top: 10px;">
                      Flow shell created: <span class="mono">${props.builderLastCommittedFlowId}</span>
                    </div>
                  `
                : nothing
            }
            ${props.builderError ? html`<div class="callout danger" style="margin-top: 10px;">${props.builderError}</div>` : nothing}

            <div class="grid grid-cols-2" style="margin-top: 12px;">
              <div class="card">
                <div class="card-title">Graph Nodes</div>
                <div class="list" style="margin-top: 8px;">
                  ${props.builderNodes.map(
                    (node) => html`
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title">${node.label}</div>
                          <div class="list-sub mono">${node.id}</div>
                          ${node.piece ? html`<div class="list-sub mono">${node.piece}</div>` : nothing}
                        </div>
                        <div class="list-meta">
                          <span class="chip">${node.type}</span>
                        </div>
                      </div>
                    `,
                  )}
                  ${props.builderNodes.length === 0 ? html`<div class="muted">No nodes yet.</div>` : nothing}
                </div>
              </div>
              <div class="card">
                <div class="card-title">Graph Edges</div>
                <div class="list" style="margin-top: 8px;">
                  ${props.builderEdges.map(
                    (edge) => html`
                      <div class="list-item">
                        <div class="list-main">
                          <div class="list-title mono">${edge.from} -> ${edge.to}</div>
                          <div class="list-sub">${edge.label ?? "then"}</div>
                        </div>
                      </div>
                    `,
                  )}
                  ${props.builderEdges.length === 0 ? html`<div class="muted">No edges yet.</div>` : nothing}
                </div>
              </div>
            </div>

            <details style="margin-top: 12px;">
              <summary class="muted" style="cursor: pointer;">Builder operation stream (${props.builderOps.length})</summary>
              <div class="list" style="margin-top: 10px; max-height: 220px; overflow: auto;">
                ${props.builderOps.map(
                  (op) => html`
                    <div class="list-item">
                      <div class="list-main">
                        <div class="list-title">${op.kind}</div>
                        <div class="list-sub">${op.detail}</div>
                      </div>
                    </div>
                  `,
                )}
              </div>
            </details>
          </div>

          ${
            !props.selectedFlowId
              ? html`<div class="muted" style="margin-top: 14px;">Select a flow to edit.</div>`
              : nothing
          }

          ${
            props.flowDetailsLoading
              ? html`<div class="muted" style="margin-top: 14px;">Loading flow...</div>`
              : nothing
          }

          ${props.flowDetailsError && props.selectedFlowId ? html`<div class="callout danger" style="margin-top: 12px;">${props.flowDetailsError}</div>` : nothing}
          ${props.mutateError ? html`<div class="callout danger" style="margin-top: 12px;">${props.mutateError}</div>` : nothing}

          ${
            props.flowDetails && props.selectedFlowId
              ? html`
                  <div class="stat-grid" style="margin-top: 14px;">
                    <div class="stat">
                      <div class="stat-label">Flow ID</div>
                      <div class="stat-value mono" style="font-size: 14px; font-weight: 600;">${props.selectedFlowId}</div>
                    </div>
                    <div class="stat">
                      <div class="stat-label">Status</div>
                      <div class="stat-value ${isEnabled ? "ok" : "warn"}" style="font-size: 18px;">${flowStatus || "n/a"}</div>
                    </div>
                  </div>

                  <div class="form-grid" style="margin-top: 16px;">
                    <label class="field full">
                      <span>Rename</span>
                      <input
                        .value=${props.renameDraft}
                        @input=${(e: Event) => props.onRenameDraftChange((e.target as HTMLInputElement).value)}
                        ?disabled=${props.mutating}
                      />
                    </label>
                  </div>

                  <div class="row" style="margin-top: 12px;">
                    <button class="btn primary" @click=${() => props.onRename()} ?disabled=${props.mutating || !props.renameDraft.trim()}>
                      ${props.mutating ? "Working..." : "Save name"}
                    </button>
                    <button class="btn" @click=${() => props.onSetStatus(isEnabled ? "DISABLED" : "ENABLED")} ?disabled=${props.mutating}>
                      ${isEnabled ? "Disable" : "Enable"}
                    </button>
                    <button class="btn" @click=${() => props.onPublish()} ?disabled=${props.mutating}>
                      Publish
                    </button>
                    <button class="btn danger" @click=${() => props.onDelete()} ?disabled=${props.mutating}>
                      Delete
                    </button>
                  </div>

                  <div class="card" style="margin-top: 16px;">
                    <div class="card-title">Webhook Trigger</div>
                    <div class="card-sub">
                      Triggers via Activepieces webhook endpoint (works for webhook-triggered flows).
                    </div>
                    <label class="field" style="margin-top: 12px;">
                      <span>Payload (JSON)</span>
                      <textarea
                        .value=${props.triggerPayloadDraft}
                        @input=${(e: Event) => props.onTriggerPayloadDraftChange((e.target as HTMLTextAreaElement).value)}
                        ?disabled=${props.mutating}
                      ></textarea>
                    </label>
                    <div class="row" style="margin-top: 12px;">
                      <button class="btn primary" @click=${() => props.onTriggerWebhook()} ?disabled=${props.mutating}>
                        Trigger
                      </button>
                      <button class="btn" @click=${() => props.onTriggerWebhook({ draft: true })} ?disabled=${props.mutating}>
                        Draft
                      </button>
                      <button class="btn" @click=${() => props.onTriggerWebhook({ sync: true })} ?disabled=${props.mutating}>
                        Sync
                      </button>
                    </div>
                  </div>

                  <div class="card" style="margin-top: 16px;">
                    <div class="card-title">Advanced Operation</div>
                    <div class="card-sub">
                      Paste a FlowOperationRequest JSON to apply deeper edits (add/update steps, triggers, etc).
                    </div>
                    <label class="field" style="margin-top: 12px;">
                      <span>Operation JSON</span>
                      <textarea
                        .value=${props.operationDraft}
                        @input=${(e: Event) => props.onOperationDraftChange((e.target as HTMLTextAreaElement).value)}
                        placeholder='{"type":"CHANGE_NAME","request":{"displayName":"New name"}}'
                        ?disabled=${props.mutating}
                      ></textarea>
                    </label>
                    <div class="row" style="margin-top: 12px;">
                      <button class="btn" @click=${() => props.onApplyOperation()} ?disabled=${props.mutating || !props.operationDraft.trim()}>
                        Apply operation
                      </button>
                    </div>
                  </div>

                  <details style="margin-top: 16px;">
                    <summary class="muted" style="cursor: pointer;">Raw flow JSON</summary>
                    <pre class="code-block">${JSON.stringify(props.flowDetails, null, 2)}</pre>
                  </details>
                `
              : nothing
          }
        </div>
      </div>
    </section>
  `;
}
