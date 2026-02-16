import type { GatewayBrowserClient } from "../gateway.ts";
import type { ConfigSnapshot } from "../types.ts";

export type PmosConnectorsStatus = {
  checkedAtMs: number;
  activepieces: {
    url: string | null;
    projectId?: string | null;
    configured: boolean;
    reachable: boolean | null;
    authOk: boolean | null;
    flagsUrl: string | null;
    authUrl: string | null;
    error: string | null;
  };
  bcgpt: {
    url: string | null;
    configured: boolean;
    reachable: boolean | null;
    authOk: boolean | null;
    healthUrl: string | null;
    mcpUrl: string | null;
    error: string | null;
  };
};

export type PmosConnectorsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  configSnapshot: ConfigSnapshot | null;

  // Draft fields (UI inputs)
  pmosActivepiecesUrl: string;
  pmosActivepiecesProjectId: string;
  pmosActivepiecesApiKeyDraft: string;
  pmosBcgptUrl: string;
  pmosBcgptApiKeyDraft: string;
  pmosConnectorDraftsInitialized: boolean;

  // Status fields
  pmosConnectorsLoading: boolean;
  pmosConnectorsStatus: PmosConnectorsStatus | null;
  pmosConnectorsError: string | null;
  pmosConnectorsLastChecked: number | null;

  // Save fields
  pmosIntegrationsSaving: boolean;
  pmosIntegrationsError: string | null;
};

function deepClone<T>(value: T): T {
  return value && typeof value === "object" ? (JSON.parse(JSON.stringify(value)) as T) : value;
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown) {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length; i++) {
    const key = path[i]!;
    if (i === path.length - 1) {
      cur[key] = value;
      return;
    }
    const next = cur[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
}

function deletePath(obj: Record<string, unknown>, path: string[]) {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const next = cur[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    cur = next as Record<string, unknown>;
  }
  delete cur[path[path.length - 1]!];
}

function normalizeUrl(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function hydratePmosConnectorDraftsFromConfig(state: PmosConnectorsState) {
  if (state.pmosConnectorDraftsInitialized) {
    return;
  }
  const cfg = state.configSnapshot?.config ?? null;
  const apUrl =
    (typeof getPath(cfg, ["pmos", "connectors", "activepieces", "url"]) === "string"
      ? (getPath(cfg, ["pmos", "connectors", "activepieces", "url"]) as string)
      : "") || "https://flow.wickedlab.io";
  const bcgptUrl =
    (typeof getPath(cfg, ["pmos", "connectors", "bcgpt", "url"]) === "string"
      ? (getPath(cfg, ["pmos", "connectors", "bcgpt", "url"]) as string)
      : "") || "https://bcgpt.wickedlab.io";
  const apProjectId =
    (typeof getPath(cfg, ["pmos", "connectors", "activepieces", "projectId"]) === "string"
      ? (getPath(cfg, ["pmos", "connectors", "activepieces", "projectId"]) as string)
      : "") || "";

  state.pmosActivepiecesUrl = normalizeUrl(apUrl, "https://flow.wickedlab.io");
  state.pmosBcgptUrl = normalizeUrl(bcgptUrl, "https://bcgpt.wickedlab.io");
  state.pmosActivepiecesProjectId = apProjectId.trim();
  state.pmosConnectorDraftsInitialized = true;
}

export async function loadPmosConnectorsStatus(state: PmosConnectorsState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.pmosConnectorsLoading = true;
  state.pmosConnectorsError = null;
  try {
    const res = await state.client.request<PmosConnectorsStatus>("pmos.connectors.status", {});
    state.pmosConnectorsStatus = res;
    state.pmosConnectorsLastChecked = Date.now();
  } catch (err) {
    state.pmosConnectorsError = String(err);
  } finally {
    state.pmosConnectorsLoading = false;
  }
}

export async function savePmosConnectorsConfig(
  state: PmosConnectorsState,
  opts?: { clearActivepiecesKey?: boolean; clearBcgptKey?: boolean },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.pmosIntegrationsSaving = true;
  state.pmosIntegrationsError = null;
  try {
    const snapshot = await state.client.request<ConfigSnapshot>("config.get", {});
    const baseHash = snapshot.hash;
    if (!baseHash) {
      state.pmosIntegrationsError = "Config hash missing; reload and retry.";
      return;
    }
    const nextConfig = deepClone((snapshot.config ?? {}) as Record<string, unknown>);

    const apUrl = normalizeUrl(state.pmosActivepiecesUrl, "https://flow.wickedlab.io");
    const bcgptUrl = normalizeUrl(state.pmosBcgptUrl, "https://bcgpt.wickedlab.io");

    setPath(nextConfig, ["pmos", "connectors", "activepieces", "url"], apUrl);
    setPath(nextConfig, ["pmos", "connectors", "bcgpt", "url"], bcgptUrl);

    const apProjectId = state.pmosActivepiecesProjectId.trim();
    if (apProjectId) {
      setPath(nextConfig, ["pmos", "connectors", "activepieces", "projectId"], apProjectId);
    } else {
      deletePath(nextConfig, ["pmos", "connectors", "activepieces", "projectId"]);
    }

    const apKey = state.pmosActivepiecesApiKeyDraft.trim();
    const bcgptKey = state.pmosBcgptApiKeyDraft.trim();

    if (opts?.clearActivepiecesKey) {
      deletePath(nextConfig, ["pmos", "connectors", "activepieces", "apiKey"]);
      state.pmosActivepiecesApiKeyDraft = "";
    } else if (apKey) {
      setPath(nextConfig, ["pmos", "connectors", "activepieces", "apiKey"], apKey);
      state.pmosActivepiecesApiKeyDraft = "";
    }

    if (opts?.clearBcgptKey) {
      deletePath(nextConfig, ["pmos", "connectors", "bcgpt", "apiKey"]);
      state.pmosBcgptApiKeyDraft = "";
    } else if (bcgptKey) {
      setPath(nextConfig, ["pmos", "connectors", "bcgpt", "apiKey"], bcgptKey);
      state.pmosBcgptApiKeyDraft = "";
    }

    const raw = JSON.stringify(nextConfig, null, 2).trimEnd().concat("\n");
    await state.client.request("config.set", { raw, baseHash });
    // Keep the UI state in sync with what is persisted.
    state.configSnapshot = await state.client.request<ConfigSnapshot>("config.get", {});
  } catch (err) {
    state.pmosIntegrationsError = String(err);
  } finally {
    state.pmosIntegrationsSaving = false;
  }
}
