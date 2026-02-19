# Workspace Isolation Status

**Last Updated:** 2026-02-19  
**Related:** [`NEXT_STEPS.md`](NEXT_STEPS.md), [`COOLIFY_DEPLOY_NX_RUNBOOK.md`](COOLIFY_DEPLOY_NX_RUNBOOK.md)

---

## Scope

This status reflects active production paths only:

- Gateway: `openclaw/src/gateway/*`
- UI: `openclaw/ui/*`
- Embedded n8n runtime behind OpenClaw proxy

---

## Isolation Model

OpenClaw uses workspace-scoped isolation for all user-facing automation data.

- PMOS auth session identifies user + `workspaceId`.
- Workflow isolation in embedded n8n is enforced with workspace tags at proxy layer.
- n8n authentication is workspace-scoped and auto-provisioned from PMOS session context.

---

## Implementation Matrix

| Domain | Status | Enforcement Point |
|---|---|---|
| Agents | COMPLETE | `openclaw/src/gateway/server-methods/agents.ts` |
| Cron jobs | COMPLETE | `openclaw/src/gateway/server-methods/cron.ts` |
| Sessions | COMPLETE | `openclaw/src/gateway/server-methods/sessions.ts` |
| Workspace config overrides | COMPLETE | `openclaw/src/gateway/workspace-config.ts`, `openclaw/src/gateway/workspace-config-http.ts` |
| Workspace connectors | COMPLETE | `openclaw/src/gateway/workspace-connectors.ts` |
| Embedded n8n workflow list/create isolation | COMPLETE | `openclaw/src/gateway/pmos-ops-proxy.ts` |
| Embedded n8n user identity mapping | COMPLETE | `openclaw/src/gateway/n8n-auth-bridge.ts` |
| Super-admin workspace switcher UI | PARTIAL | Backend role model exists; complete active UI switcher not shipped |

---

## n8n Identity Behavior

Current behavior for embedded n8n access:

1. User signs up or logs in to PMOS.
2. PMOS warms workspace-scoped n8n identity (`pmos-auth-http.ts`).
3. Auth bridge resolves PMOS session and injects workspace n8n cookie (`n8n-auth-bridge.ts`).
4. Workflow API calls are filtered to workspace-owned workflows (`pmos-ops-proxy.ts`).

Hard guardrails:

- `N8N_ALLOW_OWNER_FALLBACK=0` for strict tenant behavior.
- `N8N_OWNER_EMAIL` and `N8N_OWNER_PASSWORD` are required for invitation-based workspace user provisioning.

---

## Known Gaps

- No completed super-admin workspace-switcher UX in active `openclaw/ui`.
- End-to-end multi-user isolation smoke is not yet enforced in CI by default.
- Some advanced orchestration features are still placeholder/simulated and should not be treated as isolation regressions.

---

## Verification (Post-Deploy)

1. Create/login as User A, create workflow, confirm visible in Automations.
2. Create/login as User B, confirm User A workflow is not visible.
3. Confirm User B create/delete/enable operations work on User B workflows.
4. Confirm refresh keeps session and embedded editor renders.
5. Confirm `/ops-ui/assets/*.js` returns JavaScript content type (not HTML fallback).

---

## Rollback Safety

If isolation behavior regresses, roll back to previous working image and rerun the verification checklist above before re-enabling traffic.
