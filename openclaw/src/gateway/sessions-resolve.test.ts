import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveSessionKeyFromResolveParams } from "./sessions-resolve.js";

const tempDirs: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sessions-resolve-"));
  tempDirs.push(root);
  return root;
}

async function writeAgentStore(
  root: string,
  agentId: string,
  entries: Record<string, Record<string, unknown>>,
): Promise<void> {
  const agentDir = path.join(root, agentId);
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(path.join(agentDir, "sessions.json"), JSON.stringify(entries, null, 2), "utf-8");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("sessions resolve workspace filtering", () => {
  it("limits sessionId and label lookups to allowed agent ids", async () => {
    const root = await createTempRoot();
    await writeAgentStore(root, "pm", {
      "agent:pm:main": {
        sessionId: "sess-pm",
        updatedAt: 1000,
        label: "PM Main",
      },
    });
    await writeAgentStore(root, "seo", {
      "agent:seo:main": {
        sessionId: "sess-seo",
        updatedAt: 2000,
        label: "SEO Main",
      },
    });

    const cfg = {
      session: {
        mainKey: "main",
        store: path.join(root, "{agentId}", "sessions.json"),
      },
      agents: {
        list: [
          { id: "assistant", default: true, workspaceId: "ws-a" },
          { id: "pm", workspaceId: "ws-a" },
          { id: "seo", workspaceId: "ws-b" },
        ],
      },
    } as OpenClawConfig;
    const allowedAgentIds = new Set(["assistant", "pm"]);

    expect(
      resolveSessionKeyFromResolveParams({
        cfg,
        p: { sessionId: "sess-pm" } as never,
        allowedAgentIds,
      }),
    ).toEqual({ ok: true, key: "agent:pm:main" });

    expect(
      resolveSessionKeyFromResolveParams({
        cfg,
        p: { sessionId: "sess-seo" } as never,
        allowedAgentIds,
      }),
    ).toMatchObject({ ok: false });

    expect(
      resolveSessionKeyFromResolveParams({
        cfg,
        p: { label: "SEO Main" } as never,
        allowedAgentIds,
      }),
    ).toMatchObject({ ok: false });
  });
});