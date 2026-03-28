import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readWorkspaceConnectors: vi.fn(),
  upsertWorkflowConnection: vi.fn(),
  listWorkflowEngineConnectionsViaApi: vi.fn(),
}));

vi.mock("./workspace-connectors.js", () => ({
  readWorkspaceConnectors: mocks.readWorkspaceConnectors,
}));

vi.mock("./workflow-api-client.js", () => ({
  createWorkflowEngineConnection: mocks.upsertWorkflowConnection,
  listWorkflowEngineConnections: mocks.listWorkflowEngineConnectionsViaApi,
  upsertBasecampWorkflowConnection: mocks.upsertWorkflowConnection,
}));

describe("credential sync workspace isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listWorkflowEngineConnectionsViaApi.mockResolvedValue({ ok: true, credentials: [] });
  });

  it("does not fall back to global Basecamp connector secrets when a workspace has none", async () => {
    mocks.readWorkspaceConnectors.mockResolvedValue({
      bcgpt: {
        url: "https://bcgpt.workspace.test",
      },
    });

    const { ensureWorkspaceBasecampCredential } = await import("./credential-sync.js");
    const result = await ensureWorkspaceBasecampCredential("ws-no-key");

    expect(result).toEqual({
      configured: false,
      ok: false,
      skippedReason: "missing_api_key",
    });
    expect(mocks.upsertWorkflowConnection).not.toHaveBeenCalled();
  });

  it("uses the workspace Basecamp connector key when present", async () => {
    mocks.readWorkspaceConnectors.mockResolvedValue({
      bcgpt: {
        url: "https://bcgpt.workspace.test",
        apiKey: "workspace-secret-key",
      },
    });
    mocks.upsertWorkflowConnection.mockResolvedValue({
      ok: true,
      credentialId: "cred-123",
    });

    const { ensureWorkspaceBasecampCredential } = await import("./credential-sync.js");
    const result = await ensureWorkspaceBasecampCredential("ws-has-key");

    expect(result).toEqual({
      configured: true,
      ok: true,
      credentialId: "cred-123",
    });
    expect(mocks.upsertWorkflowConnection).toHaveBeenCalledWith(
      "ws-has-key",
      "workspace-secret-key",
    );
  });
});
