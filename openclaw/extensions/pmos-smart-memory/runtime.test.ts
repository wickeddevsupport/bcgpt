import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentEndHandler,
  createBeforeAgentStartHandler,
  resolvePmosSmartMemoryConfig,
} from "./runtime.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function createMemoryManager(overrides?: Partial<Record<string, unknown>>) {
  return {
    search: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue({ path: "memory.md", text: "" }),
    status: vi.fn().mockReturnValue({ backend: "builtin", provider: "builtin" }),
    probeEmbeddingAvailability: vi.fn().mockResolvedValue({ ok: true }),
    probeVectorAvailability: vi.fn().mockResolvedValue(true),
    sync: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function baseDeps(overrides?: {
  loadWorkspaceConfig?: (workspaceId: string) => Promise<OpenClawConfig>;
  getMemoryManager?: (params: { cfg: OpenClawConfig; agentId: string }) => Promise<{
    manager: ReturnType<typeof createMemoryManager> | null;
    error?: string;
  }>;
}) {
  return {
    loadWorkspaceConfig: overrides?.loadWorkspaceConfig ?? (async () => ({} as OpenClawConfig)),
    getMemoryManager:
      overrides?.getMemoryManager ??
      (async () => ({ manager: createMemoryManager(), error: undefined })),
    mkdir: fs.mkdir,
    writeFile: fs.writeFile,
    rm: fs.rm,
    now: () => Date.parse("2026-04-01T12:00:00.000Z"),
  };
}

describe("pmos smart memory runtime", () => {
  it("skips recall when disabled", async () => {
    const getMemoryManager = vi.fn();
    const handler = createBeforeAgentStartHandler({
      config: resolvePmosSmartMemoryConfig({}),
      deps: baseDeps({ getMemoryManager }),
    });

    const result = await handler(
      { prompt: "What did we decide about workspace isolation?" },
      {
        workspaceDir: "/tmp/workspaces/ws-disabled/assistant",
        agentId: "assistant",
        sessionKey: "agent:assistant:main",
      },
    );

    expect(result).toBeUndefined();
    expect(getMemoryManager).not.toHaveBeenCalled();
  });

  it("prepends relevant workspace memory when enabled", async () => {
    const manager = createMemoryManager({
      search: vi.fn().mockResolvedValue([
        {
          path: "pmos-smart-memory/agent-assistant-main.md",
          startLine: 5,
          endLine: 7,
          score: 0.81,
          snippet: "User requirement: Keep workspace data separated across tenants.",
          source: "memory",
        },
      ]),
    });

    const handler = createBeforeAgentStartHandler({
      config: resolvePmosSmartMemoryConfig({ enabled: true }),
      deps: baseDeps({
        getMemoryManager: async () => ({ manager, error: undefined }),
      }),
    });

    const result = await handler(
      { prompt: "Keep workspace data separated across tenants" },
      {
        workspaceDir: "/tmp/workspaces/ws-recall/assistant",
        agentId: "assistant",
        sessionKey: "agent:assistant:main",
      },
    );

    expect(result?.prependContext).toContain("Relevant workspace memory:");
    expect(result?.prependContext).toContain("Keep workspace data separated across tenants");
    expect(result?.prependContext).toContain("pmos-smart-memory/agent-assistant-main.md#L5-L7");
  });

  it("fails open when recall search throws", async () => {
    const warn = vi.fn();
    const handler = createBeforeAgentStartHandler({
      config: resolvePmosSmartMemoryConfig({ enabled: true }),
      logger: {
        info: vi.fn(),
        warn,
        error: vi.fn(),
      },
      deps: baseDeps({
        getMemoryManager: async () => ({
          manager: createMemoryManager({ search: vi.fn().mockRejectedValue(new Error("boom")) }),
          error: undefined,
        }),
      }),
    });

    await expect(
      handler(
        { prompt: "What did we decide about fail-open behavior?" },
        {
          workspaceDir: "/tmp/workspaces/ws-fail-open/assistant",
          agentId: "assistant",
          sessionKey: "agent:assistant:main",
        },
      ),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("auto-recall skipped"));
  });

  it("captures durable facts into a workspace-local memory file", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "pmos-smart-memory-"));
    tempDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspaces", "ws-capture", "assistant");
    await fs.mkdir(workspaceDir, { recursive: true });

    const sync = vi.fn().mockResolvedValue(undefined);
    const handler = createAgentEndHandler({
      config: resolvePmosSmartMemoryConfig({ enabled: true }),
      deps: baseDeps({
        getMemoryManager: async () => ({
          manager: createMemoryManager({ sync }),
          error: undefined,
        }),
      }),
    });

    await handler(
      {
        messages: [
          {
            role: "user",
            content: "We need to keep workspace memory separated across tenants.",
          },
          {
            role: "assistant",
            content: "Decision: keep the plugin fail-open and disabled by default.",
          },
        ],
        success: true,
      },
      {
        workspaceDir,
        agentId: "assistant",
        sessionKey: "agent:assistant:main",
      },
    );

    const capturePath = path.join(
      workspaceDir,
      "memory",
      "pmos-smart-memory",
      "agent-assistant-main.md",
    );
    const content = await fs.readFile(capturePath, "utf-8");

    expect(content).toContain("# PMOS Smart Memory");
    expect(content).toContain("Workspace ID: ws-capture");
    expect(content).toContain("Session Key: agent:assistant:main");
    expect(content).toContain(
      "User requirement: We need to keep workspace memory separated across tenants.",
    );
    expect(content).toContain(
      "Assistant decision: Decision: keep the plugin fail-open and disabled by default.",
    );
    expect(sync).toHaveBeenCalledWith({ reason: "pmos-smart-memory-capture" });
  });

  it("removes stale captured memory when no durable facts remain", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "pmos-smart-memory-"));
    tempDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspaces", "ws-cleanup", "assistant");
    const capturePath = path.join(
      workspaceDir,
      "memory",
      "pmos-smart-memory",
      "agent-assistant-main.md",
    );
    await fs.mkdir(path.dirname(capturePath), { recursive: true });
    await fs.writeFile(capturePath, "stale", "utf-8");

    const handler = createAgentEndHandler({
      config: resolvePmosSmartMemoryConfig({ enabled: true }),
      deps: baseDeps(),
    });

    await handler(
      {
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi" },
        ],
        success: true,
      },
      {
        workspaceDir,
        agentId: "assistant",
        sessionKey: "agent:assistant:main",
      },
    );

    await expect(fs.access(capturePath)).rejects.toThrow();
  });
});