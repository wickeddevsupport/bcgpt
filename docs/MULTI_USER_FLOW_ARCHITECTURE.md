# Multi-User Flow System Architecture

## Problem Statement

**Original Issue**: Single API key creating all flows under one account with zero user isolation.

❌ **What Was Wrong**:
```
All Users → Global API Key → Single Activepieces Account → All Flows Mixed Together
   User A could see/modify User B's flows
   No tenant isolation
   Security nightmare
```

## Solution: Project-Based User Isolation

✅ **Proper Architecture**:
```
BCGPT User (userKey: "email:john@example.com")
    ↓ (mapped in database)
Activepieces Project (projectId: "abc123", name: "John's Workspace")
    ↓ (contains only)
John's Flows (isolated, secure)
```

## How It Works

### 1. User Identity

Each BCGPT user has a `userKey`:
- Format: `email:john@example.com` or `name:John Doe`
- Derived from Basecamp OAuth identity
- Persistent across sessions
- Used as primary key for all user-scoped data

### 2. Activepieces Project Mapping

**Database Table**: `activepieces_user_projects`
```sql
CREATE TABLE activepieces_user_projects (
  user_key TEXT PRIMARY KEY,           -- "email:john@example.com"
  project_id TEXT NOT NULL,            -- Activepieces project UUID
  project_name TEXT,                   -- "John's Workspace"
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
```

### 3. Auto-Provisioning Flow

When a user calls any `flow_*` tool:

```javascript
// 1. Extract user identity from request context
const userKey = ctx.userKey; // "email:john@example.com"

// 2. Check if user has an Activepieces project
let mapping = await getActivepiecesProject(userKey);

// 3. If not, auto-create one
if (!mapping) {
  const projectName = "John's Workspace";
  const newProject = await activepiecesAPI.createProject({ displayName: projectName });
  
  await setActivepiecesProject(userKey, newProject.id, projectName);
  mapping = { projectId: newProject.id, projectName };
}

// 4. Use user's project for all operations
const userProjectId = mapping.projectId;
```

### 4. Project-Scoped Operations

All flow tools are scoped to the user's project:

```javascript
// List only user's flows
GET /api/v1/flows?projectId={userProjectId}

// Create flow in user's project
POST /api/v1/flows
{ "projectId": "{userProjectId}", "displayName": "My Flow", ... }

// List user's connections
GET /api/v1/connections?projectId={userProjectId}
```

## API Key Usage

We still use **one global API key** (`ap_QT1mqiVpQ2ny7TZuPfRq2WVsSDGWJTIVDAdTzj_FUbg`) but:

✅ **Isolation happens at the Project level, not the API key level**

- The API key has permission to manage all projects
- Each user gets their own project
- All operations are scoped to the user's projectId
- Activepieces enforces project boundaries

This is similar to how AWS works:
- One "admin" API key (like AWS root credentials)
- Users isolated by resource tagging/scoping (like IAM policies)
- Application enforces the boundary (BCGPT ensures projectId filtering)

## Security Properties

### ✅ User Isolation
- User A cannot see User B's flows
- All queries filtered by projectId
- Database mapping prevents cross-user access

### ✅ Auto-Provisioning
- New users get projects automatically on first use
- Zero manual setup required
- Project naming based on user identity

### ✅ Audit Trail
- `created_at` / `updated_at` track project creation
- `user_key` → `project_id` mapping is persistent
- Can trace which BCGPT user owns which Activepieces project

### ✅ Data Ownership
- Each user's flows live in their dedicated project
- Deleting a BCGPT user can delete their Activepieces project
- Clear data ownership boundaries

## Implementation Details

### Modified Functions

**index.js**: `handleFlowTool(name, args, userKey)`
- Added `userKey` parameter (required)
- Auto-provisions Activepieces project if missing
- Passes `userProjectId` to all Activepieces API calls

**mcp.js**: `handleMCP(reqBody, ctx)`
- Extracts `userKey` from context
- Passes `userKey` to `handleFlowTool`

**db.postgres.js**: New functions
- `getActivepiecesProject(userKey)` → `{ projectId, projectName }`
- `setActivepiecesProject(userKey, projectId, projectName)`
- `clearActivepiecesProject(userKey)`

### Tool Behavior Changes

| Tool | Old Behavior | New Behavior |
|------|-------------|--------------|
| `flow_list` | Listed all flows globally | Lists only user's flows (`projectId` filter) |
| `flow_create` | Created in default project | Creates in user's project |
| `flow_connections_list` | Listed all connections | Lists only user's connections |
| `flow_status` | Showed global stats | Shows user's project stats |

### Project Naming Convention

```javascript
const projectName = `${userKey.replace(/^(email|name):/, '').split('@')[0]}'s Workspace`;
```

Examples:
- `email:john@example.com` → `"john's Workspace"`
- `name:Jane Doe` → `"jane doe's Workspace"`
- `email:admin@company.com` → `"admin's Workspace"`

## Testing the System

### 1. Test with Different Users

```bash
# User A (john@example.com)
curl -X POST https://bcgpt.wickedlab.io/mcp \
  -H "x-api-key: user_a_api_key" \
  -d '{"method": "tools/call", "params": {"name": "flow_status"}}'

# Response: projectId: "abc123", flows: 5

# User B (jane@example.com)  
curl -X POST https://bcgpt.wickedlab.io/mcp \
  -H "x-api-key": "user_b_api_key" \
  -d '{"method": "tools/call", "params": {"name": "flow_status"}}'

# Response: projectId: "xyz789", flows: 3 (different project!)
```

### 2. Verify Database Mapping

```sql
SELECT user_key, project_id, project_name, updated_at 
FROM activepieces_user_projects;

-- Results:
-- email:john@example.com | abc123 | john's Workspace | 1707...
-- email:jane@example.com | xyz789 | jane's Workspace | 1707...
```

### 3. Check Activepieces Projects

```bash
curl https://flow.wickedlab.io/api/v1/projects \
  -H "Authorization: Bearer ap_QT1mqiVpQ2ny7TZuPfRq2WVsSDGWJTIVDAdTzj_FUbg"

# Should see multiple projects, one per BCGPT user
```

## Future Enhancements

### 1. Project Deletion on User Removal
```javascript
async function deleteUser(userKey) {
  const mapping = await getActivepiecesProject(userKey);
  if (mapping) {
    await activepiecesAPI.deleteProject(mapping.projectId);
    await clearActivepiecesProject(userKey);
  }
}
```

### 2. Team Collaboration
- Shared projects for teams
- Project access control lists
- Invite users to projects

### 3. Usage Quotas
```javascript
const flowCount = await getFlowCount(userProjectId);
if (flowCount >= MAX_FLOWS_PER_USER) {
  throw new Error('Flow limit reached');
}
```

### 4. Project Transfer
```javascript
async function transferProject(fromUserKey, toUserKey) {
  const mapping = await getActivepiecesProject(fromUserKey);
  await setActivepiecesProject(toUserKey, mapping.projectId, mapping.projectName);
  await clearActivepiecesProject(fromUserKey);
}
```

## Migration Path

For existing single-user deployments:

1. **Identify current flows**: All existing flows are in the admin's project
2. **Create user mapping**: Map admin userKey to existing projectId
3. **Auto-provision new users**: New users get new projects automatically
4. **Optional migration**: Script to reassign flows to user projects if needed

```javascript
// One-time migration script
const adminUserKey = "email:admin@wickedlab.io";
const existingProjectId = "PcMAsmCcHkyc2jVf3worp"; // From old setup

await setActivepiecesProject(adminUserKey, existingProjectId, "Admin's Workspace");
console.log("Existing flows now mapped to admin user");
```

## Why Not User-Level API Keys?

**Alternative Approach**: Create one API key per BCGPT user

❌ **Problems**:
- API key management complexity (create, store, rotate N keys)
- Activepieces CE may have API key limits
- Additional database joins (userKey → apiKey → activepiecesUserId)
- Key rotation nightmare

✅ **Our Approach** (Project-scoping with one key):
- Single API key (simpler key management)
- Project-level isolation (Activepieces native concept)
- Clean architecture (one mapping table)
- Easier to audit and debug

## Summary

**Multi-Tenancy Strategy**: Project-based isolation with application-enforced scoping

- ✅ Each BCGPT user → One Activepieces project
- ✅ Auto-provisioning on first flow operation
- ✅ All tools scoped to userProjectId
- ✅ Database mapping ensures isolation
- ✅ One API key for simplicity
- ✅ Zero manual setup required

This architecture is secure, scalable, and follows SaaS best practices for multi-tenancy.
