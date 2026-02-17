# Phase 3 API implementation backlog

This sheet drives the “missing coverage” items from `docs/reference/BC3_API_COVERAGE.md`. Each section below lists the official BC3 endpoint(s), the desired UX, and the internal work required (including caching/iteration strategy) so the MCP server remains the “master” behind every summary.

## 1. Attachments
- **Endpoint**: `POST /attachments.json` (binary payload with `name` query parameter).
- **Goal**: Provide `create_attachment` tool that uploads raw binary file data, returns `attachable_sgid`, and caches metadata for later reference in cards/messages.
- **Work**:
  1. Extend `createAttachment` helper in `mcp.js` to post binary (base64) content using `api`.
  2. Add tool + handler so GPT can send base64 strings or URLs; normalize to raw bytes server-side.
  3. Cache the returned `attachable_sgid` info in the payload cache so large exports can reference attachments without refetching.

## 2. Events
- **Endpoint**: `GET /buckets/{project}/recordings/{recording_id}/events.json`.
- **Goal**: Expose `list_recording_events` tool that can stream events for a recording (and optionally all recordings in project) with pagination.
- **Work**:
  1. Build helper invoking `apiAll` on the events endpoint, accept `recording_id` or fallback to a recording lookup.
  2. Return `payload_key` when the event list is large and include event metadata (creator, action, details).
  3. Integrate with smart-action summaries (e.g., “show changes for todo X”) by chaining `findRecording` → `listRecordingEvents`.

## 3. Lineup markers
- **Endpoints**: `POST /lineup/markers.json`, `PUT /lineup/markers/{id}.json`, `DELETE /lineup/markers/{id}.json`.
- **Goal**: Provide `list_lineup_markers`, `create_lineup_marker`, `update_lineup_marker`, `delete_lineup_marker` tools so GPT can manage account-wide markers.
- **Work**:
  1. Add helper functions/handlers for each verb, ensure payload normalization (name/date) and success messages.
  2. Cache markers locally so “show timeline” can include them without hitting the API repeatedly.
  3. Surface markers in the Phase 3 summary export.

## 4. Timesheets
- **Endpoints**: `GET /timesheets.json`, `GET /timesheets/{id}.json`, `POST`/`PUT` for entries.
- **Goal**: Provide `list_timesheets`, `get_timesheet`, `log_timesheet_entry` tools for status summaries.
- **Work**:
  1. Use `apiAll` to list all timesheets for the account, optionally filtered by project.
  2. Cache the per-project/time range entries so summarizing “what’s billed this week” is server-driven.
  3. Respect pagination/chunking for large datasets.

## 5. Questionnaires & questions
- **Endpoints**: `GET /buckets/{project}/questionnaires.json`, `GET /questions.json`, `POST/PUT` for questions/answers.
- **Goal**: Add tools to list questionnaires, list questions, and answer/resume them.
- **Work**:
  1. Build helpers for questionnaires and question answers (list/create/update).
  2. Provide smart action flows that say “summarize survey responses” by chaining the tool set.
  3. Cache question metadata so repeated requests don’t re-fetch everything.

## 6. Forwards/Inboxes
- **Endpoints**: `/buckets/{project}/inboxes/{id}/forwards.json`, `/inbox_forwards/{id}/replies.json`.
- **Goal**: Tools for `list_inboxes`, `list_forwards`, `reply_to_forward`, plus ability to summarize inbound client communications.
- **Work**:
  1. Resolve inbox IDs (possibly via dock) and call the forwards/replies endpoints with `apiAll`.
  2. Cache the recent forwards so the MCP can answer “show me inbound replies” without repeated network traffic.

## 7. Forward-looking
- **Remaining doc sections**: `events` (done above), `lineup_markers`, `timesheets`, `questionnaires`, `forwards/inboxes`, `attachments`, `rich_text` (embedding attachments), `tools` (account configuration), `basecamps` (account metadata).
- **Strategy**:
  - Implement each area sequentially, ensuring every handler caches large payloads via `putLargePayload` when necessary.
  - Update `smart_action` to prefer cached payloads and expose `payload_key` for exports so GPT can iterate through chunks without refetching.
  - Keep the Phase 3 QA checklist synced with coverage status.
