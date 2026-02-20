import type { GatewayBrowserClient } from "../gateway.ts";

export type PmosModelProvider = "openai" | "anthropic" | "google" | "zai" | "openrouter" | "kilo" | "moonshot" | "nvidia" | "custom";

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
  { value: "kilo", label: "Kilo", defaultModelId: "kilo/z-ai/glm-5:free" },
  { value: "moonshot", label: "Kimi (Moonshot)", defaultModelId: "moonshotai/kimi-k2.5" },
  { value: "nvidia", label: "NVIDIA NIM", defaultModelId: "minimaxai/minimax-m2.1" },
  { value: "custom", label: "Custom (enter manually)", defaultModelId: "" },
];

export const PMOS_MODEL_DEFAULTS: Record<PmosModelProvider, string> = PMOS_MODEL_PROVIDER_OPTIONS.reduce(
  (acc, entry) => {
    acc[entry.value] = entry.defaultModelId;
    return acc;
  },
  {} as Record<PmosModelProvider, string>,
);


export type PmosModelAuthState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  pmosModelProvider: PmosModelProvider;
  pmosModelId: string;
  pmosModelAlias: string;
  pmosModelApiKeyDraft: string;
  pmosModelSaving: boolean;
  pmosModelError: string | null;
  pmosModelConfigured: boolean;
  // Cached from pmos.byok.list so provider switching can update the "configured" chip without refetching.
  pmosByokProviders?: PmosModelProvider[];
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

export function hydratePmosModelDraftFromConfig(state: PmosModelAuthState) {
  // This controller used to hydrate from global config.get (which is shared across workspaces).
  // For PMOS multi-tenant BYOK, the source of truth is workspace config + encrypted per-workspace BYOK store.
  state.pmosModelId = state.pmosModelId.trim() || PMOS_MODEL_DEFAULTS[state.pmosModelProvider];
  state.pmosModelAlias = state.pmosModelAlias ?? "";
  const byokProviders = state.pmosByokProviders ?? [];
  state.pmosModelConfigured = byokProviders.includes(state.pmosModelProvider);
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
  const byokProviders = state.pmosByokProviders ?? [];
  state.pmosModelConfigured = byokProviders.includes(provider);
}

function hydrateFromEffectiveConfig(state: PmosModelAuthState, cfg: unknown) {
  const primary = asNonEmptyString(getPath(cfg, ["agents", "defaults", "model", "primary"]));
  const parsedPrimary = parsePrimaryModelRef(primary);
  if (parsedPrimary) {
    state.pmosModelProvider = parsedPrimary.provider;
    state.pmosModelId = parsedPrimary.modelId;
  } else {
    state.pmosModelId = state.pmosModelId.trim() || PMOS_MODEL_DEFAULTS[state.pmosModelProvider];
  }

  const modelRef = `${state.pmosModelProvider}/${state.pmosModelId}`;
  const alias = asNonEmptyString(getPath(cfg, ["agents", "defaults", "models", modelRef, "alias"])) ?? "";
  state.pmosModelAlias = alias;
}

export async function loadPmosModelWorkspaceState(state: PmosModelAuthState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.pmosModelError = null;
  try {
    const ws = await state.client.request<{
      workspaceId: string;
      workspaceConfig: unknown;
      effectiveConfig: unknown;
    }>("pmos.config.workspace.get", {});
    hydrateFromEffectiveConfig(state, ws.effectiveConfig);

    const byok = await state.client.request<{
      workspaceId: string;
      keys: Array<{ provider: string }>;
    }>("pmos.byok.list", {});
    const providers = byok.keys
      .map((k) => (typeof k.provider === "string" ? k.provider.trim() : ""))
      .filter(Boolean)
      .filter((p): p is PmosModelProvider => isProvider(p));
    state.pmosByokProviders = providers;
    state.pmosModelConfigured = providers.includes(state.pmosModelProvider);
  } catch (err) {
    state.pmosModelError = String(err);
  }
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
    const modelRef = `${provider}/${modelId}`;
    // 1) Persist model selection to workspace config (not global config)
    const patch: Record<string, unknown> = {};
    setPath(patch, ["agents", "defaults", "model", "primary"], modelRef);
    // Deep-merge can't delete; set blank string when alias cleared so hydrate ignores it.
    setPath(patch, ["agents", "defaults", "models", modelRef, "alias"], alias || "");
    await state.client.request("pmos.config.workspace.set", { patch });

    // 2) Persist API key to encrypted workspace BYOK store
    if (apiKeyDraft) {
      await state.client.request("pmos.byok.set", {
        provider,
        apiKey: apiKeyDraft,
        defaultModel: modelId,
        label: `${provider} key`,
      });
    }

    state.pmosModelApiKeyDraft = "";
    await loadPmosModelWorkspaceState(state);
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
    await state.client.request("pmos.byok.remove", { provider: state.pmosModelProvider });
    state.pmosModelApiKeyDraft = "";
    await loadPmosModelWorkspaceState(state);
  } catch (err) {
    state.pmosModelError = String(err);
  } finally {
    state.pmosModelSaving = false;
  }
}
