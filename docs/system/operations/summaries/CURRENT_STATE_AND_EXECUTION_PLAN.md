# PMOS Unified Platform Plan (OpenClaw + Activepieces)

Last updated: 2026-02-16
Owner: `bcgpt` monorepo
Purpose: single canonical plan so fresh sessions do not drift.

## Implementation Snapshot (2026-02-16)

Reality check: PMOS is now the **OpenClaw gateway + Control UI** deployed at `os.wickedlab.io`.
The earlier React PMOS prototype (`frontend/`) is not the PMOS product surface going forward.

### What is live / deployed

1. `os.wickedlab.io` runs OpenClaw (vendored under `openclaw/`) via `docker-compose.pmos.yml`.
2. OpenClaw is started in container mode (LAN bind) with `OPENCLAW_GATEWAY_TOKEN` set in Coolify env.
3. Phase 1 PMOS shell is live in the OpenClaw Control UI:
   - PMOS-first navigation (Dashboard, Automations, Runs, Integrations, Chat).
   - Legacy OpenClaw panels grouped under "Admin (Advanced)" and collapsed by default.
4. Connector onboarding + health checks are live:
   - UI: Integrations screen stores connector config in OpenClaw config (secrets redacted on read).
   - Gateway method: `pmos.connectors.status` (Activepieces + BCGPT reachability + auth probes).
5. Phase 2 native Activepieces embed is live inside the PMOS UI (no app-switching):
   - Integrations: pieces catalog + connections CRUD
   - Automations: flows list/create/edit/run (incl. webhook trigger)
   - Runs: list/details + retry
6. Phase 3 reimagined dashboard foundation is live:
   - Dashboard widgets now use real data (Portfolio Pulse, Automation Live, Focus Today).
   - Actionable drill-downs to Automations, Runs, Integrations, and Chat.
   - Standardized, model-agnostic PMOS execution trace is live in Dashboard and Chat.
   - Dashboard polling refreshes connectors/flows/runs while the Dashboard tab is active.
7. `flow.wickedlab.io` (Activepieces) remains a separate running service and is treated as the automation engine.
8. `bcgpt.wickedlab.io` remains the MCP/connect surface (Basecamp OAuth, MCP tools) and is treated as a connector.

Production image tag (PMOS / OpenClaw): `331392da`.

### Production verification (Phase 1 + Phase 2 + Phase 3)

1. `https://os.wickedlab.io/` loads.
2. PMOS build asset on `os.wickedlab.io` includes Phase 3 markers:
   - `Portfolio Pulse`, `Focus Today`, `Execution Trace`, `Refresh all`.
3. `POST https://os.wickedlab.io/tools/invoke` succeeds with PMOS access key for `flow_flows_list`.
4. For native flow/runs screens and dashboard stats, `activepieces.projectId` must be set.

### What is next (the actual build)

1. Phase 4: PMOS native auth + RBAC/admin:
   - email auth first, then optional OAuth
   - workspaces + roles + admin UI shell + audit feed
2. Phase 5: Live AI flow building (graph ops stream + commit/sync to Activepieces).
3. Phase 6: Unified command center (multi-step orchestration + approvals + history).

## 1. Core Product Direction

PMOS is the user-facing product. It is a modern automation and operations OS that combines:

1. OpenClaw as the base engine (sessions, orchestration, streaming UI patterns).
2. Activepieces as the flow engine (pieces/integrations, visual flow execution).
3. Existing BCGPT MCP leverage (Basecamp OAuth + tools as one connector among many).
4. A clean PMOS UX for building automations and managing work (project managers are a primary persona, not the only one).

Key principle: build on existing powerful software, do not rebuild engines from scratch.

## 2. Non-Negotiable Guardrails

1. `bcgpt.wickedlab.io` MCP server remains operational and unchanged unless explicitly approved.
2. `flow.wickedlab.io` Activepieces deployment remains operational and unchanged unless explicitly approved.
3. PMOS work is additive and isolated to the `openclaw/` (UI/engine) customization layer and new PMOS glue code.
4. No forced migration/cutover until parity and smoke checks pass.
5. Rollback path must exist for every deployment step.

## 3. Current Domain and Service Split

1. `os.wickedlab.io` = PMOS product surface.
2. `bcgpt.wickedlab.io` = MCP/connect surface (`/connect` remains valid).
3. `flow.wickedlab.io` = Activepieces flow application.

This split stays in place during buildout.

## 4. How Everything Comes Together

PMOS becomes the unifying layer, while OpenClaw/Activepieces/BCGPT stay specialized engines.

1. User interacts only with PMOS UI (OpenClaw Control UI reimagined).
2. PMOS orchestrator logic lives alongside OpenClaw and calls:
   - Activepieces APIs for flow CRUD/runs/pieces/connections
   - BCGPT MCP tools for Basecamp and data actions
3. PMOS streams status/events back to UI in real time (OpenClaw-style event UX).
4. PMOS stores workspace/user/admin state and audit metadata (PMOS-owned identity).

Outcome: one product experience, multiple proven engines.

## 5. Why This Path (Explicit Decision)

1. Reusing OpenClaw + Activepieces avoids rebuilding mature systems.
2. Existing MCP server already provides leverage and should be preserved.
3. Biggest value to build is the PMOS orchestration UX and admin layer, not another flow engine.
4. This reduces bugs, reduces drift, and keeps delivery speed high.

## 6. Auth, Identity, and Admin Model

PMOS supports multiple onboarding/auth paths:

1. Keep `bcgpt` connect path as one first-class option.
2. Add PMOS native auth (email + optional OAuth providers).
3. Link external connections per user/workspace.

Admin model:

1. Roles: `system_admin`, `workspace_admin`, `member`, `viewer`.
2. Admin console scope:
   - user and invite management
   - role assignment
   - connection policy controls
   - audit/activity views
   - feature flags and environment safety controls

## 7. Reimagined Dashboard (Critical)

The reimagined PMOS dashboard is a first-class build target, not a later polish task.

Required dashboard surfaces:

1. Chat sidebar command surface: primary ask/act/build input lives in chat (OpenClaw-style), not a separate top bar.
2. Portfolio Pulse: cross-project health, risk, blockers, momentum, ownership load.
3. Focus Today: personalized priority stack and next best actions.
4. Automation Live: real-time flow runs, failures, retries, and pending approvals.
5. Integration Health: connection state and auth health for MCP, Activepieces, and linked apps.
6. Agent Timeline: what AI executed, what changed, what needs human approval.
7. Live Thinking/Execution Trace: model-agnostic step stream in chat sidebar (plan, tool calls, progress, results).

Dashboard principles:

1. Real-time by default (event stream driven).
2. Actionable tiles (every insight links to a concrete action).
3. Unified context (projects + automations + operations in one place).
4. No iframe-first dependency.
5. Provider-agnostic UX: same PMOS execution trace experience regardless of connected AI model/provider.

## 8. Flow Experience Vision (Critical)

PMOS must support live AI-assisted flow creation:

1. User asks AI for a flow.
2. PMOS streams graph operations (`add_node`, `add_edge`, `update_mapping`) in real time.
3. User sees boxes/lines appear live in PMOS.
4. PMOS commits validated graph to Activepieces API.
5. Flow and runs reflect in Activepieces and PMOS simultaneously.

No iframe-first dependency for core creation/management workflow.

## 9. Repository and Runtime Strategy

Single repo, clear internal boundaries:

1. OpenClaw is vendored in-repo: `openclaw/` (engine + Control UI).
2. Activepieces is vendored in-repo: `activepieces/` (engine + UI), but it remains a separately deployed service for now.
3. PMOS customization work happens primarily in:
   - `openclaw/ui/` (PMOS UX shell)
   - `openclaw/src/` (gateway integration points)
   - `openclaw/extensions/` (PMOS connectors/tools: activepieces, bcgpt, etc.)
4. External running services remain stable during implementation (until an explicit migration decision is made).

## 10. Execution Phases

### Phase 0: Guardrails + Baseline Freeze

1. Freeze/record baseline checks for MCP and Activepieces endpoints.
2. Confirm no changes are applied to those services during PMOS feature work.

### Phase 1: Orchestrator Foundation

1. Define internal PMOS adapter contracts for Activepieces and MCP.
2. Normalize request/response and event shapes.
3. Wire OpenClaw Control UI to these adapters (so UI stays clean while engines are swappable).

### Phase 2: Identity + RBAC + Admin Shell

1. Add PMOS auth options (email first, optional OAuth next).
2. Add workspace model and role enforcement.
3. Deliver first admin UI shell and audit feed.

### Phase 3: Reimagined Dashboard Foundation

1. Build the new PMOS dashboard layout and data contracts.
2. Wire real-time widgets (Portfolio Pulse, Automation Live, Agent Timeline).
3. Add actionable drill-down paths from dashboard insights to execution views.
4. Implement chat-sidebar live execution trace stream with standardized event schema.

### Phase 4: Native Flows Surface

1. Replace iframe-first dependency with native flows screens.
2. Implement flow list/create/update/run using Activepieces API.
3. Add run logs and health/status panels in PMOS.

### Phase 5: Live AI Flow Builder

1. Implement graph-ops streaming from orchestration backend to PMOS canvas.
2. Add mid-build validation and error recovery.
3. Add commit/sync controls to Activepieces.

### Phase 6: Unified Command Center

1. Chat-driven orchestration across flows + MCP tools.
2. Multi-step plan execution with approval gates for risky actions.
3. Session history + operation timeline in PMOS.

### Phase 7: Hardening and Production Readiness

1. E2E smoke suite for PMOS and cross-service integration checks.
2. Rate limits, CORS, secret masking, structured logs, rollback docs.
3. Release checklist required before "phase complete" is declared.

## 11. Definition of Done (Program-Level)

All must be true:

1. PMOS can create/edit/run flows that appear in Activepieces without manual reconciliation.
2. Existing MCP and Activepieces services remain stable and unchanged by PMOS rollout.
3. PMOS auth + admin roles are enforced end to end.
4. Reimagined dashboard is live with real-time portfolio/automation/agent visibility.
5. Live AI flow creation works with real-time graph updates in UI.
6. Cross-service smoke tests pass in deployed environment.
7. Docs and next-step backlog match real implementation status.
8. Chat sidebar shows consistent live execution trace across supported AI providers.

## 12. Fresh Session Start Protocol

Any fresh session must do this before coding:

1. Read this file.
2. Read `docs/system/operations/summaries/NEXT_STEPS.md`.
3. Read `docs/OPENCLAW_ANALYSIS.md` (now a "where to change OpenClaw" guide, not an extraction plan).
4. Run `git status --short`.
5. Confirm current guardrails:
   - MCP untouched.
   - Activepieces untouched.
   - PMOS changes only unless explicitly approved.

## 13. Documentation Discipline

Every meaningful change must update:

1. `docs/system/operations/summaries/CURRENT_STATE_AND_EXECUTION_PLAN.md`
2. `docs/system/operations/summaries/NEXT_STEPS.md`
3. Relevant implementation docs under `docs/pmos/`, `docs/flow/`, or `docs/bcgpt/`
