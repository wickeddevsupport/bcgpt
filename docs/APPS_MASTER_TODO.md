# Apps Platform Master TODO

This is the single source of truth for the `/apps` product build.

## Product Goal
- Deliver a production-ready app store and app runner on `flow.wickedlab.io/apps` so non-technical users can run workflows as apps.
- Keep Activepieces CE-safe and preserve current working system behavior.

## Locked Decisions
- Admin default workspace view should behave like normal users (own projects only).
- Access to all users/projects stays in Platform Admin.
- No extra search/filter complexity in workspace project list.
- CE-safe code path only.
- Core app direction starts with Basecamp + Fathom-powered agency workflows.

## Phase Status Snapshot
- Phase 0: Foundation and guardrails -> `IN PROGRESS`
- Phase 1: Proof of concept (`/apps`, public gallery, basic runner) -> `DONE`
- Phase 2: Publisher interface and metadata contracts -> `PARTIALLY DONE`
- Phase 3: App store UX (Zapier-grade polish) -> `NOT STARTED`
- Phase 4: App runner UX and reliability -> `NOT STARTED`
- Phase 5: Default apps/templates seeding -> `NOT STARTED`
- Phase 6: Production hardening and telemetry -> `NOT STARTED`
- Phase 7: Release and handoff -> `NOT STARTED`

---

## Phase 0 - Foundation and Guardrails
- [ ] Freeze baseline commit and record rollback command.
- [ ] Add release checklist for deploy/rollback.
- [ ] Verify server env parity (`.env.activepieces`, compose, proxy).
- [ ] Add smoke test checklist for every deploy (`/`, `/apps`, sign-in, run app).
- [ ] Confirm no accidental changes in unrelated files before each release.

## Phase 1 - Proof of Concept (Already Delivered)
- [x] `/apps` route exists.
- [x] Public apps listing API exists.
- [x] App detail/runner route exists (`/apps/:id`).
- [x] Basic app execution endpoint exists.

## Phase 2 - Publisher Interface and Contracts
- [x] Publisher backend endpoints (`/apps/api/publisher/*`).
- [x] Metadata model in DB (`flow_gallery_app`) and migration.
- [x] Publish/unpublish/update metadata APIs.
- [x] Initial publisher page route.
- [ ] Add complete publisher UX flow (draft -> validate -> publish -> success).
- [ ] Add inline schema builder UX for inputs/outputs.
- [ ] Add publish validation messages that are non-technical.
- [ ] Add app preview before publishing.
- [ ] Add integration tests for publisher endpoints.

## Phase 3 - App Store UX (Zapier-grade Direction)
- [ ] Rebuild `/apps` gallery cards for clearer app value:
  - [ ] icon, title, one-line promise
  - [ ] creator badge and updated time
  - [ ] categories and tags
  - [ ] featured strip
- [ ] Add "Use App" and "View Details" primary actions.
- [ ] Improve app detail page structure:
  - [ ] what this app does
  - [ ] required inputs
  - [ ] expected output format
  - [ ] run history preview
- [ ] Add empty states, loading states, and failure states with clear actions.
- [ ] Mobile and tablet layout pass.

## Phase 4 - App Runner UX and Reliability
- [ ] Build dynamic input form generator from `inputSchema`.
- [ ] Validate user input before execution.
- [ ] Execute real webhook path (`/webhooks/{flowId}/sync`) with safe timeout handling.
- [ ] Build output renderer by `outputType` (`text`, `json`, `image`, `markdown`).
- [ ] Add retry/cancel controls and clear error reasons.
- [ ] Add async fallback path for long-running apps.
- [ ] Add execution logs per run for troubleshooting.

## Phase 5 - Default Apps and Templates (Agency-first)
### Default Apps (first 5)
- [ ] Meeting Notes -> Basecamp Tasks (Fathom + Basecamp).
- [ ] Image Generator with Project Context.
- [ ] Client Update Writer (weekly status draft).
- [ ] Triage App (intake -> priority -> assignment).
- [ ] Kickoff Builder (scope -> checklist -> first sprint tasks).

### Default Internal Templates (first 5)
- [ ] Basecamp project kickoff packet creator.
- [ ] New lead intake -> qualification -> Basecamp todo set.
- [ ] Design request normalizer + brief generator.
- [ ] Bug report to prioritized task template.
- [ ] Campaign brief -> content plan template.

### Seeding Flow
- [ ] Script seed process for clean environments.
- [ ] Idempotent template/app seeding.
- [ ] Admin-only re-seed action with confirmation.

## Phase 6 - Production Hardening
- [ ] Rate limits for app execution.
- [ ] Input payload size limits and schema sanitization.
- [ ] Secure handling for BYOK inputs (masked, not logged).
- [ ] Minimal audit trail for publish/update/unpublish/execute.
- [ ] Observability:
  - [ ] run success rate
  - [ ] median runtime
  - [ ] failure reason buckets
- [ ] E2E regression suite:
  - [ ] sign-up/sign-in
  - [ ] publish app
  - [ ] run app
  - [ ] unpublish app

## Phase 7 - Release and Handoff
- [ ] Final UX QA pass.
- [ ] Performance baseline report.
- [ ] Production deploy checklist completed.
- [ ] Rollback drill executed once.
- [ ] Documentation handoff:
  - [ ] publisher guide
  - [ ] app designer guide
  - [ ] runbook for support/issues

---

## Immediate Next Block (Execution Order)
1. Finish remaining Phase 2 UX and tests.
2. Build full Phase 3 gallery/detail UX.
3. Build full Phase 4 runner and reliability path.
4. Seed Phase 5 default apps/templates.
5. Ship Phase 6 hardening and Phase 7 handoff.
