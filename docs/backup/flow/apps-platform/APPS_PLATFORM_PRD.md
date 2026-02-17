# Apps Platform PRD

Owner: Product + Engineering  
Status: Draft for implementation  
Scope: `flow.wickedlab.io/apps`, `/apps/publisher`, member template lifecycle, public runtime, handoff readiness  
Last Updated: 2026-02-12

---

## 1) Problem Statement

The current Apps feature is technically functional but not product-complete for non-technical users:
- Template creation is discoverability-poor for non-admin users.
- Publisher UX exposes developer-style concepts (`templateId`, `flowId`) instead of task-driven steps.
- App runtime mixes internal and external user needs.
- Public users are not guided through requirements/connection setup before run.
- Concurrency and run history visibility are global app-centric instead of user/session-centric for runtime UX.

Goal: transform Apps into a no-code, guided, production-grade product where both internal users and public visitors can run apps successfully without developer intervention.

---

## 2) Product Vision

### 2.1 Vision
Create a two-surface apps platform:
1. **Workspace Surface** (signed-in): creators and members build templates, publish apps, manage lifecycle.
2. **Public Surface** (logged-out or visitor): discover apps, complete setup wizard, run apps safely.

### 2.2 Success Criteria
- First-time member can create template and publish app without docs.
- First-time visitor can run an external app in under 2 minutes.
- Internal and external app execution models are isolated and predictable.
- Permission model is clear: admin platform controls + member self-service.

---

## 3) Personas and Jobs-to-be-Done

### 3.1 Platform Admin
- Controls workspace-wide settings.
- Seeds default templates/apps.
- Sets connection/key policy.
- Audits usage and failures.

### 3.2 Member / Creator (non-admin)
- Converts flows into templates.
- Publishes/unpublishes own apps.
- Uses personal credentials where allowed.
- Monitors own app health and run outcomes.

### 3.3 Public Visitor
- Discovers app.
- Understands app value quickly.
- Completes setup wizard (BYOK/OAuth if needed).
- Runs app and receives clear result.

---

## 4) Non-Goals (Explicit)

- No platform-admin menu exposure to non-admin users.
- No developer-level workflow concepts in public runtime.
- No "single shared run history panel" for all public users.
- No publish without setup contract validation.

---

## 5) Core Product Model

Each published app must have:
- `audience`: `internal` | `external`
- `authMode`: `workspace_connection` | `user_secret` | `user_oauth` | `none`
- `runnerMode`: `workspace_only` | `public_page`
- `publishStatus`: `draft` | `ready` | `published`
- `inputSchema`: user-facing inputs
- `secretsSchema`: credentials/config required to run
- `outputType`: text/json/image/markdown/html
- `requirements`: integration prerequisites and minimum setup checks

### 5.1 Hard Rules
1. App cannot move to `published` unless contract passes preflight validation.
2. `internal` apps cannot be run as anonymous public apps.
3. `external` apps cannot depend on hidden workspace-only mandatory credentials.
4. Non-admin can only manage their own templates/apps.
5. Admin can manage all via platform admin surfaces.

---

## 6) Information Architecture

## 6.1 Signed-in (Dashboard)
- Sidebar:
  - Explore
  - Apps
  - Publisher
  - Templates (member-visible)
- Platform Admin (admin-only):
  - Projects, Users, Branding, Global Connections, Templates, Security, Infra

### 6.2 Public
- `/apps`: catalog (marketing-grade)
- `/apps/:id`: app detail + runtime wizard
- `/apps/:id` must show:
  - what it does
  - what is required
  - setup steps
  - run action
  - output area

---

## 7) End-to-End User Flows

## 7.1 Member: Flow -> Template -> App Publish
1. Member builds/opens flow.
2. Clicks `Save as Template` from flow action menu.
3. Lands in Templates with success toast and deep link.
4. Opens Publisher.
5. Publisher wizard:
   - Step 1 Select template
   - Step 2 Choose audience (`internal` or `external`)
   - Step 3 Define auth/connection strategy
   - Step 4 Define user input fields and output expectations
   - Step 5 Test + publish
6. App appears in Apps catalog according to audience and publish status.

### 7.2 Public Visitor: Discover -> Setup -> Run
1. Visitor lands on `/apps` catalog.
2. Opens app detail.
3. Sees requirements checklist.
4. Runs setup wizard:
   - Connect OAuth or enter user secret (BYOK) if required.
   - Fill required inputs.
   - Optional test run.
5. Clicks Run.
6. Receives output in normalized output panel.

### 7.3 Internal Member: Run with personal or workspace credentials
1. Opens internal app from dashboard Apps.
2. Wizard resolves connection strategy:
   - If personal chosen/exists -> use personal.
   - Else if workspace connection available -> use workspace.
   - Else block with actionable setup prompt.
3. Runs app.
4. Sees own run output and session/user-scoped recent runs.

### 7.4 Admin: Seed and governance
1. Uses admin-only controls to seed default catalog.
2. Reviews app telemetry and failures.
3. Sets policy for personal vs workspace credential usage by provider.

---

## 8) Runtime Wizard Specification

Wizard steps for both internal and external modes:
1. **Requirements**
   - Show integrations and prerequisites.
   - Show status: ready / missing.
2. **Connect**
   - `user_oauth`: connect account.
   - `user_secret`: secure entry form.
   - `workspace_connection`: select allowed workspace connection.
3. **Configure**
   - Required user inputs from `inputSchema`.
4. **Test**
   - Optional test run with clear pass/fail and fix guidance.
5. **Run**
   - Execute and show structured output.

### 8.1 Removed from external runtime
- Sync/async technical toggle.
- Global app-level run stats as primary content.
- Debug/internal system details.

---

## 9) Permissions and Access Matrix

| Capability | Admin | Member | Public |
|---|---|---|---|
| Create template | Yes | Yes | No |
| Edit own template | Yes | Yes | No |
| Edit others' template | Yes | No | No |
| Publish app from template | Yes | Yes (own) | No |
| Unpublish own app | Yes | Yes | No |
| Seed default apps/templates | Yes | No | No |
| Manage workspace global connections | Yes | No | No |
| Manage personal connections | Yes | Yes | N/A |
| Run internal apps | Yes | Yes | No |
| Run external apps | Yes | Yes | Yes |

---

## 10) Data Model (Target)

Existing entities are reused where possible; add/extend metadata safely.

### 10.1 App Metadata (flow gallery app + template metadata)
- `audience`
- `authMode`
- `runnerMode`
- `publishStatus`
- `inputSchema`
- `secretsSchema`
- `requirements`
- `publishedBy`
- `updated`
- analytics counters

### 10.2 User/Session Runtime Context
- `sessionId` for public runtime.
- `userId` for signed-in runtime.
- scoped run history storage and retrieval.

### 10.3 Connection Binding
- Personal credential binding per user/app/provider.
- Workspace credential binding per platform/project/provider.

---

## 11) API Contract (Target Behavior)

## 11.1 Publisher APIs (signed-in user)
- List publishable templates (owner-scoped for members).
- Publish app with full contract validation.
- Update app metadata.
- Unpublish app.
- Seed defaults (admin only).

## 11.2 Runtime APIs
- Fetch app details for runner.
- Preflight requirement validation endpoint.
- Execute endpoint with safe payload limits and mode determined by product (not exposed as raw technical toggle to public).
- Scoped run history endpoint (session/user scope).

## 11.3 Errors
- Always return user-actionable errors:
  - missing requirement
  - invalid credential
  - invalid input field
  - app unavailable
  - rate limited

---

## 12) UX Requirements

## 12.1 Signed-in Dashboard UX
- Apps and Publisher must feel native to dashboard shell.
- No `Sign in` CTA inside authenticated routes.
- Templates visible and discoverable for members.
- Member-first creation path present and obvious.

## 12.2 Public Storefront UX
- "What this app does" and "What you need" above fold.
- Single primary CTA hierarchy:
  - Start setup
  - Run app
  - Sign in for workspace mode
- Mobile-friendly layout and controls.

## 12.3 Visual Consistency
- Match dashboard theme tokens and branding.
- Remove inconsistent icon placement and action overflow edge cases.

---

## 13) Security, Privacy, and Compliance

- Mask secrets at input and logs.
- Never expose workspace secrets to public runtime.
- Enforce payload size limits.
- Per-IP and per-session/public quota rate limits.
- Optional CAPTCHA for public high-cost apps.
- Audit trail for publish/update/unpublish/execute.

---

## 14) Reliability and Concurrency

- Concurrent runs for same app are allowed.
- Runtime views must be session/user scoped.
- Duplicate-submit guard for same session (short lock window).
- Async runs must show clear queued state and completion visibility.

---

## 15) Default Catalog (Agency First)

## 15.1 Default Apps (Top 5)
1. Meeting Notes -> Basecamp Tasks
2. Image Generator with Project Context
3. Client Update Writer
4. Triage App
5. Kickoff Builder

## 15.2 Default Templates (Top 5)
1. Basecamp project kickoff packet creator
2. Lead intake -> qualification -> Basecamp todo set
3. Design request normalizer + brief generator
4. Bug report -> prioritized task template
5. Campaign brief -> content plan template

## 15.3 Seed Requirements
- Idempotent.
- Safe to rerun.
- Admin-only trigger with confirmation.

---

## 16) QA and Test Plan

## 16.1 Functional
- Member can create template and publish app without admin.
- Member cannot edit other users' templates/apps.
- Public visitor can run external app with setup wizard.

## 16.2 Security
- Secrets never leak in responses or logs.
- Public execution path respects rate limits and payload caps.

## 16.3 UX
- New user first-run usability test:
  - task completion without docs.
  - no blocker confusion at setup steps.

## 16.4 Regression
- End-to-end suite:
  - sign-in flow
  - template lifecycle
  - publish/unpublish
  - internal run
  - external run

---

## 17) Delivery Plan and Milestones

Milestones are implemented in order and mirrored in `docs/APPS_MASTER_TODO.md`:
1. Information architecture + permissions.
2. Member template lifecycle.
3. Publisher wizard redesign.
4. Runtime wizard split.
5. Isolation/safety.
6. Public storefront polish.
7. Catalog seeding.
8. Hardening and release.

No milestone marked complete without evidence matrix update.

---

## 18) Handoff Checklist (Definition of Done)

Before project handoff:
- [ ] All milestone checkboxes complete in `APPS_MASTER_TODO.md`.
- [ ] Evidence matrix filled for every completed item.
- [ ] Production deploy verified.
- [ ] Runbook updated.
- [ ] Rollback plan validated.
- [ ] QA signoff captured.
- [ ] Product demo recorded for:
  - member flow
  - admin flow
  - public flow

---

## 19) Open Questions to Resolve Early

1. Should public app runs require sign-in for high-cost providers by default?
2. What is default retention window for public session run history?
3. Which providers allow personal keys vs workspace-only policy?
4. Should app creator be able to choose if run history is private-by-default for signed-in viewers?

Decisions here must be locked before Phase 4.


