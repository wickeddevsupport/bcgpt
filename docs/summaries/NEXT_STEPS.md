# Next Steps (Phase 3.5 -> Phase 4 Gate)

This is the short, actionable backlog to finish Phase 3.5 and prepare a clean Phase 4 transition.

## Must do (Phase 3.5 completion)
1) Verify official Basecamp endpoint fields for new tools (campfires, chatbots, webhooks, card steps, message types, vault children).
2) Implement client communications endpoints (correspondences/approvals/replies).
3) Run a tool-by-tool smoke check in a staging account (focus on new tools + fallback paths).
4) Roll out iteration + caching across all list endpoints (see `docs/audits/ITERATION_PAGINATION_CASE.md`). **(in progress: list tools + RequestContext updated)**
5) Annotate `docs/reference/BC3_API_COVERAGE.md` and the new updated spec with which handlers already iterate across pages/chunk payloads; call out missing iteration/caching behaviors before Phase 4. **(coverage doc updated)** 
6) Implement iteration/caching for the outstanding domains (events, lineup markers, timesheets, questionnaires, forwards/inboxes); each handler must record `pages`, `truncated`, `cache_key`, and optionally expose `next_url` so smart_action can stream the remaining data. **(implemented in mcp.js + basecamp.js)** 

## Phase 4 prep (after verification)
1) Re-rank and update the top 30 OpenAPI actions (keep `smart_action`, `basecamp_raw`, `startbcgpt`). **(openapi.json updated)** 
2) Add resiliency: circuit breaker + health metrics + structured error taxonomy. **(implemented)** 
3) Expand intelligent routing coverage and add sample prompts for typical workflows. **(examples + prompts added; ambiguity handling added to smart_action)** 
4) Standardize large-payload handling across all tools (payload cache + export + chunk retrieval). **(already wired in mcp.js; export + summary + coverage now returned)** 
5) Add regression tests for pagination, nesting, and chunk integrity. **(docs/qa/REGRESSION_TESTS.md added)** 
6) Add coverage metadata in list payloads and an internal summary pipeline for full-data project summaries. **(implemented in mcp.js)** 

## Notes
- The new MCP tools were added as best-effort endpoints; they should be validated against official Basecamp docs.
- OpenAPI updates are deferred until endpoint verification is complete.
