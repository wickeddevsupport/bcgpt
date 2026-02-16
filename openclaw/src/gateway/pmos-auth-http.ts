import type { IncomingMessage, ServerResponse } from "node:http";
import {
  buildPmosClearSessionCookieValue,
  buildPmosSessionCookieValue,
  extractPmosSessionTokenFromRequest,
  loginPmosUser,
  resolvePmosSessionFromRequest,
  revokePmosSessionByToken,
  signupPmosUser,
} from "./pmos-auth.js";
import { readJsonBody } from "./hooks.js";

const MAX_BODY_BYTES = 32 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}

function resolveAuthRoute(pathname: string, basePath: string): string | null {
  const normalizedBase = normalizeBasePath(basePath);
  const rootPrefix = "/api/pmos/auth";
  if (pathname === `${rootPrefix}/signup`) {
    return "signup";
  }
  if (pathname === `${rootPrefix}/login`) {
    return "login";
  }
  if (pathname === `${rootPrefix}/logout`) {
    return "logout";
  }
  if (pathname === `${rootPrefix}/me`) {
    return "me";
  }

  if (normalizedBase) {
    const prefixed = `${normalizedBase}${rootPrefix}`;
    if (pathname === `${prefixed}/signup`) {
      return "signup";
    }
    if (pathname === `${prefixed}/login`) {
      return "login";
    }
    if (pathname === `${prefixed}/logout`) {
      return "logout";
    }
    if (pathname === `${prefixed}/me`) {
      return "me";
    }
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export async function handlePmosAuthHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  controlUiBasePath: string;
}): Promise<boolean> {
  const { req, res, controlUiBasePath } = params;
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = resolveAuthRoute(url.pathname, controlUiBasePath);
  if (!route) {
    return false;
  }

  if (route === "me") {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
      return true;
    }
    const session = await resolvePmosSessionFromRequest(req);
    if (!session.ok) {
      sendJson(res, 401, { ok: false, authenticated: false, error: "Authentication required." });
      return true;
    }
    sendJson(res, 200, { ok: true, authenticated: true, user: session.user });
    return true;
  }

  if (route === "logout") {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
      return true;
    }
    const token = extractPmosSessionTokenFromRequest(req);
    if (token) {
      await revokePmosSessionByToken(token);
    }
    res.setHeader("Set-Cookie", buildPmosClearSessionCookieValue(req));
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
    return true;
  }

  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body.ok) {
    sendJson(res, 400, { ok: false, error: body.error || "Invalid request body." });
    return true;
  }
  const parsed = asObject(body.value);
  if (!parsed) {
    sendJson(res, 400, { ok: false, error: "JSON object payload is required." });
    return true;
  }

  if (route === "signup") {
    const name = typeof parsed.name === "string" ? parsed.name : "";
    const email = typeof parsed.email === "string" ? parsed.email : "";
    const password = typeof parsed.password === "string" ? parsed.password : "";
    const result = await signupPmosUser({ name, email, password });
    if (!result.ok) {
      sendJson(res, result.status, { ok: false, error: result.error });
      return true;
    }
    res.setHeader("Set-Cookie", buildPmosSessionCookieValue(result.sessionToken, req));
    sendJson(res, 200, { ok: true, user: result.user });
    return true;
  }

  if (route === "login") {
    const email = typeof parsed.email === "string" ? parsed.email : "";
    const password = typeof parsed.password === "string" ? parsed.password : "";
    const result = await loginPmosUser({ email, password });
    if (!result.ok) {
      sendJson(res, result.status, { ok: false, error: result.error });
      return true;
    }
    res.setHeader("Set-Cookie", buildPmosSessionCookieValue(result.sessionToken, req));
    sendJson(res, 200, { ok: true, user: result.user });
    return true;
  }

  sendJson(res, 404, { ok: false, error: "Not Found" });
  return true;
}
