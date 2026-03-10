import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderCommandCenter, type CommandCenterProps } from "./command-center.ts";

function createChatProps() {
  return {
    sessionKey: "session-1",
    onSessionKeyChange: vi.fn(),
    thinkingLevel: null,
    showThinking: false,
    loading: false,
    sending: false,
    messages: [],
    toolMessages: [],
    stream: null,
    streamStartedAt: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: null,
    focusMode: false,
    assistantName: "Assistant",
    assistantAvatar: null,
    onRefresh: vi.fn(),
    onToggleFocusMode: vi.fn(),
    onDraftChange: vi.fn(),
    onSend: vi.fn(),
    onQueueRemove: vi.fn(),
    onNewSession: vi.fn(),
  };
}

function createProps(overrides: Partial<CommandCenterProps> = {}): CommandCenterProps {
  return {
    connected: true,
    loading: false,
    error: null,
    snapshot: null,
    projectSearch: "",
    chatProps: createChatProps(),
    onRefresh: vi.fn(),
    onOpenIntegrations: vi.fn(),
    onOpenWorkflows: vi.fn(),
    onPrefillChat: vi.fn(),
    onProjectSearchChange: vi.fn(),
    viewMode: "cards" as const,
    onViewModeChange: vi.fn(),
    ...overrides,
  };
}

describe("command-center view", () => {
  it("shows a neutral loading chip before the first snapshot arrives", () => {
    const container = document.createElement("div");
    render(renderCommandCenter(createProps()), container);

    expect(container.textContent).toContain("Checking Basecamp...");
    expect(container.textContent).not.toContain("Basecamp key missing");
  });

  it("avoids the missing-key warning when Basecamp access is already live", () => {
    const container = document.createElement("div");
    render(
      renderCommandCenter(
        createProps({
          snapshot: {
            workspaceId: "ws-1",
            configured: false,
            connected: true,
            connectorUrl: "https://bcgpt.wickedlab.io",
            identity: {
              connected: true,
              email: "user@example.com",
            },
            totals: {
              projectCount: 0,
              syncedProjects: 0,
              openTodos: 0,
              overdueTodos: 0,
              dueTodayTodos: 0,
            },
            projects: [],
            urgentTodos: [],
            dueTodayTodos: [],
            errors: [],
            refreshedAtMs: Date.now(),
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Basecamp available");
    expect(container.textContent).not.toContain(
      "Add your Basecamp token in Integrations to enable project cards and AI project actions.",
    );
  });
});
