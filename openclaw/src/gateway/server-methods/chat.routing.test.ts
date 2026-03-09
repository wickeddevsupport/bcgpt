import { describe, expect, it } from "vitest";
import { shouldRouteToPmosWorkspaceChat } from "./chat.js";

describe("shouldRouteToPmosWorkspaceChat", () => {
  const workspaceClient = { pmosWorkspaceId: "ws-1" };

  it("routes Basecamp and project-management prompts into PMOS chat", () => {
    expect(
      shouldRouteToPmosWorkspaceChat(
        workspaceClient as never,
        "What Basecamp projects do I have and what todos are overdue?",
      ),
    ).toBe(true);
    expect(
      shouldRouteToPmosWorkspaceChat(
        workspaceClient as never,
        "Create an automation for this project and check the workflow credentials.",
      ),
    ).toBe(true);
  });

  it("does not route generic prompts without workspace context", () => {
    expect(shouldRouteToPmosWorkspaceChat(null, "hello there")).toBe(false);
    expect(
      shouldRouteToPmosWorkspaceChat({ pmosWorkspaceId: "" } as never, "show my projects"),
    ).toBe(false);
  });
});
