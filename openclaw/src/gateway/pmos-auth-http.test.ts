import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { __test } from "./pmos-auth-http.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

describe("pmos auth http starter model selection", () => {
  it("prefers the explicit Kilo starter-safe free model over auto-free", () => {
    const ref = __test.findSharedWorkspaceModelRef({
      models: {
        providers: {
          kilo: {
            sharedForWorkspaces: true,
            models: [
              { id: "auto-free", name: "Auto Free" },
              { id: "minimax/minimax-m2.5:free", name: "MiniMax M2.5 (Free)" },
            ],
          },
        },
      },
    });

    expect(ref).toBe("kilo/minimax/minimax-m2.5:free");
  });

  it("repairs legacy auto-free starter refs to the explicit Kilo free model", () => {
    expect(__test.resolveDeprecatedModelRefReplacement("kilo/auto-free")).toBe(
      "kilo/minimax/minimax-m2.5:free",
    );
  });

  it("scrubs the polluted legacy starter workspace scaffold without deleting bootstrap files", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-pmos-workspace-"));
    tempDirs.push(workspaceDir);

    await fs.mkdir(path.join(workspaceDir, ".git"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "skills"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "data"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "package.json"),
      JSON.stringify({
        name: "assistant",
        main: "test_duckduckgo.js",
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
        },
      }),
      "utf-8",
    );
    await fs.writeFile(path.join(workspaceDir, "openclaw.json"), "{}\n", "utf-8");
    await fs.writeFile(path.join(workspaceDir, "simple_test.js"), "console.log('test');\n", "utf-8");
    await fs.writeFile(path.join(workspaceDir, "skills", "tasks.md"), "# tasks\n", "utf-8");
    await fs.writeFile(path.join(workspaceDir, "AGENTS.md"), "# keep\n", "utf-8");

    const changed = await __test.sanitizeLegacyStarterWorkspaceScaffold(workspaceDir);

    expect(changed).toBe(true);
    await expect(fs.access(path.join(workspaceDir, "package.json"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(workspaceDir, "simple_test.js"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(workspaceDir, "openclaw.json"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(workspaceDir, ".git"))).rejects.toBeTruthy();
    await expect(fs.readFile(path.join(workspaceDir, "AGENTS.md"), "utf-8")).resolves.toBe("# keep\n");
  });
});
