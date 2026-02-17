import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Use dynamic import so we can stub spawnWithFallback
describe("n8n-embed spawn behavior", () => {
  const realExists = fs.existsSync;
  const realStat = fs.statSync;
  const realReadDir = fs.readdirSync;
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    fs.existsSync = realExists;
    fs.statSync = realStat;
    fs.readdirSync = realReadDir;
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
    const bcgptRoot = path.resolve(__dirname, "..", "..", "..");
    const fakeRepo = path.join(bcgptRoot, "openclaw", "vendor", "n8n");
    const customNodesRoot = path.join(fakeRepo, "custom", "nodes");
    const basecampPkg = path.join(customNodesRoot, "n8n-nodes-basecamp", "package.json");
    const openclawPkg = path.join(customNodesRoot, "n8n-nodes-openclaw", "package.json");

    fs.existsSync = (p: string) =>
      p === fakeRepo || p === basecampPkg || p === openclawPkg || realExists(p);
    fs.statSync = ((p: fs.PathLike) =>
      p === fakeRepo ? ({ isDirectory: () => true } as fs.Stats) : realStat(p)) as typeof fs.statSync;
    fs.readdirSync = ((p: fs.PathLike, opts?: unknown) => {
      if (String(p) === customNodesRoot && opts && typeof opts === "object") {
        return [
          { name: "n8n-nodes-basecamp", isDirectory: () => true },
          { name: "n8n-nodes-openclaw", isDirectory: () => true },
        ] as unknown[];
      }
      return realReadDir(p as Parameters<typeof fs.readdirSync>[0], opts as any) as unknown[];
    }) as typeof fs.readdirSync;

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

    const firstCall = vi.mocked(spawnUtils.spawnWithFallback).mock.calls[0]?.[0];
    const envValue = firstCall?.options?.env?.N8N_CUSTOM_EXTENSIONS;
    expect(typeof envValue).toBe("string");
    expect(String(envValue)).toContain(path.join(customNodesRoot, "n8n-nodes-basecamp"));
    expect(String(envValue)).toContain(path.join(customNodesRoot, "n8n-nodes-openclaw"));
  });
});
