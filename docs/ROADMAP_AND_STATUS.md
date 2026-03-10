# Roadmap And Status

**Last Updated:** 2026-03-10

## Snapshot

| Area | Status | Notes |
|---|---|---|
| PMOS as primary surface | SHIPPED | active production UI |
| Flow / Activepieces workflow runtime | SHIPPED | embedded from PMOS |
| Basecamp live chat + project data | SHIPPED | deterministic output guards + forced tool routing |
| FM MCP in PMOS chat | SHIPPED | file-manager tasks now available in workspace chat |
| Figma PAT-backed audits | SHIPPED | reliable fallback path |
| Official Figma MCP in production | PARTIAL | still auth/OAuth-sensitive |
| Live chat timeline / tool stream UX | SHIPPED | production UI path exists |
| Chat output determinism | SHIPPED | 4-layer output guards ensure tool success always produces visible output |
| Chat panel state recovery | SHIPPED | 120s recovery polling with auto-clear of stuck state |
| Project operating views | SHIPPED | Cards + Status Board + Timeline views in command center |
| Workflow monitoring dashboard | SHIPPED | flow names, success rate, failure callouts in dashboard |
| Basecamp prompt discipline | SHIPPED | forced tool routing for project queries, memory-only recall blocked |
| Durable workspace memory | SHIPPED WITH TUNING NEEDED | storage path is durable; retrieval quality still evolving |
| Memory orchestration layer | SHIPPED | local Ollama-backed rerank/summarize |
| Docs cleanup / source-of-truth docs | DONE | canonical top-level set refreshed |

## What Is Shipped

- PMOS owns workspace auth, workspace config, agent runtime, and embedded app entry points.
- Flow is the active automation engine.
- BCGPT is the Basecamp integration surface for live project/todo/report access.
- FM MCP is wired through workspace connector sync and usable in PMOS chat.
- Figma PAT handoff + REST audit path is live from workspace connector state.
- Chat panels now show live tool/timeline output instead of only final response dumps.
- Deterministic output guards ensure every tool success produces a user-visible answer across all 4 output layers (agent loop, PMOS handler, chat broadcast, non-PMOS path).
- Chat panel state recovers after hard refresh via 120s recovery polling with graceful auto-clear.
- Project command center has 3 view modes: Cards, Status Board (Kanban by health), and Timeline (chronological todos).
- Workflow dashboard shows flow names, success rate percentage, failure callouts, and 8 recent runs.
- Basecamp prompt discipline forces live tool calls for project/todo/overdue/blocker/deadline/team queries.
- Workspace compaction defaults are less aggressive than the earlier configuration.
- Durable session extraction writes memory notes into workspace-scoped storage.

## What Is Still Partial

- Official Figma MCP is not the dependable default; PAT-backed REST audit is the reliable production path today.
- Full regression coverage for all major chat/integration flows is not yet enforced in CI.
- Memory retrieval/ranking quality needs tuning within the current Ollama setup.
- 17 pre-existing UI test failures in unrelated files (automations, format, navigation) need cleanup.

## Current Priorities

### P0

- Add CI smoke gate so nothing ships without automated verification.
- Add Playwright regression tests for Basecamp, FM/Figma, and workflow chat prompts.

### P1

- Harden Figma routing so FM MCP vs official Figma access is always chosen correctly.
- Improve durable memory extraction quality and retrieval scoring.
- Add multi-user isolation smoke coverage.

### P2

- Structured design audit reports (components, styles, variables, fonts, auto-layout).
- Workspace knowledge graphs (entity relationships, project graphs).
- Remove remaining stale `n8n` naming from active runtime paths.
- Fix pre-existing UI test failures.

## Definition Of Done For This Phase

This phase is done only when all are true:

- Basecamp, FM, Figma audit, and workflow prompts return clean user-visible answers from live tools.
- A successful tool run cannot silently end without a final user-visible answer. **DONE**
- Chat panels survive refresh/reconnect without misleading idle status. **DONE**
- Durable memory survives deploy/restart and remains workspace/agent isolated.
- CI gate enforces smoke tests before deploy.
