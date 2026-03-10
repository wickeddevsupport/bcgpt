# Model Configuration Architecture - Problems & Solutions

**Created:** 2026-02-20
**Status:** Critical Issues Identified

---

## 🔴 Current Problems

### 1. Status Display is Wrong

**Current Logic:**
```typescript
// pmos-model-auth.ts
state.pmosModelConfigured = byokProviders.includes(state.pmosModelProvider);
```

**Problem:** Only checks BYOK store, not actual API key availability.

**OpenClaw's Actual Resolution Order:**
1. Auth profiles (`~/.openclaw/auth-profiles.json`)
2. Environment variables (`OPENAI_API_KEY`, etc.)
3. `models.providers.{provider}.apiKey` in config
4. BYOK store (just added)

**Result:** Shows "not configured" when key exists in config, shows "configured" when BYOK has key but OpenClaw can't use it.

### 2. BYOK Store Not Synced to OpenClaw Config

**What happens when user saves API key:**
1. `pmos.byok.set` saves to encrypted BYOK store
2. `pmos.config.workspace.set` saves model selection
3. ❌ Does NOT update `models.providers.{provider}.apiKey` in OpenClaw config

**Result:** OpenClaw's `resolveApiKeyForProvider()` checks BYOK (after my fix), but the config is still separate.

### 3. No Custom Model Option

**Current:** Fixed dropdown with predefined models
**Need:** Custom option where users can type any model ID

### 4. n8n Iframe Not Full Height

**Current:** `height: 100%` but parent containers don't propagate height correctly

### 5. Dual Config System Confusion

| System | Location | Purpose |
|--------|----------|---------|
| OpenClaw Config | `~/.openclaw/config.json` | Global AI settings |
| Workspace Config | `~/.openclaw/workspaces/{id}/config.json` | Per-workspace settings |
| BYOK Store | `~/.openclaw/workspaces/{id}/byok.json` | Encrypted API keys |
| Auth Profiles | `~/.openclaw/auth-profiles.json` | Named auth profiles |

**Users don't understand which is which.**

---

## ✅ Proposed Solution

### Option A: BYOK as Single Source of Truth (Recommended)

Make BYOK store the ONLY place for API keys, and have OpenClaw read from it.

**Changes Required:**

1. **Fix Status Display** - Check actual key availability:
```typescript
async function checkProviderConfigured(provider: string): Promise<boolean> {
  // Check all sources like resolveApiKeyForProvider does
  const result = await resolveApiKeyForProvider({ provider, ... });
  return result.mode !== "none";
}
```

2. **Add BYOK Resolution** (Already done in model-auth.ts)

3. **Add Custom Model Input**:
```typescript
<select>
  <option value="">Select provider...</option>
  {PREDEFINED_PROVIDERS.map(p => <option value={p}>{p}</option>)}
  <option value="custom">Custom (enter model ID)</option>
</select>
{provider === "custom" && <input placeholder="provider/model-id" />}
```

4. **Fix n8n Iframe**:
```typescript
// Use 100vh with proper flex layout
<div style="flex:1;display:flex;flex-direction:column;min-height:0;">
  <iframe style="flex:1;width:100%;border:0;" />
</div>
```

### Option B: Unified Config UI

Create a single "AI Configuration" UI that writes to all necessary places:
- Workspace config for model selection
- BYOK store for API keys
- Shows effective status from all sources

---

## 🔧 Implementation Plan

### Phase 1: Fix Critical Issues (Now)

1. **Fix n8n iframe height** - Quick CSS fix
2. **Fix status display** - Check actual key availability
3. **Add custom model option** - Allow free-form input

### Phase 2: Unify Config (Next)

1. **Create unified AI config UI** - Single place for all AI settings
2. **Show all auth sources** - List where keys come from
3. **Make BYOK the primary** - Recommended for PMOS users

---

## Files to Modify

| File | Change |
|------|--------|
| `automations.ts` | Fix iframe height |
| `pmos-model-auth.ts` | Fix status check, add custom option |
| `integrations.ts` | Show all auth sources, custom model |
| `model-auth.ts` | Already has BYOK resolution |

---

## Acceptance Criteria

- [ ] n8n iframe fills available space
- [ ] Status shows correct state (checks all sources)
- [ ] Users can enter custom model IDs
- [ ] Single source of truth for API keys
- [ ] Clear indication of where keys are stored
