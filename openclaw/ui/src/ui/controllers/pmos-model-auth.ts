import type { GatewayBrowserClient } from "../gateway.ts";

export const PMOS_KNOWN_MODEL_PROVIDERS = [
  "ollama",
  "local-ollama",
  "openai",
  "anthropic",
  "google",
  "zai",
  "openrouter",
  "kilo",
  "moonshot",
  "nvidia",
  "custom",
] as const;

export type PmosKnownModelProvider = (typeof PMOS_KNOWN_MODEL_PROVIDERS)[number];
export type PmosModelProvider = string;

export type PmosModelRow = {
  ref: string;
  provider: string;
  modelId: string;
  alias: string;
  active: boolean;
  keyConfigured: boolean;
  providerReady: boolean;
  sharedProvider: boolean;
  inCatalog: boolean;
  usedBy: string[];
  workspaceOverride: boolean;
};

export type PmosAgentModelAssignment = {
  agentId: string;
  label: string;
  modelRef: string | null;
  inherited: boolean;
};

export const PMOS_MODEL_PROVIDER_OPTIONS: Array<{
  value: PmosKnownModelProvider;
  label: string;
  defaultModelId: string;
}> = [
  { value: "ollama", label: "Local Ollama (Shared)", defaultModelId: "qwen3:1.7b" },
  { value: "google", label: "Google Gemini", defaultModelId: "gemini-3-flash-preview" },
  { value: "openai", label: "OpenAI", defaultModelId: "gpt-5.2" },
  { value: "anthropic", label: "Anthropic", defaultModelId: "claude-opus-4-6" },
  { value: "zai", label: "GLM (Z.AI)", defaultModelId: "glm-4.7" },
  { value: "openrouter", label: "OpenRouter", defaultModelId: "google/gemini-2.0-flash:free" },
  { value: "kilo", label: "Kilo (Free)", defaultModelId: "minimax/minimax-m2.5:free" },
  { value: "moonshot", label: "Kimi (Moonshot)", defaultModelId: "moonshotai/kimi-k2.5" },
  { value: "nvidia", label: "NVIDIA NIM", defaultModelId: "moonshotai/kimi-k2.5" },
  { value: "custom", label: "Custom (enter manually)", defaultModelId: "" },
];

export const PMOS_MODEL_DEFAULTS: Record<string, string> =
  PMOS_MODEL_PROVIDER_OPTIONS.reduce(
    (acc, entry) => {
      acc[entry.value] = entry.defaultModelId;
      return acc;
    },
    {} as Record<string, string>,
  );
PMOS_MODEL_DEFAULTS["local-ollama"] = PMOS_MODEL_DEFAULTS.ollama ?? "qwen3:1.7b";

export type PmosModelAuthState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  pmosModelProvider: PmosModelProvider;
  pmosModelId: string;
  pmosModelAlias: string;
  pmosModelApiKeyDraft: string;
  /** API base URL for the selected provider (e.g. https://api.kilo.ai/v1). Written to models.providers.{p}.baseUrl */
  pmosModelBaseUrl: string;
  /** API type override for the provider (e.g. openai-completions, anthropic-messages). Written to models.providers.{p}.api */
  pmosModelApiType: string;
  pmosModelSaving: boolean;
  pmosModelError: string | null;
  pmosModelConfigured: boolean;
  pmosModelApiKeyStored?: boolean;
  // Cached providers that currently have keys in config.models.providers.*.apiKey.
  pmosByokProviders?: PmosModelProvider[];
  // Cached config snapshots for the model manager UX.
  pmosWorkspaceConfig?: Record<string, unknown> | null;
  pmosEffectiveConfig?: Record<string, unknown> | null;
  pmosModelRows?: PmosModelRow[];
  pmosAgentModelAssignments?: PmosAgentModelAssignment[];
  pmosModelCatalogLoading?: boolean;
  pmosModelCatalogError?: string | null;
  availableModels?: string[];
  pmosModelRefDraft?: string;
};

const PMOS_SHARED_PROVIDER_ALLOWLIST = new Set([
  "local-ollama",
  "ollama",
  "kilo",
  "ollama-cloud",
  "github-copilot",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
  if (path.length === 0) {
    return;
  }
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

function deepClone<T>(value: T): T {
  return value && typeof value === "object" ? (JSON.parse(JSON.stringify(value)) as T) : value;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePmosProvider(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "local-ollama") {
    return "ollama";
  }
  return normalized;
}

function getDefaultModelIdForProvider(provider: string): string {
  return PMOS_MODEL_DEFAULTS[normalizePmosProvider(provider)] ?? "";
}

function parsePrimaryModelRef(value: string | null): { provider: string; modelId: string } | null {
  if (!value) {
    return null;
  }
  const parts = value.split("/");
  if (parts.length < 2) {
    return null;
  }
  const providerRaw = normalizePmosProvider(parts.shift() ?? "");
  const modelId = parts.join("/").trim();
  if (!providerRaw || !modelId) {
    return null;
  }
  return { provider: providerRaw, modelId };
}

function normalizeModelRef(modelRef: string): string {
  const parsed = parsePrimaryModelRef(modelRef);
  if (!parsed) {
    return "";
  }
  return `${parsed.provider}/${parsed.modelId}`;
}

function resolvePrimaryModel(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = normalizeModelRef(value);
    return normalized || null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const primary = (value as { primary?: unknown }).primary;
  if (typeof primary !== "string") {
    return null;
  }
  const normalized = normalizeModelRef(primary);
  return normalized || null;
}

function collectModelRefsFromConfig(cfg: unknown): Set<string> {
  const refs = new Set<string>();
  const addRef = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const normalized = normalizeModelRef(value);
    if (normalized) {
      refs.add(normalized);
    }
  };

  addRef(getPath(cfg, ["agents", "defaults", "model", "primary"]));
  const defaultFallbacks = getPath(cfg, ["agents", "defaults", "model", "fallbacks"]);
  if (Array.isArray(defaultFallbacks)) {
    for (const fallback of defaultFallbacks) {
      addRef(fallback);
    }
  }

  const defaultsModels = getPath(cfg, ["agents", "defaults", "models"]);
  if (isRecord(defaultsModels)) {
    for (const key of Object.keys(defaultsModels)) {
      addRef(key);
    }
  }

  const agents = getPath(cfg, ["agents", "list"]);
  if (Array.isArray(agents)) {
    for (const agent of agents) {
      if (!isRecord(agent)) {
        continue;
      }
      const modelValue = agent.model;
      addRef(resolvePrimaryModel(modelValue));
      if (isRecord(modelValue) && Array.isArray(modelValue.fallbacks)) {
        for (const fallback of modelValue.fallbacks) {
          addRef(fallback);
        }
      }
    }
  }

  return refs;
}

function readAgentEntries(cfg: unknown): Array<Record<string, unknown>> {
  const list = getPath(cfg, ["agents", "list"]);
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((entry): entry is Record<string, unknown> => isRecord(entry));
}

function resolveAgentLabel(entry: Record<string, unknown>): string {
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  if (name) {
    return name;
  }
  const identity = entry.identity;
  if (isRecord(identity)) {
    const identityName = identity.name;
    if (typeof identityName === "string" && identityName.trim()) {
      return identityName.trim();
    }
  }
  return id || "agent";
}

function listConfiguredModels(cfg: unknown): Record<string, { alias?: string }> {
  const raw = getPath(cfg, ["agents", "defaults", "models"]);
  if (!isRecord(raw)) {
    return {};
  }
  const out: Record<string, { alias?: string }> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = normalizeModelRef(key);
    if (!normalizedKey) {
      continue;
    }
    const alias = isRecord(value) ? asNonEmptyString(value.alias) : null;
    out[normalizedKey] = alias ? { alias } : {};
  }
  return out;
}

function listConfiguredProvidersFromConfig(cfg: unknown): string[] {
  const raw = getPath(cfg, ["models", "providers"]);
  if (!isRecord(raw)) {
    return [];
  }
  const out = new Set<string>();
  for (const [providerKey, providerCfg] of Object.entries(raw)) {
    if (!isRecord(providerCfg)) {
      continue;
    }
    const apiKey = asNonEmptyString(providerCfg.apiKey);
    if (!apiKey) {
      continue;
    }
    const normalized = normalizePmosProvider(providerKey);
    out.add(normalized);
  }
  return Array.from(out);
}

function listSharedProvidersFromEffectiveConfig(cfg: unknown): string[] {
  const raw = getPath(cfg, ["models", "providers"]);
  if (!isRecord(raw)) {
    return [];
  }
  const out = new Set<string>();
  for (const [providerKey, providerCfg] of Object.entries(raw)) {
    if (!isRecord(providerCfg)) {
      continue;
    }
    const normalized = normalizePmosProvider(providerKey);
    if (!normalized) {
      continue;
    }
    const explicitlyShared =
      providerCfg.sharedForWorkspaces === true || providerCfg.shared === true;
    const allowlistedShared = PMOS_SHARED_PROVIDER_ALLOWLIST.has(normalized);
    if (!explicitlyShared && !allowlistedShared) {
      continue;
    }
    const hasUsableConfig =
      asNonEmptyString(providerCfg.baseUrl) ||
      Array.isArray(providerCfg.models) ||
      asNonEmptyString(providerCfg.api);
    if (!hasUsableConfig) {
      continue;
    }
    out.add(normalized);
  }
  return Array.from(out);
}

function resolveProviderConfigKey(cfg: Record<string, unknown>, provider: string): string | null {
  const providers = getPath(cfg, ["models", "providers"]);
  if (!isRecord(providers)) {
    return null;
  }
  const normalized = normalizePmosProvider(provider);
  for (const key of Object.keys(providers)) {
    if (normalizePmosProvider(key) === normalized) {
      return key;
    }
  }
  return null;
}

function resolveProviderStatus(
  state: Pick<PmosModelAuthState, "pmosByokProviders" | "pmosEffectiveConfig">,
  providerRaw: string,
): { keyStored: boolean; sharedProvider: boolean; providerReady: boolean } {
  const provider = normalizePmosProvider(providerRaw);
  if (!provider) {
    return { keyStored: false, sharedProvider: false, providerReady: false };
  }
  const keyStored = (state.pmosByokProviders ?? []).includes(provider);
  const sharedProvider = listSharedProvidersFromEffectiveConfig(state.pmosEffectiveConfig).includes(
    provider,
  );
  return {
    keyStored,
    sharedProvider,
    providerReady: keyStored || sharedProvider,
  };
}

type WorkspaceConfigSnapshot = {
  workspaceConfig: Record<string, unknown>;
  effectiveConfig: Record<string, unknown>;
};

async function readWorkspaceConfigSnapshot(
  state: PmosModelAuthState,
): Promise<WorkspaceConfigSnapshot> {
  if (!state.client || !state.connected) {
    return { workspaceConfig: {}, effectiveConfig: {} };
  }
  const ws = await state.client.request<{
    workspaceId: string;
    workspaceConfig: unknown;
    effectiveConfig: unknown;
  }>("pmos.config.workspace.get", {});
  return {
    workspaceConfig: isRecord(ws.workspaceConfig) ? deepClone(ws.workspaceConfig) : {},
    effectiveConfig: isRecord(ws.effectiveConfig) ? deepClone(ws.effectiveConfig) : {},
  };
}

async function readWorkspaceConfigOverlay(
  state: PmosModelAuthState,
): Promise<Record<string, unknown>> {
  const snapshot = await readWorkspaceConfigSnapshot(state);
  return snapshot.workspaceConfig;
}

async function writeWorkspaceConfig(
  state: PmosModelAuthState,
  nextConfig: Record<string, unknown>,
) {
  if (!state.client || !state.connected) {
    return;
  }
  await state.client.request("pmos.config.workspace.set", {
    patch: nextConfig,
    replace: true,
  });
}

function ensureModelAllowed(config: Record<string, unknown>, modelRef: string) {
  const normalized = normalizeModelRef(modelRef);
  if (!normalized) {
    return;
  }
  const existing = getPath(config, ["agents", "defaults", "models", normalized]);
  if (isRecord(existing)) {
    return;
  }
  setPath(config, ["agents", "defaults", "models", normalized], {});
}

function setModelAlias(config: Record<string, unknown>, modelRef: string, alias: string) {
  if (alias.trim()) {
    setPath(config, ["agents", "defaults", "models", modelRef, "alias"], alias.trim());
  } else {
    deletePath(config, ["agents", "defaults", "models", modelRef, "alias"]);
  }
}

function clearModelReferences(config: Record<string, unknown>, modelRef: string) {
  const normalized = normalizeModelRef(modelRef);
  if (!normalized) {
    return;
  }

  const defaultFallbacks = getPath(config, ["agents", "defaults", "model", "fallbacks"]);
  if (Array.isArray(defaultFallbacks)) {
    const nextFallbacks = defaultFallbacks
      .map((entry) => (typeof entry === "string" ? normalizeModelRef(entry) : ""))
      .filter((entry) => entry && entry !== normalized);
    if (nextFallbacks.length > 0) {
      setPath(config, ["agents", "defaults", "model", "fallbacks"], nextFallbacks);
    } else {
      deletePath(config, ["agents", "defaults", "model", "fallbacks"]);
    }
  }

  const agents = getPath(config, ["agents", "list"]);
  if (!Array.isArray(agents)) {
    return;
  }
  for (const entry of agents) {
    if (!isRecord(entry)) {
      continue;
    }
    const explicit = resolvePrimaryModel(entry.model);
    if (!explicit || explicit !== normalized) {
      continue;
    }
    delete entry.model;
  }
}

function setProviderApiKey(
  config: Record<string, unknown>,
  provider: string,
  apiKey: string,
): boolean {
  const providerKey = resolveProviderConfigKey(config, provider);
  const normalizedProvider = provider.trim().toLowerCase();
  const targetKey = providerKey || normalizedProvider;
  if (!targetKey) {
    return false;
  }
  setPath(config, ["models", "providers", targetKey, "apiKey"], apiKey);
  return true;
}

function clearProviderApiKey(config: Record<string, unknown>, provider: string): boolean {
  const providerKey = resolveProviderConfigKey(config, provider);
  const normalizedProvider = provider.trim().toLowerCase();
  const targetKey = providerKey || normalizedProvider;
  if (!targetKey) {
    return false;
  }
  deletePath(config, ["models", "providers", targetKey, "apiKey"]);
  return true;
}

/** Known API base URLs for providers that require explicit configuration. */
const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  kilo: "https://api.kilo.ai/api/gateway",
  openrouter: "https://openrouter.ai/api/v1",
  moonshot: "https://api.moonshot.cn/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  zai: "https://open.bigmodel.cn/api/paas/v4",
};

/** Default API type for each provider (determines request format). */
const PROVIDER_DEFAULT_API_TYPES: Record<string, string> = {
  kilo: "openai-completions",
  openrouter: "openai-completions",
  moonshot: "openai-completions",
  nvidia: "openai-completions",
  zai: "openai-completions",
  openai: "openai-completions",
  anthropic: "anthropic-messages",
  google: "google-generative-ai",
};

function setProviderBaseUrl(
  config: Record<string, unknown>,
  provider: string,
  baseUrl: string,
): void {
  if (!baseUrl.trim()) return;
  const providerKey = resolveProviderConfigKey(config, provider) ?? provider.trim().toLowerCase();
  if (!providerKey) return;
  setPath(config, ["models", "providers", providerKey, "baseUrl"], baseUrl.trim());
}

function setProviderApiType(
  config: Record<string, unknown>,
  provider: string,
  apiType: string,
): void {
  if (!apiType.trim()) return;
  const providerKey = resolveProviderConfigKey(config, provider) ?? provider.trim().toLowerCase();
  if (!providerKey) return;
  setPath(config, ["models", "providers", providerKey, "api"], apiType.trim());
}

function findMutableAgentEntry(
  config: Record<string, unknown>,
  agentIdRaw: string,
): Record<string, unknown> | null {
  const agentId = agentIdRaw.trim().toLowerCase();
  if (!agentId) {
    return null;
  }
  const list = getPath(config, ["agents", "list"]);
  if (!Array.isArray(list)) {
    return null;
  }
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      continue;
    }
    if (entry.id.trim().toLowerCase() === agentId) {
      return entry;
    }
  }
  return null;
}

async function updateAgentModelAssignmentViaConfig(
  state: PmosModelAuthState,
  params: { agentId: string; modelRef: string | null },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const nextConfig = await readWorkspaceConfigOverlay(state);
  let agentEntry = findMutableAgentEntry(nextConfig, params.agentId);

  if (!agentEntry) {
    // Agent may be defined in the global config (effective config). Create a minimal
    // workspace overlay entry for it so the model assignment can be persisted.
    const effectiveConfig = isRecord(state.pmosEffectiveConfig) ? state.pmosEffectiveConfig : {};
    const globalAgentEntry = findMutableAgentEntry(effectiveConfig, params.agentId);
    if (!globalAgentEntry) {
      throw new Error(`Agent "${params.agentId}" not found in config.`);
    }

    // Mirror the agent id (and optionally key identity fields) into the workspace overlay.
    const agentId = params.agentId.trim();
    const list = getPath(nextConfig, ["agents", "list"]);
    const nextList = Array.isArray(list) ? [...list] : [];
    const stub: Record<string, unknown> = { id: agentId };
    nextList.push(stub);
    setPath(nextConfig, ["agents", "list"], nextList);

    // Re-resolve the mutable entry that we just pushed.
    agentEntry = findMutableAgentEntry(nextConfig, agentId);
    if (!agentEntry) {
      throw new Error(`Failed to create workspace override for agent "${agentId}".`);
    }
  }

  if (params.modelRef) {
    agentEntry.model = params.modelRef;
  } else {
    delete agentEntry.model;
  }
  await writeWorkspaceConfig(state, nextConfig);
}

export function hydratePmosModelDraftFromConfig(state: PmosModelAuthState) {
  // PMOS source of truth: workspace effective config (global + workspace overlay).
  state.pmosModelProvider = normalizePmosProvider(state.pmosModelProvider) || "custom";
  state.pmosModelId = state.pmosModelId.trim() || getDefaultModelIdForProvider(state.pmosModelProvider);
  state.pmosModelAlias = state.pmosModelAlias ?? "";
  state.pmosModelBaseUrl = state.pmosModelBaseUrl ?? "";
  state.pmosModelApiType = state.pmosModelApiType ?? "";
  const providerStatus = resolveProviderStatus(state, state.pmosModelProvider);
  state.pmosModelConfigured = providerStatus.providerReady;
  state.pmosModelApiKeyStored = providerStatus.keyStored;
}

export function setPmosModelProvider(state: PmosModelAuthState, provider: PmosModelProvider) {
  const normalized = normalizePmosProvider(provider);
  if (!normalized || state.pmosModelProvider === normalized) {
    return;
  }
  const previousProvider = state.pmosModelProvider;
  const previousDefault = getDefaultModelIdForProvider(previousProvider);
  state.pmosModelProvider = normalized;
  if (!state.pmosModelId.trim() || (previousDefault && state.pmosModelId === previousDefault)) {
    const nextDefault = getDefaultModelIdForProvider(normalized);
    if (nextDefault) {
      state.pmosModelId = nextDefault;
    }
  }
  // Auto-populate base URL and API type for well-known providers when the field is
  // empty or was previously auto-filled (matches the old provider's default).
  const prevBaseUrl = PROVIDER_DEFAULT_BASE_URLS[previousProvider] ?? "";
  if (!state.pmosModelBaseUrl.trim() || state.pmosModelBaseUrl === prevBaseUrl) {
    state.pmosModelBaseUrl = PROVIDER_DEFAULT_BASE_URLS[normalized] ?? "";
  }
  const prevApiType = PROVIDER_DEFAULT_API_TYPES[previousProvider] ?? "";
  if (!state.pmosModelApiType.trim() || state.pmosModelApiType === prevApiType) {
    state.pmosModelApiType = PROVIDER_DEFAULT_API_TYPES[normalized] ?? "";
  }
  state.pmosModelError = null;
  const providerStatus = resolveProviderStatus(state, normalized);
  state.pmosModelConfigured = providerStatus.providerReady;
  state.pmosModelApiKeyStored = providerStatus.keyStored;
}

function hydrateFromEffectiveConfig(state: PmosModelAuthState, cfg: unknown) {
  const primary = asNonEmptyString(getPath(cfg, ["agents", "defaults", "model", "primary"]));
  const parsedPrimary = parsePrimaryModelRef(primary);
  if (parsedPrimary) {
    state.pmosModelProvider = parsedPrimary.provider;
    state.pmosModelId = parsedPrimary.modelId;
  } else {
    state.pmosModelId = state.pmosModelId.trim() || getDefaultModelIdForProvider(state.pmosModelProvider);
  }

  const modelRef = `${state.pmosModelProvider}/${state.pmosModelId}`;
  const alias = asNonEmptyString(getPath(cfg, ["agents", "defaults", "models", modelRef, "alias"])) ?? "";
  state.pmosModelAlias = alias;

  // Hydrate provider-level config (baseUrl, api type) so the form reflects current state.
  const providerKey = normalizePmosProvider(state.pmosModelProvider);
  const providerCfg = getPath(cfg, ["models", "providers", providerKey]);
  if (isRecord(providerCfg)) {
    state.pmosModelBaseUrl = asNonEmptyString(providerCfg.baseUrl) ?? state.pmosModelBaseUrl ?? "";
    state.pmosModelApiType = asNonEmptyString(providerCfg.api) ?? state.pmosModelApiType ?? "";
  }
}

export async function loadPmosModelWorkspaceState(state: PmosModelAuthState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.pmosModelCatalogLoading = true;
  state.pmosModelCatalogError = null;
  state.pmosModelError = null;
  try {
    const [{ workspaceConfig, effectiveConfig }, modelsResult] = await Promise.all([
      readWorkspaceConfigSnapshot(state),
      state.client.request<{
        models?: Array<{ id?: string; provider?: string }>;
      }>("models.list", {}),
    ]);

    state.pmosWorkspaceConfig = workspaceConfig;
    state.pmosEffectiveConfig = effectiveConfig;

    hydrateFromEffectiveConfig(state, effectiveConfig);

    const workspaceProviders = listConfiguredProvidersFromConfig(workspaceConfig);
    // Also count providers that have an API key in effective config (includes global config).
    // This ensures that models configured by superadmin via the Config panel are treated as
    // "configured" in the model panel, keeping both panels in sync.
    const effectiveConfiguredProviders = listConfiguredProvidersFromConfig(effectiveConfig);
    const sharedProviders = listSharedProvidersFromEffectiveConfig(effectiveConfig);
    const availableProviders = Array.from(
      new Set([...workspaceProviders, ...effectiveConfiguredProviders, ...sharedProviders]),
    );
    const keyConfiguredProviders = Array.from(
      new Set([...workspaceProviders, ...effectiveConfiguredProviders]),
    );
    const availableProviderSet = new Set(availableProviders);
    const keyConfiguredProviderSet = new Set(keyConfiguredProviders);
    const sharedProviderSet = new Set(sharedProviders);
    state.pmosByokProviders = keyConfiguredProviders;
    state.pmosModelConfigured = availableProviderSet.has(state.pmosModelProvider);
    state.pmosModelApiKeyStored = keyConfiguredProviderSet.has(state.pmosModelProvider);

    const visibleProviders = new Set(availableProviders);
    const catalogRefs = new Set<string>();
    const modelsList = Array.isArray(modelsResult.models) ? modelsResult.models : [];
    for (const model of modelsList) {
      const provider = typeof model.provider === "string" ? model.provider.trim().toLowerCase() : "";
      const id = typeof model.id === "string" ? model.id.trim() : "";
      if (!provider || !id) {
        continue;
      }
      if (visibleProviders.size > 0 && !visibleProviders.has(provider)) {
        continue;
      }
      catalogRefs.add(`${provider}/${id}`);
    }

    const refs = collectModelRefsFromConfig(effectiveConfig);
    for (const ref of catalogRefs) {
      refs.add(ref);
    }

    const defaultsPrimary = resolvePrimaryModel(getPath(effectiveConfig, ["agents", "defaults", "model"]));
    const workspaceConfiguredModels = listConfiguredModels(workspaceConfig);
    const effectiveConfiguredModels = listConfiguredModels(effectiveConfig);
    const agentEntries = readAgentEntries(effectiveConfig);

    const assignments: PmosAgentModelAssignment[] = agentEntries
      .map((agent) => {
        const agentId = typeof agent.id === "string" ? agent.id.trim() : "";
        if (!agentId) {
          return null;
        }
        const explicitModel = resolvePrimaryModel(agent.model);
        const modelRef = explicitModel ?? defaultsPrimary;
        if (modelRef) {
          refs.add(modelRef);
        }
        return {
          agentId,
          label: resolveAgentLabel(agent),
          modelRef,
          inherited: !explicitModel,
        };
      })
      .filter((entry): entry is PmosAgentModelAssignment => Boolean(entry));

    const usageByRef = new Map<string, string[]>();
    for (const assignment of assignments) {
      if (!assignment.modelRef) {
        continue;
      }
      const list = usageByRef.get(assignment.modelRef) ?? [];
      list.push(assignment.label);
      usageByRef.set(assignment.modelRef, list);
    }

    const rows: PmosModelRow[] = Array.from(refs)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((ref) => {
        const parsed = parsePrimaryModelRef(ref);
        const provider = parsed?.provider ?? "";
        return {
          ref,
          provider,
          modelId: parsed?.modelId ?? ref,
          alias:
            workspaceConfiguredModels[ref]?.alias ??
            effectiveConfiguredModels[ref]?.alias ??
            "",
          active: defaultsPrimary === ref,
          keyConfigured: keyConfiguredProviderSet.has(provider),
          providerReady: availableProviderSet.has(provider),
          sharedProvider: sharedProviderSet.has(provider),
          inCatalog: catalogRefs.has(ref),
          usedBy: usageByRef.get(ref) ?? [],
          workspaceOverride: Object.prototype.hasOwnProperty.call(
            workspaceConfiguredModels,
            ref,
          ),
        };
      })
      .filter((row) => {
        if (!row.provider) {
          return true;
        }
        if (visibleProviders.size === 0) {
          return true;
        }
        if (visibleProviders.has(row.provider)) {
          return true;
        }
        // Keep rows that are actively used/selected so the UI can still explain current state.
        return row.active || row.usedBy.length > 0 || row.workspaceOverride;
      });

    state.pmosModelRows = rows;
    state.pmosAgentModelAssignments = assignments;
    const selectableRefs = collectModelRefsFromConfig(effectiveConfig);
    if (defaultsPrimary) {
      selectableRefs.add(defaultsPrimary);
    }
    for (const assignment of assignments) {
      if (assignment.modelRef) {
        selectableRefs.add(assignment.modelRef);
      }
    }
    state.availableModels = Array.from(selectableRefs).sort((a, b) => a.localeCompare(b));
  } catch (err) {
    state.pmosModelCatalogError = String(err);
    state.pmosModelError = String(err);
  } finally {
    state.pmosModelCatalogLoading = false;
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
    const nextConfig = await readWorkspaceConfigOverlay(state);
    ensureModelAllowed(nextConfig, modelRef);
    setPath(nextConfig, ["agents", "defaults", "model", "primary"], modelRef);
    setModelAlias(nextConfig, modelRef, alias);

    if (apiKeyDraft && provider !== "custom") {
      setProviderApiKey(nextConfig, provider, apiKeyDraft);
    }

    // Auto-apply base URL and API type for well-known providers that require them.
    const baseUrl = (state.pmosModelBaseUrl ?? "").trim() || PROVIDER_DEFAULT_BASE_URLS[provider] || "";
    const apiType = (state.pmosModelApiType ?? "").trim() || PROVIDER_DEFAULT_API_TYPES[provider] || "";
    if (baseUrl && provider !== "custom") {
      setProviderBaseUrl(nextConfig, provider, baseUrl);
    }
    if (apiType && provider !== "custom") {
      setProviderApiType(nextConfig, provider, apiType);
    }

    await writeWorkspaceConfig(state, nextConfig);
    state.pmosModelApiKeyDraft = "";
    await loadPmosModelWorkspaceState(state);
  } catch (err) {
    state.pmosModelError = String(err);
  } finally {
    state.pmosModelSaving = false;
  }
}

export function selectPmosModelEditor(state: PmosModelAuthState, modelRef: string): boolean {
  const normalized = normalizeModelRef(modelRef);
  const parsed = parsePrimaryModelRef(normalized);
  if (!normalized || !parsed) {
    return false;
  }
  const row = (state.pmosModelRows ?? []).find((entry) => normalizeModelRef(entry.ref) === normalized);
  const alias =
    row?.alias ??
    asNonEmptyString(getPath(state.pmosWorkspaceConfig, ["agents", "defaults", "models", normalized, "alias"])) ??
    asNonEmptyString(getPath(state.pmosEffectiveConfig, ["agents", "defaults", "models", normalized, "alias"])) ??
    "";
  const providerCfg = getPath(state.pmosEffectiveConfig, ["models", "providers", parsed.provider]);
  const providerStatus = resolveProviderStatus(state, parsed.provider);

  state.pmosModelProvider = parsed.provider;
  state.pmosModelId = parsed.modelId;
  state.pmosModelRefDraft = normalized;
  state.pmosModelAlias = alias;
  state.pmosModelApiKeyDraft = "";
  state.pmosModelBaseUrl = isRecord(providerCfg)
    ? asNonEmptyString(providerCfg.baseUrl) ?? PROVIDER_DEFAULT_BASE_URLS[parsed.provider] ?? ""
    : PROVIDER_DEFAULT_BASE_URLS[parsed.provider] ?? "";
  state.pmosModelApiType = isRecord(providerCfg)
    ? asNonEmptyString(providerCfg.api) ?? PROVIDER_DEFAULT_API_TYPES[parsed.provider] ?? ""
    : PROVIDER_DEFAULT_API_TYPES[parsed.provider] ?? "";
  state.pmosModelConfigured = providerStatus.providerReady;
  state.pmosModelApiKeyStored = providerStatus.keyStored;
  state.pmosModelError = null;
  return true;
}

export async function activatePmosModel(state: PmosModelAuthState, modelRef: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const normalized = normalizeModelRef(modelRef);
  if (!normalized) {
    state.pmosModelError = "Invalid model reference.";
    return;
  }
  state.pmosModelSaving = true;
  state.pmosModelError = null;
  try {
    const nextConfig = await readWorkspaceConfigOverlay(state);
    ensureModelAllowed(nextConfig, normalized);
    setPath(nextConfig, ["agents", "defaults", "model", "primary"], normalized);
    await writeWorkspaceConfig(state, nextConfig);
    await loadPmosModelWorkspaceState(state);
  } catch (err) {
    state.pmosModelError = String(err);
  } finally {
    state.pmosModelSaving = false;
  }
}

export async function deactivatePmosModel(state: PmosModelAuthState, modelRef: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const normalized = normalizeModelRef(modelRef);
  if (!normalized) {
    state.pmosModelError = "Invalid model reference.";
    return;
  }
  state.pmosModelSaving = true;
  state.pmosModelError = null;
  try {
    const nextConfig = await readWorkspaceConfigOverlay(state);
    deletePath(nextConfig, ["agents", "defaults", "models", normalized]);
    const primary = asNonEmptyString(getPath(nextConfig, ["agents", "defaults", "model", "primary"]));
    if (primary && normalizeModelRef(primary) === normalized) {
      deletePath(nextConfig, ["agents", "defaults", "model", "primary"]);
    }
    await writeWorkspaceConfig(state, nextConfig);
    await loadPmosModelWorkspaceState(state);
  } catch (err) {
    state.pmosModelError = String(err);
  } finally {
    state.pmosModelSaving = false;
  }
}

export async function deletePmosModel(state: PmosModelAuthState, modelRef: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const normalized = normalizeModelRef(modelRef);
  if (!normalized) {
    state.pmosModelError = "Invalid model reference.";
    return;
  }
  state.pmosModelSaving = true;
  state.pmosModelError = null;
  try {
    const nextConfig = await readWorkspaceConfigOverlay(state);
    deletePath(nextConfig, ["agents", "defaults", "models", normalized]);
    const primary = asNonEmptyString(getPath(nextConfig, ["agents", "defaults", "model", "primary"]));
    if (primary && normalizeModelRef(primary) === normalized) {
      deletePath(nextConfig, ["agents", "defaults", "model", "primary"]);
    }
    clearModelReferences(nextConfig, normalized);
    await writeWorkspaceConfig(state, nextConfig);
    await loadPmosModelWorkspaceState(state);
  } catch (err) {
    state.pmosModelError = String(err);
  } finally {
    state.pmosModelSaving = false;
  }
}

export async function assignPmosAgentModel(
  state: PmosModelAuthState,
  params: { agentId: string; modelRef: string | null },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const agentId = params.agentId.trim();
  if (!agentId) {
    state.pmosModelError = "Agent id is required.";
    return;
  }

  const requested = (params.modelRef ?? "").trim();
  const normalized = requested ? normalizeModelRef(requested) : "";
  if (requested && !normalized) {
    state.pmosModelError = "Invalid model reference.";
    return;
  }

  state.pmosModelSaving = true;
  state.pmosModelError = null;
  try {
    await updateAgentModelAssignmentViaConfig(state, {
      agentId,
      modelRef: normalized || null,
    });
    await loadPmosModelWorkspaceState(state);
  } catch (err) {
    state.pmosModelError = String(err);
  } finally {
    state.pmosModelSaving = false;
  }
}

export async function upsertPmosModelFromRef(
  state: PmosModelAuthState,
  params: { modelRef: string; alias?: string; apiKey?: string; baseUrl?: string; apiType?: string; activate?: boolean },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const normalized = normalizeModelRef(params.modelRef);
  const parsed = parsePrimaryModelRef(normalized);
  if (!normalized || !parsed) {
    state.pmosModelError = "Choose a valid provider/model.";
    return;
  }

  const provider = parsed.provider;
  state.pmosModelProvider = provider;
  state.pmosModelId = parsed.modelId;
  state.pmosModelAlias = params.alias?.trim() ?? state.pmosModelAlias;
  state.pmosModelApiKeyDraft = params.apiKey?.trim() ?? state.pmosModelApiKeyDraft;
  if (params.baseUrl !== undefined) state.pmosModelBaseUrl = params.baseUrl;
  if (params.apiType !== undefined) state.pmosModelApiType = params.apiType;

  if (params.activate === false) {
    state.pmosModelSaving = true;
    state.pmosModelError = null;
    try {
      const nextConfig = await readWorkspaceConfigOverlay(state);
      ensureModelAllowed(nextConfig, normalized);
      setModelAlias(nextConfig, normalized, state.pmosModelAlias.trim());

      const apiKeyDraft = state.pmosModelApiKeyDraft.trim();
      if (apiKeyDraft && provider !== "custom") {
        setProviderApiKey(nextConfig, provider, apiKeyDraft);
      }

      const baseUrl = (state.pmosModelBaseUrl ?? "").trim() || PROVIDER_DEFAULT_BASE_URLS[provider] || "";
      const apiType = (state.pmosModelApiType ?? "").trim() || PROVIDER_DEFAULT_API_TYPES[provider] || "";
      if (baseUrl && provider !== "custom") setProviderBaseUrl(nextConfig, provider, baseUrl);
      if (apiType && provider !== "custom") setProviderApiType(nextConfig, provider, apiType);

      await writeWorkspaceConfig(state, nextConfig);
      state.pmosModelApiKeyDraft = "";
      await loadPmosModelWorkspaceState(state);
    } catch (err) {
      state.pmosModelError = String(err);
    } finally {
      state.pmosModelSaving = false;
    }
    return;
  }

  await savePmosModelConfig(state);
}

export async function clearPmosModelApiKey(state: PmosModelAuthState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.pmosModelSaving = true;
  state.pmosModelError = null;
  try {
    const nextConfig = await readWorkspaceConfigOverlay(state);
    const provider = state.pmosModelProvider;
    if (provider !== "custom") {
      clearProviderApiKey(nextConfig, provider);
    }
    state.pmosModelApiKeyDraft = "";
    await writeWorkspaceConfig(state, nextConfig);
    await loadPmosModelWorkspaceState(state);
  } catch (err) {
    state.pmosModelError = String(err);
  } finally {
    state.pmosModelSaving = false;
  }
}

export async function clearPmosModelApiKeyForRef(state: PmosModelAuthState, modelRef: string) {
  const parsed = parsePrimaryModelRef(modelRef);
  if (!parsed) {
    state.pmosModelError = "Unknown provider for selected model.";
    return;
  }
  state.pmosModelProvider = parsed.provider;
  await clearPmosModelApiKey(state);
}
