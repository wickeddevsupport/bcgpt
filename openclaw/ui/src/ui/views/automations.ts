import { html, nothing } from "lit";
import type { WorkflowRunSummary, WorkflowSummary } from "../controllers/pmos-workflows.ts";
import type { ChatProps } from "./chat.ts";
import { renderChat } from "./chat.ts";


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

  centerSplitRatio: number;
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

export function renderAutomations(props: AutomationsProps) {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

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
        >X</button>
      </div>
      <!-- AI thoughts / step progress (shown while AI is working) -->
      ${props.chatSteps.length > 0 && props.chatProps.sending ? html`
        <details class="ai-thoughts" open>
          <summary style="cursor:pointer;padding:6px 12px;font-size:12px;color:var(--muted,#888);user-select:none;display:flex;align-items:center;gap:6px;">
            <span style="animation:spin 1s linear infinite;display:inline-block;">o</span>
            Thinking... (${props.chatSteps.length} step${props.chatSteps.length === 1 ? "" : "s"})
          </summary>
          <div style="padding:6px 12px 8px;font-size:11px;color:var(--muted,#888);font-family:monospace;line-height:1.5;max-height:120px;overflow-y:auto;background:var(--bg-secondary,rgba(0,0,0,0.15));border-top:1px solid var(--border,rgba(255,255,255,0.08));">
            ${props.chatSteps.map((step) => html`<div>- ${step}</div>`)}
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
          AI Assistant ${props.chatOpen ? ">" : "<"}
        </button>
      </div>

      <!-- main row -->
      <div class="automations-layout">

        <div class="automations-main">
          ${!props.chatOpen || isMobile
            ? html`
                <div class="automations-canvas">
                  <iframe
                    src=${props.embedUrl}
                    title="Workflow Canvas"
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
                      title="Workflow Canvas"
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

