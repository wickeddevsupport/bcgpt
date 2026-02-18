import { describe, expect, it } from "vitest";
import { isTrustedProxyAddress, resolveGatewayClientIp } from "./net.js";

describe("gateway/net trusted proxies", () => {
  it("matches exact proxy IPs (including IPv4-mapped IPv6)", () => {
    expect(isTrustedProxyAddress("127.0.0.1", ["127.0.0.1"])).toBe(true);
    expect(isTrustedProxyAddress("::ffff:127.0.0.1", ["127.0.0.1"])).toBe(true);
    expect(isTrustedProxyAddress("::1", ["127.0.0.1"])).toBe(false);
  });

  it("matches IPv4 CIDR entries", () => {
    expect(isTrustedProxyAddress("10.0.10.2", ["10.0.0.0/8"])).toBe(true);
    expect(isTrustedProxyAddress("10.255.255.255", ["10.0.0.0/8"])).toBe(true);
    expect(isTrustedProxyAddress("11.0.0.1", ["10.0.0.0/8"])).toBe(false);
    expect(isTrustedProxyAddress("10.0.10.2", ["10.0.0.0/33"])).toBe(false);
  });

  it("matches IPv6 CIDR entries", () => {
    expect(isTrustedProxyAddress("2001:db8::1", ["2001:db8::/32"])).toBe(true);
    expect(isTrustedProxyAddress("2001:db9::1", ["2001:db8::/32"])).toBe(false);
  });

  it("resolves client IP from forwarded headers only when remote is trusted", () => {
    expect(
      resolveGatewayClientIp({
        remoteAddr: "10.0.10.2",
        forwardedFor: "203.0.113.9",
        trustedProxies: ["10.0.0.0/8"],
      }),
    ).toBe("203.0.113.9");

    expect(
      resolveGatewayClientIp({
        remoteAddr: "10.0.10.2",
        forwardedFor: "203.0.113.9",
        trustedProxies: [],
      }),
    ).toBe("10.0.10.2");
  });
});

