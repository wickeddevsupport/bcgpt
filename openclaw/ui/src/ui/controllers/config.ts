import type { GatewayBrowserClient } from "../gateway.ts";
import type { ConfigSchemaResponse, ConfigSnapshot, ConfigUiHints } from "../types.ts";
import type { PmosAuthUser } from "./pmos-auth.ts";
import JSON5 from "json5";
import {
  cloneConfigObject,
  removePathValue,
  serializeConfigForm,
  setPathValue,
} from "./config/form-utils.ts";

export type ConfigState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  applySessionKey: string;
  pmosAuthUser?: PmosAuthUser | null;
  configLoading: boolean;
  configRaw: string;
  configRawOriginal: string;
  configValid: boolean | null;
  configIssues: unknown[];
  configSaving: boolean;
  configApplying: boolean;
  updateRunning: boolean;
  configSnapshot: ConfigSnapshot | null;
  configSchema: unknown;
  configSchemaVersion: string | null;
  configSchemaLoading: boolean;
  configUiHints: ConfigUiHints;
  configForm: Record<string, unknown> | null;
  configFormOriginal: Record<string, unknown> | null;
  configFormDirty: boolean;
  configFormMode: "form" | "raw";
  configSearchQuery: string;
  configActiveSection: string | null;
  configActiveSubsection: string | null;
  lastError: string | null;
};

function useWorkspaceScopedConfig(state: Pick<ConfigState, "pmosAuthUser">): boolean {
  // All authenticated users (including super_admin) use workspace-scoped config so that
  // the Config panel, Model panel, and Agent panel all read/write the SAME config source.
  // Super-admin–only global settings will be routed to a dedicated admin page later.
  return state.pmosAuthUser != null;
}

function buildWorkspaceScopedSnapshot(res: {
  workspaceId?: string;
  workspaceConfig?: unknown;
  effectiveConfig?: unknown;
}): ConfigSnapshot {
  // Show the effective (merged global+workspace) config for display so the form
  // is pre-populated with inherited global settings. Saves still go to the
  // workspace overlay via pmos.config.workspace.set.
  const displayConfig =
    res.effectiveConfig && typeof res.effectiveConfig === "object" && !Array.isArray(res.effectiveConfig)
      ? (res.effectiveConfig as Record<string, unknown>)
      : res.workspaceConfig && typeof res.workspaceConfig === "object" && !Array.isArray(res.workspaceConfig)
        ? (res.workspaceConfig as Record<string, unknown>)
        : {};
  return {
    hash: `workspace:${typeof res.workspaceId === "string" ? res.workspaceId : "current"}`,
    config: displayConfig,
    raw: JSON.stringify(displayConfig, null, 2),
    valid: true,
    issues: [],
  };
}

function parseWorkspaceRawConfig(raw: string): Record<string, unknown> {
  const parsed = JSON5.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Workspace config must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export async function loadConfig(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.configLoading = true;
  state.lastError = null;
  try {
    if (useWorkspaceScopedConfig(state)) {
      const res = await state.client.request<{
        workspaceId?: string;
        workspaceConfig?: unknown;
        effectiveConfig?: unknown;
      }>("pmos.config.workspace.get", {});
      applyConfigSnapshot(state, buildWorkspaceScopedSnapshot(res));
    } else {
      const res = await state.client.request<ConfigSnapshot>("config.get", {});
      applyConfigSnapshot(state, res);
    }
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configLoading = false;
  }
}

export async function loadConfigSchema(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.configSchemaLoading) {
    return;
  }
  state.configSchemaLoading = true;
  try {
    const res = await state.client.request<ConfigSchemaResponse>("config.schema", {});
    applyConfigSchema(state, res);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configSchemaLoading = false;
  }
}

export function applyConfigSchema(state: ConfigState, res: ConfigSchemaResponse) {
  state.configSchema = res.schema ?? null;
  state.configUiHints = res.uiHints ?? {};
  state.configSchemaVersion = res.version ?? null;
}

export function applyConfigSnapshot(state: ConfigState, snapshot: ConfigSnapshot) {
  state.configSnapshot = snapshot;
  const rawFromSnapshot =
    typeof snapshot.raw === "string"
      ? snapshot.raw
      : snapshot.config && typeof snapshot.config === "object"
        ? serializeConfigForm(snapshot.config)
        : state.configRaw;
  if (!state.configFormDirty || state.configFormMode === "raw") {
    state.configRaw = rawFromSnapshot;
  } else if (state.configForm) {
    state.configRaw = serializeConfigForm(state.configForm);
  } else {
    state.configRaw = rawFromSnapshot;
  }
  state.configValid = typeof snapshot.valid === "boolean" ? snapshot.valid : null;
  state.configIssues = Array.isArray(snapshot.issues) ? snapshot.issues : [];

  if (!state.configFormDirty) {
    state.configForm = cloneConfigObject(snapshot.config ?? {});
    state.configFormOriginal = cloneConfigObject(snapshot.config ?? {});
    state.configRawOriginal = rawFromSnapshot;
  }
}

export async function saveConfig(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.configSaving = true;
  state.lastError = null;
  try {
    if (useWorkspaceScopedConfig(state)) {
      const nextConfig =
        state.configFormMode === "form" && state.configForm
          ? cloneConfigObject(state.configForm)
          : parseWorkspaceRawConfig(state.configRaw);
      await state.client.request("pmos.config.workspace.set", {
        patch: nextConfig,
        replace: true,
      });
      state.configFormDirty = false;
      await loadConfig(state);
      return;
    }
    const raw =
      state.configFormMode === "form" && state.configForm
        ? serializeConfigForm(state.configForm)
        : state.configRaw;
    const baseHash = state.configSnapshot?.hash;
    if (!baseHash) {
      state.lastError = "Config hash missing; reload and retry.";
      return;
    }
    await state.client.request("config.set", { raw, baseHash });
    state.configFormDirty = false;
    await loadConfig(state);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configSaving = false;
  }
}

export async function applyConfig(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.configApplying = true;
  state.lastError = null;
  try {
    if (useWorkspaceScopedConfig(state)) {
      // Workspace overlays do not use the global config.apply path.
      await saveConfig(state);
      return;
    }
    const raw =
      state.configFormMode === "form" && state.configForm
        ? serializeConfigForm(state.configForm)
        : state.configRaw;
    const baseHash = state.configSnapshot?.hash;
    if (!baseHash) {
      state.lastError = "Config hash missing; reload and retry.";
      return;
    }
    await state.client.request("config.apply", {
      raw,
      baseHash,
      sessionKey: state.applySessionKey,
    });
    state.configFormDirty = false;
    await loadConfig(state);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.configApplying = false;
  }
}

export async function runUpdate(state: ConfigState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.updateRunning = true;
  state.lastError = null;
  try {
    if (useWorkspaceScopedConfig(state)) {
      state.lastError = "Update is only available to super admins.";
      return;
    }
    await state.client.request("update.run", {
      sessionKey: state.applySessionKey,
    });
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.updateRunning = false;
  }
}

export function updateConfigFormValue(
  state: ConfigState,
  path: Array<string | number>,
  value: unknown,
) {
  const base = cloneConfigObject(state.configForm ?? state.configSnapshot?.config ?? {});
  setPathValue(base, path, value);
  state.configForm = base;
  state.configFormDirty = true;
  if (state.configFormMode === "form") {
    state.configRaw = serializeConfigForm(base);
  }
}

export function removeConfigFormValue(state: ConfigState, path: Array<string | number>) {
  const base = cloneConfigObject(state.configForm ?? state.configSnapshot?.config ?? {});
  removePathValue(base, path);
  state.configForm = base;
  state.configFormDirty = true;
  if (state.configFormMode === "form") {
    state.configRaw = serializeConfigForm(base);
  }
}
