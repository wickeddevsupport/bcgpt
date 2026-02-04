# Tool Matrix (MCP + OpenAPI)

Last updated: 2026-02-04

This document maps MCP tools to Basecamp capabilities, highlights OpenAPI coverage, and shows gaps that still need to be filled for a true MCP server. `/mcp` is the authoritative interface; `/action` is a compatibility wrapper limited to 30 actions.

## Coverage Matrix by Entity
| Entity | List | Search | Get | Create | Update/Move | Delete/Archive | Comment | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| People | `list_all_people`, `list_project_people`, `list_pingable_people` | `search_people`, `search_entities` | `get_person`, `get_my_profile` | missing | `update_project_people` | missing | n/a | People search must be authoritative and include deep scan. |
| Projects | `list_projects` | `find_project`, `search_projects`, `search_entities` | `get_project`, `get_project_structure` | `create_project`, `create_project_construction` | `update_project`, `update_project_people` | `trash_project` | n/a | Project search should fall back to archived scan when active scan is empty. |
| Todos | `list_todos_for_project`, `list_todos_for_list`, `list_todos_due` | `search_todos`, `search_entities` | `get_todo`, `get_todolist`, `get_todoset` | `create_todo`, `create_todolist`, `create_todolist_group` | `update_todo_details`, `reposition_todo`, `complete_todo`, `uncomplete_todo` | `trash_recording` (generic) | `list_comments`, `create_comment`, `get_comment`, `update_comment` | Assignment helpers: `assignment_report`, `get_person_assignments`, `list_assigned_to_me`. |
| Cards | `list_card_tables`, `list_card_table_cards`, `list_project_card_table_contents` | `search_cards`, `search_entities` | `get_card` | `create_card` | `update_card`, `move_card`, card steps tools | `archive_card`, `unarchive_card`, `trash_card` | `create_comment` (via card -> recording) | Card search requires project unless index already contains cards. |
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
- `audit_person`
- `basecamp_raw`
- `complete_todo`
- `create_card`
- `create_comment`
- `create_message`
- `create_todo`
- `get_cached_payload_chunk`
- `list_all_people`
- `list_card_table_cards`
- `list_card_tables`
- `list_comments`
- `list_message_boards`
- `list_messages`
- `list_project_card_table_contents`
- `list_projects`
- `summarize_person`
- `list_todos_due`
- `list_todos_for_project`
- `mcp_call`
- `move_card`
- `report_todos_assigned_person`
- `search_project`
- `search_projects`
- `search_recordings`
- `search_todos`
- `smart_action`
- `startbcgpt`
- `uncomplete_todo`
- `update_todo_details`

## Tool Catalog (MCP)
| Tool | Purpose | OpenAPI |
| --- | --- | --- |
| `startbcgpt` | Show connection status, current user (name/email), plus re-auth and logout links. | yes |
| `whoami` | Return account id + authorized accounts list. | no |
| `list_accounts` | List Basecamp accounts available to the authenticated user. | no |
| `list_projects` | List projects (supports archived). | yes |
| `find_project` | Resolve a project by name (fuzzy). | no |
| `daily_report` | Across projects: totals + per-project breakdown + due today + overdue (open only). | no |
| `list_todos_due` | Across projects: list open todos due on date; optionally include overdue. | yes |
| `search_todos` | Search open todos across all projects by keyword. | yes |
| `assignment_report` | Group open todos by assignee within a project (optimized). | no |
| `get_person_assignments` | List todos assigned to a specific person within a project. | no |
| `list_assigned_to_me` | List todos assigned to the current user (optionally within a project). | no |
| `smart_action` | Smart router: decide which action to call based on natural language query and context. | yes |
| `audit_person` | Summarize a person's Basecamp presence (projects, assigned todos, recent activity). | yes |
| `summarize_person` | Compact person summary (counts + previews). | yes |
| `summarize_project` | Compact project summary with optional counts. | no |
| `summarize_todo` | Compact summary for a specific todo. | no |
| `summarize_card` | Compact summary for a specific card. | no |
| `summarize_message` | Compact summary for a specific message. | no |
| `summarize_document` | Compact summary for a specific document. | no |
| `summarize_upload` | Compact summary for a specific upload. | no |
| `run_regression_suite` | Run a set of tool calls and report pass/fail checks. | no |
| `run_default_regression_suite` | Run the default regression suite (pre-packaged checks). | no |
| `mcp_call` | Proxy call to any MCP tool by name (full toolset access). | yes |
| `n8n_set_api_key` | Store an n8n API key for the current session/user. | no |
| `n8n_status` | Check whether an n8n API key is stored for the current session/user. | no |
| `n8n_request` | Raw n8n API call. | no |
| `n8n_list_workflows` | List n8n workflows (optional active filter). | no |
| `n8n_get_workflow` | Get an n8n workflow by ID. | no |
| `n8n_create_workflow` | Create an n8n workflow (confirmation required). | no |
| `n8n_update_workflow` | Update an n8n workflow (confirmation required). | no |
| `n8n_delete_workflow` | Delete an n8n workflow (confirmation required). | no |
| `search_people` | Search people by name/email (server-side). | no |
| `search_projects` | Search projects by name. | yes |
| `search_cards` | Search cards by title/content (project required unless index is available). | no |
| `list_person_projects` | List projects a person belongs to (by name, email, or ID). | no |
| `list_person_activity` | List recent activity for a person (timeline-based). | no |
| `resolve_entity_from_url` | Resolve a Basecamp UI/API URL into a structured entity reference. | no |
| `search_entities` | Search across people/projects/recordings/todos (and cards by ID when project provided). | no |
| `list_todos_for_project` | List todolists + todos for a project by name. | yes |
| `create_todo` | Create a to-do in a project; optionally specify todolist, due date, and assignees. | yes |
| `update_todo_details` | Update a to-do in a project. Fields omitted are preserved. | yes |
| `get_todo` | Get a to-do by ID. | no |
| `list_todos_for_list` | List to-dos in a specific todolist. | no |
| `uncomplete_todo` | Mark a to-do as incomplete. | yes |
| `complete_todo` | Mark a to-do as complete. | yes |
| `reposition_todo` | Move/reposition a to-do within its list. | no |
| `complete_task_by_name` | Complete a todo in a project by fuzzy-matching its content. | no |
| `list_card_tables` | List card tables (kanban boards) for a project. | yes |
| `list_card_table_columns` | List columns for a card table. | no |
| `list_card_table_cards` | List cards for a card table. | yes |
| `list_card_table_summaries` | List card table summaries for a project, optionally including card titles. | no |
| `list_card_table_summaries_iter` | Iterate card table summaries one board per call. | no |
| `list_project_card_table_contents` | List card table contents for a project, chunked by boards. | yes |
| `get_cached_payload_chunk` | Retrieve a chunk from the large payload cache. | yes |
| `export_cached_payload` | Export a cached payload to a JSON file and return the file path. | no |
| `create_card` | Create a card in a card table. | yes |
| `move_card` | Move/update a card (column/position). | yes |
| `archive_card` | Archive a card (recording). | no |
| `unarchive_card` | Unarchive a card (recording). | no |
| `trash_card` | Trash a card (recording). | no |
| `list_card_steps` | List steps (checklist) for a card. | no |
| `create_card_step` | Create a step on a card. Provide official fields in body. | no |
| `update_card_step` | Update a card step. Provide official fields in body. | no |
| `complete_card_step` | Mark a card step completed. | no |
| `uncomplete_card_step` | Mark a card step as incomplete. | no |
| `reposition_card_step` | Reposition a card step within its card. | no |
| `get_hill_chart` | Fetch the hill chart for a project (if enabled). | no |
| `list_message_boards` | List message boards for a project. | yes |
| `list_messages` | List messages in a message board. If message_board_id omitted, uses the first board. | yes |
| `list_message_types` | List message types (categories) for a project. | no |
| `get_message_type` | Get a message type (category) by ID. | no |
| `create_message_type` | Create a message type (category). Provide fields in body. | no |
| `update_message_type` | Update a message type (category). Provide fields in body. | no |
| `delete_message_type` | Delete a message type (category). | no |
| `pin_recording` | Pin a message or other recording. | no |
| `unpin_recording` | Unpin a message or other recording. | no |
| `list_client_correspondences` | List client correspondences for a project. | no |
| `get_client_correspondence` | Get a client correspondence by ID. | no |
| `list_client_approvals` | List client approvals for a project. | no |
| `get_client_approval` | Get a client approval by ID. | no |
| `list_client_replies` | List client replies for a correspondence/approval recording. | no |
| `get_client_reply` | Get a specific client reply by recording + reply ID. | no |
| `list_documents` | List documents/files in the project vault. | no |
| `get_vault` | Get a vault by ID. | no |
| `list_child_vaults` | List child vaults within a vault. | no |
| `create_child_vault` | Create a child vault within a vault. Provide official fields in body. | no |
| `update_vault` | Update vault metadata. Provide official fields in body. | no |
| `list_schedule_entries` | List schedule entries for a project (date range optional). | no |
| `search_project` | Search within a project (dock-driven search if enabled). | yes |
| `list_all_people` | List all people visible in the Basecamp account (use empty query to list all). | yes |
| `get_person` | Get profile of a specific person by ID. | no |
| `get_my_profile` | Get current authenticated user's profile. | no |
| `list_project_people` | List all people on a project. | no |
| `list_comments` | List comments on a recording (message, document, todo, etc). | yes |
| `get_comment` | Get a specific comment by ID. | no |
| `create_comment` | Create a comment on a recording. | yes |
| `list_uploads` | List files/uploads in a project vault. | no |
| `get_upload` | Get details of a specific file/upload. | no |
| `get_recordings` | Query all recordings across projects by type (Todo, Message, Document, Upload, etc). | no |
| `trash_recording` | Move a recording to trash. | no |
| `archive_recording` | Archive a recording. | no |
| `unarchive_recording` | Unarchive a recording. | no |
| `list_vaults` | List document storage vaults for a project. | no |
| `list_campfires` | List campfires (chats). If project omitted, lists all visible chats. | no |
| `get_campfire` | Get a campfire (chat) by ID or from project dock. | no |
| `list_campfire_lines` | List chat lines in a campfire. | no |
| `get_campfire_line` | Get a specific chat line. | no |
| `create_campfire_line` | Create a chat line. Provide official fields in body (content, etc). | no |
| `delete_campfire_line` | Delete a chat line. | no |
| `list_chatbots` | List chatbots (integrations) for a campfire. | no |
| `get_chatbot` | Get a chatbot by integration id. | no |
| `create_chatbot` | Create a chatbot (integration). Provide official fields in body. | no |
| `update_chatbot` | Update a chatbot. Provide official fields in body. | no |
| `delete_chatbot` | Delete a chatbot. | no |
| `post_chatbot_line` | Post a chat line as a chatbot using integration key. Provide body if needed. | no |
| `list_webhooks` | List webhooks for a project. | no |
| `get_webhook` | Get a webhook by ID. | no |
| `create_webhook` | Create a webhook. Provide official fields in body. | no |
| `update_webhook` | Update a webhook. Provide official fields in body. | no |
| `delete_webhook` | Delete a webhook. | no |
| `list_timesheet_report` | List timesheet entries account-wide (optionally filtered). | no |
| `list_project_timesheet` | List timesheet entries for a project. | no |
| `list_recording_timesheet` | List timesheet entries for a recording. | no |
| `search_recordings` | Search all recordings across projects by title/content. | yes |
| `get_project` | Get project by ID. | no |
| `create_project` | Create a project. Provide official fields in body. | no |
| `update_project` | Update a project. Provide official fields in body. | no |
| `trash_project` | Trash a project by ID. | no |
| `list_pingable_people` | List people who can be pinged. | no |
| `update_project_people` | Grant/revoke project access. Provide official fields in body. | no |
| `update_comment` | Update a comment's content. | no |
| `create_attachment` | Create an attachment (binary) from base64. Provide name, content_type, content_base64. | no |
| `get_message_board` | Get a message board by ID. | no |
| `get_message` | Get a message by ID. | no |
| `create_message` | Create a message. Provide official fields in body. | yes |
| `update_message` | Update a message. Provide official fields in body. | no |
| `get_document` | Get a document by ID. | no |
| `create_document` | Create a document in a vault. Provide official fields in body. | no |
| `update_document` | Update a document. Provide official fields in body. | no |
| `create_upload` | Create an upload in a vault. Provide official fields in body. | no |
| `update_upload` | Update an upload. Provide official fields in body. | no |
| `update_client_visibility` | Update client visibility for a recording. | no |
| `list_recording_events` | List events for a recording. | no |
| `get_subscription` | Get subscription info for a recording. | no |
| `subscribe_recording` | Subscribe the current user to a recording. | no |
| `unsubscribe_recording` | Unsubscribe the current user from a recording. | no |
| `update_subscription` | Update subscribers list for a recording. | no |
| `report_todos_assigned` | List people who can have todos assigned. | no |
| `report_todos_assigned_person` | List todos assigned to a person (report). | yes |
| `report_todos_overdue` | List overdue todos across all projects. | no |
| `report_schedules_upcoming` | List upcoming schedule entries (report). Optional query string. | no |
| `report_timeline` | Timeline events across all projects. Optional query string. | no |
| `project_timeline` | Timeline events for a project. Optional query string. | no |
| `user_timeline` | Timeline events for a person. Optional query string. | no |
| `report_timesheet` | Timesheet entries across the account. Optional query string. | no |
| `project_timesheet` | Timesheet entries for a project. Optional query string. | no |
| `recording_timesheet` | Timesheet entries for a recording. Optional query string. | no |
| `get_inbox` | Get an inbox by ID. | no |
| `list_inboxes` | List inboxes for a project. | no |
| `list_inbox_forwards` | List forwards for an inbox. | no |
| `get_inbox_forward` | Get a forward by ID. | no |
| `list_inbox_replies` | List replies for an inbox forward. | no |
| `get_inbox_reply` | Get a specific inbox reply. | no |
| `get_questionnaire` | Get a questionnaire by ID. | no |
| `list_questions` | List questions in a questionnaire. | no |
| `get_question` | Get a question by ID. | no |
| `create_question` | Create a question. Provide official fields in body. | no |
| `update_question` | Update a question. Provide official fields in body. | no |
| `pause_question` | Pause a question. | no |
| `resume_question` | Resume a question. | no |
| `update_question_notification_settings` | Update question notification settings. Provide official fields in body. | no |
| `list_question_answers` | List answers for a question. | no |
| `list_question_answers_by` | List people who answered a question. | no |
| `list_question_answers_by_person` | List answers by person for a question. | no |
| `get_question_answer` | Get a question answer by ID. | no |
| `create_question_answer` | Create an answer to a question. Provide official fields in body. | no |
| `update_question_answer` | Update a question answer. Provide official fields in body. | no |
| `list_question_reminders` | List pending question reminders for the current user. | no |
| `list_templates` | List templates. | no |
| `get_template` | Get a template by ID. | no |
| `create_template` | Create a template. Provide official fields in body. | no |
| `update_template` | Update a template. Provide official fields in body. | no |
| `trash_template` | Trash a template by ID. | no |
| `create_project_construction` | Create a project from a template. Provide official fields in body. | no |
| `get_project_construction` | Get a project construction by ID. | no |
| `get_dock_tool` | Get a dock tool by ID. | no |
| `create_dock_tool` | Create a dock tool by cloning. Provide official fields in body. | no |
| `update_dock_tool` | Update a dock tool name. Provide official fields in body. | no |
| `enable_dock_tool` | Enable a tool by recording ID. Provide official fields in body. | no |
| `move_dock_tool` | Move a tool by recording ID. Provide official fields in body. | no |
| `disable_dock_tool` | Disable a tool by recording ID. | no |
| `trash_dock_tool` | Trash a dock tool by ID. | no |
| `create_lineup_marker` | Create a lineup marker. Provide official fields in body. | no |
| `update_lineup_marker` | Update a lineup marker. Provide official fields in body. | no |
| `delete_lineup_marker` | Delete a lineup marker. | no |
| `list_lineup_markers` | List all lineup markers. | no |
| `list_todolist_groups` | List groups in a todolist. | no |
| `get_todolist_group` | Get a todolist group by ID. | no |
| `create_todolist_group` | Create a todolist group. Provide official fields in body. | no |
| `reposition_todolist_group` | Reposition a todolist group. | no |
| `get_todoset` | Get a todoset by ID. | no |
| `get_todolist` | Get a todolist by ID. | no |
| `create_todolist` | Create a todolist. Provide official fields in body. | no |
| `update_todolist` | Update a todolist. Provide official fields in body. | no |
| `get_schedule` | Get a schedule by ID. | no |
| `update_schedule` | Update a schedule. | no |
| `get_schedule_entry` | Get a schedule entry by ID. | no |
| `create_schedule_entry` | Create a schedule entry. Provide official fields in body. | no |
| `update_schedule_entry` | Update a schedule entry. Provide official fields in body. | no |
| `search_metadata` | Get search filter metadata. | no |
| `get_card_table` | Get a card table by ID. | no |
| `get_card_table_column` | Get a card table column by ID. | no |
| `create_card_table_column` | Create a card table column. Provide official fields in body. | no |
| `update_card_table_column` | Update a card table column. Provide official fields in body. | no |
| `move_card_table_column` | Move a card table column. Provide official fields in body. | no |
| `subscribe_card_table_column` | Subscribe to a card table column. | no |
| `unsubscribe_card_table_column` | Unsubscribe from a card table column. | no |
| `create_card_table_on_hold` | Create on-hold section for a column. | no |
| `delete_card_table_on_hold` | Delete on-hold section for a column. | no |
| `update_card_table_column_color` | Update a card table column color. Provide official fields in body. | no |
| `get_card` | Get a card by ID. | no |
| `update_card` | Update a card. Provide official fields in body. | no |
| `get_project_structure` | Inspect a project's dock and available API endpoints (for diagnostics). | no |
| `basecamp_request` | Raw Basecamp API call. Provide full URL or a /path. | no |
| `basecamp_raw` | Alias of basecamp_request for backward compatibility. | yes |
| `api_get_buckets_by_bucket_id_card_tables_by_card_table_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/card_tables/{card_table_id}.json | no |
| `api_get_buckets_by_bucket_id_card_tables_cards_by_card_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/card_tables/cards/{card_id}.json | no |
| `api_get_buckets_by_bucket_id_card_tables_columns_by_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/card_tables/columns/{id}.json | no |
| `api_get_buckets_by_bucket_id_card_tables_lists_by_column_id_cards` | Raw endpoint wrapper: GET /buckets/{bucket_id}/card_tables/lists/{column_id}/cards.json | no |
| `api_get_buckets_by_bucket_id_categories` | Raw endpoint wrapper: GET /buckets/{bucket_id}/categories.json | no |
| `api_get_buckets_by_bucket_id_categories_by_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/categories/{id}.json | no |
| `api_get_buckets_by_bucket_id_chats_by_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/chats/{id}.json | no |
| `api_get_buckets_by_bucket_id_chats_by_id_integrations` | Raw endpoint wrapper: GET /buckets/{bucket_id}/chats/{id}/integrations.json | no |
| `api_get_buckets_by_bucket_id_chats_by_id_integrations_by_integration_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/chats/{id}/integrations/{integration_id}.json | no |
| `api_get_buckets_by_bucket_id_chats_by_id_lines` | Raw endpoint wrapper: GET /buckets/{bucket_id}/chats/{id}/lines.json | no |
| `api_get_buckets_by_bucket_id_chats_by_id_lines_by_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/chats/{id}/lines/{id}.json | no |
| `api_get_buckets_by_bucket_id_client_approvals` | Raw endpoint wrapper: GET /buckets/{bucket_id}/client/approvals.json | no |
| `api_get_buckets_by_bucket_id_client_approvals_by_approval_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/client/approvals/{approval_id}.json | no |
| `api_get_buckets_by_bucket_id_client_correspondences` | Raw endpoint wrapper: GET /buckets/{bucket_id}/client/correspondences.json | no |
| `api_get_buckets_by_bucket_id_client_correspondences_by_correspondence_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/client/correspondences/{correspondence_id}.json | no |
| `api_get_buckets_by_bucket_id_client_recordings_by_recording_id_replies` | Raw endpoint wrapper: GET /buckets/{bucket_id}/client/recordings/{recording_id}/replies.json | no |
| `api_get_buckets_by_bucket_id_client_recordings_by_recording_id_replies_by_reply_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/client/recordings/{recording_id}/replies/{reply_id}.json | no |
| `api_get_buckets_by_bucket_id_comments_by_comment_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/comments/{comment_id}.json | no |
| `api_get_buckets_by_bucket_id_dock_tools_by_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/dock/tools/{id}.json | no |
| `api_get_buckets_by_bucket_id_documents_by_document_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/documents/{document_id}.json | no |
| `api_get_buckets_by_bucket_id_inbox_forwards_by_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/inbox_forwards/{id}.json | no |
| `api_get_buckets_by_bucket_id_inbox_forwards_by_id_replies` | Raw endpoint wrapper: GET /buckets/{bucket_id}/inbox_forwards/{id}/replies.json | no |
| `api_get_buckets_by_bucket_id_inbox_forwards_by_id_replies_by_reply_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/inbox_forwards/{id}/replies/{reply_id}.json | no |
| `api_get_buckets_by_bucket_id_inboxes_by_inbox_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/inboxes/{inbox_id}.json | no |
| `api_get_buckets_by_bucket_id_inboxes_by_inbox_id_forwards` | Raw endpoint wrapper: GET /buckets/{bucket_id}/inboxes/{inbox_id}/forwards.json | no |
| `api_get_buckets_by_bucket_id_message_boards_by_message_board_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/message_boards/{message_board_id}.json | no |
| `api_get_buckets_by_bucket_id_message_boards_by_message_board_id_messages` | Raw endpoint wrapper: GET /buckets/{bucket_id}/message_boards/{message_board_id}/messages.json | no |
| `api_get_buckets_by_bucket_id_messages_by_message_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/messages/{message_id}.json | no |
| `api_get_buckets_by_bucket_id_question_answers_by_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/question_answers/{id}.json | no |
| `api_get_buckets_by_bucket_id_questionnaires_by_questionnaire_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/questionnaires/{questionnaire_id}.json | no |
| `api_get_buckets_by_bucket_id_questionnaires_by_questionnaire_id_questions` | Raw endpoint wrapper: GET /buckets/{bucket_id}/questionnaires/{questionnaire_id}/questions.json | no |
| `api_get_buckets_by_bucket_id_questions_by_question_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/questions/{question_id}.json | no |
| `api_get_buckets_by_bucket_id_questions_by_question_id_answers` | Raw endpoint wrapper: GET /buckets/{bucket_id}/questions/{question_id}/answers.json | no |
| `api_get_buckets_by_bucket_id_recordings_by_recording_id_comments` | Raw endpoint wrapper: GET /buckets/{bucket_id}/recordings/{recording_id}/comments.json | no |
| `api_get_buckets_by_bucket_id_recordings_by_recording_id_events` | Raw endpoint wrapper: GET /buckets/{bucket_id}/recordings/{recording_id}/events.json | no |
| `api_get_buckets_by_bucket_id_recordings_by_recording_id_subscription` | Raw endpoint wrapper: GET /buckets/{bucket_id}/recordings/{recording_id}/subscription.json | no |
| `api_get_buckets_by_bucket_id_schedule_entries_by_schedule_entry_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/schedule_entries/{schedule_entry_id}.json | no |
| `api_get_buckets_by_bucket_id_schedules_by_schedule_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/schedules/{schedule_id}.json | no |
| `api_get_buckets_by_bucket_id_schedules_by_schedule_id_entries` | Raw endpoint wrapper: GET /buckets/{bucket_id}/schedules/{schedule_id}/entries.json | no |
| `api_get_buckets_by_bucket_id_todolists_by_todolist_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/todolists/{todolist_id}.json | no |
| `api_get_buckets_by_bucket_id_todolists_by_todolist_id_groups` | Raw endpoint wrapper: GET /buckets/{bucket_id}/todolists/{todolist_id}/groups.json | no |
| `api_get_buckets_by_bucket_id_todolists_by_todolist_id_todos` | Raw endpoint wrapper: GET /buckets/{bucket_id}/todolists/{todolist_id}/todos.json | no |
| `api_get_buckets_by_bucket_id_todos_by_todo_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/todos/{todo_id}.json | no |
| `api_get_buckets_by_bucket_id_todosets_by_todoset_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/todosets/{todoset_id}.json | no |
| `api_get_buckets_by_bucket_id_todosets_by_todoset_id_todolists` | Raw endpoint wrapper: GET /buckets/{bucket_id}/todosets/{todoset_id}/todolists.json | no |
| `api_get_buckets_by_bucket_id_uploads_by_upload_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/uploads/{upload_id}.json | no |
| `api_get_buckets_by_bucket_id_vaults_by_vault_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/vaults/{vault_id}.json | no |
| `api_get_buckets_by_bucket_id_vaults_by_vault_id_documents` | Raw endpoint wrapper: GET /buckets/{bucket_id}/vaults/{vault_id}/documents.json | no |
| `api_get_buckets_by_bucket_id_vaults_by_vault_id_uploads` | Raw endpoint wrapper: GET /buckets/{bucket_id}/vaults/{vault_id}/uploads.json | no |
| `api_get_buckets_by_bucket_id_vaults_by_vault_id_vaults` | Raw endpoint wrapper: GET /buckets/{bucket_id}/vaults/{vault_id}/vaults.json | no |
| `api_get_buckets_by_bucket_id_webhooks_by_webhook_id` | Raw endpoint wrapper: GET /buckets/{bucket_id}/webhooks/{webhook_id}.json | no |
| `api_get_chats` | Raw endpoint wrapper: GET /chats.json | no |
| `api_get_my_question_reminders` | Raw endpoint wrapper: GET /my/question_reminders.json | no |
| `api_get_people` | Raw endpoint wrapper: GET /people.json | no |
| `api_get_people_by_person_id` | Raw endpoint wrapper: GET /people/{person_id}.json | no |
| `api_get_projects` | Raw endpoint wrapper: GET /projects.json | no |
| `api_get_projects_by_project_id` | Raw endpoint wrapper: GET /projects/{project_id}.json | no |
| `api_get_projects_by_project_id_recordings_by_recording_id_timesheet` | Raw endpoint wrapper: GET /projects/{project_id}/recordings/{recording_id}/timesheet.json | no |
| `api_get_projects_by_project_id_timeline` | Raw endpoint wrapper: GET /projects/{project_id}/timeline.json | no |
| `api_get_projects_by_project_id_timesheet` | Raw endpoint wrapper: GET /projects/{project_id}/timesheet.json | no |
| `api_get_reports_progress` | Raw endpoint wrapper: GET /reports/progress.json | no |
| `api_get_reports_schedules_upcoming` | Raw endpoint wrapper: GET /reports/schedules/upcoming.json | no |
| `api_get_reports_timesheet` | Raw endpoint wrapper: GET /reports/timesheet.json | no |
| `api_get_reports_todos_assigned` | Raw endpoint wrapper: GET /reports/todos/assigned.json | no |
| `api_get_reports_todos_assigned_by_id` | Raw endpoint wrapper: GET /reports/todos/assigned/{id}.json | no |
| `api_get_reports_todos_overdue` | Raw endpoint wrapper: GET /reports/todos/overdue.json | no |
| `api_get_reports_users_progress_by_id` | Raw endpoint wrapper: GET /reports/users/progress/{id}.json | no |
| `api_get_templates` | Raw endpoint wrapper: GET /templates.json | no |
| `api_get_templates_by_template_id` | Raw endpoint wrapper: GET /templates/{template_id}.json | no |
| `api_get_templates_by_template_id_project_constructions_by_id` | Raw endpoint wrapper: GET /templates/{template_id}/project_constructions/{id}.json | no |
| `api_post_templates_by_template_id_project_constructions` | Raw endpoint wrapper: POST /templates/{template_id}/project_constructions.json | no |
| `api_put_buckets_by_bucket_id_recordings_by_recording_id_subscription` | Raw endpoint wrapper: PUT /buckets/{bucket_id}/recordings/{recording_id}/subscription.json | no |
| `api_put_projects_by_project_id_people_users` | Raw endpoint wrapper: PUT /projects/{project_id}/people/users.json | no |
