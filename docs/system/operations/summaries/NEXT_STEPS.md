# NEXT STEPS - PMOS Productization Board

Last updated: 2026-02-16
Canonical plan: `docs/system/operations/summaries/CURRENT_STATE_AND_EXECUTION_PLAN.md`

## 1. Current Target

Execute productization Phases 7-12 to turn PMOS into a normal multi-user product while keeping MCP and Flow services stable.

## 2. Guardrails

1. MCP server behavior unchanged unless explicitly approved.
2. Flow Pieces behavior unchanged unless explicitly approved.
3. PMOS work isolated to OpenClaw/PMOS customization layer.

## 3. Active Milestone Queue

## M1: Auth + Roles (Phase 7)
Status: completed and deployed (smoke passed)

Tasks:
1. Add sign-in/sign-up routes and session middleware. [done]
2. Add role bootstrap policy:
   - first account -> `super_admin` [done]
   - later signups -> `workspace_admin` [done]
3. Enforce role guards server-side. [done]
4. Enforce shell access restriction to `super_admin` only. [done]

Done when:
1. Users can authenticate through PMOS UI. [done]
2. Role bootstrap and role checks are verified by tests. [done]
3. Non-super-admin shell attempts are blocked. [done]

Validation run:
1. `corepack pnpm --dir openclaw exec vitest run src/gateway/pmos-auth.test.ts src/gateway/server-methods.pmos-role.test.ts` [done]
2. `corepack pnpm --dir openclaw/ui build` [done]
3. Live smoke:
   - `POST /api/pmos/auth/signup` first user -> `super_admin` [done]
   - `POST /api/pmos/auth/signup` second user -> `workspace_admin` [done]
   - `GET /api/pmos/auth/me` returns authenticated user with session cookie [done]
   - `POST /api/pmos/auth/logout` clears auth session [done]

## M2: Onboarding Wizard (Phase 8)
Status: in progress

Tasks:
1. Build first-run setup wizard screens. [done]
2. Add connector test step for Flow Pieces. [in progress]
3. Add connector test step for BCGPT/Basecamp. [in progress]
4. Add AI provider key/model setup step. [pending]
5. Add final "ready to use chat" state. [pending]

Implemented this pass:
1. Dashboard `Quick Setup Wizard` with ordered setup steps and progress state.
2. Step-level CTAs (connect, integrations, automations, runs) with one-click navigation.
3. `Run setup check` action wired to full dashboard refresh.

Done when:
1. Workspace admin can finish setup with no terminal actions.
2. Wizard displays clear pass/fail actions per connector.

## M3: Simplified UX (Phase 9)
Status: pending

Tasks:
1. Keep advanced surfaces hidden for regular roles.
2. Port an Activepieces-style Flow Studio UI directly into PMOS:
   - center flow canvas
   - right configuration panel
   - dropdown/selector-first step editing UX
3. Add side chatbox in Flow Studio for direct flow creation/editing with live graph updates.
4. Refine primary nav and empty states.
5. Add role-aware UI gating everywhere.
6. Add plain-language setup hints in Dashboard/Integrations.

Done when:
1. Workspace admin UX is clean and non-technical.
2. Users can fully edit flow steps in PMOS without switching to Flow Pieces UI.
3. Chat-generated flow changes are visible live next to the canvas.
4. Admin-only or shell-only controls are never shown to ineligible users.

## M4: Chat-First Execution (Phase 10)
Status: pending

Tasks:
1. Normalize execution trace schema for all models.
2. Render live trace in chat sidebar.
3. Wire chat intents to flow create/edit/run actions.
4. Add approval workflow for high-risk actions.

Done when:
1. Chat can execute end-to-end PMOS operations with visible trace.
2. Approval gates block high-risk operations until approved.

## M5: Hardening + Launch (Phases 11-12)
Status: pending

Tasks:
1. Add workspace isolation tests.
2. Add secrets masking and audit hardening.
3. Add quota/rate-limit controls.
4. Add E2E pipeline and production smoke suite.
5. Finalize monitoring + rollback runbook drill.

Done when:
1. Security and isolation checks pass.
2. E2E + smoke checks pass.
3. Rollback drill is successful.

## 4. Immediate Implementation Order

1. Complete remaining M2 wizard steps (provider key step + ready-state handoff).
2. Start M3 UX simplification with Activepieces-style Flow Studio + side chat.
3. Continue role-aware gating cleanup for workspace admins.

## 5. Deployment Checklist (Each Milestone)

1. Build and deploy PMOS only (`os.wickedlab.io`).
2. Verify:
   - `https://os.wickedlab.io/`
   - login/signup flows (when M1 lands)
   - connector checks and wizard path (when M2 lands)
3. Confirm no regression:
   - `https://bcgpt.wickedlab.io/health`
   - `https://flow.wickedlab.io/api/v1/flags`
4. Run PMOS smoke script:
   - `node openclaw/scripts/pmos-smoke.mjs`

## 6. Fresh Session Rule

Before coding:

1. Read canonical plan and this file.
2. Pick the current active milestone.
3. Keep guardrails locked.
