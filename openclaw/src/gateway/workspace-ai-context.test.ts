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
    expect(refreshed.markdown).toContain("## Connected Apps");
    expect(refreshed.markdown).toContain("Treat this list as the current workspace app inventory");
    expect(refreshed.markdown).toContain("### Basecamp Entry Points");
    expect(refreshed.markdown).toContain("Use `bcgpt_mcp_call` for deterministic named MCP tools");
    expect(refreshed.markdown).toContain("Use `bcgpt_list_projects` for exact project lists or project picking");
    expect(refreshed.markdown).toContain("prefer `bcgpt_mcp_call` over `bcgpt_smart_action`");
    expect(refreshed.markdown).not.toContain("Workflow Engine Integration (Activepieces)");
    expect(refreshed.markdown).not.toContain("Workflows panel");
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

  it("includes synced Figma connection and selected file context", async () => {
    await writeWorkspaceConnectors(workspaceId, {
      figma: {
        url: "https://fm.wickedlab.io",
        auth: {
          hasPersonalAccessToken: true,
          source: "fm-session",
          mcpServerUrl: "https://mcp.figma.com/mcp",
        },
        identity: {
          connected: true,
          handle: "designer-1",
          activeConnectionId: "conn-22",
          activeConnectionName: "Product Design",
          activeTeamId: "team-abc",
          selectedFileName: "Landing Page Revamp",
          selectedFileId: "FILE123",
          selectedFileUrl: "https://www.figma.com/file/FILE123/Landing-Page-Revamp",
        },
      },
    });

    const refreshed = await refreshWorkspaceAiContext(workspaceId, {
      credentials: [],
    });

    expect(refreshed.markdown).toContain("figma active connection: Product Design");
    expect(refreshed.markdown).toContain("figma active connection id: conn-22");
    expect(refreshed.markdown).toContain("figma active team id: team-abc");
    expect(refreshed.markdown).toContain("figma selected file id: FILE123");
    expect(refreshed.markdown).toContain("figma selected file url: https://www.figma.com/file/FILE123/Landing-Page-Revamp");
    expect(refreshed.markdown).toContain("figma personal access token present: yes");
    expect(refreshed.markdown).toContain("figma PAT handoff to PMOS: validated in FM, but raw token not passed into PMOS");
    expect(refreshed.markdown).toContain("figma MCP server URL: https://mcp.figma.com/mcp");
    expect(refreshed.markdown).toContain("figma panel sync bridge ready: no");
    expect(refreshed.markdown).toContain("If the user pastes a Figma file URL, anchor to that exact file");
    expect(refreshed.markdown).toContain("get_design_context");
    expect(refreshed.markdown).toContain("do not default to `figma_pat_audit_file`");
    expect(refreshed.markdown).not.toContain("fm_get_context");
    expect(refreshed.markdown).not.toContain("### Figma File Manager (FM) AI Capabilities");
    expect(refreshed.markdown).toContain("If the user pastes a Basecamp URL, treat that URL as the resource to inspect");
  });
});
