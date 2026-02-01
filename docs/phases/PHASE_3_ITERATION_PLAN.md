# Phase 3 Iteration & Pagination Plan

## Why this exists
Large Basecamp projects (multiple card tables, long to-do lists, heavy message boards) regularly exceed single-response limits. When we only read page 1 or request too much at once, the server returns partial data or ResponseTooLarge. That leads to incorrect summaries and broken UX.

## Design goals
- **Zero missing data by default** for all list endpoints.
- **Safe chunking** for huge payloads (card tables, cards, comments, etc.).
- **Natural-language friendly** inputs (content/subject/body aliases) without silent failures.
- **Smart actions** should iterate internally and return complete data or a cached export without asking users to re-issue requests.

## Current changes (this phase)
- Added internal helpers for argument normalization and content extraction.
- Added pagination-first behaviors for list endpoints (via `apiAll`).
- Added payload caching + chunk retrieval (`payload_key`, `get_cached_payload_chunk`, `export_cached_payload`).
- Added missing endpoints for todos and vaults.
- Fixed mismatched parameter names across tools/handlers (message boards, message types, chatbots, comments).
- Added natural-language-friendly aliases for message/comment/chat payloads.

## Required behavior (the standard)
When a user asks for summaries or "everything," the server must:
1. **Iterate** over all pages/endpoints internally.
2. **Chunk** data into safe response sizes.
3. **Return**:
   - `payload_key` + `chunk_count` + `first_chunk` when the payload is large, and/or
   - an export file path for large JSON dumps.
4. **Never** return "empty" or "only first board/list" unless the project actually has no data.

## Next steps to complete phase 3
1. **Audit all list endpoints**
   - Ensure every list tool uses `apiAll` or list URLs (no single-page reads).
   - Add caching/chunking to any endpoint that can exceed the inline limit.

2. **Unify parameter names across tools + handlers**
   - Map common aliases (e.g., `board_id` vs `message_board_id`, `message_type_id` vs `category_id`, `chatbot_id` vs `integration_id`).
   - Ensure content fields can be passed as `content`, `message`, `text`, or `body`.

3. **Strengthen smart_action**
   - When the request implies "all data" (summary, everything, full dump), use internal iterators.
   - Always return `payload_key` if any chunking was used.

4. **QA matrix (minimum)**
   - Todos: list, get, create, update, complete, uncomplete, reposition
   - Card tables: list tables, list columns, list cards (single + all tables)
   - Messages: list boards, create message, update message
   - Comments: list, create, update
   - Campfire: list lines, create line, chatbot lines
   - Vaults: list + get

5. **Project summary path**
   - Project summary should aggregate *all* tools (todos + cards + messages + docs + schedule + uploads) using iterators and chunking.

## Phase 3 QA checklist
- **Todos** — list, get, create, update, complete, uncomplete, reposition; ensure pagination results are complete and payload key generated when large, then verify summary uses the iterators.
- **Card tables** — list tables/columns/cards (single board + full project dump) and confirm cached exports + chunk navigation work without ResponseTooLarge.
- **Messages & comments** — list boards, create/update messages with subject/content aliases, list/create/update comments via `extractContent`.
- **Campfire & chatbots** — list campfire lines, create lines with plain text, create/update/delete chatbots, post chatbot lines using integration key fallback.
- **Vaults** — list/get vault metadata + any linked uploads/docs to confirm the new `get_vault` handler works.
- **Smart actions** — ask for “summarize project”, “show every card”, “show every todo” and verify the server iterates internally and returns cached exports instead of partial answers.
- **API docs sync** — after the QA sweep, update `docs/reference/bc3-api` sections or OpenAPI specs to match any newly surfaced endpoints/responses.

## Acceptance criteria for Phase 3
- A single user request for "summarize project" returns complete data (or cached export + chunk pointers) **without** user follow-up.
- No tool silently truncates data.
- All write operations (comments/messages/todos/cards) accept natural language inputs reliably.

---
Owner: MCP Core
Status: In progress

