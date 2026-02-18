import net from "node:net";
import os from "node:os";
import { pickPrimaryTailnetIPv4, pickPrimaryTailnetIPv6 } from "../infra/tailnet.js";

/**
 * Pick the primary non-internal IPv4 address (LAN IP).
 * Prefers common interface names (en0, eth0) then falls back to any external IPv4.
 */
export function pickPrimaryLanIPv4(): string | undefined {
  const nets = os.networkInterfaces();
  const preferredNames = ["en0", "eth0"];
  for (const name of preferredNames) {
    const list = nets[name];
    const entry = list?.find((n) => n.family === "IPv4" && !n.internal);
    if (entry?.address) {
      return entry.address;
    }
  }
  for (const list of Object.values(nets)) {
    const entry = list?.find((n) => n.family === "IPv4" && !n.internal);
    if (entry?.address) {
      return entry.address;
    }
  }
  return undefined;
}

export function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) {
    return false;
  }
  if (ip === "127.0.0.1") {
    return true;
  }
  if (ip.startsWith("127.")) {
    return true;
  }
  if (ip === "::1") {
    return true;
  }
  if (ip.startsWith("::ffff:127.")) {
    return true;
  }
  return false;
}

function normalizeIPv4MappedAddress(ip: string): string {
  if (ip.startsWith("::ffff:")) {
    return ip.slice("::ffff:".length);
  }
  return ip;
}

function normalizeIp(ip: string | undefined): string | undefined {
  const trimmed = ip?.trim();
  if (!trimmed) {
    return undefined;
  }
  return normalizeIPv4MappedAddress(trimmed.toLowerCase());
}

function parseIpv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!part) {
      return null;
    }
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) {
      return null;
    }
    value = (value << 8) | num;
  }
  return value >>> 0;
}

function stripOptionalZoneId(ip: string): string {
  const idx = ip.indexOf("%");
  if (idx === -1) {
    return ip;
  }
  return ip.slice(0, idx);
}

function parseIpv6ToBigInt(ip: string): bigint | null {
  const normalized = stripOptionalZoneId(ip);
  if (net.isIP(normalized) !== 6) {
    return null;
  }

  const parts = normalized.split("::");
  if (parts.length > 2) {
    return null;
  }

  const leftRaw = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const rightRaw = parts.length === 2 && parts[1] ? parts[1].split(":").filter(Boolean) : [];

  const parseGroups = (groups: string[]): number[] | null => {
    const out: number[] = [];
    for (const group of groups) {
      if (!group) {
        return null;
      }
      if (group.includes(".")) {
        const ipv4 = parseIpv4ToInt(group);
        if (ipv4 === null) {
          return null;
        }
        out.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff);
        continue;
      }
      const num = Number.parseInt(group, 16);
      if (!Number.isInteger(num) || num < 0 || num > 0xffff) {
        return null;
      }
      out.push(num);
    }
    return out;
  };

  const left = parseGroups(leftRaw);
  const right = parseGroups(rightRaw);
  if (!left || !right) {
    return null;
  }

  const total = left.length + right.length;
  if (total > 8) {
    return null;
  }

  const full: number[] = [];
  full.push(...left);

  if (parts.length === 2) {
    const missing = 8 - total;
    for (let i = 0; i < missing; i += 1) {
      full.push(0);
    }
    full.push(...right);
  } else {
    if (total !== 8) {
      return null;
    }
    full.push(...right);
  }

  if (full.length !== 8) {
    return null;
  }

  let value = 0n;
  for (const group of full) {
    value = (value << 16n) | BigInt(group);
  }
  return value;
}

function isIpv4InCidr(ip: string, base: string, prefix: number): boolean {
  if (prefix < 0 || prefix > 32) {
    return false;
  }
  const ipInt = parseIpv4ToInt(ip);
  const baseInt = parseIpv4ToInt(base);
  if (ipInt === null || baseInt === null) {
    return false;
  }
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipInt & mask) === (baseInt & mask);
}

function isIpv6InCidr(ip: string, base: string, prefix: number): boolean {
  if (prefix < 0 || prefix > 128) {
    return false;
  }
  const ipBig = parseIpv6ToBigInt(ip);
  const baseBig = parseIpv6ToBigInt(base);
  if (ipBig === null || baseBig === null) {
    return false;
  }
  const allOnes = (1n << 128n) - 1n;
  const hostBits = 128 - prefix;
  const mask = hostBits === 128 ? 0n : ((allOnes << BigInt(hostBits)) & allOnes);
  return (ipBig & mask) === (baseBig & mask);
}

function stripOptionalPort(ip: string): string {
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end !== -1) {
      return ip.slice(1, end);
    }
  }
  if (net.isIP(ip)) {
    return ip;
  }
  const lastColon = ip.lastIndexOf(":");
  if (lastColon > -1 && ip.includes(".") && ip.indexOf(":") === lastColon) {
    const candidate = ip.slice(0, lastColon);
    if (net.isIP(candidate) === 4) {
      return candidate;
    }
  }
  return ip;
}

export function parseForwardedForClientIp(forwardedFor?: string): string | undefined {
  const raw = forwardedFor?.split(",")[0]?.trim();
  if (!raw) {
    return undefined;
  }
  return normalizeIp(stripOptionalPort(raw));
}

function parseRealIp(realIp?: string): string | undefined {
  const raw = realIp?.trim();
  if (!raw) {
    return undefined;
  }
  return normalizeIp(stripOptionalPort(raw));
}

export function isTrustedProxyAddress(ip: string | undefined, trustedProxies?: string[]): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized || !trustedProxies || trustedProxies.length === 0) {
    return false;
  }
  return trustedProxies.some((entry) => {
    const raw = String(entry ?? "").trim();
    if (!raw) {
      return false;
    }

    const slash = raw.indexOf("/");
    if (slash === -1) {
      return normalizeIp(raw) === normalized;
    }

    const baseRaw = raw.slice(0, slash).trim();
    const prefixRaw = raw.slice(slash + 1).trim();
    if (!baseRaw || !prefixRaw) {
      return false;
    }

    const prefix = Number(prefixRaw);
    if (!Number.isInteger(prefix)) {
      return false;
    }

    const base = normalizeIp(baseRaw);
    if (!base) {
      return false;
    }

    const ipFamily = net.isIP(normalized);
    const baseFamily = net.isIP(base);
    if (ipFamily === 4 && baseFamily === 4) {
      return isIpv4InCidr(normalized, base, prefix);
    }
    if (ipFamily === 6 && baseFamily === 6) {
      return isIpv6InCidr(normalized, base, prefix);
    }
    return false;
  });
}

export function resolveGatewayClientIp(params: {
  remoteAddr?: string;
  forwardedFor?: string;
  realIp?: string;
  trustedProxies?: string[];
}): string | undefined {
  const remote = normalizeIp(params.remoteAddr);
  if (!remote) {
    return undefined;
  }
  if (!isTrustedProxyAddress(remote, params.trustedProxies)) {
    return remote;
  }
  return parseForwardedForClientIp(params.forwardedFor) ?? parseRealIp(params.realIp) ?? remote;
}

export function isLocalGatewayAddress(ip: string | undefined): boolean {
  if (isLoopbackAddress(ip)) {
    return true;
  }
  if (!ip) {
    return false;
  }
  const normalized = normalizeIPv4MappedAddress(ip.trim().toLowerCase());
  const tailnetIPv4 = pickPrimaryTailnetIPv4();
  if (tailnetIPv4 && normalized === tailnetIPv4.toLowerCase()) {
    return true;
  }
  const tailnetIPv6 = pickPrimaryTailnetIPv6();
  if (tailnetIPv6 && ip.trim().toLowerCase() === tailnetIPv6.toLowerCase()) {
    return true;
  }
  return false;
}

/**
 * Resolves gateway bind host with fallback strategy.
 *
 * Modes:
 * - loopback: 127.0.0.1 (rarely fails, but handled gracefully)
 * - lan: always 0.0.0.0 (no fallback)
 * - tailnet: Tailnet IPv4 if available, else loopback
 * - auto: Loopback if available, else 0.0.0.0
 * - custom: User-specified IP, fallback to 0.0.0.0 if unavailable
 *
 * @returns The bind address to use (never null)
 */
export async function resolveGatewayBindHost(
  bind: import("../config/config.js").GatewayBindMode | undefined,
  customHost?: string,
): Promise<string> {
  const mode = bind ?? "loopback";

  if (mode === "loopback") {
    // 127.0.0.1 rarely fails, but handle gracefully
    if (await canBindToHost("127.0.0.1")) {
      return "127.0.0.1";
    }
    return "0.0.0.0"; // extreme fallback
  }

  if (mode === "tailnet") {
    const tailnetIP = pickPrimaryTailnetIPv4();
    if (tailnetIP && (await canBindToHost(tailnetIP))) {
      return tailnetIP;
    }
    if (await canBindToHost("127.0.0.1")) {
      return "127.0.0.1";
    }
    return "0.0.0.0";
  }

  if (mode === "lan") {
    return "0.0.0.0";
  }

  if (mode === "custom") {
    const host = customHost?.trim();
    if (!host) {
      return "0.0.0.0";
    } // invalid config → fall back to all

    if (isValidIPv4(host) && (await canBindToHost(host))) {
      return host;
    }
    // Custom IP failed → fall back to LAN
    return "0.0.0.0";
  }

  if (mode === "auto") {
    if (await canBindToHost("127.0.0.1")) {
      return "127.0.0.1";
    }
    return "0.0.0.0";
  }

  return "0.0.0.0";
}

/**
 * Test if we can bind to a specific host address.
 * Creates a temporary server, attempts to bind, then closes it.
 *
 * @param host - The host address to test
 * @returns True if we can successfully bind to this address
 */
export async function canBindToHost(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const testServer = net.createServer();
    testServer.once("error", () => {
      resolve(false);
    });
    testServer.once("listening", () => {
      testServer.close();
      resolve(true);
    });
    // Use port 0 to let OS pick an available port for testing
    testServer.listen(0, host);
  });
}

export async function resolveGatewayListenHosts(
  bindHost: string,
  opts?: { canBindToHost?: (host: string) => Promise<boolean> },
): Promise<string[]> {
  if (bindHost !== "127.0.0.1") {
    return [bindHost];
  }
  const canBind = opts?.canBindToHost ?? canBindToHost;
  if (await canBind("::1")) {
    return [bindHost, "::1"];
  }
  return [bindHost];
}

/**
 * Validate if a string is a valid IPv4 address.
 *
 * @param host - The string to validate
 * @returns True if valid IPv4 format
 */
export function isValidIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    const n = parseInt(part, 10);
    return !Number.isNaN(n) && n >= 0 && n <= 255 && part === String(n);
  });
}

/**
 * Check if a hostname or IP refers to the local machine.
 * Handles: localhost, 127.x.x.x, ::1, [::1], ::ffff:127.x.x.x
 * Note: 0.0.0.0 and :: are NOT loopback - they bind to all interfaces.
 */
export function isLoopbackHost(host: string): boolean {
  if (!host) {
    return false;
  }
  const h = host.trim().toLowerCase();
  if (h === "localhost") {
    return true;
  }
  // Handle bracketed IPv6 addresses like [::1]
  const unbracket = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  return isLoopbackAddress(unbracket);
}
