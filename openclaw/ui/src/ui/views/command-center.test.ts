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
    selectedProject: null,
    projectDetailTab: "overview",
    projectSectionData: {},
    selectedEntityDetail: null,
    selectedEntityLoading: false,
    selectedEntityError: null,
    actionBusy: false,
    actionError: null,
    actionMessage: null,
    todoDraft: {
      title: "",
      description: "",
      list: "",
      dueOn: "",
    },
    entityCommentDraft: "",
    commandCenterTab: "overview" as const,
    onCommandCenterTabChange: vi.fn(),
    onRefresh: vi.fn(),
    onOpenIntegrations: vi.fn(),
    onOpenWorkflows: vi.fn(),
    onPrefillChat: vi.fn(),
    onProjectSearchChange: vi.fn(),
    viewMode: "cards" as const,
    onViewModeChange: vi.fn(),
    onSelectProject: vi.fn(),
    onProjectDetailTabChange: vi.fn(),
    onLoadProjectSection: vi.fn(),
    onOpenItemDetail: vi.fn(),
    onCloseItemDetail: vi.fn(),
    onTodoDraftChange: vi.fn(),
    onCreateTodo: vi.fn(),
    onToggleTodo: vi.fn(),
    onEntityCommentDraftChange: vi.fn(),
    onCreateEntityComment: vi.fn(),
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
              assignedTodos: 0,
              overdueTodos: 0,
              dueTodayTodos: 0,
              futureTodos: 0,
              noDueDateTodos: 0,
            },
            projects: [],
            assignedTodos: [],
            urgentTodos: [],
            dueTodayTodos: [],
            futureTodos: [],
            noDueDateTodos: [],
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

  it("renders the entity detail panel when a Basecamp item is selected", () => {
    const container = document.createElement("div");
    render(
      renderCommandCenter(
        createProps({
          selectedProject: {
            id: "1",
            name: "Project One",
            status: "active",
            appUrl: null,
            description: "Test project",
            updatedAt: null,
            dockCapabilities: [],
            todoLists: 1,
            openTodos: 2,
            assignedTodos: 1,
            overdueTodos: 0,
            dueTodayTodos: 0,
            futureTodos: 1,
            noDueDateTodos: 0,
            nextDueOn: null,
            health: "on_track",
            previewTodos: [],
          },
          selectedEntityDetail: {
            reference: { type: "todo", id: "99", projectId: "1", url: null, label: "Write docs" },
            project: { id: "1", name: "Project One", appUrl: null },
            title: "Write docs",
            status: "active",
            appUrl: null,
            createdAt: null,
            updatedAt: null,
            creator: "Rohit",
            assignee: "Rohit",
            summary: "Draft the docs",
            raw: {},
            comments: [],
            events: [],
            subscription: null,
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Item Detail");
    expect(container.textContent).toContain("Write docs");
    expect(container.textContent).toContain("Draft the docs");
  });

  it("shows the quick-add todo composer in project detail", () => {
    const container = document.createElement("div");
    render(
      renderCommandCenter(
        createProps({
          selectedProject: {
            id: "1",
            name: "Project One",
            status: "active",
            appUrl: null,
            description: "Test project",
            updatedAt: null,
            dockCapabilities: [],
            todoLists: 1,
            openTodos: 2,
            assignedTodos: 1,
            overdueTodos: 0,
            dueTodayTodos: 0,
            futureTodos: 1,
            noDueDateTodos: 0,
            nextDueOn: null,
            health: "on_track",
            previewTodos: [],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Project quick add");
    expect(container.textContent).toContain("Create todo");
  });

  it("renders todo action controls in the todos tab", () => {
    const container = document.createElement("div");
    render(
      renderCommandCenter(
        createProps({
          selectedProject: {
            id: "1",
            name: "Project One",
            status: "active",
            appUrl: null,
            description: "Test project",
            updatedAt: null,
            dockCapabilities: [],
            todoLists: 1,
            openTodos: 2,
            assignedTodos: 1,
            overdueTodos: 0,
            dueTodayTodos: 0,
            futureTodos: 1,
            noDueDateTodos: 0,
            nextDueOn: null,
            health: "on_track",
            previewTodos: [],
          },
          projectDetailTab: "todos",
          projectSectionData: {
            "1:todos": {
              loading: false,
              error: null,
              data: [
                {
                  name: "Main List",
                  todosCount: 1,
                  todos: [
                    {
                      id: "42",
                      title: "Ship launch checklist",
                      status: "active",
                      dueOn: "2026-03-21",
                      appUrl: null,
                      assignee: "Rohit",
                      completedAt: null,
                      creator: "Rohit",
                    },
                  ],
                },
              ],
            },
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Add a todo");
    expect(container.textContent).toContain("Complete");
  });
});
