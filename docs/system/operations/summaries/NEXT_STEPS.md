# NEXT STEPS - PMOS (OpenClaw Base + Activepieces Engine)

Last updated: 2026-02-15
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

1. `https://os.wickedlab.io/api/health` returns 200.
2. From inside the PMOS container:
   - `node openclaw.mjs gateway call pmos.connectors.status --json`

## Immediate Work Queue (Phase 2 Start)

1. Activepieces native embed (no app switching):
   - Implement Flows view in PMOS UI:
     - list flows
     - open flow editor inside PMOS (graph + step config)
     - run flow + show live runs/logs
   - Implement Integrations view:
     - list pieces catalog
     - list connections + create/update/delete

2. PMOS identity + admin:
   - Add PMOS native auth (email first).
   - Add workspaces + roles (`system_admin`, `workspace_admin`, `member`, `viewer`).
   - Add admin screens: users/invites/roles + audit/events.

3. AI-assisted flow creation (the "watch it build" experience):
   - Chat -> graph-ops stream (`add_node`, `add_edge`, `update_mapping`)
   - Live canvas updates in PMOS
   - Commit to Activepieces, show result immediately

## Deployment / Smoke Checklist (Every Deploy)

1. `https://os.wickedlab.io/` loads (OpenClaw Control UI).
2. `OPENCLAW_GATEWAY_TOKEN` is present in PMOS env (required for LAN bind behind Traefik).
3. `https://flow.wickedlab.io/api/v1/flags` returns 200.
4. `https://bcgpt.wickedlab.io/connect` returns 200.
5. From PMOS UI, verify:
   - can reach Activepieces (API 200 with key)
   - can reach BCGPT MCP tools (API 200 with key)

## Fresh Session Rule

Before coding:

1. Read `docs/00-START-HERE.md`.
2. Read the canonical plan.
3. Confirm the guardrails.
