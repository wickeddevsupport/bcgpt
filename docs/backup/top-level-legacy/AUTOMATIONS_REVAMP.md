# Automations Page Revamp Plan

**Created:** 2026-02-20
**Status:** In Progress

---

## Current Issues

### Layout Problems
1. **3-panel layout can be overwhelming** - Too many things at once
2. **Left panel cramped** - Workflow list and details in same space
3. **Templates hidden in tabs** - Should be more prominent
4. **No empty state guidance** - When no workflows exist

### UX Confusion
1. **"Publish" vs "Enable"** - Users don't understand difference
2. **Webhook "Sync" button** - No explanation
3. **"Operation stream" in details** - Developer feature, no user value
4. **Template deploy** - No success feedback beyond disappearing message

### Missing Features
1. **No workflow categories/tags**
2. **No bulk actions** (enable/disable multiple)
3. **No workflow duplication**
4. **No import/export**
5. **No scheduled runs preview**

---

## Revamp Goals

### Phase 1: Quick Wins
- [ ] Add tooltips to confusing buttons
- [ ] Better empty state with CTA
- [ ] Template gallery improvements
- [ ] Success/error feedback

### Phase 2: UX Improvements
- [ ] Simplify panel layout
- [ ] Better workflow cards
- [ ] Inline workflow creation
- [ ] Quick actions menu

### Phase 3: Feature Additions
- [ ] Workflow duplication
- [ ] Bulk operations
- [ ] Better execution history
- [ ] Schedule preview

---

## Implementation Plan

### 1. Add Tooltips & Labels

```typescript
// Publish button
title="Publish makes this workflow visible to all workspace members and activates triggers."

// Enable button
title="Enable allows this workflow to run when triggered."

// Sync button
title="Fetch the latest workflow definition from n8n."

// Trigger button
title="Manually trigger this workflow with a test payload."
```

### 2. Better Empty State

```typescript
// When no workflows exist
<div class="empty-state">
  <div class="empty-icon">⚡</div>
  <h3>No workflows yet</h3>
  <p>Create your first automation to get started.</p>
  <div class="empty-actions">
    <button>Create from scratch</button>
    <button>Browse templates</button>
  </div>
</div>
```

### 3. Workflow Cards Improvements

```typescript
// Each workflow should show:
- Name
- Status (enabled/disabled/draft)
- Last run status
- Trigger count (today)
- Quick actions (enable/disable, edit, duplicate)
```

### 4. Template Gallery Enhancement

```typescript
// Better template cards
- Icon + Name
- Description
- Category badge
- "Use template" button
- Preview option
```

### 5. Remove Operation Stream

Move to developer debug section or remove entirely.

---

## Files to Modify

- `openclaw/ui/src/ui/views/automations.ts` — Main view
- `openclaw/ui/src/ui/controllers/pmos-workflows.ts` — State management
- `openclaw/ui/src/ui/styles.css` — Any new styles needed

---

## Acceptance Criteria

- [ ] All buttons have helpful tooltips
- [ ] Empty state guides users to create workflow
- [ ] Templates are more discoverable
- [ ] Success/error feedback is clear
- [ ] Operation stream removed or hidden
- [ ] Layout feels less cramped
