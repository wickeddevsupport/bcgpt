# True MCP Roadmap (Basecamp)

Last updated: 2026-02-03

This roadmap defines the path to a **true MCP server**: deterministic tool behavior, full data coverage, and reliable search semantics. It assumes the OpenAPI `/action/*` wrapper remains capped at 30 actions, while `/mcp` is the primary, standards-compliant interface.

## Target Definition (What "True MCP" Means)
1) **Authoritative tools**: every tool response is derived from actual API calls or a documented cache/index.
2) **Deterministic search**: "no results" only after all relevant sources were checked.
3) **Complete pagination**: no silent truncation; coverage is returned with each list/search.
4) **Chunk integrity**: large results are cache-backed and retrievable, not silently truncated.
5) **Client correctness**: the client must either retrieve chunks or request a focused query.

---

## Phase 0 -- Contract + Observability (Immediate)
Goal: remove ambiguity and force correct tool usage.

Actions:
1) **Enforce required queries**  
   - `list_all_people` requires `query` (empty string allowed for full list).
   - Add explicit error `MISSING_QUERY` when omitted.
2) **Expose coverage + paging metadata**  
   - Ensure all list/search responses include `_meta` + `coverage`.
3) **Log paths and fallbacks**  
   - Standardize logs for search fallbacks (people/projects/recordings/todos).

Success criteria:
- Any ambiguous search returns a structured error or a complete result set.
- Logs show exactly which endpoint(s) were used.

---

## Phase 1 -- Search Correctness (Core Fix)
Goal: remove false negatives across people/projects/recordings/todos/cards.

Actions:
1) **Unified search tool**
   - MCP `search_entities` returns people + projects + recordings + todos.
   - If project provided, add card ID lookup.
2) **People search is authoritative**
   - Directory list + deep scan across project memberships.
3) **Search fallback hierarchy**
   - API search -> project scan -> local index (if available).

Success criteria:
- "find X" returns either an authoritative match or a clearly stated "no results" with evidence.

---

## Phase 2 -- Indexing + Cards
Goal: make card search and deep queries reliable.

Actions:
1) **Extend miner index**
   - Index card tables + cards (id/title/board/column/project).
   - Index messages, documents, and uploads for global search.
2) **Card title search**
   - Search index before scanning boards.
3) **Project-level search**
   - When project is known, prioritize project-scoped search.

Success criteria:
- "find card by title" works without full board scans.

---

## Phase 3 -- Payload Reliability
Goal: eliminate chunk-related false negatives and ensure data can be fully retrieved.

Actions:
1) **Chunk retrieval guidance**
   - Document `get_cached_payload_chunk` usage clearly.
2) **Inline limits by tool**
   - Raise inline limits for search tools; enforce chunking only on very large responses.
3) **Connector-safe responses**
   - Avoid returning partial arrays without explicit `payload_key`.
4) **Idempotency for writes**
   - Support `idempotency_key` for create/update operations.
   - Cache idempotent responses server-side to prevent duplicate creates.

Success criteria:
- No "no results" after a chunked response.

---

## Phase 4 -- Client Integration (OpenAPI wrapper)
Goal: make `/action` behave safely even with weak clients.

Actions:
1) **Query-required actions**
   - Require `query` for any search-like action.
2) **Search-first routing**
   - Update descriptions to steer ChatGPT to `search_entities` or `smart_action`.
3) **Auto-deep-scan on empty**
   - If `/action` calls return empty, server-side fallbacks must run.

Success criteria:
- OpenAPI wrapper produces correct answers without manual chunking or multi-step prompts.

---

## Phase 5 -- Regression & Verification
Goal: prove correctness.

Actions:
1) **Regression suite**
   - Verify people search, project search, recording search, card search.
2) **Cross-check**
   - Compare search results against direct API lists.

Success criteria:
- No false negatives in regression tests.

---

## Notes
- `/mcp` is the authoritative interface. `/action` is best-effort compatibility.
- Any new tool must specify its fallback strategy and coverage metadata.
