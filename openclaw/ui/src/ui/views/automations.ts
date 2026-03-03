import { html, nothing } from "lit";
import type { WorkflowRunSummary, WorkflowSummary } from "../controllers/pmos-workflows.ts";
import type { ChatProps } from "./chat.ts";
import { renderChat } from "./chat.ts";

const WORKFLOW_TEMPLATES = [
  { id: "template-basecamp-sync", name: "Basecamp Todo Sync", desc: "Sync Basecamp todos to another service", icon: "🏕️", category: "Sync" },
  { id: "template-ai-response", name: "AI-Powered Response", desc: "Respond to triggers using an AI model", icon: "🤖", category: "AI" },
  { id: "template-webhook-slack", name: "Webhook → Slack Alert", desc: "Post to Slack when a webhook fires", icon: "💬", category: "Notification" },
  { id: "template-scheduled-report", name: "Scheduled Report", desc: "Generate and send a report on a schedule", icon: "📊", category: "Reporting" },
  { id: "template-github-slack", name: "GitHub → Slack", desc: "Notify Slack on GitHub events", icon: "🐙", category: "Notification" },
  { id: "template-database-backup", name: "Database Backup", desc: "Scheduled backup of a data source", icon: "💾", category: "Maintenance" },
];

export type AutomationsProps = {
  connected: boolean;
  integrationsHref: string;
  projectId: string;
  onOpenIntegrations: () => void;
  embedUrl: string;
  selectedFlowLabel: string | null;

  loading: boolean;
  error: string | null;
  flowsQuery: string;
  flows: WorkflowSummary[];

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

  // Template deploy
  templateDeploying: boolean;
  templateDeployError: string | null;
  templateDeployedOk: boolean;
  onDeployTemplate: (templateId: string) => void;

  // Execution history
  runs: WorkflowRunSummary[];
  runsLoading: boolean;
  runsError: string | null;
  onLoadRuns: () => void;

  // Panel (left slide-in)
  panelOpen: boolean;
  panelTab: "workflows" | "templates" | "runs";
  onPanelToggle: () => void;
  onPanelTabChange: (tab: "workflows" | "templates" | "runs") => void;
  leftPanelRatio: number;
  centerSplitRatio: number;
  onLeftPanelResize: (ratio: number) => void;
  onCenterSplitResize: (ratio: number) => void;

  // AI Chat (right panel)
  chatOpen: boolean;
  currentModel?: string;  // Current model being used
  currentModelProvider?: string;  // Provider of current model
  onChatToggle: () => void;
  chatMessages: Array<{ role: "user" | "assistant"; content: string }>;
  chatDraft: string;
  chatSending: boolean;
  onChatDraftChange: (next: string) => void;
  onChatSend: () => void;
  pendingWorkflow?: { name: string; nodes: unknown[]; connections: Record<string, unknown> } | null;
  onConfirmWorkflow?: () => void;
  onCancelWorkflow?: () => void;
  // Full chat props for inline chat panel
  chatProps: ChatProps;
  chatSteps: string[];

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
};

function formatFlowTitle(flow: WorkflowSummary) {
  return flow.displayName || flow.id;
}

function statusChipClass(status: string) {
  const s = status.toUpperCase();
  if (s === "ENABLED") return "chip-ok";
  if (s === "DISABLED") return "chip-muted";
  return "";
}

function runChipClass(status: string) {
  const s = (status ?? "unknown").toUpperCase();
  if (s === "SUCCEEDED") return "chip-ok";
  if (s === "FAILED") return "chip-danger";
  return "chip-muted";
}

export function renderAutomations(props: AutomationsProps) {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const connectedReason = !props.connected
    ? "Sign in to your workspace to manage workflows."
    : null;
  const projectMissing = !props.projectId.trim();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flowStatus = props.flowDetails ? String((props.flowDetails as any).status ?? "") : "";
  const isEnabled = flowStatus.toUpperCase() === "ENABLED";

  // ─── Left panel content ──────────────────────────────────────────
  const panelWorkflows = html`
    <div style="padding: 12px; display: flex; flex-direction: column; gap: 10px; height: 100%; overflow-y: auto;">
      ${connectedReason ? html`<div class="muted" style="font-size:12px;">${connectedReason}</div>` : nothing}
      ${projectMissing ? html`<div class="muted" style="font-size:12px;">Project is optional for generic workflows. Set one in <button class="btn btn--sm" @click=${() => props.onOpenIntegrations()}>Integrations</button> for project-specific automations.</div>` : nothing}

      <div>
        <div class="card-title" style="margin-bottom:8px;">Create workflow</div>
        <div style="display:flex;gap:6px;align-items:stretch;">
          <input
            style="flex:1;min-width:0;"
            .value=${props.createName}
            @input=${(e: Event) => props.onCreateNameChange((e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter" && props.createName.trim() && !props.creating) props.onCreate(); }}
            placeholder="Flow name..."
            ?disabled=${!props.connected || props.creating}
          />
          <button
            class="btn btn--primary btn--sm"
            @click=${() => props.onCreate()}
            ?disabled=${!props.connected || props.creating || !props.createName.trim()}
          >${props.creating ? "..." : "Create"}</button>
        </div>
        ${props.createError ? html`<div class="muted" style="color:var(--color-danger);font-size:11px;margin-top:4px;">${props.createError}</div>` : nothing}
      </div>

      <div style="display:flex;gap:6px;align-items:center;">
        <input
          style="flex:1;"
          .value=${props.flowsQuery}
          @input=${(e: Event) => props.onFlowsQueryChange((e.target as HTMLInputElement).value)}
          placeholder="Search flows..."
          ?disabled=${!props.connected}
        />
        <button class="btn btn--sm" @click=${() => props.onRefresh()} ?disabled=${!props.connected || props.loading}>
          ${props.loading ? "..." : "↻"}
        </button>
      </div>

      ${props.error ? html`<div class="callout danger" style="font-size:12px;">${props.error}</div>` : nothing}

      <div class="list" style="flex:1;overflow-y:auto;">
        ${props.flows.map((flow) => {
          const selected = props.selectedFlowId === flow.id;
          return html`
            <div
              class="list-item list-item-clickable ${selected ? "list-item-selected" : ""}"
              @click=${() => props.onSelectFlow(flow.id)}
            >
              <div class="list-main" style="min-width:0;">
                <div class="list-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${formatFlowTitle(flow)}</div>
                ${flow.status ? html`<div class="list-sub"><span class="chip ${statusChipClass(flow.status)}" style="font-size:10px;">${flow.status}</span></div>` : nothing}
              </div>
            </div>
          `;
        })}
        ${props.flows.length === 0 && !props.loading ? html`
            <div style="text-align:center;padding:24px 12px;">
              <div style="font-size:32px;margin-bottom:12px;">⚡</div>
              <div style="font-weight:600;margin-bottom:8px;">No workflows yet</div>
              <div class="muted" style="font-size:12px;margin-bottom:16px;">
                Create your first automation to get started.
              </div>
              <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
                <button class="btn btn--primary btn--sm" @click=${() => props.onPanelTabChange("templates")}>
                  Browse Templates
                </button>
              </div>
            </div>
          ` : nothing}
      </div>

      ${props.selectedFlowId && props.flowDetails ? html`
        <div style="border-top:1px solid var(--border);padding-top:10px;">
          <div class="card-title" style="margin-bottom:8px;">Selected: <span style="font-weight:normal;font-size:12px;">${props.selectedFlowLabel ?? props.selectedFlowId}</span></div>

          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
            <button class="btn btn--sm ${isEnabled ? "" : "btn--primary"}" @click=${() => props.onSetStatus(isEnabled ? "DISABLED" : "ENABLED")} ?disabled=${props.mutating}
              title="Enable allows this workflow to run when triggered. Disable stops all triggers.">
              ${isEnabled ? "Disable" : "Enable"}
            </button>
            <button class="btn btn--sm" @click=${() => props.onPublish()} ?disabled=${props.mutating}
              title="Publish makes this workflow visible to all workspace members and activates all triggers.">
              Publish
            </button>
            <button class="btn btn--sm btn--danger" @click=${() => props.onDelete()} ?disabled=${props.mutating}
              title="Permanently delete this workflow. This cannot be undone.">
              Delete
            </button>
          </div>

          <div style="display:flex;gap:6px;align-items:stretch;margin-bottom:6px;">
            <input
              style="flex:1;min-width:0;"
              .value=${props.renameDraft}
              @input=${(e: Event) => props.onRenameDraftChange((e.target as HTMLInputElement).value)}
              placeholder="Rename..."
              ?disabled=${props.mutating}
            />
            <button class="btn btn--sm btn--primary" @click=${() => props.onRename()} ?disabled=${props.mutating || !props.renameDraft.trim()}>Save</button>
          </div>

          ${props.mutateError ? html`<div class="muted" style="color:var(--color-danger);font-size:11px;">${props.mutateError}</div>` : nothing}

          <details style="margin-top:8px;">
            <summary class="muted" style="cursor:pointer;font-size:12px;">Webhook trigger</summary>
            <div style="margin-top:8px;">
              <textarea
                style="width:100%;height:64px;font-size:11px;"
                .value=${props.triggerPayloadDraft}
                @input=${(e: Event) => props.onTriggerPayloadDraftChange((e.target as HTMLTextAreaElement).value)}
                ?disabled=${props.mutating}
              ></textarea>
              <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
                <button class="btn btn--sm btn--primary" @click=${() => props.onTriggerWebhook()} ?disabled=${props.mutating}
                  title="Test this workflow by sending the payload above to its webhook endpoint.">
                  ▶ Test Trigger
                </button>
                <button class="btn btn--sm" @click=${() => props.onTriggerWebhook({ sync: true })} ?disabled=${props.mutating}
                  title="Sync the latest workflow definition from n8n (use if you edited it directly in n8n).">
                  ↻ Sync from n8n
                </button>
              </div>
            </div>
          </details>
        </div>
      ` : nothing}
    </div>
  `;

  const panelTemplates = html`
    <div style="padding: 12px; overflow-y: auto; height: 100%;">
      ${props.templateDeployedOk ? html`<div class="callout success" style="margin-bottom:10px;font-size:12px;">✓ Template deployed — check your workflows list.</div>` : nothing}
      ${props.templateDeployError ? html`<div class="callout danger" style="margin-bottom:10px;font-size:12px;">${props.templateDeployError}</div>` : nothing}

      <div style="margin-bottom:12px;">
        <div class="card-title">Workflow Templates</div>
        <div class="muted" style="font-size:11px;">Pre-built automations you can customize</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;">
        ${WORKFLOW_TEMPLATES.map((tpl) => html`
          <div class="card" style="padding:12px;">
            <div style="display:flex;align-items:flex-start;gap:10px;">
              <div style="font-size:24px;flex-shrink:0;">${tpl.icon}</div>
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                  <span style="font-weight:600;font-size:13px;">${tpl.name}</span>
                  <span class="chip" style="font-size:9px;padding:1px 6px;">${tpl.category}</span>
                </div>
                <div class="muted" style="font-size:11px;">${tpl.desc}</div>
              </div>
            </div>
            <div style="margin-top:10px;">
              <button
                class="btn btn--sm btn--primary"
                style="width:100%;"
                ?disabled=${!props.connected || props.templateDeploying}
                @click=${() => props.onDeployTemplate(tpl.id)}
              >${props.templateDeploying ? "Deploying..." : "Use Template"}</button>
            </div>
          </div>
        `)}
      </div>
    </div>
  `;

  const panelRuns = html`
    <div style="padding: 12px; overflow-y: auto; height: 100%;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div>
          <div class="card-title">Execution History</div>
          <div class="muted" style="font-size:11px;">Recent workflow runs</div>
        </div>
        <button class="btn btn--sm" @click=${() => props.onLoadRuns()} ?disabled=${!props.connected || props.runsLoading}>
          ${props.runsLoading ? "..." : "↻"}
        </button>
      </div>
      ${props.runsError ? html`<div class="callout danger" style="font-size:12px;margin-bottom:8px;">${props.runsError}</div>` : nothing}
      
      ${props.runs.length === 0 && !props.runsLoading ? html`
        <div style="text-align:center;padding:24px 12px;">
          <div style="font-size:24px;margin-bottom:8px;">📋</div>
          <div class="muted" style="font-size:12px;">No runs yet.</div>
          <div class="muted" style="font-size:11px;margin-top:4px;">Trigger a workflow to see execution history here.</div>
        </div>
      ` : html`
        <div class="list">
          ${props.runs.map((run) => html`
            <div class="list-item">
              <div class="list-main">
                <div class="list-title mono" style="font-size:11px;">${run.id.slice(0, 8)}…</div>
                ${run.created ? html`<div class="list-sub" style="font-size:10px;">${run.created}</div>` : nothing}
              </div>
              <div class="list-meta">
                <span class="chip ${runChipClass(run.status ?? "")}" style="font-size:10px;">${run.status ?? "unknown"}</span>
              </div>
            </div>
          `)}
        </div>
      `}
    </div>
  `;

  // ─── Right chat panel ──────────────────────────────────────────────
  const chatPanel = html`
    <div
      class="automations-chat-panel"
      style="${isMobile ? "position: fixed; right: 0; top: 0; height: 100vh; width: 100%; z-index: 100;" : ""}"
    >
      <!-- Header -->
      <div class="automations-chat-header">
        <div>
          <div style="font-weight:600;font-size:14px;">AI Workflow Assistant</div>
          <div class="muted" style="font-size:11px;">Describe what you want to automate</div>
        </div>
        <button
          class="btn ${isMobile ? "btn--primary" : "btn--sm"}"
          style="${isMobile ? "font-size:16px;padding:8px 12px;" : ""}"
          @click=${() => props.onChatToggle()}
          title="Close chat"
        >✕</button>
      </div>
      <!-- AI thoughts / step progress (shown while AI is working) -->
      ${props.chatSteps.length > 0 && props.chatProps.sending ? html`
        <details class="ai-thoughts" open>
          <summary style="cursor:pointer;padding:6px 12px;font-size:12px;color:var(--muted,#888);user-select:none;display:flex;align-items:center;gap:6px;">
            <span style="animation:spin 1s linear infinite;display:inline-block;">⟳</span>
            Thinking... (${props.chatSteps.length} step${props.chatSteps.length === 1 ? "" : "s"})
          </summary>
          <div style="padding:6px 12px 8px;font-size:11px;color:var(--muted,#888);font-family:monospace;line-height:1.5;max-height:120px;overflow-y:auto;background:var(--bg-secondary,rgba(0,0,0,0.15));border-top:1px solid var(--border,rgba(255,255,255,0.08));">
            ${props.chatSteps.map((step) => html`<div>• ${step}</div>`)}
          </div>
        </details>
      ` : nothing}
      <!-- Full chat component -->
      <div class="automations-chat-body">
        ${renderChat(props.chatProps)}
      </div>
      ${props.pendingWorkflow ? html`
        <div class="automations-chat-confirm-bar">
          <div class="automations-chat-confirm-label">
            <strong>Ready to create:</strong> ${props.pendingWorkflow.name}
          </div>
          <div class="automations-chat-confirm-actions">
            <button class="btn btn--sm" @click=${() => props.onCancelWorkflow?.()}>Cancel</button>
            <button class="btn btn--sm btn--primary" @click=${() => props.onConfirmWorkflow?.()}>Create Workflow</button>
          </div>
        </div>
      ` : nothing}
    </div>
  `;

  // ─── Main layout ───────────────────────────────────────────────────
  const PANEL_TABS: Array<{ id: "workflows" | "templates" | "runs"; label: string }> = [
    { id: "workflows", label: "Workflows" },
    { id: "templates", label: "Templates" },
    { id: "runs", label: "Runs" },
  ];

  return html`
    <div style="
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    ">
      <!-- toolbar -->
      <div style="
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--border);
        background: var(--surface, #1e1e1e);
        flex-shrink: 0;
      ">
        <button
          class="btn btn--sm ${props.panelOpen ? "btn--primary" : "btn--secondary"}"
          @click=${() => props.onPanelToggle()}
          title="${props.panelOpen ? "Hide panel" : "Show panel"}"
        >
          ≡ ${props.panelOpen ? "Hide" : "Show"} Panel
        </button>

        ${props.panelOpen ? PANEL_TABS.map((tab) => html`
          <button
            class="btn btn--sm ${props.panelTab === tab.id ? "btn--primary" : ""}"
            @click=${() => props.onPanelTabChange(tab.id)}
          >${tab.label}</button>
        `) : nothing}

        <div style="flex:1;"></div>

        ${props.selectedFlowLabel ? html`
          <span class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;">
            Editing: <strong>${props.selectedFlowLabel}</strong>
          </span>
        ` : nothing}

        <button
          class="btn btn--sm ${props.chatOpen ? "btn--primary" : "btn--secondary"}"
          @click=${() => props.onChatToggle()}
          title="AI Workflow Assistant"
        >
          AI Assistant ${props.chatOpen ? "▶" : "◀"}
        </button>
      </div>

      <!-- main row -->
      <div class="automations-layout">
        <!-- left panel -->
        ${props.panelOpen ? html`
          ${isMobile ? html`
            <div
              @click=${() => props.onPanelToggle()}
              style="
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.45);
                z-index: 89;
              "
            ></div>
          ` : nothing}
          <div
            class="automations-left-panel"
            style="${isMobile
              ? "position: fixed; left: 0; top: 0; width: min(90vw, 360px); height: 100vh; z-index: 90;"
              : `flex: 0 0 ${Math.round(props.leftPanelRatio * 1000) / 10}%;`}"
          >
            ${props.panelTab === "workflows" ? panelWorkflows : nothing}
            ${props.panelTab === "templates" ? panelTemplates : nothing}
            ${props.panelTab === "runs" ? panelRuns : nothing}
          </div>
          ${!isMobile ? html`
            <resizable-divider
              .splitRatio=${props.leftPanelRatio}
              .minRatio=${0.18}
              .maxRatio=${0.42}
              @resize=${(event: CustomEvent) => props.onLeftPanelResize(event.detail.splitRatio)}
            ></resizable-divider>
          ` : nothing}
        ` : nothing}

        <div class="automations-main">
          ${!props.chatOpen || isMobile
            ? html`
                <div class="automations-canvas">
                  <iframe
                    src=${props.embedUrl}
                    title="n8n Workflow Canvas"
                    style="flex:1 1 auto;width:100%;height:100%;min-height:80vh;border:0;display:block;background:#1a1a1a;"
                    allow="clipboard-read; clipboard-write"
                  ></iframe>
                </div>
                ${props.chatOpen ? chatPanel : nothing}
              `
            : html`
                <div class="automations-center-split">
                  <div
                    class="automations-canvas"
                    style="flex: 0 0 ${Math.round(props.centerSplitRatio * 1000) / 10}%"
                  >
                    <iframe
                      src=${props.embedUrl}
                      title="n8n Workflow Canvas"
                      style="flex:1 1 auto;width:100%;height:100%;min-height:80vh;border:0;display:block;background:#1a1a1a;"
                      allow="clipboard-read; clipboard-write"
                    ></iframe>
                  </div>
                  <resizable-divider
                    .splitRatio=${props.centerSplitRatio}
                    .minRatio=${0.45}
                    .maxRatio=${0.85}
                    @resize=${(event: CustomEvent) => props.onCenterSplitResize(event.detail.splitRatio)}
                  ></resizable-divider>
                  ${chatPanel}
                </div>
              `}
        </div>

        ${props.chatOpen && isMobile ? html`
          <div
            @click=${() => props.onChatToggle()}
            style="
              position: fixed;
              inset: 0;
              background: rgba(0, 0, 0, 0.5);
              z-index: 99;
            "
          ></div>
        ` : nothing}
      </div>
    </div>
  `;
}
