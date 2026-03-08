import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/gateway/workspace-connectors.js", () => ({
  readWorkspaceConnectors: vi.fn(async () => null),
}));

vi.mock("../../src/gateway/workflow-api-client.js", () => ({
  executeWorkflowEngineWorkflow: vi.fn(),
}));

import plugin from "./index.js";
import { executeWorkflowEngineWorkflow } from "../../src/gateway/workflow-api-client.js";

type RegisteredTool = {
  name: string;
  execute: (toolCallIdOrParams: unknown, maybeParams?: unknown) => Promise<unknown>;
};

function createApi() {
  const tools: RegisteredTool[] = [];
  return {
    tools,
    api: {
      config: {
        pmos: {
          connectors: {
            activepieces: {
              url: "https://flow.example.test",
              apiKey: "service-key",
              projectId: "proj_1",
            },
          },
        },
      },
      pluginConfig: {},
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {},
      },
      registerTool(tool: RegisteredTool) {
        tools.push(tool);
      },
    },
  };
}

function getToolText(result: unknown): string {
  const obj = result as { content?: Array<{ text?: string }> };
  return obj.content?.[0]?.text ?? "";
}

describe("wicked-ops ops_workflow_execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("delegates plain workflow execution to the shared workflow engine client", async () => {
    const { api, tools } = createApi();
    plugin.register(api as never);
    const tool = tools.find((entry) => entry.name === "ops_workflow_execute");
    expect(tool).toBeTruthy();

    vi.mocked(executeWorkflowEngineWorkflow).mockResolvedValue({
      ok: true,
      executionId: "run_123",
    });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          id: "run_123",
          status: "RUNNING",
          flowId: "flow_1",
          createdAt: "2026-03-08T00:00:00.000Z",
        }),
    } as Response);

    const result = await tool!.execute("call_1", {
      workspaceId: "ws_1",
      workflowId: "flow_1",
      data: {},
    });

    expect(executeWorkflowEngineWorkflow).toHaveBeenCalledWith("ws_1", "flow_1");
    expect(fetch).toHaveBeenCalledWith(
      "https://flow.example.test/api/v1/flow-runs/run_123",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer service-key",
        }),
      }),
    );
    expect(JSON.parse(getToolText(result))).toMatchObject({
      id: "run_123",
      workflowId: "flow_1",
      status: "running",
    });
  });

  it("keeps webhook execution for explicit payloads", async () => {
    const { api, tools } = createApi();
    plugin.register(api as never);
    const tool = tools.find((entry) => entry.name === "ops_workflow_execute");
    expect(tool).toBeTruthy();

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ ok: true, mode: "webhook" }),
    } as Response);

    const result = await tool!.execute("call_2", {
      workspaceId: "ws_1",
      workflowId: "flow_1",
      data: { foo: "bar" },
    });

    expect(executeWorkflowEngineWorkflow).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "https://flow.example.test/api/v1/webhooks/flow_1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ foo: "bar" }),
      }),
    );
    expect(JSON.parse(getToolText(result))).toMatchObject({ ok: true, mode: "webhook" });
  });

  it("uses the native flow-run retry endpoint for retries", async () => {
    const { api, tools } = createApi();
    plugin.register(api as never);
    const tool = tools.find((entry) => entry.name === "ops_workflow_execute");
    expect(tool).toBeTruthy();

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ data: [{ id: "proj_1" }] }),
    } as Response);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          id: "run_retry",
          status: "QUEUED",
          flowId: "flow_1",
          createdAt: "2026-03-08T00:00:00.000Z",
        }),
    } as Response);

    const result = await tool!.execute("call_3", {
      workspaceId: "ws_1",
      workflowId: "flow_1",
      data: {
        __retryExecutionId: "run_old",
        __retryStrategy: "ON_LATEST_VERSION",
      },
    });

    expect(executeWorkflowEngineWorkflow).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "https://flow.example.test/api/v1/flow-runs/run_old/retry",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectId: "proj_1",
          strategy: "ON_LATEST_VERSION",
        }),
      }),
    );
    expect(JSON.parse(getToolText(result))).toMatchObject({
      id: "run_retry",
      workflowId: "flow_1",
      status: "running",
    });
  });

  it("prefers the live projects list over a stale saved project id", async () => {
    const { api, tools } = createApi();
    api.config = {
      pmos: {
        connectors: {
          activepieces: {
            url: "https://flow.example.test",
            apiKey: "service-key",
          },
        },
      },
    };
    api.pluginConfig = {
      projectId: "stale_proj",
    };
    plugin.register(api as never);
    const tool = tools.find((entry) => entry.name === "ops_executions_list");
    expect(tool).toBeTruthy();

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ next: null, previous: null, data: [{ id: "proj_live" }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ data: [] }),
      } as Response);

    const result = await tool!.execute("call_4", {
      workspaceId: "ws_1",
      workflowId: "flow_1",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://flow.example.test/api/v1/projects",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0] ?? "")).toContain("projectId=proj_live");
    expect(String(vi.mocked(fetch).mock.calls[1]?.[0] ?? "")).not.toContain("projectId=stale_proj");
    expect(JSON.parse(getToolText(result))).toMatchObject({ data: [] });
  });
});
