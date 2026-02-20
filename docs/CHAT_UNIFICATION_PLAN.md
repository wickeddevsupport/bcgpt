# Chat Unification Plan

**Created:** 2026-02-20
**Status:** In Progress

---

## Goal

Use the EXACT same Chat component in:
- Chat tab (current)
- Dashboard
- Automations

---

## Current State

### Chat Tab (Working)
- Uses `renderChat()` from `views/chat.ts`
- Has session selector
- Has full message history
- Has proper send/receive
- Uses model from session config

### Dashboard (Broken)
- Uses separate `nlDraft`, `nlBusy`, `nlResponse`
- No session context
- No proper history
- Different code path

### Automations (Broken)
- Uses separate `chatMessages`, `chatDraft`, `chatSending`
- No session context
- No proper history
- Different code path

---

## Solution

### Step 1: Remove Broken Implementations

- Remove `nlDraft`, `nlBusy`, `nlResponse`, `onAsk` from dashboard
- Remove `chatMessages`, `chatDraft`, `chatSending` from automations
- Remove the chatPanel from automations

### Step 2: Import renderChat in Both Views

```typescript
import { renderChat, type ChatProps } from "./chat.js";
```

### Step 3: Pass Same Props to renderChat

Both dashboard and automations need to pass the same props:
- sessionKey
- sessionOptions
- messages
- message
- sending
- connected
- onSessionChange
- onMessageChange
- onSend
- etc.

### Step 4: Update app-render.ts

Pass the chat state to dashboard and automations:
- chatMessages
- chatSending
- chatMessage
- etc.

---

## Implementation Order

1. ✅ Pull latest code
2. 🔜 Update Dashboard to use renderChat()
3. 🔜 Update Automations to use renderChat()
4. 🔜 Test both locations
5. 🔜 Fix Basecamp node in n8n
6. 🔜 Link integrations to config
7. 🔜 Add n8n context to chat bot
8. 🔜 Pull n8n nodes to Connections

---

## Acceptance Criteria

- [ ] Dashboard shows same Chat interface as Chat tab
- [ ] Automations shows same Chat interface as Chat tab
- [ ] No duplicate chat implementations
- [ ] Chat works immediately without config
- [ ] Basecamp node appears in n8n
- [ ] Integrations reads from config
- [ ] Chat bot knows about n8n nodes
- [ ] Connections shows n8n nodes
