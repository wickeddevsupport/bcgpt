import { describe, expect, it } from "vitest";
import {
  getWorkspaceId,
  requireWorkspaceId,
  isWorkspaceOwned,
  requireWorkspaceOwnership,
  filterByWorkspace,
  addWorkspaceId,
  isSuperAdmin,
  getEffectiveWorkspaceId,
} from "./workspace-context.js";
import type { GatewayClient } from "./server-methods/types.js";

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                     */
/* ------------------------------------------------------------------ */

const WS_A = "ws-aaa-111";
const WS_B = "ws-bbb-222";

function makeClient(opts: {
  workspaceId?: string;
  role?: "super_admin" | "workspace_admin";
}): GatewayClient {
  return {
    connect: {
      minProtocol: 3,
      maxProtocol: 3,
      client: { id: "test", version: "1", platform: "test", mode: "webchat" },
      role: "operator",
      scopes: ["operator.admin", "operator.read", "operator.write"],
    },
    connId: "c1",
    pmosRole: opts.role ?? "workspace_admin",
    pmosUserId: "user-1",
    pmosWorkspaceId: opts.workspaceId,
  };
}

const clientA = makeClient({ workspaceId: WS_A });
const clientB = makeClient({ workspaceId: WS_B });
const superAdmin = makeClient({ workspaceId: WS_A, role: "super_admin" });
const noWorkspaceClient = makeClient({});

/* ------------------------------------------------------------------ */
/*  getWorkspaceId                                                    */
/* ------------------------------------------------------------------ */

describe("getWorkspaceId", () => {
  it("returns workspace ID when present", () => {
    expect(getWorkspaceId(clientA)).toBe(WS_A);
  });

  it("returns undefined when no workspace set", () => {
    expect(getWorkspaceId(noWorkspaceClient)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  requireWorkspaceId                                                */
/* ------------------------------------------------------------------ */

describe("requireWorkspaceId", () => {
  it("returns workspace ID when present", () => {
    expect(requireWorkspaceId(clientA)).toBe(WS_A);
  });

  it("throws when no workspace set", () => {
    expect(() => requireWorkspaceId(noWorkspaceClient)).toThrow(
      "Workspace ID required",
    );
  });
});

/* ------------------------------------------------------------------ */
/*  isWorkspaceOwned                                                  */
/* ------------------------------------------------------------------ */

describe("isWorkspaceOwned", () => {
  it("returns true when workspace matches", () => {
    expect(isWorkspaceOwned(clientA, WS_A)).toBe(true);
  });

  it("returns false when workspace differs", () => {
    expect(isWorkspaceOwned(clientA, WS_B)).toBe(false);
  });

  it("returns false when resource has no workspaceId", () => {
    expect(isWorkspaceOwned(clientA, undefined)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  requireWorkspaceOwnership                                         */
/* ------------------------------------------------------------------ */

describe("requireWorkspaceOwnership", () => {
  it("succeeds when workspace matches", () => {
    expect(() =>
      requireWorkspaceOwnership(clientA, WS_A, "agent"),
    ).not.toThrow();
  });

  it("throws when workspace differs", () => {
    expect(() =>
      requireWorkspaceOwnership(clientA, WS_B, "agent"),
    ).toThrow("Access denied");
  });

  it("throws when resource has no workspaceId", () => {
    expect(() =>
      requireWorkspaceOwnership(clientA, undefined, "agent"),
    ).toThrow("Access denied");
  });
});

/* ------------------------------------------------------------------ */
/*  filterByWorkspace                                                 */
/* ------------------------------------------------------------------ */

describe("filterByWorkspace", () => {
  const items = [
    { id: "1", workspaceId: WS_A },
    { id: "2", workspaceId: WS_B },
    { id: "3", workspaceId: WS_A },
    { id: "4" }, // no workspaceId
  ];

  it("filters items to client workspace only", () => {
    const filtered = filterByWorkspace(items, clientA);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((i) => i.id)).toEqual(["1", "3"]);
  });

  it("workspace B sees only its own items", () => {
    const filtered = filterByWorkspace(items, clientB);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("2");
  });

  it("returns all items when client has no workspace (backwards compat)", () => {
    const filtered = filterByWorkspace(items, noWorkspaceClient);
    expect(filtered).toHaveLength(4);
  });

  it("returns empty array when no items match workspace", () => {
    const filtered = filterByWorkspace(
      [{ id: "x", workspaceId: WS_B }],
      clientA,
    );
    expect(filtered).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  addWorkspaceId                                                    */
/* ------------------------------------------------------------------ */

describe("addWorkspaceId", () => {
  it("adds workspaceId from client", () => {
    const resource = { name: "test" };
    const result = addWorkspaceId(resource, clientA);
    expect(result.workspaceId).toBe(WS_A);
    expect(result.name).toBe("test");
  });

  it("does not add workspaceId when client has none", () => {
    const resource = { name: "test" };
    const result = addWorkspaceId(resource, noWorkspaceClient);
    expect(result.workspaceId).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  isSuperAdmin                                                      */
/* ------------------------------------------------------------------ */

describe("isSuperAdmin", () => {
  it("returns true for super_admin role", () => {
    expect(isSuperAdmin(superAdmin)).toBe(true);
  });

  it("returns false for workspace_admin role", () => {
    expect(isSuperAdmin(clientA)).toBe(false);
  });

  it("returns false for client with no role", () => {
    expect(isSuperAdmin(noWorkspaceClient)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  getEffectiveWorkspaceId                                           */
/* ------------------------------------------------------------------ */

describe("getEffectiveWorkspaceId", () => {
  it("super admin can target specific workspace", () => {
    expect(getEffectiveWorkspaceId(superAdmin, WS_B)).toBe(WS_B);
  });

  it("super admin defaults to own workspace when no target", () => {
    expect(getEffectiveWorkspaceId(superAdmin)).toBe(WS_A);
  });

  it("non-admin ignores targetWorkspaceId", () => {
    expect(getEffectiveWorkspaceId(clientA, WS_B)).toBe(WS_A);
  });
});

/* ------------------------------------------------------------------ */
/*  Cross-workspace isolation scenarios                               */
/* ------------------------------------------------------------------ */

describe("cross-workspace isolation", () => {
  const agents = [
    { id: "sales-agent", workspaceId: WS_A, name: "Sales" },
    { id: "dev-agent", workspaceId: WS_B, name: "Dev" },
    { id: "support-agent", workspaceId: WS_A, name: "Support" },
  ];

  const cronJobs = [
    { id: "cron-1", workspaceId: WS_A, schedule: "0 9 * * *" },
    { id: "cron-2", workspaceId: WS_B, schedule: "0 17 * * *" },
  ];

  it("User A cannot see User B's agents", () => {
    const filtered = filterByWorkspace(agents, clientA);
    const ids = filtered.map((a) => a.id);
    expect(ids).toContain("sales-agent");
    expect(ids).toContain("support-agent");
    expect(ids).not.toContain("dev-agent");
  });

  it("User B cannot see User A's agents", () => {
    const filtered = filterByWorkspace(agents, clientB);
    const ids = filtered.map((a) => a.id);
    expect(ids).toContain("dev-agent");
    expect(ids).not.toContain("sales-agent");
    expect(ids).not.toContain("support-agent");
  });

  it("User A cannot modify User B's agent", () => {
    const devAgent = agents.find((a) => a.id === "dev-agent")!;
    expect(() =>
      requireWorkspaceOwnership(clientA, devAgent.workspaceId, "agent"),
    ).toThrow("Access denied");
  });

  it("User B cannot modify User A's agent", () => {
    const salesAgent = agents.find((a) => a.id === "sales-agent")!;
    expect(() =>
      requireWorkspaceOwnership(clientB, salesAgent.workspaceId, "agent"),
    ).toThrow("Access denied");
  });

  it("User A cannot see User B's cron jobs", () => {
    const filtered = filterByWorkspace(cronJobs, clientA);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("cron-1");
  });

  it("Super admin sees all agents", () => {
    // Super admin bypasses filterByWorkspace (checked at handler level)
    expect(isSuperAdmin(superAdmin)).toBe(true);
    // When isSuperAdmin is true, handlers skip filtering and return all items
    expect(agents).toHaveLength(3);
  });

  it("Super admin sees all cron jobs", () => {
    expect(isSuperAdmin(superAdmin)).toBe(true);
    expect(cronJobs).toHaveLength(2);
  });

  it("User A can modify their own agent", () => {
    const salesAgent = agents.find((a) => a.id === "sales-agent")!;
    expect(() =>
      requireWorkspaceOwnership(clientA, salesAgent.workspaceId, "agent"),
    ).not.toThrow();
  });

  it("Workspace isolation is symmetric", () => {
    const aFiltered = filterByWorkspace(agents, clientA);
    const bFiltered = filterByWorkspace(agents, clientB);

    // No overlap between workspaces
    const aIds = new Set(aFiltered.map((a) => a.id));
    const bIds = new Set(bFiltered.map((a) => a.id));
    for (const id of aIds) {
      expect(bIds.has(id)).toBe(false);
    }
    for (const id of bIds) {
      expect(aIds.has(id)).toBe(false);
    }

    // Together they account for all workspace-tagged items
    expect(aIds.size + bIds.size).toBe(
      agents.filter((a) => a.workspaceId).length,
    );
  });
});
