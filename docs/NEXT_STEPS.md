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
| Chat-to-workflow real persistence in n8n | PARTIAL | `openclaw/src/gateway/server-methods/chat-to-workflow.ts` still returns generated ID placeholder |
| Multi-agent orchestration as real runtime | PARTIAL | `openclaw/src/gateway/agent-orchestrator.ts` contains placeholder execution paths |
| Live flow builder true real-time + n8n-backed control | PARTIAL | `openclaw/src/gateway/live-flow-builder.ts` contains simulated/polling placeholders |
| Super-admin workspace-switcher UI | NOT SHIPPED | No complete active UI implementation in `openclaw/ui` |

---

## Current Priorities

### P0 - Keep Automations Stable In Production

- [x] Wire full Automations view into active render path (`openclaw/ui/src/ui/app-render.ts`)
- [x] Keep embedded n8n canvas visible in-panel (`openclaw/ui/src/ui/views/automations.ts`)
- [x] Enforce strict workspace-scoped identity by default (owner fallback opt-in only)
- [x] Warm workspace n8n identity on signup/login to reduce first-load races
- [ ] Add CI smoke that verifies `/ops-ui/assets/*.js` returns JavaScript content type
- [ ] Add CI smoke that verifies two users do not see each other's workflow list

### P1 - Finish User-Facing Functionality Before Marking Complete

- [ ] Remove "complete" labels from features that still return placeholder/simulated results
- [ ] Decide whether to hide unfinished chat-to-workflow / live-builder controls in production UI
- [ ] Implement real n8n persistence path in `pmos.workflow.confirm`
- [ ] Replace simulated flow-control actions with real n8n-backed actions

### P2 - Quality Gates

- [x] Build gates pass (`openclaw-app`, `openclaw-control-ui`)
- [ ] UI tests pass in CI with Playwright browser binaries installed
- [ ] E2E multi-user workspace isolation smoke in deployed environment

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
