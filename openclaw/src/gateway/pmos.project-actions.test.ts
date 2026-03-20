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

describe("pmos Basecamp project actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockReturnValue({});
    readWorkspaceConnectorsMock.mockResolvedValue({
      bcgpt: {
        url: "https://bcgpt.example.test",
        apiKey: "workspace-key",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a todo through BCGPT", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith("/mcp")) return jsonResponse({ error: "not found" }, 404);
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      expect(body.params?.name).toBe("create_todo");
      expect(body.params?.arguments).toMatchObject({
        project: "Project One",
        task: "Ship launch checklist",
        todolist: "Operations",
        due_on: "2026-03-21",
      });
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.params?.name,
        result: {
          message: "Todo created",
          todo: {
            id: 42,
            title: "Ship launch checklist",
            app_url: "https://3.basecamp.example/todos/42",
            due_on: "2026-03-21",
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const respond = vi.fn();
    await pmosHandlers["pmos.todo.create"]({
      params: {
        projectName: "Project One",
        title: "Ship launch checklist",
        todolist: "Operations",
        dueOn: "2026-03-21",
      },
      respond,
      client: { pmosWorkspaceId: "ws-1", pmosRole: "workspace_admin" } as any,
    } as any);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        message: "Todo created",
        detail: expect.objectContaining({
          id: "42",
          title: "Ship launch checklist",
        }),
      }),
      undefined,
    );
  });

  it("completes a todo through BCGPT", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      expect(body.params?.name).toBe("complete_todo");
      expect(body.params?.arguments).toMatchObject({
        project: "Project One",
        todo_id: 42,
      });
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.params?.name,
        result: { message: "Todo completed", todo_id: 42 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const respond = vi.fn();
    await pmosHandlers["pmos.todo.complete"]({
      params: { projectName: "Project One", todoId: "42" },
      respond,
      client: { pmosWorkspaceId: "ws-1", pmosRole: "workspace_admin" } as any,
    } as any);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        message: "Todo completed",
        detail: { todoId: "42", status: "completed" },
      }),
      undefined,
    );
  });

  it("creates an entity comment through BCGPT", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      expect(body.params?.name).toBe("create_comment");
      expect(body.params?.arguments).toMatchObject({
        project: "Project One",
        recording_id: "42",
        content: "Blocked on client review.",
      });
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.params?.name,
        result: {
          message: "Comment created",
          comment: {
            id: 901,
            created_at: "2026-03-20T03:14:00Z",
            app_url: "https://3.basecamp.example/comments/901",
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const respond = vi.fn();
    await pmosHandlers["pmos.comment.create"]({
      params: {
        projectName: "Project One",
        type: "todo",
        id: "42",
        content: "Blocked on client review.",
      },
      respond,
      client: { pmosWorkspaceId: "ws-1", pmosRole: "workspace_admin" } as any,
    } as any);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        message: "Comment created",
        detail: expect.objectContaining({ id: "901" }),
      }),
      undefined,
    );
  });
});
