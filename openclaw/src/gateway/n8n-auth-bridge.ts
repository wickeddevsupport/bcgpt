/**
 * n8n Auth Bridge — OpenClaw Session → n8n Authentication
 *
 * Intercepts proxied requests to the embedded n8n instance and injects
 * authentication context derived from the OpenClaw PMOS session.
 *
 * This replaces n8n's default cookie-based auth for embedded deployments,
 * allowing users to access n8n seamlessly through the OpenClaw UI without
 * a separate n8n login.
 *
 * Flow:
 *   1. Client sends request with OpenClaw session cookie (pmos_session)
 *   2. Bridge resolves session → user + workspaceId
 *   3. Bridge ensures an n8n user exists for this workspace (creates on first access)
 *   4. Bridge logs into n8n as that user and caches the auth cookie
 *   5. Proxied request includes the n8n auth cookie transparently
 */

import type { IncomingMessage } from "node:http";
import { resolvePmosSessionFromRequest, type PmosAuthUser } from "./pmos-auth.js";
import { readWorkspaceConnectors, writeWorkspaceConnectors } from "./workspace-connectors.js";

type N8nSessionCache = {
  cookie: string;
  expiresAt: number;
};

// In-memory cache: workspaceId → n8n session cookie
const sessionCache = new Map<string, N8nSessionCache>();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

type OwnerCookieCache = {
  cookie: string;
  expiresAt: number;
};

// In-memory cache: n8nBaseUrl â†’ owner session cookie
const ownerCookieCache = new Map<string, OwnerCookieCache>();
const ownerSetupAttempted = new Set<string>();

function readOwnerCreds(): { email: string; password: string } | null {
  const email = (process.env.N8N_OWNER_EMAIL || "").trim();
  const password = (process.env.N8N_OWNER_PASSWORD || "").trim();
  if (!email || !password) return null;
  return { email, password };
}

export async function getOwnerCookie(n8nBaseUrl: string): Promise<string | null> {
  const cached = ownerCookieCache.get(n8nBaseUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.cookie;
  }

  const creds = readOwnerCreds();
  if (!creds) return null;

  let cookie = await loginToN8n(n8nBaseUrl, creds.email, creds.password);
  if (!cookie && !ownerSetupAttempted.has(n8nBaseUrl)) {
    ownerSetupAttempted.add(n8nBaseUrl);
    await attemptOwnerSetup(n8nBaseUrl, creds);
    cookie = await loginToN8n(n8nBaseUrl, creds.email, creds.password);
  }

  if (cookie) {
    ownerCookieCache.set(n8nBaseUrl, {
      cookie,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
  }
  return cookie;
}

async function attemptOwnerSetup(
  n8nBaseUrl: string,
  creds: { email: string; password: string },
): Promise<boolean> {
  const firstName = (process.env.N8N_OWNER_FIRST_NAME || "OpenClaw").trim() || "OpenClaw";
  const lastName = (process.env.N8N_OWNER_LAST_NAME || "Owner").trim() || "Owner";

  const endpoints = [
    `${n8nBaseUrl.replace(/\/+$/, "")}/rest/owner/setup`,
    `${n8nBaseUrl.replace(/\/+$/, "")}/api/v1/owner/setup`,
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: creds.email,
          password: creds.password,
          firstName,
          lastName,
        }),
      });

      if (res.ok) return true;

      // "already setup" or validation errors; caller will retry login regardless.
      if (res.status === 400) return false;
    } catch {
      // try next endpoint
    }
  }

  return false;
}

/**
 * Resolve the OpenClaw user from an incoming HTTP request.
 * Returns null if the request is unauthenticated.
 */
export async function resolveOpenClawUser(
  req: IncomingMessage,
): Promise<PmosAuthUser | null> {
  const session = await resolvePmosSessionFromRequest(req);
  if (!session.ok) return null;
  return session.user;
}

/**
 * Attempt to get a valid n8n auth cookie for the given workspace.
 * Uses cached cookies when available, otherwise performs server-side login.
 */
export async function getN8nAuthCookie(
  workspaceId: string,
  n8nBaseUrl: string,
): Promise<string | null> {
  // Check cache first
  const cached = sessionCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.cookie;
  }

  // Read workspace-specific n8n credentials
  const wc = await readWorkspaceConnectors(workspaceId);
  const user = wc?.ops?.user as { email?: string; password?: string } | undefined;
  if (!user?.email || !user?.password) {
    return null;
  }

  // Attempt login to n8n
  const cookie = await loginToN8n(n8nBaseUrl, user.email, user.password);
  if (cookie) {
    sessionCache.set(workspaceId, {
      cookie,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
  }
  return cookie;
}

/**
 * Login to n8n and return the session cookie.
 */
async function loginToN8n(
  baseUrl: string,
  email: string,
  password: string,
): Promise<string | null> {
  const toCookieHeader = (setCookies: string[]): string => {
    // Convert Set-Cookie header values into a Cookie header value.
    // Keep only the first "key=value" pair from each cookie string.
    const parts = setCookies
      .map((value) => (typeof value === "string" ? value.split(";")[0]?.trim() : ""))
      .filter((value): value is string => Boolean(value));
    return parts.join("; ");
  };

  const endpoints = [
    // Current n8n (v1.x) login endpoint
    `${baseUrl}/rest/login`,
    // Legacy fallbacks
    `${baseUrl}/rest/users/login`,
    `${baseUrl}/api/v1/users/login`,
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        redirect: "manual",
      });
      const setCookies = (() => {
        const headerObj = res.headers as any;
        const getSetCookie = typeof headerObj?.getSetCookie === "function" ? headerObj.getSetCookie : null;
        if (getSetCookie) {
          const values = getSetCookie.call(headerObj) as unknown;
          return Array.isArray(values) ? (values.filter((v) => typeof v === "string") as string[]) : [];
        }
        const value = res.headers.get("set-cookie");
        return value ? [value] : [];
      })();

      if (setCookies.length > 0) return toCookieHeader(setCookies);
      if (res.ok) return null;
    } catch {
      // try next endpoint
    }
  }
  return null;
}

/**
 * Ensure an n8n user exists for this workspace.
 * Creates one via the n8n API if it doesn't exist yet.
 * Persists credentials to workspace connectors.
 */
export async function ensureN8nWorkspaceUser(
  workspaceId: string,
  n8nBaseUrl: string,
  n8nApiKey: string,
): Promise<{ email: string; password: string } | null> {
  // Check if we already have credentials
  const wc = await readWorkspaceConnectors(workspaceId);
  const existing = wc?.ops?.user as { email?: string; password?: string } | undefined;
  if (existing?.email && existing?.password) {
    return { email: existing.email, password: existing.password };
  }

  // Generate credentials for this workspace
  const { randomBytes } = await import("node:crypto");
  const email = `pmos-${workspaceId}@openclaw.local`;
  const password = randomBytes(16).toString("base64url");

  // Try to create user in n8n
  const endpoints = [
    `${n8nBaseUrl}/api/v1/users`,
    `${n8nBaseUrl}/rest/users`,
  ];

  let created = false;
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-N8N-API-KEY": n8nApiKey,
        },
        body: JSON.stringify({
          email,
          password,
          firstName: "PMOS",
          lastName: `ws-${workspaceId.slice(0, 8)}`,
        }),
      });
      if (res.ok || res.status === 409) {
        created = true;
        break;
      }
    } catch {
      // try next endpoint
    }
  }

  if (!created) return null;

  // Persist credentials
  const next = {
    ...(wc ?? {}),
    ops: {
      ...((wc?.ops ?? {}) as Record<string, unknown>),
      user: { email, password },
    },
  };
  await writeWorkspaceConnectors(workspaceId, next);

  return { email, password };
}

/**
 * Embedded-first provisioning helper:
 * If a workspace has no ops.user creds yet, try to create a workspace user using the n8n owner session.
 *
 * Best-effort: if the user already exists (409), we do not overwrite local creds because we
 * can't recover the password safely without a reset flow.
 */
async function ensureWorkspaceUserViaOwnerCookie(
  workspaceId: string,
  n8nBaseUrl: string,
): Promise<{ email: string; password: string } | null> {
  const wc = await readWorkspaceConnectors(workspaceId);
  const existing = wc?.ops?.user as { email?: string; password?: string } | undefined;
  if (existing?.email && existing?.password) {
    return { email: existing.email, password: existing.password };
  }

  const ownerCookie = await getOwnerCookie(n8nBaseUrl);
  if (!ownerCookie) return null;

  const { randomBytes } = await import("node:crypto");
  const email = `pmos-${workspaceId}@openclaw.local`;
  const password = randomBytes(16).toString("base64url");

  const endpoints = [`${n8nBaseUrl}/api/v1/users`, `${n8nBaseUrl}/rest/users`];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Cookie: ownerCookie,
        },
        body: JSON.stringify({
          email,
          password,
          firstName: "PMOS",
          lastName: `ws-${workspaceId.slice(0, 8)}`,
        }),
      });

      if (res.ok) {
        const next = {
          ...(wc ?? {}),
          ops: {
            ...((wc?.ops ?? {}) as Record<string, unknown>),
            user: { email, password },
          },
        };
        await writeWorkspaceConnectors(workspaceId, next);
        return { email, password };
      }

      if (res.status === 409) {
        return null;
      }
    } catch {
      // try next endpoint
    }
  }

  return null;
}

/**
 * Invalidate cached n8n session for a workspace.
 * Call this when workspace credentials change or user logs out.
 */
export function invalidateN8nSession(workspaceId: string): void {
  sessionCache.delete(workspaceId);
}

/**
 * Build proxy headers that include n8n auth for the given request.
 * Returns extra headers to merge into the proxied request, or empty object
 * if no auth is available.
 */
export async function buildN8nAuthHeaders(
  req: IncomingMessage,
  n8nBaseUrl: string,
): Promise<Record<string, string>> {
  const user = await resolveOpenClawUser(req);
  if (!user) return {};

  const { workspaceId } = user;

  // Preferred: workspace-scoped cookie via stored ops.user credentials.
  let cookie = await getN8nAuthCookie(workspaceId, n8nBaseUrl);
  if (cookie) return { Cookie: cookie };

  // Bootstrap: if no creds exist yet, try to provision a workspace user using the owner session.
  await ensureWorkspaceUserViaOwnerCookie(workspaceId, n8nBaseUrl);
  cookie = await getN8nAuthCookie(workspaceId, n8nBaseUrl);
  if (cookie) return { Cookie: cookie };

  // Last-resort: use owner cookie for any authenticated PMOS user.
  // Per-workspace n8n user creation is not reliably supported in this n8n version.
  // Workspace isolation is enforced at the proxy level via workflow tags.
  const ownerCookie = await getOwnerCookie(n8nBaseUrl);
  if (ownerCookie) return { Cookie: ownerCookie };

  // Last-resort: use API key only when explicitly scoped to this n8n base URL.
  // (Some workspaces may still carry remote ops keys; don't leak those into embedded n8n auth.)
  const wc = await readWorkspaceConnectors(workspaceId);
  const ops = wc?.ops as Record<string, unknown> | undefined;
  const apiKey = typeof ops?.apiKey === "string" ? ops.apiKey.trim() : "";
  const opsUrl =
    typeof ops?.url === "string" ? ops.url.trim().replace(/\/+$/, "") : "";
  const base = n8nBaseUrl.trim().replace(/\/+$/, "");
  if (apiKey && opsUrl && opsUrl === base) {
    return { "X-N8N-API-KEY": apiKey };
  }

  return {};
}
