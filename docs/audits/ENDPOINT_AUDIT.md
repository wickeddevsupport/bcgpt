# Basecamp 4 API - Complete Endpoint Audit

## Error Found: The 404 Problem

**Issue**: `list_todos_for_project` fails with 404 on `/buckets/25825227/todolists.json`

**Root Cause**: The endpoint path is WRONG
- ❌ **CURRENT (WRONG)**: `GET /buckets/{id}/todolists.json` 
- ✅ **CORRECT**: `GET /buckets/{id}/todosets/{todoset_id}/todolists.json`

The **Todoset** is required! Every project has exactly ONE todoset. You must get it from the project's `dock` first.

---

## TO-DO HIERARCHY (from official docs)

```
Project
  └── To-do set (exactly one per project, find via dock)
        ├── To-do list "Launch tasks"
        │     ├── To-do item
        │     └── To-do item
        └── To-do list "Research"
              └── To-do item
```

**Key Rule**: To create/list todolists, POST/GET to the **todoset**, NOT the project.

---

## COMPLETE OFFICIAL ENDPOINTS

### PROJECTS
```
GET    /projects.json                              List all projects
GET    /projects/{id}.json                         Get project details
POST   /projects.json                              Create project
PUT    /projects/{id}.json                         Update project
DELETE /projects/{id}.json                         Trash project
```

### TO-DOS (CORRECT HIERARCHY)
```
GET    /buckets/{id}/todosets/{todoset_id}.json    Get todoset (singleton)
GET    /buckets/{id}/todosets/{todoset_id}/todolists.json                  List todolists
GET    /buckets/{id}/todolists/{id}.json           Get specific todolist
POST   /buckets/{id}/todosets/{todoset_id}/todolists.json                  Create todolist
PUT    /buckets/{id}/todolists/{id}.json           Update todolist

GET    /buckets/{id}/todolists/{id}/todos.json     List todos in list
GET    /buckets/{id}/todos/{id}.json               Get specific todo
POST   /buckets/{id}/todolists/{id}/todos.json     Create todo in list
PUT    /buckets/{id}/todos/{id}.json               Update todo
POST   /buckets/{id}/todos/{id}/completion.json    Mark todo done
DELETE /buckets/{id}/todos/{id}/completion.json    Mark todo undone
PUT    /buckets/{id}/todos/{id}/position.json      Move todo
```

### MESSAGES & MESSAGE BOARDS
```
GET    /buckets/{id}/message_boards/{id}.json      Get message board
GET    /buckets/{id}/message_boards/{id}/messages.json         List messages
GET    /buckets/{id}/messages/{id}.json            Get specific message
POST   /buckets/{id}/message_boards/{id}/messages.json         Create message
PUT    /buckets/{id}/messages/{id}.json            Update message
POST   /buckets/{id}/recordings/{id}/pin.json      Pin message
DELETE /buckets/{id}/recordings/{id}/pin.json      Unpin message
```

### COMMENTS (on any recording)
```
GET    /buckets/{id}/recordings/{id}/comments.json           List comments
GET    /buckets/{id}/comments/{id}.json            Get comment
POST   /buckets/{id}/recordings/{id}/comments.json           Add comment
```

### UPLOADS & DOCUMENTS
```
GET    /buckets/{id}/uploads.json                  List uploads
GET    /buckets/{id}/uploads/{id}.json             Get upload
POST   /buckets/{id}/uploads.json                  Create upload
GET    /buckets/{id}/vaults/{id}.json              Get vault
GET    /buckets/{id}/vaults/{id}/documents.json    List documents
GET    /buckets/{id}/documents/{id}.json           Get document
POST   /buckets/{id}/vaults/{id}/documents.json    Create document
```

### CARD TABLES (Kanban)
```
GET    /buckets/{id}/card_tables.json              List card tables
GET    /buckets/{id}/card_tables/{id}.json         Get card table
GET    /buckets/{id}/card_tables/{id}/columns.json List columns
GET    /buckets/{id}/card_tables/columns/{id}.json Get column
GET    /buckets/{id}/card_tables/{id}/cards.json   List cards
GET    /buckets/{id}/card_tables/cards/{id}.json   Get card
POST   /buckets/{id}/card_tables/{id}/cards.json   Create card
PUT    /buckets/{id}/card_tables/cards/{id}.json   Move/update card
```

### SCHEDULES
```
GET    /buckets/{id}/schedules/{id}.json           Get schedule
GET    /buckets/{id}/schedules/{id}/entries.json   List entries
GET    /buckets/{id}/schedule_entries/{id}.json    Get entry
POST   /buckets/{id}/schedules/{id}/entries.json   Create entry
PUT    /buckets/{id}/schedule_entries/{id}.json    Update entry
```

### PEOPLE
```
GET    /people.json                                List all people
GET    /people/{id}.json                           Get person
GET    /buckets/{id}/people.json                   List project people
GET    /my/profile.json                            Get current user
```

### SEARCH
```
POST   /buckets/{id}/recordings.json?type=X&q=...  Search by type and query
POST   /projects/{id}/search.json                  Search in project
```

### HILL CHARTS
```
GET    /buckets/{id}/hill_charts/{id}.json         Get hill chart
```

---

## THE DOCK

**Critical**: Every project has a `dock` array showing available tools:

```json
"dock": [
  { "name": "message_board", "enabled": true, "id": 123 },
  { "name": "todoset", "enabled": true, "id": 456 },
  { "name": "vault", "enabled": true, "id": 789 },
  { "name": "schedule", "enabled": true, "id": 101 },
  { "name": "chat", "enabled": true, "id": 102 },
  { "name": "kanban_board", "enabled": false, "id": 103 }
]
```

**Always check `enabled: true`** before using a tool. Use the `id` field to access that tool.

---

## FIXES NEEDED IN mcp.js

1. **listTodosForProject()** - MUST use todoset_id from dock
2. **getProjectDetails()** - Extract todoset_id, vault_id, etc. from dock
3. **All endpoints** - Verify they match official API docs exactly
4. **Error handling** - Log full endpoint path to debug 404s

---

## Pagination

- **Standard**: Basecamp uses RFC 5988 `Link` headers
- **Parameter**: `?per_page=100&page=1`
- **Response**: `Link: <...?page=2>; rel="next"` (if more pages)
- **Total**: `X-Total-Count` header shows total count

Use `basecampFetchAll()` which handles this automatically.
