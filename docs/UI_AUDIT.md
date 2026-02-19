# PMOS UI Audit — Issues, Theater, and Redesign Needs

**Last Updated:** 2026-02-19
**Status:** Active — items being fixed iteratively

---

## LEGEND
- 🔴 Broken / Non-functional
- 🟡 Theater (fake/non-functional data or UI)
- 🟠 Bad UX / Confusing design
- 🟣 Technical jargon exposed to users
- ✅ Fixed

---

## ✅ FIXED IN PREVIOUS SESSIONS

| Item | Fix |
|------|-----|
| Dashboard NL input (no handlers) | Inline chat, wired to handleSendChat |
| Quick Action buttons (dead) | Pre-fill chat + navigate |
| Onboarding Steps 1&2 (theater) | Stripped to BYOK-only form |
| Sessions dropdown shows key strings | Shows agent names via agentNameFromSessionKey |
| Automations templates copy-name-only | Deploy button calls pmos.flow.template.deploy |
| Connections "Connect" dead buttons | Non-native → "Add via Automations" routing |
| Dashboard AI team "idle" status | Shows "Ready"; hides 0 task count |
| Dashboard Focus Today always-shown item | Only shows real actionable issues |
| Dashboard run list raw UUIDs | Truncated to 8 chars |

---

## 🔴 CRITICAL — Still Broken

### 1. Template Deploy: No Success Feedback
**File:** `openclaw/ui/src/ui/views/automations.ts`

Deploy button fires and re-loads workflows, but user sees no confirmation. If it fails, `templateDeployError` shows. If it succeeds — nothing.

**Fix:** Show a temporary "✓ Deployed" callout after success.

---

### 2. Admin: Remove Member — No Confirmation
**File:** `openclaw/ui/src/ui/views/admin.ts` line 214

"Remove" immediately fires without any confirm dialog.

**Fix:** Inline two-step confirm: "Remove?" → Confirm / Cancel.

---

### 3. Admin: "Load Workspaces" Requires Manual Click
**File:** `openclaw/ui/src/ui/views/admin.ts` line 260

**Fix:** Auto-load when `isSuperAdmin` is true and list is empty.

---

### 4. Auth Form: No Email Validation Before Submit
**File:** `openclaw/ui/src/ui/app-render.ts` auth section

**Fix:** Disable submit unless email contains `@` and `.`.

---

## 🟣 TECHNICAL JARGON EXPOSED TO USERS

### 5. Integrations: "OpenClaw Workflows (n8n Engine)"
→ **Fix:** "Workflow Engine"

### 6. Integrations: "BCGPT (MCP Connector)"
→ **Fix:** "Basecamp Connector"

### 7. Integrations: "BCGPT reachable" / "BCGPT auth" status labels
→ **Fix:** "Basecamp connection" / "Basecamp auth"

### 8. Integrations: "Clear selected provider key" button
→ **Fix:** "Remove saved key"

### 9. Integrations: "Open embedded editor" link
→ **Fix:** Navigate to Automations tab instead of raw link

### 10. Integrations: disabledReason references old flow
Old: `"Sign in first, then wait for the Wicked OS gateway to connect."`
→ **Fix:** `"Sign in to your workspace to configure integrations."`

### 11. Admin: "Upsert member" button
→ **Fix:** "Add / Update Member"

### 12. Admin: disabledReason references old flow
Old: `"Connect to Wicked OS first (Dashboard -> Access Key -> Connect)."`
→ **Fix:** `"Sign in to your workspace to manage settings."`

### 13. Automations: "native inside Wicked OS" claim for iframe
→ **Fix:** Remove "native" — just "Your workspace workflows"

### 14. Integrations: "Paste BCGPT API key" placeholder
→ **Fix:** "Paste connection key"

---

## 🟠 CONFUSING UX DESIGN

### 15. Admin: Workspace ID is an Editable Input
Should be read-only (changing it would break workspace access).
→ **Fix:** Show as read-only text with a Copy button.

### 16. Admin: Role Dropdown Order Inconsistent
"Your Role" vs "New Member" use different orderings.
→ **Fix:** Consistent: `workspace_admin, member, viewer` (no system_admin in member draft).

### 17. Admin: No Role Descriptions
→ **Fix:** Add `title` tooltip to each role option.

### 18. Integrations: No Save Confirmation Feedback
After saving model config or BCGPT key, button returns to normal with no "✓ Saved".
→ **Fix:** Show temporary success chip for 2s.

### 19. Integrations: "Connect Basecamp" Opens New Tab Without Warning
→ **Fix:** Add `↗` icon to the link.

### 20. Automations: "Publish" vs "Enable" Confusion
→ **Fix:** Add tooltip on "Publish" explaining difference.

### 21. Automations: Webhook "Draft" / "Sync" Buttons Unexplained
→ **Fix:** Add tooltips to each.

### 22. Chat: Execution Trace Hard-Capped at 8 Events
→ **Fix:** Show 8 + "Show N more" expand button.

### 23. Agents: "Use All" Button Actually Clears the Allowlist
Label is inverted — clearing allowlist = "use all". Confusing.
→ **Fix:** Rename to "Use All (Remove Override)".

### 24. Agents: Tool Override Warning Shown Twice
→ **Fix:** Show only the callout block; remove tooltip duplication.

### 25. Agents: Empty Cron Section Has No CTA
→ **Fix:** Add "Schedule a job →" link.

### 26. Admin: Audit Feed Shows Technical Action Names
`agent.update`, `workspace.config.set` etc.
→ **Fix:** Map to friendly labels.

---

## 🟡 THEATER / WEAK DATA

### 27. Automations AI Flow Builder — `piece` Field Shown in Graph Nodes
→ **Fix:** Map to friendly label or hide.

### 28. Automations: "Operation stream" in `<details>` — No User Value
→ **Fix:** Remove or move to developer debug section.

### 29. Integrations: Ops Project ID Shows Raw UUID
→ **Fix:** Label "Project ID" with truncation + copy button.

### 30. Admin Audit Events: Inconsistent layout when `detail` is absent
→ **Fix:** Enforce consistent min-height on rows.

---

## 📋 PRIORITY SUMMARY

| # | Issue | Type | Priority |
|---|-------|------|----------|
| 1 | Template deploy no feedback | 🔴 Broken | P0 |
| 2 | Remove member no confirmation | 🔴 Broken | P0 |
| 5–14 | Jargon cleanup | 🟣 | P0 |
| 3 | Workspaces auto-load | 🔴 Broken | P1 |
| 4 | Auth email validation | 🔴 Broken | P1 |
| 15 | Workspace ID editable | 🟠 | P1 |
| 16–17 | Admin role order + descriptions | 🟠 | P1 |
| 18–19 | Save feedback + external link indicator | 🟠 | P1 |
| 20–21 | Publish/Enable, Webhook buttons | 🟠 | P2 |
| 22 | Chat trace capped at 8 | 🟠 | P2 |
| 23–24 | Agents tool labels/duplication | 🟠 | P2 |
| 25–26 | Empty states + audit labels | 🟠 | P2 |
| 27–30 | Theater/weak data display | 🟡 | P3 |
