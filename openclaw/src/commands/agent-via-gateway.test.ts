import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(),
  randomIdempotencyKey: () => "idem-1",
}));
vi.mock("./agent.js", () => ({
  agentCommand: vi.fn(),
}));

import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { AGENT_NO_TIMEOUT_MS } from "../agents/timeout.js";
import * as configModule from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import { agentCliCommand } from "./agent-via-gateway.js";
import { agentCommand } from "./agent.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

const configSpy = vi.spyOn(configModule, "loadConfig");

function mockConfig(storePath: string, overrides?: Partial<OpenClawConfig>) {
  configSpy.mockReturnValue({
    agents: {
      defaults: {
        timeoutSeconds: 600,
        ...overrides?.agents?.defaults,
      },
    },
    session: {
      store: storePath,
      mainKey: "main",
      ...overrides?.session,
    },
    gateway: overrides?.gateway,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agentCliCommand", () => {
  it("uses gateway by default", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    vi.mocked(callGateway).mockResolvedValue({
      runId: "idem-1",
      status: "ok",
      result: {
        payloads: [{ text: "hello" }],
        meta: { stub: true },
      },
    });

    try {
      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).not.toHaveBeenCalled();
      expect(runtime.log).toHaveBeenCalledWith("hello");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to embedded agent when gateway fails", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    vi.mocked(callGateway).mockRejectedValue(new Error("gateway not connected"));
    vi.mocked(agentCommand).mockImplementationOnce(async (_opts, rt) => {
      rt.log?.("local");
      return { payloads: [{ text: "local" }], meta: { stub: true } };
    });

    try {
      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(runtime.log).toHaveBeenCalledWith("local");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips gateway when --local is set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    vi.mocked(agentCommand).mockImplementationOnce(async (_opts, rt) => {
      rt.log?.("local");
      return { payloads: [{ text: "local" }], meta: { stub: true } };
    });

    try {
      await agentCliCommand(
        {
          message: "hi",
          to: "+1555",
          local: true,
        },
        runtime,
      );

      expect(callGateway).not.toHaveBeenCalled();
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(runtime.log).toHaveBeenCalledWith("local");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses no-timeout defaults for gateway agent runs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store, { agents: { defaults: { timeoutSeconds: 0 } } });

    vi.mocked(callGateway).mockResolvedValue({
      runId: "idem-1",
      status: "ok",
      result: {
        payloads: [{ text: "hello" }],
      },
    });

    try {
      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(callGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.not.objectContaining({ timeout: expect.anything() }),
          timeoutMs: AGENT_NO_TIMEOUT_MS,
        }),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts --timeout 0 for unlimited gateway agent runs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-cli-"));
    const store = path.join(dir, "sessions.json");
    mockConfig(store);

    vi.mocked(callGateway).mockResolvedValue({
      runId: "idem-1",
      status: "ok",
      result: {
        payloads: [{ text: "hello" }],
      },
    });

    try {
      await agentCliCommand({ message: "hi", to: "+1555", timeout: "0" }, runtime);

      expect(callGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ timeout: 0 }),
          timeoutMs: AGENT_NO_TIMEOUT_MS,
        }),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
