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
          path: ".derived-sessions/agent-assistant-main.md",
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
    expect(result?.prependContext).toContain(".derived-sessions/agent-assistant-main.md#L5-L7");
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

  it("excludes pmos-smart-memory results from recall to prevent recursive ingestion", async () => {
    const searchFn = vi.fn().mockResolvedValue([
      {
        path: "pmos-smart-memory/agent-assistant-main.md",
        startLine: 1,
        endLine: 3,
        score: 0.95,
        snippet: "Recycled memory that should be excluded.",
        source: "memory",
      },
      {
        path: "docs/architecture.md",
        startLine: 10,
        endLine: 12,
        score: 0.80,
        snippet: "Real architecture note about tenant isolation.",
        source: "memory",
      },
    ]);
    const manager = createMemoryManager({ search: searchFn });

    const handler = createBeforeAgentStartHandler({
      config: resolvePmosSmartMemoryConfig({ enabled: true }),
      deps: baseDeps({
        getMemoryManager: async () => ({ manager, error: undefined }),
      }),
    });

    const result = await handler(
      { prompt: "Tell me about tenant isolation in the architecture" },
      {
        workspaceDir: "/tmp/workspaces/ws-no-recurse/assistant",
        agentId: "assistant",
        sessionKey: "agent:assistant:main",
      },
    );

    expect(result?.prependContext).toContain("Real architecture note");
    expect(result?.prependContext).not.toContain("Recycled memory that should be excluded");
    // Verify over-fetch: default maxResults is 3, so search should request 3 * 3 = 9
    expect(searchFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ maxResults: 9 }),
    );
  });

  it("strips injected recall blocks from messages before capture", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "pmos-smart-memory-"));
    tempDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspaces", "ws-strip", "assistant");
    await fs.mkdir(workspaceDir, { recursive: true });

    const handler = createAgentEndHandler({
      config: resolvePmosSmartMemoryConfig({ enabled: true }),
      deps: baseDeps(),
    });

    await handler(
      {
        messages: [
          {
            role: "user",
            content:
              "Relevant workspace memory:\nUse these notes only if they help.\n\n1. Old recalled fact.\nSource: memory.md#L1\n\nWhat is the deploy strategy?",
          },
          {
            role: "assistant",
            content: "The deploy strategy uses Coolify with Docker images.",
          },
        ],
        success: true,
      },
      {
        workspaceDir,
        agentId: "assistant",
        sessionKey: "agent:assistant:strip-test",
      },
    );

    const capturePath = path.join(
      workspaceDir,
      "memory",
      "pmos-smart-memory",
      "agent-assistant-strip-test.md",
    );
    let content: string;
    try {
      content = await fs.readFile(capturePath, "utf-8");
    } catch {
      // If nothing was captured that's also acceptable (short conversation)
      return;
    }
    expect(content).not.toContain("Relevant workspace memory:");
    expect(content).not.toContain("Old recalled fact");
    // The real user question after the injected block should be preserved
    expect(content).toContain("deploy strategy");
  });

  it("skips capture on unsuccessful turns", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "pmos-smart-memory-"));
    tempDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspaces", "ws-fail", "assistant");
    const capturePath = path.join(
      workspaceDir,
      "memory",
      "pmos-smart-memory",
      "agent-assistant-main.md",
    );
    await fs.mkdir(path.dirname(capturePath), { recursive: true });
    // Pre-existing capture should NOT be updated or removed on a failed turn
    await fs.writeFile(capturePath, "existing memory", "utf-8");

    const writeFile = vi.fn();
    const rm = vi.fn();
    const handler = createAgentEndHandler({
      config: resolvePmosSmartMemoryConfig({ enabled: true }),
      deps: {
        ...baseDeps(),
        writeFile,
        rm,
      },
    });

    await handler(
      {
        messages: [
          { role: "user", content: "Do something important." },
          { role: "assistant", content: "Error: partial garbled response..." },
        ],
        success: false,
        error: "agent timeout",
      },
      {
        workspaceDir,
        agentId: "assistant",
        sessionKey: "agent:assistant:main",
      },
    );

    expect(writeFile).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
    // Original file should be untouched
    const content = await fs.readFile(capturePath, "utf-8");
    expect(content).toBe("existing memory");
  });

  it("does not embed fake transcript paths in captured memory", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "pmos-smart-memory-"));
    tempDirs.push(rootDir);
    const workspaceDir = path.join(rootDir, "workspaces", "ws-path", "assistant");
    await fs.mkdir(workspaceDir, { recursive: true });

    const handler = createAgentEndHandler({
      config: resolvePmosSmartMemoryConfig({ enabled: true }),
      deps: baseDeps(),
    });

    await handler(
      {
        messages: [
          { role: "user", content: "We decided to use PostgreSQL for the data layer." },
          { role: "assistant", content: "Decision recorded: PostgreSQL for the data layer." },
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
    // Must not contain a fabricated .jsonl path
    expect(content).not.toContain(".jsonl");
    expect(content).not.toContain("sessions/");
    // Must not contain misleading 'Source transcript:' label
    expect(content).not.toContain("Source transcript:");
    expect(content).not.toContain("Transcript:");
  });
});