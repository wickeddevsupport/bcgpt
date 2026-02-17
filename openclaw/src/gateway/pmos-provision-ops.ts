/**
 * Utility to auto-provision a per-workspace n8n Project + API key.
 * Called fire-and-forget on signup, and also used by the manual provision_ops WS handler.
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
    readConfigValue(cfg, ["pmos", "connectors", "ops", "url"]) ??
    process.env.OPS_URL?.trim() ??
    "https://ops.wickedlab.io";
  const url = urlRaw.replace(/\/+$/, "");
  const apiKey =
    readConfigValue(cfg, ["pmos", "connectors", "ops", "apiKey"]) ??
    process.env.OPS_API_KEY?.trim() ??
    null;
  return { url, apiKey };
}

/**
 * Creates an n8n Project + workspace-scoped API key for the given workspace.
 * Persists results to `~/.openclaw/workspaces/{workspaceId}/connectors.json`.
 * Throws on unrecoverable failure.
 */
export async function provisionWorkspaceOps(
  workspaceId: string,
  projectName?: string,
): Promise<ProvisionOpsResult> {
  const { url: opsUrl, apiKey: opsKey } = resolveOpsGlobals();
  if (!opsKey) {
    throw new Error(
      "Wicked Ops API key not configured (set OPS_API_KEY env var or PMOS → Integrations).",
    );
  }

  const name =
    projectName?.trim() || `PMOS workspace ${workspaceId}`;

  // 1. Create n8n project
  const projectRes = await doFetch(`${opsUrl}/api/v1/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-N8N-API-KEY": opsKey },
    body: JSON.stringify({ name }),
    timeoutMs: 12000,
  });

  let projectId: string | undefined;
  if (projectRes.ok && projectRes.json && typeof projectRes.json === "object") {
    const pj = projectRes.json as Record<string, unknown>;
    projectId =
      (typeof pj.id === "string" && pj.id) ||
      (typeof pj.projectId === "string" && pj.projectId) ||
      (typeof pj.name === "string" && pj.name) ||
      undefined;
  }

  // 2. Create workspace-scoped API key (try multiple endpoint variants)
  let createdApiKey: string | undefined;
  const keyEndpoints = [
    `${opsUrl}/api/v1/api-keys`,
    `${opsUrl}/api/v1/users-api-keys`,
    `${opsUrl}/api/v1/users/api-keys`,
  ];
  for (const ep of keyEndpoints) {
    const kRes = await doFetch(ep, {
      method: "POST",
      headers: { "content-type": "application/json", "X-N8N-API-KEY": opsKey },
      body: JSON.stringify({ name: `pmos:${workspaceId}` }),
      timeoutMs: 12000,
    });
    if (kRes.ok && kRes.json) {
      const key = extractApiKey(kRes.json);
      if (key) {
        createdApiKey = key;
        break;
      }
      // Some endpoints return the record id as a fallback token
      const j = kRes.json as Record<string, unknown>;
      if (typeof j.id === "string" && j.id) {
        createdApiKey = j.id;
        break;
      }
    }
  }

  if (!projectId && !createdApiKey) {
    const msg = projectRes.error ?? `status=${projectRes.status}`;
    throw new Error(`Failed to provision Wicked Ops for workspace ${workspaceId}: ${msg}`);
  }

  // 3. Persist to connectors file
  const existing = (await readWorkspaceConnectors(workspaceId)) ?? {};
  const next = {
    ...existing,
    ops: {
      ...(existing.ops ?? {}),
      url: opsUrl,
      ...(createdApiKey ? { apiKey: createdApiKey } : {}),
      ...(projectId ? { projectId } : {}),
    },
  };
  await writeWorkspaceConnectors(workspaceId, next);

  return { ok: true, workspaceId, projectId, apiKey: createdApiKey };
}
