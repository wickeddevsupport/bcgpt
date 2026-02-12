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

- [ ] Add explicit app metadata fields:
  - `audience`: `internal` | `external`
  - `auth_mode`: `workspace_connection` | `user_secret` | `user_oauth` | `none`
  - `runner_mode`: `workspace_only` | `public_page`
  - `publish_status`: `draft` | `ready` | `published`
- [ ] Add secrets schema separate from normal input schema.
- [ ] Define credential resolution order:
  - personal connection (member choice) -> workspace connection fallback -> block with setup hint.
- [ ] Enforce fail-closed publish rules:
  - no publish if required setup contract is incomplete.
- [ ] Ensure member manage rights are owner-scoped (publish/edit/unpublish/delete own templates/apps).

### Acceptance Criteria
- [ ] App cannot be published without valid audience/auth/setup contract.
- [ ] Non-admin can manage only own templates/apps.
- [ ] Admin can manage all via Platform Admin.

---

## Phase 2 - Member Template Lifecycle (Non-Admin First)
Goal: members can create/manage templates without admin-only screens.

- [ ] Add visible `Templates` entry in signed-in dashboard sidebar for all users.
- [ ] Add `Create Template` CTA in member templates page.
- [ ] Add clear flow-to-template bridge in flow actions:
  - `Save as Template` (or equivalent) with success deep link.
- [ ] Add member-facing template management:
  - edit, publish/unpublish, delete own templates.
- [ ] Keep Platform Admin templates page for admin operations only.

### Acceptance Criteria
- [ ] New member can create a template without touching Platform Admin.
- [ ] Member can manage own templates end-to-end.
- [ ] Member cannot edit/delete others' templates.

---

## Phase 3 - Publisher UX Redesign (No-Code, Not Dev-Like)
Goal: publish flow is understandable by non-technical users.

- [ ] Replace technical fields-first layout with stepper wizard:
  1) Select template
  2) Define audience
  3) Define connection/auth setup
  4) Define user inputs
  5) Test & publish
- [ ] Replace raw terms (`templateId`, `flowId`) with user language in UI.
- [ ] Add contextual empty states:
  - no templates yet -> create template CTA
  - not publish-ready -> explain missing steps
- [ ] Add validation copy that explains how to fix each issue.

### Acceptance Criteria
- [ ] First-time member can publish an app without docs.
- [ ] No field in publisher UI requires developer-only knowledge.

---

## Phase 4 - Runtime Wizard (Internal + External)
Goal: app run is guided and deterministic.

- [ ] Replace mixed runtime modal with setup wizard flow:
  - requirements check
  - connect (BYOK/OAuth/workspace connection)
  - configure required fields
  - test run
  - execute
- [ ] Split external vs internal runtime behavior:
  - external: public-first, simple output
  - internal: workspace-aware, member options
- [ ] Remove technical controls from external runtime (`sync/async`, internal stats noise).
- [ ] Add strong defaults (sample inputs, expected output examples).

### Acceptance Criteria
- [ ] Public user can run app successfully without builder knowledge.
- [ ] Internal user can choose personal vs workspace credentials when policy allows.
- [ ] Runtime errors are actionable and non-technical.

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
| _example_ | `abc123` | `2026-02-12` | `/apps` + logs + screenshots | done |

---

## Immediate Execution Order
1. Phase 1: data/permission model hardening.
2. Phase 2: member template lifecycle UX.
3. Phase 3: publisher wizard redesign.
4. Phase 4: runtime wizard split (internal vs external).
5. Phase 5: isolation/safety.
6. Phase 6: public storefront polish.
7. Phase 7: seed defaults and catalog quality.
8. Phase 8: hardening, telemetry, release readiness.
