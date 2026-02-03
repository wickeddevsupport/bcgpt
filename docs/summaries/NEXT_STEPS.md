# Next Steps (True MCP Path)

This is the short, actionable backlog to finish the transition to a **true MCP server** (see `docs/phases/TRUE_MCP_ROADMAP.md`).

## Must do (Search + Correctness)
1) Enforce query requirements for all search-like tools (return `MISSING_QUERY` for missing inputs).
2) Add idempotency protections for create/update flows (idempotency keys for retries).
3) Ensure chunk integrity: never return partial arrays without `payload_key` + `chunk_count`.
4) Add card deletion and status transitions to cover full card lifecycle.

## Near-term (Index + Cards)
1) Index messages, documents, and uploads in the miner.
2) Add regression tests for search (people/projects/cards) and chunk retrieval.
3) Add coverage checks for search_recordings with `creator_id`.

## OpenAPI wrapper hardening
1) Force `query` in `/action` search tools (or return `MISSING_QUERY`).
2) Prefer `/mcp` for tool execution in new clients.
3) Document that `/action` is a compatibility wrapper.

## Notes
- The most reliable interface is `/mcp` (JSON-RPC). `/action` is best-effort compatibility.
- Use `docs/phases/TRUE_MCP_ROADMAP.md` as the canonical plan.
