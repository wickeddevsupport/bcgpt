# Basecamp 3 API coverage

| Reference section | Coverage status | Notes |
| --- | --- | --- |
| projects.md | OK | list_projects, getProject, create/update/trashProject, plus dock helpers for tool lookups. |
| todos.md / todolists.md / todolist_groups.md | OK | All list helpers use apiAll, plus create_todo, update_todo_details, get_todo, complete_todo, uncomplete_todo, reposition_todo, list_todos_for_list. |
| card_tables*.md / card_table_cards.md / card_table_columns.md / card_table_steps.md | OK | list_card_tables, list_card_table_columns, list_card_table_cards, create_card, move_card, step CRUD, chunked project dumps w/ payload cache. |
| messages.md / message_boards.md / message_types.md | OK | Message board listing, create_message, update_message, message type CRUD, normalized ID aliases, default status/content handling, fallback notifications. |
| comments.md | OK | listComments, create_comment, update_comment now use extractContent. |
| campfires.md / chatbots.md | OK | Chat lines + chatbot management coverage plus post_chatbot_line that can resolve integration keys via getChatbot. |
| vaults.md / documents.md / uploads.md | OK | list_vaults, get_vault, docs/uploads helpers already available. |
| schedules.md / schedule_entries.md | OK | Schedule/list/entry helpers exist. |
| search.md / reports.md | OK | searchRecordings, searchProject, assignment reports, list_assigned_to_me. |
| webhooks.md | OK | Full CRUD. |
| client_* docs | OK | Client correspondences, approvals, replies, visibility handled. |
| hill_charts.md, timeline.md, templates.md, tools.md | OK | Various helpers (dock tools, hill charts, timeline markers, template constructions). |
| attachments.md | OK | create_attachment uploads via base64 and returns attachable_sgid for rich-text/recording embeds. |
| events.md | OK | list_recording_events now paginates, caches, and returns iteration metadata (pages, truncated, next_url, cache_key). |
| lineup_markers.md | OK | list_lineup_markers now paginates and returns iteration metadata; create/update/delete remain supported. |
| timesheets.md | OK | list_timesheet_report, list_project_timesheet, list_recording_timesheet now paginate and return iteration metadata. |
| questionnaires.md / questions.md | OK | list_questions + list_question_answers now paginate and return iteration metadata for smart summaries. |
| forwards.md / inboxes.md | OK | list_inboxes, list_inbox_forwards, list_inbox_replies now paginate with iteration metadata. |
| rich_text.md, basecamps.md, vaults.md (child sections) | PARTIAL | Partial coverage through general helpers; consider explicit tooling when needed. |

## Iteration / caching priority

Phase 3.5 iteration/caching upgrades are now implemented for events, lineup markers, timesheets, questionnaires, and forwards/inboxes. Remaining work is the rich_text/basecamps/vault child sections, which still route through general helpers or basecamp_raw.

## Next actions
1. Use this doc as the single-source tracker. When new coverage is added, update the relevant row with the handler reference.
2. Keep the rich_text/basecamps/vault child sections on the Phase 4 checklist for explicit tooling if usage grows.
3. Cross-reference with the Phase 3 QA checklist to ensure remaining PARTIAL rows get priority.
