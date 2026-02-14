# BCGPT API Specification (Phase 3.5 iteration)

This document captures the next evolution of the MCP toolset: it must behave as a single master that can iterate through every Basecamp endpoint, cache partial outputs, assemble convincing JSON replies for ChatGPT, and never stop short of a complete data set when the user asks for a summary or an export.

## 1. Purpose
1. Deliver **true, full data** (projects, card tables, todo-lists, uploads, recordings, etc.) even when the Basecamp API paginates, chunks, or flags large payloads. No silent "page 1 only" results.
2. Let ChatGPT think in natural language while the MCP server handles iteration, caching, chunk assembly, and fallback retries.
3. Provide `smart_action`, `list_*`, and `basecamp_raw` as fail-safe access points, with consistent headers, error taxonomy, and structured summaries.

## 2. Principle: iteration + chunking + caching
| Concern | Requirement |
| --- | --- |
| Pagination and large payloads | Every `list` endpoint must call `ctx.basecampFetchAll` (or equivalent) until `next_url` is exhausted; chunk results into digestible batches when downstream (ChatGPT) requests a "full dump." | 
| Caching | Store fetched pages in durable cache (in-memory or DB). When a user asks for a summary, first consult cache before hitting Basecamp again; refresh on demand (timestamp + TTL). |
| Smart responses | Responses to ChatGPT should embed `metadata: {source: <endpoint>, pages: N, truncated: false}` and optional DTO of iteration state if more data is incoming. |

## 3. Updated operation map (drawn from `BC3_API_COVERAGE.md`)
The future spec must explicitly include, at minimum, the following operations (all of which should already be routed by `mcp.js` but now documented):

1. Project tooling: `list_projects`, `find_project`, `create/update/trashProject`, plus `what_tools` (dock lookups).
2. Todos: `list_todos_for_project`, `create_todo`, `update_todo_details`, `complete_todo`, `uncomplete_todo`, `reposition_todo`, `list_todos_due`, `list_todos_for_list`, `daily_report`, `search_todos`, `assignment_report`.
3. Card tables: `list_card_tables`, `list_card_table_columns`, `list_card_table_cards`, `create_card`, `move_card`, steps CRUD, chunked board dumps, caching across columns.
4. Messages + comments: `list_message_boards`, `list_messages`, `create_message`, `update_message`, `list_comments`, `create_comment`, `update_comment`, normalized `message_types`.
5. Recordings + events: `get_recordings`, `search_recordings`, `trash_recording`, `list_recording_events`, chunked caching.
6. Vaults and attachments: `list_vaults`, `get_vault`, `list_documents`, `list_uploads`, `create_attachment`, upload helpers returning `attachable_sgid`.
7. Search + reporting: `search_project`, `list_assigned_to_me`, reports/trending, `search_recordings`.
8. Scheduling + timesheets: `list_schedules`, `list_schedule_entries`, `list_timesheet_report`, `list_project_timesheet`, `list_recording_timesheet`.
9. Notifications + inbox: `list_inboxes`, `list_inbox_forwards`, `list_inbox_replies`, `get_inbox_forward`, `get_inbox_reply`.
10. Auxiliary tools: `list_campfires`, `list_chatbots`, `post_chatbot_line`, `list_lineup_markers`, `create_lineup_marker`, `list_questionnaires`, `list_questions`, `pause_questionnaire`, `resume_questionnaire`, `list_webhooks`, full CRUD.
11. Low-level `basecamp_raw` for any missing endpoint.

## 4. Smart chaining expectations
- **Smart action choreography**: `smart_action` must build a context, queue the necessary endpoint calls (with iteration), and merge partial outputs. If the result is > a single response, stream the additional chunk with indexes.
- **Summary commands** (e.g., "summarize Sales project") must: 1) list card tables, 2) fetch columns, 3) iterate through every column’s cards, 4) join attachments/linked todos, 5) produce a JSON summary. No missing cards.
- **Automated loops**: For each `list_*` command, add a `max_pages` guard and an `iterator` component that stores the next URL, stops on empty responses, and logs `lastFetchedPage` for retries.

## 5. Error taxonomy and instrumentation
- Track `BASECAMP_API_ERROR`, `RESPONSE_TOO_LARGE`, `NOT_AUTHENTICATED`, `NO_MATCH`, `CHUNK_INCOMPLETE`. Each tool response should surface the same code so ChatGPT can reason about recovery steps.
- Error payloads must include: `code`, `message`, `category`, `retryable`, and optional `action` (e.g., `reauth`, `chunk`, `retry_later`), plus `status` when available.
- Recommended categories: `auth`, `config`, `api`, `network`, `payload`, `feature`, `data`, `input`, `resilience`, `internal`.
- Log telemetry per tool with `page`, `entries`, `requestId`, `duration`, and `cacheHit` for throttling.

## 6. Next steps to fully lock the spec (Phase 3.5 → 4 gate)
1. Audit `docs/reference/BASECAMP_API_ENDPOINTS_REFERENCE.md` and update every row with the MCP handler plus iteration guarantee. Treat this doc as the single source of truth; when a handler is implemented, add columns for `iterates`/`chunked`/`cached`.
2. Add regression tests (unit or integration) validating that each `list_*` endpoint can consume multi-page responses and deliver aggregated results (see `docs/audits/ITERATION_PAGINATION_CASE.md`).
3. Update the OpenAPI spec to reflect the full operation set above (phase 4 task) and use the new `smart_action` metadata responses.
4. Continue capturing progress in `docs/summaries/NEXT_STEPS.md` (Phase 3.5 completion items) and expand the spec with Phase 4 requirements (resiliency, chunk handling, intelligent routing).

## 7. References
- `docs/summaries/NEXT_STEPS.md` (current backlog and phase transition plan).
- `docs/reference/BC3_API_COVERAGE.md` (endpoint coverage tracker).
- `docs/reference/BASECAMP_API_ENDPOINTS_REFERENCE.md` (official Basecamp docs for validation).
