# AI Provider Unification Plan

**Created:** 2026-02-19
**Status:** Planning

---

## Problem Statement

The PMOS app has **two disconnected AI configuration experiences**:

1. **Integrations page** — Has provider dropdown, model ID input, API key field
2. **Agents view** — Has raw model string input, no provider context

Both should use the same OpenClaw BYOK (Bring Your Own Keys) configuration.

---

## Current Architecture

### BYOK Store (`byok-store.ts`)
```typescript
type AIProvider = "openai" | "anthropic" | "google" | "zai" | "openrouter" | "azure" | "custom"
```

### UI Providers (`pmos-model-auth.ts`)
```typescript
type PmosModelProvider = "openai" | "anthropic" | "google" | "zai" | "openrouter"

const PMOS_MODEL_PROVIDER_OPTIONS = [
  { value: "google", label: "Google Gemini", defaultModelId: "gemini-3-flash-preview" },
  { value: "openai", label: "OpenAI", defaultModelId: "gpt-5.2" },
  { value: "anthropic", label: "Anthropic", defaultModelId: "claude-opus-4-6" },
  { value: "zai", label: "GLM (Z.AI)", defaultModelId: "glm-4.7" },
  { value: "openrouter", label: "OpenRouter", defaultModelId: "google/gemini-2.0-flash:free" },
]
```

### Missing Provider
**"kilo"** is referenced in `app-render.ts` for API key lookup but NOT in:
- BYOK store (`AIProvider` type)
- UI provider options (`PmosModelProvider`)

---

## Gap Analysis

| Location | Provider Support | Model Selection | BYOK Integration |
|----------|------------------|-----------------|-------------------|
| `byok-store.ts` | openai, anthropic, google, zai, openrouter, azure, custom | defaultModel field | ✅ Source of truth |
| `pmos-model-auth.ts` | openai, anthropic, google, zai, openrouter | defaultModelId | ✅ Uses BYOK |
| `integrations.ts` | Same as pmos-model-auth | Manual input | ✅ Saves to BYOK |
| `agents.ts` | ❌ None | Raw string | ❌ Not connected |
| `onboarding.ts` | Same as pmos-model-auth | Manual input | ✅ Saves to BYOK |
| `app-render.ts` | kilo in config lookup | N/A | ⚠️ Missing in BYOK |

---

## Proposed Solution

### 1. Add "kilo" Provider

**Files to update:**
- `openclaw/src/gateway/byok-store.ts` — Add "kilo" to `AIProvider` type
- `openclaw/ui/src/ui/controllers/pmos-model-auth.ts` — Add to `PmosModelProvider` and options
- `openclaw/src/gateway/byok-store.ts` — Add kilo validation logic

**New provider entry:**
```typescript
{ value: "kilo", label: "Kilo", defaultModelId: "kilo/z-ai/glm-5:free" }
```

### 2. Create Unified Model Selector Component

**New file:** `openclaw/ui/src/ui/components/model-selector.ts`

```typescript
export type ModelSelectorProps = {
  // From BYOK config
  configuredProviders: PmosModelProvider[];
  // Current selection
  provider: PmosModelProvider;
  modelId: string;
  // Callbacks
  onProviderChange: (provider: PmosModelProvider) => void;
  onModelChange: (modelId: string) => void;
  // Optional: show API key input for unconfigured providers
  showApiKeyInput?: boolean;
  apiKeyDraft?: string;
  onApiKeyChange?: (key: string) => void;
};
```

Features:
- Provider dropdown (shows which are configured with ✅)
- Model dropdown populated from known models for provider
- Optional API key input for quick setup

### 3. Update Integrations Page

**File:** `openclaw/ui/src/ui/views/integrations.ts`

- Use unified `ModelSelector` component
- Show all providers with configured status
- Allow adding new provider keys inline

### 4. Update Agents View

**File:** `openclaw/ui/src/ui/views/agents.ts`

- Replace raw model string input with `ModelSelector`
- Filter to only show configured providers
- Show "Configure in Integrations" link if no providers configured

### 5. Update Onboarding

**File:** `openclaw/ui/src/ui/views/onboarding.ts`

- Use unified `ModelSelector` component
- Keep API key input for first-time setup

---

## Model Catalog

Create a central model catalog with known models per provider:

```typescript
// openclaw/ui/src/ui/model-catalog.ts
export const MODEL_CATALOG: Record<PmosModelProvider, ModelInfo[]> = {
  google: [
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)", tier: "free" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "paid" },
    // ...
  ],
  openai: [
    { id: "gpt-5.2", label: "GPT-5.2", tier: "paid" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", tier: "paid" },
    { id: "o3-mini", label: "O3 Mini", tier: "paid" },
  ],
  anthropic: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", tier: "paid" },
    { id: "claude-sonnet-4", label: "Claude Sonnet 4", tier: "paid" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", tier: "paid" },
  ],
  zai: [
    { id: "glm-4.7", label: "GLM 4.7", tier: "free" },
    { id: "glm-5", label: "GLM 5", tier: "free" },
  ],
  openrouter: [
    { id: "google/gemini-2.0-flash:free", label: "Gemini 2.0 Flash (Free)", tier: "free" },
    { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", tier: "paid" },
  ],
  kilo: [
    { id: "kilo/z-ai/glm-5:free", label: "GLM 5 (Free via Kilo)", tier: "free" },
  ],
};
```

---

## Implementation Order

1. **Add kilo to BYOK** — Type + validation + UI options
2. **Create model catalog** — Central source of model info
3. **Create ModelSelector component** — Unified dropdown component
4. **Update Integrations** — Use ModelSelector
5. **Update Agents** — Use ModelSelector, connect to BYOK
6. **Update Onboarding** — Use ModelSelector

---

## Acceptance Criteria

- [ ] "kilo" appears in provider dropdown on Integrations page
- [ ] Selecting a provider shows model dropdown with known models
- [ ] Agents view shows provider dropdown (only configured providers)
- [ ] Adding API key in Integrations makes provider available in Agents
- [ ] Model selection persists to workspace config
- [ ] API keys stored encrypted in BYOK store
- [ ] Onboarding uses same unified component
