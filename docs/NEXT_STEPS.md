# Next Steps - Reality-Based Plan

**Last Updated:** 2026-02-19
**Related:** [`COOLIFY_DEPLOY_NX_RUNBOOK.md`](COOLIFY_DEPLOY_NX_RUNBOOK.md), [`WORKSPACE_ISOLATION_STATUS.md`](WORKSPACE_ISOLATION_STATUS.md)

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
| Chat-to-workflow real persistence in n8n | PARTIAL | `openclaw/src/gateway/server-methods/chat-to-workflow.ts` still returns generated ID placeholder |
| Multi-agent orchestration as real runtime | PARTIAL | `openclaw/src/gateway/agent-orchestrator.ts` contains placeholder execution paths |
| Live flow builder true real-time + n8n-backed control | PARTIAL | `openclaw/src/gateway/live-flow-builder.ts` contains simulated/polling placeholders |
| Dashboard real run data (flows/workflows/run count) | NOT SHIPPED | `openclaw/ui/src/ui/app-render.ts` passes `flows: []` and `runs: []` hardcoded |
| Auto-trigger onboarding after first signup | NOT SHIPPED | Currently only shows via `?onboarding=1` URL param; new users never see it |
| Onboarding auto-collapse when core ready | NOT SHIPPED | Wizard stays open even when all 3 steps are complete |
| Workflow execution history UI | NOT SHIPPED | n8n has full execution logs; no UI to browse them in dashboard |
| Notifications / activity feed | NOT SHIPPED | `pmosTraceEvents` exists but no panel UI |
| Agent memory view | NOT SHIPPED | Backend has `agents.files.get/set`; no UI |
| Super-admin workspace list | NOT SHIPPED | Needs `workspaces.list` backend method; only topbar button exists so far |

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
- [ ] Auto-trigger onboarding for new users after first signup (instead of requiring `?onboarding=1`)
- [ ] Auto-collapse onboarding wizard when all 3 steps are complete / `pmosModelConfigured` is true
- [ ] Implement real n8n persistence path in `pmos.workflow.confirm` (chat-to-workflow)
- [ ] Replace simulated flow-control actions with real n8n-backed actions in live-flow-builder

### P2 - Dashboard & Discovery

- [x] Workflow templates gallery in Automations sidebar
- [x] AI Flow Builder marked as Preview (honest labeling)
- [ ] Dashboard: fetch and display real workflow count + recent run stats (currently `flows: []`, `runs: []`)
- [ ] Workflow execution history panel (browse n8n execution logs from dashboard)
- [ ] Notifications / activity feed (wire `pmosTraceEvents` into a sidebar panel)
- [ ] Agent memory view (list/edit files from `agents.files.get/set`)

### P3 - Admin & Multi-Workspace

- [x] Admin Panel button in topbar for super_admin users
- [ ] Super-admin workspace list (implement `workspaces.list` backend method + populate admin panel UI)
- [ ] Per-workspace usage metrics

### P4 - Quality Gates

- [x] Build gates pass (`openclaw-app`, `openclaw-control-ui`)
- [ ] UI tests pass in CI with Playwright browser binaries installed
- [ ] E2E multi-user workspace isolation smoke in deployed environment

---

## Recent Commits (2026-02-19)

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
