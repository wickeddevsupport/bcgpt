import { describe, expect, it } from "vitest";
import { buildOpsUiEmbedUrl } from "./pmos-embed.js";

describe("buildOpsUiEmbedUrl", () => {
  it("returns flows route when no flow id is provided", () => {
    expect(buildOpsUiEmbedUrl("")).toBe("/ops-ui/flows");
    expect(buildOpsUiEmbedUrl("/control")).toBe("/control/ops-ui/flows");
  });

  it("returns a flow-specific route when flow id exists", () => {
    expect(buildOpsUiEmbedUrl("", "wf-123")).toBe("/ops-ui/flows/wf-123");
    expect(buildOpsUiEmbedUrl("/control", "lead intake / alpha")).toBe(
      "/control/ops-ui/flows/lead%20intake%20%2F%20alpha",
    );
  });
});
