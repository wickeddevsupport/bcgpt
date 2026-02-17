import { describe, expect, it, vi, afterEach } from "vitest";
import { readWorkspaceConnectors } from "./workspace-connectors.js";
import { pmosHandlers } from "./server-methods/pmos.js";

describe("pmos.connectors.workspace.provision_ops", () => {
  const workspaceId = `test-provision-${Date.now()}`;
  const opsUrl = "http://ops.test";

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      // cleanup workspace connectors file
      const { workspaceConnectorsPath } = await import("./workspace-connectors.js");
      const p = workspaceConnectorsPath(workspaceId);
      const fs = await import("node:fs/promises");
      await fs.rm(p.replace("/connectors.json", ""), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates project + api key and persists both", async () => {
    vi.stubEnv("OPS_URL", opsUrl);
    vi.stubEnv("OPS_API_KEY", "global-key");

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/v1/projects")) {
        return { ok: true, status: 201, text: async () => JSON.stringify({ id: "proj-123" }) } as any;
      }
      if (url.endsWith("/api/v1/api-keys")) {
        return { ok: true, status: 201, text: async () => JSON.stringify({ key: "workspace-key" }) } as any;
      }
      return { ok: false, status: 404, text: async () => "" } as any;
    });
    vi.stubGlobal("fetch", fetchMock as any);

    const respond = vi.fn();
    const client = { pmosWorkspaceId: workspaceId, pmosRole: "workspace_admin" } as any;

    await pmosHandlers["pmos.connectors.workspace.provision_ops"]({ params: { projectName: "Tst" }, respond, client } as any);

    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ ok: true, workspaceId, projectId: "proj-123", apiKey: "workspace-key" }), undefined);

    const saved = await readWorkspaceConnectors(workspaceId);
    expect(saved?.ops?.url).toContain(opsUrl);
    expect(saved?.ops?.apiKey).toBe("workspace-key");
    expect(saved?.ops?.projectId).toBe("proj-123");
  });

  it("when Projects API is license-gated, persists API key only", async () => {
    vi.stubEnv("OPS_URL", opsUrl);
    vi.stubEnv("OPS_API_KEY", "global-key");

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/v1/projects")) {
        // simulate license error
        return { ok: false, status: 403, text: async () => JSON.stringify({ message: "license error" }) } as any;
      }
      if (url.endsWith("/api/v1/api-keys")) {
        return { ok: true, status: 201, text: async () => JSON.stringify({ key: "workspace-key-2" }) } as any;
      }
      return { ok: false, status: 404, text: async () => "" } as any;
    });
    vi.stubGlobal("fetch", fetchMock as any);

    const respond = vi.fn();
    const client = { pmosWorkspaceId: workspaceId, pmosRole: "workspace_admin" } as any;

    await pmosHandlers["pmos.connectors.workspace.provision_ops"]({ params: {}, respond, client } as any);

    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ ok: true, workspaceId, projectId: undefined, apiKey: "workspace-key-2" }), undefined);

    const saved = await readWorkspaceConnectors(workspaceId);
    expect(saved?.ops?.apiKey).toBe("workspace-key-2");
    expect(saved?.ops?.projectId).toBeUndefined();
  });

  it("fails when both project creation and API-key creation are unavailable", async () => {
    vi.stubEnv("OPS_URL", opsUrl);
    vi.stubEnv("OPS_API_KEY", "global-key");

    const fetchMock = vi.fn(async (_url: string) => ({ ok: false, status: 404, text: async () => "not found" }) as any);
    vi.stubGlobal("fetch", fetchMock as any);

    const respond = vi.fn();
    const client = { pmosWorkspaceId: workspaceId, pmosRole: "workspace_admin" } as any;

    await pmosHandlers["pmos.connectors.workspace.provision_ops"]({ params: {}, respond, client } as any);

    expect(respond).toHaveBeenCalled();
    const call = respond.mock.calls[0];
    expect(call[0]).toBe(false); // failure
  });
});