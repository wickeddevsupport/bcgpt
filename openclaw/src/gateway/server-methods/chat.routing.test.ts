import { describe, expect, it } from "vitest";
import { shouldRouteToPmosWorkspaceChat } from "./chat.js";

describe("shouldRouteToPmosWorkspaceChat", () => {
  const workspaceClient = { pmosWorkspaceId: "ws-1" };

  it("routes explicit Basecamp asks into PMOS chat", () => {
    expect(
      shouldRouteToPmosWorkspaceChat(
        workspaceClient as never,
        "What Basecamp projects do I have and what todos are overdue?",
      ),
    ).toBe(true);
    expect(
      shouldRouteToPmosWorkspaceChat(
        workspaceClient as never,
        "What do I need to do today?",
      ),
    ).toBe(true);
    expect(
      shouldRouteToPmosWorkspaceChat(
        workspaceClient as never,
        "https://3.basecamp.com/1234567/buckets/987654321/card_tables/cards/555 what does this todo mean?",
      ),
    ).toBe(true);
  });

  it("routes explicit PMOS integration asks into PMOS chat", () => {
    expect(
      shouldRouteToPmosWorkspaceChat(
        workspaceClient as never,
        "Create an automation for this project and check the workflow credentials.",
      ),
    ).toBe(true);
    expect(
      shouldRouteToPmosWorkspaceChat(
        workspaceClient as never,
        "Audit this Figma file and tell me which components need cleanup.",
      ),
    ).toBe(true);
  });

  it("does not route generic prompts without workspace context", () => {
    expect(shouldRouteToPmosWorkspaceChat(null, "hello there")).toBe(false);
    expect(
      shouldRouteToPmosWorkspaceChat({ pmosWorkspaceId: "" } as never, "show my projects"),
    ).toBe(false);
  });

  it("keeps image-bearing turns on native chat.send instead of PMOS", () => {
    expect(
      shouldRouteToPmosWorkspaceChat(
        workspaceClient as never,
        "Please analyze this screenshot",
        { hasImages: true },
      ),
    ).toBe(false);
  });

  it("does not route generic chat just because it mentions projects or design", () => {
    expect(
      shouldRouteToPmosWorkspaceChat(
        workspaceClient as never,
        "Design a landing page for this project with a better font scale.",
      ),
    ).toBe(false);
    expect(
      shouldRouteToPmosWorkspaceChat(
        workspaceClient as never,
        "Help me build a todo component in React.",
      ),
    ).toBe(false);
    expect(
      shouldRouteToPmosWorkspaceChat(
        workspaceClient as never,
        "Audit this API client for regressions before release.",
      ),
    ).toBe(false);
  });
});
