# NEXT STEPS - PMOS (OpenClaw Base + Activepieces Engine)

Last updated: 2026-02-16
Canonical plan: `docs/system/operations/summaries/CURRENT_STATE_AND_EXECUTION_PLAN.md`

## Current Reality (Keep This Straight)

1. PMOS is `os.wickedlab.io` and is **OpenClaw gateway + Control UI** built from `openclaw/` via `docker-compose.pmos.yml`.
2. Activepieces engine remains live at `flow.wickedlab.io` (unchanged).
3. BCGPT MCP/connect remains live at `bcgpt.wickedlab.io` (unchanged).

## Guardrails (Must Stay True)

1. Do not change MCP behavior/tool contracts on `bcgpt.wickedlab.io` unless explicitly approved.
2. Do not change Activepieces behavior on `flow.wickedlab.io` unless explicitly approved.
3. PMOS work happens in `openclaw/` (UI + extensions) and PMOS glue modules.

## Phase 1 (Complete): OpenClaw UX + Connector Onboarding

Shipped + deployed to `os.wickedlab.io`:

1. Simplified OpenClaw Control UI into a PMOS shell:
   - PMOS-first navigation (Dashboard, Automations, Runs, Integrations, Chat).
   - Legacy panels moved under "Admin (Advanced)" and collapsed by default.
2. Added connector onboarding + health checks:
   - Activepieces: reachability + auth probe via flows list.
   - BCGPT: reachability + auth probe via MCP `tools/list` (API key required).
3. Added gateway method: `pmos.connectors.status`.

Smoke validation:

1. `https://os.wickedlab.io/health` returns 200.
2. From inside the PMOS container:
   - `node openclaw.mjs gateway call pmos.connectors.status --json`

## Phase 2 (Complete): Native Activepieces Embed

Shipped + deployed to `os.wickedlab.io`:

1. Integrations view includes:
   - pieces catalog (search + browse)
   - connections CRUD (create/list/delete)
2. Automations (Flows) view includes:
   - list + create flows
   - open flow details
   - basic mutations (rename, enable/disable, publish, delete)
   - webhook trigger + payload JSON
   - advanced FlowOperationRequest editor (raw op JSON)
3. Runs view includes:
   - list runs + view details
   - retry (supported strategies)

Prerequisite: set Activepieces `projectId` (many APIs require it).
- PMOS -> Integrations -> Activepieces -> Project ID, then Save
- Stored at `pmos.connectors.activepieces.projectId`

## Phase 3 (Complete): Reimagined Dashboard Foundation

Shipped + deployed to `os.wickedlab.io`:

1. Dashboard now uses real PMOS data:
   - Portfolio Pulse (flows/runs/connector risk)
   - Automation Live (recent runs + status counters)
   - Focus Today (prioritized action cards with drill-down links)
2. Agent Timeline uses standardized PMOS execution trace schema.
3. Chat view now shows the same live execution trace stream.
4. Dashboard polling refreshes connectors/flows/runs while dashboard is open.

## Phase 4 (Complete): PMOS Identity + Admin Shell

Shipped + deployed to `os.wickedlab.io`:

1. Workspace identity panel in PMOS Admin.
2. Workspace members management (add/remove, role/status).
3. PMOS audit feed for admin and PMOS action events.

## Phase 5 (Complete): Live AI Flow Builder

Shipped + deployed to `os.wickedlab.io`:

1. Prompt-driven graph generation in Automations.
2. Live graph operation stream (`add_node`, `add_edge`, `set_mapping`).
3. Commit flow shell to Activepieces and open it in PMOS.

## Phase 6 (Complete): Unified Command Center

Shipped + deployed to `os.wickedlab.io`:

1. Prompt -> plan pipeline for PMOS actions.
2. Multi-step execution with high-risk approval queue.
3. Command history and pending approvals in PMOS UI.

## Immediate Work Queue (Phase 7)

1. Hardening and production readiness:
   - CI smoke gate using PMOS smoke suite.
   - telemetry + alerting for chat/tool failures.
   - rollback drills and runbook lock.
2. UX polish for regular users:
   - simpler onboarding copy
   - clearer setup guidance and error states.

## Deployment / Smoke Checklist (Every Deploy)

1. `https://os.wickedlab.io/` loads (OpenClaw Control UI).
2. `OPENCLAW_GATEWAY_TOKEN` is present in PMOS env (required for LAN bind behind Traefik).
3. Run `node openclaw/scripts/pmos-smoke.mjs` with:
   - `OPENCLAW_GATEWAY_TOKEN`
   - `ACTIVEPIECES_PROJECT_ID`
4. `https://flow.wickedlab.io/api/v1/flags` returns 200.
5. `https://bcgpt.wickedlab.io/connect` returns 200.
6. From PMOS UI, verify:
   - chat sends and gets assistant reply
   - flows create/open/edit/run works
   - command center plan/execute/approval works

## Fresh Session Rule

Before coding:

1. Read `docs/00-START-HERE.md`.
2. Read the canonical plan.
3. Confirm the guardrails.
