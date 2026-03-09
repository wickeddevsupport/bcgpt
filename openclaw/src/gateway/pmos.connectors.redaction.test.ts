import { describe, expect, it } from "vitest";
import { __test } from "./server-methods/pmos.js";

describe("pmos connector redaction", () => {
  it("strips workflow-engine passwords while keeping email and hasPassword metadata", () => {
    const redacted = __test.stripSensitiveUserCredentialsFromConnectors({
      ops: {
        url: "https://flow.wickedlab.io",
        apiKey: "ops-key",
        user: {
          email: "workspace@example.com",
          password: "secret-ops-password",
        },
      },
      activepieces: {
        url: "https://flow.wickedlab.io",
        user: {
          email: "workspace@example.com",
          password: "secret-flow-password",
        },
      },
      bcgpt: {
        apiKey: "bc-key",
      },
      figma: {
        auth: {
          personalAccessToken: "figd_pat_super_secret",
          source: "fm-session",
          mcpServerUrl: "https://mcp.figma.com/mcp",
        },
        identity: {
          connected: true,
        },
      },
    }) as Record<string, any>;

    expect(redacted.ops).toMatchObject({
      url: "https://flow.wickedlab.io",
      apiKey: "ops-key",
      user: {
        email: "workspace@example.com",
        hasPassword: true,
      },
    });
    expect(redacted.ops?.user?.password).toBeUndefined();

    expect(redacted.activepieces).toMatchObject({
      url: "https://flow.wickedlab.io",
      user: {
        email: "workspace@example.com",
        hasPassword: true,
      },
    });
    expect(redacted.activepieces?.user?.password).toBeUndefined();

    expect(redacted.bcgpt).toMatchObject({
      apiKey: "bc-key",
    });

    expect(redacted.figma).toMatchObject({
      auth: {
        hasPersonalAccessToken: true,
        source: "fm-session",
        mcpServerUrl: "https://mcp.figma.com/mcp",
      },
      identity: {
        connected: true,
        hasPersonalAccessToken: true,
      },
    });
    expect(redacted.figma?.auth?.personalAccessToken).toBeUndefined();
  });
});
