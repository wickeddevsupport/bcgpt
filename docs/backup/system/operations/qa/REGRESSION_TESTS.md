# Regression Tests (Pagination, Nesting, Chunk Integrity)

This checklist validates that every list endpoint returns **complete data** with iteration metadata and chunking.

## Pagination
1. Call `list_recording_events` on a recording with > 1 page of events.
   - Expect: `_meta.pages > 1`, `truncated=false`, `next_url=null` after final page.
2. Call `list_lineup_markers` when multiple markers exist.
   - Expect: `_meta.pages >= 1`, `count` equals total markers.
3. Call `list_timesheet_report` with a time range that returns > 100 entries.
   - Expect: `_meta.pages > 1`, no missing rows.
4. Call `list_questions` on a questionnaire with many questions.
   - Expect: `_meta.pages > 1`, no duplicates.
5. Call `list_inboxes` + `list_inbox_forwards` with many forwards.
   - Expect: `_meta.pages > 1`, no missing replies.

## Nesting & chunk integrity
6. Call `list_project_card_table_contents` with `cache_output=true` and `cache_chunk_boards=1`.
   - Expect: `payload_key` returned, `card_tables_cached=true`, `chunk_count` >= 1.
7. Call `get_cached_payload_chunk` for each index until `done=true`.
   - Expect: combined chunks == total card tables count.
8. Call `export_cached_payload` and verify the JSON file includes all items.

## Smart-action summaries
9. Run "Summarize project X" using `smart_action`.
   - Expect: it auto-iterates pages, returns metadata, and does not stop at page 1.
10. Run "Dump all cards in project X" using `smart_action`.
    - Expect: returns chunked payload and cache key for completion.

## Success criteria
- No summaries return partial data unless explicitly chunked.
- `_meta.pages` and `cache_key` are present for large collections.
- Chunk retrieval reconstructs the full dataset without duplication.
