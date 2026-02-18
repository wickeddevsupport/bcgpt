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
const provisionInFlight = new Map<string, Promise<unknown>>();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function toCookieHeader(setCookies: string[]): string {
  // Convert Set-Cookie header values into a Cookie header value.
  // Keep only the first "key=value" pair from each cookie string.
  const parts = setCookies
    .map((value) => (typeof value === "string" ? value.split(";")[0]?.trim() : ""))
    .filter((value): value is string => Boolean(value));
  return parts.join("; ");
}

function getSetCookieValues(res: Response): string[] {
  // Node's undici exposes getSetCookie() for multiple Set-Cookie headers.
  const headerObj = res.headers as any;
  const getSetCookie = typeof headerObj?.getSetCookie === "function" ? headerObj.getSetCookie : null;
  if (getSetCookie) {
    const values = getSetCookie.call(headerObj) as unknown;
    return Array.isArray(values) ? (values.filter((v) => typeof v === "string") as string[]) : [];
  }
  const value = res.headers.get("set-cookie");
  return value ? [value] : [];
}

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
    const setup = await attemptOwnerSetup(n8nBaseUrl, creds);
    // Only gate off future setup attempts if n8n actually responded (responded=true).
    // If n8n was unreachable (still starting), leave the flag unset so the next
    // request retries the setup rather than permanently skipping it.
    if (setup.responded) {
      ownerSetupAttempted.add(n8nBaseUrl);
    }
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
): Promise<{ done: boolean; responded: boolean }> {
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

      if (res.ok) return { done: true, responded: true };

      // "already setup" or validation errors — n8n responded, no point retrying setup.
      if (res.status === 400) return { done: false, responded: true };

      // 5xx or unexpected status — n8n may still be starting; allow retry.
    } catch {
      // Network error — n8n not ready yet; try next endpoint but don't mark as responded.
    }
  }

  // No endpoint responded — n8n is likely still starting up.
  return { done: false, responded: false };
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
 * Validate that an n8n auth cookie is still valid by making a lightweight request.
 * Returns true if the cookie is valid, false if invalid or error.
 */
async function validateN8nCookie(n8nBaseUrl: string, cookie: string): Promise<boolean> {
  const base = n8nBaseUrl.replace(/\/+$/, "");
  try {
    // Use GET /rest/login to check if session is valid
    // - 200 + JSON response = valid session (returns user data)
    // - 401 or {"status":"error"} = invalid/expired session
    const res = await fetch(`${base}/rest/login`, {
      method: "GET",
      headers: {
        Cookie: cookie,
        accept: "application/json",
      },
    });
    // Only 200 OK means valid session
    return res.ok;
  } catch {
    // Network error - assume INVALID to force re-login
    return false;
  }
}

/**
 * Attempt to get a valid n8n auth cookie for the given workspace.
 * Uses cached cookies when available, validates before use, otherwise performs server-side login.
 */
export async function getN8nAuthCookie(
  workspaceId: string,
  n8nBaseUrl: string,
): Promise<string | null> {
  // Check cache first
  const cached = sessionCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) {
    // Validate the cached cookie before using it
    const isValid = await validateN8nCookie(n8nBaseUrl, cached.cookie);
    if (isValid) {
      return cached.cookie;
    }
    // Cached cookie is invalid (user logged out of n8n) - invalidate and re-login
    sessionCache.delete(workspaceId);
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
      const setCookies = getSetCookieValues(res);

      if (setCookies.length > 0) return toCookieHeader(setCookies);
      if (res.ok) return null;
    } catch {
      // try next endpoint
    }
  }
  return null;
}

/**
 * Embedded-first provisioning helper:
 * If a workspace has no `ops.user` creds yet, create a workspace-scoped n8n user via invitations
 * and accept the invite programmatically to issue a usable auth cookie immediately.
 */
async function ensureWorkspaceUserViaInvitation(params: {
  workspaceId: string;
  n8nBaseUrl: string;
  email: string;
  name?: string | null;
}): Promise<{ email: string; password: string; cookie: string } | null> {
  const { workspaceId, n8nBaseUrl } = params;

  const wc = await readWorkspaceConnectors(workspaceId);
  const existing = wc?.ops?.user as { email?: string; password?: string } | undefined;
  if (existing?.email && existing?.password) return null;

  const ownerCookie = await getOwnerCookie(n8nBaseUrl);
  if (!ownerCookie) return null;

  const base = n8nBaseUrl.replace(/\/+$/, "");

  // Resolve inviterId (owner user id).
  let inviterId: string | null = null;
  try {
    const meRes = await fetch(`${base}/rest/login`, {
      headers: { Cookie: ownerCookie, accept: "application/json" },
    });
    if (meRes.ok) {
      const me = (await meRes.json().catch(() => null)) as any;
      inviterId = (me?.data?.id ?? me?.id) ? String(me.data?.id ?? me.id) : null;
    }
  } catch {
    // ignore
  }
  if (!inviterId) return null;

  const { randomBytes } = await import("node:crypto");
  const email = String(params.email ?? "").trim().toLowerCase() || `pmos-${workspaceId}@openclaw.local`;
  const password = randomBytes(24).toString("base64url");

  const splitName = (raw?: string | null): { firstName: string; lastName: string } => {
    const value = String(raw ?? "").trim();
    if (!value) return { firstName: "PMOS", lastName: `ws-${workspaceId.slice(0, 8)}` };
    const parts = value.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { firstName: parts[0], lastName: `ws-${workspaceId.slice(0, 8)}` };
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  };
  const { firstName, lastName } = splitName(params.name);

  type InviteResponse = {
    user?: { id?: string; email?: string };
    error?: string;
  };

  // Create user shell via invitation.
  let inviteeId: string | null = null;
  try {
    const inviteRes = await fetch(`${base}/rest/invitations`, {
      method: "POST",
      headers: {
        Cookie: ownerCookie,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify([{ email, role: "global:member" }]),
    });
    if (!inviteRes.ok) {
      const text = await inviteRes.text().catch(() => "");
      console.warn("[n8n-auth] invite failed:", inviteRes.status, text.slice(0, 300));
      return null;
    }

    const invited = (await inviteRes.json().catch(() => null)) as unknown;
    const list = (() => {
      if (Array.isArray(invited)) return invited as InviteResponse[];
      if (invited && typeof invited === "object" && Array.isArray((invited as any).data)) {
        return (invited as any).data as InviteResponse[];
      }
      return null;
    })();
    if (list) {
      const match = list.find((entry) => {
        const e = String(entry?.user?.email ?? "").trim().toLowerCase();
        return e === email;
      });
      inviteeId = match?.user?.id ? String(match.user.id) : null;
    }
  } catch (err) {
    console.warn("[n8n-auth] invite error:", String(err));
    return null;
  }
  if (!inviteeId) return null;

  // Accept invitation (skipAuth) and extract the n8n-auth cookie.
  let cookie: string | null = null;
  try {
    const acceptRes = await fetch(`${base}/rest/invitations/${inviteeId}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ inviterId, firstName, lastName, password }),
      redirect: "manual",
    });
    if (!acceptRes.ok) {
      const text = await acceptRes.text().catch(() => "");
      console.warn("[n8n-auth] accept invite failed:", acceptRes.status, text.slice(0, 300));
      return null;
    }
    const setCookies = getSetCookieValues(acceptRes);
    cookie = setCookies.length > 0 ? toCookieHeader(setCookies) : null;
  } catch (err) {
    console.warn("[n8n-auth] accept invite error:", String(err));
    return null;
  }
  if (!cookie) return null;

  // Persist credentials for future logins.
  const next = {
    ...(wc ?? {}),
    ops: {
      ...((wc?.ops ?? {}) as Record<string, unknown>),
      user: { email, password },
    },
  };
  await writeWorkspaceConnectors(workspaceId, next);

  // Cache the cookie for immediate use.
  sessionCache.set(workspaceId, { cookie, expiresAt: Date.now() + SESSION_TTL_MS });

  return { email, password, cookie };
}

/**
 * Get or create a workspace-scoped n8n cookie (SSO-style).
 *
 * Used by both the HTTP proxy (iframe) and tool calls (wicked-ops), so that workflow
 * reads/writes happen under the same n8n identity for a given PMOS workspace.
 */
export async function getOrCreateWorkspaceN8nCookie(params: {
  workspaceId: string;
  n8nBaseUrl: string;
  pmosUser?: Pick<PmosAuthUser, "email" | "name"> | null;
}): Promise<string | null> {
  const { workspaceId, n8nBaseUrl } = params;

  let cookie = await getN8nAuthCookie(workspaceId, n8nBaseUrl);
  if (cookie) return cookie;

  const emailHint =
    (typeof params.pmosUser?.email === "string" && params.pmosUser.email.trim()) ||
    `pmos-${workspaceId}@openclaw.local`;
  const nameHint = typeof params.pmosUser?.name === "string" ? params.pmosUser.name : null;

  const runProvision = async () => {
    await ensureWorkspaceUserViaInvitation({
      workspaceId,
      n8nBaseUrl,
      email: emailHint,
      name: nameHint,
    });
  };

  const inFlight = provisionInFlight.get(workspaceId);
  if (inFlight) {
    await inFlight.catch(() => undefined);
  } else {
    const p = runProvision().finally(() => {
      if (provisionInFlight.get(workspaceId) === p) {
        provisionInFlight.delete(workspaceId);
      }
    });
    provisionInFlight.set(workspaceId, p);
    await p.catch(() => undefined);
  }

  cookie = await getN8nAuthCookie(workspaceId, n8nBaseUrl);
  return cookie;
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

  // Preferred: workspace-scoped cookie (auto-provisioned via invitations on first use).
  let cookie = await getOrCreateWorkspaceN8nCookie({ workspaceId, n8nBaseUrl, pmosUser: user });
  if (cookie) return { Cookie: cookie };

  // Optional last-resort: allow owner fallback only for super_admin or when explicitly enabled.
  const allowOwnerFallback =
    user.role === "super_admin" ||
    ["1", "true", "yes"].includes(String(process.env.N8N_ALLOW_OWNER_FALLBACK ?? "").trim().toLowerCase());
  if (allowOwnerFallback) {
    const ownerCookie = await getOwnerCookie(n8nBaseUrl);
    if (ownerCookie) return { Cookie: ownerCookie };
  }

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
