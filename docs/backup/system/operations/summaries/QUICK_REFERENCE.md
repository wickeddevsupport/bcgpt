# ⚡ QUICK REFERENCE - Basecamp 4 API Endpoint Corrections

## What Was Fixed

| Issue | Old Endpoint | New Endpoint | Why |
|-------|-------------|--------------|-----|
| **TO-DOS** | `/buckets/{id}/todolists.json` | `/buckets/{id}/todosets/{tsId}/todolists.json` | Todolists are CHILDREN of todosets |
| **UPLOADS** | `/buckets/{id}/vaults/{id}/uploads.json` | `/buckets/{id}/uploads.json` | Uploads are directly under bucket |

## Error Symptoms
- 404 on `list_todos_for_project`
- No todos returning for projects
- "Basecamp API error (404)"

## Solution Applied
1. ✅ Fixed `listTodoLists()` to extract `todosetId` from project dock
2. ✅ Fixed `listUploads()` to use correct bucket-level endpoint
3. ✅ Added comprehensive API documentation

## Files Modified
```
mcp.js
├─ Line ~240: listTodoLists() function [FIXED]
└─ Line ~742: listUploads() function [FIXED]

NEW FILES:
├─ ENDPOINT_AUDIT.md (50+ endpoint reference)
├─ ENDPOINT_VALIDATION.js (validation script)
├─ FIX_SUMMARY.md (detailed explanation)
└─ VISUAL_FIX_SUMMARY.md (visual diagrams)
```

## Key Concept: THE DOCK
Every project has a `dock` array containing available features with their IDs:

```javascript
dock = [
  { name: "todoset", enabled: true, id: 1069479339 },  // ← Use this ID!
  { name: "message_board", enabled: true, id: 1069479338 },
  { name: "vault", enabled: true, id: 1069479340 },
  ...
]
```

**Always extract IDs from the dock, not from the projectId!**

## Testing
Test with real Basecamp data:
```
1. Call list_todos_for_project('Wicked Web HQ')
2. Should return todolists without 404 errors
3. Check logs for: "[listTodoLists] Using endpoint: /buckets/..."
4. Confirm todos array is populated
```

## Commits
```
6fda865 - Add comprehensive documentation
de8af6a - Fix critical API endpoints: todosets path and uploads endpoint
```

## Status
✅ **DEPLOYED TO PRODUCTION** (bcgpt.onrender.com)

All 404 errors should now be resolved!
