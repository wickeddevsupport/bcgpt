import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
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
import { resolveStateDir } from "../config/paths.js";

const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_STARTER_AGENT_ID = "assistant";
const DEFAULT_STARTER_AGENT_NAME = "Workspace Assistant";
const DEFAULT_STARTER_AGENT_WORKSPACE_BASE = "~/.openclaw/workspaces";
const DEFAULT_STARTER_OLLAMA_MODEL_ID = "qwen3:1.7b";
const SHARED_PROVIDER_PREFER = new Set(["local-ollama", "ollama", "kilo"]);
const DEFAULT_KILO_FREE_MODEL_REF = "kilo/minimax/minimax-m2.5:free";
const DEFAULT_SHARED_THINKING_LEVEL = "low";
const DEFAULT_SHARED_REASONING_LEVEL = "stream";
const DEPRECATED_MODEL_REF_REPLACEMENTS: Record<string, string> = {
  "kilo/z-ai/glm-5:free": "kilo/minimax/minimax-m2.5:free",
  "kilo/glm-5:free": "kilo/minimax/minimax-m2.5:free",
  "kilo/z-ai/glm-5": "kilo/minimax/minimax-m2.5:free",
  "kilo/glm-5": "kilo/minimax/minimax-m2.5:free",
};

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
  role?: import("./pmos-auth.js").PmosRole | null;
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
        role: user.role ?? "member",
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

function resolveWorkspaceSessionStoreTemplate(workspaceId: string): string {
  const trimmed = String(workspaceId || "").trim();
  if (!trimmed) {
    return "";
  }
  return `${DEFAULT_STARTER_AGENT_WORKSPACE_BASE}/${trimmed}/agents/{agentId}/sessions/sessions.json`;
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
  // When KILO_API_KEY env is set, use Kilo free model as the shared default.
  // Users don't need their own API key — the server key covers free-tier models.
  if ((process.env.KILO_API_KEY ?? "").trim()) {
    return DEFAULT_KILO_FREE_MODEL_REF;
  }
  if (hasOllamaEnvConfigured()) {
    return `ollama/${resolveStarterOllamaModelId()}`;
  }
  return null;
}

/**
 * Reset a single workspace: wipe all agents then re-provision the single starter agent.
 * Called by the super-admin reset-all-workspaces RPC.
 */
export async function resetWorkspaceToSingleStarter(workspaceId: string): Promise<void> {
  const [{ readWorkspaceConfig, writeWorkspaceConfig }] = await Promise.all([
    import("./workspace-config.js"),
  ]);
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
          if (currentWorkspaceId) {
            return [entry];
          }
          return [{ ...entry, workspaceId }];
        })
      : null;
    const repairedAgentsChanged =
      Array.isArray(existingAgentsList) &&
      Array.isArray(repairedAgentsList) &&
      (repairedAgentsList.length !== existingAgentsList.length ||
        repairedAgentsList.some((entry, index) => entry !== existingAgentsList[index]));

    const sharedModelRef = findSharedWorkspaceModelRef(globalCfg);
    const starterName =
      typeof user.name === "string" && user.name.trim()
        ? `${user.name.trim().split(/\s+/)[0]}'s Assistant`
        : DEFAULT_STARTER_AGENT_NAME;
    const starterAgentId = slugifyAgentId(DEFAULT_STARTER_AGENT_ID);
    const starterWorkspace = `${DEFAULT_STARTER_AGENT_WORKSPACE_BASE}/${workspaceId}/${starterAgentId}`;

    const patch: Record<string, unknown> = {};
    const workspaceSessionStore = resolveWorkspaceSessionStoreTemplate(workspaceId);

    if (!hasAgents) {
      patch.agents = {
        defaults: {
          workspace: starterWorkspace,
          thinkingDefault: DEFAULT_SHARED_THINKING_LEVEL,
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

    if (Object.keys(patch).length > 0) {
      await patchWorkspaceConfig(workspaceId, patch);
    }

    try {
      const { refreshWorkspaceAiContext } = await import("./workspace-ai-context.js");
      await refreshWorkspaceAiContext(workspaceId, {
        includeLiveCredentials: true,
      });
    } catch (err) {
      console.warn("[pmos] workspace ai context refresh failed:", String(err));
    }

    // Non-blocking: auto-ping the bcgpt /action/startbcgpt endpoint to warm up
    // the Basecamp session on every login (ensures connection is ready for AI tool calls).
    void (async () => {
      try {
        const { readWorkspaceConnectors } = await import("./workspace-connectors.js");
        const { loadConfig } = await import("../config/config.js");
        const globalCfg = loadConfig() as Record<string, unknown>;
        const wc = await readWorkspaceConnectors(workspaceId);
        const bcgptUrl =
          ((wc?.bcgpt as Record<string, unknown> | undefined)?.url as string | undefined)?.trim() ||
          (globalCfg as unknown as { pmos?: { connectors?: { bcgpt?: { url?: string } } } })?.pmos?.connectors?.bcgpt?.url?.trim() ||
          process.env.BCGPT_URL?.trim() ||
          "https://bcgpt.wickedlab.io";
        // Only auto-ping if the workspace has its own saved API key — don't fall back to global key
        const bcgptKey =
          ((wc?.bcgpt as Record<string, unknown> | undefined)?.apiKey as string | undefined)?.trim() ||
          null;
        if (bcgptKey) {
          const resp = await fetch(`${bcgptUrl}/action/startbcgpt`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-bcgpt-api-key": bcgptKey },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(8000),
          });
          const payload = (await resp.json()) as Record<string, unknown>;
          const connected = payload?.connected === true;
          const name = typeof payload?.user === "object" && payload.user !== null
            ? (payload.user as Record<string, unknown>).name
            : null;
          console.info(
            `[pmos] bcgpt auto-ping: connected=${connected}, user=${name ?? "—"} (workspace=${workspaceId})`
          );
        }
      } catch (err) {
        console.warn("[pmos] bcgpt auto-ping failed:", String(err));
      }
    })();

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
