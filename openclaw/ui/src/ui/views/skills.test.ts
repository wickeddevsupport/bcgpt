import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderSkills, type SkillsProps } from "./skills.ts";

function createProps(overrides: Partial<SkillsProps> = {}): SkillsProps {
  return {
    loading: false,
    report: {
      skills: [
        {
          skillKey: "managed:bcgpt",
          name: "BCgpt Basecamp",
          description: "Basecamp project and MCP guidance",
          source: "openclaw-managed",
          bundled: false,
          disabled: false,
          blockedByAllowlist: false,
          eligible: true,
          missing: { bins: [], env: [], config: [], os: [] },
          install: [],
          primaryEnv: null,
          emoji: "B",
        },
      ],
      managedSkillsDir: "/tmp/skills",
      configChecks: [],
    },
    error: null,
    filter: "",
    edits: {},
    busyKey: null,
    messages: {},
    onFilterChange: vi.fn(),
    onRefresh: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onSaveKey: vi.fn(),
    onInstall: vi.fn(),
    ...overrides,
  };
}

describe("skills view", () => {
  it("keeps the filter empty and disables browser autofill hints", () => {
    const container = document.createElement("div");
    render(renderSkills(createProps()), container);

    const input = container.querySelector("input");
    expect(input?.value).toBe("");
    expect(input?.getAttribute("autocomplete")).toBe("off");
    expect(input?.getAttribute("name")).toBe("skills-filter");
  });

  it("expands skill groups by default", () => {
    const container = document.createElement("div");
    render(renderSkills(createProps()), container);

    const group = container.querySelector("details.agent-skills-group");
    expect(group?.hasAttribute("open")).toBe(true);
  });
});
