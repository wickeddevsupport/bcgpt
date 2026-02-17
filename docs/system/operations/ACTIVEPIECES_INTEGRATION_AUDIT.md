# Activepieces Integration Audit & Issues

**Created:** 2026-02-17
**Priority:** CRITICAL
**Blocks:** Workspace isolation (M1.5)

## Executive Summary

The Activepieces (Flow Pieces) integration is **sub-standard** and has **fundamental architectural issues** that block true multi-tenancy. All PMOS users currently share a single Activepieces project, meaning workspace isolation is impossible at the flow/automation layer.

## Current Architecture

### How It Works Today

1. **Single Global Project**
   - One Activepieces projectId for entire PMOS instance
   - Stored in config: `pmos.connectors.activepieces.projectId`
   - All users share this project

2. **Single Global API Key**
   - One Activepieces API key for entire PMOS
   - Stored in config: `pmos.connectors.activepieces.apiKey`
   - All users use the same credentials

3. **API-Based Integration**
   - PMOS calls Activepieces REST API via plugin tools ([pmos-activepieces/index.ts](openclaw/extensions/pmos-activepieces/index.ts))
   - Tools: `flow_flows_list`, `flow_flow_create`, `flow_connections_list`, etc.
   - No iframe embedding (good for security, but doesn't solve isolation)

4. **UI Integration**
   - PMOS UI shows flows from the shared Activepieces project
   - [automations.ts](openclaw/ui/src/ui/views/automations.ts) renders flows
   - No workspace filtering on flows

### Files Involved

**Backend:**
- `openclaw/extensions/pmos-activepieces/index.ts` - Activepieces API plugin (17 tools)
- `openclaw/src/gateway/server-methods/pmos.ts` - Connector status checks
- `openclaw/src/config/zod-schema.ts` - Config schema (includes AP settings)

**Frontend:**
- `openclaw/ui/src/ui/views/automations.ts` - Automations/flows UI
- `openclaw/ui/src/ui/views/dashboard.ts` - Dashboard with flow status
- `openclaw/ui/src/ui/controllers/pmos-connectors.ts` - Connector config UI
- `openclaw/ui/src/ui/controllers/pmos-activepieces.ts` - Flows/runs controllers

**Config:**
- `.env`: `ACTIVEPIECES_URL`, `ACTIVEPIECES_API_KEY`, `ACTIVEPIECES_PROJECT_ID`
- OpenClaw config: `pmos.connectors.activepieces.{url, apiKey, projectId}`

## Critical Problems

### Problem 1: No Workspace Isolation for Flows

**Issue:**
- All PMOS users see ALL flows in the shared Activepieces project
- User A can see, edit, delete User B's flows
- No way to filter flows by workspace

**Impact:**
- Complete data leakage at automation layer
- Users can accidentally break each other's workflows
- Not suitable for multi-tenant product

**Root Cause:**
- Activepieces projectId is global, not per-workspace
- No workspaceId metadata on Activepieces flows

### Problem 2: Shared Credentials

**Issue:**
- Single API key means all users have same permissions in Activepieces
- No way to enforce different quotas/limits per workspace
- Security risk: one workspace compromise = all workspaces compromised

**Impact:**
- Cannot implement workspace-level rate limits
- Cannot revoke access for specific workspace without affecting all
- Audit trail is useless (can't tell which PMOS user did what in AP)

### Problem 3: Poor UX for Multi-Workspace

**Issue:**
- Users see a confusing mix of their flows and others' flows
- No clear ownership or organization
- "Automations" screen shows everything (no filtering)

**Impact:**
- Terrible UX for multi-user product
- Users will constantly ask "whose flow is this?"
- Difficult to find your own automations

### Problem 4: No Migration Path

**Issue:**
- Existing flows are in a shared project
- No metadata to assign them to workspaces retroactively
- Moving flows between projects is not trivial in Activepieces

**Impact:**
- Can't easily fix this for existing deployments
- Risk of breaking existing automations during migration

## Architectural Options

### Option A: One Activepieces Project Per Workspace (RECOMMENDED)

**Pattern:**
- Each PMOS workspace gets its own Activepieces project
- Store per-workspace: `{ workspaceId, activepiecesProjectId, activepiecesApiKey }`
- PMOS acts as multi-tenant orchestrator

**Pros:**
- Complete isolation at Activepieces layer
- Each workspace can have different AP plans/quotas
- Clear ownership and audit trail
- Aligns with Activepieces' own multi-tenancy model

**Cons:**
- Need to create AP projects programmatically (requires platform/admin API key)
- More complex config management (per-workspace credentials)
- Potential cost increase if AP charges per-project

**Implementation:**
```typescript
// Store workspace-scoped AP config
type WorkspaceActivepiecesConfig = {
  workspaceId: string;
  activepiecesProjectId: string;
  activepiecesApiKey: string; // project-scoped key
  createdAtMs: number;
};

// On workspace creation
async function provisionActivepiecesProject(workspaceId: string) {
  // Use platform admin key to create project
  const project = await activepiecesPlatformAPI.createProject({
    displayName: `PMOS Workspace ${workspaceId}`,
    ownerId: ...,
  });

  // Generate project-scoped API key
  const apiKey = await activepiecesPlatformAPI.createProjectKey(project.id);

  // Store in workspace config
  await saveWorkspaceApConfig({
    workspaceId,
    activepiecesProjectId: project.id,
    activepiecesApiKey: apiKey,
    createdAtMs: Date.now(),
  });
}
```

**Requirements:**
1. Activepieces platform/admin API access
2. Ability to create projects programmatically
3. Per-workspace config storage

### Option B: Metadata-Based Filtering (HACKY, NOT RECOMMENDED)

**Pattern:**
- Keep single shared Activepieces project
- Add `workspaceId` to flow metadata/tags
- Filter flows by metadata in PMOS

**Pros:**
- Simpler to implement (no new projects)
- Lower cost (single AP project)

**Cons:**
- ❌ Not real isolation (all users still have access to all flows in AP)
- ❌ Relies on PMOS UI filtering (can be bypassed)
- ❌ User can go directly to Activepieces UI and see everything
- ❌ Doesn't solve credential sharing problem
- ❌ Fragile: tags can be removed, breaking isolation

**Verdict:** ❌ **DO NOT USE** - this is security theater, not real isolation

### Option C: Fork/Host Dedicated Activepieces Per Workspace (OVERKILL)

**Pattern:**
- Spin up separate Activepieces instance per workspace
- Each workspace gets own subdomain (e.g., `ws-123.flow.wickedlab.io`)

**Pros:**
- Complete isolation (separate databases, separate processes)
- No AP multi-tenancy complexity

**Cons:**
- ❌ Massive operational overhead (managing N AP instances)
- ❌ High cost (N databases, N containers, N domains)
- ❌ Complex routing/orchestration
- ❌ Overkill for current scale

**Verdict:** ❌ Only consider if managing thousands of workspaces

## Recommended Solution

**Use Option A: One Activepieces Project Per Workspace**

### Phase 1: Platform Setup
1. Get Activepieces platform/admin API credentials
2. Test project creation via API
3. Test project-scoped API key generation
4. Document AP project lifecycle (create, suspend, delete)

### Phase 2: Workspace Provisioning
1. Add workspace creation hook in PMOS
2. On workspace creation:
   - Create AP project via platform API
   - Generate project-scoped API key
   - Store in workspace config
3. On workspace deletion:
   - Delete or archive AP project

### Phase 3: Config Storage
1. Add workspace-scoped config model:
   ```
   ~/.openclaw/workspaces/{workspaceId}/connectors.json
   {
     "activepieces": {
       "projectId": "...",
       "apiKey": "...",
       "url": "https://flow.wickedlab.io"
     },
     "bcgpt": {
       "apiKey": "...",
       "url": "https://bcgpt.wickedlab.io"
     }
   }
   ```
2. Update connector controllers to load workspace-scoped config
3. Update AP plugin to resolve workspace context

### Phase 4: UI Updates
1. Update automations view to show only workspace's flows
2. Update integrations view to show workspace's connector status
3. Add workspace admin UI for AP project management

### Phase 5: Migration
1. Assign existing flows to super_admin's workspace
2. OR create migration wizard:
   - List all existing flows
   - Ask super_admin to assign each flow to a workspace
   - Move flows to appropriate AP projects

## Activepieces Community Edition Limitations

**CRITICAL DISCOVERY NEEDED:**
We're using Activepieces Community Edition (CE). Need to verify:

1. **Does CE support multiple projects?**
   - If NO: we're blocked, need to upgrade to Enterprise or find alternative
   - If YES: proceed with Option A

2. **Does CE have platform/admin API for project management?**
   - If NO: manual project creation required (not scalable)
   - If YES: proceed with automated provisioning

3. **What's the CE project limit?**
   - Need to understand scaling constraints

**ACTION REQUIRED:**
1. Review Activepieces CE documentation on multi-project support
2. Test project creation in current CE deployment
3. Contact Activepieces if needed to clarify CE capabilities
4. If CE is insufficient, evaluate:
   - Upgrading to Activepieces Cloud/Enterprise
   - Migrating to alternative workflow engine (n8n, Temporal, etc.)

## Alternative: Replace Activepieces?

If Activepieces CE doesn't support per-workspace projects, consider:

### Option: n8n (Open Source Alternative)
- Native multi-tenancy via separate instances or "projects"
- Self-hosted, MIT license
- Strong API
- Active community

### Option: Temporal
- Workflow orchestration engine
- Better for programmatic workflows (not visual editor)
- Excellent multi-tenancy support
- Steeper learning curve

### Option: Build Native PMOS Workflows
- Build workflow engine directly in PMOS
- Full control over multi-tenancy
- Significant dev effort (months)
- Reinventing the wheel

**Verdict:** Only replace AP if CE limitations are blocking. Prefer upgrading to AP Enterprise first.

## Impact on M1.5 (Workspace Isolation)

**Workspace isolation cannot be completed until Activepieces isolation is solved.**

Even if we implement workspace filtering for agents, cron jobs, and sessions, the product is still not multi-tenant if all users share the same Activepieces project and can see each other's flows.

**Critical Path:**
1. ✅ Audit Activepieces integration (THIS DOC)
2. ⏸️ Verify AP CE multi-project capabilities
3. ⏸️ Design workspace-scoped AP config model
4. ⏸️ Implement AP project provisioning
5. ⏸️ Migrate existing flows
6. ⏸️ Update UI to use workspace-scoped flows
7. ✅ Complete M1.5 (workspace isolation)

**Estimated Additional Time:** 1-2 weeks (depending on AP CE discovery)

## Next Steps

1. **Immediate:** Investigate Activepieces CE multi-project support
   - Read CE docs
   - Test project creation in current deployment
   - Document findings

2. **If CE supports it:** Proceed with Option A implementation

3. **If CE blocks it:** Decide on:
   - Upgrade to AP Enterprise (cost/benefit)
   - Migrate to n8n or alternative
   - Delay productization until we have solution

4. **Update workspace isolation plan** to include AP isolation work

---

**Author:** Claude Sonnet 4.5
**Status:** Pending investigation
**Blocks:** M1.5, M2, M3, M4, M5
