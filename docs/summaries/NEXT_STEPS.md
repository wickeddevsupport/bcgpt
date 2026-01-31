# Next Steps (Phase 3.5 -> Phase 4 Gate)

This is the short, actionable backlog to finish Phase 3.5 and prepare a clean Phase 4 transition.

## Must do (Phase 3.5 completion)
1) Verify official Basecamp endpoint fields for new tools (campfires, chatbots, webhooks, card steps, message types, vault children).
2) Implement client communications endpoints (correspondences/approvals/replies).
3) Run a tool-by-tool smoke check in a staging account (focus on new tools + fallback paths).

## Phase 4 prep (after verification)
1) Re-rank and update the top 30 OpenAPI actions (keep `smart_action`, `basecamp_raw`, `startbcgpt`).
2) Add resiliency: circuit breaker + health metrics + structured error taxonomy.
3) Expand intelligent routing coverage and add sample prompts for typical workflows.

## Notes
- The new MCP tools were added as best-effort endpoints; they should be validated against official Basecamp docs.
- OpenAPI updates are deferred until endpoint verification is complete.
