import { describe, expect, it } from "vitest";
import { shouldRouteToPmosWorkspaceChat } from "./chat.js";

describe("shouldRouteToPmosWorkspaceChat", () => {
  // Routing to pmos.chat.send is disabled -- all messages go through the
  // standard pi-coding-agent path (dispatchInboundMessage). The function
  // always returns false regardless of workspace membership or message content.

  it("always returns false regardless of message content", () => {
    const workspaceClient = { pmosWorkspaceId: "ws-1" };
    expect(
      shouldRouteToPmosWorkspaceChat(workspaceClient as never, "What Basecamp projects do I have?"),
    ).toBe(false);
    expect(
      shouldRouteToPmosWorkspaceChat(workspaceClient as never, "Audit this Figma file."),
    ).toBe(false);
    expect(
      shouldRouteToPmosWorkspaceChat(workspaceClient as never, "Help me write a React component."),
    ).toBe(false);
  });

  it("returns false when there is no workspace client", () => {
    expect(shouldRouteToPmosWorkspaceChat(null, "hello there")).toBe(false);
    expect(
      shouldRouteToPmosWorkspaceChat({ pmosWorkspaceId: "" } as never, "show my projects"),
    ).toBe(false);
  });
});
