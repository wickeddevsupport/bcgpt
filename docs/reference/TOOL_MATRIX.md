# Tool Matrix (MCP + OpenAPI)

Last updated: 2026-02-03

This document maps MCP tools to Basecamp capabilities, highlights OpenAPI coverage, and shows gaps that still need to be filled for a true MCP server. `/mcp` is the authoritative interface; `/action` is a compatibility wrapper limited to 30 actions.

## Coverage Matrix by Entity
| Entity | List | Search | Get | Create | Update/Move | Delete/Archive | Comment | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| People | `list_all_people`, `list_project_people`, `list_pingable_people` | `search_people`, `search_entities` | `get_person`, `get_my_profile` | missing | `update_project_people` | missing | n/a | People search must be authoritative and include deep scan. |
| Projects | `list_projects` | `find_project`, `search_projects`, `search_entities` | `get_project`, `get_project_structure` | `create_project`, `create_project_construction` | `update_project`, `update_project_people` | `trash_project` | n/a | Project search should fall back to archived scan when active scan is empty. |
| Todos | `list_todos_for_project`, `list_todos_for_list`, `list_todos_due` | `search_todos`, `search_entities` | `get_todo`, `get_todolist`, `get_todoset` | `create_todo`, `create_todolist`, `create_todolist_group` | `update_todo_details`, `reposition_todo`, `complete_todo`, `uncomplete_todo` | `trash_recording` (generic) | `list_comments`, `create_comment`, `get_comment`, `update_comment` | Assignment helpers: `assignment_report`, `get_person_assignments`, `list_assigned_to_me`. |
| Cards | `list_card_tables`, `list_card_table_cards`, `list_project_card_table_contents` | `search_cards`, `search_entities` | `get_card` | `create_card` | `update_card`, `move_card`, card steps tools | missing | `create_comment` (via card -> recording) | Card search requires project unless index already contains cards. |
| Messages | `list_message_boards`, `list_messages`, `list_message_types` | `search_recordings`, `search_project`, `search_entities` | `get_message`, `get_message_board`, `get_message_type` | `create_message`, `create_message_type` | `update_message`, `update_message_type` | `trash_recording`, `delete_message_type` | `list_comments`, `create_comment` | Recording-level tools apply (pin, subscribe, archive). |
| Documents | `list_documents`, `list_vaults`, `list_child_vaults` | `search_recordings`, `search_project` | `get_document`, `get_vault` | `create_document`, `create_child_vault` | `update_document`, `update_vault` | `trash_recording` | `list_comments`, `create_comment` | Uploads are separate tools. |
| Uploads | `list_uploads` | `search_recordings`, `search_project` | `get_upload` | `create_upload`, `create_attachment` | `update_upload` | `trash_recording` | `list_comments`, `create_comment` | Upload is multi-step. |
| Schedule | `list_schedule_entries` | `report_schedules_upcoming` | `get_schedule`, `get_schedule_entry` | `create_schedule_entry` | `update_schedule`, `update_schedule_entry` | missing | n/a | Schedule tools depend on dock availability. |
| Campfire | `list_campfires`, `list_campfire_lines` | missing | `get_campfire`, `get_campfire_line` | `create_campfire_line`, `post_chatbot_line` | missing | `delete_campfire_line` | n/a | Chatbots are managed separately. |
| Activity | `user_timeline`, `project_timeline`, `report_timeline` | n/a | n/a | n/a | n/a | n/a | n/a | `list_person_activity` wraps timeline for person-centric views. |
| Reports | `report_todos_overdue`, `report_todos_assigned`, `report_timeline`, `report_timesheet` | missing | n/a | n/a | n/a | n/a | n/a | Reports are API-backed, not UI reports URLs. |
| Templates | `list_templates` | missing | `get_template` | `create_template` | `update_template` | `trash_template` | n/a | Project construction uses templates. |
| Questionnaires | `list_questions`, `list_question_answers`, `list_question_reminders` | missing | `get_questionnaire`, `get_question`, `get_question_answer` | `create_question`, `create_question_answer` | `update_question`, `update_question_answer`, `pause_question`, `resume_question` | missing | n/a | Only supported where questionnaires are enabled. |
| Dock Tools | n/a | n/a | `get_dock_tool` | `create_dock_tool` | `update_dock_tool`, `move_dock_tool`, `enable_dock_tool` | `disable_dock_tool`, `trash_dock_tool` | n/a | Dock tools determine which features are enabled. |
| Webhooks | `list_webhooks` | missing | `get_webhook` | `create_webhook` | `update_webhook` | `delete_webhook` | n/a | Webhooks are account scoped. |
| Subscriptions | n/a | n/a | `get_subscription` | `subscribe_recording` | `update_subscription` | `unsubscribe_recording` | n/a | Subscriptions apply to recordings. |
| Lineup | `list_lineup_markers` | missing | n/a | `create_lineup_marker` | `update_lineup_marker` | `delete_lineup_marker` | n/a | Lineup markers are account-wide. |
| Raw API | n/a | n/a | n/a | n/a | n/a | n/a | n/a | `basecamp_request` is the escape hatch. |


## OpenAPI Coverage (30 actions)
- `basecamp_raw`
- `complete_todo`
- `create_card`
- `create_comment`
- `create_message`
- `create_todo`
- `export_cached_payload`
- `find_project`
- `get_cached_payload_chunk`
- `list_all_people`
- `list_card_table_cards`
- `list_card_tables`
- `list_comments`
- `list_documents`
- `list_message_boards`
- `list_messages`
- `list_project_card_table_contents`
- `list_projects`
- `list_schedule_entries`
- `list_todos_due`
- `list_todos_for_project`
- `list_uploads`
- `move_card`
- `search_project`
- `search_recordings`
- `search_todos`
- `smart_action`
- `startbcgpt`
- `uncomplete_todo`
- `update_todo_details`

## Tool Catalog (MCP)
| Tool | Purpose | OpenAPI |
| --- | --- | --- |
| `archive_recording` | Archive a recording. | no |
| `assignment_report` | Group open todos by assignee within a project (optimized). | no |
| `basecamp_raw` | Alias of basecamp_request for backward compatibility. | yes |
| `basecamp_request` | Raw Basecamp API call. Provide full URL or a /path. | no |
| `complete_card_step` | Mark a card step completed. | no |
| `complete_task_by_name` | Complete a todo in a project by fuzzy-matching its content. | no |
| `complete_todo` | Mark a to-do as complete. | yes |
| `create_attachment` | Create an attachment (binary) from base64. Provide name, content_type, content_base64. | no |
| `create_campfire_line` | Create a chat line. Provide official fields in body (content, etc). | no |
| `create_card` | Create a card in a card table. | yes |
| `create_card_step` | Create a step on a card. Provide official fields in body. | no |
| `create_card_table_column` | Create a card table column. Provide official fields in body. | no |
| `create_card_table_on_hold` | Create on-hold section for a column. | no |
| `create_chatbot` | Create a chatbot (integration). Provide official fields in body. | no |
| `create_child_vault` | Create a child vault within a vault. Provide official fields in body. | no |
| `create_comment` | Create a comment on a recording. | yes |
| `create_dock_tool` | Create a dock tool by cloning. Provide official fields in body. | no |
| `create_document` | Create a document in a vault. Provide official fields in body. | no |
| `create_lineup_marker` | Create a lineup marker. Provide official fields in body. | no |
| `create_message` | Create a message. Provide official fields in body. | yes |
| `create_message_type` | Create a message type (category). Provide fields in body. | no |
| `create_project` | Create a project. Provide official fields in body. | no |
| `create_project_construction` | Create a project from a template. Provide official fields in body. | no |
| `create_question` | Create a question under a questionnaire. | no |
| `create_question_answer` | Create an answer to a question. Provide official fields in body. | no |
| `create_schedule_entry` | Create a schedule entry. Provide official fields in body. | no |
| `create_template` | Create a template. Provide official fields in body. | no |
| `create_todo` | Create a to-do in a project; optionally specify todolist, due date, and assignees. | yes |
| `create_todolist` | Create a todolist. Provide official fields in body. | no |
| `create_todolist_group` | Create a todolist group. Provide official fields in body. | no |
| `create_upload` | Create an upload in a vault. Provide official fields in body. | no |
| `create_webhook` | Create a webhook. Provide official fields in body. | no |
| `daily_report` | Across projects: totals + per-project breakdown + due today + overdue (open only). | no |
| `delete_campfire_line` | Delete a chat line. | no |
| `delete_card_table_on_hold` | Delete on-hold section for a column. | no |
| `delete_chatbot` | Delete a chatbot. | no |
| `delete_lineup_marker` | Delete a lineup marker. | no |
| `delete_message_type` | Delete a message type (category). | no |
| `delete_webhook` | Delete a webhook. | no |
| `disable_dock_tool` | Disable a tool by recording ID. | no |
| `enable_dock_tool` | Enable a tool by recording ID. Provide official fields in body. | no |
| `export_cached_payload` | Export a cached payload to a JSON file and return the file path. | yes |
| `find_project` | Resolve a project by name (fuzzy). | yes |
| `get_cached_payload_chunk` | Retrieve a chunk from the large payload cache. | yes |
| `get_campfire` | Get a campfire (chat) by ID or from project dock. | no |
| `get_campfire_line` | Get a specific chat line. | no |
| `get_card` | Get a card by ID. | no |
| `get_card_table` | Get a card table by ID. | no |
| `get_card_table_column` | Get a card table column by ID. | no |
| `get_chatbot` | Get a chatbot by integration id. | no |
| `get_client_approval` | Get a client approval by ID. | no |
| `get_client_correspondence` | Get a client correspondence by ID. | no |
| `get_client_reply` | Get a specific client reply by recording + reply ID. | no |
| `get_comment` | Get a specific comment by ID. | no |
| `get_dock_tool` | Get a dock tool by ID. | no |
| `get_document` | Get a document by ID. | no |
| `get_hill_chart` | Fetch the hill chart for a project (if enabled). | no |
| `get_inbox` | Get an inbox by ID. | no |
| `get_inbox_forward` | Get a forward by ID. | no |
| `get_inbox_reply` | Get an inbox reply by ID. | no |
| `get_message` | Get a message by ID. | no |
| `get_message_board` | Get a message board by ID. | no |
| `get_message_type` | Get a message type (category) by ID. | no |
| `get_my_profile` | Get current authenticated user's profile. | no |
| `get_person` | Get profile of a specific person by ID. | no |
| `get_person_assignments` | List todos assigned to a specific person within a project. | no |
| `get_project` | Get project by ID. | no |
| `get_project_construction` | Get a project construction by ID. | no |
| `get_project_structure` | Inspect a project's dock and available API endpoints (for diagnostics). | no |
| `get_question` | Get a question by ID. | no |
| `get_question_answer` | Get a question answer by ID. | no |
| `get_questionnaire` | Get a questionnaire by ID. | no |
| `get_recordings` | Query all recordings across projects by type (Todo, Message, Document, Upload, etc). | no |
| `get_schedule` | Get a schedule by ID. | no |
| `get_schedule_entry` | Get a schedule entry by ID. | no |
| `get_subscription` | Get subscription info for a recording. | no |
| `get_template` | Get a template by ID. | no |
| `get_todo` | Get a to-do by ID. | no |
| `get_todolist` | Get a todolist by ID. | no |
| `get_todolist_group` | Get a todolist group by ID. | no |
| `get_todoset` | Get a todoset by ID. | no |
| `get_upload` | Get details of a specific file/upload. | no |
| `get_vault` | Get a vault by ID. | no |
| `get_webhook` | Get a webhook by ID. | no |
| `list_accounts` | List Basecamp accounts available to the authenticated user. | no |
| `list_all_people` | List all people visible in the Basecamp account. | yes |
| `list_assigned_to_me` | List todos assigned to the current user (optionally within a project). | no |
| `list_campfire_lines` | List chat lines in a campfire. | no |
| `list_campfires` | List campfires (chats). If project omitted, lists all visible chats. | no |
| `list_card_steps` | List steps (checklist) for a card. | no |
| `list_card_table_cards` | List cards for a card table. | yes |
| `list_card_table_columns` | List columns for a card table. | no |
| `list_card_table_summaries` | List card table summaries for a project, optionally including card titles. | no |
| `list_card_table_summaries_iter` | Iterate card table summaries one board per call. | no |
| `list_card_tables` | List card tables (kanban boards) for a project. | yes |
| `list_chatbots` | List chatbots (integrations) for a campfire. | no |
| `list_child_vaults` | List child vaults within a vault. | no |
| `list_client_approvals` | List client approvals for a project. | no |
| `list_client_correspondences` | List client correspondences for a project. | no |
| `list_client_replies` | List client replies for a correspondence/approval recording. | no |
| `list_comments` | List comments on a recording (message, document, todo, etc). | yes |
| `list_documents` | List documents/files in the project vault. | yes |
| `list_inbox_forwards` | List forwards in an inbox. | no |
| `list_inbox_replies` | List replies for an inbox forward. | no |
| `list_inboxes` | List inboxes for a project. | no |
| `list_lineup_markers` | List all lineup markers. | no |
| `list_message_boards` | List message boards for a project. | yes |
| `list_message_types` | List message types (categories) for a project. | no |
| `list_messages` | List messages in a message board. If message_board_id omitted, uses the first board. | yes |
| `list_person_activity` | List recent activity for a person (timeline-based). | no |
| `list_person_projects` | List projects a person belongs to (by name, email, or ID). | no |
| `list_pingable_people` | List people who can be pinged. | no |
| `list_project_card_table_contents` | List card table contents for a project, chunked by boards. | yes |
| `list_project_people` | List all people on a project. | no |
| `list_project_timesheet` | List timesheet entries for a project. | no |
| `list_projects` | List projects (supports archived). | yes |
| `list_question_answers` | List answers for a question. | no |
| `list_question_answers_by` | List people who answered a question. | no |
| `list_question_answers_by_person` | List answers by person for a question. | no |
| `list_question_reminders` | List pending question reminders for the current user. | no |
| `list_questions` | List questions under a questionnaire. | no |
| `list_recording_events` | List events for a recording. | no |
| `list_recording_timesheet` | List timesheet entries for a recording. | no |
| `list_schedule_entries` | List schedule entries for a project (date range optional). | yes |
| `list_templates` | List templates. | no |
| `list_timesheet_report` | List timesheet entries account-wide (optionally filtered). | no |
| `list_todolist_groups` | List groups in a todolist. | no |
| `list_todos_due` | Across projects: list open todos due on date; optionally include overdue. | yes |
| `list_todos_for_list` | List to-dos in a specific todolist. | no |
| `list_todos_for_project` | List todolists + todos for a project by name. | yes |
| `list_uploads` | List files/uploads in a project vault. | yes |
| `list_vaults` | List document storage vaults for a project. | no |
| `list_webhooks` | List webhooks for a project. | no |
| `move_card` | Move/update a card (column/position). | yes |
| `move_card_table_column` | Move a card table column. Provide official fields in body. | no |
| `move_dock_tool` | Move a tool by recording ID. Provide official fields in body. | no |
| `pause_question` | Pause a question. | no |
| `pin_recording` | Pin a message or other recording. | no |
| `post_chatbot_line` | Post a chat line as a chatbot using integration key. Provide body if needed. | no |
| `project_timeline` | Timeline events for a project. Optional query string. | no |
| `project_timesheet` | Timesheet entries for a project. Optional query string. | no |
| `recording_timesheet` | Timesheet entries for a recording. Optional query string. | no |
| `report_schedules_upcoming` | List upcoming schedule entries (report). Optional query string. | no |
| `report_timeline` | Timeline events across all projects. Optional query string. | no |
| `report_timesheet` | Timesheet entries across the account. Optional query string. | no |
| `report_todos_assigned` | List people who can have todos assigned. | no |
| `report_todos_assigned_person` | List todos assigned to a person (report). | no |
| `report_todos_overdue` | List overdue todos across all projects. | no |
| `reposition_card_step` | Reposition a card step within its card. | no |
| `reposition_todo` | Move/reposition a to-do within its list. | no |
| `reposition_todolist_group` | Reposition a todolist group. | no |
| `resolve_entity_from_url` | Resolve a Basecamp UI/API URL into a structured entity reference. | no |
| `resume_question` | Resume a paused question. | no |
| `search_cards` | Search cards by title/content (project required unless index is available). | no |
| `search_entities` | Search across people/projects/recordings/todos (and cards by ID when project provided). | no |
| `search_metadata` | Get search filter metadata. | no |
| `search_people` | Search people by name/email (server-side). | no |
| `search_project` | Search within a project (dock-driven search if enabled). | yes |
| `search_projects` | Search projects by name. | no |
| `search_recordings` | Search all recordings across projects by title/content. | yes |
| `search_todos` | Search open todos across all projects by keyword. | yes |
| `smart_action` | Smart router: decide which action to call based on natural language query and context. | yes |
| `startbcgpt` | Show connection status, current user (name/email), plus re-auth and logout links. | yes |
| `subscribe_card_table_column` | Subscribe to a card table column. | no |
| `subscribe_recording` | Subscribe the current user to a recording. | no |
| `trash_dock_tool` | Trash a dock tool by ID. | no |
| `trash_project` | Trash a project by ID. | no |
| `trash_recording` | Move a recording to trash. | no |
| `trash_template` | Trash a template by ID. | no |
| `unarchive_recording` | Unarchive a recording. | no |
| `uncomplete_card_step` | Mark a card step as incomplete. | no |
| `uncomplete_todo` | Mark a to-do as incomplete. | yes |
| `unpin_recording` | Unpin a message or other recording. | no |
| `unsubscribe_card_table_column` | Unsubscribe from a card table column. | no |
| `unsubscribe_recording` | Unsubscribe the current user from a recording. | no |
| `update_card` | Update a card. Provide official fields in body. | no |
| `update_card_step` | Update a card step. Provide official fields in body. | no |
| `update_card_table_column` | Update a card table column. Provide official fields in body. | no |
| `update_card_table_column_color` | Update a card table column color. Provide official fields in body. | no |
| `update_chatbot` | Update a chatbot. Provide official fields in body. | no |
| `update_client_visibility` | Update client visibility for a recording. | no |
| `update_comment` | Update a comment's content. | no |
| `update_dock_tool` | Update a dock tool name. Provide official fields in body. | no |
| `update_document` | Update a document. Provide official fields in body. | no |
| `update_lineup_marker` | Update a lineup marker. Provide official fields in body. | no |
| `update_message` | Update a message. Provide official fields in body. | no |
| `update_message_type` | Update a message type (category). Provide fields in body. | no |
| `update_project` | Update a project. Provide official fields in body. | no |
| `update_project_people` | Grant/revoke project access. Provide official fields in body. | no |
| `update_question` | Update a question. Provide fields in question object. | no |
| `update_question_answer` | Update a question answer. Provide official fields in body. | no |
| `update_question_notification` | Update notification settings for a question. | no |
| `update_question_notification_settings` | Update question notification settings. Provide official fields in body. | no |
| `update_schedule` | Update a schedule. | no |
| `update_schedule_entry` | Update a schedule entry. Provide official fields in body. | no |
| `update_subscription` | Update subscribers list for a recording. | no |
| `update_template` | Update a template. Provide official fields in body. | no |
| `update_todo_details` | Update a to-do in a project. Fields omitted are preserved. | yes |
| `update_todolist` | Update a todolist. Provide official fields in body. | no |
| `update_upload` | Update an upload. Provide official fields in body. | no |
| `update_vault` | Update vault metadata. Provide official fields in body. | no |
| `update_webhook` | Update a webhook. Provide official fields in body. | no |
| `user_timeline` | Timeline events for a person. Optional query string. | no |
| `whoami` | Return account id + authorized accounts list. | no |
