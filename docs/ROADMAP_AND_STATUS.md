# Roadmap And Status

**Last Updated:** 2026-03-10

## Snapshot

| Area | Status | Notes |
|---|---|---|
| PMOS as primary surface | SHIPPED | active production UI |
| Flow / Activepieces workflow runtime | SHIPPED | embedded from PMOS |
| Basecamp live chat + project data | SHIPPED WITH TUNING NEEDED | BCGPT path works, prompt/tool discipline still matters |
| FM MCP in PMOS chat | SHIPPED | file-manager tasks now available in workspace chat |
| Figma PAT-backed audits | SHIPPED | reliable fallback path |
| Official Figma MCP in production | PARTIAL | still auth/OAuth-sensitive |
| Live chat timeline / tool stream UX | SHIPPED | production UI path exists |
| Durable workspace memory | SHIPPED WITH TUNING NEEDED | storage path is durable; retrieval quality still evolving |
| Memory orchestration layer | SHIPPED | local Ollama-backed rerank/summarize |
| Docs cleanup / source-of-truth docs | IN PROGRESS | this refresh |

## What Is Shipped

- PMOS owns workspace auth, workspace config, agent runtime, and embedded app entry points.
- Flow is the active automation engine.
- BCGPT is the Basecamp integration surface for live project/todo/report access.
- FM MCP is wired through workspace connector sync and usable in PMOS chat.
- Figma PAT handoff + REST audit path is live from workspace connector state.
- Chat panels now show live tool/timeline output instead of only final response dumps.
- Workspace compaction defaults are less aggressive than the earlier configuration.
- Durable session extraction writes memory notes into workspace-scoped storage.

## What Is Still Partial

- Official Figma MCP is not the dependable default; PAT-backed REST audit is the reliable production path today.
- Some prompt/routing behavior is still model-sensitive and needs more deterministic guardrails.
- Full regression coverage for all major chat/integration flows is not yet enforced in CI.
- Some top-level docs were stale until this cleanup and still need long-tail reference curation.

## Current Priorities

### P0

- Make chat output deterministic whenever a tool run succeeded.
- Reduce remaining false "offline" / "not configured" assistant language.
- Keep Basecamp answers grounded in live BCGPT data, not memory-only recall.

### P1

- Harden Figma routing so FM MCP vs official Figma access is always chosen correctly.
- Add stronger chat run-state recovery after refresh/reconnect for every panel.
- Add production smoke coverage for FM/Figma/Basecamp/workflow chat prompts.

### P2

- Improve durable memory extraction quality and retrieval scoring.
- Add CI smoke for multi-user workspace isolation and chat/integration flows.
- Continue removing stale `n8n` naming from active runtime code and docs.

## Definition Of Done For This Phase

This phase is done only when all are true:

- Basecamp, FM, Figma audit, and workflow prompts return clean user-visible answers from live tools.
- A successful tool run cannot silently end without a final user-visible answer.
- Chat panels survive refresh/reconnect without misleading idle status.
- Durable memory survives deploy/restart and remains workspace/agent isolated.
- Top-level docs match the actual repo/runtime and archive the old material clearly.
