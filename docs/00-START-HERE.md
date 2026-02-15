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

PM OS is a 3-layer system in one repo:

1. `docs/bcgpt/` - Data layer (Basecamp + MCP)
2. `docs/flow/` - Execution layer (Activepieces integration)
3. `docs/pmos/` - Intelligence layer (agent/chat/reasoning)

Goal: OpenClaw-level capability with native code, faster execution, and no iframe dependency.

## Current code anchors

- Backend entrypoint: `index.js`
- MCP/tool orchestration: `mcp.js`
- Activepieces native tools: `flow-tools.js`
- Frontend shell/chat: `frontend/src/components/Layout.tsx`, `frontend/src/components/ChatSidebar.tsx`

## Fresh-session rule

Before changing code, first confirm:

1. `git status --short`
2. Docs state matches current code paths and endpoints
3. Active task order in `CURRENT_STATE_AND_EXECUTION_PLAN.md`
