import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.fn(() => ({}));
vi.mock("../config/config.js", () => ({
  loadConfig: loadConfigMock,
}));

const readWorkspaceConnectorsMock = vi.fn();
vi.mock("./workspace-connectors.js", () => ({
  readWorkspaceConnectors: readWorkspaceConnectorsMock,
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
});
