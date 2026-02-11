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
- Phase 2: Publisher interface and metadata contracts -> `IN PROGRESS`
- Phase 3: App store UX (Zapier-grade polish) -> `IN PROGRESS`
- Phase 4: App runner UX and reliability -> `DONE`
- Phase 5: Default apps/templates seeding -> `DONE`
- Phase 6: Production hardening and telemetry -> `NOT STARTED`
- Phase 7: Release and handoff -> `NOT STARTED`

---

## Phase 0 - Foundation and Guardrails
- [x] Freeze baseline commit and record rollback command.
- [x] Add release checklist for deploy/rollback.
- [x] Verify server env parity (`.env.activepieces`, compose, proxy).
- [x] Add smoke test checklist for every deploy (`/`, `/apps`, sign-in, run app).
- [ ] Confirm no accidental changes in unrelated files before each release.

### Deploy Smoke Checklist (Current)
- [x] `/` returns 200
- [x] `/sign-in` returns 200
- [x] `/apps` returns 200
- [x] `/apps/publisher` returns 200
- [x] `/api/v1/flags` returns 200

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
- [x] Add complete publisher UX flow (draft -> validate -> publish -> success).
- [x] Add inline schema builder UX for inputs/outputs.
- [x] Add publish validation messages that are non-technical.
- [x] Add app preview before publishing.
- [ ] Add integration tests for publisher endpoints.

## Phase 3 - App Store UX (Zapier-grade Direction)
- [ ] Rebuild `/apps` gallery cards for clearer app value:
  - [x] icon, title, one-line promise
  - [x] creator badge and updated time
  - [x] categories and tags
  - [x] featured strip
- [x] Add "Use App" and "View Details" primary actions.
- [ ] Improve app detail page structure:
  - [x] what this app does
  - [x] required inputs
  - [x] expected output format
  - [x] run history preview
- [x] Add empty states, loading states, and failure states with clear actions.
- [x] Mobile and tablet layout pass.
- [x] Add dashboard access points for `/apps` and `/apps/publisher`.

## Phase 4 - App Runner UX and Reliability
- [x] Build dynamic input form generator from `inputSchema`.
- [x] Validate user input before execution.
- [x] Execute real webhook path (`/webhooks/{flowId}/sync`) with safe timeout handling.
- [x] Build output renderer by `outputType` (`text`, `json`, `image`, `markdown`).
- [x] Add retry/cancel controls and clear error reasons.
- [x] Add async fallback path for long-running apps.
- [x] Add execution logs per run for troubleshooting.

## Phase 5 - Default Apps and Templates (Agency-first)
### Default Apps (first 5)
- [x] Meeting Notes -> Basecamp Tasks (Fathom + Basecamp).
- [x] Image Generator with Project Context.
- [x] Client Update Writer (weekly status draft).
- [x] Triage App (intake -> priority -> assignment).
- [x] Kickoff Builder (scope -> checklist -> first sprint tasks).

### Default Internal Templates (first 5)
- [x] Basecamp project kickoff packet creator.
- [x] New lead intake -> qualification -> Basecamp todo set.
- [x] Design request normalizer + brief generator.
- [x] Bug report to prioritized task template.
- [x] Campaign brief -> content plan template.

### Seeding Flow
- [x] Script seed process for clean environments.
- [x] Idempotent template/app seeding.
- [x] Admin-only re-seed action with confirmation.

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
1. Add integration tests for publisher endpoints (Phase 2 gap).
2. Begin Phase 6 hardening (rate limits, payload limits, BYOK masking).
3. Add minimal telemetry for app execution success/failure buckets.
4. Complete Phase 7 release/handoff docs and rollback drill.
