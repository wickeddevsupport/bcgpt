# PMOS Unified Platform Plan (OpenClaw + Activepieces)

Last updated: 2026-02-16
Owner: `bcgpt` monorepo
Canonical scope: build PMOS as a real multi-tenant product on top of OpenClaw + Flow Pieces without disturbing live MCP/Flow services.

## 1. Locked Product Model

1. `os.wickedlab.io` is the PMOS product UI and control plane.
2. PMOS runtime base is OpenClaw (`openclaw/`).
3. Flow Pieces engine is Activepieces (`flow.wickedlab.io`) and is consumed natively inside PMOS.
4. BCGPT (`bcgpt.wickedlab.io`) remains a connector and MCP/connect surface.
5. Basecamp is one connector, not the center of PMOS architecture.

## 2. Guardrails (Non-Negotiable)

1. Do not change MCP contracts/behavior on `bcgpt.wickedlab.io` unless explicitly approved.
2. Do not change Activepieces behavior on `flow.wickedlab.io` unless explicitly approved.
3. PMOS work is additive in `openclaw/` plus PMOS glue code.
4. Every deployment must keep an immediate rollback path.
5. Every phase must have smoke checks before being marked complete.

## 3. Current Delivered Baseline

The following are already built and treated as baseline:

1. OpenClaw-based PMOS shell is live on `os.wickedlab.io`.
2. PMOS-first navigation (Dashboard, Automations, Runs, Integrations, Chat).
3. Connector onboarding and status checks (Flow Pieces + BCGPT).
4. Native Flow Pieces screens in PMOS (flows, runs, connections, pieces).
5. Reimagined dashboard foundation with real metrics and execution trace.
6. Admin shell foundations (workspace identity, members, audit feed).
7. Live flow builder stream and command center foundations.
8. Phase 7 M1 is implemented locally:
   - PMOS sign-in/sign-up/session endpoints
   - role bootstrap (`super_admin` first, then `workspace_admin`)
   - UI auth gate before dashboard
   - server-side super-admin shell restriction
   - targeted tests passing

## 4. Productization Execution Plan (The "Do It All" Plan)

## Phase 7: Identity, Auth, and Roles

Goal: make PMOS a normal app with sign in/sign up and safe role model.

Scope:
1. Add PMOS auth flows (email/password first, OAuth optional second pass).
2. Role bootstrap policy:
   - First account: `super_admin`
   - Every later signup: `workspace_admin` with own workspace by default
3. Role permissions:
   - `super_admin`: global governance + shell access
   - `workspace_admin`: full workspace usage, no shell access
   - `member`: core usage, no shell access
   - `viewer`: read-only surfaces

Acceptance criteria:
1. New users land on sign-in/sign-up, not direct dashboard.
2. First-account bootstrap works once and is immutable without DB migration.
3. Role checks enforced server-side and UI-side.
4. Shell endpoints blocked for non-`super_admin`.

## Phase 8: Workspace Onboarding Wizard (Non-Technical Setup)

Goal: setup should feel like consumer onboarding, not infra work.

Scope:
1. First-run wizard with 3 steps:
   - Connect Flow Pieces
   - Connect BCGPT/Basecamp
   - Add AI provider key and default model
2. Guided checks with plain language pass/fail messages.
3. One-click "test all" and "start using chat" handoff.

Acceptance criteria:
1. Workspace admin can complete setup without terminal.
2. Wizard reports connector health and required actions clearly.
3. Chat becomes usable immediately after wizard completion.

## Phase 9: Simplified Workspace UX

Goal: regular users get an intuitive product surface.

Scope:
1. Keep advanced OpenClaw panels hidden by default.
2. Primary nav for workspace users:
   - Dashboard
   - Automations
   - Runs
   - Integrations
   - Chat
3. Build Flow Studio as a direct Activepieces-style editor inside PMOS:
   - center canvas with trigger/action cards
   - right-side step configuration panel with dropdowns, selectors, and guided fields
   - no "open external app" jump for normal flow editing
4. Add a persistent side chatbox in the same Flow Studio screen for AI-assisted flow creation/editing with live graph updates.
5. Improve empty states and setup copy.
6. Add role-aware UI gating to prevent inaccessible actions.

Acceptance criteria:
1. Non-technical workspace admin can navigate core flows without docs.
2. Users can edit full flow details from PMOS using intuitive form controls (dropdown-first UX).
3. Chat-driven flow edits are visible live on the same screen.
4. No shell/admin-only controls appear for non-eligible roles.

## Phase 10: Chat-First Operations and Live Trace

Goal: users can do most actions by chat, with transparent progress.

Scope:
1. Model-agnostic execution trace in chat sidebar:
   - plan
   - tool calls
   - status updates
   - result summary
2. Chat-driven flow creation/edit/run paths.
3. Approval gates for destructive actions.
4. Operation history with replay-friendly metadata.

Acceptance criteria:
1. Chat request can create or update a flow end-to-end in PMOS.
2. Execution trace is visible consistently across supported models.
3. High-risk actions require explicit approval before execution.

## Phase 11: Multi-Tenant Safety and Runtime Hardening

Goal: safe shared product operation at scale.

Scope:
1. Workspace-level isolation of settings, sessions, connectors, agents.
2. Secret storage hardening and masking.
3. Per-workspace quotas/rate limits.
4. Structured audit logs for security/admin operations.

Acceptance criteria:
1. Cross-workspace data leakage tests pass.
2. Secrets are never exposed in plaintext in UI or logs.
3. Quota/rate behavior is enforced and observable.

## Phase 12: Release Readiness and Launch Gate

Goal: production-grade confidence before broad rollout.

Scope:
1. E2E tests for:
   - signup/signin
   - onboarding
   - connector health
   - chat -> execute -> approve flow
   - automations/runs lifecycle
2. SLO and monitoring setup:
   - route health
   - chat latency
   - tool failure rates
3. Rollback drill and runbook lock.

Acceptance criteria:
1. E2E suite passes in CI and production smoke environment.
2. Monitoring and alerts are active.
3. Rollback runbook validated in drill.

## 5. Delivery Milestones

1. Milestone M1: Auth and role bootstrap complete in code, pending server deploy + smoke (Phase 7).
2. Milestone M2: Wizard-driven onboarding complete (Phase 8).
3. Milestone M3: Simplified UX and role-gated surfaces complete (Phase 9).
4. Milestone M4: Chat-first operations and approval loop complete (Phase 10).
5. Milestone M5: Multi-tenant hardening + launch gate complete (Phases 11-12).

## 6. Definition of Done (Program Level)

All must be true:

1. Users can sign up/sign in as a normal product.
2. First user is `super_admin`; all others default to `workspace_admin` with isolated workspace.
3. Non-super-admin users cannot access shell execution paths.
4. Workspace admins can fully create/manage automations and agents without shell.
5. Flow edits in PMOS reflect in Flow Pieces and vice versa.
6. Flow Studio in PMOS is Activepieces-grade usable (canvas + right config panel + dropdown-guided fields).
7. Chat executes end-to-end operations with visible execution trace and approvals on the same workflow surface.
8. E2E, monitoring, and rollback checks pass.
9. MCP and Flow production services remain stable and backward-compatible.

## 7. Fresh Session Start Protocol

Before coding:

1. Read this file.
2. Read `docs/system/operations/summaries/NEXT_STEPS.md`.
3. Read `docs/OPENCLAW_ANALYSIS.md` for engine integration context.
4. Run `git status --short`.
5. Confirm guardrails and current milestone target.

## 8. Documentation Discipline

Every meaningful change updates:

1. `docs/system/operations/summaries/CURRENT_STATE_AND_EXECUTION_PLAN.md`
2. `docs/system/operations/summaries/NEXT_STEPS.md`
3. The relevant implementation document under `docs/system/` or `docs/pmos/`.
