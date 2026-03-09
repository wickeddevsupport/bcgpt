import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderConnections, type ConnectionsProps } from "./connections.ts";

function createProps(overrides: Partial<ConnectionsProps> = {}): ConnectionsProps {
  return {
    opsProvisioned: true,
    connectorsLoading: false,
    connectorsError: null,
    credentials: [
      { id: "conn-1", name: "Basecamp Prod", type: "basecampApi" },
      { id: "conn-2", name: "Slack Alerts", type: "slackApi" },
    ],
    credentialsLoading: false,
    credentialsError: null,
    addConnectionUrl: "https://flow.wickedlab.io/connections",
    onRefresh: vi.fn(),
    onOpenIntegrations: vi.fn(),
    onAddConnection: vi.fn(),
    ...overrides,
  };
}

describe("connections view", () => {
  it("renders the configured connections list beside the connection manager iframe", () => {
    const container = document.createElement("div");
    render(renderConnections(createProps()), container);

    expect(container.textContent).toContain("Configured (2)");
    expect(container.textContent).toContain("Basecamp Prod");
    expect(container.textContent).toContain("Slack Alerts");

    const iframe = container.querySelector("iframe[title='Flow Connections Manager']") as
      | HTMLIFrameElement
      | null;
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("https://flow.wickedlab.io/connections");
  });

  it("shows the integrations callout when Flow is not provisioned", () => {
    const container = document.createElement("div");
    render(
      renderConnections(
        createProps({
          opsProvisioned: false,
          credentials: [],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Flow is not ready for this workspace.");
    expect(container.textContent).toContain("Configure Integrations");
    expect(container.querySelector("iframe")).toBeNull();
  });
});
