import type { GatewayBrowserClient } from "../gateway.ts";
import type { ConfigSnapshot } from "../types.ts";

export type PmosModelProvider = "openai" | "anthropic" | "google" | "zai" | "openrouter";

export const PMOS_MODEL_PROVIDER_OPTIONS: Array<{
  value: PmosModelProvider;
  label: string;
  defaultModelId: string;
}> = [
  { value: "google", label: "Google Gemini", defaultModelId: "gemini-3-flash-preview" },
  { value: "openai", label: "OpenAI", defaultModelId: "gpt-5.2" },
  { value: "anthropic", label: "Anthropic", defaultModelId: "claude-opus-4-6" },
  { value: "zai", label: "GLM (Z.AI)", defaultModelId: "glm-4.7" },
  { value: "openrouter", label: "OpenRouter", defaultModelId: "google/gemini-2.0-flash:free" },
];

export const PMOS_MODEL_DEFAULTS: Record<PmosModelProvider, string> = PMOS_MODEL_PROVIDER_OPTIONS.reduce(
  (acc, entry) => {
    acc[entry.value] = entry.defaultModelId;
    return acc;
  },
  {} as Record<PmosModelProvider, string>,
);

const PMOS_MODEL_ENV_BY_PROVIDER: Record<PmosModelProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  zai: "ZAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const REDACTED_SENTINEL = "__OPENCLAW_REDACTED__";

export type PmosModelAuthState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  applySessionKey: string;
  configSnapshot: ConfigSnapshot | null;
  pmosModelProvider: PmosModelProvider;
  pmosModelId: string;
  pmosModelAlias: string;
  pmosModelApiKeyDraft: string;
  pmosModelSaving: boolean;
  pmosModelError: string | null;
  pmosModelConfigured: boolean;
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
  for (let i = 0; i < path.length; i += 1) {
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
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    const next = cur[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      return;
    }
    cur = next as Record<string, unknown>;
  }
  delete cur[path[path.length - 1]!];
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isProvider(value: string): value is PmosModelProvider {
  return value in PMOS_MODEL_DEFAULTS;
}

function parsePrimaryModelRef(value: string | null): { provider: PmosModelProvider; modelId: string } | null {
  if (!value) {
    return null;
  }
  const parts = value.split("/");
  if (parts.length < 2) {
    return null;
  }
  const providerRaw = parts.shift()?.trim().toLowerCase() ?? "";
  const modelId = parts.join("/").trim();
  if (!isProvider(providerRaw) || !modelId) {
    return null;
  }
  return { provider: providerRaw, modelId };
}

function resolveModelApiKeyFromConfig(config: unknown, provider: PmosModelProvider): string | null {
  const envVar = PMOS_MODEL_ENV_BY_PROVIDER[provider];
  return (
    asNonEmptyString(getPath(config, ["env", "vars", envVar])) ??
    asNonEmptyString(getPath(config, ["env", envVar])) ??
    asNonEmptyString(getPath(config, ["models", "providers", provider, "apiKey"]))
  );
}

export function hydratePmosModelDraftFromConfig(state: PmosModelAuthState) {
  const cfg = state.configSnapshot?.config ?? null;
  const primary = asNonEmptyString(getPath(cfg, ["agents", "defaults", "model", "primary"]));
  const parsedPrimary = parsePrimaryModelRef(primary);

  if (parsedPrimary) {
    state.pmosModelProvider = parsedPrimary.provider;
    state.pmosModelId = parsedPrimary.modelId;
  } else {
    state.pmosModelId = state.pmosModelId.trim() || PMOS_MODEL_DEFAULTS[state.pmosModelProvider];
  }

  const modelRef = `${state.pmosModelProvider}/${state.pmosModelId}`;
  const alias =
    asNonEmptyString(getPath(cfg, ["agents", "defaults", "models", modelRef, "alias"])) ?? "";
  state.pmosModelAlias = alias;

  const keyValue = resolveModelApiKeyFromConfig(cfg, state.pmosModelProvider);
  state.pmosModelConfigured = Boolean(keyValue && keyValue.length > 0);
}

export function setPmosModelProvider(state: PmosModelAuthState, provider: PmosModelProvider) {
  if (state.pmosModelProvider === provider) {
    return;
  }
  const previousDefault = PMOS_MODEL_DEFAULTS[state.pmosModelProvider];
  state.pmosModelProvider = provider;
  if (!state.pmosModelId.trim() || state.pmosModelId === previousDefault) {
    state.pmosModelId = PMOS_MODEL_DEFAULTS[provider];
  }
  state.pmosModelError = null;
  const cfg = state.configSnapshot?.config ?? null;
  state.pmosModelConfigured = Boolean(resolveModelApiKeyFromConfig(cfg, provider));
}

export async function savePmosModelConfig(state: PmosModelAuthState) {
  if (!state.client || !state.connected) {
    return;
  }
  const provider = state.pmosModelProvider;
  const modelId = state.pmosModelId.trim();
  const alias = state.pmosModelAlias.trim();
  const apiKeyDraft = state.pmosModelApiKeyDraft.trim();
  if (!modelId) {
    state.pmosModelError = "Model ID is required.";
    return;
  }

  state.pmosModelSaving = true;
  state.pmosModelError = null;
  try {
    const snapshot = await state.client.request<ConfigSnapshot>("config.get", {});
    const baseHash = snapshot.hash;
    if (!baseHash) {
      state.pmosModelError = "Config hash missing; reload and retry.";
      return;
    }

    const nextConfig = deepClone((snapshot.config ?? {}) as Record<string, unknown>);
    const modelRef = `${provider}/${modelId}`;
    setPath(nextConfig, ["agents", "defaults", "model", "primary"], modelRef);
    setPath(nextConfig, ["agents", "defaults", "models", modelRef], {});
    if (alias) {
      setPath(nextConfig, ["agents", "defaults", "models", modelRef, "alias"], alias);
    } else {
      deletePath(nextConfig, ["agents", "defaults", "models", modelRef, "alias"]);
    }

    if (apiKeyDraft) {
      const envVar = PMOS_MODEL_ENV_BY_PROVIDER[provider];
      setPath(nextConfig, ["env", "vars", envVar], apiKeyDraft);
    }

    const raw = JSON.stringify(nextConfig, null, 2).trimEnd().concat("\n");
    await state.client.request("config.apply", {
      raw,
      baseHash,
      sessionKey: state.applySessionKey,
    });

    state.pmosModelApiKeyDraft = "";
    state.pmosModelConfigured = true;

    try {
      state.configSnapshot = await state.client.request<ConfigSnapshot>("config.get", {});
    } catch {
      // Gateway may be restarting after apply; keep the local state optimistic.
      state.configSnapshot = snapshot;
    }
  } catch (err) {
    state.pmosModelError = String(err);
  } finally {
    state.pmosModelSaving = false;
  }
}

export async function clearPmosModelApiKey(state: PmosModelAuthState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.pmosModelSaving = true;
  state.pmosModelError = null;
  try {
    const snapshot = await state.client.request<ConfigSnapshot>("config.get", {});
    const baseHash = snapshot.hash;
    if (!baseHash) {
      state.pmosModelError = "Config hash missing; reload and retry.";
      return;
    }

    const nextConfig = deepClone((snapshot.config ?? {}) as Record<string, unknown>);
    const envVar = PMOS_MODEL_ENV_BY_PROVIDER[state.pmosModelProvider];
    deletePath(nextConfig, ["env", "vars", envVar]);
    deletePath(nextConfig, ["env", envVar]);
    deletePath(nextConfig, ["models", "providers", state.pmosModelProvider, "apiKey"]);

    const raw = JSON.stringify(nextConfig, null, 2).trimEnd().concat("\n");
    await state.client.request("config.set", { raw, baseHash });

    state.pmosModelApiKeyDraft = "";
    state.pmosModelConfigured = false;
    state.configSnapshot = await state.client.request<ConfigSnapshot>("config.get", {});
  } catch (err) {
    state.pmosModelError = String(err);
  } finally {
    state.pmosModelSaving = false;
  }
}
