import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { workspaceConnectorsPath, readWorkspaceConnectors, writeWorkspaceConnectors } from "./workspace-connectors.js";

describe("workspace-connectors read/write", () => {
  const ws = `test-ws-${Date.now()}`;
  const p = workspaceConnectorsPath(ws);

  afterEach(async () => {
    try {
      await fs.rm(path.dirname(p), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("writes then reads the connectors file", async () => {
    const payload = { ops: { url: "https://ops.example", apiKey: "k1" } };
    await writeWorkspaceConnectors(ws, payload as any);

    const read = await readWorkspaceConnectors(ws);
    expect(read).not.toBeNull();
    expect(read).toEqual(payload);

    const raw = await fs.readFile(p, "utf-8");
    expect(raw.trim().startsWith("{"));
  });

  it("returns null when file missing", async () => {
    const missing = await readWorkspaceConnectors("non-existent-xyz");
    expect(missing).toBeNull();
  });
});