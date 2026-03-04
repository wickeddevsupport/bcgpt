import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/config.js";
import { resolvePmosSessionFromRequest } from "./pmos-auth.js";
import { readWorkspaceConnectors } from "./workspace-connectors.js";

type OpsSession = {
  ok: boolean;
  user?: {
    workspaceId: string;
    role: string;
    email?: string;
    id?: string;
  };
};

type OpsContext = {
  workspaceId: string | null;
  role: string | null;
  baseUrl: string;
  apiKey: string | null;
  apiKeyScope: "workspace" | "global" | "none";
  projectId: string | null;
  user: { email: string; password: string } | null;
};

const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-authorization",
  "te",
  "trailers",
  "expect",
  "content-length",
]);

const STRIP_RESPONSE_HEADERS = new Set([
  "connection",
  "transfer-encoding",
  "keep-alive",
  // Node fetch auto-decompresses; do not forward stale encoding header.
  "content-encoding",
]);

const OPS_UI_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

function readConfigString(cfg: unknown, pathParts: string[]): string | null {
  let current: unknown = cfg;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== "string") {
    return null;
  }
  const trimmed = current.trim();
  return trimmed ? trimmed : null;
}

function normalizeBaseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function readGlobalOpsConfig(): { url: string; apiKey: string | null; projectId: string | null } {
  const cfg = loadConfig() as unknown;
  const url =
    normalizeBaseUrl(
      readConfigString(cfg, ["pmos", "connectors", "ops", "url"]) ??
        readConfigString(cfg, ["pmos", "connectors", "activepieces", "url"]) ??
        process.env.ACTIVEPIECES_URL ??
        process.env.FLOW_URL ??
        process.env.OPS_URL ??
        null,
    ) ?? "https://flow.wickedlab.io";

  const apiKey = (
    readConfigString(cfg, ["pmos", "connectors", "ops", "apiKey"]) ??
    readConfigString(cfg, ["pmos", "connectors", "activepieces", "apiKey"]) ??
    process.env.ACTIVEPIECES_API_KEY ??
    process.env.OPS_API_KEY ??
    ""
  ).trim();

  const projectId = (
    readConfigString(cfg, ["pmos", "connectors", "ops", "projectId"]) ??
    readConfigString(cfg, ["pmos", "connectors", "activepieces", "projectId"]) ??
    process.env.ACTIVEPIECES_PROJECT_ID ??
    process.env.OPS_PROJECT_ID ??
    ""
  ).trim();

  return {
    url,
    apiKey: apiKey || null,
    projectId: projectId || null,
  };
}

function workspaceUserFromConnectors(value: unknown): { email: string; password: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const rawEmail = candidate.email;
  const rawPassword = candidate.password;
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  const password = typeof rawPassword === "string" ? rawPassword : "";
  if (!email || !password) {
    return null;
  }
  return { email, password };
}

function sanitizeEnvKeySuffix(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function workspaceUserFromSessionEnv(sessionUser: OpsSession["user"] | undefined): { email: string; password: string } | null {
  const email = typeof sessionUser?.email === "string" ? sessionUser.email.trim() : "";
  if (!email) {
    return null;
  }
  const emailPrefix = email.includes("@") ? email.slice(0, email.indexOf("@")) : email;
  const keyVariants = [
    sanitizeEnvKeySuffix(email),
    sanitizeEnvKeySuffix(emailPrefix),
    sanitizeEnvKeySuffix(String(sessionUser?.id ?? "")),
  ].filter(Boolean);

  const candidateEnvKeys = [
    ...keyVariants.map((suffix) => `ACTIVEPIECES_USER_PASSWORD_${suffix}`),
    ...keyVariants.map((suffix) => `OPS_USER_PASSWORD_${suffix}`),
    "ACTIVEPIECES_USER_PASSWORD",
    "OPS_USER_PASSWORD",
  ];

  for (const key of candidateEnvKeys) {
    const value = process.env[key];
    if (typeof value === "string" && value) {
      return { email, password: value };
    }
  }
  return null;
}

async function resolveOpsContext(
  req: IncomingMessage,
  options?: { requireSession?: boolean },
): Promise<OpsContext | null> {
  const requireSession = Boolean(options?.requireSession);
  const session = (await resolvePmosSessionFromRequest(req)) as OpsSession;
  const global = readGlobalOpsConfig();

  if (!session.ok || !session.user) {
    if (requireSession) {
      return null;
    }
    return {
      workspaceId: null,
      role: null,
      baseUrl: global.url,
      apiKey: global.apiKey,
      apiKeyScope: global.apiKey ? "global" : "none",
      projectId: global.projectId,
      user: null,
    };
  }

  const workspaceId = String(session.user.workspaceId ?? "").trim();
  const role = String(session.user.role ?? "").trim() || null;
  const connectors = (await readWorkspaceConnectors(workspaceId)) ?? {};
  const ops =
    connectors && typeof connectors === "object" && !Array.isArray(connectors)
      ? ((connectors as Record<string, unknown>).ops as Record<string, unknown> | undefined) ??
        ((connectors as Record<string, unknown>).activepieces as Record<string, unknown> | undefined)
      : undefined;

  const workspaceUrl =
    typeof ops?.url === "string" && ops.url.trim()
      ? normalizeBaseUrl(ops.url)
      : null;
  const workspaceApiKey =
    typeof ops?.apiKey === "string" && ops.apiKey.trim() ? ops.apiKey.trim() : null;
  const workspaceProjectId =
    typeof ops?.projectId === "string" && ops.projectId.trim() ? ops.projectId.trim() : null;

  const allowGlobalKeyFallback = boolEnv("PMOS_ALLOW_GLOBAL_OPS_KEY_FALLBACK", true);
  const apiKey = workspaceApiKey ?? (allowGlobalKeyFallback ? global.apiKey : null);
  const apiKeyScope: OpsContext["apiKeyScope"] = workspaceApiKey
    ? "workspace"
    : apiKey
      ? "global"
      : "none";
  const projectId = workspaceProjectId ?? global.projectId;
  const user = workspaceUserFromConnectors(ops?.user) ?? workspaceUserFromSessionEnv(session.user);

  return {
    workspaceId,
    role,
    baseUrl: workspaceUrl ?? global.url,
    apiKey,
    apiKeyScope,
    projectId,
    user,
  };
}

function uniqResolved(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const resolved = path.resolve(item);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function findOpenclawRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i += 1) {
    try {
      if (fs.existsSync(path.join(dir, "openclaw.mjs"))) {
        return dir;
      }
    } catch {
      // ignore
    }
    const next = path.dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return null;
}

function resolveOpsUiDistDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = findOpenclawRoot(here) ?? findOpenclawRoot(process.cwd());
  const candidates = uniqResolved(
    [
      root ? path.join(root, "ops-ui", "dist") : "",
      root ? path.join(root, "openclaw", "ops-ui", "dist") : "",
      path.resolve(here, "..", "..", "ops-ui", "dist"),
      path.resolve(process.cwd(), "ops-ui", "dist"),
      path.resolve(process.cwd(), "openclaw", "ops-ui", "dist"),
    ].filter(Boolean),
  );

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }
  return candidates[0] ?? path.resolve(process.cwd(), "ops-ui", "dist");
}

const OPS_UI_DIST = resolveOpsUiDistDir();

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function buildForwardHeaders(
  req: IncomingMessage,
  options?: {
    extra?: Record<string, string>;
    allowCookies?: boolean;
  },
): Record<string, string> {
  const out: Record<string, string> = {};
  const allowCookies = Boolean(options?.allowCookies);
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (STRIP_REQUEST_HEADERS.has(lower)) continue;
    if (!allowCookies && lower === "cookie") continue;
    if (Array.isArray(value)) {
      out[key] = value.join(", ");
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return { ...out, ...(options?.extra ?? {}) };
}

function extractSetCookies(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    const values = withGetSetCookie.getSetCookie();
    if (Array.isArray(values) && values.length > 0) {
      return values;
    }
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function copyUpstreamHeaders(upstream: Response, res: ServerResponse): void {
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (STRIP_RESPONSE_HEADERS.has(lower) || lower === "content-length" || lower === "set-cookie") {
      continue;
    }
    res.setHeader(key, value);
  }

  const upstreamCookies = extractSetCookies(upstream.headers);
  if (upstreamCookies.length > 0) {
    const existing = res.getHeader("set-cookie");
    const merged = [
      ...(Array.isArray(existing)
        ? existing.map((value) => String(value))
        : existing
          ? [String(existing)]
          : []),
      ...upstreamCookies,
    ];
    if (merged.length > 0) {
      res.setHeader("set-cookie", merged);
    }
  }
}

function isWriteMethod(method: string | undefined): boolean {
  const upper = (method ?? "GET").toUpperCase();
  return upper === "POST" || upper === "PUT" || upper === "PATCH";
}

function isAuthApiPath(pathname: string): boolean {
  return (
    pathname === "/api/v1/authentication/sign-in" ||
    pathname === "/api/v1/authentication/sign-up" ||
    pathname.startsWith("/api/v1/authentication/") ||
    pathname === "/api/v1/users/sign-in" ||
    pathname === "/api/v1/users/login"
  );
}

function isProjectScopedListPath(pathname: string): boolean {
  return (
    pathname === "/api/v1/flows" ||
    pathname === "/api/v1/flows/count" ||
    pathname === "/api/v1/flow-runs" ||
    pathname === "/api/v1/app-connections" ||
    pathname === "/api/v1/pieces"
  );
}

function addProjectIdToTargetUrl(targetUrl: string, projectId: string | null): string {
  if (!projectId) {
    return targetUrl;
  }
  try {
    const parsed = new URL(targetUrl);
    if (isProjectScopedListPath(parsed.pathname) && !parsed.searchParams.get("projectId")) {
      parsed.searchParams.set("projectId", projectId);
    }
    return parsed.toString();
  } catch {
    return targetUrl;
  }
}

function rewriteBodyWithProjectId(
  targetPathname: string,
  method: string | undefined,
  rawBody: Buffer,
  projectId: string | null,
): Buffer {
  if (!projectId || !isWriteMethod(method) || rawBody.length === 0) {
    return rawBody;
  }

  const pathsNeedingProjectId = new Set([
    "/api/v1/flows",
    "/api/v1/app-connections",
    "/api/v1/flow-runs/cancel",
  ]);
  if (!pathsNeedingProjectId.has(targetPathname)) {
    return rawBody;
  }

  try {
    const parsed = JSON.parse(rawBody.toString("utf-8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return rawBody;
    }
    if (!("projectId" in parsed) || typeof parsed.projectId !== "string" || !parsed.projectId.trim()) {
      parsed.projectId = projectId;
      return Buffer.from(JSON.stringify(parsed));
    }
  } catch {
    // Keep original body for non-JSON requests.
  }
  return rawBody;
}

async function proxyUpstream(params: {
  req: IncomingMessage;
  res: ServerResponse;
  targetUrl: string;
  extraHeaders?: Record<string, string>;
  allowCookies?: boolean;
  projectId?: string | null;
  htmlInjection?: string;
  htmlTransform?: (html: string) => string;
}): Promise<void> {
  const { req, res, extraHeaders, allowCookies = false, htmlInjection, htmlTransform } = params;
  let targetUrl = params.targetUrl;
  const body = await readBody(req);

  targetUrl = addProjectIdToTargetUrl(targetUrl, params.projectId ?? null);

  let finalBody = body;
  try {
    const pathname = new URL(targetUrl).pathname;
    finalBody = rewriteBodyWithProjectId(pathname, req.method, body, params.projectId ?? null);
  } catch {
    // ignore
  }

  const headers = buildForwardHeaders(req, {
    allowCookies,
    extra: {
      ...(extraHeaders ?? {}),
      ...(finalBody.length > 0 ? { "content-length": String(finalBody.length) } : {}),
    },
  });

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: finalBody.length > 0 ? (finalBody as unknown as BodyInit) : undefined,
      redirect: "manual",
    });
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: `Workflow engine unreachable: ${String(err)}` }));
    return;
  }

  res.statusCode = upstream.status;
  copyUpstreamHeaders(upstream, res);
  const upstreamContentType = upstream.headers.get("content-type") ?? "";
  if (upstream.body && upstreamContentType.includes("text/html")) {
    const rawHtml = await upstream.text();
    let finalHtml = htmlTransform ? htmlTransform(rawHtml) : rawHtml;
    if (htmlInjection) {
      finalHtml = injectHtmlBeforeHead(finalHtml, htmlInjection);
    }
    const buf = Buffer.from(finalHtml, "utf-8");
    res.setHeader("content-length", String(buf.length));
    res.end(buf);
    return;
  }

  if (upstream.body) {
    const supportsPipe =
      typeof (res as unknown as { write?: unknown }).write === "function" &&
      typeof (res as unknown as { on?: unknown }).on === "function";
    if (supportsPipe) {
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    } else {
      const raw = Buffer.from(await upstream.arrayBuffer());
      res.end(raw);
    }
  } else {
    res.end();
  }
}

function injectHtmlBeforeHead(html: string, snippet: string): string {
  const marker = "</head>";
  const idx = html.lastIndexOf(marker);
  if (idx < 0) {
    return `${snippet}${html}`;
  }
  return `${html.slice(0, idx)}${snippet}${html.slice(idx)}`;
}

function rewriteOpsUiHtmlForProxy(html: string): string {
  let rewritten = html;
  const baseTagRegex = /<base\s+href=(["'])\/\1\s*\/?>/i;
  if (baseTagRegex.test(rewritten)) {
    rewritten = rewritten.replace(baseTagRegex, '<base href="/ops-ui/" />');
  } else {
    rewritten = injectHtmlBeforeHead(rewritten, '<base href="/ops-ui/" />');
  }

  // Rewrite root-relative UI assets/routes to stay under /ops-ui while leaving API/webhook paths untouched.
  rewritten = rewritten.replace(
    /(src|href)=("|')\/(?!\/|api\/v1|api\/ops|ops-ui\/|webhook(?:-test|-waiting)?\/)([^"']+)/gi,
    (_match, attr: string, quote: string, value: string) => `${attr}=${quote}/ops-ui/${value}`,
  );

  return rewritten;
}

type ActivepiecesLoginResult = {
  cookies: string[];
  token: string | null;
  projectId: string | null;
};

async function attemptActivepiecesLogin(
  baseUrl: string,
  credentials: { email: string; password: string },
): Promise<ActivepiecesLoginResult | null> {
  const endpoints = [
    "/api/v1/authentication/sign-in",
    "/api/v1/users/sign-in",
    "/api/v1/users/login",
  ];

  const payloads = [
    { email: credentials.email, password: credentials.password },
    { emailOrLdapLoginId: credentials.email, password: credentials.password },
  ];

  for (const endpoint of endpoints) {
    for (const payload of payloads) {
      try {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload),
          redirect: "manual",
        });
        const cookies = extractSetCookies(response.headers);
        if (cookies.length > 0) {
          return { cookies, token: null, projectId: null };
        }
        if (response.ok) {
          const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
          const token =
            payload && typeof payload.token === "string" && payload.token.trim()
              ? payload.token
              : null;
          const projectId =
            payload && (typeof payload.projectId === "string" || typeof payload.projectId === "number")
              ? String(payload.projectId)
              : null;
          return { cookies: [], token, projectId };
        }
      } catch {
        // best effort
      }
    }
  }

  return null;
}

function appendSetCookies(res: ServerResponse, cookies: string[]): void {
  if (cookies.length === 0) {
    return;
  }
  const existing = res.getHeader("set-cookie");
  const merged = [
    ...(Array.isArray(existing)
      ? existing.map((value) => String(value))
      : existing
        ? [String(existing)]
        : []),
    ...cookies,
  ];
  res.setHeader("set-cookie", merged);
}

async function attemptAutoLoginForOpsUi(
  req: IncomingMessage,
  res: ServerResponse,
  context: OpsContext,
): Promise<string | null> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!(url.pathname === "/ops-ui" || url.pathname.startsWith("/ops-ui/"))) {
    return null;
  }
  if ((req.method ?? "GET").toUpperCase() !== "GET") {
    return null;
  }

  let token: string | null = null;
  let projectId = context.projectId ?? "";

  if (context.user) {
    const login = await attemptActivepiecesLogin(context.baseUrl, context.user);
    if (login) {
      if (login.cookies.length > 0) {
        appendSetCookies(res, login.cookies);
      }
      token = login.token;
      projectId = login.projectId ?? projectId;
    }
  }

  // Fallback: if we have a workspace-scoped API key, bootstrap it directly.
  // Never expose global fallback keys to the browser.
  if (!token && context.apiKey && context.apiKeyScope === "workspace") {
    token = context.apiKey;
  }
  if (!token) {
    return null;
  }

  const tokenLiteral = JSON.stringify(token);
  const projectLiteral = JSON.stringify(projectId);
  return `<script id=\"openclaw-ap-bootstrap\">(function(){try{var t=${tokenLiteral};var p=${projectLiteral};if(t){localStorage.setItem('token',t);sessionStorage.setItem('token',t);}if(p){localStorage.setItem('projectId',p);sessionStorage.setItem('projectId',p);}}catch(_e){}})();</script>`;
}

function mapLegacyOpsUiPath(pathname: string): string {
  const subPath = pathname.slice("/ops-ui".length) || "/";
  if (subPath === "/workflow" || subPath.startsWith("/workflow/")) {
    return `/flows${subPath.slice("/workflow".length)}`;
  }
  if (subPath === "/workflows" || subPath.startsWith("/workflows/")) {
    return `/flows${subPath.slice("/workflows".length)}`;
  }
  if (subPath === "/credentials" || subPath.startsWith("/credentials/")) {
    return `/connections${subPath.slice("/credentials".length)}`;
  }
  return subPath;
}

function mapLegacyOpsApiPath(apiPath: string): string {
  if (!apiPath || apiPath === "/") {
    return "/flows";
  }
  if (apiPath === "/workflows" || apiPath.startsWith("/workflows/")) {
    return `/flows${apiPath.slice("/workflows".length)}`;
  }
  if (apiPath === "/executions" || apiPath.startsWith("/executions/")) {
    return `/flow-runs${apiPath.slice("/executions".length)}`;
  }
  if (apiPath === "/credentials" || apiPath.startsWith("/credentials/")) {
    return `/app-connections${apiPath.slice("/credentials".length)}`;
  }
  if (apiPath === "/node-types" || apiPath.startsWith("/node-types/")) {
    return `/pieces${apiPath.slice("/node-types".length)}`;
  }
  return apiPath;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function parseFlowIdFromCompatPath(apiPath: string): { flowId: string; action: "activate" | "deactivate" } | null {
  const match = apiPath.match(/^\/workflows\/([^/]+)\/(activate|deactivate)$/i);
  if (!match) {
    return null;
  }
  return {
    flowId: decodeURIComponent(match[1]),
    action: match[2].toLowerCase() === "activate" ? "activate" : "deactivate",
  };
}

function parseFlowExecuteFromCompatPath(apiPath: string): string | null {
  const match = apiPath.match(/^\/workflows\/([^/]+)\/execute\/?$/i);
  if (!match) {
    return null;
  }
  return decodeURIComponent(match[1]);
}

async function handleCompatFlowStatusChange(params: {
  req: IncomingMessage;
  res: ServerResponse;
  context: OpsContext;
  flowId: string;
  action: "activate" | "deactivate";
}): Promise<void> {
  const { req, res, context, flowId, action } = params;
  if (!context.apiKey) {
    sendJson(res, 503, {
      ok: false,
      error: "Workflow engine API key is not configured for this workspace.",
    });
    return;
  }

  const targetUrl = `${context.baseUrl}/api/v1/flows/${encodeURIComponent(flowId)}`;
  const status = action === "activate" ? "ENABLED" : "DISABLED";
  const headers = buildForwardHeaders(req, {
    allowCookies: true,
    extra: {
      authorization: `Bearer ${context.apiKey}`,
      accept: "application/json",
      "content-type": "application/json",
    },
  });

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "CHANGE_STATUS",
        request: { status },
      }),
    });
  } catch (err) {
    sendJson(res, 502, {
      ok: false,
      error: `Workflow engine unreachable: ${String(err)}`,
    });
    return;
  }

  res.statusCode = upstream.status;
  copyUpstreamHeaders(upstream, res);
  if (upstream.body) {
    const supportsPipe =
      typeof (res as unknown as { write?: unknown }).write === "function" &&
      typeof (res as unknown as { on?: unknown }).on === "function";
    if (supportsPipe) {
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    } else {
      const raw = Buffer.from(await upstream.arrayBuffer());
      res.end(raw);
    }
  } else {
    res.end();
  }
}

async function handleCompatFlowExecute(params: {
  req: IncomingMessage;
  res: ServerResponse;
  context: OpsContext;
  flowId: string;
  search: string;
}): Promise<void> {
  const { req, res, context, flowId, search } = params;
  const body = await readBody(req);
  const headers = buildForwardHeaders(req, {
    allowCookies: true,
    extra: {
      ...(context.apiKey ? { authorization: `Bearer ${context.apiKey}` } : {}),
      accept: "application/json",
      ...(body.length > 0 ? { "content-length": String(body.length) } : {}),
    },
  });

  const encodedFlowId = encodeURIComponent(flowId);
  const targetCandidates = [
    `${context.baseUrl}/api/v1/webhooks/${encodedFlowId}/sync${search}`,
    `${context.baseUrl}/api/v1/webhooks/${encodedFlowId}${search}`,
  ];

  let upstream: Response | null = null;
  let lastError: unknown = null;
  for (let index = 0; index < targetCandidates.length; index += 1) {
    const targetUrl = targetCandidates[index];
    try {
      upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: body.length > 0 ? (body as unknown as BodyInit) : undefined,
        redirect: "manual",
      });
      // Older Activepieces builds may not support /sync, so fall back once.
      if (index === 0 && [404, 405, 501].includes(upstream.status)) {
        upstream = null;
        continue;
      }
      break;
    } catch (err) {
      lastError = err;
      upstream = null;
    }
  }

  if (!upstream) {
    sendJson(res, 502, {
      ok: false,
      error: `Workflow engine unreachable: ${String(lastError ?? "execute endpoint unavailable")}`,
    });
    return;
  }

  res.statusCode = upstream.status;
  copyUpstreamHeaders(upstream, res);
  if (upstream.body) {
    const supportsPipe =
      typeof (res as unknown as { write?: unknown }).write === "function" &&
      typeof (res as unknown as { on?: unknown }).on === "function";
    if (supportsPipe) {
      Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    } else {
      const raw = Buffer.from(await upstream.arrayBuffer());
      res.end(raw);
    }
  } else {
    res.end();
  }
}

function serveLocalOpsUiFallback(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return true;
  }

  const subPath = pathname.slice("/ops-ui".length) || "/";
  const normalized = path.posix.normalize(subPath);
  if (normalized.includes("..") || normalized.includes("\0")) {
    res.statusCode = 400;
    res.end("Bad Request");
    return true;
  }

  const candidates = [
    path.join(OPS_UI_DIST, normalized),
    path.join(OPS_UI_DIST, normalized, "index.html"),
    path.join(OPS_UI_DIST, "index.html"),
  ];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
        continue;
      }
      const ext = path.extname(candidate).toLowerCase();
      const contentType = OPS_UI_CONTENT_TYPES[ext] ?? "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Cache-Control",
        ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      );
      if (req.method === "HEAD") {
        res.statusCode = 200;
        res.end();
      } else {
        res.statusCode = 200;
        res.end(fs.readFileSync(candidate));
      }
      return true;
    } catch {
      // try next candidate
    }
  }

  res.statusCode = 503;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    "<!DOCTYPE html><html><body style=\"font-family:sans-serif;padding:2rem\">" +
      "<h2>Workflow editor unavailable</h2>" +
      "<p>Configure <code>pmos.connectors.ops.url</code> and workspace API keys for Activepieces.</p>" +
      "</body></html>",
  );
  return true;
}

/**
 * Legacy compatibility helper retained for callers importing this symbol.
 * Now resolves a local Activepieces (or legacy n8n) URL when explicitly configured.
 */
export function readLocalN8nConfig(): { url: string; host: string; port: number } | null {
  const cfg = loadConfig() as unknown;
  const pmos = (cfg as Record<string, unknown>)?.pmos as Record<string, unknown> | undefined;
  const n8n = pmos?.n8n as Record<string, unknown> | undefined;
  const rawUrl =
    normalizeBaseUrl(
      (typeof n8n?.localUrl === "string" ? n8n.localUrl : null) ??
        process.env.ACTIVEPIECES_LOCAL_URL ??
        process.env.N8N_LOCAL_URL ??
        null,
    ) ?? null;
  if (!rawUrl) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl);
    const port = parsed.port
      ? Number.parseInt(parsed.port, 10)
      : parsed.protocol === "https:"
        ? 443
        : 80;
    return {
      url: parsed.origin,
      host: parsed.hostname,
      port,
    };
  } catch {
    return null;
  }
}

/**
 * Handles local PMOS editor routes.
 *
 * Activepieces mode:
 * - /ops-ui/* is proxied to flow.wickedlab.io (or configured ops.url)
 * - legacy /rest/login returns PMOS auth identity for compatibility checks
 */
export async function handleLocalN8nRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  const isOpsUi = pathname === "/ops-ui" || pathname.startsWith("/ops-ui/");
  const isLegacyRestLogin = pathname === "/rest/login";

  if (!isOpsUi && !isLegacyRestLogin) {
    return false;
  }

  if (isLegacyRestLogin) {
    const session = (await resolvePmosSessionFromRequest(req)) as OpsSession;
    if (!session.ok || !session.user) {
      sendJson(res, 401, { ok: false, error: "Authentication required." });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      data: {
        email: session.user.email ?? null,
        id: session.user.id ?? null,
        role: session.user.role ?? null,
      },
    });
    return true;
  }

  const context = await resolveOpsContext(req, { requireSession: true });
  if (!context) {
    sendJson(res, 401, { ok: false, error: "Authentication required." });
    return true;
  }

  const htmlInjection = await attemptAutoLoginForOpsUi(req, res, context);

  const targetPath = mapLegacyOpsUiPath(pathname);
  const targetUrl = `${context.baseUrl}${targetPath}${url.search}`;
  const authHeaders: Record<string, string> = {};
  if (context.apiKey) {
    authHeaders.authorization = `Bearer ${context.apiKey}`;
  }

  await proxyUpstream({
    req,
    res,
    targetUrl,
    allowCookies: true,
    extraHeaders: authHeaders,
    projectId: context.projectId,
    htmlTransform: rewriteOpsUiHtmlForProxy,
    htmlInjection: htmlInjection ?? undefined,
  });

  if (res.writableEnded) {
    return true;
  }

  // Emergency fallback when upstream is down and a local bundle exists.
  return serveLocalOpsUiFallback(req, res, pathname);
}

/**
 * Activepieces currently does not require a dedicated gateway websocket bridge.
 * Keep this exported symbol for compatibility with server-http.ts.
 */
export async function tunnelN8nWebSocket(
  _req: IncomingMessage,
  _socket: Duplex,
  _head: Buffer,
): Promise<boolean> {
  return false;
}

/**
 * Handles:
 * - /api/ops/*   (legacy PMOS compatibility API -> Activepieces API)
 * - /api/v1/*    (Activepieces UI/API passthrough for embedded /ops-ui iframe)
 * - /webhook/*   (compat webhook passthrough)
 */
export async function handleOpsProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  // Activepieces API passthrough for embedded UI traffic.
  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    const context = await resolveOpsContext(req, { requireSession: true });
    if (!context) {
      sendJson(res, 401, { ok: false, error: "Authentication required." });
      return true;
    }

    const needsAuthHeader = !isAuthApiPath(pathname);
    const extraHeaders: Record<string, string> = {};
    if (needsAuthHeader && context.apiKey) {
      extraHeaders.authorization = `Bearer ${context.apiKey}`;
    }

    await proxyUpstream({
      req,
      res,
      targetUrl: `${context.baseUrl}${pathname}${url.search}`,
      allowCookies: true,
      extraHeaders,
      projectId: context.projectId,
    });
    return true;
  }

  // Legacy webhook compatibility: /webhook/:flowId -> /api/v1/webhooks/:flowId
  const webhookMatch = pathname.match(/^\/(webhook|webhook-test|webhook-waiting)\/(.+)$/);
  if (webhookMatch) {
    const context = await resolveOpsContext(req, { requireSession: false });
    if (!context) {
      sendJson(res, 503, {
        ok: false,
        error: "Workflow engine URL is not configured.",
      });
      return true;
    }

    const flowSegment = webhookMatch[2];
    const targetUrl = `${context.baseUrl}/api/v1/webhooks/${flowSegment}${url.search}`;
    await proxyUpstream({
      req,
      res,
      targetUrl,
      allowCookies: true,
    });
    return true;
  }

  // PMOS legacy compatibility API surface.
  if (pathname === "/api/ops" || pathname.startsWith("/api/ops/")) {
    const context = await resolveOpsContext(req, { requireSession: true });
    if (!context) {
      sendJson(res, 401, { ok: false, error: "Authentication required." });
      return true;
    }

    const apiPath = pathname.slice("/api/ops".length) || "/";

    const statusChange = parseFlowIdFromCompatPath(apiPath);
    if (statusChange && (req.method ?? "GET").toUpperCase() === "POST") {
      await handleCompatFlowStatusChange({
        req,
        res,
        context,
        flowId: statusChange.flowId,
        action: statusChange.action,
      });
      return true;
    }

    const executeFlowId = parseFlowExecuteFromCompatPath(apiPath);
    if (executeFlowId) {
      if ((req.method ?? "GET").toUpperCase() !== "POST") {
        sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
      } else {
        await handleCompatFlowExecute({
          req,
          res,
          context,
          flowId: executeFlowId,
          search: url.search,
        });
      }
      return true;
    }

    const mapped = mapLegacyOpsApiPath(apiPath);
    const targetPath = `/api/v1${mapped}`;

    const extraHeaders: Record<string, string> = {};
    if (context.apiKey) {
      extraHeaders.authorization = `Bearer ${context.apiKey}`;
    }

    await proxyUpstream({
      req,
      res,
      targetUrl: `${context.baseUrl}${targetPath}${url.search}`,
      allowCookies: true,
      extraHeaders,
      projectId: context.projectId,
    });
    return true;
  }

  return false;
}
