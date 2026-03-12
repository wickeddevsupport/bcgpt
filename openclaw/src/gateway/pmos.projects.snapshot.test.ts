import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadConfigMock, readWorkspaceConnectorsMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(() => ({})),
  readWorkspaceConnectorsMock: vi.fn(async () => null),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: loadConfigMock,
  writeConfigFile: vi.fn(async () => {}),
}));

vi.mock("./workspace-connectors.js", () => ({
  readWorkspaceConnectors: readWorkspaceConnectorsMock,
}));

import { pmosHandlers } from "./server-methods/pmos.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pmos.projects.snapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-23T12:00:00Z"));
    vi.clearAllMocks();
    loadConfigMock.mockReturnValue({});
    readWorkspaceConnectorsMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.BCGPT_API_KEY;
    delete process.env.BCGPT_URL;
  });

  it("returns a non-fatal snapshot when workspace key is missing", async () => {
    const respond = vi.fn();

    await pmosHandlers["pmos.projects.snapshot"]({
      params: {},
      respond,
      client: {
        pmosWorkspaceId: "ws-missing-key",
        pmosRole: "workspace_admin",
      } as any,
    } as any);

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    const payload = respond.mock.calls[0]?.[1] as { configured?: boolean; connected?: boolean; errors?: string[] };
    expect(payload.configured).toBe(false);
    expect(payload.connected).toBe(false);
    expect(payload.errors?.[0]).toContain("not configured");
  });

  it("builds project cards, totals, and urgency from BCGPT tools", async () => {
    readWorkspaceConnectorsMock.mockResolvedValue({
      bcgpt: {
        url: "https://bcgpt.example.test",
        apiKey: "workspace-key",
      },
    });

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/action/startbcgpt")) {
        return jsonResponse({
          connected: true,
          selected_account_id: 12345,
          user: { name: "Rajan Dangol", email: "rajan@wickedwebsites.us" },
          accounts: [{ id: 12345 }],
        });
      }

      if (url.endsWith("/mcp")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          params?: { name?: string; arguments?: Record<string, unknown> };
        };
        const tool = body.params?.name;
        const args = body.params?.arguments ?? {};
        if (tool === "list_projects") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "1",
            result: {
              projects: [
                {
                  id: 1001,
                  name: "BCGPT Test Project",
                  status: "active",
                  app_url: "https://3.basecamp.com/9999999/buckets/1001/projects/1001",
                },
                {
                  id: 2002,
                  name: "Internal Ops",
                  status: "active",
                  app_url: "https://3.basecamp.com/9999999/buckets/2002/projects/2002",
                },
              ],
            },
          });
        }
        if (tool === "list_todos_for_project") {
          const project = String(args.project ?? "");
          if (project === "1001") {
            return jsonResponse({
              jsonrpc: "2.0",
              id: "2",
              result: {
                groups: [
                  {
                    name: "Backlog",
                    todos_count: 5,
                    todos_preview: [
                      { id: 1, title: "Fix auth callback", due_on: "2026-02-23" },
                      { id: 2, title: "Update docs", due_on: "2026-02-24" },
                    ],
                  },
                ],
              },
            });
          }
          return jsonResponse({
            jsonrpc: "2.0",
            id: "3",
            result: {
              groups: [
                {
                  name: "Queue",
                  todos_count: 1,
                  todos_preview: [{ id: 3, title: "Ops sync", due_on: "2026-02-25" }],
                },
              ],
            },
          });
        }
        if (tool === "report_todos_overdue") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "4",
            result: {
              overdue: [
                {
                  id: 3001,
                  title: "Critical Basecamp follow-up",
                  due_on: "2026-02-22",
                  project: { id: 1001, name: "BCGPT Test Project" },
                  app_url: "https://3.basecamp.com/9999999/buckets/1001/todos/3001",
                },
              ],
            },
          });
        }
        if (tool === "list_todos_due") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "5",
            result: {
              todos: [
                {
                  id: 4001,
                  title: "Same-day deliverable",
                  due_on: "2026-02-23",
                  project: { id: 2002, name: "Internal Ops" },
                  app_url: "https://3.basecamp.com/9999999/buckets/2002/todos/4001",
                },
              ],
            },
          });
        }
        if (tool === "list_assigned_to_me") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "6",
            result: {
              todos: [
                {
                  id: 5001,
                  title: "Owned by me",
                  due_on: "2026-02-24",
                  project: { id: 1001, name: "BCGPT Test Project" },
                  app_url: "https://3.basecamp.com/9999999/buckets/1001/todos/5001",
                },
                {
                  id: 5002,
                  title: "No date task",
                  due_on: null,
                  project: { id: 2002, name: "Internal Ops" },
                  app_url: "https://3.basecamp.com/9999999/buckets/2002/todos/5002",
                },
              ],
            },
          });
        }
      }

      return jsonResponse({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const respond = vi.fn();
    await pmosHandlers["pmos.projects.snapshot"]({
      params: {},
      respond,
      client: {
        pmosWorkspaceId: "ws-projects",
        pmosRole: "workspace_admin",
      } as any,
    } as any);

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    const payload = respond.mock.calls[0]?.[1] as {
      configured: boolean;
      connected: boolean;
      totals: {
        projectCount: number;
        syncedProjects: number;
        openTodos: number;
        assignedTodos: number;
        overdueTodos: number;
        dueTodayTodos: number;
        futureTodos: number;
        noDueDateTodos: number;
      };
      projects: Array<{ name: string; health: string; overdueTodos: number; assignedTodos: number; futureTodos: number; noDueDateTodos: number }>;
      assignedTodos: Array<{ title: string }>;
      urgentTodos: Array<{ title: string }>;
      dueTodayTodos: Array<{ title: string }>;
      futureTodos: Array<{ title: string }>;
      noDueDateTodos: Array<{ title: string }>;
      errors: string[];
    };

    expect(payload.configured).toBe(true);
    expect(payload.connected).toBe(true);
    expect(payload.totals.projectCount).toBe(2);
    expect(payload.totals.syncedProjects).toBe(2);
    expect(payload.totals.openTodos).toBe(6);
    expect(payload.totals.assignedTodos).toBe(2);
    expect(payload.totals.overdueTodos).toBe(1);
    expect(payload.totals.dueTodayTodos).toBe(1);
    expect(payload.totals.futureTodos).toBe(3);
    expect(payload.totals.noDueDateTodos).toBe(1);
    expect(payload.projects[0]?.name).toBe("BCGPT Test Project");
    expect(payload.projects[0]?.health).toBe("at_risk");
    expect(payload.projects[0]?.assignedTodos).toBe(1);
    expect(payload.projects[0]?.overdueTodos).toBe(1);
    expect(payload.projects[0]?.futureTodos).toBe(2);
    expect(payload.projects[1]?.noDueDateTodos).toBe(1);
    expect(payload.assignedTodos[0]?.title).toBe("Owned by me");
    expect(payload.urgentTodos[0]?.title).toBe("Critical Basecamp follow-up");
    expect(payload.dueTodayTodos[0]?.title).toBe("Same-day deliverable");
    expect(payload.futureTodos[0]?.title).toBe("Owned by me");
    expect(payload.noDueDateTodos[0]?.title).toBe("No date task");
    expect(payload.errors).toEqual([]);
  });

  it("marks the workspace connected when Basecamp tools work even if startbcgpt is degraded", async () => {
    readWorkspaceConnectorsMock.mockResolvedValue({
      bcgpt: {
        url: "https://bcgpt.example.test",
        apiKey: "workspace-key",
      },
    });

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/action/startbcgpt")) {
        return jsonResponse(
          {
            connected: false,
            message: "warmup pending",
          },
          503,
        );
      }

      if (url.endsWith("/mcp")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          params?: { name?: string; arguments?: Record<string, unknown> };
        };
        const tool = body.params?.name;
        if (tool === "list_projects") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "1",
            result: {
              projects: [
                {
                  id: 1001,
                  name: "BCGPT Test Project",
                  status: "active",
                  app_url: "https://3.basecamp.com/9999999/buckets/1001/projects/1001",
                },
              ],
            },
          });
        }
        if (tool === "list_todos_for_project") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "2",
            result: {
              groups: [],
            },
          });
        }
        if (tool === "report_todos_overdue") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "3",
            result: {
              overdue: [],
            },
          });
        }
        if (tool === "list_todos_due") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "4",
            result: {
              todos: [],
            },
          });
        }
        if (tool === "list_assigned_to_me") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "5",
            result: {
              todos: [],
            },
          });
        }
      }

      return jsonResponse({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const respond = vi.fn();
    await pmosHandlers["pmos.projects.snapshot"]({
      params: {},
      respond,
      client: {
        pmosWorkspaceId: "ws-projects",
        pmosRole: "workspace_admin",
      } as any,
    } as any);

    const payload = respond.mock.calls[0]?.[1] as {
      connected: boolean;
      errors: string[];
    };
    expect(payload.connected).toBe(true);
    expect(payload.errors[0]).toContain("identity check failed");
  });

  it("falls back to the shared bcgpt env key for workspace admins", async () => {
    process.env.BCGPT_API_KEY = "shared-key";
    process.env.BCGPT_URL = "https://bcgpt.shared.test";

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/action/startbcgpt")) {
        return jsonResponse({
          connected: true,
          selected_account_id: 12345,
          user: { name: "Shared User", email: "shared@wickedlab.io" },
          accounts: [{ id: 12345 }],
        });
      }

      if (url.endsWith("/mcp")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          params?: { name?: string };
        };
        if (body.params?.name === "list_projects") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "1",
            result: {
              projects: [
                {
                  id: 1001,
                  name: "Shared Basecamp Project",
                  status: "active",
                  app_url: "https://3.basecamp.com/9999999/buckets/1001/projects/1001",
                },
              ],
            },
          });
        }
        return jsonResponse({ jsonrpc: "2.0", id: "2", result: { groups: [], overdue: [], todos: [] } });
      }

      return jsonResponse({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const respond = vi.fn();
    await pmosHandlers["pmos.projects.snapshot"]({
      params: {},
      respond,
      client: {
        pmosWorkspaceId: "ws-shared-projects",
        pmosRole: "workspace_admin",
      } as any,
    } as any);

    const payload = respond.mock.calls[0]?.[1] as {
      configured: boolean;
      connected: boolean;
      connectorUrl: string;
      totals: { projectCount: number };
    };

    expect(payload.configured).toBe(true);
    expect(payload.connected).toBe(true);
    expect(payload.connectorUrl).toBe("https://bcgpt.shared.test");
    expect(payload.totals.projectCount).toBe(1);
  });

  it("accepts alternate tool payload shapes for projects and todos", async () => {
    readWorkspaceConnectorsMock.mockResolvedValue({
      bcgpt: {
        url: "https://bcgpt.example.test",
        apiKey: "workspace-key",
      },
    });

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/action/startbcgpt")) {
        return jsonResponse({ connected: true, user: { email: "ops@wickedlab.io" } });
      }

      if (url.endsWith("/mcp")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          params?: { name?: string; arguments?: Record<string, unknown> };
        };
        const tool = body.params?.name;

        if (tool === "list_projects") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "1",
            result: {
              data: [
                {
                  id: 9876,
                  name: "Shape Variant Project",
                  status: "active",
                  app_url: "https://3.basecamp.com/9999999/buckets/9876/projects/9876",
                },
              ],
            },
          });
        }
        if (tool === "list_todos_for_project") {
          return jsonResponse({ jsonrpc: "2.0", id: "2", result: { groups: [] } });
        }
        if (tool === "report_todos_overdue") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "3",
            result: {
              items: [
                {
                  id: 1,
                  title: "Escalate overdue API issue",
                  due_on: "2026-02-22",
                  project: { id: 9876, name: "Shape Variant Project" },
                },
              ],
            },
          });
        }
        if (tool === "list_todos_due") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "4",
            result: {
              data: [
                {
                  id: 2,
                  title: "Same day task",
                  due_on: "2026-02-23",
                  project: { id: 9876, name: "Shape Variant Project" },
                },
              ],
            },
          });
        }
        if (tool === "list_assigned_to_me") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "5",
            result: {
              todos: [
                {
                  id: 3,
                  title: "Unscheduled task",
                  due_on: null,
                  project: { id: 9876, name: "Shape Variant Project" },
                },
              ],
            },
          });
        }
      }

      return jsonResponse({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const respond = vi.fn();
    await pmosHandlers["pmos.projects.snapshot"]({
      params: {},
      respond,
      client: {
        pmosWorkspaceId: "ws-projects",
        pmosRole: "workspace_admin",
      } as any,
    } as any);

    const payload = respond.mock.calls[0]?.[1] as {
      totals: { projectCount: number; overdueTodos: number; dueTodayTodos: number; assignedTodos: number; noDueDateTodos: number };
      projects: Array<{ name: string }>;
      assignedTodos: Array<{ title: string }>;
      urgentTodos: Array<{ title: string }>;
      dueTodayTodos: Array<{ title: string }>;
      noDueDateTodos: Array<{ title: string }>;
    };

    expect(payload.totals.projectCount).toBe(1);
    expect(payload.totals.assignedTodos).toBe(1);
    expect(payload.totals.overdueTodos).toBe(1);
    expect(payload.totals.dueTodayTodos).toBe(1);
    expect(payload.totals.noDueDateTodos).toBe(1);
    expect(payload.projects[0]?.name).toBe("Shape Variant Project");
    expect(payload.assignedTodos[0]?.title).toBe("Unscheduled task");
    expect(payload.urgentTodos[0]?.title).toBe("Escalate overdue API issue");
    expect(payload.dueTodayTodos[0]?.title).toBe("Same day task");
    expect(payload.noDueDateTodos[0]?.title).toBe("Unscheduled task");
  });

  it("keeps the snapshot usable when due-today lookup aborts", async () => {
    readWorkspaceConnectorsMock.mockResolvedValue({
      bcgpt: {
        url: "https://bcgpt.example.test",
        apiKey: "workspace-key",
      },
    });

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/action/startbcgpt")) {
        return jsonResponse({
          connected: true,
          selected_account_id: 12345,
          user: { name: "Rohit", email: "rohit@wickedwebsites.us" },
          accounts: [{ id: 12345 }],
        });
      }

      if (url.endsWith("/mcp")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          params?: { name?: string; arguments?: Record<string, unknown> };
        };
        const tool = body.params?.name;
        if (tool === "list_projects") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "1",
            result: {
              projects: [
                {
                  id: 1001,
                  name: "Abort Regression Project",
                  status: "active",
                  app_url: "https://3.basecamp.com/9999999/buckets/1001/projects/1001",
                },
              ],
            },
          });
        }
        if (tool === "list_todos_for_project") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "2",
            result: {
              groups: [
                {
                  name: "Queue",
                  todos_count: 3,
                  todos_preview: [
                    { id: 101, title: "Past item", due_on: "2026-02-22" },
                    { id: 102, title: "Today item", due_on: "2026-02-23" },
                    { id: 103, title: "Future item", due_on: "2026-02-24" },
                  ],
                },
              ],
            },
          });
        }
        if (tool === "report_todos_overdue") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "3",
            result: {
              overdue: [
                {
                  id: 101,
                  title: "Past item",
                  due_on: "2026-02-22",
                  project: { id: 1001, name: "Abort Regression Project" },
                },
              ],
            },
          });
        }
        if (tool === "list_todos_due") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "4",
            error: { message: "This operation was aborted" },
          }, 500);
        }
        if (tool === "list_assigned_to_me") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: "5",
            result: {
              todos: [
                {
                  id: 104,
                  title: "No date assigned",
                  due_on: null,
                  project: { id: 1001, name: "Abort Regression Project" },
                },
              ],
            },
          });
        }
      }

      return jsonResponse({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const respond = vi.fn();
    await pmosHandlers["pmos.projects.snapshot"]({
      params: {},
      respond,
      client: {
        pmosWorkspaceId: "ws-projects",
        pmosRole: "workspace_admin",
      } as any,
    } as any);

    const payload = respond.mock.calls[0]?.[1] as {
      connected: boolean;
      totals: { overdueTodos: number; dueTodayTodos: number; futureTodos: number; noDueDateTodos: number; assignedTodos: number };
      dueTodayTodos: Array<{ title: string }>;
      futureTodos: Array<{ title: string }>;
      noDueDateTodos: Array<{ title: string }>;
      errors: string[];
    };

    expect(payload.connected).toBe(true);
    expect(payload.totals.assignedTodos).toBe(1);
    expect(payload.totals.overdueTodos).toBe(1);
    expect(payload.totals.dueTodayTodos).toBe(1);
    expect(payload.totals.futureTodos).toBe(1);
    expect(payload.totals.noDueDateTodos).toBe(1);
    expect(payload.dueTodayTodos[0]?.title).toBe("Today item");
    expect(payload.futureTodos[0]?.title).toBe("Future item");
    expect(payload.noDueDateTodos[0]?.title).toBe("No date assigned");
    expect(payload.errors).toEqual([]);
  });
});
