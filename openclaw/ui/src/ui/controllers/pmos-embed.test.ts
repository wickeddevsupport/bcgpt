import { describe, expect, it } from "vitest";
import { buildOpsUiConnectionsUrl, buildOpsUiEmbedUrl } from "./pmos-embed.js";

describe("buildOpsUiEmbedUrl", () => {
  it("returns root ops-ui route when no flow id is provided", () => {
    expect(buildOpsUiEmbedUrl("")).toBe("/ops-ui");
    expect(buildOpsUiEmbedUrl("/control")).toBe("/control/ops-ui");
  });

  it("returns a flow-specific route when flow id exists", () => {
    expect(buildOpsUiEmbedUrl("", "wf-123")).toBe("/ops-ui/flows/wf-123");
    expect(buildOpsUiEmbedUrl("/control", "lead intake / alpha")).toBe(
      "/control/ops-ui/flows/lead%20intake%20%2F%20alpha",
    );
  });

  it("returns the native connections route", () => {
    expect(buildOpsUiConnectionsUrl("")).toBe("/ops-ui/connections");
    expect(buildOpsUiConnectionsUrl("/control")).toBe("/control/ops-ui/connections");
  });
});
