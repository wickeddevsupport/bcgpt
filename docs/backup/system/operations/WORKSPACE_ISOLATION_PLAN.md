# Workspace Isolation Implementation Plan

**Created:** 2026-02-17
**Status:** Design Phase
**Priority:** CRITICAL (blocking M2-M5)

## 1. Executive Summary

PMOS currently has auth and role assignment but **zero workspace isolation**. All users share the same data pool (agents, cron jobs, sessions, configs, connectors). This document defines a world-class multi-tenant isolation strategy.

## 2. Current State Audit

### ✅ What Works
- Auth system (signup/login/logout)
- Role bootstrap (first user = super_admin, rest = workspace_admin)
- Shell restriction (super_admin only)
- workspaceId assigned to each user on signup

### ❌ What's Broken
- **No data filtering by workspaceId** anywhere in the codebase
- All `agents.list`, `cron.list`, `sessions.list` queries return global data
- User A can see and modify User B's agents, flows, sessions
- workspaceId field exists but is completely unused

**Files needing changes:**
- `openclaw/src/gateway/server-methods/agents.ts` (all handlers)
- `openclaw/src/gateway/server-methods/cron.ts` (all handlers)
- `openclaw/src/gateway/server-methods/sessions.ts` (all handlers)
- `openclaw/src/gateway/server-methods/chat.ts` (all handlers)
- Config system (needs workspace-scoped storage)
- Connector/integration system (needs workspace scoping)

## 3. Multi-Tenant Architecture Decision

### Option A: Row-Level Tenancy (RECOMMENDED)
**Pattern:** Add `workspaceId` field to every entity, filter all queries by `client.pmosWorkspaceId`.

**Pros:**
- Simple to implement with current file-based storage
- Easy to query across workspaces for super_admin
- Single data layer, no complex routing
- Industry standard (Stripe, Slack, GitHub all use this)

**Cons:**
- Must remember to add workspace filter to every query (risk of bugs)
- Shared file system (but we already have this)

**Verdict:** ✅ **USE THIS** - best fit for OpenClaw's architecture

### Option B: Schema-Per-Tenant
**Pattern:** Separate directory structure per workspace.

**Pros:**
- Physical isolation at filesystem level
- Harder to accidentally leak data

**Cons:**
- Complex config routing (which workspace's config to load?)
- Harder to implement global admin views
- Not a good fit for OpenClaw's current architecture

**Verdict:** ❌ Too complex for current needs

### Option C: Database-Per-Tenant
**Pattern:** Separate SQLite/JSON stores per workspace.

**Pros:**
- Complete isolation

**Cons:**
- Major architectural change
- Harder to manage at scale
- Overkill for current needs

**Verdict:** ❌ Not needed yet

## 4. Implementation Strategy

### Phase 1: Core Storage Model (PRIORITY)

**Goal:** Add workspace scoping to all entities.

#### 4.1: Agent Storage
- Agents are currently global (config-based)
- **Solution A (recommended):** Add `workspace` field to agent config entries
  ```json
  {
    "agents": [
      {
        "id": "agent-1",
        "name": "Sales Bot",
        "workspaceId": "ws-uuid-123",
        "workspace": "~/agents/agent-1",
        ...
      }
    ]
  }
  ```
- Filter `agents.list` by `client.pmosWorkspaceId`
- Filter `agents.create/update/delete` by workspace ownership

#### 4.2: Cron Jobs
- Cron jobs stored in `openclaw/cron-store.json`
- **Solution:** Add `workspaceId` field to each cron entry
  ```json
  {
    "jobs": [
      {
        "id": "cron-1",
        "workspaceId": "ws-uuid-123",
        "schedule": "0 9 * * *",
        ...
      }
    ]
  }
  ```
- Filter all cron methods by `client.pmosWorkspaceId`

#### 4.3: Sessions/Chat History
- Sessions stored per agent (filesystem)
- **Solution:** Filter session list by workspace-owned agents
- Session access check: `session.agentId -> agent.workspaceId == client.pmosWorkspaceId`

#### 4.4: Configs
**Challenge:** OpenClaw has single global config file.

**Solution (recommended):** Workspace-level config overrides
- Keep global config for system-level settings (super_admin only)
- Add workspace config file: `~/.openclaw/workspaces/{workspaceId}/config.json`
- Merge strategy: workspace config overrides global config for that workspace
- Super_admin sees/edits global config
- Workspace_admin sees/edits their workspace config only

#### 4.5: Connectors/Integrations
**Strategy:**
- Flow Pieces connections: workspace-scoped (each workspace has own API keys)
- BCGPT connector: workspace-scoped (each workspace can connect to different Basecamp projects)
- AI provider keys: workspace-scoped (each workspace has own OpenAI/Anthropic keys)

**Implementation:**
- Add `workspaceId` to connector config entries
- Filter connector access by workspace

### Phase 2: Server-Side Enforcement (PRIORITY)

**Goal:** Add workspace filtering to all gateway methods.

#### 2.1: Create Workspace Context Helper
```typescript
// openclaw/src/gateway/workspace-context.ts
export function requireWorkspaceContext(client: GatewayClient): WorkspaceContext {
  if (!client.pmosWorkspaceId) {
    throw new Error("Workspace context required");
  }
  return {
    workspaceId: client.pmosWorkspaceId,
    isSuperAdmin: client.pmosRole === "super_admin",
  };
}

export function filterByWorkspace<T extends { workspaceId: string }>(
  items: T[],
  context: WorkspaceContext,
): T[] {
  // Super admin in "admin view" sees all
  if (context.isSuperAdmin && context.adminViewEnabled) {
    return items;
  }
  // Everyone else sees only their workspace
  return items.filter((item) => item.workspaceId === context.workspaceId);
}
```

#### 2.2: Update All Server Methods
**Files to modify:**
- `openclaw/src/gateway/server-methods/agents.ts`
  - `agents.list`: filter by workspace
  - `agents.create`: set workspaceId on new agent
  - `agents.update/delete`: check workspace ownership

- `openclaw/src/gateway/server-methods/cron.ts`
  - All methods: filter and check workspace ownership

- `openclaw/src/gateway/server-methods/sessions.ts`
  - All methods: filter by workspace-owned agents

- `openclaw/src/gateway/server-methods/chat.ts`
  - Only allow chat with workspace-owned agents

**Pattern for all methods:**
```typescript
"agents.list": async ({ params, client, respond }) => {
  const workspace = requireWorkspaceContext(client);
  const cfg = loadConfig();
  const allAgents = listAgentEntries(cfg);
  const scopedAgents = filterByWorkspace(allAgents, workspace);
  respond(true, scopedAgents, undefined);
}
```

### Phase 3: Data Migration (ONE-TIME)

**Goal:** Assign existing data to appropriate workspace.

**Strategy:**
1. Get super_admin's workspaceId (first user)
2. Assign all existing agents, cron jobs, sessions to super_admin's workspace
3. OR create a "default" workspace and assign everything there

**Migration script:**
```typescript
// openclaw/scripts/migrate-to-workspace-isolation.ts
export async function migrateToWorkspaceIsolation() {
  const store = await loadAuthStore();
  const superAdmin = store.users.find((u) => u.role === "super_admin");
  if (!superAdmin) throw new Error("No super admin found");

  const defaultWorkspaceId = superAdmin.workspaceId;

  // Migrate agents
  const cfg = loadConfig();
  cfg.agents = cfg.agents?.map((agent) => ({
    ...agent,
    workspaceId: agent.workspaceId || defaultWorkspaceId,
  }));
  await writeConfigFile(cfg);

  // Migrate cron jobs
  const cronStore = await loadCronStore();
  cronStore.jobs = cronStore.jobs.map((job) => ({
    ...job,
    workspaceId: job.workspaceId || defaultWorkspaceId,
  }));
  await saveCronStore(cronStore);
}
```

### Phase 4: Testing Strategy

#### 4.1: Unit Tests
- Test workspace filtering logic
- Test workspace ownership checks
- Test super_admin bypass (when in admin mode)

#### 4.2: Integration Tests
```typescript
describe("workspace isolation", () => {
  it("user A cannot see user B's agents", async () => {
    const userA = await signup("a@example.com", "password");
    const userB = await signup("b@example.com", "password");

    // User A creates an agent
    await createAgent({ name: "Agent A", sessionToken: userA.sessionToken });

    // User B lists agents - should not see User A's agent
    const userBAgents = await listAgents(userB.sessionToken);
    expect(userBAgents).toHaveLength(0);
  });

  it("user A cannot modify user B's agents", async () => {
    const userA = await signup("a@example.com", "password");
    const userB = await signup("b@example.com", "password");

    const agentB = await createAgent({ name: "Agent B", sessionToken: userB.sessionToken });

    // User A attempts to delete User B's agent - should fail
    await expect(
      deleteAgent({ agentId: agentB.agentId, sessionToken: userA.sessionToken })
    ).rejects.toThrow("not found"); // or "permission denied"
  });
});
```

#### 4.3: E2E Smoke Tests
- Signup two users
- Each creates agents, cron jobs
- Verify neither sees the other's data
- Verify super_admin can see/manage all (in admin mode)

### Phase 5: Super Admin Experience

**Goal:** Super admin can manage all workspaces but also has their own workspace.

**UI Pattern:**
- Default view: super_admin sees their OWN workspace data (like any workspace_admin)
- "Admin Panel" toggle: reveals all workspaces, allows switching between them
- In admin panel, can:
  - View all workspaces
  - Switch to any workspace (see as that workspace)
  - Manage users, workspaces, quotas

**Implementation:**
- Add `adminViewEnabled` flag to workspace context
- When enabled, bypass workspace filtering
- Add workspace switcher UI component (admin only)

## 5. World-Class UX Principles

### 5.1: Zero-Config Default
- New signups automatically get a workspace
- No explicit "create workspace" step
- Workspace just works (invisible by default)

### 5.2: Simple Mental Model
- "Your data lives in your workspace"
- "You can only see your own workspace's data"
- "Super admin can see everything (in admin mode)"

### 5.3: No Scary Jargon
- Don't expose "workspaceId" in UI
- Just say "your account" or "your team"
- Settings page can say "Workspace Settings" (clear and simple)

### 5.4: Multi-Workspace Support (Future)
- Allow users to be members of multiple workspaces
- Workspace switcher in header (like Slack, Notion)
- For now: 1 user = 1 workspace (simple)

## 6. Implementation Checklist

### Week 1: Core Infrastructure
- [ ] Create workspace context helpers
- [ ] Add workspaceId to agent config schema
- [ ] Add workspaceId to cron job schema
- [ ] Write migration script
- [ ] Run migration on dev environment

### Week 2: Server Method Updates
- [ ] Update all `agents.*` methods to filter by workspace
- [ ] Update all `cron.*` methods to filter by workspace
- [ ] Update all `sessions.*` methods to filter by workspace
- [ ] Update chat methods to enforce workspace-owned agents
- [ ] Add workspace config system

### Week 3: Testing
- [ ] Write workspace isolation unit tests
- [ ] Write cross-workspace leakage tests
- [ ] Write E2E smoke tests for multi-user scenarios
- [ ] All tests passing

### Week 4: Super Admin & Deploy
- [ ] Add super admin workspace switcher UI
- [ ] Add admin panel toggle
- [ ] Deploy to staging and smoke test
- [ ] Deploy to production
- [ ] Verify isolation in production

## 7. Rollback Plan

If isolation breaks production:
1. Revert to previous deployment (before workspace filtering)
2. All users will see shared data again (safe but not isolated)
3. Fix issue in isolation logic
4. Redeploy with fix

**Rollback is safe because:**
- We're only adding filters, not changing storage format
- Worst case: users see too much data (not too little)
- No data loss risk

## 8. Success Metrics

After deployment:
- [ ] Zero cross-workspace data leakage incidents
- [ ] All workspace isolation tests passing in CI
- [ ] Super admin can manage all workspaces
- [ ] New signups get isolated workspace automatically
- [ ] No user reports seeing other users' data

## 9. Next Steps After M1.5

Once workspace isolation is complete:
1. **M2 (Onboarding Wizard)** - now makes sense (user sets up THEIR workspace)
2. **M3 (Simplified UX)** - can show workspace-specific data safely
3. **M4 (Chat-First Operations)** - chat operates on user's workspace data
4. **M5 (Hardening)** - add quotas, rate limits per workspace

---

**Author:** Claude Sonnet 4.5
**Review:** Pending owner approval
