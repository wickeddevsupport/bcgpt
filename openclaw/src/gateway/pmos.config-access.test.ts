import { afterEach, describe, expect, it, vi } from "vitest";
import { pmosHandlers } from "./server-methods/pmos.js";
import { readWorkspaceConnectors, workspaceConnectorsPath } from "./workspace-connectors.js";
import { readWorkspaceAiContext } from "./workspace-ai-context.js";

describe("pmos config access + connector merge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("denies non-super-admin access to global config get/set", async () => {
    const respondGet = vi.fn();
    await pmosHandlers["pmos.config.global.get"]({
      params: {},
      respond: respondGet,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: "ws-a" } as any,
    } as any);
    expect(respondGet).toHaveBeenCalled();
    expect(respondGet.mock.calls[0]?.[0]).toBe(false);
    expect(String(respondGet.mock.calls[0]?.[2]?.message ?? "")).toContain("super_admin role required");

    const respondSet = vi.fn();
    await pmosHandlers["pmos.config.global.set"]({
      params: { patch: { test: true } },
      respond: respondSet,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: "ws-a" } as any,
    } as any);
    expect(respondSet).toHaveBeenCalled();
    expect(respondSet.mock.calls[0]?.[0]).toBe(false);
    expect(String(respondSet.mock.calls[0]?.[2]?.message ?? "")).toContain("super_admin role required");
  });

  it("deep-merges workspace connector updates without dropping existing nested keys", async () => {
    const workspaceId = `pmos-merge-${Date.now()}`;
    const respond1 = vi.fn();
    await pmosHandlers["pmos.connectors.workspace.set"]({
      params: {
        connectors: {
          ops: {
            apiKey: "key-123",
            projectId: "proj-123",
          },
          bcgpt: {
            apiKey: "bcgpt-123",
          },
        },
      },
      respond: respond1,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: workspaceId } as any,
    } as any);
    expect(respond1.mock.calls[0]?.[0]).toBe(true);

    const respond2 = vi.fn();
    await pmosHandlers["pmos.connectors.workspace.set"]({
      params: {
        connectors: {
          ops: {
            url: "https://ops.example.test",
          },
          bcgpt: {
            url: "https://bcgpt.example.test",
          },
        },
      },
      respond: respond2,
      client: { pmosRole: "workspace_admin", pmosWorkspaceId: workspaceId } as any,
    } as any);
    expect(respond2.mock.calls[0]?.[0]).toBe(true);

    const saved = await readWorkspaceConnectors(workspaceId);
    expect(saved?.ops?.url).toBe("https://ops.example.test");
    expect(saved?.ops?.apiKey).toBe("key-123");
    expect(saved?.ops?.projectId).toBe("proj-123");
    expect(saved?.bcgpt?.url).toBe("https://bcgpt.example.test");
    expect(saved?.bcgpt?.apiKey).toBe("bcgpt-123");

    const context = await readWorkspaceAiContext(workspaceId);
    expect(context).toContain(`Workspace ID: ${workspaceId}`);
    expect(context).toContain("basecamp apiKey present: yes");

    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.rm(path.dirname(workspaceConnectorsPath(workspaceId)), {
        recursive: true,
        force: true,
      });
    } catch {
      // ignore cleanup errors in test env
    }
  });
});
