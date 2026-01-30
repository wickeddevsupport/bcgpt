# 🎯 ENDPOINT FIXES - VISUAL SUMMARY

## The Problem
```
[MCP] Tool called: list_todos_for_project { args: { project: 'Wicked Web HQ' }, ... }
[apiAll] Using ctx.basecampFetchAll for: /buckets/25825227/todolists.json
[MCP] Error in tool call: {
  name: 'list_todos_for_project',
  error: 'Basecamp API error (404)',  ❌ 404 NOT FOUND
  code: 'BASECAMP_API_ERROR'
}
```

## The Root Cause
```
❌ WRONG:  GET /buckets/{projectId}/todolists.json
           └─ This endpoint doesn't exist in Basecamp 4 API!

✅ RIGHT:  GET /buckets/{projectId}/todosets/{todosetId}/todolists.json
           ├─ Project has ONE todoset (found via dock)
           ├─ Todosets contain todolists
           └─ Each todolist contains todos
```

## The Fix Applied
```
FIX #1 - listTodoLists() function
═══════════════════════════════════════════════════════════════
OLD ENDPOINT: /buckets/{projectId}/todolists.json ❌
NEW ENDPOINT: /buckets/{projectId}/todosets/{todosetId}/todolists.json ✅

WHAT IT DOES:
1. Gets the project's dock (configuration of available tools)
2. Finds the "todoset" entry in the dock (name: "todoset")
3. Extracts the todoset ID from that dock entry
4. Uses it to build the CORRECT endpoint path
5. Now returns all todolists without 404s

FIX #2 - listUploads() function
═══════════════════════════════════════════════════════════════
OLD ENDPOINT: /buckets/{projectId}/vaults/{vaultId}/uploads.json ❌
NEW ENDPOINT: /buckets/{projectId}/uploads.json ✅

REASON: Uploads are directly under bucket, not nested in vaults
```

## Basecamp 4 API Hierarchy
```
PROJECT (bucket)
├── TODOSET (singleton - exactly ONE)
│   ├── TODOLIST "Marketing"
│   │   ├── TODO: Design homepage
│   │   └── TODO: Write copy
│   └── TODOLIST "Backend"
│       ├── TODO: Setup database
│       └── TODO: API endpoints
│
├── MESSAGE BOARD
│   ├── MESSAGE: Project kickoff
│   └── MESSAGE: Status update
│
├── VAULT (file storage)
│   ├── FOLDER: Documents
│   │   └── FILE: proposal.pdf
│   └── UPLOAD: logo.png
│
└── SCHEDULE
    ├── ENTRY: Design phase (Jan 1-15)
    └── ENTRY: Dev phase (Jan 16-31)
```

## The Dock Pattern
```javascript
// Every project has a "dock" - your map to available features
const dock = [
  { 
    name: "todoset",      // ← This is what we need!
    enabled: true,
    id: 1069479339,       // ← This is the todoset_id!
    title: "To-dos",
    url: "https://3.basecampapi.com/.../todosets/1069479339.json"
  },
  { 
    name: "message_board",
    enabled: true,
    id: 1069479338,
    title: "Message Board",
    url: "https://3.basecampapi.com/.../message_boards/1069479338.json"
  },
  { 
    name: "vault",
    enabled: true,
    id: 1069479340,
    title: "Docs & Files",
    url: "https://3.basecampapi.com/.../vaults/1069479340.json"
  }
  // ... more tools ...
];

// USAGE:
// 1. Get dock: const dock = await getDock(ctx, projectId);
// 2. Find feature: const todosDock = dockFind(dock, ["todoset", ...]);
// 3. Get ID: const todosetId = todosDock.id;
// 4. Build endpoint: `/buckets/${projectId}/todosets/${todosetId}/todolists.json`
```

## Deployment Status
```
✅ Code Fixed
   ├─ mcp.js (listTodoLists - 37 lines)
   ├─ mcp.js (listUploads - 1 line)
   └─ No syntax errors

✅ Documentation Added
   ├─ ENDPOINT_AUDIT.md (50+ endpoints documented)
   ├─ ENDPOINT_VALIDATION.js (validation helper)
   └─ FIX_SUMMARY.md (this summary)

✅ Committed to Git
   └─ Commit: de8af6a "Fix critical API endpoints: todosets path and uploads endpoint"

✅ Deployed to Production
   └─ bcgpt.onrender.com (auto-deployed)

✅ Git Log Shows:
   de8af6a (HEAD -> main, origin/main) Fix critical API endpoints
   efeed44 Optimize OpenAPI spec to 30 operations
   b27f375 Add 11 new endpoints to OpenAPI schema
   f8350dd Add 10+ new Basecamp API tools + wire search indexing
```

## Expected Behavior After Fix
```
BEFORE FIX:
list_todos_for_project('Wicked Web HQ')
  └─ [ERROR] 404 on /buckets/25825227/todolists.json ❌

AFTER FIX:
list_todos_for_project('Wicked Web HQ')
  ├─ Get dock for project
  ├─ Find todoset: id = 1069479339
  ├─ Call: GET /buckets/25825227/todosets/1069479339/todolists.json
  ├─ ✅ Success! Returns: [
  │   { id: 1, name: "Tasks", todos_count: 5 },
  │   { id: 2, name: "Blocked", todos_count: 2 }
  │ ]
  └─ [SUCCESS] No 404 errors! ✅
```

## Key Takeaway
**Always use the dock as your source of truth for IDs and URLs.**

The Basecamp API is deeply hierarchical - you can't just use projectId everywhere. The dock tells you:
1. What features are available
2. What IDs to use for each feature
3. Sometimes, the exact URL to call

Follow the dock → Use correct IDs → Use official endpoint paths → Get data without 404s ✅
