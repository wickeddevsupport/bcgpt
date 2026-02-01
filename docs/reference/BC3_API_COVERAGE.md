# Basecamp 3 API coverage

| Reference section | Coverage status | Notes |
| --- | --- | --- |
| `projects.md` | ✅ | `list_projects`, `getProject`, `create/update/trashProject`, plus dock helpers for tool lookups. |
| `todos.md` / `todolists.md` / `todolist_groups.md` | ✅ | All list helpers use `apiAll`, plus `create_todo`, `update_todo_details`, `get_todo`, `complete_todo`, `uncomplete_todo`, `reposition_todo`, `list_todos_for_list`. |
| `card_tables*.md` / `card_table_cards.md` / `card_table_columns.md` / `card_table_steps.md` | ✅ | `list_card_tables`, `list_card_table_columns`, `list_card_table_cards`, `create_card`, `move_card`, step CRUD, chunked project dumps w/ payload cache. |
| `messages.md` / `message_boards.md` / `message_types.md` | ✅ | Message board listing, `create_message`, `update_message`, message type CRUD, normalized ID aliases, default status/content handling, fallback notifications. |
| `comments.md` | ✅ | `listComments`, `create_comment`, `update_comment` now use `extractContent`. |
| `campfires.md` / `chatbots.md` | ✅ | Chat lines + chatbot management coverage plus `post_chatbot_line` that can resolve integration keys via `getChatbot`. |
| `vaults.md` / `documents.md` / `uploads.md` | ✅ | `list_vaults`, new `get_vault`, docs/uploads helpers already available. |
| `schedules.md` / `schedule_entries.md` | ✅ | Schedule/list/entry helpers exist. |
| `search.md` / `reports.md` | ✅ | `searchRecordings`, `searchProject`, assignment reports, `list_assigned_to_me`. |
| `webhooks.md` | ✅ | Full CRUD. |
| `client_*` docs | ✅ | Client correspondences, approvals, replies, visibility handled. |
| `hill_charts.md`, `timeline.md`, `templates.md`, `tools.md` | ✅ | Various helpers (dock tools, hill charts, timeline markers, template constructions). |
| `attachments.md` | ✅ | `create_attachment` uploads via base64 and returns `attachable_sgid` for rich-text/recording embeds. |
| `events.md` | ✅ | `list_recording_events` exposes every event and can chunk/cache large feeds for smart actions. |
| `lineup_markers.md` | ✅ | `list_lineup_markers`, `create_lineup_marker`, `update_lineup_marker`, `delete_lineup_marker`. |
| `timesheets.md` | ✅ | `list_timesheet_report`, `list_project_timesheet`, `list_recording_timesheet` cover account, project, and recording queries. |
| `questionnaires.md` / `questions.md` | ✅ | Questionnaire + question CRUD (`get_questionnaire`, `list_questions`, pause/resume, notification updates). |
| `forwards.md` / `inboxes.md` | ✅ | `list_inboxes`, `list_inbox_forwards`, `get_inbox_forward`, `list_inbox_replies`, `get_inbox_reply`. |
| `rich_text.md`, `basecamps.md`, `vaults.md` (child sections) | ⚠️ | Partial coverage through general helpers; consider explicit tooling when needed. |

## Next actions
1. Use this doc as the single-source tracker. When new coverage is added, update the relevant row with the handler reference.
2. Build missing tools for `attachments`, `events`, `lineup markers`, `timesheets`, `questionnaires`, `forward/inbox` flows before Phase 4.
3. Cross-reference with the Phase 3 QA checklist to ensure the “⚠️” rows get priority.
