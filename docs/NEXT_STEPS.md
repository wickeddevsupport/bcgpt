# Next Steps - Reality-Based Plan

**Last Updated:** 2026-02-19
**Related:** [`COOLIFY_DEPLOY_NX_RUNBOOK.md`](COOLIFY_DEPLOY_NX_RUNBOOK.md), [`WORKSPACE_ISOLATION_STATUS.md`](WORKSPACE_ISOLATION_STATUS.md), [`UI_AUDIT.md`](UI_AUDIT.md)

---

## Reality Check (Code vs Claims)

This file tracks what is actually implemented in active runtime code paths (`openclaw/ui` + `openclaw/src/gateway`).

| Area | Status | Evidence |
|---|---|---|
| Embedded n8n in active Automations tab | SHIPPED | `openclaw/ui/src/ui/app-render.ts`, `openclaw/ui/src/ui/views/automations.ts` |
| Workspace workflow isolation (single embedded n8n) | SHIPPED | `openclaw/src/gateway/pmos-ops-proxy.ts` (`ensureWorkspaceN8nTag`, list/create filtering) |
| Same-session PMOS -> n8n auto-auth | SHIPPED | `openclaw/src/gateway/n8n-auth-bridge.ts`, `openclaw/src/gateway/pmos-auth-http.ts` |
| Signup/login warm-up of workspace n8n identity | SHIPPED | `openclaw/src/gateway/pmos-auth-http.ts` (`warmEmbeddedN8nIdentity`) |
| BYOK encrypted workspace key storage | SHIPPED | `openclaw/src/gateway/byok-store.ts`, `openclaw/src/gateway/byok-http.ts` |
| Onboarding wizard wired + real BYOK form in Step 3 | SHIPPED | `openclaw/ui/src/ui/app-render.ts` (dashboard → wizard), `openclaw/ui/src/ui/views/onboarding.ts` |
| Workflow templates gallery in Automations sidebar | SHIPPED | `openclaw/ui/src/ui/views/automations.ts` (`WORKFLOW_TEMPLATES`) |
| Admin Panel button for super_admin users | SHIPPED | `openclaw/ui/src/ui/app-render.ts` (topbar) |
| AI Flow Builder labeled as Preview (not Live) | SHIPPED | `openclaw/ui/src/ui/views/automations.ts` |
| Chat tab crash (undefined agentId/agent) | FIXED | `openclaw/ui/src/ui/app-render.ts` — variables now declared in `renderApp()` scope |
| Auto-trigger onboarding after first signup | SHIPPED | `openclaw/ui/src/ui/app.ts` `handlePmosAuthSubmit()` sets `onboarding=true` on signup |
| Onboarding auto-collapse when AI key saved | SHIPPED | `openclaw/ui/src/ui/app-render.ts` — exits when `pmosModelConfigured === true` |
| Dashboard real workflow + run data | SHIPPED | `openclaw/ui/src/ui/app-render.ts` passes `state.apFlows` / `state.apRuns`; refresh calls `loadWorkflowRuns` |
| Workflow execution history panel | SHIPPED | "Recent Runs" card in Automations sidebar — `openclaw/ui/src/ui/views/automations.ts` |
| Notifications / activity feed | SHIPPED | Bell icon in topbar → slide-over panel with trace events (`openclaw/ui/src/ui/app-render.ts`) |
| Agent memory view | SHIPPED | "Memory" button in chat agent header navigates to agents → files panel |
| Super-admin workspace list | SHIPPED | `pmos.workspaces.list` backend + "All Workspaces" card in admin panel |
| Chat-to-workflow real persistence in n8n | PARTIAL | `openclaw/src/gateway/server-methods/chat-to-workflow.ts` — backend creates real n8n workflows; chat UI to invoke it needs redesign |
| Multi-agent orchestration as real runtime | PARTIAL | `openclaw/src/gateway/agent-orchestrator.ts` contains placeholder execution paths |
| Live flow builder true real-time + n8n-backed control | PARTIAL | `openclaw/src/gateway/live-flow-builder.ts` contains simulated/polling placeholders |

---

## Current Priorities

### P0 - Keep Automations Stable In Production

- [x] Wire full Automations view into active render path (`openclaw/ui/src/ui/app-render.ts`)
- [x] Keep embedded n8n canvas visible in-panel (`openclaw/ui/src/ui/views/automations.ts`)
- [x] Enforce strict workspace-scoped identity by default (owner fallback opt-in only)
- [x] Warm workspace n8n identity on signup/login to reduce first-load races
- [ ] Add CI smoke that verifies `/ops-ui/assets/*.js` returns JavaScript content type
- [ ] Add CI smoke that verifies two users do not see each other's workflow list

### P1 - Finish Core User Journey

- [x] Remove placeholder "Create Workflow" button from chat compose area
- [x] Wire onboarding wizard to dashboard — shows on `?onboarding=1` param
- [x] Wire Step 3 BYOK form to real `pmos.byok.set` via `handlePmosModelSave()`
- [x] Auto-trigger onboarding for new users after first signup (instead of requiring `?onboarding=1`)
- [x] Auto-collapse onboarding wizard when all 3 steps are complete / `pmosModelConfigured` is true
- [x] Implement real n8n persistence path in `pmos.workflow.confirm` (chat-to-workflow) — "Automate" button in chat compose, `handleChatCreateWorkflow` → `wicked-ops.generateN8nWorkflow` → real n8n
- [x] Replace simulated flow-control actions with real n8n-backed actions in live-flow-builder — `executeFlowControl` calls `setWorkflowActive`/`executeN8nWorkflow`; AI Flow Builder in Automations uses `ops_workflow_create`

### P2 - Dashboard & Discovery

- [x] Workflow templates gallery in Automations sidebar
- [x] AI Flow Builder marked as Preview (honest labeling)
- [x] Dashboard: fetch and display real workflow count + recent run stats
- [x] Workflow execution history panel (Recent Runs card in Automations sidebar)
- [x] Notifications / activity feed (bell icon → slide-over panel with trace events)
- [x] Agent memory view ("Memory" button in chat header → agents files panel)

### P3 - Admin & Multi-Workspace

- [x] Admin Panel button in topbar for super_admin users
- [x] Super-admin workspace list (`pmos.workspaces.list` backend + "All Workspaces" card in admin panel)
- [ ] Per-workspace usage metrics

### P4 - Quality Gates

- [x] Build gates pass (`openclaw-app`, `openclaw-control-ui`)
- [ ] UI tests pass in CI with Playwright browser binaries installed
- [ ] E2E multi-user workspace isolation smoke in deployed environment

---

## Recent Commits (2026-02-19)

- `675cfebe` feat(pmos): Complete all remaining TODO items — onboarding trigger, exec history, notifications, agent memory, workspace list
- `a9993d93` fix(pmos): Declare agentId and agent vars in renderApp to fix chat tab crash
- `88eaa406` feat(pmos): Wire onboarding BYOK form, templates gallery, remove placeholder controls

---

## Production Guardrails

- `PMOS_ALLOW_REMOTE_OPS_FALLBACK=0`
- `N8N_ALLOW_OWNER_FALLBACK=0`
- `N8N_OWNER_EMAIL` and `N8N_OWNER_PASSWORD` must be set (required for workspace user auto-provisioning)
- Never mark a phase "COMPLETE" unless active UI path and server path are both verified.

---

## Deploy Checklist (Short)

1. `NX_DAEMON=false corepack pnpm exec nx run-many -t build --projects=openclaw-app,openclaw-control-ui,openclaw-frontend --output-style=stream`
2. `NX_DAEMON=false corepack pnpm exec nx run openclaw-app:test --output-style=stream`
3. Deploy in Coolify.
4. Smoke check:
   - `https://os.wickedlab.io/`
   - `https://os.wickedlab.io/ops-ui/`
   - `https://os.wickedlab.io/api/ops/workflows` (authenticated)
5. Verify two different users have isolated workflow lists.

---

## Definition Of Done (Automations)

Automations is considered production-ready only when all are true:

- Each signed-in PMOS user lands in embedded n8n without separate login.
- Workflow list is isolated per workspace.
- Creating/enabling/deleting workflows works from active UI.
- Refreshing browser does not break session restore or iframe loading.
- Deployment runbook checks pass end-to-end.

---

## UI Gaps & Issues

See [UI_AUDIT.md](UI_AUDIT.md) for detailed documentation of:

- **P0 Critical**: Dashboard NL input, Quick Action buttons (no event handlers)
- **P1 Theater**: Onboarding Steps 1&2, Connections page (fake/non-functional)
- **P2 UX Issues**: Sessions vs Agents confusion, vague status displays, fake templates

**Key Questions for Product Decisions:**
1. Dashboard NL Input → Navigate to Chat or inline chat?
2. Quick Actions → What should "Check leads" / "Daily report" actually do?
3. Onboarding → Strip to BYOK only, or implement real tool connections?
4. Sessions dropdown → Show agent names instead of technical session keys?
