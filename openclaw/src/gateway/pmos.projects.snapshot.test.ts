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
        overdueTodos: number;
        dueTodayTodos: number;
      };
      projects: Array<{ name: string; health: string; overdueTodos: number }>;
      urgentTodos: Array<{ title: string }>;
      dueTodayTodos: Array<{ title: string }>;
      errors: string[];
    };

    expect(payload.configured).toBe(true);
    expect(payload.connected).toBe(true);
    expect(payload.totals.projectCount).toBe(2);
    expect(payload.totals.syncedProjects).toBe(2);
    expect(payload.totals.openTodos).toBe(6);
    expect(payload.totals.overdueTodos).toBe(1);
    expect(payload.totals.dueTodayTodos).toBe(1);
    expect(payload.projects[0]?.name).toBe("BCGPT Test Project");
    expect(payload.projects[0]?.health).toBe("at_risk");
    expect(payload.projects[0]?.overdueTodos).toBe(1);
    expect(payload.urgentTodos[0]?.title).toBe("Critical Basecamp follow-up");
    expect(payload.dueTodayTodos[0]?.title).toBe("Same-day deliverable");
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
      totals: { projectCount: number; overdueTodos: number; dueTodayTodos: number };
      projects: Array<{ name: string }>;
      urgentTodos: Array<{ title: string }>;
      dueTodayTodos: Array<{ title: string }>;
    };

    expect(payload.totals.projectCount).toBe(1);
    expect(payload.totals.overdueTodos).toBe(1);
    expect(payload.totals.dueTodayTodos).toBe(1);
    expect(payload.projects[0]?.name).toBe("Shape Variant Project");
    expect(payload.urgentTodos[0]?.title).toBe("Escalate overdue API issue");
    expect(payload.dueTodayTodos[0]?.title).toBe("Same day task");
  });
});
