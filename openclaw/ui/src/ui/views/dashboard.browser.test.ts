import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderDashboard } from "./dashboard.ts";

describe("dashboard provisioning UI", () => {
  const baseProps = () => ({
    connected: true,
    settings: { token: "" },
    lastError: null,
    connectorsLoading: false,
    connectorsError: null,
    connectorsStatus: null,
    projectId: "",
    flowsLoading: false,
    flowsError: null,
    flows: [],
    runsLoading: false,
    runsError: null,
    runs: [],
    traceEvents: [],
    integrationsHref: "/integrations",
    automationsHref: "/automations",
    runsHref: "/runs",
    chatHref: "/chat",
    configHref: "/config",
    modelAuthConfigured: false,
    onNavigateTab: vi.fn(),
    onSettingsChange: vi.fn(),
    onConnect: vi.fn(),
    onRefreshConnectors: vi.fn(),
    onRefreshDashboard: vi.fn(),
    onClearTrace: vi.fn(),
  });

  it("shows provisioning success and copy button when apiKey present", () => {
    const container = document.createElement("div");
    render(
      renderDashboard({
        ...baseProps(),
        opsProvisioningResult: { projectId: "pj-1", apiKey: "abc-123" },
        opsProvisioned: true,
      } as any),
      container,
    );

    const callout = container.querySelector(".callout.success");
    expect(callout).not.toBeNull();
    expect(callout?.textContent).toContain("Wicked Ops provisioned");
    expect(callout?.textContent).toContain("abc-123");

    const copyBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Copy API key"));
    expect(copyBtn).not.toBeUndefined();
  });

  it("shows manual-key fallback when provisioning error exists and saves via handler", () => {
    const container = document.createElement("div");
    const onChange = vi.fn();
    const onSave = vi.fn();

    render(
      renderDashboard({
        ...baseProps(),
        opsProvisioningError: "Projects API is license-gated",
        opsManualApiKeyDraft: "",
        onOpsManualApiKeyChange: onChange,
        onSaveOpsApiKey: async () => onSave(),
      } as any),
      container,
    );

    const warn = container.querySelector(".callout.warn");
    expect(warn).not.toBeNull();
    expect(warn?.textContent).toContain("Automated provisioning failed");

    const input = container.querySelector("input[type=password]") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    if (!input) return;

    input.value = "manual-key-xyz";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).toHaveBeenCalled();

    const saveBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Save API key");
    expect(saveBtn).not.toBeUndefined();
    saveBtn?.click();
    expect(onSave).toHaveBeenCalled();
  });
});