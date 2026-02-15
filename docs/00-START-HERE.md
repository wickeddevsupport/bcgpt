# PM OS Docs Start Here

Last updated: 2026-02-15

This is the quickest path to recover context in a fresh session.

## Read in this order

1. `docs/system/operations/summaries/CURRENT_STATE_AND_EXECUTION_PLAN.md`
2. `docs/system/operations/summaries/NEXT_STEPS.md`
3. `docs/system/architecture/SYSTEM_ARCHITECTURE.md`
4. `docs/OPENCLAW_ANALYSIS.md`

Then use `docs/DOCS_INDEX.md` for deep navigation.

## What we are building

PM OS is one product built from 3 engines/layers in one repo:

1. `docs/bcgpt/` - Data layer (Basecamp + MCP)
2. `docs/flow/` - Execution layer (Activepieces integration)
3. `docs/pmos/` - Product layer (PMOS UX, orchestration, admin)

Key decision: PMOS is now built directly on OpenClaw (vendored under `openclaw/`) and embeds Activepieces functionality in-app.

## Current code anchors

- Backend entrypoint: `index.js`
- MCP/tool orchestration: `mcp.js`
- Activepieces native tools: `flow-tools.js`
- OpenClaw base engine + Control UI: `openclaw/`
- PMOS deployment compose: `docker-compose.pmos.yml`

## Fresh-session rule

Before changing code, first confirm:

1. `git status --short`
2. Docs state matches current code paths and endpoints
3. Active task order in `CURRENT_STATE_AND_EXECUTION_PLAN.md`
