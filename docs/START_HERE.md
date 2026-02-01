# START HERE: Project Onboarding (BCGPT)

Last updated: 2026-01-31

This doc is the entry point for a brand-new session. Read this first, then follow the links.

## What this project is
BCGPT is a Basecamp MCP server with an OpenAPI layer for ChatGPT. It supports an intelligent chaining layer that enriches results, applies fallback logic, and (via `smart_action`) routes queries even when the action list is limited to 30 items.

## Behavior guide (for humans and AIs)
When you work on this repo, follow these rules:
1) Prefer official docs: use `docs/reference/bc3-api` as the source of truth.
2) Preserve stability: add fallbacks to avoid hard errors (prefer empty lists/soft failures over throws).
3) Respect the 30-action OpenAPI limit: route extras through MCP + `smart_action`.
4) Keep documentation in `docs/` only; do not add new .md files at repo root.
5) Update coverage docs when adding tools:
   - `docs/coverage/BASECAMP_API_COVERAGE.md`
   - `docs/coverage/BASECAMP_API_ONLINE_AUDIT_2026-01-31.md`
6) Avoid breaking changes: keep existing tool names/inputs stable.
7) Commit + push only at the end of a session (not after every change).

## How to run (local)
1) Set required env vars in `.env` or your environment:
   - `BASECAMP_CLIENT_ID`
   - `BASECAMP_CLIENT_SECRET`
2) Start the server (see `package.json` scripts).
3) Connect via `/startbcgpt` to authorize.
4) Use `/action/<operation>` for OpenAPI actions or `/mcp` for MCP JSON-RPC.

## Core runtime files
- `index.js` — HTTP server, OpenAPI, and MCP wiring
- `mcp.js` — tool definitions + handler logic (source of truth for MCP tools)
- `basecamp.js` — Basecamp API wrapper w/ pagination
- `intelligent-integration.js` — intelligent helpers (retry, parallel, routing)
- `intelligent-executor.js` — RequestContext + core chaining
- `result-enricher.js` — enrichment logic
- `query-parser.js` — intent detection used by `smart_action`

## OpenAPI 30-action limit
The OpenAPI schema is capped at 30 actions. We added:
- `smart_action` — a router that interprets natural language and calls the best tool.
Some MCP tools are intentionally NOT in OpenAPI; see coverage report.

## Current phase status
- Phase 3: complete
- Phase 3.5: in progress (edge-case handling + intelligent fallbacks still being hardened)
- Phase 4: not started

See: `docs/phases/PHASE_3_STATUS.md`

## Where docs live
All documentation is under `docs/`:
- `docs/DOCS_INDEX.md` — map of all docs
- `docs/coverage/BASECAMP_API_COVERAGE.md` — coverage status vs Basecamp API + OpenAPI
- `docs/reference/bc3-api` — official Basecamp API docs (cloned repo)

## How to extend safely
1) Update `mcp.js` tools list + handler
2) Add fallbacks (avoid hard errors)
3) Update OpenAPI if it needs a new action (or use `smart_action`)
4) Update `docs/coverage/BASECAMP_API_COVERAGE.md`

## Quick debugging
- Check `/health` for server
- Use `/action/startbcgpt` to verify auth
- Inspect logs for `[tool_name] Error:` lines
