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
const DEFAULT_STARTER_AGENT_ID = "assistant";
const DEFAULT_STARTER_AGENT_NAME = "Workspace Assistant";
const DEFAULT_STARTER_AGENT_WORKSPACE_BASE = "~/.openclaw/workspaces";
const SHARED_PROVIDER_PREFER = new Set(["local-ollama", "ollama"]);

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

type WarmIdentityUser = {
  workspaceId: string;
  email?: string | null;
  name?: string | null;
};

async function warmEmbeddedN8nIdentity(user: WarmIdentityUser): Promise<void> {
  try {
    const [{ readLocalN8nConfig }, { getOrCreateWorkspaceN8nCookie }] = await Promise.all([
      import("./pmos-ops-proxy.js"),
      import("./n8n-auth-bridge.js"),
    ]);
    const localN8n = readLocalN8nConfig();
    if (!localN8n) return;

    await getOrCreateWorkspaceN8nCookie({
      workspaceId: user.workspaceId,
      n8nBaseUrl: localN8n.url,
      pmosUser: {
        email: typeof user.email === "string" ? user.email : "",
        name: typeof user.name === "string" ? user.name : "",
      },
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

function slugifyAgentId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return normalized || DEFAULT_STARTER_AGENT_ID;
}

function findSharedWorkspaceModelRef(cfg: unknown): string | null {
  const providers = getPath(cfg, ["models", "providers"]);
  if (!isRecord(providers)) {
    return null;
  }

  const entries = Object.entries(providers);
  const preferred = entries.filter(([name]) => SHARED_PROVIDER_PREFER.has(name.trim().toLowerCase()));
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
    const provider = providerName.trim().toLowerCase();
    if (!provider || !isRecord(providerRaw)) continue;
    const models = providerRaw.models;
    if (!Array.isArray(models) || models.length === 0) continue;
    for (const modelRaw of models) {
      if (!isRecord(modelRaw)) continue;
      const id = typeof modelRaw.id === "string" ? modelRaw.id.trim() : "";
      if (!id) continue;
      return `${provider}/${id}`;
    }
  }
  return null;
}

async function ensureWorkspaceStarterExperience(user: WarmIdentityUser): Promise<void> {
  try {
    const [{ readWorkspaceConfig, patchWorkspaceConfig }, { loadConfig }] = await Promise.all([
      import("./workspace-config.js"),
      import("../config/config.js"),
    ]);
    const workspaceId = String(user.workspaceId || "").trim();
    if (!workspaceId) return;

    const existing = (await readWorkspaceConfig(workspaceId)) ?? {};
    const existingAgentsList = getPath(existing, ["agents", "list"]);
    const hasAgents = Array.isArray(existingAgentsList) && existingAgentsList.length > 0;

    const sharedModelRef = findSharedWorkspaceModelRef(loadConfig() as unknown);
    const starterName =
      typeof user.name === "string" && user.name.trim()
        ? `${user.name.trim().split(/\s+/)[0]}'s Assistant`
        : DEFAULT_STARTER_AGENT_NAME;
    const starterAgentId = slugifyAgentId(DEFAULT_STARTER_AGENT_ID);
    const starterWorkspace = `${DEFAULT_STARTER_AGENT_WORKSPACE_BASE}/${workspaceId}/${starterAgentId}`;

    const patch: Record<string, unknown> = {};

    if (!hasAgents) {
      patch.agents = {
        defaults: {
          workspace: starterWorkspace,
        },
        list: [
          {
            id: starterAgentId,
            name: starterName,
            default: true,
            workspace: starterWorkspace,
            identity: {
              name: starterName,
              emoji: "🤖",
              theme: "Workspace Assistant",
            },
            tools: { profile: "messaging" },
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
        },
      };
    }

    const workspacePrimary = getPath(existing, ["agents", "defaults", "model", "primary"]);
    if (sharedModelRef && (typeof workspacePrimary !== "string" || !workspacePrimary.trim())) {
      const modelsMeta = getPath(existing, ["agents", "defaults", "models"]);
      const hasModelMeta =
        isRecord(modelsMeta) && Object.prototype.hasOwnProperty.call(modelsMeta, sharedModelRef);
      patch.agents = {
        ...(isRecord(patch.agents) ? patch.agents : {}),
        defaults: {
          ...(isRecord(getPath(patch, ["agents", "defaults"]))
            ? (getPath(patch, ["agents", "defaults"]) as Record<string, unknown>)
            : {}),
          model: { primary: sharedModelRef },
          ...(hasModelMeta
            ? {}
            : {
                models: {
                  [sharedModelRef]: {
                    alias: "Shared Ollama",
                  },
                },
              }),
        },
      };
    }

    if (Object.keys(patch).length > 0) {
      await patchWorkspaceConfig(workspaceId, patch);
    }
  } catch (err) {
    console.warn("[pmos] workspace starter bootstrap failed:", String(err));
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
    // Fire-and-forget: provision *remote* ops (legacy) only when explicitly enabled.
    // Embedded n8n is the default runtime and does not require provisioning.
    const allowRemoteOpsFallback = (() => {
      const raw = (process.env.PMOS_ALLOW_REMOTE_OPS_FALLBACK ?? "").trim().toLowerCase();
      return raw === "1" || raw === "true" || raw === "yes";
    })();
    if (allowRemoteOpsFallback) {
      import("./pmos-provision-ops.js")
        .then(({ provisionWorkspaceOps }) => provisionWorkspaceOps(result.user.workspaceId))
        .catch((err: unknown) => {
          console.warn(
            "[pmos] auto-provision ops failed for workspace",
            result.user.workspaceId,
            String(err),
          );
        });
    }
    // Warm workspace-scoped embedded n8n auth so the automations iframe opens
    // with the same PMOS user context on first load.
    await ensureWorkspaceStarterExperience(result.user);
    void warmEmbeddedN8nIdentity(result.user);
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
    // Same warm-up on login to avoid first-request races in embedded n8n auth.
    await ensureWorkspaceStarterExperience(result.user);
    void warmEmbeddedN8nIdentity(result.user);
    res.setHeader("Set-Cookie", buildPmosSessionCookieValue(result.sessionToken, req));
    sendJson(res, 200, { ok: true, user: result.user });
    return true;
  }

  sendJson(res, 404, { ok: false, error: "Not Found" });
  return true;
}
