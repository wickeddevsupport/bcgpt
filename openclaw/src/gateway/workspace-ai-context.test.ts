import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeWorkspaceConfig } from "./workspace-config.js";
import { writeWorkspaceConnectors, workspaceConnectorsPath } from "./workspace-connectors.js";
import {
  getWorkspaceAiContextForPrompt,
  readWorkspaceAiContext,
  refreshWorkspaceAiContext,
  workspaceAiContextPath,
} from "./workspace-ai-context.js";

describe("workspace-ai-context", () => {
  const workspaceId = `ws-ai-ctx-${Date.now()}`;

  afterEach(async () => {
    try {
      await fs.rm(path.dirname(workspaceConnectorsPath(workspaceId)), {
        recursive: true,
        force: true,
      });
    } catch {
      // ignore test cleanup errors
    }
  });

  it("writes sanitized workspace context markdown", async () => {
    await writeWorkspaceConfig(workspaceId, {
      agents: {
        defaults: {
          model: {
            primary: "openrouter/z-ai/glm-4.5-air:free",
          },
        },
      },
      models: {
        providers: {
          openrouter: {
            apiKey: "sk-openrouter-very-secret",
          },
        },
      },
    });

    await writeWorkspaceConnectors(workspaceId, {
      bcgpt: {
        url: "https://bcgpt.wickedlab.io",
        apiKey: "bcgpt-ultra-secret",
      },
      ops: {
        url: "https://ops.wickedlab.io",
        apiKey: "ops-ultra-secret",
        projectId: "proj-123",
      },
    });

    const refreshed = await refreshWorkspaceAiContext(workspaceId, {
      credentials: [
        { id: "1", name: "OpenClaw - Basecamp", type: "basecampApi" },
        { id: "2", name: "OpenClaw - OpenAi", type: "openAiApi" },
      ],
    });

    expect(refreshed.markdown).toContain(`Workspace ID: ${workspaceId}`);
    expect(refreshed.markdown).toContain("basecamp apiKey present: yes");
    expect(refreshed.markdown).toContain("ops apiKey present: yes");
    expect(refreshed.markdown).toContain("OpenClaw - Basecamp");
    expect(refreshed.markdown).not.toContain("sk-openrouter-very-secret");
    expect(refreshed.markdown).not.toContain("bcgpt-ultra-secret");
    expect(refreshed.markdown).not.toContain("ops-ultra-secret");

    const persisted = await readWorkspaceAiContext(workspaceId);
    expect(persisted).not.toBeNull();
    const stat = await fs.stat(workspaceAiContextPath(workspaceId));
    expect(stat.isFile()).toBe(true);
  });

  it("returns truncated prompt context when maxChars is set", async () => {
    const p = workspaceAiContextPath(workspaceId);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, `${"# context\n".repeat(300)}\n`, "utf-8");

    const context = await getWorkspaceAiContextForPrompt(workspaceId, {
      maxChars: 800,
      ensureFresh: false,
    });

    expect(context.length).toBeLessThanOrEqual(860);
    expect(context).toContain("[workspace ai context truncated]");
  });
});
