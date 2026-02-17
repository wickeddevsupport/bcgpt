# Workspace Isolation Status

**Last Updated:** 2026-02-17
**Related:** [`OPENCLAW_AUTOMATION_OS.md`](OPENCLAW_AUTOMATION_OS.md)

---

## Overview

OpenClaw implements multi-tenant workspace isolation to ensure each user's data is completely separated. This document tracks the implementation status of workspace isolation across all system components.

---

## User Types and Capabilities

### Role Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                      super_admin                             │
│  - First user to sign up                                     │
│  - Can see ALL workspaces                                    │
│  - Can switch between workspaces                             │
│  - Can manage all users                                      │
│  - Has shell access (if needed)                              │
│  - Global configuration access                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    workspace_admin                           │
│  - Any user who signs up after super_admin                   │
│  - Can only see THEIR workspace                              │
│  - Full control within their workspace                       │
│  - Can create agents, workflows, cron jobs                   │
│  - Can manage their own AI keys (BYOK)                       │
│  - NO shell access                                           │
└─────────────────────────────────────────────────────────────┘
```

### What Each User Gets

| Resource | super_admin | workspace_admin |
|----------|-------------|-----------------|
| **Workspace** | Can see all | One only (their own) |
| **Agents** | All workspaces | Their workspace only |
| **Workflows** | All workspaces | Their workspace only |
| **Cron Jobs** | All workspaces | Their workspace only |
| **Sessions** | All workspaces | Their workspace only |
| **AI Keys** | Global + per-workspace | Their workspace only |
| **Shell Access** | Yes | No |
| **Config Access** | Global + all workspaces | Their workspace only |

### User Journey: New Signup

```
1. User signs up with email
   └─▶ System checks: Is this the first user?
       ├─ YES → Assign role: super_admin
       │        Create workspace: {userId}-workspace
       │        Assign workspaceId to user
       │
       └─ NO  → Assign role: workspace_admin
                Create workspace: {userId}-workspace
                Assign workspaceId to user

2. User logs in
   └─▶ Session created with workspaceId
   └─▶ All subsequent requests filtered by workspaceId

3. User creates resources
   └─▶ All resources tagged with user's workspaceId
   └─▶ Other users cannot see or access these resources
```

### Data Isolation Example

```
User A (workspace: ws-aaa-111)
├── Agents: sales-agent, support-agent
├── Workflows: daily-report, weekly-summary
├── Cron Jobs: 9am-reminder, 5pm-cleanup
└── Sessions: session-1, session-2

User B (workspace: ws-bbb-222)
├── Agents: dev-agent, pm-agent
├── Workflows: github-sync, slack-notify
├── Cron Jobs: hourly-check
└── Sessions: session-3, session-4

User A CANNOT see User B's data.
User B CANNOT see User A's data.
super_admin CAN see both.
```

---

## Architecture Decision

### Chosen Pattern: Row-Level Tenancy

Each entity has a `workspaceId` field, and all queries filter by `client.pmosWorkspaceId`.

**Why this pattern:**
- Industry standard (Stripe, Slack, GitHub use this)
- Simple to implement with current file-based storage
- Easy to query across workspaces for super_admin
- Single data layer, no complex routing

---

## Implementation Status

### Summary

| Component | Status | Workspace Filtering | Notes |
|-----------|--------|---------------------|-------|
| Auth System | COMPLETE | N/A | Assigns workspaceId on signup |
| Agents | COMPLETE | YES | Full CRUD with workspace isolation |
| Cron Jobs | COMPLETE | YES | Full CRUD with workspace isolation |
| Sessions | COMPLETE | YES | All ops filtered via agent workspace ownership |
| Configs | PENDING | NO | Needs workspace-scoped storage |
| Connectors | PENDING | NO | Needs workspace-scoped API keys |
| Chat | PARTIAL | YES | Uses agent workspace ownership |

### Status Legend

- **COMPLETE** - Fully implemented and tested
- **PARTIAL** - Some functionality implemented
- **PENDING** - Not yet implemented
- **N/A** - Not applicable

---

## Detailed Status

### Auth System - COMPLETE

**Files:** [`openclaw/src/gateway/pmos-auth.ts`](../openclaw/src/gateway/pmos-auth.ts)

| Feature | Status |
|---------|--------|
| Signup with workspaceId assignment | COMPLETE |
| Login with session creation | COMPLETE |
| Logout with session clearing | COMPLETE |
| Role bootstrap (first = super_admin) | COMPLETE |
| Session validation middleware | COMPLETE |

**Implementation:**
```typescript
// On signup, each user gets a unique workspaceId
const workspaceId = crypto.randomUUID();
const user = {
  id: crypto.randomUUID(),
  email,
  role: isFirstUser ? "super_admin" : "workspace_admin",
  workspaceId,
};
```

### Agents - COMPLETE

**Files:** [`openclaw/src/gateway/server-methods/agents.ts`](../openclaw/src/gateway/server-methods/agents.ts)

| Feature | Status |
|---------|--------|
| agents.list filters by workspace | COMPLETE |
| agents.create adds workspaceId | COMPLETE |
| agents.update checks ownership | COMPLETE |
| agents.delete checks ownership | COMPLETE |
| Rate limiting per workspace | COMPLETE |
| Audit logging | COMPLETE |

**Implementation:**
```typescript
// From agents.ts
"agents.list": ({ params, respond, client }) => {
  const cfg = loadConfig();
  const result = listAgentsForGateway(cfg);
  
  // Apply workspace filtering for PMOS multi-tenant isolation
  if (client && !isSuperAdmin(client)) {
    const filteredAgents = filterByWorkspace(result.agents, client);
    respond(true, { ...result, agents: filteredAgents }, undefined);
    return;
  }
  
  respond(true, result, undefined);
},
```

### Cron Jobs - COMPLETE

**Files:** [`openclaw/src/gateway/server-methods/cron.ts`](../openclaw/src/gateway/server-methods/cron.ts)

| Feature | Status |
|---------|--------|
| cron.list filters by workspace | COMPLETE |
| cron.add sets workspaceId from client | COMPLETE |
| cron.update checks ownership | COMPLETE |
| cron.remove checks ownership | COMPLETE |
| cron.run checks ownership | COMPLETE |
| cron.runs checks ownership | COMPLETE |

### Sessions - COMPLETE

**Files:** [`openclaw/src/gateway/server-methods/sessions.ts`](../openclaw/src/gateway/server-methods/sessions.ts)

| Feature | Status |
|---------|--------|
| sessions.list filters by agent workspace | COMPLETE |
| sessions.preview checks agent ownership | COMPLETE |
| sessions.resolve checks agent ownership | COMPLETE |
| sessions.patch checks agent ownership | COMPLETE |
| sessions.reset checks agent ownership | COMPLETE |
| sessions.delete checks agent ownership | COMPLETE |
| sessions.compact checks agent ownership | COMPLETE |

**Implementation:** Sessions are scoped via their parent agent's `workspaceId`. Non-super-admin users can only access sessions belonging to agents in their workspace.

### Configs - PENDING

**Files:** [`openclaw/src/config/`](../openclaw/src/config/)

| Feature | Status |
|---------|--------|
| Workspace-specific config files | PENDING |
| Config merge strategy | PENDING |
| Super admin global config | PENDING |

**Proposed Structure:**
```
~/.openclaw/
  config.json              # Global config (super_admin only)
  workspaces/
    {workspaceId}/
      config.json          # Workspace-specific config
```

### Connectors - PENDING

**Files:** [`openclaw/src/gateway/workspace-connectors.ts`](../openclaw/src/gateway/workspace-connectors.ts)

| Feature | Status |
|---------|--------|
| Workspace-scoped API keys | PENDING |
| Connector list filters by workspace | PENDING |
| Per-workspace n8n projects | COMPLETE |

---

## Workspace Context API

**File:** [`openclaw/src/gateway/workspace-context.ts`](../openclaw/src/gateway/workspace-context.ts)

### Available Functions

```typescript
// Get workspace ID from client
getWorkspaceId(client: GatewayClient): string | undefined

// Require workspace ID (throws if missing)
requireWorkspaceId(client: GatewayClient): string

// Check if resource belongs to client's workspace
isWorkspaceOwned(client: GatewayClient, resourceWorkspaceId?: string): boolean

// Require ownership (throws if not owned)
requireWorkspaceOwnership(
  client: GatewayClient,
  resourceWorkspaceId?: string,
  resourceType?: string
): void

// Filter array by workspace
filterByWorkspace<T extends { workspaceId?: string }>(
  items: T[],
  client: GatewayClient
): T[]

// Add workspaceId to new resource
addWorkspaceId<T extends Record<string, unknown>>(
  resource: T,
  client: GatewayClient
): T & { workspaceId?: string }

// Check if client is super admin
isSuperAdmin(client: GatewayClient): boolean

// Get effective workspace (super admin can target specific workspace)
getEffectiveWorkspaceId(
  client: GatewayClient,
  targetWorkspaceId?: string
): string | undefined
```

---

## Testing

### Test Files

| File | Purpose |
|------|---------|
| [`openclaw/src/gateway/pmos-auth.test.ts`](../openclaw/src/gateway/pmos-auth.test.ts) | Auth tests |
| [`openclaw/src/gateway/server-methods.pmos-role.test.ts`](../openclaw/src/gateway/server-methods.pmos-role.test.ts) | Role tests |
| [`openclaw/src/gateway/workspace-connectors.test.ts`](../openclaw/src/gateway/workspace-connectors.test.ts) | Connector tests |

### Required Tests

- [ ] Cross-workspace data leakage tests
- [ ] User A cannot see User B's agents
- [ ] User A cannot modify User B's agents
- [ ] User A cannot see User B's cron jobs
- [ ] User A cannot see User B's sessions
- [ ] Super admin can see all workspaces

---

## Migration

### Migration Script

**File:** [`openclaw/scripts/migrate-workspace-isolation.ts`](../openclaw/scripts/migrate-workspace-isolation.ts)

**Purpose:** Assign existing data to appropriate workspace

**Strategy:**
1. Get super_admin's workspaceId
2. Assign all existing agents, cron jobs, sessions to super_admin's workspace
3. Or create a "default" workspace and assign everything there it

---

## Super Admin Experience

### Capabilities

Super admins have special privileges:

| Capability | Implementation |
|------------|----------------|
| View all workspaces | `isSuperAdmin()` check bypasses filtering |
| Manage all workspaces | Admin panel toggle |
| Switch between workspaces | Workspace switcher UI |
| Global config access | Can edit global config |

### Admin View Pattern

```typescript
// Super admin can optionally see all workspaces
if (isSuperAdmin(client) && client.adminViewEnabled) {
  // Return all data, no filtering
  return items;
}
// Otherwise, filter by workspace
return filterByWorkspace(items, client);
```

---

## UI Differences: super_admin vs workspace_admin

### Dashboard Comparison

#### workspace_admin (Regular User) Dashboard

```
+----------------------------------------------------------+
|  Good morning, John!                                      |
+----------------------------------------------------------+
|                                                           |
|  [What can I help you with?                    ] [Ask]    |
|                                                           |
|  Your AI Team Today                                       |
|  ---------------------                                     |
|  Sales Agent: 3 hot leads waiting                         |
|  Dev Agent:  1 PR ready for merge                         |
|  PM Agent:   Weekly report generated                      |
|                                                           |
|  [View All Activity]                                      |
|                                                           |
+----------------------------------------------------------+
```

#### super_admin Dashboard

```
+----------------------------------------------------------+
|  Admin Dashboard                              [Admin Mode] |
+----------------------------------------------------------+
|                                                           |
|  Workspace Overview                                       |
|  -----------------                                        |
|  Total Workspaces: 12                                     |
|  Total Users: 45                                          |
|  Total Agents: 89                                         |
|  Active Workflows: 234                                    |
|                                                           |
|  Recent Workspaces:                                       |
|  - Acme Corp (5 users, 12 agents)    [View] [Manage]     |
|  - TechStart (3 users, 8 agents)     [View] [Manage]     |
|  - DesignLab (2 users, 5 agents)     [View] [Manage]     |
|                                                           |
|  System Health:                                           |
|  - API Response: 45ms                                     |
|  - n8n Queue: 12 pending                                  |
|  - Memory: 62% used                                       |
|                                                           |
|  [Switch to User View]  [System Settings]                 |
|                                                           |
+----------------------------------------------------------+
```

### Navigation Differences

#### workspace_admin Navigation

```
Sidebar:
- Dashboard
- Agents
- Workflows
- Connections
- Settings (My workspace only)
```

#### super_admin Navigation

```
Sidebar:
- Admin Dashboard
- All Workspaces
- All Users
- All Agents
- All Workflows
- System Settings
- Switch to User View
  - Dashboard (as specific user)
  - Agents (as specific user)
  - etc.
```

### Settings Page Differences

#### workspace_admin Settings

```
+----------------------------------------------------------+
|  Settings                                                 |
+----------------------------------------------------------+
|                                                           |
|  [Profile] [Connections] [AI Keys] [Notifications]        |
|                                                           |
|  Profile                                                  |
|  --------                                                 |
|  Name: John Doe                                           |
|  Email: john@acme.com                                     |
|  Role: workspace_admin                                    |
|  Workspace: Acme Corp                                     |
|                                                           |
|  [Edit Profile]                                           |
|                                                           |
+----------------------------------------------------------+
```

#### super_admin Settings

```
+----------------------------------------------------------+
|  Admin Settings                                           |
+----------------------------------------------------------+
|                                                           |
|  [Profile] [Workspaces] [Users] [System] [Security]       |
|                                                           |
|  Workspaces                                               |
|  ----------                                               |
|  Manage all workspaces in the system.                     |
|                                                           |
|  +----------------------------------------------------+  |
|  | Acme Corp                                          |  |
|  | Users: 5 | Agents: 12 | Status: Active             |  |
|  | [View] [Edit] [Suspend] [Delete]                   |  |
|  +----------------------------------------------------+  |
|                                                           |
|  +----------------------------------------------------+  |
|  | TechStart                                          |  |
|  | Users: 3 | Agents: 8 | Status: Active              |  |
|  | [View] [Edit] [Suspend] [Delete]                   |  |
|  +----------------------------------------------------+  |
|                                                           |
|  [+ Create Workspace]                                      |
|                                                           |
+----------------------------------------------------------+
```

### Agent Management Differences

#### workspace_admin View

```
Agents Page:
- Shows only their workspace's agents
- Can create/edit/delete their own agents
- Cannot see other workspaces' agents
```

#### super_admin View

```
Agents Page:
- Can see ALL agents across ALL workspaces
- Can filter by workspace
- Can manage any agent
- Can reassign agents between workspaces
- Has "Impersonate Agent" capability for debugging
```

### Workflow Management Differences

#### workspace_admin View

```
Workflows Page:
- Shows only their workspace's workflows
- Can create/edit/delete their own workflows
- Cannot see other workspaces' workflows
- Limited to their workspace's connections
```

#### super_admin View

```
Workflows Page:
- Can see ALL workflows across ALL workspaces
- Can filter by workspace, status, trigger type
- Can pause/resume any workflow
- Can view execution logs across all workspaces
- Can create global templates
```

### Feature Access Matrix

| Feature | workspace_admin | super_admin |
|---------|-----------------|-------------|
| Create Agents | Yes (own workspace) | Yes (any workspace) |
| Create Workflows | Yes (own workspace) | Yes (any workspace) |
| View All Workspaces | No | Yes |
| Manage Users | No | Yes |
| System Settings | No | Yes |
| API Keys | Own workspace only | All workspaces |
| Execution Logs | Own workspace only | All workspaces |
| Shell Access | No | Yes |
| Audit Logs | No | Yes |
| Create Workspaces | No | Yes |
| Delete Workspaces | No | Yes |
| Suspend Users | No | Yes |

### Admin Mode Toggle

super_admin can switch between admin view and user view:

```
+----------------------------------------------------------+
|  Admin Mode Toggle                                        |
+----------------------------------------------------------+
|                                                           |
|  Current Mode: [Admin View v]                             |
|                                                           |
|  Options:                                                 |
|  - Admin View (see all workspaces)                        |
|  - User View (act as specific user)                       |
|                                                           |
|  When in User View:                                       |
|  Workspace: [Select Workspace v]                          |
|  Act as: [Select User v]                                  |
|                                                           |
|  [Apply]                                                  |
|                                                           |
+----------------------------------------------------------+
```

This allows super_admin to:
1. See the system from a regular user's perspective
2. Debug issues in specific workspaces
3. Help users without switching accounts

---

## Implementation Checklist

### Phase 1: Core Infrastructure
- [x] Create workspace context helpers
- [x] Add workspaceId to agent config schema
- [x] Add workspaceId to cron job schema
- [x] Write migration script
- [ ] Run migration on dev environment

### Phase 2: Server Method Updates
- [x] Update all `agents.*` methods to filter by workspace
- [x] Update all `cron.*` methods to filter by workspace
- [x] Update all `sessions.*` methods to filter by workspace
- [ ] Update chat methods to enforce workspace-owned agents
- [ ] Add workspace config system

### Phase 3: Testing
- [x] Write workspace isolation unit tests
- [x] Write cross-workspace leakage tests
- [ ] Write E2E smoke tests for multi-user scenarios
- [ ] All tests passing

### Phase 4: Super Admin & Deploy
- [ ] Add super admin workspace switcher UI
- [ ] Add admin panel toggle
- [ ] Deploy to staging and smoke test
- [ ] Deploy to production
- [ ] Verify isolation in production

---

## Rollback Plan

If isolation breaks production:

1. Revert to previous deployment (before workspace filtering)
2. All users will see shared data again (safe but not isolated)
3. Fix issue in isolation logic
4. Redeploy with fix

**Rollback is safe because:**
- We're only adding filters, not changing storage format
- Worst case: users see too much data (not too little)
- No data loss risk

---

## Success Metrics

After deployment:

- [ ] Zero cross-workspace data leakage incidents
- [ ] All workspace isolation tests passing in CI
- [ ] Super admin can manage all workspaces
- [ ] New signups get isolated workspace automatically
- [ ] No user reports seeing other users' data
