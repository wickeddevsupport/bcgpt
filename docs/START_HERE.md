# START HERE: Project Onboarding (BCGPT)

Last updated: 2026-02-03

This doc is the entry point for a brand-new session. Read this first, then follow the links.

## What this project is
BCGPT is a Basecamp MCP server with an OpenAPI layer for ChatGPT. It supports an intelligent chaining layer that enriches results, applies fallback logic, and (via `smart_action`) routes queries even when the action list is limited to 30 items. **/mcp is the authoritative interface; /action is a compatibility wrapper.**

## Behavior guide (for humans and AIs)
When you work on this repo, follow these rules:
1) Prefer official docs: use `docs/reference/bc3-api` as the source of truth.
2) Preserve stability: add fallbacks to avoid hard errors (prefer empty lists/soft failures over throws).
3) Respect the 30-action OpenAPI limit: route extras through MCP + `smart_action`.
4) Search correctness is mandatory: every search tool must return coverage metadata and avoid false negatives.
5) Prefer server-side search tools (`search_people`, `search_entities`) instead of client-side filtering.
6) Keep documentation in `docs/` only; do not add new .md files at repo root.
7) Update coverage docs when adding tools:
   - `docs/coverage/BASECAMP_API_COVERAGE.md`
   - `docs/coverage/BASECAMP_API_ONLINE_AUDIT_2026-01-31.md`
8) Avoid breaking changes: keep existing tool names/inputs stable.
9) Commit + push after each verified milestone (avoid partial or unverified changes).

## How to run (local)
1) Set required env vars in `.env` or your environment:
   - `BASECAMP_CLIENT_ID`
   - `BASECAMP_CLIENT_SECRET`
2) Start the server (see `package.json` scripts).
3) Connect via `/startbcgpt` to authorize.
4) Use `/mcp` for MCP JSON-RPC (preferred). `/action/<operation>` is a compatibility wrapper and may omit query parameters if the connector is buggy.

## Core runtime files
- `index.js` ? HTTP server, OpenAPI, and MCP wiring
- `mcp.js` ? tool definitions + handler logic (source of truth for MCP tools)
- `basecamp.js` ? Basecamp API wrapper w/ pagination
- `intelligent-integration.js` ? intelligent helpers (retry, parallel, routing)
- `intelligent-executor.js` ? RequestContext + core chaining
- `result-enricher.js` ? enrichment logic
- `query-parser.js` ? intent detection used by `smart_action`

## OpenAPI 30-action limit
The OpenAPI schema is capped at 30 actions. We added:
- `smart_action` ? a router that interprets natural language and calls the best tool.
Some MCP tools are intentionally NOT in OpenAPI; see coverage report.

## True MCP roadmap
See `docs/phases/TRUE_MCP_ROADMAP.md` for the full plan to eliminate false negatives and strengthen search.

## Current phase status
- Phase 3: complete
- Phase 3.5: in progress (edge-case handling + intelligent fallbacks still being hardened)
- Phase 4: not started

See: `docs/phases/PHASE_3_STATUS.md`

## Where docs live
All documentation is under `docs/`:
- `docs/DOCS_INDEX.md` ? map of all docs
- `docs/coverage/BASECAMP_API_COVERAGE.md` ? coverage status vs Basecamp API + OpenAPI
- `docs/reference/bc3-api` ? official Basecamp API docs (cloned repo)
- `docs/reference/TOOL_MATRIX.md` ? full MCP tool catalog + OpenAPI coverage
- `docs/audits/TRUE_MCP_DEEP_AUDIT.md` ? exhaustive reliability audit checklist

## How to extend safely
1) Update `mcp.js` tools list + handler
2) Add fallbacks (avoid hard errors)
3) Update OpenAPI if it needs a new action (or use `smart_action`)
4) Update `docs/coverage/BASECAMP_API_COVERAGE.md`

## Quick debugging
- Check `/health` for server
- Use `/action/startbcgpt` to verify auth
- Inspect logs for `[tool_name] Error:` lines
