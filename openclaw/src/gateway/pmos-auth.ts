import fs from "node:fs/promises";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { resolveStateDir } from "../config/paths.js";
import { ensureDir } from "../utils.js";

const PMOS_AUTH_STORE_FILE = "pmos-auth.json";
const PMOS_SESSION_COOKIE = "pmos_session";
const PMOS_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const PMOS_SESSION_TTL_MS = PMOS_SESSION_TTL_SECONDS * 1000;

export const PMOS_SHELL_SCOPE = "operator.shell";

export type PmosRole = "super_admin" | "workspace_admin" | "member" | "viewer";

type PmosUserRecord = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  role: PmosRole;
  workspaceId: string;
  createdAtMs: number;
  updatedAtMs: number;
  lastLoginAtMs?: number;
};

type PmosSessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
};

type PmosAuthStore = {
  version: 1;
  users: PmosUserRecord[];
  sessions: PmosSessionRecord[];
};

export type PmosAuthUser = {
  id: string;
  name: string;
  email: string;
  role: PmosRole;
  workspaceId: string;
  createdAtMs: number;
  updatedAtMs: number;
  lastLoginAtMs?: number;
};

type AuthFailure = {
  ok: false;
  status: number;
  error: string;
};

type AuthSuccess = {
  ok: true;
  user: PmosAuthUser;
  sessionToken: string;
};

type AuthResult = AuthSuccess | AuthFailure;

type SessionLookupResult =
  | {
      ok: true;
      user: PmosAuthUser;
      sessionId: string;
      sessionToken: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

let storeMutex: Promise<unknown> = Promise.resolve();

function runWithStoreMutex<T>(work: () => Promise<T>): Promise<T> {
  const next = storeMutex.then(work, work);
  storeMutex = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function resolveStorePath(): string {
  return path.join(resolveStateDir(), PMOS_AUTH_STORE_FILE);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function createPasswordSalt(): string {
  return randomBytes(16).toString("hex");
}

function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

function hashSessionToken(token: string): string {
  return scryptSync(token, "pmos-session", 64).toString("hex");
}

function safeStringEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function defaultStore(): PmosAuthStore {
  return {
    version: 1,
    users: [],
    sessions: [],
  };
}

function toPublicUser(user: PmosUserRecord): PmosAuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    workspaceId: user.workspaceId,
    createdAtMs: user.createdAtMs,
    updatedAtMs: user.updatedAtMs,
    lastLoginAtMs: user.lastLoginAtMs,
  };
}

async function loadStoreUnlocked(): Promise<PmosAuthStore> {
  const storePath = resolveStorePath();
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PmosAuthStore>;
    if (
      parsed &&
      parsed.version === 1 &&
      Array.isArray(parsed.users) &&
      Array.isArray(parsed.sessions)
    ) {
      return {
        version: 1,
        users: parsed.users as PmosUserRecord[],
        sessions: parsed.sessions as PmosSessionRecord[],
      };
    }
  } catch {
    // Return default store when missing or invalid.
  }
  return defaultStore();
}

async function saveStoreUnlocked(store: PmosAuthStore): Promise<void> {
  const storePath = resolveStorePath();
  await ensureDir(path.dirname(storePath));
  const tmpPath = `${storePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2), { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tmpPath, storePath);
}

function pruneExpiredSessions(store: PmosAuthStore): void {
  const now = Date.now();
  store.sessions = store.sessions.filter((session) => session.expiresAtMs > now);
}

function ensureValidPassword(password: string): AuthFailure | null {
  if (!password || password.length < 8) {
    return { ok: false, status: 400, error: "Password must be at least 8 characters." };
  }
  return null;
}

function ensureValidName(name: string): AuthFailure | null {
  if (!name || name.trim().length < 2) {
    return { ok: false, status: 400, error: "Name must be at least 2 characters." };
  }
  return null;
}

function createSessionRecord(userId: string): { token: string; record: PmosSessionRecord } {
  const now = Date.now();
  const token = createSessionToken();
  return {
    token,
    record: {
      id: randomUUID(),
      userId,
      tokenHash: hashSessionToken(token),
      createdAtMs: now,
      updatedAtMs: now,
      expiresAtMs: now + PMOS_SESSION_TTL_MS,
    },
  };
}

export async function signupPmosUser(params: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  return await runWithStoreMutex(async () => {
    const name = params.name.trim();
    const email = normalizeEmail(params.email);
    const password = params.password;

    const nameError = ensureValidName(name);
    if (nameError) {
      return nameError;
    }
    if (!validateEmail(email)) {
      return { ok: false, status: 400, error: "Valid email address is required." };
    }
    const passwordError = ensureValidPassword(password);
    if (passwordError) {
      return passwordError;
    }

    const store = await loadStoreUnlocked();
    pruneExpiredSessions(store);

    const existingUser = store.users.find((user) => user.email === email);
    if (existingUser) {
      return { ok: false, status: 409, error: "An account with this email already exists." };
    }

    const now = Date.now();
    const role: PmosRole = store.users.length === 0 ? "super_admin" : "workspace_admin";
    const salt = createPasswordSalt();
    const user: PmosUserRecord = {
      id: randomUUID(),
      name,
      email,
      passwordSalt: salt,
      passwordHash: hashPassword(password, salt),
      role,
      workspaceId: randomUUID(),
      createdAtMs: now,
      updatedAtMs: now,
      lastLoginAtMs: now,
    };

    const { token, record } = createSessionRecord(user.id);
    store.users.push(user);
    store.sessions.push(record);

    await saveStoreUnlocked(store);
    return { ok: true, user: toPublicUser(user), sessionToken: token };
  });
}

export async function loginPmosUser(params: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  return await runWithStoreMutex(async () => {
    const email = normalizeEmail(params.email);
    const password = params.password;
    if (!validateEmail(email)) {
      return { ok: false, status: 400, error: "Valid email address is required." };
    }
    if (!password) {
      return { ok: false, status: 400, error: "Password is required." };
    }

    const store = await loadStoreUnlocked();
    pruneExpiredSessions(store);
    const user = store.users.find((entry) => entry.email === email);
    if (!user) {
      return { ok: false, status: 401, error: "Invalid email or password." };
    }

    const expectedHash = hashPassword(password, user.passwordSalt);
    if (!safeStringEqual(expectedHash, user.passwordHash)) {
      return { ok: false, status: 401, error: "Invalid email or password." };
    }

    const now = Date.now();
    user.lastLoginAtMs = now;
    user.updatedAtMs = now;
    const { token, record } = createSessionRecord(user.id);
    store.sessions.push(record);
    await saveStoreUnlocked(store);
    return { ok: true, user: toPublicUser(user), sessionToken: token };
  });
}

export function extractPmosSessionTokenFromCookieHeader(cookieHeader?: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const splitIndex = trimmed.indexOf("=");
    if (splitIndex <= 0) {
      continue;
    }
    const name = trimmed.slice(0, splitIndex).trim();
    if (name !== PMOS_SESSION_COOKIE) {
      continue;
    }
    const value = trimmed.slice(splitIndex + 1).trim();
    return value || null;
  }
  return null;
}

export function extractPmosSessionTokenFromRequest(req: IncomingMessage): string | null {
  const cookieValue = req.headers.cookie;
  const cookieHeader = Array.isArray(cookieValue)
    ? cookieValue.join("; ")
    : typeof cookieValue === "string"
      ? cookieValue
      : null;
  return extractPmosSessionTokenFromCookieHeader(cookieHeader);
}

function extractBearerTokenFromRequest(req: IncomingMessage): string | null {
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header || typeof header !== "string") return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const prefix = "bearer ";
  if (trimmed.length <= prefix.length) return null;
  if (trimmed.slice(0, prefix.length).toLowerCase() !== prefix) return null;
  const token = trimmed.slice(prefix.length).trim();
  return token || null;
}

export async function resolvePmosSessionFromToken(token: string): Promise<SessionLookupResult> {
  const trimmed = token.trim();
  if (!trimmed) {
    return { ok: false, status: 401, error: "Session token missing." };
  }

  return await runWithStoreMutex(async () => {
    const store = await loadStoreUnlocked();
    pruneExpiredSessions(store);
    const tokenHash = hashSessionToken(trimmed);
    const session = store.sessions.find((entry) => safeStringEqual(entry.tokenHash, tokenHash));
    if (!session) {
      await saveStoreUnlocked(store);
      return { ok: false, status: 401, error: "Session not found." };
    }

    const user = store.users.find((entry) => entry.id === session.userId);
    if (!user) {
      store.sessions = store.sessions.filter((entry) => entry.id !== session.id);
      await saveStoreUnlocked(store);
      return { ok: false, status: 401, error: "Session user not found." };
    }

    const now = Date.now();
    session.updatedAtMs = now;
    session.expiresAtMs = now + PMOS_SESSION_TTL_MS;
    await saveStoreUnlocked(store);
    return { ok: true, user: toPublicUser(user), sessionId: session.id, sessionToken: trimmed };
  });
}

export async function resolvePmosSessionFromRequest(req: IncomingMessage): Promise<SessionLookupResult> {
  const cookieToken = extractPmosSessionTokenFromRequest(req);
  if (cookieToken) {
    return await resolvePmosSessionFromToken(cookieToken);
  }

  // Automation / operator flows: allow gateway bearer token as a super_admin PMOS session.
  // This keeps /api/ops usable for smoke checks and server-to-server calls without a browser cookie.
  const bearer = extractBearerTokenFromRequest(req);
  const gatewayToken = (process.env.OPENCLAW_GATEWAY_TOKEN || "").trim();
  if (bearer && gatewayToken && safeStringEqual(bearer, gatewayToken)) {
    return await runWithStoreMutex(async () => {
      const store = await loadStoreUnlocked();
      pruneExpiredSessions(store);
      const superAdmin = store.users.find((user) => user.role === "super_admin") ?? store.users[0];
      if (!superAdmin) {
        return { ok: false, status: 401, error: "PMOS is not initialized (no users exist yet)." };
      }
      return {
        ok: true,
        user: toPublicUser(superAdmin),
        sessionId: "gateway-token",
        sessionToken: bearer,
      };
    });
  }

  return { ok: false, status: 401, error: "Session token missing." };
}

/**
 * Best-effort lookup: find a PMOS user record by workspaceId.
 *
 * Today PMOS assigns a unique workspaceId per signup, so this maps 1:1 to a user.
 * If multi-user workspaces are added later, this should be revisited.
 */
export async function resolvePmosUserByWorkspaceId(workspaceId: string): Promise<PmosAuthUser | null> {
  const wsId = String(workspaceId ?? "").trim();
  if (!wsId) return null;
  return await runWithStoreMutex(async () => {
    const store = await loadStoreUnlocked();
    const user = store.users.find((entry) => entry.workspaceId === wsId);
    return user ? toPublicUser(user) : null;
  });
}

export async function revokePmosSessionByToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) {
    return;
  }
  await runWithStoreMutex(async () => {
    const store = await loadStoreUnlocked();
    pruneExpiredSessions(store);
    const tokenHash = hashSessionToken(trimmed);
    store.sessions = store.sessions.filter((entry) => !safeStringEqual(entry.tokenHash, tokenHash));
    await saveStoreUnlocked(store);
  });
}

function isHttpsRequest(req: IncomingMessage): boolean {
  if ((req.socket as { encrypted?: boolean } | undefined)?.encrypted) {
    return true;
  }
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  return typeof proto === "string" && proto.trim().toLowerCase().startsWith("https");
}

export function buildPmosSessionCookieValue(token: string, req: IncomingMessage): string {
  const attrs = [
    `${PMOS_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${PMOS_SESSION_TTL_SECONDS}`,
  ];
  if (isHttpsRequest(req)) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

export function buildPmosClearSessionCookieValue(req: IncomingMessage): string {
  const attrs = [
    `${PMOS_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isHttpsRequest(req)) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

export function scopesForPmosRole(role: PmosRole): string[] {
  if (role === "super_admin") {
    return [
      "operator.admin",
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
      PMOS_SHELL_SCOPE,
    ];
  }
  if (role === "workspace_admin") {
    return [
      "operator.admin",
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
    ];
  }
  if (role === "member") {
    return ["operator.read", "operator.write", "operator.approvals"];
  }
  return ["operator.read"];
}
