# Iteration & Pagination Case Study: Full Card Table Dump

Last updated: 2026-02-01

## Case summary
User requested a full dump of **all card tables** (boards) for a single project. The server returned only one board or prompted for a choice, which caused partial summaries and poor UX.

## Root cause
- Basecamp list endpoints are paginated (Link headers).  
- Card tables are **nested** (board -> columns -> cards), which multiplies payload size.  
- Connector + chat response limits are smaller than real datasets.  
- Tool handlers were returning partial results or asking the user to select a board.

## Fix pattern implemented (card tables)
1) **Full iteration**  
   Use `apiAll()` for every list endpoint and iterate nested resources.
2) **Zero cap at the data layer**  
   Fetch all cards per column; do not silently truncate.
3) **Cache + chunk output**  
   Store the full payload server-side, return `payload_key`, and stream chunks with `get_cached_payload_chunk`.
4) **Export full payload**  
   Write the payload to `exports/` and return a file path for guaranteed access.
5) **Smart_action auto-iteration**  
   If the user asks for "all contents", fetch everything, cache it, then summarize from full data.

## Tools added/updated for this case
- `list_project_card_table_contents` (board-by-board iterator with cache option)
- `list_card_table_cards` (project-level iteration when no `card_table_id`)
- `get_cached_payload_chunk` (chunk retrieval)
- `export_cached_payload` (full JSON export to disk)

## Expected UX outcome
- User asks for "full dump" -> MCP fetches **everything** automatically.
- MCP returns `payload_key` and exported file path.
- ChatGPT summarizes or renders from **complete** data, not partial pages.
- No "pick a board" prompts for data that can be retrieved automatically.

## Apply this pattern across the app
Any endpoint that returns **collections** or **nested collections** must follow the same pattern:
1) Use `apiAll()` (pagination)
2) Iterate nested resources
3) Cache + chunk when payload is too large
4) Export payload for full fidelity

### Priority candidates (nested or high-volume)
- Messages -> comments
- Documents -> uploads
- Campfire lines
- Schedule entries
- Timesheet entries
- Recordings (by type)
- Search results
- Inboxes -> forwards -> replies
- Questions -> answers
- Card tables -> columns -> cards (already done)

## Implementation checklist
- [x] Add a shared **iterator + cache** helper used by list tools (`buildListPayload`, cache + export helpers).
- [x] Ensure **every list endpoint** uses `apiAll()` (including RequestContext preload).
- [x] Add `payload_key` + `export` to large responses by default.
- [~] Update `smart_action` to auto-fetch + return cached payload metadata (first chunk returned).
- [ ] Add tests for large payload handling and chunk integrity.
- [ ] Update docs/coverage and phase status after rollout.
