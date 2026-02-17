import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Use dynamic import so we can stub spawnWithFallback
describe("n8n-embed spawn behavior", () => {
  const realExists = fs.existsSync;
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    fs.existsSync = realExists;
    delete process.env.N8N_LOCAL_URL;
    vi.restoreAllMocks();
  });

  it("returns null when no vendored repo is present", async () => {
    fs.existsSync = () => false;
    const mod = await import("./n8n-embed.js");
    const res = await mod.spawnEmbeddedN8nIfVendored();
    expect(res).toBeNull();
  });

  it("spawns embedded n8n when vendored repo exists and sets N8N_LOCAL_URL", async () => {
    // Simulate repo present at candidate location
    const bcgptRoot = path.resolve(__dirname, "..", "..");
    const fakeRepo = path.join(bcgptRoot, "openclaw", "vendor", "n8n");
    fs.existsSync = (p: string) => p === fakeRepo || realExists(p);

    // Stub spawnWithFallback to return a fake child
    const spawnUtils = await import("../process/spawn-utils.js");
    const fakeChild = { stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, once: vi.fn() } as any;
    vi.spyOn(spawnUtils, "spawnWithFallback").mockResolvedValue({ child: fakeChild, usedFallback: false });

    const mod = await import("./n8n-embed.js");
    const res = await mod.spawnEmbeddedN8nIfVendored({ port: 5680 });
    expect(res).not.toBeNull();
    expect(typeof res?.url).toBe("string");
    expect(process.env.N8N_LOCAL_URL).toBeDefined();
    expect(spawnUtils.spawnWithFallback).toHaveBeenCalled();
  });
});
