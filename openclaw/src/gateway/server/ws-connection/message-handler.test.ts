import { describe, expect, it } from "vitest";
import { buildWorkspaceSessionDefaultsSnapshot } from "./message-handler.js";

describe("buildWorkspaceSessionDefaultsSnapshot", () => {
  it("prefers workspace-effective agents when deriving session defaults", () => {
    const snapshot = buildWorkspaceSessionDefaultsSnapshot({
      agentConfig: {
        agents: {
          list: [
            { id: "main" },
            { id: "rohit", default: true, workspaceId: "ws-rohit" },
          ],
        },
        session: {
          mainKey: "workspace-main",
          scope: "per-sender",
        },
      },
      sessionConfig: {
        session: {
          mainKey: "workspace-main",
          scope: "per-sender",
        },
      },
      workspaceId: "ws-rohit",
    });

    expect(snapshot.defaultAgentId).toBe("rohit");
    expect(snapshot.mainKey).toBe("workspace-main");
    expect(snapshot.mainSessionKey).toBe("agent:rohit:workspace-main");
    expect(snapshot.scope).toBe("per-sender");
  });
});
