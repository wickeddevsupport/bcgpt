import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.fn(() => ({}));
vi.mock("../config/config.js", () => ({
  loadConfig: loadConfigMock,
}));

const readWorkspaceConnectorsMock = vi.fn();
vi.mock("./workspace-connectors.js", () => ({
  readWorkspaceConnectors: readWorkspaceConnectorsMock,
}));

const socketIoMock = vi.fn();
vi.mock("socket.io-client", () => ({
  io: socketIoMock,
}));

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("n8n api client activepieces import path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockReturnValue({});
    socketIoMock.mockReset();
    readWorkspaceConnectorsMock.mockResolvedValue({
      ops: {
        url: "https://flow.example.test",
        apiKey: "workspace-token",
        projectId: "proj_1",
      },
    });
  });

  it("imports compat graph as a native Activepieces flow on create", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "flow_1", displayName: "Native Import" }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: "flow_1", metadata: {} }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "conn_1",
              externalId: "openclaw-basecamp",
              displayName: "Basecamp",
              pieceName: "@activepieces/piece-basecamp",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          piece: {
            name: "@activepieces/piece-webhook",
            version: "0.1.0",
            triggers: {
              catch_webhook: {},
            },
            actions: {
              return_response: {},
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "flow_1",
          displayName: "Native Import",
          status: "DISABLED",
          metadata: {
            n8nCompat: {
              nodes: [
                {
                  id: "trigger-1",
                  name: "Webhook",
                  type: "n8n-nodes-base.webhook",
                  typeVersion: 1,
                  position: [250, 300],
                  parameters: { path: "native-import" },
                },
                {
                  id: "basecamp-1",
                  name: "List Projects",
                  type: "n8n-nodes-basecamp.basecamp",
                  typeVersion: 1,
                  position: [500, 300],
                  parameters: { resource: "project", operation: "getAll" },
                  credentials: {
                    basecampApi: { id: "conn_1", name: "Basecamp" },
                  },
                },
              ],
              connections: {
                Webhook: { main: [[{ node: "List Projects", type: "main", index: 0 }]] },
              },
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { createN8nWorkflow } = await import("./n8n-api-client.js");
    const result = await createN8nWorkflow("ws_1", {
      name: "Native Import",
      active: false,
      nodes: [
        {
          id: "trigger-1",
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          typeVersion: 1,
          position: [250, 300],
          parameters: { path: "native-import" },
        },
        {
          id: "basecamp-1",
          name: "List Projects",
          type: "n8n-nodes-basecamp.basecamp",
          typeVersion: 1,
          position: [500, 300],
          parameters: { resource: "project", operation: "getAll" },
          credentials: {
            basecampApi: { id: "conn_1", name: "Basecamp" },
          },
        },
      ],
      connections: {
        Webhook: { main: [[{ node: "List Projects", type: "main", index: 0 }]] },
      },
      settings: {},
      tags: [],
    });

    expect(result.ok).toBe(true);
    const importCall = fetchMock.mock.calls.find((call) => {
      const [, init] = call;
      if (!String(call[0]).includes("/api/v1/flows/flow_1")) {
        return false;
      }
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return body?.type === "IMPORT_FLOW";
    });
    expect(importCall).toBeTruthy();

    const importBody = JSON.parse(String((importCall?.[1] as RequestInit | undefined)?.body ?? "{}")) as {
      request?: { trigger?: Record<string, unknown> };
    };
    const trigger = importBody.request?.trigger as Record<string, unknown>;
    expect(trigger?.type).toBe("PIECE_TRIGGER");
    expect((trigger?.settings as Record<string, unknown>)?.pieceName).toBe("@activepieces/piece-webhook");

    const nextAction = (trigger?.nextAction as Record<string, unknown>) ?? {};
    expect(nextAction.type).toBe("PIECE");
    expect((nextAction.settings as Record<string, unknown>)?.pieceName).toBe("@activepieces/piece-basecamp");
    expect((nextAction.settings as Record<string, unknown>)?.actionName).toBe("projects");
    expect((nextAction.settings as { input?: Record<string, unknown> })?.input?.operation).toBe("list_projects");
    expect((nextAction.settings as { input?: Record<string, unknown> })?.input?.auth).toBe(
      "{{connections['openclaw-basecamp']}}",
    );
  });

  it("maps basecamp todolist getAll to the native list_todolists operation", async () => {
    const { __test } = await import("./n8n-api-client.js");
    const step = __test.createBasecampActionStep(
      {
        id: "basecamp-1",
        stepName: "list_lists",
        displayName: "List Todo Lists",
        role: "action",
        rawType: "n8n-nodes-basecamp.basecamp",
        pieceHint: "n8n-nodes-basecamp.basecamp",
        parameters: {
          resource: "todolist",
          operation: "getAll",
          projectId: "123",
        },
        credentials: null,
      },
      "openclaw-basecamp",
    );
    expect(step).toBeTruthy();
    const settings = (step?.settings as { actionName?: string; input?: Record<string, unknown> }) ?? {};
    expect(settings.actionName).toBe("todos");
    expect(settings.input?.operation).toBe("list_todolists");
    expect(settings.input?.project).toBe("123");
  });

  it("executes manual-trigger workflows through the Activepieces manual-run socket when workspace user auth is available", async () => {
    readWorkspaceConnectorsMock.mockResolvedValue({
      ops: {
        url: "https://flow.example.test",
        projectId: "proj_1",
        user: {
          email: "user@example.test",
          password: "secret",
        },
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "user-token", projectId: "proj_1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "flow_1",
          displayName: "Native Import",
          status: "DISABLED",
          version: { id: "ver_1" },
          metadata: {
            n8nCompat: {
              nodes: [
                {
                  id: "trigger-1",
                  name: "Manual Trigger",
                  type: "activepieces.trigger.manual",
                },
              ],
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const socketHandlers = new Map<string, Array<(payload?: unknown) => void>>();
    const socket = {
      connect: vi.fn(() => {
        for (const handler of socketHandlers.get("connect") ?? []) {
          handler();
        }
      }),
      disconnect: vi.fn(),
      once: vi.fn((event: string, handler: (payload?: unknown) => void) => {
        const list = socketHandlers.get(event) ?? [];
        socketHandlers.set(event, [...list, handler]);
        return socket;
      }),
      on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
        const list = socketHandlers.get(event) ?? [];
        socketHandlers.set(event, [...list, handler]);
        return socket;
      }),
      off: vi.fn((event: string, handler: (payload?: unknown) => void) => {
        const list = socketHandlers.get(event) ?? [];
        socketHandlers.set(
          event,
          list.filter((entry) => entry !== handler),
        );
        return socket;
      }),
      emit: vi.fn((event: string, payload: { flowVersionId?: string }) => {
        if (event === "MANUAL_TRIGGER_RUN_STARTED") {
          for (const handler of socketHandlers.get("MANUAL_TRIGGER_RUN_STARTED") ?? []) {
            handler({ id: "run_1", flowVersionId: payload.flowVersionId });
          }
        }
        return socket;
      }),
    };
    socketIoMock.mockReturnValue(socket);

    const { executeN8nWorkflow } = await import("./n8n-api-client.js");
    const result = await executeN8nWorkflow("ws_2", "flow_1");

    expect(result).toEqual({ ok: true, executionId: "run_1" });
    expect(socketIoMock).toHaveBeenCalledWith(
      "https://flow.example.test",
      expect.objectContaining({
        path: "/api/socket.io",
        auth: { token: "user-token", projectId: "proj_1" },
      }),
    );
    expect(socket.emit).toHaveBeenCalledWith("MANUAL_TRIGGER_RUN_STARTED", {
      flowVersionId: "ver_1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("executes non-manual workflows through the Activepieces test-run socket when workspace user auth is available", async () => {
    readWorkspaceConnectorsMock.mockResolvedValue({
      ops: {
        url: "https://flow.example.test",
        projectId: "proj_1",
        user: {
          email: "user@example.test",
          password: "secret",
        },
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "user-token", projectId: "proj_1" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "flow_1",
          displayName: "Scheduled Flow",
          status: "DISABLED",
          version: { id: "ver_1" },
          metadata: {
            n8nCompat: {
              nodes: [
                {
                  id: "trigger-1",
                  name: "Schedule",
                  type: "activepieces.trigger.schedule",
                },
              ],
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const socketHandlers = new Map<string, Array<(payload?: unknown) => void>>();
    const socket = {
      connect: vi.fn(() => {
        for (const handler of socketHandlers.get("connect") ?? []) {
          handler();
        }
      }),
      disconnect: vi.fn(),
      once: vi.fn((event: string, handler: (payload?: unknown) => void) => {
        const list = socketHandlers.get(event) ?? [];
        socketHandlers.set(event, [...list, handler]);
        return socket;
      }),
      on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
        const list = socketHandlers.get(event) ?? [];
        socketHandlers.set(event, [...list, handler]);
        return socket;
      }),
      off: vi.fn((event: string, handler: (payload?: unknown) => void) => {
        const list = socketHandlers.get(event) ?? [];
        socketHandlers.set(
          event,
          list.filter((entry) => entry !== handler),
        );
        return socket;
      }),
      emit: vi.fn((event: string, payload: { flowVersionId?: string }) => {
        if (event === "TEST_FLOW_RUN") {
          for (const handler of socketHandlers.get("TEST_FLOW_RUN_STARTED") ?? []) {
            handler({ id: "run_2", flowVersionId: payload.flowVersionId });
          }
        }
        return socket;
      }),
    };
    socketIoMock.mockReturnValue(socket);

    const { executeN8nWorkflow } = await import("./n8n-api-client.js");
    const result = await executeN8nWorkflow("ws_1", "flow_1");

    expect(result).toEqual({ ok: true, executionId: "run_2" });
    expect(socket.emit).toHaveBeenCalledWith("TEST_FLOW_RUN", {
      flowVersionId: "ver_1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prefers the signed-in workspace project over a stale saved project id", async () => {
    readWorkspaceConnectorsMock.mockResolvedValue({
      ops: {
        url: "https://flow.example.test",
        projectId: "stale_proj",
        user: {
          email: "user@example.test",
          password: "secret",
        },
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "user-token", projectId: "proj_live" }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { listN8nWorkflows } = await import("./n8n-api-client.js");
    const result = await listN8nWorkflows("ws_3");

    expect(result).toEqual({ ok: true, workflows: [] });
    expect(String(fetchMock.mock.calls[1]?.[0] ?? "")).toContain("projectId=proj_live");
    expect(String(fetchMock.mock.calls[1]?.[0] ?? "")).not.toContain("projectId=stale_proj");
  });
});
