# CE-Safe Migration TODO (Wicked Flow)

This checklist tracks the work to:

- Remove **all Enterprise-licensed code** from production artifacts.
- Rebuild required features as **MIT-only** code:
  - Per-user templates (private by default) with admin approval to publish platform-wide
  - In-app editable branding
  - API keys
  - Audit logs
  - OIDC SSO (Google, GitHub first)
- Keep official/community templates available.

## Status

### Completed
- [x] Reverted EE-plan toggle change in `activepieces/packages/ee/shared/src/lib/billing/index.ts` (commit `87f80911`)
- [x] Restored Templates UI to show Official and Custom via toggle (commit `62c96316`)
- [x] Added source guard script `scripts/check-no-ee-imports.mjs` + `npm run license:guard` (commit pending)

### In Progress
- [ ] **EE detox**: remove EE imports from non-EE server + UI so Activepieces can compile without EE sources.

## Phase 0: Guardrails (Must-Have)
- [ ] Expand `npm run license:guard` to scan the whole `activepieces/` tree and fail on:
  - `@activepieces/ee-*` imports outside EE directories
  - imports from `activepieces/packages/server/api/src/app/ee/**` outside EE directories
- [ ] Add Docker/image guard: fail build if the produced image contains:
  - `packages/ee/**`
  - `dist/**/ee/**`
  - `node_modules/@activepieces/ee-*`

## Phase 1: Make Activepieces Build Without EE Code
- [ ] Remove static imports of EE modules from server entrypoint(s)
- [ ] Replace `@activepieces/ee-shared` usage in non-EE code with MIT equivalents
- [ ] Remove all references to `server/api/src/app/ee/**` from non-EE code
- [ ] Ensure a production build works with EE directories excluded from Docker context/image

## Phase 2: Rebuild Promised Features (MIT-only)

### 2.1 Templates (Per User + Admin Approval)
- [ ] DB: create tables + migrations (Postgres + Sqlite)
  - [ ] `user_template` (private default)
  - [ ] `template_publish_request` (approval workflow)
- [ ] API:
  - [ ] create template from flow
  - [ ] list/search templates
  - [ ] request publish
  - [ ] admin approve/reject
  - [ ] install template (creates a new flow)
- [ ] UI:
  - [ ] "My Templates" (private)
  - [ ] "Platform Templates" (approved)
  - [ ] admin approval queue

### 2.2 Branding (Editable In-App)
- [ ] DB: `platform_branding`
- [ ] API: GET/PUT branding + optional asset upload
- [ ] UI: platform branding editor + apply on app shell

### 2.3 API Keys (User + Service)
- [ ] DB: `api_key` (scoped, hashed)
- [ ] API: create/list/revoke keys
- [ ] Middleware: authenticate via key for selected endpoints (MCP + internal APIs)

### 2.4 Audit Logs
- [ ] DB: `audit_log`
- [ ] API: list/search
- [ ] UI: audit log viewer (admin)
- [ ] Coverage: log auth, template events, branding changes, api key events

### 2.5 OIDC SSO (Google + GitHub)
- [ ] DB: `oidc_provider_config`
- [ ] API: configure providers (admin)
- [ ] Auth flow: login redirect + callback + account linking
- [ ] UI: security page to configure/enable OIDC

## Phase 3: Deployment + Verification
- [ ] Deploy CE-safe image to `flow.wickedlab.io`
- [ ] Verify official templates still load
- [ ] Verify platform templates workflow works end-to-end
- [ ] Verify branding persists across redeploy
- [ ] Verify API keys auth works for MCP usage
- [ ] Verify audit logs populate
- [ ] Verify Google + GitHub OIDC sign-in

