/**
 * Utility to provision workflow-engine connector defaults for a workspace.
 * This is Activepieces-first and intentionally does not create synthetic
 * per-workspace users.
 */
import { loadConfig } from "../config/config.js";
import { readWorkspaceConnectors, writeWorkspaceConnectors } from "./workspace-connectors.js";

export type ProvisionOpsResult = {
  ok: true;
  workspaceId: string;
  projectId?: string;
  apiKey?: string;
};

type FetchResult = {
  ok: boolean;
  status: number;
  json: unknown | null;
  error: string | null;
};

async function doFetch(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
): Promise<FetchResult> {
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text().catch(() => "");
    const json = (() => {
      try {
        return text ? (JSON.parse(text) as unknown) : null;
      } catch {
        return null;
      }
    })();
    return { ok: res.ok, status: res.status, json, error: res.ok ? null : text || res.statusText };
  } catch (err) {
    return { ok: false, status: 0, json: null, error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function readConfigValue(cfg: unknown, path: string[]): string | null {
  let cur: unknown = cfg;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  const s = typeof cur === "string" ? cur.trim() : "";
  return s || null;
}

function extractApiKey(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  return (
    (typeof j.key === "string" && j.key) ||
    (typeof j.token === "string" && j.token) ||
    (typeof j.value === "string" && j.value) ||
    (typeof j.apiKey === "string" && j.apiKey) ||
    null
  );
}

function resolveOpsGlobals(): { url: string; apiKey: string | null } {
  const cfg = loadConfig() as unknown;
  const urlRaw =
    readConfigValue(cfg, ["pmos", "connectors", "activepieces", "url"]) ??
    process.env.ACTIVEPIECES_URL?.trim() ??
    process.env.FLOW_URL?.trim() ??
    readConfigValue(cfg, ["pmos", "connectors", "ops", "url"]) ??
    process.env.OPS_URL?.trim() ??
    "https://flow.wickedlab.io";
  const url = urlRaw.replace(/\/+$/, "");
  const apiKey =
    readConfigValue(cfg, ["pmos", "connectors", "activepieces", "apiKey"]) ??
    process.env.ACTIVEPIECES_API_KEY?.trim() ??
    readConfigValue(cfg, ["pmos", "connectors", "ops", "apiKey"]) ??
    process.env.OPS_API_KEY?.trim() ??
    null;
  return { url, apiKey };
}

function readUserEmail(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>).email;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed || null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readProjectId(json: unknown): string | undefined {
  if (!json || typeof json !== "object" || Array.isArray(json)) return undefined;
  const record = json as Record<string, unknown>;
  return (
    readString(record.id) ??
    readString(record.projectId) ??
    readString(record.displayName) ??
    readString(record.name) ??
    undefined
  );
}

function readWorkspaceUserCredentials(connectors: unknown): { email: string; password: string } | null {
  if (!connectors || typeof connectors !== "object" || Array.isArray(connectors)) return null;
  const root = connectors as Record<string, unknown>;
  for (const connectorKey of ["activepieces", "ops"]) {
    const connector = root[connectorKey];
    if (!connector || typeof connector !== "object" || Array.isArray(connector)) {
      continue;
    }
    const user =
      (connector as Record<string, unknown>).user &&
      typeof (connector as Record<string, unknown>).user === "object" &&
      !Array.isArray((connector as Record<string, unknown>).user)
        ? ((connector as Record<string, unknown>).user as Record<string, unknown>)
        : null;
    const email = readUserEmail(user);
    const password = readString(user?.password);
    if (email && password) {
      return { email, password };
    }
  }
  return null;
}

async function resolveProjectIdFromWorkspaceUser(
  opsUrl: string,
  credentials: { email: string; password: string } | null,
): Promise<string | undefined> {
  if (!credentials) {
    return undefined;
  }
  const authRes = await doFetch(`${opsUrl}/api/v1/authentication/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(credentials),
    timeoutMs: 12000,
  });
  if (!authRes.ok) {
    return undefined;
  }
  return readProjectId(authRes.json);
}

function isLegacySyntheticWorkspaceUser(value: unknown): boolean {
  const email = readUserEmail(value);
  if (!email) return false;
  if (!email.startsWith("pmos-")) return false;
  return email.endsWith("@openclaw.local") || email.endsWith("@wicked.local");
}

/**
 * Creates a workflow-engine project + workspace-scoped API key for the given workspace.
 * Persists results to `~/.openclaw/workspaces/{workspaceId}/connectors.json`.
 * Throws on unrecoverable failure.
 */
export async function provisionWorkspaceOps(
  workspaceId: string,
  projectName?: string,
): Promise<ProvisionOpsResult> {
  const { url: opsUrl, apiKey: opsKey } = resolveOpsGlobals();
  const existing = (await readWorkspaceConnectors(workspaceId)) ?? {};
  const existingOps =
    existing.ops && typeof existing.ops === "object" && !Array.isArray(existing.ops)
      ? ({ ...(existing.ops as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const existingProjectId = readString(existingOps.projectId) ?? undefined;
  if (existingProjectId) {
    return { ok: true, workspaceId, projectId: existingProjectId };
  }

  const name = projectName?.trim() || `PMOS workspace ${workspaceId}`;
  const workspaceUserCredentials = readWorkspaceUserCredentials(existing);

  // 1. Create workflow project
  let projectRes: FetchResult = {
    ok: false,
    status: 0,
    json: null,
    error: "Workflow engine API key not configured.",
  };
  if (opsKey) {
    projectRes = await doFetch(`${opsUrl}/api/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opsKey}` },
      body: JSON.stringify({ displayName: name }),
      timeoutMs: 12000,
    });
  }

  let projectId = readProjectId(projectRes.json);

  // 2. Create workspace-scoped API key (try multiple endpoint variants)
  let createdApiKey: string | undefined;
  if (opsKey) {
    const keyEndpoints = [
      `${opsUrl}/api/v1/api-keys`,
      `${opsUrl}/api/v1/users-api-keys`,
      `${opsUrl}/api/v1/users/api-keys`,
    ];
    for (const ep of keyEndpoints) {
      const kRes = await doFetch(ep, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opsKey}` },
        body: JSON.stringify({ displayName: `pmos:${workspaceId}` }),
        timeoutMs: 12000,
      });
      if (kRes.ok && kRes.json) {
        const key = extractApiKey(kRes.json);
        if (key) {
          createdApiKey = key;
          break;
        }
        const j = kRes.json as Record<string, unknown>;
        if (typeof j.id === "string" && j.id) {
          createdApiKey = j.id;
          break;
        }
      }
    }
  }

  if (!projectId) {
    projectId = await resolveProjectIdFromWorkspaceUser(opsUrl, workspaceUserCredentials);
  }

  if (!projectId && !createdApiKey) {
    const msg = projectRes.error ?? `status=${projectRes.status}`;
    throw new Error(`Failed to provision workflow engine for workspace ${workspaceId}: ${msg}`);
  }

  // 3. Persist to connectors.
  // If legacy synthetic ops.user is present, drop it to avoid stale auth loops.
  if (isLegacySyntheticWorkspaceUser(existingOps.user)) {
    delete existingOps.user;
  }
  const next = {
    ...existing,
    ops: {
      ...existingOps,
      url: opsUrl,
      ...(createdApiKey ? { apiKey: createdApiKey } : {}),
      ...(projectId ? { projectId } : {}),
    },
  };
  await writeWorkspaceConnectors(workspaceId, next);

  return { ok: true, workspaceId, projectId, apiKey: createdApiKey };
}
