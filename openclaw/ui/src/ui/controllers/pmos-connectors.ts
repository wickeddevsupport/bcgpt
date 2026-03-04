import type { GatewayBrowserClient } from "../gateway.ts";
import type { ConfigSnapshot } from "../types.ts";

export type PmosConnectorsStatus = {
  checkedAtMs: number;
  ops?: {
    url: string | null;
    projectId?: string | null;
    configured: boolean;
    reachable: boolean | null;
    authOk: boolean | null;
    healthUrl?: string | null;
    editorUrl?: string | null;
    mode?: "embedded" | "remote";
    vendoredRepo?: string | null;
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
    identity?: {
      connected: boolean;
      name?: string | null;
      email?: string | null;
      selectedAccountId?: string | null;
      accountsCount?: number;
      message?: string | null;
    };
  };
};

export type PmosConnectorsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  configSnapshot: ConfigSnapshot | null;

  // Draft fields (UI inputs)
  pmosOpsUrl: string;
  pmosOpsUserEmailDraft: string;
  pmosOpsUserPasswordDraft: string;
  pmosOpsUserHasSavedPassword: boolean;
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

  // n8n Credentials
  pmosN8nCredentials: Array<{ id: string; name: string; type: string }> | null;
  pmosN8nCredentialsLoading: boolean;
  pmosN8nCredentialsError: string | null;
};

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
  const status = state.pmosConnectorsStatus ?? null;
  const opsUrl =
    (typeof status?.ops?.url === "string" && status.ops.url.trim()
      ? status.ops.url
      : typeof getPath(cfg, ["pmos", "connectors", "ops", "url"]) === "string"
        ? (getPath(cfg, ["pmos", "connectors", "ops", "url"]) as string)
        : "") || "https://flow.wickedlab.io";
  const bcgptUrl =
    (typeof status?.bcgpt?.url === "string" && status.bcgpt.url.trim()
      ? status.bcgpt.url
      : typeof getPath(cfg, ["pmos", "connectors", "bcgpt", "url"]) === "string"
        ? (getPath(cfg, ["pmos", "connectors", "bcgpt", "url"]) as string)
        : "") || "https://bcgpt.wickedlab.io";

  state.pmosOpsUrl = normalizeUrl(opsUrl, "https://flow.wickedlab.io");
  state.pmosBcgptUrl = normalizeUrl(bcgptUrl, "https://bcgpt.wickedlab.io");
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
  opts?: { clearBcgptKey?: boolean },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.pmosIntegrationsSaving = true;
  state.pmosIntegrationsError = null;
  try {
    const opsUrl = normalizeUrl(state.pmosOpsUrl, "https://flow.wickedlab.io");
    const bcgptUrl = normalizeUrl(state.pmosBcgptUrl, "https://bcgpt.wickedlab.io");
    const bcgptKey = state.pmosBcgptApiKeyDraft.trim();
    const opsUserEmail = state.pmosOpsUserEmailDraft.trim();
    const opsUserPassword = state.pmosOpsUserPasswordDraft.trim();

    const opsPatch: Record<string, unknown> = { url: opsUrl };
    if (opsUserEmail || opsUserPassword) {
      const userPatch: Record<string, unknown> = {};
      if (opsUserEmail) {
        userPatch.email = opsUserEmail;
      }
      if (opsUserPassword) {
        userPatch.password = opsUserPassword;
      }
      if (Object.keys(userPatch).length > 0) {
        opsPatch.user = userPatch;
      }
    }

    const connectorsPatch: Record<string, unknown> = {
      ops: opsPatch,
      bcgpt:
        opts?.clearBcgptKey
          ? { url: bcgptUrl, apiKey: null }
          : !bcgptKey
            ? { url: bcgptUrl }
          : { url: bcgptUrl, apiKey: bcgptKey },
    };
    await state.client.request("pmos.connectors.workspace.set", { connectors: connectorsPatch });
    state.pmosBcgptApiKeyDraft = "";

    // Keep UI state in sync with persisted workspace connector data.
    const workspaceConnectors = await state.client.request<{
      workspaceId: string;
      connectors: Record<string, unknown>;
    }>("pmos.connectors.workspace.get", {});
    const opsSaved = getPath(workspaceConnectors.connectors, ["ops", "url"]);
    const opsUserEmailSaved = getPath(workspaceConnectors.connectors, ["ops", "user", "email"]);
    const opsUserHasPasswordSaved = getPath(
      workspaceConnectors.connectors,
      ["ops", "user", "hasPassword"],
    );
    const bcgptSaved = getPath(workspaceConnectors.connectors, ["bcgpt", "url"]);
    state.pmosOpsUrl = normalizeUrl(
      typeof opsSaved === "string" ? opsSaved : "https://flow.wickedlab.io",
      "https://flow.wickedlab.io",
    );
    state.pmosOpsUserEmailDraft = typeof opsUserEmailSaved === "string" ? opsUserEmailSaved : "";
    state.pmosOpsUserHasSavedPassword = Boolean(opsUserHasPasswordSaved);
    state.pmosOpsUserPasswordDraft = "";
    state.pmosBcgptUrl = normalizeUrl(
      typeof bcgptSaved === "string" ? bcgptSaved : "https://bcgpt.wickedlab.io",
      "https://bcgpt.wickedlab.io",
    );
    state.pmosConnectorDraftsInitialized = true;
  } catch (err) {
    state.pmosIntegrationsError = String(err);
  } finally {
    state.pmosIntegrationsSaving = false;
  }
}

export async function loadPmosN8nCredentials(state: PmosConnectorsState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.pmosN8nCredentialsLoading = true;
  state.pmosN8nCredentialsError = null;
  try {
    const result = await state.client.request<{ credentials?: Array<{ id: string; name: string; type: string }> }>("pmos.ops.credentials.list", {});
    state.pmosN8nCredentials = result.credentials ?? [];
  } catch (err) {
    state.pmosN8nCredentialsError = String(err);
    state.pmosN8nCredentials = null;
  } finally {
    state.pmosN8nCredentialsLoading = false;
  }
}
