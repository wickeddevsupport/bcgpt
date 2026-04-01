/**
 * HTTP endpoints for PMOS authentication.
 *
 * Routes:
 *   GET  /api/pmos/auth/me                  → session check (returns authenticated user)
 *   POST /api/pmos/auth/login               → login with email + password
 *   POST /api/pmos/auth/signup              → create account
 *   POST /api/pmos/auth/logout              → end session
 *   POST /api/pmos/auth/change-password     → change own password
 *   POST /api/pmos/auth/admin/reset-password → admin reset another user's password
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  signupPmosUser,
  loginPmosUser,
  changePmosUserPassword,
  adminResetPmosUserPassword,
  resolvePmosSessionFromRequest,
  revokePmosSessionByToken,
  extractPmosSessionTokenFromRequest,
  buildPmosSessionCookieValue,
  buildPmosClearSessionCookieValue,
} from "./pmos-auth.js";
import { readJsonBody } from "./hooks.js";

const AUTH_PREFIX = "/api/pmos/auth";
const MAX_BODY_BYTES = 16 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

type AuthRoute =
  | "me"
  | "login"
  | "signup"
  | "logout"
  | "change-password"
  | "admin-reset-password";

function resolveAuthRoute(pathname: string, method: string): AuthRoute | null {
  const sub = pathname.startsWith(AUTH_PREFIX + "/")
    ? pathname.slice(AUTH_PREFIX.length + 1).replace(/\/+$/, "")
    : pathname === AUTH_PREFIX
      ? ""
      : null;
  if (sub === null) return null;

  if (sub === "me" && method === "GET") return "me";
  if (sub === "login" && method === "POST") return "login";
  if (sub === "signup" && method === "POST") return "signup";
  if (sub === "logout" && method === "POST") return "logout";
  if (sub === "change-password" && method === "POST") return "change-password";
  if (sub === "admin/reset-password" && method === "POST") return "admin-reset-password";

  // Path matched the prefix but method/sub didn't → 405
  if (
    sub === "me" ||
    sub === "login" ||
    sub === "signup" ||
    sub === "logout" ||
    sub === "change-password" ||
    sub === "admin/reset-password"
  ) {
    return null; // handled below as 405
  }

  return null;
}

function isKnownAuthSub(pathname: string): boolean {
  const sub = pathname.startsWith(AUTH_PREFIX + "/")
    ? pathname.slice(AUTH_PREFIX.length + 1).replace(/\/+$/, "")
    : null;
  if (!sub) return false;
  return [
    "me",
    "login",
    "signup",
    "logout",
    "change-password",
    "admin/reset-password",
  ].includes(sub);
}

export async function handlePmosAuthHttp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  // Quick rejection: not our prefix
  if (!url.pathname.startsWith(AUTH_PREFIX)) return false;

  // Known sub-path but wrong method → 405
  if (isKnownAuthSub(url.pathname)) {
    const route = resolveAuthRoute(url.pathname, method);
    if (!route) {
      sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
      return true;
    }
  }

  const route = resolveAuthRoute(url.pathname, method);
  if (!route) return false;

  try {
    switch (route) {
      case "me": {
        const session = await resolvePmosSessionFromRequest(req);
        if (!session || !session.ok) {
          sendJson(res, 401, { ok: false, error: "Not authenticated", authenticated: false });
          return true;
        }
        sendJson(res, 200, { ok: true, user: session.user, authenticated: true });
        return true;
      }

      case "login": {
        const body = (await readJsonBody(req, MAX_BODY_BYTES)) as Record<string, unknown> | null;
        const email = typeof body?.email === "string" ? body.email : "";
        const password = typeof body?.password === "string" ? body.password : "";
        const result = await loginPmosUser({ email, password });
        if (!result.ok) {
          sendJson(res, result.status, { ok: false, error: result.error });
          return true;
        }
        res.setHeader("Set-Cookie", buildPmosSessionCookieValue(result.sessionToken, req));
        sendJson(res, 200, { ok: true, user: result.user });
        return true;
      }

      case "signup": {
        const body = (await readJsonBody(req, MAX_BODY_BYTES)) as Record<string, unknown> | null;
        const name = typeof body?.name === "string" ? body.name : "";
        const email = typeof body?.email === "string" ? body.email : "";
        const password = typeof body?.password === "string" ? body.password : "";
        const result = await signupPmosUser({ name, email, password });
        if (!result.ok) {
          sendJson(res, result.status, { ok: false, error: result.error });
          return true;
        }
        res.setHeader("Set-Cookie", buildPmosSessionCookieValue(result.sessionToken, req));
        sendJson(res, 200, { ok: true, user: result.user });
        return true;
      }

      case "logout": {
        const token = extractPmosSessionTokenFromRequest(req);
        if (token) {
          await revokePmosSessionByToken(token);
        }
        res.setHeader("Set-Cookie", buildPmosClearSessionCookieValue(req));
        sendJson(res, 200, { ok: true });
        return true;
      }

      case "change-password": {
        const session = await resolvePmosSessionFromRequest(req);
        if (!session || !session.ok) {
          sendJson(res, 401, { ok: false, error: "Authentication required" });
          return true;
        }
        const body = (await readJsonBody(req, MAX_BODY_BYTES)) as Record<string, unknown> | null;
        const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
        const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
        const result = await changePmosUserPassword({
          userId: session.user.id,
          currentPassword,
          newPassword,
        });
        if (!result.ok) {
          sendJson(res, result.status, { ok: false, error: result.error });
          return true;
        }
        res.setHeader("Set-Cookie", buildPmosSessionCookieValue(result.sessionToken, req));
        sendJson(res, 200, { ok: true, user: result.user });
        return true;
      }

      case "admin-reset-password": {
        const session = await resolvePmosSessionFromRequest(req);
        if (!session || !session.ok) {
          sendJson(res, 401, { ok: false, error: "Authentication required" });
          return true;
        }
        const body = (await readJsonBody(req, MAX_BODY_BYTES)) as Record<string, unknown> | null;
        const email = typeof body?.email === "string" ? body.email : "";
        const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
        const result = await adminResetPmosUserPassword({
          actorUserId: session.user.id,
          targetEmail: email,
          newPassword,
        });
        if (!result.ok) {
          sendJson(res, result.status, { ok: false, error: result.error });
          return true;
        }
        sendJson(res, 200, { ok: true, user: result.user });
        return true;
      }
    }
  } catch {
    sendJson(res, 500, { ok: false, error: "Internal server error" });
    return true;
  }

  return false;
}
