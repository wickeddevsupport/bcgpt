import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  adminResetPmosUserPassword,
  buildPmosClearSessionCookieValue,
  buildPmosSessionCookieValue,
  changePmosUserPassword,
  extractPmosSessionTokenFromRequest,
  loginPmosUser,
  resolvePmosSessionFromRequest,
  revokePmosSessionByToken,
  signupPmosUser,
} from "./pmos-auth.js";
import { readJsonBody } from "./hooks.js";
import { resolveStateDir } from "../config/paths.js";

const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_STARTER_AGENT_ID = "assistant";
const DEFAULT_STARTER_AGENT_NAME = "Workspace Assistant";
const DEFAULT_STARTER_AGENT_WORKSPACE_BASE = "~/.openclaw/workspaces";
const DEFAULT_STARTER_OLLAMA_MODEL_ID = "qwen3:1.7b";
const DEFAULT_SHARED_MODEL_REF = "kilo/auto-free";
const SHARED_PROVIDER_PREFER = new Set(["kilo", "local-ollama", "ollama", "nvidia"]);
const SHARED_PROVIDER_PRIORITY = ["kilo", "local-ollama", "ollama", "nvidia"] as const;
const DEFAULT_KILO_FREE_MODEL_REF = "kilo/auto-free";
const DEFAULT_SHARED_THINKING_LEVEL = "low";
const DEFAULT_SHARED_REASONING_LEVEL = "stream";
const DEFAULT_SHARED_VERBOSE_LEVEL = "full";
const UNSUPPORTED_STARTER_MODEL_REFS = new Set<string>();
const requireModule = createRequire(import.meta.url);
const DEPRECATED_MODEL_REF_REPLACEMENTS: Record<string, string> = {
  "nvidia/moonshotai/kimi-k2.5": DEFAULT_SHARED_MODEL_REF,
  "moonshot/moonshotai/kimi-k2.5": DEFAULT_SHARED_MODEL_REF,
  "kilo/z-ai/glm-5:free": DEFAULT_SHARED_MODEL_REF,
  "kilo/glm-5:free": DEFAULT_SHARED_MODEL_REF,
  "kilo/z-ai/glm-5": DEFAULT_SHARED_MODEL_REF,
  "kilo/glm-5": DEFAULT_SHARED_MODEL_REF,
};

function readEnvValue(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function readTextFileIfExists(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const value = readFileSync(filePath, "utf-8").trim();
    return value || null;
  } catch {
    return null;
  }
}

function isTruthyText(value: string | null | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function tryRequireModule(moduleId: string): unknown | null {
  try {
    return requireModule(moduleId) as unknown;
  } catch {
    return null;
  }
}

type ActivepiecesDatabaseConnectionConfig = {
  connectionString: string;
  connectionTimeoutMillis: number;
  query_timeout: number;
  statement_timeout: number;
  ssl?: { rejectUnauthorized: boolean };
};

type ActivepiecesDatabaseHostConfig = {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  connectionTimeoutMillis: number;
  query_timeout: number;
  statement_timeout: number;
  ssl?: { rejectUnauthorized: boolean };
};

type ActivepiecesDatabaseConfig =
  | ActivepiecesDatabaseConnectionConfig
  | ActivepiecesDatabaseHostConfig;

function createActivepiecesDbTimingConfig() {
  return {
    connectionTimeoutMillis: 4_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
  } as const;
}

function readActivepiecesDbPort(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 5432;
}

function readActivepiecesDatabaseConfigFromFile(
  sslConfig?: { rejectUnauthorized: boolean },
): ActivepiecesDatabaseConfig | null {
  const explicitPath = readEnvValue([
    "ACTIVEPIECES_DB_CONFIG_FILE",
    "PMOS_ACTIVEPIECES_DB_CONFIG_FILE",
  ]);
  const defaultPath = path.join(resolveStateDir(process.env), "activepieces-db.json");
  const configPath = explicitPath ?? defaultPath;
  if (!configPath || !existsSync(configPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const connectionStringCandidate =
      (typeof parsed.connectionString === "string" ? parsed.connectionString.trim() : "") ||
      (typeof parsed.databaseUrl === "string" ? parsed.databaseUrl.trim() : "") ||
      (typeof parsed.url === "string" ? parsed.url.trim() : "");
    const timingConfig = createActivepiecesDbTimingConfig();
    if (connectionStringCandidate) {
      return {
        connectionString: connectionStringCandidate,
        ...timingConfig,
        ...(sslConfig ? { ssl: sslConfig } : {}),
      };
    }

    const host =
      (typeof parsed.host === "string" ? parsed.host.trim() : "") ||
      (typeof parsed.hostname === "string" ? parsed.hostname.trim() : "");
    const user =
      (typeof parsed.user === "string" ? parsed.user.trim() : "") ||
      (typeof parsed.username === "string" ? parsed.username.trim() : "");
    const database =
      (typeof parsed.database === "string" ? parsed.database.trim() : "") ||
      (typeof parsed.dbName === "string" ? parsed.dbName.trim() : "") ||
      (typeof parsed.name === "string" ? parsed.name.trim() : "");
    if (!host || !user || !database) {
      return null;
    }
    const password = typeof parsed.password === "string" ? parsed.password : undefined;
    return {
      host,
      port: readActivepiecesDbPort(parsed.port),
      user,
      password,
      database,
      ...timingConfig,
      ...(sslConfig ? { ssl: sslConfig } : {}),
    };
  } catch {
    return null;
  }
}

function resolveActivepiecesDatabaseConfig(): ActivepiecesDatabaseConfig | null {
  const sslEnabled = isTruthyText(
    readEnvValue([
      "ACTIVEPIECES_POSTGRES_SSL",
      "ACTIVEPIECES_DB_SSL",
      "AP_POSTGRES_SSL",
    ]),
  );
  const sslConfig = sslEnabled ? { rejectUnauthorized: false } : undefined;
  const timingConfig = createActivepiecesDbTimingConfig();

  const connectionString = readEnvValue([
    "ACTIVEPIECES_DATABASE_URL",
    "ACTIVEPIECES_DB_URL",
    "FLOW_DATABASE_URL",
    "AP_POSTGRES_URL",
  ]);
  if (connectionString) {
    return {
      connectionString,
      ...timingConfig,
      ...(sslConfig ? { ssl: sslConfig } : {}),
    };
  }

  const host = readEnvValue([
    "ACTIVEPIECES_POSTGRES_HOST",
    "ACTIVEPIECES_DB_HOST",
    "AP_POSTGRES_HOST",
    "PGHOST",
  ]);
  const user = readEnvValue([
    "ACTIVEPIECES_POSTGRES_USERNAME",
    "ACTIVEPIECES_DB_USER",
    "AP_POSTGRES_USERNAME",
    "PGUSER",
  ]);
  const database = readEnvValue([
    "ACTIVEPIECES_POSTGRES_DATABASE",
    "ACTIVEPIECES_DB_NAME",
    "AP_POSTGRES_DATABASE",
    "PGDATABASE",
  ]);
  if (!host || !user || !database) {
    return readActivepiecesDatabaseConfigFromFile(sslConfig);
  }
  const port = readActivepiecesDbPort(
    readEnvValue([
      "ACTIVEPIECES_POSTGRES_PORT",
      "ACTIVEPIECES_DB_PORT",
      "AP_POSTGRES_PORT",
      "PGPORT",
    ]),
  );
  const password =
    readEnvValue([
      "ACTIVEPIECES_POSTGRES_PASSWORD",
      "ACTIVEPIECES_DB_PASSWORD",
      "AP_POSTGRES_PASSWORD",
      "PGPASSWORD",
    ]) ?? undefined;
  return {
    host,
    port,
    user,
    password,
    database,
    ...timingConfig,
    ...(sslConfig ? { ssl: sslConfig } : {}),
  };
}

function resolveActivepiecesSyncToken(): string | null {
  const tokenFromEnv = readEnvValue([
    "ACTIVEPIECES_SYNC_TOKEN",
    "PMOS_ACTIVEPIECES_SYNC_TOKEN",
    "PMOS_WORKFLOW_SYNC_TOKEN",
  ]);
  if (tokenFromEnv) {
    return tokenFromEnv;
  }
  const explicitPath = readEnvValue([
    "ACTIVEPIECES_SYNC_TOKEN_FILE",
    "PMOS_ACTIVEPIECES_SYNC_TOKEN_FILE",
  ]);
  const candidatePaths = [
    explicitPath,
    path.join(resolveStateDir(process.env), "activepieces-sync-token"),
    "/app/.openclaw/activepieces-sync-token",
    "/app/openclaw/.openclaw/activepieces-sync-token",
    "/root/.openclaw/activepieces-sync-token",
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  for (const tokenPath of candidatePaths) {
    const token = readTextFileIfExists(tokenPath);
    if (token) {
      return token;
    }
  }
  return null;
}

async function runPasswordUpdateQueriesWithHash(
  client: { query: (sql: string, values: unknown[]) => Promise<{ rowCount?: number }> },
  email: string,
  hash: string,
): Promise<number> {
  const nextTokenVersion = randomUUID();
  const queries = [
    `UPDATE user_identity
       SET password = $2,
           lastpassword = $2,
           "tokenVersion" = $3,
           updated = NOW()
     WHERE lower(trim(email)) = lower(trim($1))`,
    `UPDATE user_identity
       SET password = $2,
           lastpassword = $2,
           updated = NOW()
     WHERE lower(trim(email)) = lower(trim($1))`,
    `UPDATE user_identity
       SET password = $2,
           "tokenVersion" = $3,
           updated = NOW()
     WHERE lower(trim(email)) = lower(trim($1))`,
    `UPDATE user_identity
       SET password = $2,
           updated = NOW()
     WHERE lower(trim(email)) = lower(trim($1))`,
  ];
  for (const sql of queries) {
    try {
      const result = await client.query(sql, [email, hash, nextTokenVersion]);
      const rowCount = typeof result.rowCount === "number" ? result.rowCount : 0;
      if (rowCount > 0) {
        return rowCount;
      }
    } catch {
      // keep trying compatibility variants
    }
  }
  return 0;
}

async function runPasswordUpdateQueriesWithDatabaseHash(
  client: { query: (sql: string, values: unknown[]) => Promise<{ rowCount?: number }> },
  email: string,
  password: string,
): Promise<number> {
  const nextTokenVersion = randomUUID();
  const queries = [
    `WITH next_hash AS (
       SELECT crypt($2, gen_salt('bf', 10)) AS value
     )
     UPDATE user_identity AS ui
        SET password = next_hash.value,
            lastpassword = next_hash.value,
            "tokenVersion" = $3,
            updated = NOW()
       FROM next_hash
      WHERE lower(trim(ui.email)) = lower(trim($1))`,
    `WITH next_hash AS (
       SELECT crypt($2, gen_salt('bf', 10)) AS value
     )
     UPDATE user_identity AS ui
        SET password = next_hash.value,
            lastpassword = next_hash.value,
            updated = NOW()
       FROM next_hash
      WHERE lower(trim(ui.email)) = lower(trim($1))`,
    `WITH next_hash AS (
       SELECT crypt($2, gen_salt('bf', 10)) AS value
     )
     UPDATE user_identity AS ui
        SET password = next_hash.value,
            updated = NOW()
       FROM next_hash
      WHERE lower(trim(ui.email)) = lower(trim($1))`,
  ];
  for (const sql of queries) {
    try {
      const result = await client.query(sql, [email, password, nextTokenVersion]);
      const rowCount = typeof result.rowCount === "number" ? result.rowCount : 0;
      if (rowCount > 0) {
        return rowCount;
      }
    } catch {
      // keep trying compatibility variants
    }
  }
  return 0;
}

async function trySyncActivepiecesPasswordViaDatabase(params: {
  email: string;
  password: string;
}): Promise<boolean> {
  const config = resolveActivepiecesDatabaseConfig();
  if (!config) {
    console.warn("[pmos] activepieces password sync: database config unavailable");
    return false;
  }
  const pgModule = tryRequireModule("pg") as
    | {
        Client?: new (options: unknown) => {
          connect: () => Promise<void>;
          end: () => Promise<void>;
          query: (sql: string, values: unknown[]) => Promise<{ rowCount?: number }>;
        };
      }
    | null;
  const PgClient = pgModule?.Client;
  if (!PgClient) {
    console.warn("[pmos] activepieces password sync: 'pg' module not available");
    return false;
  }
  const client = new PgClient(config);
  try {
    await client.connect();
  } catch (err) {
    console.warn("[pmos] activepieces password sync: database connect failed:", String(err));
    return false;
  }
  try {
    const bcryptModule = tryRequireModule("bcryptjs") as
      | {
          hash?: (plain: string, rounds: number) => Promise<string>;
        }
      | null;
    if (typeof bcryptModule?.hash === "function") {
      const hashed = await bcryptModule.hash(params.password, 10);
      const updated = await runPasswordUpdateQueriesWithHash(client, params.email, hashed);
      if (updated > 0) {
        console.info("[pmos] activepieces password sync: updated with bcrypt hash");
        return true;
      }
    }
    const updatedWithDbHash = await runPasswordUpdateQueriesWithDatabaseHash(
      client,
      params.email,
      params.password,
    );
    if (updatedWithDbHash > 0) {
      console.info("[pmos] activepieces password sync: updated with database hash");
      return true;
    }
    console.warn(
      "[pmos] activepieces password sync: database update ran but no user_identity row matched",
      params.email,
    );
    return false;
  } catch (err) {
    console.warn("[pmos] activepieces password sync: database update failed:", String(err));
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

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
  if (pathname === `${rootPrefix}/change-password`) {
    return "change-password";
  }
  if (pathname === `${rootPrefix}/admin/reset-password`) {
    return "admin-reset-password";
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
    if (pathname === `${prefixed}/change-password`) {
      return "change-password";
    }
    if (pathname === `${prefixed}/admin/reset-password`) {
      return "admin-reset-password";
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

type WarmIdentityUser = {
  workspaceId: string;
  email?: string | null;
  name?: string | null;
  role?: import("./pmos-auth.js").PmosRole | null;
};

function readConfigStringPath(cfg: unknown, path: string[]): string | null {
  let current: unknown = cfg;
  for (const key of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[key];
  }
  if (typeof current !== "string") {
    return null;
  }
  const trimmed = current.trim();
  return trimmed || null;
}

function normalizeExternalOpsUrl(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return "https://flow.wickedlab.io";
  }
  const normalized = trimmed.replace(/\/+$/, "");
  if (
    /^https?:\/\/localhost(?::\d+)?$/i.test(normalized) ||
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(normalized) ||
    /:5678$/i.test(normalized)
  ) {
    return "https://flow.wickedlab.io";
  }
  return normalized;
}

async function postJsonWithTimeout(
  url: string,
  payload: unknown,
  timeoutMs = 6000,
  options?: { headers?: Record<string, string> | null },
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (options?.headers) {
      for (const [name, value] of Object.entries(options.headers)) {
        if (typeof value === "string" && value.trim()) {
          headers[name] = value;
        }
      }
    }
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function trySyncActivepiecesPasswordViaHttp(params: {
  baseUrl: string;
  email: string;
  password: string;
}): Promise<boolean> {
  const syncToken = resolveActivepiecesSyncToken();
  if (!syncToken) {
    return false;
  }
  const endpoints = ["/api/v1/authentication/sync-password", "/api/v1/authentication/password-sync"];
  for (const endpoint of endpoints) {
    const res = await postJsonWithTimeout(
      `${params.baseUrl}${endpoint}`,
      {
        email: params.email,
        password: params.password,
      },
      6_000,
      {
        headers: {
          "x-pmos-sync-token": syncToken,
        },
      },
    );
    if (!res) {
      continue;
    }
    if (res.ok) {
      try {
        const payload = (await res.json()) as unknown;
        if (
          payload &&
          typeof payload === "object" &&
          "updated" in payload &&
          (payload as { updated?: unknown }).updated === false
        ) {
          continue;
        }
      } catch {
        // best-effort response parsing
      }
      console.info("[pmos] activepieces password sync: updated via HTTP bridge");
      return true;
    }
    if (res.status === 401 || res.status === 403) {
      console.warn("[pmos] activepieces password sync: HTTP bridge token rejected");
      return false;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function splitHumanName(raw: string | null | undefined): { firstName: string; lastName: string } {
  const text = String(raw ?? "").trim();
  if (!text) {
    return { firstName: "PMOS", lastName: "User" };
  }
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "User" };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function ensureActivepiecesCredentialParity(params: {
  baseUrl: string;
  email: string;
  password: string;
  name?: string | null;
  previousPassword?: string | null;
}): Promise<void> {
  const baseUrl = normalizeExternalOpsUrl(params.baseUrl);
  const email = params.email.trim().toLowerCase();
  const password = params.password;
  const previousPassword = String(params.previousPassword ?? "").trim();
  if (!email || !password) {
    return;
  }

  const trySignIn = async (passwordToUse: string, attempts: number): Promise<boolean> => {
    if (!passwordToUse) {
      return false;
    }
    const loginEndpoints = [
      "/api/v1/authentication/sign-in",
      "/api/v1/users/sign-in",
      "/api/v1/users/login",
    ];
    const loginPayloads = [
      { email, password: passwordToUse },
      { emailOrLdapLoginId: email, password: passwordToUse },
      { username: email, password: passwordToUse },
    ];

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      for (const endpoint of loginEndpoints) {
        for (const payload of loginPayloads) {
          const res = await postJsonWithTimeout(`${baseUrl}${endpoint}`, payload);
          if (res && res.ok) {
            return true;
          }
        }
      }
      if (attempt < attempts - 1) {
        await sleep(350);
      }
    }
    return false;
  };

  if (await trySignIn(password, 1)) {
    return;
  }

  const syncedFromHttp = await trySyncActivepiecesPasswordViaHttp({
    baseUrl,
    email,
    password,
  });
  if (syncedFromHttp && (await trySignIn(password, 6))) {
    return;
  }

  const hadPreviousPassword = previousPassword && previousPassword !== password;
  const previousPasswordStillValid = hadPreviousPassword
    ? await trySignIn(previousPassword, 1)
    : false;
  if (
    !syncedFromHttp &&
    previousPasswordStillValid &&
    (await trySyncActivepiecesPasswordViaDatabase({ email, password })) &&
    (await trySignIn(password, 6))
  ) {
    return;
  }

  const { firstName, lastName } = splitHumanName(params.name);
  const signupEndpoints = [
    "/api/v1/authentication/sign-up",
    "/api/v1/users/sign-up",
    "/api/v1/users/register",
  ];
  const signupPayloads = [
    { email, password, firstName, lastName, trackEvents: false, newsLetter: false },
    { email, password, firstName, lastName },
    { email, password, name: `${firstName} ${lastName}`.trim() },
    { emailOrLdapLoginId: email, password, firstName, lastName },
  ];
  let attemptedSignUp = false;
  let sawConflict = false;
  for (const endpoint of signupEndpoints) {
    for (const payload of signupPayloads) {
      const res = await postJsonWithTimeout(`${baseUrl}${endpoint}`, payload);
      if (!res) {
        continue;
      }
      attemptedSignUp = true;
      if (res.ok) {
        if (await trySignIn(password, 6)) {
          return;
        }
        throw new Error("Activepieces sign-up succeeded but sign-in verification failed.");
      }
      if (res.status === 409) {
        sawConflict = true;
      }
    }
  }

  if ((attemptedSignUp || sawConflict) && (await trySignIn(password, 6))) {
    return;
  }

  if (
    !syncedFromHttp &&
    (sawConflict || previousPasswordStillValid) &&
    (await trySyncActivepiecesPasswordViaDatabase({ email, password })) &&
    (await trySignIn(password, 6))
  ) {
    return;
  }

  throw new Error(
    previousPasswordStillValid
      ? "Activepieces account exists with a different password and no password-sync bridge is configured."
      : attemptedSignUp || sawConflict
      ? "Unable to establish Activepieces account/session for workspace user."
      : "Activepieces sign-in and sign-up attempts failed.",
  );
}

async function syncWorkflowIdentityForWorkspace(
  user: WarmIdentityUser,
  password: string,
  options?: { previousPassword?: string | null },
): Promise<void> {
  const workspaceId = String(user.workspaceId ?? "").trim();
  const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
  if (!workspaceId || !email || !password) {
    return;
  }
  try {
    const [{ readWorkspaceConnectors, writeWorkspaceConnectors }, { loadConfig }, { ensureWorkspaceBasecampCredential }] = await Promise.all([
      import("./workspace-connectors.js"),
      import("../config/config.js"),
      import("./credential-sync.js"),
    ]);
    const cfg = loadConfig() as unknown;
    const existing = (await readWorkspaceConnectors(workspaceId)) ?? {};
    const existingOps =
      existing.ops && isRecord(existing.ops)
        ? ({ ...(existing.ops as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const existingActivepieces =
      existing.activepieces && isRecord(existing.activepieces)
        ? ({ ...(existing.activepieces as Record<string, unknown>) } as Record<string, unknown>)
        : {};

    const opsUrl = normalizeExternalOpsUrl(
      (typeof existingOps.url === "string" ? existingOps.url : null) ??
        readConfigStringPath(cfg, ["pmos", "connectors", "ops", "url"]) ??
        readConfigStringPath(cfg, ["pmos", "connectors", "activepieces", "url"]) ??
        process.env.ACTIVEPIECES_URL ??
        process.env.FLOW_URL ??
        process.env.OPS_URL ??
        null,
    );

    const next = {
      ...existing,
      ops: {
        ...existingOps,
        url: opsUrl,
        user: { email, password },
      },
      activepieces: {
        ...existingActivepieces,
        url:
          typeof existingActivepieces.url === "string" && existingActivepieces.url.trim()
            ? existingActivepieces.url
            : opsUrl,
        user: { email, password },
      },
    };
    await writeWorkspaceConnectors(workspaceId, next);

    await withTimeout(
      ensureActivepiecesCredentialParity({
        baseUrl: opsUrl,
        email,
        password,
        name: typeof user.name === "string" ? user.name : null,
        previousPassword:
          typeof options?.previousPassword === "string" ? options.previousPassword : null,
      }),
      12_000,
      "Activepieces parity timed out.",
    );
    await withTimeout(
      ensureWorkspaceBasecampCredential(workspaceId).catch(() => undefined),
      8_000,
      "Basecamp credential ensure timed out.",
    );
  } catch (err) {
    console.warn("[pmos] workflow identity sync failed:", String(err));
  }
}

async function ensureWorkspaceOpsProjectProvisioned(user: WarmIdentityUser): Promise<void> {
  const workspaceId = String(user.workspaceId ?? "").trim();
  if (!workspaceId) {
    return;
  }
  try {
    const [{ readWorkspaceConnectors }, { provisionWorkspaceOps }] = await Promise.all([
      import("./workspace-connectors.js"),
      import("./pmos-provision-ops.js"),
    ]);
    const connectors = await readWorkspaceConnectors(workspaceId).catch(() => null);
    const existingProjectId =
      typeof connectors?.ops?.projectId === "string" ? connectors.ops.projectId.trim() : "";
    if (existingProjectId) {
      return;
    }
    await provisionWorkspaceOps(
      workspaceId,
      typeof user.name === "string" && user.name.trim()
        ? `${user.name.trim()} Workspace`
        : undefined,
    );
  } catch (err) {
    console.warn("[pmos] workflow project auto-provision failed:", String(err));
  }
}

async function warmEmbeddedN8nIdentity(user: WarmIdentityUser, preferredPassword?: string): Promise<void> {
  try {
    const [{ isLegacyEmbeddedN8nEnabled }, { readLocalN8nConfig }, { getOrCreateWorkspaceN8nCookie }] =
      await Promise.all([
        import("./n8n-embed.js"),
      import("./pmos-ops-proxy.js"),
      import("./n8n-auth-bridge.js"),
      ]);
    if (!isLegacyEmbeddedN8nEnabled()) return;

    const localN8n = readLocalN8nConfig();
    if (!localN8n) return;

    await getOrCreateWorkspaceN8nCookie({
      workspaceId: user.workspaceId,
      n8nBaseUrl: localN8n.url,
      pmosUser: {
        email: typeof user.email === "string" ? user.email : "",
        name: typeof user.name === "string" ? user.name : "",
        role: user.role ?? "member",
      },
      preferredPassword: typeof preferredPassword === "string" && preferredPassword ? preferredPassword : null,
    });
  } catch (err) {
    console.warn("[pmos] embedded n8n identity warm-up failed:", String(err));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur)) {
      return undefined;
    }
    cur = cur[key];
  }
  return cur;
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqualJson(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqualJson(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function cloneJsonObject<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonObject(item)) as T;
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = cloneJsonObject(item);
    }
    return out as T;
  }
  return value;
}

function deletePathPruneEmpty(root: Record<string, unknown>, path: string[]): boolean {
  if (path.length === 0) return false;
  const nodes: Record<string, unknown>[] = [root];
  let cur: unknown = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (!isRecord(cur)) return false;
    const next = cur[path[i]];
    if (!isRecord(next)) return false;
    nodes.push(next);
    cur = next;
  }
  if (!isRecord(cur)) return false;
  const lastKey = path[path.length - 1];
  if (!Object.prototype.hasOwnProperty.call(cur, lastKey)) {
    return false;
  }
  delete cur[lastKey];

  for (let i = path.length - 2; i >= 0; i -= 1) {
    const parent = nodes[i];
    const key = path[i];
    const child = parent[key];
    if (!isRecord(child)) break;
    if (Object.keys(child).length > 0) break;
    delete parent[key];
  }
  return true;
}

function pruneMapEntriesMatchingGlobal(
  workspaceCfg: Record<string, unknown>,
  globalCfg: unknown,
  path: string[],
): boolean {
  const workspaceMap = getPath(workspaceCfg, path);
  if (!isRecord(workspaceMap)) return false;
  const globalMap = getPath(globalCfg, path);
  let changed = false;
  for (const key of Object.keys(workspaceMap)) {
    const workspaceValue = workspaceMap[key];
    const globalValue = isRecord(globalMap) ? globalMap[key] : undefined;
    if (globalValue !== undefined && deepEqualJson(workspaceValue, globalValue)) {
      delete workspaceMap[key];
      changed = true;
    }
  }
  if (changed && Object.keys(workspaceMap).length === 0) {
    deletePathPruneEmpty(workspaceCfg, path);
  }
  return changed;
}

function pruneValueMatchingGlobal(
  workspaceCfg: Record<string, unknown>,
  globalCfg: unknown,
  path: string[],
): boolean {
  const workspaceValue = getPath(workspaceCfg, path);
  if (workspaceValue === undefined) return false;
  const globalValue = getPath(globalCfg, path);
  if (globalValue === undefined) return false;
  if (!deepEqualJson(workspaceValue, globalValue)) return false;
  return deletePathPruneEmpty(workspaceCfg, path);
}

function scrubLegacyWorkspaceOverlayCopies(
  workspaceCfg: Record<string, unknown>,
  globalCfg: unknown,
): { cleaned: Record<string, unknown>; changed: boolean } {
  const cleaned = cloneJsonObject(workspaceCfg);
  let changed = false;

  // Shared local providers are platform-managed; workspace overlays should never
  // persist per-user apiKey values here (accidental browser autofill can end up
  // writing passwords into this field).
  changed =
    deletePathPruneEmpty(cleaned, ["models", "providers", "local-ollama", "apiKey"]) || changed;
  changed = deletePathPruneEmpty(cleaned, ["models", "providers", "ollama", "apiKey"]) || changed;

  changed = pruneMapEntriesMatchingGlobal(cleaned, globalCfg, ["models", "providers"]) || changed;
  changed = pruneMapEntriesMatchingGlobal(cleaned, globalCfg, ["pmos", "connectors"]) || changed;
  changed = pruneMapEntriesMatchingGlobal(cleaned, globalCfg, ["agents", "defaults", "models"]) || changed;
  changed = pruneValueMatchingGlobal(cleaned, globalCfg, ["agents", "defaults", "model"]) || changed;

  return { cleaned, changed };
}

function slugifyAgentId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return normalized || DEFAULT_STARTER_AGENT_ID;
}

function resolveWorkspaceAgentSessionStorePath(workspaceId: string, agentId: string): string {
  const stateDir = resolveStateDir(process.env);
  return path.join(
    stateDir,
    "workspaces",
    workspaceId.trim(),
    "agents",
    slugifyAgentId(agentId),
    "sessions",
    "sessions.json",
  );
}

function resolveWorkspaceAgentWorkspacePath(workspaceId: string, agentId: string): string {
  return path.join(
    resolveStateDir(process.env),
    "workspaces",
    workspaceId.trim(),
    slugifyAgentId(agentId),
  );
}

function resolveWorkspaceAgentStatePath(workspaceId: string, agentId: string): string {
  return path.join(
    resolveStateDir(process.env),
    "workspaces",
    workspaceId.trim(),
    "agents",
    slugifyAgentId(agentId),
  );
}

function resolveWorkspaceSessionStoreTemplate(workspaceId: string): string {
  const trimmed = String(workspaceId || "").trim();
  if (!trimmed) {
    return "";
  }
  return `${DEFAULT_STARTER_AGENT_WORKSPACE_BASE}/${trimmed}/agents/{agentId}/sessions/sessions.json`;
}

function resolveWorkspaceMemoryStoreTemplate(workspaceId: string): string {
  const trimmed = String(workspaceId || "").trim();
  if (!trimmed) {
    return "";
  }
  return `${DEFAULT_STARTER_AGENT_WORKSPACE_BASE}/${trimmed}/agents/{agentId}/memory/index.sqlite`;
}

function looksLikeLegacyStarterWorkspacePackage(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    const main = typeof parsed.main === "string" ? parsed.main.trim() : "";
    const testScript =
      typeof parsed.scripts === "object" &&
      parsed.scripts !== null &&
      !Array.isArray(parsed.scripts) &&
      typeof (parsed.scripts as Record<string, unknown>).test === "string"
        ? String((parsed.scripts as Record<string, unknown>).test)
        : "";
    return (
      name === DEFAULT_STARTER_AGENT_ID &&
      main === "test_duckduckgo.js" &&
      /no test specified/i.test(testScript)
    );
  } catch {
    return false;
  }
}

async function sanitizeLegacyStarterWorkspaceScaffold(workspaceDir: string): Promise<boolean> {
  const packagePath = path.join(workspaceDir, "package.json");
  let packageRaw = "";
  try {
    packageRaw = await fs.readFile(packagePath, "utf-8");
  } catch {
    return false;
  }
  if (!looksLikeLegacyStarterWorkspacePackage(packageRaw)) {
    return false;
  }

  const junkPaths = [
    ".git",
    "package.json",
    "openclaw.json",
    "simple_test.js",
    "common_query_test.js",
    "tasks.js",
    "view_tasks.js",
    "web_search.js",
    "test_duckduckgo.js",
    "test_wikipedia_fallback.js",
    "test_skills.js",
    "test_tasks_only.js",
    "data",
    path.join("skills", "README.md"),
    path.join("skills", "_template.md"),
    path.join("skills", "tasks.md"),
    path.join("skills", "web_search.md"),
  ];

  await Promise.all(
    junkPaths.map(async (entry) =>
      fs.rm(path.join(workspaceDir, entry), { recursive: true, force: true }).catch(() => undefined),
    ),
  );

  try {
    const remainingSkills = await fs.readdir(path.join(workspaceDir, "skills"));
    if (remainingSkills.length === 0) {
      await fs.rm(path.join(workspaceDir, "skills"), { recursive: true, force: true });
    }
  } catch {
    // ignore
  }

  return true;
}

async function resetStarterWorkspaceArtifacts(workspaceId: string, agentId: string): Promise<void> {
  const workspacePath = resolveWorkspaceAgentWorkspacePath(workspaceId, agentId);
  const statePath = resolveWorkspaceAgentStatePath(workspaceId, agentId);
  await Promise.all([
    fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined),
    fs.rm(statePath, { recursive: true, force: true }).catch(() => undefined),
  ]);
}

function hasOllamaEnvConfigured(): boolean {
  const key = (process.env.OLLAMA_API_KEY ?? process.env.OPENCLAW_OLLAMA_API_KEY ?? "").trim();
  return key.length > 0;
}

function resolveStarterOllamaModelId(): string {
  const configured =
    (
      process.env.PMOS_DEFAULT_OLLAMA_MODEL ??
      process.env.OPENCLAW_PMOS_DEFAULT_OLLAMA_MODEL ??
      ""
    )
      .trim();
  return configured || DEFAULT_STARTER_OLLAMA_MODEL_ID;
}

function resolveDeprecatedModelRefReplacement(modelRef: string): string | null {
  const normalized = modelRef.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return DEPRECATED_MODEL_REF_REPLACEMENTS[normalized] ?? null;
}

function resolveModelAlias(modelRef: string): string {
  const normalized = modelRef.trim().toLowerCase();
  if (normalized.startsWith("ollama/") || normalized.startsWith("local-ollama/")) {
    return "Shared Ollama";
  }
  if (normalized.startsWith("kilo/")) {
    return "Kilo Free";
  }
  return "Workspace Default";
}

function normalizeModelRef(modelRef: string): string {
  return modelRef.trim().toLowerCase();
}

function resolvePreferredSharedProviderModelRef(
  providerName: string,
  providerRaw: unknown,
): string | null {
  const provider = providerName.trim().toLowerCase();
  if (!provider || !isRecord(providerRaw)) {
    return null;
  }
  const rawModels = providerRaw.models;
  if (!Array.isArray(rawModels) || rawModels.length === 0) {
    return null;
  }

  const refs: string[] = [];
  for (const modelRaw of rawModels) {
    if (!isRecord(modelRaw)) {
      continue;
    }
    const id = typeof modelRaw.id === "string" ? modelRaw.id.trim() : "";
    if (!id) {
      continue;
    }
    const ref = `${provider}/${id}`;
    refs.push(resolveDeprecatedModelRefReplacement(ref) ?? ref);
  }
  if (refs.length === 0) {
    return null;
  }

  const normalizedRefs = refs.map((ref) => normalizeModelRef(ref));
  if (provider === "kilo") {
    const explicitKiloStarterIndex = normalizedRefs.findIndex(
      (ref) => ref === DEFAULT_KILO_FREE_MODEL_REF,
    );
    if (explicitKiloStarterIndex >= 0) {
      return refs[explicitKiloStarterIndex] ?? DEFAULT_KILO_FREE_MODEL_REF;
    }
  }

  const safeIndex = normalizedRefs.findIndex((ref) => !UNSUPPORTED_STARTER_MODEL_REFS.has(ref));
  if (safeIndex >= 0) {
    return refs[safeIndex] ?? null;
  }
  return refs[0] ?? null;
}

function findSharedWorkspaceModelRef(cfg: unknown): string | null {
  const providers = getPath(cfg, ["models", "providers"]);
  if (!isRecord(providers)) {
    return null;
  }

  const entries = Object.entries(providers);
  const preferred = entries
    .filter(([name]) => SHARED_PROVIDER_PREFER.has(name.trim().toLowerCase()))
    .sort((a, b) => {
      const aIndex = SHARED_PROVIDER_PRIORITY.indexOf(a[0].trim().toLowerCase() as (typeof SHARED_PROVIDER_PRIORITY)[number]);
      const bIndex = SHARED_PROVIDER_PRIORITY.indexOf(b[0].trim().toLowerCase() as (typeof SHARED_PROVIDER_PRIORITY)[number]);
      return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
    });
  const flagged = entries.filter(([, value]) => {
    if (!isRecord(value)) return false;
    return value.sharedForWorkspaces === true || value.shared === true;
  });
  const ordered: Array<[string, unknown]> = [];
  const seen = new Set<string>();
  for (const group of [preferred, flagged, entries]) {
    for (const entry of group) {
      if (seen.has(entry[0])) continue;
      seen.add(entry[0]);
      ordered.push(entry);
    }
  }

  for (const [providerName, providerRaw] of ordered) {
    const preferredRef = resolvePreferredSharedProviderModelRef(providerName, providerRaw);
    if (preferredRef) {
      return preferredRef;
    }
  }
  // When KILO_API_KEY env is set, use Kilo free model as the shared default.
  // Users don't need their own API key — the server key covers free-tier models.
  if ((process.env.KILO_API_KEY ?? "").trim()) {
    return DEFAULT_SHARED_MODEL_REF;
  }
  if ((process.env.NVIDIA_API_KEY ?? "").trim()) {
    return "nvidia/moonshotai/kimi-k2.5";
  }
  if (hasOllamaEnvConfigured()) {
    return `ollama/${resolveStarterOllamaModelId()}`;
  }
  return null;
}

export const __test = {
  findSharedWorkspaceModelRef,
  resolveDeprecatedModelRefReplacement,
  looksLikeLegacyStarterWorkspacePackage,
  sanitizeLegacyStarterWorkspaceScaffold,
};

/**
 * Reset a single workspace: wipe all agents then re-provision the single starter agent.
 * Called by the super-admin reset-all-workspaces RPC.
 */
export async function resetWorkspaceToSingleStarter(workspaceId: string): Promise<void> {
  const [{ readWorkspaceConfig, writeWorkspaceConfig }] = await Promise.all([
    import("./workspace-config.js"),
  ]);
  await resetStarterWorkspaceArtifacts(workspaceId, DEFAULT_STARTER_AGENT_ID);
  const existing = (await readWorkspaceConfig(workspaceId)) ?? {};
  // Wipe agents list and primary model so ensureWorkspaceStarterExperience rebuilds from scratch.
  const agents = isRecord(existing.agents) ? { ...existing.agents as Record<string, unknown> } : {};
  delete agents.list;
  delete agents.defaults;
  const cleaned: Record<string, unknown> = { ...existing, agents };
  if (Object.keys(agents).length === 0) delete cleaned.agents;
  await writeWorkspaceConfig(workspaceId, cleaned as Record<string, unknown>);
  // Re-provision: ensureWorkspaceStarterExperience now sees no agents and creates the starter.
  await ensureWorkspaceStarterExperience({ workspaceId });
}

async function ensureWorkspaceStarterExperience(user: WarmIdentityUser): Promise<void> {
  try {
    const [{ readWorkspaceConfig, patchWorkspaceConfig, writeWorkspaceConfig }, { loadConfig }] =
      await Promise.all([
      import("./workspace-config.js"),
      import("../config/config.js"),
    ]);
    const workspaceId = String(user.workspaceId || "").trim();
    if (!workspaceId) return;

    const globalCfg = loadConfig() as unknown;
    let existing = (await readWorkspaceConfig(workspaceId)) ?? {};
    const scrubbedOverlay = scrubLegacyWorkspaceOverlayCopies(existing, globalCfg);
    if (scrubbedOverlay.changed) {
      existing = scrubbedOverlay.cleaned;
      await writeWorkspaceConfig(workspaceId, existing);
    }
    const sharedModelRef = findSharedWorkspaceModelRef(globalCfg);
    const existingAgentsList = getPath(existing, ["agents", "list"]);
    const hasAgents = Array.isArray(existingAgentsList) && existingAgentsList.length > 0;
    const repairedAgentsList = Array.isArray(existingAgentsList)
      ? existingAgentsList.flatMap((entry) => {
          if (!isRecord(entry)) return [entry];
          const currentWorkspaceId =
            typeof entry.workspaceId === "string" ? entry.workspaceId.trim() : "";
          if (currentWorkspaceId && currentWorkspaceId !== workspaceId) {
            // Legacy polluted workspace overlays may contain agents copied from other
            // workspaces. Drop them when this workspace logs in.
            return [];
          }
          let nextEntry: Record<string, unknown> = entry;
          if (!currentWorkspaceId) {
            nextEntry = { ...nextEntry, workspaceId };
          }
          const currentModelRef =
            typeof nextEntry.model === "string" ? nextEntry.model.trim() : "";
          const replacementModelRef = currentModelRef
            ? resolveDeprecatedModelRefReplacement(currentModelRef)
            : null;
          if (replacementModelRef && replacementModelRef !== currentModelRef) {
            nextEntry = { ...nextEntry, model: replacementModelRef };
          } else if (
            currentModelRef &&
            sharedModelRef &&
            UNSUPPORTED_STARTER_MODEL_REFS.has(normalizeModelRef(currentModelRef))
          ) {
            nextEntry = { ...nextEntry, model: sharedModelRef };
          }
          return [nextEntry];
        })
      : null;
    const repairedAgentsChanged =
      Array.isArray(existingAgentsList) &&
      Array.isArray(repairedAgentsList) &&
      (repairedAgentsList.length !== existingAgentsList.length ||
        repairedAgentsList.some((entry, index) => entry !== existingAgentsList[index]));
    const starterName =
      typeof user.name === "string" && user.name.trim()
        ? `${user.name.trim().split(/\s+/)[0]}'s Assistant`
        : DEFAULT_STARTER_AGENT_NAME;
    const starterAgentId = slugifyAgentId(DEFAULT_STARTER_AGENT_ID);
    const starterWorkspace = `${DEFAULT_STARTER_AGENT_WORKSPACE_BASE}/${workspaceId}/${starterAgentId}`;
    const starterWorkspacePath = resolveWorkspaceAgentWorkspacePath(workspaceId, starterAgentId);
    const scrubbedLegacyWorkspace = await sanitizeLegacyStarterWorkspaceScaffold(starterWorkspacePath);

    const patch: Record<string, unknown> = {};
    const workspaceSessionStore = resolveWorkspaceSessionStoreTemplate(workspaceId);
    const workspaceMemoryStore = resolveWorkspaceMemoryStoreTemplate(workspaceId);

    if (!hasAgents) {
      patch.agents = {
        defaults: {
          workspace: starterWorkspace,
          thinkingDefault: DEFAULT_SHARED_THINKING_LEVEL,
          verboseDefault: DEFAULT_SHARED_VERBOSE_LEVEL,
        },
        list: [
          {
            id: starterAgentId,
            name: starterName,
            default: true,
            workspaceId,
            workspace: starterWorkspace,
            identity: {
              name: starterName,
              emoji: "🤖",
              theme: "Workspace Assistant",
            },
            tools: { profile: "full" },
            ...(sharedModelRef ? { model: sharedModelRef } : {}),
          },
        ],
      };
    } else {
      patch.agents = {
        defaults: {
          workspace:
            typeof getPath(existing, ["agents", "defaults", "workspace"]) === "string"
              ? getPath(existing, ["agents", "defaults", "workspace"])
              : starterWorkspace,
          thinkingDefault:
            typeof getPath(existing, ["agents", "defaults", "thinkingDefault"]) === "string" &&
            String(getPath(existing, ["agents", "defaults", "thinkingDefault"])).trim()
              ? getPath(existing, ["agents", "defaults", "thinkingDefault"])
              : DEFAULT_SHARED_THINKING_LEVEL,
          verboseDefault:
            typeof getPath(existing, ["agents", "defaults", "verboseDefault"]) === "string" &&
            String(getPath(existing, ["agents", "defaults", "verboseDefault"])).trim() &&
            String(getPath(existing, ["agents", "defaults", "verboseDefault"])).trim() !== "off"
              ? getPath(existing, ["agents", "defaults", "verboseDefault"])
              : DEFAULT_SHARED_VERBOSE_LEVEL,
        },
        ...(repairedAgentsChanged ? { list: repairedAgentsList } : {}),
      };
    }

    const workspacePrimary = getPath(existing, ["agents", "defaults", "model", "primary"]);
    const workspacePrimaryRef =
      typeof workspacePrimary === "string" ? workspacePrimary.trim() : "";
    const deprecatedPrimaryReplacement = workspacePrimaryRef
      ? resolveDeprecatedModelRefReplacement(workspacePrimaryRef)
      : null;
    const desiredPrimaryRef =
      deprecatedPrimaryReplacement && deprecatedPrimaryReplacement !== workspacePrimaryRef
        ? deprecatedPrimaryReplacement
        : (!workspacePrimaryRef && sharedModelRef ? sharedModelRef : null);

    if (desiredPrimaryRef) {
      const modelsMeta = getPath(existing, ["agents", "defaults", "models"]);
      const hasModelMeta =
        isRecord(modelsMeta) && Object.prototype.hasOwnProperty.call(modelsMeta, desiredPrimaryRef);
      patch.agents = {
        ...(isRecord(patch.agents) ? patch.agents : {}),
        defaults: {
          ...(isRecord(getPath(patch, ["agents", "defaults"]))
            ? (getPath(patch, ["agents", "defaults"]) as Record<string, unknown>)
            : {}),
          model: { primary: desiredPrimaryRef },
          ...(hasModelMeta
            ? {}
            : {
                models: {
                  [desiredPrimaryRef]: {
                    alias: resolveModelAlias(desiredPrimaryRef),
                  },
                },
              }),
        },
      };
    }

    const existingSessionStore = getPath(existing, ["session", "store"]);
    if (workspaceSessionStore) {
      const currentStore =
        typeof existingSessionStore === "string" ? existingSessionStore.trim() : "";
      const shouldSetWorkspaceStore =
        !currentStore ||
        !currentStore.includes(`/workspaces/${workspaceId}/`) ||
        !currentStore.includes("{agentId}");
      if (shouldSetWorkspaceStore) {
        patch.session = {
          ...(isRecord(patch.session) ? (patch.session as Record<string, unknown>) : {}),
          store: workspaceSessionStore,
        };
      }
    }

    const existingMemorySearch = getPath(existing, ["agents", "defaults", "memorySearch"]);
    const currentMemorySearch = isRecord(existingMemorySearch)
      ? (existingMemorySearch as Record<string, unknown>)
      : null;
    const currentMemoryStore =
      typeof getPath(currentMemorySearch, ["store", "path"]) === "string"
        ? String(getPath(currentMemorySearch, ["store", "path"])).trim()
        : "";
    const currentMemoryEnabled = getPath(currentMemorySearch, ["enabled"]);
    const currentSessionMemory = getPath(currentMemorySearch, ["experimental", "sessionMemory"]);
    const currentSources = Array.isArray(getPath(currentMemorySearch, ["sources"]))
      ? (getPath(currentMemorySearch, ["sources"]) as unknown[])
      : null;
    const memorySearchPatch: Record<string, unknown> = {};

    if (typeof currentMemoryEnabled !== "boolean") {
      memorySearchPatch.enabled = true;
    }
    if (typeof currentSessionMemory !== "boolean") {
      memorySearchPatch.experimental = {
        sessionMemory: true,
      };
    }
    if (!currentSources || currentSources.length === 0) {
      memorySearchPatch.sources = ["memory", "sessions"];
    }
    if (
      workspaceMemoryStore &&
      (!currentMemoryStore ||
        !currentMemoryStore.includes(`/workspaces/${workspaceId}/`) ||
        !currentMemoryStore.includes("{agentId}"))
    ) {
      memorySearchPatch.store = {
        path: workspaceMemoryStore,
      };
    }
    const currentSync = isRecord(getPath(currentMemorySearch, ["sync"]))
      ? (getPath(currentMemorySearch, ["sync"]) as Record<string, unknown>)
      : null;
    const syncPatch: Record<string, unknown> = {};
    if (typeof currentSync?.onSessionStart !== "boolean") {
      syncPatch.onSessionStart = true;
    }
    if (typeof currentSync?.onSearch !== "boolean") {
      syncPatch.onSearch = true;
    }
    if (typeof currentSync?.watch !== "boolean") {
      syncPatch.watch = true;
    }
    if (Object.keys(syncPatch).length > 0) {
      memorySearchPatch.sync = syncPatch;
    }
    if (Object.keys(memorySearchPatch).length > 0) {
      patch.agents = {
        ...(isRecord(patch.agents) ? (patch.agents as Record<string, unknown>) : {}),
        defaults: {
          ...(isRecord(getPath(patch, ["agents", "defaults"]))
            ? (getPath(patch, ["agents", "defaults"]) as Record<string, unknown>)
            : {}),
          memorySearch: memorySearchPatch,
        },
      };
    }

    if (Object.keys(patch).length > 0) {
      await patchWorkspaceConfig(workspaceId, patch);
    }

    try {
      const { ensureAgentWorkspace } = await import("../agents/workspace.js");
      await ensureAgentWorkspace({
        dir: starterWorkspace,
        ensureBootstrapFiles: true,
      });
    } catch (err) {
      console.warn("[pmos] workspace bootstrap files ensure failed:", String(err));
    }

    if (scrubbedLegacyWorkspace) {
      console.info(`[pmos] scrubbed polluted starter workspace scaffold for workspace=${workspaceId}`);
    }

    try {
      const { refreshWorkspaceAiContext } = await import("./workspace-ai-context.js");
      await refreshWorkspaceAiContext(workspaceId, {
        includeLiveCredentials: true,
      });
    } catch (err) {
      console.warn("[pmos] workspace ai context refresh failed:", String(err));
    }

    await ensureStarterSessionDefaults({ agentId: starterAgentId, workspaceId });
  } catch (err) {
    console.warn("[pmos] workspace starter bootstrap failed:", String(err));
  }
}

async function ensureStarterSessionDefaults(params: {
  agentId: string;
  workspaceId: string;
}): Promise<void> {
  try {
    const [
      { buildAgentMainSessionKey, normalizeAgentId },
      { mergeSessionEntry, updateSessionStore },
    ] = await Promise.all([
      import("../routing/session-key.js"),
      import("../config/sessions.js"),
    ]);
    const agentId = normalizeAgentId(params.agentId);
    const workspaceId = String(params.workspaceId || "").trim();
    if (!workspaceId) {
      return;
    }
    const sessionKey = buildAgentMainSessionKey({ agentId });
    const storePath = resolveWorkspaceAgentSessionStorePath(workspaceId, agentId);

    await updateSessionStore(
      storePath,
      (store) => {
        const existing = store[sessionKey];
        const next = mergeSessionEntry(existing, {
          thinkingLevel:
            typeof existing?.thinkingLevel === "string" && existing.thinkingLevel.trim()
              ? existing.thinkingLevel
              : DEFAULT_SHARED_THINKING_LEVEL,
          verboseLevel:
            typeof existing?.verboseLevel === "string" &&
            existing.verboseLevel.trim() &&
            existing.verboseLevel.trim() !== "off"
              ? existing.verboseLevel
              : DEFAULT_SHARED_VERBOSE_LEVEL,
          reasoningLevel:
            typeof existing?.reasoningLevel === "string" && existing.reasoningLevel.trim()
              ? existing.reasoningLevel
              : DEFAULT_SHARED_REASONING_LEVEL,
        });
        store[sessionKey] = next;
        return next;
      },
      { activeSessionKey: sessionKey },
    );
  } catch (err) {
    console.warn("[pmos] starter session defaults bootstrap failed:", String(err));
  }
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
    await ensureWorkspaceStarterExperience(session.user);
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

  if (route === "change-password") {
    const session = await resolvePmosSessionFromRequest(req);
    if (!session.ok) {
      sendJson(res, 401, { ok: false, error: "Authentication required." });
      return true;
    }
    const currentPassword =
      typeof parsed.currentPassword === "string" ? parsed.currentPassword : "";
    const newPassword = typeof parsed.newPassword === "string" ? parsed.newPassword : "";
    const result = await changePmosUserPassword({
      userId: session.user.id,
      currentPassword,
      newPassword,
    });
    if (!result.ok) {
      sendJson(res, result.status, { ok: false, error: result.error });
      return true;
    }
    await ensureWorkspaceStarterExperience(result.user);
    await syncWorkflowIdentityForWorkspace(result.user, newPassword, {
      previousPassword: currentPassword,
    });
    void warmEmbeddedN8nIdentity(result.user, newPassword);
    res.setHeader("Set-Cookie", buildPmosSessionCookieValue(result.sessionToken, req));
    sendJson(res, 200, { ok: true, user: result.user });
    return true;
  }

  if (route === "admin-reset-password") {
    const session = await resolvePmosSessionFromRequest(req);
    if (!session.ok) {
      sendJson(res, 401, { ok: false, error: "Authentication required." });
      return true;
    }
    if (session.user.role !== "super_admin") {
      sendJson(res, 403, { ok: false, error: "super_admin role required." });
      return true;
    }
    const email = typeof parsed.email === "string" ? parsed.email : "";
    const newPassword = typeof parsed.newPassword === "string" ? parsed.newPassword : "";
    const result = await adminResetPmosUserPassword({
      actorUserId: session.user.id,
      targetEmail: email,
      newPassword,
    });
    if (!result.ok) {
      sendJson(res, result.status, { ok: false, error: result.error });
      return true;
    }
    await syncWorkflowIdentityForWorkspace(result.user, newPassword);
    void warmEmbeddedN8nIdentity(result.user, newPassword);
    sendJson(res, 200, { ok: true, user: result.user });
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
    // Keep the workflow-engine account and connectors ready on first load.
    await ensureWorkspaceStarterExperience(result.user);
    await syncWorkflowIdentityForWorkspace(result.user, password);
    await ensureWorkspaceOpsProjectProvisioned(result.user);
    void warmEmbeddedN8nIdentity(result.user, password);
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
    // Same parity warm-up on login to avoid first-request races in Flow provisioning.
    await ensureWorkspaceStarterExperience(result.user);
    await syncWorkflowIdentityForWorkspace(result.user, password);
    await ensureWorkspaceOpsProjectProvisioned(result.user);
    void warmEmbeddedN8nIdentity(result.user, password);
    res.setHeader("Set-Cookie", buildPmosSessionCookieValue(result.sessionToken, req));
    sendJson(res, 200, { ok: true, user: result.user });
    return true;
  }

  sendJson(res, 404, { ok: false, error: "Not Found" });
  return true;
}
