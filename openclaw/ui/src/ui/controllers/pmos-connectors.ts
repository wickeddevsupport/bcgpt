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
      basecampConnected?: boolean;
      name?: string | null;
      email?: string | null;
      selectedAccountId?: string | null;
      accountsCount?: number;
      message?: string | null;
    };
  };
  figma?: {
    url: string | null;
    configured: boolean;
    reachable: boolean | null;
    authOk: boolean | null;
    healthUrl?: string | null;
    editorUrl?: string | null;
    error: string | null;
    identity?: {
      connected: boolean;
      handle?: string | null;
      email?: string | null;
      activeConnectionId?: string | null;
      activeConnectionName?: string | null;
      activeTeamId?: string | null;
      totalConnections?: number;
      lastSyncedAt?: string | null;
      selectedFileUrl?: string | null;
      selectedFileId?: string | null;
      selectedFileName?: string | null;
      updatedAt?: string | null;
      message?: string | null;
    };
    mcp?: {
      url: string | null;
      configured: boolean;
      reachable: boolean | null;
      authOk: boolean | null;
      authRequired?: boolean;
      configPath?: string | null;
      transport?: string | null;
      source?: string | null;
      hasPersonalAccessToken?: boolean;
      fallbackAvailable?: boolean;
      authCommand?: string | null;
      error: string | null;
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
  pmosFigmaUrl: string;
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
  pmosBasecampSetupOk?: boolean;
  pmosBasecampSetupError?: string | null;

  // Workflow-engine connections
  pmosWorkflowCredentials: Array<{ id: string; name: string; type: string }> | null;
  pmosWorkflowCredentialsLoading: boolean;
  pmosWorkflowCredentialsError: string | null;
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
  const bcgptUrl = "https://bcgpt.wickedlab.io";
  const figmaUrl =
    (typeof status?.figma?.url === "string" && status.figma.url.trim()
      ? status.figma.url
      : typeof getPath(cfg, ["pmos", "connectors", "figma", "url"]) === "string"
        ? (getPath(cfg, ["pmos", "connectors", "figma", "url"]) as string)
        : "") || "https://fm.wickedlab.io";

  state.pmosOpsUrl = normalizeUrl(opsUrl, "https://flow.wickedlab.io");
  state.pmosBcgptUrl = normalizeUrl(bcgptUrl, "https://bcgpt.wickedlab.io");
  state.pmosFigmaUrl = normalizeUrl(figmaUrl, "https://fm.wickedlab.io");
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
    const bcgptUrl = "https://bcgpt.wickedlab.io";
    const figmaUrl = normalizeUrl(state.pmosFigmaUrl, "https://fm.wickedlab.io");
    const bcgptKey = state.pmosBcgptApiKeyDraft.trim();
    const opsUserEmail = state.pmosOpsUserEmailDraft.trim().toLowerCase();
    const opsUserPassword = state.pmosOpsUserPasswordDraft;
    const opsUserPatch =
      opsUserEmail || opsUserPassword
        ? {
            user: {
              ...(opsUserEmail ? { email: opsUserEmail } : {}),
              ...(opsUserPassword ? { password: opsUserPassword } : {}),
            },
          }
        : {};

    const connectorsPatch: Record<string, unknown> = {
      ops: {
        url: opsUrl,
        ...opsUserPatch,
      },
      bcgpt:
        opts?.clearBcgptKey
          ? { url: bcgptUrl, apiKey: null }
          : !bcgptKey
            ? { url: bcgptUrl }
          : { url: bcgptUrl, apiKey: bcgptKey },
      figma: {
        url: figmaUrl,
      },
    };
    const saveResult = await state.client.request<{
      workflowConnection?: {
        configured?: boolean;
        ok?: boolean;
        credentialId?: string;
        error?: string;
        skippedReason?: "missing_api_key";
      };
    }>("pmos.connectors.workspace.set", { connectors: connectorsPatch });
    state.pmosBcgptApiKeyDraft = "";
    if ("pmosBasecampSetupOk" in state) {
      state.pmosBasecampSetupOk = Boolean(saveResult.workflowConnection?.ok);
    }
    if ("pmosBasecampSetupError" in state) {
      state.pmosBasecampSetupError =
        saveResult.workflowConnection?.configured && saveResult.workflowConnection?.ok === false
          ? saveResult.workflowConnection.error ?? "Flow connection sync failed."
          : null;
    }

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
    const figmaSaved = getPath(workspaceConnectors.connectors, ["figma", "url"]);
    state.pmosOpsUrl = normalizeUrl(
      typeof opsSaved === "string" ? opsSaved : "https://flow.wickedlab.io",
      "https://flow.wickedlab.io",
    );
    state.pmosOpsUserEmailDraft = typeof opsUserEmailSaved === "string" ? opsUserEmailSaved : "";
    state.pmosOpsUserHasSavedPassword = Boolean(opsUserHasPasswordSaved);
    state.pmosOpsUserPasswordDraft = "";
    state.pmosBcgptUrl = normalizeUrl(
      typeof bcgptSaved === "string" && bcgptSaved.trim()
        ? bcgptSaved
        : "https://bcgpt.wickedlab.io",
      "https://bcgpt.wickedlab.io",
    );
    state.pmosFigmaUrl = normalizeUrl(
      typeof figmaSaved === "string" && figmaSaved.trim()
        ? figmaSaved
        : "https://fm.wickedlab.io",
      "https://fm.wickedlab.io",
    );
    state.pmosConnectorDraftsInitialized = true;
  } catch (err) {
    state.pmosIntegrationsError = String(err);
  } finally {
    state.pmosIntegrationsSaving = false;
  }
}

export async function loadPmosWorkflowCredentials(state: PmosConnectorsState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.pmosWorkflowCredentialsLoading = true;
  state.pmosWorkflowCredentialsError = null;
  try {
    let result: { credentials?: Array<{ id: string; name: string; type: string }> };
    try {
      result = await state.client.request<{ credentials?: Array<{ id: string; name: string; type: string }> }>(
        "pmos.flow.credentials.list",
        {},
      );
    } catch {
      try {
        result = await state.client.request<{ credentials?: Array<{ id: string; name: string; type: string }> }>(
          "pmos.workflow.credentials.list",
          {},
        );
      } catch {
        // Backward-compatibility path while older gateways still expose the legacy route.
        result = await state.client.request<{ credentials?: Array<{ id: string; name: string; type: string }> }>(
          "pmos.ops.credentials.list",
          {},
        );
      }
    }
    state.pmosWorkflowCredentials = result.credentials ?? [];
  } catch (err) {
    state.pmosWorkflowCredentialsError = String(err);
    state.pmosWorkflowCredentials = null;
  } finally {
    state.pmosWorkflowCredentialsLoading = false;
  }
}

// Backward-compatible export name kept for existing callers.
export const loadPmosN8nCredentials = loadPmosWorkflowCredentials;
