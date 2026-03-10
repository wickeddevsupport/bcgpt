# PMOS Inconsistencies Audit

**Created:** 2026-02-19
**Status:** Active

---

## 1. AI Provider/Model Configuration

### Issue: Multiple Disconnected AI Configurations

| Location | Has Provider Selection | Has Model Selection | Uses BYOK | Issue |
|----------|------------------------|---------------------|-----------|-------|
| Integrations page | ✅ Dropdown | ✅ Input | ✅ Saves | Source of truth |
| Onboarding | ✅ Dropdown | ✅ Input | ✅ Saves | Uses PMOS_MODEL_PROVIDER_OPTIONS |
| Agents view | ❌ None | ⚠️ Raw string list | ❌ No | No provider context, just model IDs |
| Dashboard chat (nlDraft) | ❌ No | ❌ No | ❌ No | No model selection at all |
| Automations AI chat | ❌ No | ❌ No | ❌ No | Separate chat system, no model config |
| Main Chat tab | ❌ Session only | ❌ No | ❌ No | Uses session's model, no override |

### Missing Provider: "kilo"

**Referenced in:** `app-render.ts` line for API key lookup
**Missing from:**
- `byok-store.ts` AIProvider type
- `pmos-model-auth.ts` PmosModelProvider type
- All UI dropdowns

**Fix:** Add "kilo" to both types and create model catalog entry.

---

## 2. Chat Panel Duplication

### Dashboard Inline Chat
**File:** `openclaw/ui/src/ui/views/dashboard.ts`
- Uses `nlDraft`, `nlBusy`, `nlResponse`, `onAsk`
- **No model/provider selection**
- Sends to `handleSendChat` → main chat system
- Should respect workspace BYOK model config

### Automations AI Chat Panel
**File:** `openclaw/ui/src/ui/views/automations.ts`
- Uses `chatMessages`, `chatDraft`, `chatSending`, `onChatSend`
- **Separate state from main chat**
- **No model/provider selection**
- Should use workspace BYOK model config

### Main Chat Tab
**File:** `openclaw/ui/src/ui/views/chat.ts`
- Uses `sessionKey` to select session
- Session has model but **no per-chat override**
- No quick model switcher visible

### Recommendation
All three should:
1. Use the same model selection (from BYOK workspace config)
2. Show which model/provider is being used
3. Allow per-message override if desired

---

## 3. Terminology Inconsistencies

| Current Term | Better Term | Location |
|--------------|-------------|----------|
| BCGPT | Basecamp Connector | Dashboard, Integrations title |
| n8n Engine | Workflow Engine | Integrations |
| Wicked OS / PMOS | Wicked OS (consistent) | Mixed usage |
| OpenClaw (in code) | Internal only | OK in code, hide from UI |
| "Connect via Automations" | Confusing | Connections page for non-native services |

---

## 4. Connections vs Integrations Overlap

**Connections page** (`connections.ts`):
- Shows 10 services (Basecamp, Slack, GitHub, Email, Google, Notion, Linear, Jira, Salesforce, HubSpot)
- Only Basecamp and GitHub have working "Connect" buttons
- Others say "Add via Automations" - unclear what that means

**Integrations page** (`integrations.ts`):
- Shows AI Model Setup + Workflow Engine + Basecamp Connector
- Has model selection and API key management
- No other services

### Issue
Users are confused about where to configure what:
- AI models → Integrations ✅
- Basecamp → Both Connections and Integrations ❓
- Other services → Connections (but non-functional) ❌

### Recommendation
1. Merge Connections into Integrations
2. Or: Connections = external service auth, Integrations = AI + workspace config
3. Make all "Connect" buttons functional or remove them

---

## 5. Agent Model Selection Issues

**File:** `openclaw/ui/src/ui/views/agents.ts`

```typescript
availableModels: string[];  // Just strings, no provider context
onModelChange: (agentId: string, modelId: string | null) => void;  // Just modelId
```

**Problems:**
1. `availableModels` is populated from `models` object but without provider prefix
2. No way to know which models require which provider API key
3. Agent could be configured with model that has no API key

**Fix:**
1. Use unified `ModelSelector` component
2. Filter models to only those with configured providers
3. Show "Configure in Integrations" if no providers available

---

## 6. Dashboard "BCGPT" Label

**File:** `openclaw/ui/src/ui/views/dashboard.ts`

```html
<div class="stat-label">BCGPT</div>
```

Should be "Basecamp" or "Basecamp Connector" for user clarity.

Same in:
- Line 204: "Fix BCGPT connector"
- Line 433: "Connector state for Workflows and BCGPT."

---

## 7. Missing Model Catalog

There's no central source of truth for available models per provider.

**Current state:**
- `PMOS_MODEL_PROVIDER_OPTIONS` has default model IDs
- No full catalog of available models
- No model metadata (tier, pricing, capabilities)

**Needed:**
```typescript
// openclaw/ui/src/ui/model-catalog.ts
export const MODEL_CATALOG: Record<PmosModelProvider, ModelInfo[]> = {
  google: [
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)", tier: "free" },
    // ...
  ],
  // ...
};
```

---

## 8. Sessions vs Agents in Chat Dropdown

**File:** `openclaw/ui/src/ui/views/chat.ts` (sessionKey selector)

**Problem:** Dropdown shows technical session keys like `agent:personal-assistant:main` instead of friendly agent names.

**Fixed in some places with:** `agentNameFromSessionKey()` but not consistently applied.

---

## 9. Workflow Templates Not Creating Real Skeletons

**File:** `openclaw/ui/src/ui/views/automations.ts`

Templates gallery shows:
- Basecamp Todo Sync
- AI-Powered Response
- Webhook → Slack Alert
- etc.

**Issue:** Deploying a template creates a workflow with just the name, no actual skeleton.

---

## 10. Summary of Fixes Needed

| # | Issue | Priority | Effort |
|---|-------|----------|--------|
| 1 | Add "kilo" provider to BYOK + UI | P0 | Low |
| 2 | Create unified ModelSelector component | P0 | Medium |
| 3 | Connect all chat panels to BYOK config | P0 | Medium |
| 4 | Add model catalog | P1 | Low |
| 5 | Rename BCGPT → Basecamp in UI | P1 | Low |
| 6 | Merge Connections into Integrations | P1 | High |
| 7 | Fix agent model selection to use BYOK | P1 | Medium |
| 8 | Create real workflow templates | P2 | Medium |
| 9 | Consistent session→agent name display | P2 | Low |

---

## Related Documents

- [AI_PROVIDER_UNIFICATION.md](AI_PROVIDER_UNIFICATION.md) — Plan for unified model config
- [UI_AUDIT.md](UI_AUDIT.md) — General UI issues and fixes
