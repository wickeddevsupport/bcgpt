import { describe, expect, it } from "vitest";
import { buildOpsUiEmbedUrl } from "./pmos-embed.ts";

describe("buildOpsUiEmbedUrl", () => {
  it("returns base ops-ui route when no flow id is provided", () => {
    expect(buildOpsUiEmbedUrl("")).toBe("/ops-ui/");
    expect(buildOpsUiEmbedUrl("/control")).toBe("/control/ops-ui/");
  });

  it("returns encoded workflow route for selected flow", () => {
    expect(buildOpsUiEmbedUrl("", "wf-123")).toBe("/ops-ui/workflow/wf-123");
    expect(buildOpsUiEmbedUrl("/control", " lead intake / alpha ")).toBe(
      "/control/ops-ui/workflow/lead%20intake%20%2F%20alpha",
    );
  });

  it("always returns a local in-app route", () => {
    const route = buildOpsUiEmbedUrl("/control", "wf-abc");
    expect(route.startsWith("http://")).toBe(false);
    expect(route.startsWith("https://")).toBe(false);
  });
});
