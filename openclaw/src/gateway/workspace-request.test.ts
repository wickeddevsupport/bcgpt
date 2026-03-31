import { describe, expect, it } from "vitest";
import { resolveEffectiveRequestWorkspaceId } from "./workspace-request.js";

describe("resolveEffectiveRequestWorkspaceId", () => {
  it("uses the requested workspaceId when there is no client", () => {
    expect(resolveEffectiveRequestWorkspaceId(null, { workspaceId: "ws-a" })).toBe("ws-a");
  });

  it("honors explicit workspaceId for backend clients without PMOS context", () => {
    expect(
      resolveEffectiveRequestWorkspaceId(
        { connect: { client: { id: "gateway-client" } } } as any,
        { workspaceId: "ws-a" },
      ),
    ).toBe("ws-a");
  });

  it("uses the caller workspace for PMOS workspace admins", () => {
    expect(
      resolveEffectiveRequestWorkspaceId(
        { pmosRole: "workspace_admin", pmosWorkspaceId: "ws-owner" } as any,
        { workspaceId: "ws-other" },
      ),
    ).toBe("ws-owner");
  });

  it("lets super admins target an explicit workspaceId", () => {
    expect(
      resolveEffectiveRequestWorkspaceId(
        { pmosRole: "super_admin", pmosWorkspaceId: "ws-owner" } as any,
        { workspaceId: "ws-target" },
      ),
    ).toBe("ws-target");
  });
});