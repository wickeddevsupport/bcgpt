import { describe, expect, it, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/* Mocks                                                              */
/* ------------------------------------------------------------------ */

const mocks = vi.hoisted(() => ({
  loadConfigReturn: {} as Record<string, unknown>,
  readWorkspaceConfig: vi.fn(async () => ({})),
  writeWorkspaceConfig: vi.fn(async () => {}),
  listAgentEntries: vi.fn(() => [] as Array<{ agentId: string }>),
  findAgentEntryIndex: vi.fn(() => -1),
  applyAgentConfig: vi.fn((_cfg: unknown, _opts: unknown) => ({})),
  pruneAgentConfig: vi.fn(() => ({ config: {}, removedBindings: 0 })),
  writeConfigFile: vi.fn(async () => {}),
  ensureAgentWorkspace: vi.fn(async () => {}),
  resolveAgentDir: vi.fn(() => "/agents/test-agent"),
  resolveAgentWorkspaceDir: vi.fn(() => "/workspace/test-agent"),
  resolveSessionTranscriptsDirForAgent: vi.fn(() => "/transcripts/test-agent"),
  listAgentsForGateway: vi.fn(() => ({
    defaultId: "main",
    mainKey: "agent:main:main",
    scope: "global",
    agents: [],
  })),
  movePathToTrash: vi.fn(async () => "/trashed"),
  fsAccess: vi.fn(async () => {}),
  fsMkdir: vi.fn(async () => undefined),
  fsAppendFile: vi.fn(async () => {}),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => mocks.loadConfigReturn,
  writeConfigFile: mocks.writeConfigFile,
}));

vi.mock("../workspace-config.js", () => ({
  readWorkspaceConfig: mocks.readWorkspaceConfig,
  writeWorkspaceConfig: mocks.writeWorkspaceConfig,
  applyWorkspaceAgentCollaborationDefaults: (cfg: Record<string, unknown>, workspaceId: string) => {
    const wsId = String(workspaceId ?? "").trim();
    const next = { ...cfg };
    const tools =
      next.tools && typeof next.tools === "object"
        ? ({ ...(next.tools as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const existingA2A =
      tools.agentToAgent && typeof tools.agentToAgent === "object"
        ? ({ ...(tools.agentToAgent as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const allow = Array.isArray(existingA2A.allow)
      ? existingA2A.allow.map((value) => String(value).trim()).filter(Boolean)
      : [];
    tools.agentToAgent =
      existingA2A.enabled === true && allow.length > 0
        ? existingA2A
        : { ...existingA2A, enabled: true, allow: ["*"] };
    const agents =
      next.agents && typeof next.agents === "object"
        ? ({ ...(next.agents as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const list = Array.isArray(agents.list) ? agents.list : [];
    agents.list = list.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return entry;
      }
      const row = { ...(entry as Record<string, unknown>) };
      if (String(row.workspaceId ?? "").trim() !== wsId) {
        return row;
      }
      const subagents =
        row.subagents && typeof row.subagents === "object"
          ? ({ ...(row.subagents as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      const allowAgents = Array.isArray(subagents.allowAgents)
        ? subagents.allowAgents.map((value) => String(value).trim()).filter(Boolean)
        : [];
      if (allowAgents.length === 0) {
        subagents.allowAgents = ["*"];
      }
      return { ...row, subagents };
    });
    return { ...next, tools, agents };
  },
}));

vi.mock("../../commands/agents.config.js", () => ({
  applyAgentConfig: mocks.applyAgentConfig,
  findAgentEntryIndex: mocks.findAgentEntryIndex,
  listAgentEntries: mocks.listAgentEntries,
  pruneAgentConfig: mocks.pruneAgentConfig,
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: () => ["main"],
  resolveAgentDir: mocks.resolveAgentDir,
  resolveAgentWorkspaceDir: mocks.resolveAgentWorkspaceDir,
}));

vi.mock("../../agents/workspace.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/workspace.js")>(
    "../../agents/workspace.js",
  );
  return {
    ...actual,
    ensureAgentWorkspace: mocks.ensureAgentWorkspace,
  };
});

vi.mock("../../config/sessions/paths.js", () => ({
  resolveSessionTranscriptsDirForAgent: mocks.resolveSessionTranscriptsDirForAgent,
  resolveSessionTranscriptsDirForConfig: mocks.resolveSessionTranscriptsDirForAgent,
}));

vi.mock("../../browser/trash.js", () => ({
  movePathToTrash: mocks.movePathToTrash,
}));

vi.mock("../../utils.js", () => ({
  resolveUserPath: (p: string) => `/resolved${p.startsWith("/") ? "" : "/"}${p}`,
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: mocks.listAgentsForGateway,
}));

// Mock node:fs/promises – agents.ts uses `import fs from "node:fs/promises"`
// which resolves to the module namespace default, so we spread actual and
// override the methods we need, plus set `default` explicitly.
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const patched = {
    ...actual,
    access: mocks.fsAccess,
    mkdir: mocks.fsMkdir,
    appendFile: mocks.fsAppendFile,
  };
  return { ...patched, default: patched };
});

/* ------------------------------------------------------------------ */
/* Import after mocks are set up                                      */
/* ------------------------------------------------------------------ */

const { agentsHandlers } = await import("./agents.js");

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeCall(
  method: keyof typeof agentsHandlers,
  params: Record<string, unknown>,
  opts?: { client?: Record<string, unknown> | null },
) {
  const respond = vi.fn();
  const handler = agentsHandlers[method];
  const promise = handler({
    params,
    respond,
    context: {} as never,
    req: { type: "req" as const, id: "1", method },
    client: (opts?.client ?? null) as never,
    isWebchatConnect: () => false,
  });
  return { respond, promise };
}

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

describe("agents.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
    mocks.readWorkspaceConfig.mockResolvedValue({});
    mocks.findAgentEntryIndex.mockReturnValue(-1);
    mocks.applyAgentConfig.mockImplementation((_cfg, _opts) => ({}));
  });

  it("creates a new agent successfully", async () => {
    const { respond, promise } = makeCall("agents.create", {
      name: "Test Agent",
      workspace: "/home/user/agents/test",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        agentId: "test-agent",
        name: "Test Agent",
      }),
      undefined,
    );
    expect(mocks.ensureAgentWorkspace).toHaveBeenCalled();
    expect(mocks.writeConfigFile).toHaveBeenCalled();
  });

  it("ensures workspace is set up before writing config", async () => {
    const callOrder: string[] = [];
    mocks.ensureAgentWorkspace.mockImplementation(async () => {
      callOrder.push("ensureAgentWorkspace");
    });
    mocks.writeConfigFile.mockImplementation(async () => {
      callOrder.push("writeConfigFile");
    });

    const { promise } = makeCall("agents.create", {
      name: "Order Test",
      workspace: "/tmp/ws",
    });
    await promise;

    expect(callOrder.indexOf("ensureAgentWorkspace")).toBeLessThan(
      callOrder.indexOf("writeConfigFile"),
    );
  });

  it("rejects creating an agent with reserved 'main' id", async () => {
    const { respond, promise } = makeCall("agents.create", {
      name: "main",
      workspace: "/tmp/ws",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("reserved") }),
    );
  });

  it("rejects creating a duplicate agent", async () => {
    mocks.findAgentEntryIndex.mockReturnValue(0);

    const { respond, promise } = makeCall("agents.create", {
      name: "Existing",
      workspace: "/tmp/ws",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("already exists") }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("rejects invalid params (missing name)", async () => {
    const { respond, promise } = makeCall("agents.create", {
      workspace: "/tmp/ws",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("invalid") }),
    );
  });

  it("always writes Name to IDENTITY.md even without emoji/avatar", async () => {
    const { promise } = makeCall("agents.create", {
      name: "Plain Agent",
      workspace: "/tmp/ws",
    });
    await promise;

    expect(mocks.fsAppendFile).toHaveBeenCalledWith(
      expect.stringContaining("IDENTITY.md"),
      expect.stringContaining("- Name: Plain Agent"),
      "utf-8",
    );
  });

  it("writes emoji and avatar to IDENTITY.md when provided", async () => {
    const { promise } = makeCall("agents.create", {
      name: "Fancy Agent",
      workspace: "/tmp/ws",
      emoji: "🤖",
      avatar: "https://example.com/avatar.png",
    });
    await promise;

    expect(mocks.fsAppendFile).toHaveBeenCalledWith(
      expect.stringContaining("IDENTITY.md"),
      expect.stringMatching(/- Name: Fancy Agent[\s\S]*- Emoji: 🤖[\s\S]*- Avatar:/),
      "utf-8",
    );
  });

  it("pins workspace-scoped agentDir for PMOS workspace users", async () => {
    const applyCalls: unknown[] = [];
    mocks.applyAgentConfig.mockImplementation((_cfg, opts) => {
      applyCalls.push(opts);
      return {};
    });

    const { promise } = makeCall(
      "agents.create",
      { name: "WS Agent", workspace: "/ignored/by/workspace-user" },
      {
        client: {
          pmosWorkspaceId: "ws-123",
          pmosRole: "workspace_admin",
        },
      },
    );
    await promise;

    expect(applyCalls).toContainEqual(
      expect.objectContaining({
        agentId: "ws-agent",
        workspaceId: "ws-123",
      }),
    );
    expect(applyCalls).toContainEqual(
      expect.objectContaining({
        agentId: "ws-agent",
        agentDir: "/resolved/~/.openclaw/workspaces/ws-123/agents/ws-agent/agent",
      }),
    );
    expect(mocks.writeWorkspaceConfig).toHaveBeenCalled();
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
    expect(mocks.fsMkdir).toHaveBeenCalledWith(
      "/resolved/~/.openclaw/workspaces/ws-123/agents/ws-agent/sessions",
      { recursive: true },
    );
  });

  it("writes workspace collaboration defaults for newly created workspace agents", async () => {
    mocks.readWorkspaceConfig.mockResolvedValue({
      agents: {
        list: [{ id: "assistant", workspaceId: "ws-123", default: true }],
      },
    });
    mocks.applyAgentConfig.mockImplementation((cfg, opts) => {
      const next = { ...((cfg as Record<string, unknown>) ?? {}) };
      const agents =
        next.agents && typeof next.agents === "object"
          ? ({ ...(next.agents as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      const list = Array.isArray(agents.list) ? [...agents.list] : [];
      const agentId = String((opts as Record<string, unknown>).agentId ?? "").trim();
      const index = list.findIndex(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          String((entry as Record<string, unknown>).id ?? "").trim() === agentId,
      );
      const entry =
        index >= 0 && list[index] && typeof list[index] === "object"
          ? { ...(list[index] as Record<string, unknown>) }
          : { id: agentId };
      Object.assign(entry, opts);
      if (index >= 0) {
        list[index] = entry;
      } else {
        list.push(entry);
      }
      return { ...next, agents: { ...agents, list } };
    });

    const { promise } = makeCall(
      "agents.create",
      { name: "Marketing Agent", workspace: "/ignored/by/workspace-user" },
      {
        client: {
          pmosWorkspaceId: "ws-123",
          pmosRole: "workspace_admin",
        },
      },
    );
    await promise;

    expect(mocks.writeWorkspaceConfig).toHaveBeenCalledWith(
      "ws-123",
      expect.objectContaining({
        tools: expect.objectContaining({
          agentToAgent: expect.objectContaining({
            enabled: true,
            allow: ["*"],
          }),
        }),
        agents: expect.objectContaining({
          list: expect.arrayContaining([
            expect.objectContaining({
              id: "assistant",
              subagents: expect.objectContaining({ allowAgents: ["*"] }),
            }),
            expect.objectContaining({
              id: "marketing-agent",
              subagents: expect.objectContaining({ allowAgents: ["*"] }),
            }),
          ]),
        }),
      }),
    );
  });
});

describe("agents.update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
    mocks.readWorkspaceConfig.mockResolvedValue({});
    mocks.findAgentEntryIndex.mockReturnValue(0);
    // agent entry used by update/delete handlers
    mocks.listAgentEntries.mockReturnValue([{ id: "test-agent", workspaceId: undefined } as any]);
    mocks.applyAgentConfig.mockImplementation((_cfg, _opts) => ({}));
  });

  it("updates an existing agent successfully", async () => {
    const { respond, promise } = makeCall("agents.update", {
      agentId: "test-agent",
      name: "Updated Name",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(true, { ok: true, agentId: "test-agent" }, undefined);
    expect(mocks.writeConfigFile).toHaveBeenCalled();
  });

  it("rejects updating a nonexistent agent", async () => {
    mocks.findAgentEntryIndex.mockReturnValue(-1);

    const { respond, promise } = makeCall("agents.update", {
      agentId: "nonexistent",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("not found") }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("ensures workspace when workspace changes", async () => {
    const { promise } = makeCall("agents.update", {
      agentId: "test-agent",
      workspace: "/new/workspace",
    });
    await promise;

    expect(mocks.ensureAgentWorkspace).toHaveBeenCalled();
  });

  it("does not ensure workspace when workspace is unchanged", async () => {
    const { promise } = makeCall("agents.update", {
      agentId: "test-agent",
      name: "Just a rename",
    });
    await promise;

    expect(mocks.ensureAgentWorkspace).not.toHaveBeenCalled();
  });
});

describe("agents.delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
    mocks.readWorkspaceConfig.mockResolvedValue({});
    mocks.findAgentEntryIndex.mockReturnValue(0);
    // agent entry used by update/delete handlers
    mocks.listAgentEntries.mockReturnValue([{ id: "test-agent", workspaceId: undefined } as any]);
    mocks.pruneAgentConfig.mockReturnValue({ config: {}, removedBindings: 2 });
  });

  it("deletes an existing agent and trashes files by default", async () => {
    const { respond, promise } = makeCall("agents.delete", {
      agentId: "test-agent",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      { ok: true, agentId: "test-agent", removedBindings: 2 },
      undefined,
    );
    expect(mocks.writeConfigFile).toHaveBeenCalled();
    // moveToTrashBestEffort calls fs.access then movePathToTrash for each dir
    expect(mocks.movePathToTrash).toHaveBeenCalled();
  });

  it("skips file deletion when deleteFiles is false", async () => {
    mocks.fsAccess.mockClear();

    const { respond, promise } = makeCall("agents.delete", {
      agentId: "test-agent",
      deleteFiles: false,
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ ok: true }), undefined);
    // moveToTrashBestEffort should not be called at all
    expect(mocks.fsAccess).not.toHaveBeenCalled();
  });

  it("rejects deleting the main agent", async () => {
    const { respond, promise } = makeCall("agents.delete", {
      agentId: "main",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("cannot be deleted") }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("rejects deleting a nonexistent agent", async () => {
    mocks.findAgentEntryIndex.mockReturnValue(-1);

    const { respond, promise } = makeCall("agents.delete", {
      agentId: "ghost",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("not found") }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("rejects invalid params (missing agentId)", async () => {
    const { respond, promise } = makeCall("agents.delete", {});
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("invalid") }),
    );
  });
});
