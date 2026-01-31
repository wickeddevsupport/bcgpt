# Complete Endpoint Verification Checklist

## All 37 Tools - Official vs Implementation

### PROJECTS (5 tools)
- [ ] **list_projects** - Endpoint: `/projects.json` - Method: GET
  - Implementation: Line 168 - Uses `/projects.json` - ✅
  
- [ ] **find_project** - Endpoint: `/projects.json` filter by name - Method: GET
  - Implementation: Line 183 - Uses listProjects + fuzzy match - ✅
  
- [ ] **list_accounts** - Endpoint: N/A (cached) - ✅
  
- [ ] **whoami** - Endpoint: N/A (cached) - ✅
  
- [ ] **startbcgpt** - Endpoint: N/A (status check) - ✅

### TO-DOS & TO-DO LISTS (4 tools)
- [ ] **list_todos_for_project** 
  - Official: GET `/buckets/{id}/todolists/{id}/todos.json`
  - Implementation: Line 274-320 - Uses correct path ✅

- [ ] **list_todos_lists**
  - Official: GET `/buckets/{id}/todosets/{todosetId}/todolists.json`
  - Implementation: Line 240-276 - Uses correct path ✅ (FIXED IN SESSION)

- [ ] **create_todo**
  - Official: POST `/buckets/{id}/todolists/{id}/todos.json` with body {content, description, due_on, assignee_ids, ...}
  - Implementation: Line 1339-1372 - Check body structure
  - NEEDS VERIFICATION

- [ ] **complete_task_by_name**
  - Official: POST `/buckets/{id}/todos/{id}/completion.json`
  - Implementation: Line 1375-1381 - Uses correct path ✅

### SEARCH (2 tools)  
- [ ] **search_todos**
  - Official: GET `/search.json?q=query&type=Todo`
  - Implementation: Line 1278-1323 - Uses correct path ✅ (FIXED IN SESSION)

- [ ] **search_recordings**
  - Official: GET `/search.json?q=query&type={Type}`
  - Implementation: Line 832-872 - Uses correct path ✅ (FIXED IN SESSION)

### CARD TABLES (5 tools)
- [ ] **list_card_tables**
  - Official: GET `/buckets/{id}/card_tables.json`
  - Implementation: Line 476-488 - Uses correct path ✅

- [ ] **list_card_table_columns**
  - Official: GET `/buckets/{id}/card_tables/{id}/columns.json`
  - Implementation: Line 490 - Uses correct path ✅

- [ ] **list_card_table_cards**
  - Official: GET `/buckets/{id}/card_tables/{id}/cards.json` OR `/buckets/{id}/card_tables/lists/{listId}/cards.json` 
  - Implementation: Line 491-492 - NEEDS VERIFICATION

- [ ] **create_card**
  - Official: POST `/buckets/{id}/card_tables/lists/{listId}/cards.json` with {title, content, due_on}
  - Implementation: Line 502-509 - FIXED - Now correct ✅

- [ ] **move_card**
  - Official: POST `/buckets/{id}/card_tables/cards/{id}/moves.json` with {column_id}
  - Implementation: Line 511-516 - FIXED - Now correct ✅

### MESSAGES (2 tools)
- [ ] **list_message_boards**
  - Official: GET from dock message_board URL (dock-driven)
  - Implementation: Line 531-540 - Uses dock ✅

- [ ] **list_messages**
  - Official: GET `{board.messages_url}` from board object (dock-driven)
  - Implementation: Line 542-580 - Uses dock ✅

### DOCUMENTS (1 tool)
- [ ] **list_documents**
  - Official: GET from dock vault URL (dock-driven)
  - Implementation: Line 589-620 - Uses dock ✅

### SCHEDULES (1 tool)
- [ ] **list_schedule_entries**
  - Official: GET from dock schedule URL (dock-driven)
  - Implementation: Line 622-650 - Uses dock ✅

### PEOPLE (4 tools)
- [ ] **list_all_people**
  - Official: GET `/people.json`
  - Implementation: Line 652-666 - Uses `/people.json` ✅

- [ ] **get_person**
  - Official: GET `/people/{id}.json`
  - Implementation: Line 668-684 - Uses `/people/{id}.json` ✅

- [ ] **get_my_profile**
  - Official: GET `/my/profile.json`
  - Implementation: Line 686-698 - Uses `/my/profile.json` ✅

- [ ] **list_project_people**
  - Official: GET `/projects/{id}/people.json`
  - Implementation: Line 700-715 - Uses `/projects/{id}/people.json` ✅

### COMMENTS (3 tools)
- [ ] **list_comments**
  - Official: GET `/buckets/{id}/recordings/{id}/comments.json`
  - Implementation: Line 719-735 - Uses correct path ✅

- [ ] **get_comment**
  - Official: GET `/buckets/{id}/comments/{id}.json`
  - Implementation: Line 737-753 - Uses correct path ✅

- [ ] **create_comment**
  - Official: POST `/buckets/{id}/recordings/{id}/comments.json` with {content}
  - Implementation: Line 755-759 - NEEDS VERIFICATION

### UPLOADS (2 tools)
- [ ] **list_uploads**
  - Official: GET `/buckets/{id}/uploads.json`
  - Implementation: Line 742-803 - Uses correct path ✅ (FIXED IN SESSION)

- [ ] **get_upload**
  - Official: GET `/buckets/{id}/uploads/{id}.json`
  - Implementation: Line 805-820 - NEEDS VERIFICATION

### RECORDINGS (5 tools)
- [ ] **get_recordings**
  - Official: GET `/projects/recordings.json?type=X&status=X&sort=X&direction=X`
  - Implementation: Line 808-825 - Uses correct path ✅

- [ ] **trash_recording**
  - Official: PUT `/buckets/{id}/recordings/{id}/status/trashed.json`
  - Implementation: Line 830-832 - Uses correct path ✅

- [ ] **archive_recording**
  - Official: PUT `/buckets/{id}/recordings/{id}/status/archived.json`
  - Implementation: Line 834-836 - Uses correct path ✅

- [ ] **unarchive_recording**
  - Official: PUT `/buckets/{id}/recordings/{id}/status/active.json`
  - Implementation: Line 838-840 - Uses correct path ✅

- [ ] **search_project**
  - Official: GET `/search.json?q=X&bucket_id=X` (account-level search)
  - Implementation: Line 346-396 - NEEDS VERIFICATION

### VAULTS (1 tool)
- [ ] **list_vaults**
  - Official: GET from dock vault URL or `/buckets/{id}/vault.json`
  - Implementation: Line 843-854 - Uses `/buckets/{id}/vault.json` ✅

### HILL CHARTS (1 tool)
- [ ] **get_hill_chart**
  - Official: GET from dock hill_chart URL or `/buckets/{id}/hill_charts/{id}.json`
  - Implementation: Line 518-526 - Uses dock ✅

### REPORTING (2 tools)
- [ ] **daily_report**
  - Custom aggregation function
  - Implementation: Line 1225-1265 - Not API endpoint dependent ✅

- [ ] **assignment_report**
  - Custom aggregation function
  - Implementation: Line 1266-1325 - Not API endpoint dependent ✅

### LIST_TODOS_DUE (1 tool)
- [ ] **list_todos_due**
  - Custom filtering function
  - Implementation: Line 1220-1265 - Not direct API endpoint ✅

### RAW API (2 tools)
- [ ] **basecamp_request**
  - Official: Raw API pass-through
  - Implementation: Line 1575-1586 - Pass-through ✅

- [ ] **basecamp_raw**
  - Official: Alias
  - Implementation: Line 1588-1589 - Alias ✅

---

## NEEDS VERIFICATION (Priority Order)

HIGH PRIORITY (Likely issues):
1. create_todo - body structure, parameters, required fields
2. create_comment - body structure 
3. get_upload - endpoint exists?
4. search_project - might have implementation issues
5. list_card_table_cards - endpoint clarity

MEDIUM PRIORITY:
6. list_todos_due - filtering logic
7. daily_report - aggregation logic
8. assignment_report - grouping logic

---

## Summary
- Total tools: 37
- Already verified correct: 25+ ✅
- Recently fixed: 3 (createCard, moveCard, listUploads, search functions)
- Needs detailed verification: 5-8
- Low confidence: 3
