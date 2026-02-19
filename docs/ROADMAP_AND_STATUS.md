# OpenClaw Automation OS - Roadmap And Current Status

**Last Updated:** 2026-02-19

---

## Snapshot

This roadmap reflects active code paths and deployed behavior, not aspirational status.

| Phase | Scope | Status |
|---|---|---|
| Phase 1 | Workspace isolation + auth foundations | MOSTLY COMPLETE |
| Phase 2 | Embedded n8n runtime + ops proxy | COMPLETE |
| Phase 3 | Active UI integration + BYOK | IN PROGRESS |
| Phase 4 | Chat-to-workflow, orchestration, live-builder maturity | PARTIAL / NOT PRODUCTION-READY |

---

## What Is Shipped

- Embedded n8n boots with gateway and serves under `/ops-ui/`.
- Active Automations UI embeds n8n canvas directly in the dashboard path.
- Workflow list/create operations are workspace-filtered through proxy tag enforcement.
- PMOS session is bridged into n8n auth automatically.
- Signup/login now warms workspace n8n identity to reduce first-load races.
- BYOK encrypted storage and APIs are available.

Primary files:

- `openclaw/src/gateway/pmos-ops-proxy.ts`
- `openclaw/src/gateway/n8n-auth-bridge.ts`
- `openclaw/src/gateway/pmos-auth-http.ts`
- `openclaw/ui/src/ui/app-render.ts`
- `openclaw/ui/src/ui/views/automations.ts`

---

## What Is Still Partial

These exist but are not fully production-complete end-to-end:

- `openclaw/src/gateway/server-methods/chat-to-workflow.ts`
  - confirmation path still returns generated IDs with placeholder persistence behavior.
- `openclaw/src/gateway/agent-orchestrator.ts`
  - orchestration execution contains placeholder runtime behavior.
- `openclaw/src/gateway/live-flow-builder.ts`
  - flow control and update paths include simulated or polling-first behavior.

---

## What Must Happen Before "Production Ready" Claim

1. Enforce strict tenant identity in prod env:
   - `N8N_ALLOW_OWNER_FALLBACK=0`
   - `PMOS_ALLOW_REMOTE_OPS_FALLBACK=0`
2. Add CI/deploy smoke for two-user workflow isolation.
3. Replace placeholder persistence/control code paths with real n8n-backed operations.
4. Pass build/test gates plus browser test environment setup in CI.

---

## Deployment Health Checklist

- `https://os.wickedlab.io/` loads control UI.
- `https://os.wickedlab.io/ops-ui/` loads embedded n8n editor.
- `/ops-ui/assets/*.js` returns JavaScript content type (not HTML fallback).
- Authenticated `/api/ops/workflows` responds and is workspace-isolated.
- Refresh does not trap users in session-restore loop.

---

## Reference Docs

- [`NEXT_STEPS.md`](NEXT_STEPS.md)
- [`COOLIFY_DEPLOY_NX_RUNBOOK.md`](COOLIFY_DEPLOY_NX_RUNBOOK.md)
- [`WORKSPACE_ISOLATION_STATUS.md`](WORKSPACE_ISOLATION_STATUS.md)
