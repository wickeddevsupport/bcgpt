import { describe, expect, it, vi } from "vitest";
import { handleGatewayRequest } from "./server-methods.js";

describe("pmos role gateway restrictions", () => {
  it("blocks non-super-admin users from shell methods", async () => {
    const respond = vi.fn();
    await handleGatewayRequest({
      req: {
        type: "req",
        id: "1",
        method: "node.invoke",
        params: {},
      },
      respond,
      client: {
        connId: "c1",
        pmosRole: "workspace_admin",
        connect: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "openclaw-control-ui",
            version: "test",
            platform: "test",
            mode: "webchat",
          },
          role: "operator",
          scopes: ["operator.admin", "operator.read", "operator.write"],
        },
      },
      isWebchatConnect: () => true,
      extraHandlers: {
        "node.invoke": () => {
          throw new Error("should not execute");
        },
      },
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "super_admin role required",
      }),
    );
  });

  it("allows super_admin users to call shell methods", async () => {
    const respond = vi.fn();
    await handleGatewayRequest({
      req: {
        type: "req",
        id: "1",
        method: "node.invoke",
        params: {},
      },
      respond,
      client: {
        connId: "c1",
        pmosRole: "super_admin",
        connect: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "openclaw-control-ui",
            version: "test",
            platform: "test",
            mode: "webchat",
          },
          role: "operator",
          scopes: ["operator.admin", "operator.shell", "operator.read", "operator.write"],
        },
      },
      isWebchatConnect: () => true,
      extraHandlers: {
        "node.invoke": ({ respond: respondInner }) => {
          respondInner(true, { ok: true });
        },
      },
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(true, { ok: true });
  });
});
