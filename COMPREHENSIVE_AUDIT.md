# COMPREHENSIVE ENDPOINT AUDIT - All 41 Tools

## Status: VERIFICATION IN PROGRESS

### Critical Issues Found

#### 1. list_comments - 404 Error
- **Tool**: list_comments  
- **Endpoint**: `GET /buckets/{projectId}/recordings/{recordingId}/comments.json` ✅ CORRECT
- **Issue**: Recording ID 9520410782 returned 404
- **Possible Causes**:
  - Recording doesn't exist
  - User doesn't have access
  - Recording was deleted/trashed
- **Solution**: Add error handling and suggest using basecamp_raw to verify recording exists

#### 2. Need to Verify ALL Endpoints
Below is the comprehensive checklist:

## Tools Verification Matrix

| # | Tool | Endpoint | HTTP | Status | Notes |
|---|------|----------|------|--------|-------|
| 1 | startbcgpt | N/A | N/A | ✅ | Connection status |
| 2 | whoami | /people.json | GET | ❓ | Check if exposed |
| 3 | list_accounts | N/A | N/A | ✅ | Returns auth data |
| 4 | list_projects | /projects.json?per_page=100 | GET | ✅ | VERIFIED WORKING |
| 5 | find_project | /projects.json | GET | ✅ | Uses list_projects |
| 6 | daily_report | Multiple | GET | ✅ | Uses listAllOpenTodos |
| 7 | list_todos_due | Multiple | GET | ✅ | Uses listAllOpenTodos |
| 8 | search_todos | /search.json?q=X&type=Todo | GET | ✅ | VERIFIED WORKING (1584 results) |
| 9 | assignment_report | Multiple | GET | ❓ | NEEDS VERIFICATION |
| 10 | list_todos_for_project | /buckets/{id}/todosets/{id}/todolists.json | GET | ✅ | FIXED in earlier commit |
| 11 | create_todo | /buckets/{id}/todolists/{id}/todos.json | POST | ❓ | NEEDS VERIFICATION |
| 12 | complete_task_by_name | POST /buckets/{id}/todos/{id}/completion.json | POST | ❓ | NEEDS VERIFICATION |
| 13 | get_hill_chart | /buckets/{id}/hill_charts/{id}.json | GET | ❓ | NEEDS VERIFICATION |
| 14 | list_card_tables | /buckets/{id}/card_tables.json | GET | ❓ | NEEDS VERIFICATION |
| 15 | list_card_table_columns | /buckets/{id}/card_tables/{id}/columns.json | GET | ❓ | NEEDS VERIFICATION |
| 16 | list_card_table_cards | /buckets/{id}/card_tables/{id}/cards.json | GET | ❓ | NEEDS VERIFICATION |
| 17 | create_card | /buckets/{id}/card_tables/{id}/cards.json | POST | ❓ | NEEDS VERIFICATION |
| 18 | move_card | /buckets/{id}/card_tables/cards/{id}.json | PUT | ❓ | NEEDS VERIFICATION |
| 19 | list_message_boards | dock.url (message_board) | GET | ✅ | Uses dock |
| 20 | list_messages | board.messages_url | GET | ✅ | Uses dock-provided URL |
| 21 | list_documents | vault.documents_url | GET | ❓ | NEEDS VERIFICATION |
| 22 | list_uploads | /buckets/{id}/uploads.json | GET | ✅ | FIXED in earlier commit |
| 23 | list_schedule_entries | schedule.entries_url | GET | ✅ | Uses dock-provided URL |
| 24 | get_recordings | /recordings.json?type=X | GET | ❓ | NEEDS VERIFICATION |
| 25 | search_project | /search.json?q=X&bucket_id={id} | GET | ✅ | FIXED in latest commit |
| 26 | search_recordings | /search.json?q=X&type=Todo | GET | ✅ | VERIFIED WORKING (8 results) |
| 27 | list_all_people | /people.json | GET | ✅ | NEEDS VERIFICATION |
| 28 | get_my_profile | /my/profile.json | GET | ✅ | NEEDS VERIFICATION |
| 29 | list_project_people | /buckets/{id}/people.json | GET | ❓ | NEEDS VERIFICATION |
| 30 | get_person | /people/{id}.json | GET | ✅ | NEEDS VERIFICATION |
| 31 | list_comments | /buckets/{id}/recordings/{id}/comments.json | GET | ❌ | 404 ERROR (line 1486) |
| 32 | get_comment | /buckets/{id}/comments/{id}.json | GET | ❓ | NEEDS VERIFICATION |
| 33 | create_comment | /buckets/{id}/recordings/{id}/comments.json | POST | ❓ | NEEDS VERIFICATION |
| 34 | list_uploads | /buckets/{id}/uploads.json | GET | ✅ | FIXED |
| 35 | get_upload | /buckets/{id}/uploads/{id}.json | GET | ❓ | NEEDS VERIFICATION |
| 36 | list_vaults | /buckets/{id}/vaults.json | GET | ❓ | NEEDS VERIFICATION |
| 37 | get_recordings | /recordings.json?type=X | GET | ❓ | NEEDS VERIFICATION |
| 38 | trash_recording | /buckets/{id}/recordings/{id}/trash.json | DELETE/POST | ❓ | NEEDS VERIFICATION |
| 39 | archive_recording | /buckets/{id}/recordings/{id}/archive.json | POST | ❓ | NEEDS VERIFICATION |
| 40 | unarchive_recording | /buckets/{id}/recordings/{id}/unarchive.json | DELETE | ❓ | NEEDS VERIFICATION |
| 41 | basecamp_raw | Custom path | GET/POST/PUT/DELETE | ✅ | Pass-through endpoint |

---

## Action Items

### IMMEDIATE (Critical for functionality)
1. ✅ Verify list_comments error (recording_id validation)
2. ⬜ Check all GET /buckets/{id}/* endpoints
3. ⬜ Check all POST endpoints
4. ⬜ Verify recording-related endpoints (trash, archive, etc.)

### HIGH PRIORITY
- [ ] Audit 25+ endpoints that need verification
- [ ] Test each endpoint with real Basecamp data
- [ ] Verify all required parameters are being passed
- [ ] Check optional parameters handling

### MEDIUM PRIORITY
- [ ] Add better error messages for invalid IDs
- [ ] Add validation before making API calls
- [ ] Document which endpoints need dock lookups

---

## Testing Strategy

For each tool, we need to:
1. Verify endpoint path matches Basecamp 4 API docs
2. Verify HTTP method (GET/POST/PUT/DELETE)
3. Verify query parameters are correct
4. Verify request body structure
5. Verify response parsing is correct
6. Test with real data

---

## Next Steps

Run endpoint audit on all 41 tools to identify all problems at once.
