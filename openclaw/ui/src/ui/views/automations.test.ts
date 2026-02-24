import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { ChatProps } from "./chat.ts";
import { renderAutomations, type AutomationsProps } from "./automations.ts";

function createChatProps(): ChatProps {
  return {
    sessionKey: "workflow-assistant",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    loading: false,
    sending: false,
    canAbort: false,
    compactionStatus: null,
    messages: [],
    toolMessages: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: null,
    focusMode: false,
    assistantName: "AI Workflow Assistant",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    onChatScroll: undefined,
    onScrollToBottom: undefined,
    onOpenSidebar: undefined,
    onCloseSidebar: undefined,
    onSplitRatioChange: undefined,
    showNewMessages: false,
  };
}

function createProps(overrides: Partial<AutomationsProps> = {}): AutomationsProps {
  return {
    connected: true,
    integrationsHref: "/integrations",
    projectId: "embedded",
    onOpenIntegrations: vi.fn(),
    embedUrl: "https://example.com/embed",
    selectedFlowLabel: null,
    loading: false,
    error: null,
    flowsQuery: "",
    flows: [],
    createName: "",
    creating: false,
    createError: null,
    selectedFlowId: null,
    flowDetailsLoading: false,
    flowDetailsError: null,
    flowDetails: null,
    renameDraft: "",
    operationDraft: "",
    triggerPayloadDraft: "{\n}\n",
    mutating: false,
    mutateError: null,
    templateDeploying: false,
    templateDeployError: null,
    templateDeployedOk: false,
    onDeployTemplate: vi.fn(),
    runs: [],
    runsLoading: false,
    runsError: null,
    onLoadRuns: vi.fn(),
    panelOpen: true,
    panelTab: "workflows",
    onPanelToggle: vi.fn(),
    onPanelTabChange: vi.fn(),
    leftPanelRatio: 0.28,
    centerSplitRatio: 0.72,
    onLeftPanelResize: vi.fn(),
    onCenterSplitResize: vi.fn(),
    chatOpen: true,
    onChatToggle: vi.fn(),
    chatMessages: [],
    chatDraft: "",
    chatSending: false,
    onChatDraftChange: vi.fn(),
    onChatSend: vi.fn(),
    chatProps: createChatProps(),
    onFlowsQueryChange: vi.fn(),
    onRefresh: vi.fn(),
    onCreateNameChange: vi.fn(),
    onCreate: vi.fn(),
    onSelectFlow: vi.fn(),
    onRenameDraftChange: vi.fn(),
    onRename: vi.fn(),
    onSetStatus: vi.fn(),
    onPublish: vi.fn(),
    onDelete: vi.fn(),
    onOperationDraftChange: vi.fn(),
    onApplyOperation: vi.fn(),
    onTriggerPayloadDraftChange: vi.fn(),
    onTriggerWebhook: vi.fn(),
    ...overrides,
  };
}

describe("automations view layout", () => {
  function withViewportWidth(width: number) {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      value: width,
      configurable: true,
    });
    return () => {
      Object.defineProperty(window, "innerWidth", {
        value: original,
        configurable: true,
      });
    };
  }

  it("renders dual resizers when left panel and chat are open", () => {
    const restore = withViewportWidth(1366);
    const container = document.createElement("div");
    render(renderAutomations(createProps()), container);

    expect(container.querySelector(".automations-layout")).not.toBeNull();
    expect(container.querySelector(".automations-left-panel")).not.toBeNull();
    expect(container.querySelector(".automations-center-split")).not.toBeNull();
    expect(container.querySelectorAll("resizable-divider").length).toBe(2);
    restore();
  });

  it("renders single center/chat resizer when left panel is closed", () => {
    const restore = withViewportWidth(1366);
    const container = document.createElement("div");
    render(
      renderAutomations(
        createProps({
          panelOpen: false,
          chatOpen: true,
        }),
      ),
      container,
    );

    expect(container.querySelector(".automations-left-panel")).toBeNull();
    expect(container.querySelector(".automations-center-split")).not.toBeNull();
    expect(container.querySelectorAll("resizable-divider").length).toBe(1);
    restore();
  });
});
