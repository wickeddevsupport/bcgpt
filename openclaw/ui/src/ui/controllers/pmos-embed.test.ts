import { describe, expect, it } from "vitest";
import { buildOpsUiConnectionsUrl, buildOpsUiEmbedUrl } from "./pmos-embed.js";

describe("buildOpsUiEmbedUrl", () => {
  it("returns the default flows route when no flow id is provided", () => {
    expect(buildOpsUiEmbedUrl("")).toBe("/ops-ui/flows");
    expect(buildOpsUiEmbedUrl("/control")).toBe("/control/ops-ui/flows");
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

  it("uses project-scoped routes when a workspace project id exists", () => {
    expect(buildOpsUiEmbedUrl("", null, "proj-123")).toBe("/ops-ui/projects/proj-123/flows");
    expect(buildOpsUiEmbedUrl("/control", "wf-123", "proj-123")).toBe(
      "/control/ops-ui/projects/proj-123/flows/wf-123",
    );
    expect(buildOpsUiConnectionsUrl("/control", "proj-123")).toBe(
      "/control/ops-ui/projects/proj-123/connections?limit=10",
    );
  });
});
