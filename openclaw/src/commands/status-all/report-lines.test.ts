import { describe, expect, it, vi } from "vitest";

vi.mock("./diagnosis.js", () => ({
  appendStatusAllDiagnosis: vi.fn(async ({ lines }: { lines: string[] }) => {
    lines.push("diagnosis stub");
  }),
}));

import { buildStatusAllReportLines } from "./report-lines.js";

describe("status --all report lines", () => {
  it("labels the output as global daemon scope", async () => {
    const lines = await buildStatusAllReportLines({
      progress: {
        setLabel: vi.fn(),
        tick: vi.fn(),
      } as never,
      overviewRows: [{ Item: "Config", Value: "~/.openclaw/openclaw.json" }],
      channels: { rows: [], details: [] },
      channelIssues: [],
      agentStatus: { agents: [] },
      connectionDetailsForReport: "ws://127.0.0.1:18789",
      diagnosis: {
        osSummary: { label: "test-os" },
        gatewayMode: "local",
        connection: { url: "ws://127.0.0.1:18789", message: "ok" },
        gatewayProbe: null,
        gatewayReachable: false,
        gatewaySelf: null,
        health: { error: "unreachable" },
        tailscaleMode: "off",
        tailscale: null,
        tailscaleHttpsUrl: null,
        daemon: null,
        nodeService: null,
        sentinel: null,
        lastErr: null,
        port: 18789,
        portUsage: null,
        update: null,
        channelLabel: "stable",
        gitLabel: null,
        channelIssues: [],
        channelsStatus: null,
        skillStatus: null,
        dashboard: null,
        controlUiEnabled: true,
        remoteUrlMissing: false,
      } as never,
    });

    expect(lines[0]).toContain("global daemon scope");
    expect(lines.join("\n")).toContain(
      "It does not represent workspace-effective runtime state.",
    );
  });
});