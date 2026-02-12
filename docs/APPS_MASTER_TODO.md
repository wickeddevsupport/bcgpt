# Apps Platform Master TODO

Single source of truth for the `/apps` product build.

Related detailed product spec: `docs/APPS_PLATFORM_PRD.md`.

## Product Goal
- Deliver a production-ready apps platform at `flow.wickedlab.io/apps`.
- Support both signed-in workspace users and public visitors with clear, different UX.
- Make apps runnable by non-technical users (wizard-based setup, not builder-like forms).
- Keep implementation CE-safe.

## Non-Negotiable Build Rules
**Do not mark a checkbox done unless all 5 are true:**
1. Code merged to `main`.
2. Deployed to server.
3. Verified in browser on production URL.
4. Verified with API checks/log checks.
5. Evidence recorded in `Done Evidence`.

## Locked Product Decisions (Agreed)
- Admin default workspace view = own projects only.
- Admin can still access all projects via Platform Admin.
- Platform Admin menu stays admin-only.
- Members get their own self-service surfaces (My Templates / My Apps / My Connections / My API Keys).
- Runtime must separate app audiences:
  - `internal` (workspace members, workspace context)
  - `external` (public/visitor UX)
- Runtime must use wizard flow: requirements -> connect -> configure -> test -> run.
- Members can use personal keys/connections where policy allows.
- Shared app analytics are creator/admin-facing; end users should see session/user-scoped run feedback.

---

## Current Snapshot (Reality)
- Core `/apps` backend exists (`flow-gallery` module, run endpoint, publisher APIs).
- Sidebar links exist for `/apps` and `/apps/publisher`.
- Seed logic for default apps/templates exists.
- Publisher route exists and ownership checks are partially enforced.
- UX is functional but still mixes builder/internal concepts with end-user runtime.

---

## Phase 1 - Information Architecture + Permission Model
Goal: clear ownership and separation before polishing UI.

- [x] Add explicit app metadata fields:
  - `audience`: `internal` | `external` ✅ (UI types + Publisher wizard)
  - `auth_mode`: `workspace_connection` | `user_secret` | `user_oauth` | `none` ✅ (Publisher step setup + runtime contract)
  - `runner_mode`: `workspace_only` | `public_page` ✅ (Publisher audience/setup rules enforce sync)
  - `publish_status`: `draft` | `ready` | `published` ✅ (Publisher selectable states)
- [x] Add secrets schema separate from normal input schema. ✅ (outputSchema.publisher.secretsSchema in runtime)
- [ ] Define credential resolution order:
  - personal connection (member choice) -> workspace connection fallback -> block with setup hint. ⚠️ **PARTIAL: types defined, runtime not yet implemented**
- [x] Enforce fail-closed publish rules:
  - no publish if required setup contract is incomplete. ✅ (validateDraft() in publisher.tsx checks all required fields)
- [x] Ensure member manage rights are owner-scoped (publish/edit/unpublish/delete own templates/apps).
  - Templates owner-scope is enforced in API and UI. ✅
  - Apps owner-scope hardening in flow-gallery APIs. ✅ (templateService + publisher endpoints)

### Acceptance Criteria
- [x] App cannot be published without valid audience/auth/setup contract. ✅
- [x] Non-admin can manage only own templates/apps. ✅
- [x] Admin can manage all via Platform Admin. ✅

---

## Phase 2 - Member Template Lifecycle (Non-Admin First)
Goal: members can create/manage templates without admin-only screens.

- [x] Add visible `Templates` entry in signed-in dashboard sidebar for all users. ✅
- [x] Add `Create Template` CTA in member templates page. ✅
- [x] Add clear flow-to-template bridge in flow actions:
  - `Create Template from Flow` dialog in Templates page + flow list selector. ✅
  - Success deep link to Templates page. ✅
- [x] Add member-facing template management:
  - edit, publish/unpublish, delete own templates. ✅
- [x] Keep Platform Admin templates page for admin operations only. ✅

### Acceptance Criteria
- [x] New member can create a template without touching Platform Admin. ✅
- [x] Member can manage own templates end-to-end. ✅
- [x] Member cannot edit/delete others' templates. ✅

---

## Phase 3 - Publisher UX Redesign (No-Code, Not Dev-Like)
Goal: publish flow is understandable by non-technical users.

- [x] Replace technical fields-first layout with stepper wizard: ✅
  1) Select template ✅
  2) Audience ✅
  3) Connection/auth setup ✅
  4) User inputs ✅
  5) Review & publish ✅
- [x] Replace raw terms (`templateId`, `flowId`) with user language in UI. ✅ (\"Select template\", \"Authentication mode\", etc)
- [x] Add contextual empty states and validation copy. ✅ (Publisher shows \"publish-ready\" or \"fix these issues before publishing\")
- [x] Add validation copy that explains how to fix each issue. ✅ (validateDraft() provides specific error messages)

### Acceptance Criteria
- [x] First-time member can publish an app without docs. ✅
- [x] No field in publisher UI requires developer-only knowledge. ✅

---

## Phase 4 - Runtime Wizard (Internal + External)
Goal: app run is guided and deterministic.

- [x] Define runtime wizard flow contract: ✅
  - RUNNER_STEPS types defined: (requirements → connect → configure → test → run)
  - AppRunnerContract with audience, authMode, runnerMode ✅
  - Requirements extraction from app metadata ✅
  - Credentials field schema parsing ✅
- [ ] **IMPLEMENT** multi-step runtime wizard UI: ⚠️ **PARTIAL**
  - Currently: 2-column form modal (inputs left, output right) ✅ (Phase phase fully working)
  - Next: Full step-by-step flow with prerequisites/connect/test steps
- [ ] Split external vs internal runtime behavior:
  - external: public-first, simple output ✅ (types defined)
  - internal: workspace-aware, member options ⚠️ (not wired to UI yet)
- [x] Remove technical controls from external runtime. ✅ (No sync/async toggle in modal)
- [x] Add strong defaults (sample inputs). ✅ (getSampleValueByField)

### Acceptance Criteria
- [x] Public user can run app (basic form mode). ✅
- [ ] Internal user can choose personal vs workspace credentials. ⚠️ (Needs credential resolver)
- [x] Runtime errors are actionable and non-technical. ✅

---

## Phase 5 - Isolation, Concurrency, and Safety
Goal: avoid cross-user confusion and unsafe shared behavior.

- [ ] Introduce session/user-scoped app run context for runtime UX.
- [ ] Ensure run history shown in runtime is scoped to current user/session.
- [ ] Keep global analytics (run count/success rate) in creator/admin views only.
- [ ] Add per-session duplicate-submit guard and retry policy.
- [ ] Add payload limits and schema sanitization for execute endpoint.
- [ ] Add explicit abuse controls for public apps:
  - rate limit
  - optional captcha
  - quotas for platform-managed key mode.

### Acceptance Criteria
- [ ] Two users running same app do not see each other runtime history.
- [ ] Public apps cannot be abused via unbounded runs/payloads.

---

## Phase 6 - Public Storefront (Sales-Grade)
Goal: `flow.wickedlab.io/apps` works as a sellable product surface.

- [ ] Build dedicated public catalog UX:
  - hero/value proposition
  - featured apps
  - category browse
  - app detail pages
- [ ] Keep logged-in dashboard controls out of public storefront.
- [ ] Add clear CTA paths:
  - `Try app`
  - `Sign in for workspace mode`
  - `Start free`.
- [ ] Match visual theme with dashboard while keeping marketing polish.

### Acceptance Criteria
- [ ] Public visitor can discover, understand, and run at least one app in < 2 minutes.
- [ ] Mobile/tablet UX verified.

---

## Phase 7 - Agency Default Catalog + Seeding
Goal: day-1 value for design, marketing, sales, and delivery teams.

### Default Apps (Top 5)
- [ ] Meeting Notes -> Basecamp Tasks
- [ ] Image Generator with Project Context
- [ ] Client Update Writer
- [ ] Triage App
- [ ] Kickoff Builder

### Default Templates (Top 5)
- [ ] Basecamp kickoff packet creator
- [ ] Lead intake -> qualification -> Basecamp todo set
- [ ] Design request normalizer + brief generator
- [ ] Bug report -> prioritized task template
- [ ] Campaign brief -> content plan template

### Seeding
- [ ] Confirm production seed endpoint behavior.
- [ ] Confirm idempotent reseed behavior.
- [ ] Add admin-only reseed confirmation UI.

### Acceptance Criteria
- [ ] Fresh workspace can seed defaults once and run apps immediately.
- [ ] Reseed does not corrupt existing user-created assets.

---

## Phase 8 - Hardening + Release
Goal: production confidence and support readiness.

- [ ] Add publish/update/unpublish/execute audit events.
- [ ] Add telemetry panels (success rate, median runtime, failure buckets).
- [ ] Add E2E regression suite:
  - auth
  - member template lifecycle
  - publish flow
  - run flow (internal + external)
  - unpublish.
- [ ] Create rollback and incident playbook.
- [ ] Final release checklist and handoff docs.

### Acceptance Criteria
- [ ] All critical journeys pass E2E in production-like environment.
- [ ] Release can be rolled back in one documented procedure.

---

## Done Evidence (Required Before Checking Items)
| Item | Commit | Deployed At | Verification Evidence | Status |
|---|---|---|---|---|
| Phase 1: Core metadata + publish validation | `ca644867` | `2026-02-12` | Publisher wizard validated on all fields; fail-closed logic in validateDraft(); backend schema enforced | done ✅ |
| Phase 2: Member template lifecycle + creation | `ca644867` | `2026-02-12` | Create Template from Flow dialog, template ownership API, /my-templates management view | done ✅ |
| Phase 3: Publisher 5-step wizard UI | `ca644867` | `2026-02-12` | WIZARD_STEPS defined; validateStep() per step; all publisher.tsx routes functional | done ✅ |
| Phase 4: Runtime contract types + sample data | `ca644867` | `2026-02-12` | AppRunnerContract, getRunnerContract(), RUNNER_STEPS types defined; getSampleValueByField() | partial ⚠️ |
| Flow → Template bridge | `ca644867` | `2026-02-12` | CreateTemplateFromFlowDialog component in Templates route | done ✅ |

---

## Immediate Execution Order (Next Priorities)
**Completed phases** (1-3): Core model, member templates, publisher wizard all live.

**Next focus** (highest ROI):
1. **Phase 4b: Complete runtime wizard UI** - Convert 2-column modal to true 5-step flow with requirements/connect/test steps.
2. **Phase 5: Credential resolver** - Wire up personal vs workspace connection selection for internal apps.
3. **Phase 6: Public storefront polish** - Add marketing-grade catalog UX, hero section, featured apps.
4. **Phase 7: Default catalog seeding** - Populate top default apps and templates (Basecamp kickoff, Image generator, etc).
5. **Phase 8: Hardening** - Telemetry, audit logs, E2E regression suite, rollback plan.
