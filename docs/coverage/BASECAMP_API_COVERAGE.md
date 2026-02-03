# Basecamp API Coverage Report

Last updated: 2026-02-03

This report re-checks coverage against the app's current tool set and the OpenAPI wrapper.

## Summary
- MCP tools defined in `mcp.js`: 207
- OpenAPI actions in `openapi.json`: 30 (limit enforced)
- Smart routing available via `smart_action`

## Latest online audit
See `docs/coverage/BASECAMP_API_ONLINE_AUDIT_2026-01-31.md` for an online comparison against the Basecamp API documentation.

## MCP vs OpenAPI (30-action limit)
The OpenAPI schema intentionally exposes only 30 actions. The rest are accessed via MCP or `smart_action`/`basecamp_raw`.

### Missing in OpenAPI (still available in MCP)
OpenAPI intentionally omits a large set of MCP tools, including but not limited to:
- `archive_recording`
- `basecamp_request`
- `get_comment`
- `get_hill_chart`
- `get_person`
- `get_person_assignments`
- `get_project_structure`
- `get_upload`
- `list_accounts`
- `list_assigned_to_me`
- `list_project_people`
- `list_person_projects`
- `list_person_activity`
- `list_vaults`
- `archive_card`
- `unarchive_card`
- `trash_card`
- `resolve_entity_from_url`
- `search_cards`
- `search_people`
- `unarchive_recording`
- `whoami`

### Missing in MCP
- None (core families covered; verify endpoint details against official docs)

## Recent additions (Phase 3.5)
Added MCP tools to cover more of the Basecamp API families:
- Card steps: `list_card_steps`, `create_card_step`, `update_card_step`, `complete_card_step`, `uncomplete_card_step`, `reposition_card_step`
- Message types: `list_message_types`, `get_message_type`, `create_message_type`, `update_message_type`, `delete_message_type`
- Message pinning: `pin_recording`, `unpin_recording`
- Messages: `get_message_board`, `get_message`, `create_message`, `update_message`
- Documents/Uploads: `get_document`, `create_document`, `update_document`, `create_upload`, `update_upload`
- Attachments: `create_attachment`
- Client visibility: `update_client_visibility`
- Events: `list_recording_events`
- Subscriptions: `get_subscription`, `subscribe_recording`, `unsubscribe_recording`, `update_subscription`
- Reports/timeline/timesheets: `report_*`, `*_timeline`, `*_timesheet`
- Inboxes/forwards/replies: `get_inbox`, `list_inbox_forwards`, `get_inbox_forward`, `list_inbox_replies`, `get_inbox_reply`
- Questionnaires/questions/answers/reminders: `get_questionnaire`, `list_questions`, `get_question`, `create_question`, `update_question`, `pause_question`, `resume_question`, `update_question_notification_settings`, `list_question_answers*`, `get_question_answer`, `create_question_answer`, `update_question_answer`, `list_question_reminders`
- Templates: `list_templates`, `get_template`, `create_template`, `update_template`, `trash_template`, `create_project_construction`, `get_project_construction`
- Dock tools: `get_dock_tool`, `create_dock_tool`, `update_dock_tool`, `enable_dock_tool`, `move_dock_tool`, `disable_dock_tool`, `trash_dock_tool`
- Lineup markers: `create_lineup_marker`, `update_lineup_marker`, `delete_lineup_marker`
- Todo list groups/todosets: `list_todolist_groups`, `get_todolist_group`, `create_todolist_group`, `reposition_todolist_group`, `get_todoset`
- Todo lists: `get_todolist`, `create_todolist`, `update_todolist`
- Projects: `get_project`, `create_project`, `update_project`, `trash_project`
- People: `list_pingable_people`, `update_project_people`
- Schedule: `get_schedule`, `update_schedule`, `get_schedule_entry`, `create_schedule_entry`, `update_schedule_entry`
- Search metadata: `search_metadata`
- Card tables extended: `get_card_table`, `get_card_table_column`, `create_card_table_column`, `update_card_table_column`, `move_card_table_column`, `subscribe_card_table_column`, `unsubscribe_card_table_column`, `create_card_table_on_hold`, `delete_card_table_on_hold`, `update_card_table_column_color`, `get_card`, `update_card`
- Vault hierarchy: `list_child_vaults`, `create_child_vault`, `update_vault`
- Campfires (chat): `list_campfires`, `get_campfire`, `list_campfire_lines`, `get_campfire_line`, `create_campfire_line`, `delete_campfire_line`
- Chatbots (integrations): `list_chatbots`, `get_chatbot`, `create_chatbot`, `update_chatbot`, `delete_chatbot`, `post_chatbot_line`
- Webhooks: `list_webhooks`, `get_webhook`, `create_webhook`, `update_webhook`, `delete_webhook`
- Client communications: `list_client_correspondences`, `get_client_correspondence`, `list_client_approvals`, `get_client_approval`, `list_client_replies`, `get_client_reply`
- Iteration/caching helpers: `list_card_table_summaries`, `list_card_table_summaries_iter`, `list_project_card_table_contents`, `get_cached_payload_chunk`, `export_cached_payload`

## Recent additions (True MCP hardening)
- Search: `search_projects`, `search_cards`
- People ops: `list_person_projects`, `list_person_activity`
- URL resolver: `resolve_entity_from_url`
- Search filters: `search_recordings` now supports `creator_id`, `file_type`, `exclude_chat`
- Card lifecycle: `archive_card`, `unarchive_card`, `trash_card`
- Idempotency headers for writes via `idempotency_key` (server-side cache)
- Miner indexing now supports cards, todos, messages, documents, and uploads (configurable)

## Coverage vs Basecamp API Reference
The `docs/reference/BASECAMP_API_ENDPOINTS_REFERENCE.md` file lists more endpoints than the app exposes directly.

Current strategy:
- Common workflows are covered by MCP tools + `smart_action`.
- Less common or edge endpoints are reachable via `basecamp_raw`.

## Intelligent Agent Readiness (pre-Phase 4)
- Intelligent chaining (RequestContext + executors)
- Enrichment (ResultEnricher)
- Fallback logic to avoid hard errors
- Smart routing (`smart_action`) for intent routing and fallbacks
- Phase 4 resilience not started (circuit breaker, health metrics, broader parallelization pending)

## Action items when adding new endpoints
1) Add tool to `mcp.js`
2) Add fallback behavior to avoid hard errors
3) Decide if it belongs in OpenAPI (30-action cap) or rely on `smart_action`
4) Update this coverage report
