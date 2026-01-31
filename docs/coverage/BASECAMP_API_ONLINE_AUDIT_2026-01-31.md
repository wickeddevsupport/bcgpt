# Basecamp API Online Coverage Audit (2026-01-31)

This audit compares our app's MCP tools and OpenAPI actions to the current Basecamp API documentation available online (Basecamp bc3-api repo + DeepWiki index pages).

## Sources (online)
- Basecamp bc3-api documentation (official repo cloned to `docs/reference/bc3-api`)
  - Task Management (todolists/todos/todosets + card tables/steps)
  - Messages and Discussions (message types + pin/unpin)
  - Webhooks
  - Chatbots
  - Real-time Chat (Campfires) + Vaults
  - Client Communications (approvals/correspondences/replies)
  - Reports, timeline, timesheets, inboxes, questions, templates, tools, events, subscriptions

## Method
1) Extracted MCP tools from `mcp.js` (180 tools).
2) Extracted OpenAPI actions from `openapi.json` (30 actions, hard limit).
3) Compared our coverage to online documentation families (not every endpoint, but every major API area).

## Current MCP tool coverage (high level)
Covered areas:
- Projects, People, Todos/Todolists/Todosets, Card Tables (including steps), Messages, Documents, Uploads, Schedule entries
- Comments, Recordings, Search (+ metadata), Vault (basic + child vaults), Hill chart (MCP only)
- Client communications, inboxes/forwards/replies, questionnaires/questions/answers/reminders
- Reports, timeline, timesheets, subscriptions, events, client visibility
- Dock tools, templates, lineup markers, webhooks, chatbots, campfires
- Smart routing: `smart_action`
- Escape hatch: `basecamp_raw`

## OpenAPI coverage (30 actions)
OpenAPI exposes 30 actions, with `smart_action` included to cover additional intent-driven workflows.

## Online API families status
Based on official docs, the major API families are now covered by MCP tools (see notes for verification).

## Conclusion
We cover core daily workflows and the online API families. Remaining work is verification of endpoint details and payload fields against the official docs, plus real-world smoke testing.

## Recommended next additions (priority order)
1) Verify endpoint field requirements and edge behaviors for all new families
2) Re-rank the OpenAPI 30-actions after stability verification

## Notes
- This audit focuses on API families confirmed by online docs; it does not assert coverage for features that appear only in product help pages.
- The new tool endpoints are best-effort based on official docs; they should be validated against the cloned repo (`docs/reference/bc3-api`).
