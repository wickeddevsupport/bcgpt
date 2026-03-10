# Critical Architecture Audit - PMOS ↔ OpenClaw Integration

**Created:** 2026-02-19
**Status:** CRITICAL - Multiple disconnections found

---

## 🔴 CRITICAL ISSUE: BYOK Store Disconnected from OpenClaw

### Current Architecture

```
PMOS UI (Integrations/Onboarding)
    ↓ saves to
BYOK Store (~/.openclaw/workspaces/{id}/byok.json)
    ✗ NOT connected to
OpenClaw Config (models.providers.{provider}.apiKey)
```

### OpenClaw API Key Resolution Order
1. Auth profiles (`~/.openclaw/auth-profiles.json`)
2. Environment variables (OPENAI_API_KEY, etc.)
3. `models.providers.{provider}.apiKey` in config
4. **✗ NEVER checks BYOK store**

### Result
When user saves an API key in PMOS:
- Key is stored encrypted in BYOK store ✅
- OpenClaw config is NOT updated ❌
- Agents can't use the key ❌
- Chat fails with "No API key" error ❌

---

## 🟡 Other Disconnections Found

### 1. agents.defaults.model Not Set

**Onboarding sets:**
- `models.providers.{provider}.apiKey` (if BYOK connected)
- `agents.defaults.workspace`

**Onboarding DOES NOT set:**
- `agents.defaults.model` - ❌ CRITICAL
- `agents.defaults.models` - ❌

**Result:** After onboarding, chat has no default model configured.

### 2. Agent Model Selection Uses Wrong Source

**Agents view reads:** `config.agents.defaults.models`
**But should also:** Check BYOK store for available providers

### 3. Chat Panels Don't Show Model Selection

**Dashboard chat:** No model selector
**Automations chat:** No model selector  
**Main Chat tab:** Uses session's model, no quick switch

### 4. Session vs Agent Confusion

**Session keys:** `agent:personal-assistant:main`
**User expects:** "Personal Assistant" (friendly name)

### 5. Workflow Creation Disconnected

**pmos.workflow.create:** Creates n8n workflows
**But:** No integration with `agents.defaults` for AI-powered flows

---

## 🔧 Required Fixes

### Fix 1: Connect BYOK to OpenClaw Config

**Option A: Update config on BYOK save**
```typescript
// In pmos.byok.set handler
await setKey(workspaceId, provider, apiKey, opts);

// ALSO update OpenClaw config
const cfg = loadConfig();
cfg.models = cfg.models ?? {};
cfg.models.providers = cfg.models.providers ?? {};
cfg.models.providers[provider] = {
  ...cfg.models.providers[provider],
  apiKey: { env: `BYOK_${provider.toUpperCase()}_API_KEY` }
};
await writeConfigFile(cfg);
```

**Option B: Read BYOK in model-auth.ts**
```typescript
// In resolveApiKeyForProvider
const byokKey = await getByokKey(workspaceId, provider);
if (byokKey) {
  return { apiKey: byokKey, source: "byok-store", mode: "api-key" };
}
```

**Recommendation:** Option B is cleaner - BYOK becomes another auth source.

### Fix 2: Set agents.defaults.model in Onboarding

```typescript
// After saving API key
const modelRef = `${provider}/${defaultModel}`;
nextConfig = applyPrimaryModel(nextConfig, modelRef);
```

### Fix 3: Wire ModelSelector Component

**Already created:** `openclaw/ui/src/ui/components/model-selector.ts`
**Needs to be wired in:**
- Agents view
- Dashboard chat
- Automations chat
- Main Chat tab

### Fix 4: Add Model Quick Switcher

**Location:** Chat input area
**Behavior:** Dropdown showing configured models
**Source:** `agents.defaults.models` + BYOK providers

### Fix 5: Friendly Agent Names

**Function exists:** `agentNameFromSessionKey()`
**Need to apply everywhere:** Session selectors, activity feeds

---

## 📊 Impact Assessment

| Issue | Severity | User Impact |
|-------|----------|-------------|
| BYOK disconnected | CRITICAL | Chat doesn't work after saving API key |
| No default model | CRITICAL | No model selected after onboarding |
| No model switcher | HIGH | Can't change models easily |
| Session key display | MEDIUM | Confusing UI |
| Workflow disconnection | MEDIUM | AI flows don't use configured models |

---

## 🎯 Fix Priority

1. **CRITICAL:** Connect BYOK to OpenClaw (Fix 1)
2. **CRITICAL:** Set default model in onboarding (Fix 2)
3. **HIGH:** Wire ModelSelector in Agents view (Fix 3)
4. **MEDIUM:** Add model quick switcher (Fix 4)
5. **MEDIUM:** Fix session key display (Fix 5)

---

## Related Files

- `openclaw/src/gateway/server-methods/pmos.ts` - BYOK handlers
- `openclaw/src/gateway/byok-store.ts` - Encrypted key storage
- `openclaw/src/agents/model-auth.ts` - API key resolution
- `openclaw/src/wizard/onboarding.ts` - Initial setup
- `openclaw/ui/src/ui/controllers/pmos-model-auth.ts` - UI state
