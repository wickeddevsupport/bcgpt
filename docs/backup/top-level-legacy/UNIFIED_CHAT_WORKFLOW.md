# Unified Chat Workflow Creation Plan

**Created:** 2026-02-20
**Status:** Planning

---

## Current State

### Multiple Chat Entry Points

| Location | Handler | Creates Workflows? |
|----------|---------|-------------------|
| Dashboard NL input | `handleSendChat` → Main Chat | ❌ No |
| Quick Actions | `handleSendChat` → Main Chat | ❌ No |
| Main Chat | `handleSendChat` | ⚠️ Via `handleChatCreateWorkflow` button |
| Automations Chat | `handleWorkflowAssistChat` | ✅ Yes, auto-creates |

### Two Different Workflow Creation Paths

1. **Automations Chat:** Uses `pmos.workflow.assist` → AI generates → Auto-confirms
2. **Main Chat "Create Workflow" button:** Uses `ops_workflow_generate` tool

**Problem:** Inconsistent behavior. Dashboard NL input just sends to chat, doesn't create workflows.

---

## Proposed Solution

### Unify All Chat to Use `pmos.workflow.assist`

All chat panels should:
1. Send message to AI via `pmos.workflow.assist` (or regular chat)
2. Detect workflow creation intent in response
3. Auto-create workflow if AI returns one

### Intent Detection

Add a system message that routes workflow-related queries to workflow creation:

```
If the user asks to create, build, or make a workflow/automation/flow:
- Generate a workflow JSON with nodes and connections
- Return it in the response

If the user is just chatting:
- Respond normally
```

---

## Implementation Plan

### 1. Add Workflow Intent Detection to Main Chat

**File:** `openclaw/ui/src/ui/app.ts`

```typescript
async handleSendChat(messageOverride?: string, opts?: ...) {
  const message = messageOverride ?? this.chatMessage ?? "";
  
  // Check if this looks like a workflow creation request
  const workflowKeywords = ["create workflow", "make a flow", "build automation", 
    "set up automation", "new workflow", "automate this"];
  const isWorkflowIntent = workflowKeywords.some(kw => 
    message.toLowerCase().includes(kw));
  
  if (isWorkflowIntent) {
    // Use workflow assist endpoint
    const result = await this.client!.request("pmos.workflow.assist", {
      message,
    });
    // ... handle response, auto-create workflow
  } else {
    // Regular chat
    await handleSendChatInternal(...);
  }
}
```

### 2. Update Dashboard NL Input

Already routes to `handleSendChat`, so it will inherit the workflow detection.

### 3. Update Quick Actions

Already route to `handleSendChat`.

### 4. Consistent AI Response Handling

All chat panels should handle:
- Text response (show in chat)
- Workflow JSON (auto-create + notify)
- Errors (show in chat)

---

## Files to Modify

| File | Change |
|------|--------|
| `app.ts` | Add workflow intent detection to `handleSendChat` |
| `workflow-ai.ts` | Already has good system prompt |
| `pmos.ts` | `pmos.workflow.assist` already returns workflow JSON |

---

## Acceptance Criteria

- [ ] Dashboard NL input can create workflows
- [ ] Main Chat can create workflows (not just via button)
- [ ] Automations Chat continues to work
- [ ] All use same AI backend (`pmos.workflow.assist`)
- [ ] Workflow auto-created when AI returns workflow JSON
- [ ] User notified of created workflow
