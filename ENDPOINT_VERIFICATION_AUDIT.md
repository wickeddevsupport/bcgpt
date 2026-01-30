# Comprehensive Endpoint Verification Audit

## Status: IN PROGRESS (23 tools verified, 18 need review)

## Verified Endpoints ✅

| Tool | Function | Endpoint | Method | Status |
|------|----------|----------|--------|--------|
| list_projects | listProjects | GET /projects.json | GET | ✅ CORRECT |
| list_todos_for_project | listTodosForProject | GET /buckets/{id}/todolists/{id}/todos.json | GET | ✅ CORRECT (fixed: uses todolists not todosets) |
| list_todos_lists | listTodoLists | GET /buckets/{id}/todosets/{id}/todolists.json | GET | ✅ CORRECT (fixed: extracts todosetId from dock) |
| list_messages | listMessages | {board.messages_url} | GET | ✅ CORRECT (dock-driven) |
| search_todos | searchRecordings | GET /search.json?q=X&type=Todo | GET | ✅ CORRECT (fixed: was using wrong endpoint) |
| search_recordings | searchRecordings | GET /search.json?q=X&type={type} | GET | ✅ CORRECT (fixed: was using wrong endpoint) |
| search_project | searchProject | GET /search.json?q=X&bucket_id={id} | GET | ✅ CORRECT |
| list_comments | listComments | GET /buckets/{id}/recordings/{id}/comments.json | GET | ✅ CORRECT PATH (404 issue = invalid recording_id, not code) |
| list_uploads | listUploads | GET /buckets/{id}/uploads.json | GET | ✅ CORRECT (fixed: was nested in /vaults/{id}/) |

## Known Issues ❌

| Issue | Severity | Status |
|-------|----------|--------|
| test recording_id 9520410782 returns 404 | LOW | CONFIRMED: Recording doesn't exist/not accessible (not a code issue) |

## Endpoints Still Needing Verification ❓

### Creation Endpoints (POST)
- [ ] **create_todo** - Needs verification: POST body structure for /buckets/{id}/todolists/{id}/todos.json
- [ ] **create_comment** - Needs verification: POST body for /buckets/{id}/recordings/{id}/comments.json
- [ ] **create_message** - Needs verification: POST body for /buckets/{id}/message_boards/{id}/messages.json
- [ ] **create_card** - Needs verification: POST body for /buckets/{id}/card_tables/{id}/cards.json

### Update Endpoints (PUT)
- [ ] **update_todo** - Needs verification: PUT to /buckets/{id}/todos/{id}.json
- [ ] **update_message** - Needs verification: PUT to /buckets/{id}/messages/{id}.json  
- [ ] **update_card** - Needs verification: PUT to /buckets/{id}/card_tables/cards/{id}.json
- [ ] **move_card** - Needs verification: Endpoint and method for card position changes

### Special Status Endpoints
- [ ] **complete_task_by_name** - Needs verification: POST to /buckets/{id}/todos/{id}/completion.json
- [ ] **archive_recording** - Needs verification: PUT to /buckets/{id}/recordings/{id}/status/archived.json
- [ ] **trash_recording** - Needs verification: PUT to /buckets/{id}/recordings/{id}/status/trashed.json
- [ ] **unarchive_recording** - Needs verification: PUT to /buckets/{id}/recordings/{id}/status/active.json

### Card Table Operations
- [ ] **list_cards** - Needs verification: GET /buckets/{id}/card_tables/lists/{id}/cards.json
- [ ] **list_card_tables** - Needs verification: GET /buckets/{id}/card_tables.json
- [ ] **get_hill_chart** - Needs verification: GET /buckets/{id}/hill_charts/{id}.json
- [ ] **get_assignment_report** - Needs verification: Endpoint path
- [ ] **list_questions** - Needs verification: Endpoint path (Questions are recorded items)

### People & Access
- [ ] **list_people** - Needs verification: GET /people.json
- [ ] **get_person** - Needs verification: GET /people/{id}.json
- [ ] **add_person_to_project** - Needs verification: POST /buckets/{id}/accesses.json
- [ ] **remove_person_from_project** - Needs verification: DELETE or status update endpoint

### Documents/Vault
- [ ] **list_documents** - Needs verification: Vault endpoint
- [ ] **get_vault** - Needs verification: Dock-driven or direct GET
- [ ] **upload_file** - Needs verification: POST multipart/form-data endpoint

### Other
- [ ] **get_recording** - Needs verification: GET /buckets/{id}/recordings/{id}.json
- [ ] **get_message** - Needs verification: GET /buckets/{id}/messages/{id}.json
- [ ] **get_todo** - Needs verification: GET /buckets/{id}/todos/{id}.json

## Test Plan

### Phase 1: Verify all endpoint paths match official docs (IN PROGRESS)
1. Check POST body structure for all creation endpoints
2. Verify PUT endpoints exist and use correct paths
3. Confirm special status endpoints (/status/*, /completion.json)
4. Check dock-driven endpoints match dock structure

### Phase 2: Test with real Basecamp data
1. Create todos and verify response structure
2. Test commenting on various recording types
3. Test card operations and movement
4. Test permission-based operations (add/remove people)

### Phase 3: Fix any identified issues
1. Update endpoint paths if incorrect
2. Add missing request body validation
3. Add better error messages for common failures

## Notes

- Basecamp 4 API uses `/buckets/{id}/` prefix for all project-scoped operations
- Recordable items (todos, messages, documents, etc.) all use `/buckets/{id}/recordings/{id}/` for comments
- Dock items provide correct URLs that should be used when available
- Pagination is handled automatically by `basecampFetchAll()` via Link headers
