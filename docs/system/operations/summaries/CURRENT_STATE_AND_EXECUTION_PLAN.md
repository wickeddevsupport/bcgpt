# PM OS Current State and Execution Plan

Last updated: 2026-02-15
Owner: PM OS core repo (`bcgpt`)
Purpose: single source of truth for "where we are now" and "what to do next" in fresh sessions.

## Latest Rollout (2026-02-15)

- Deployed commits:
  - `7a4d5b2f` (canonical docs + frontend API method alignment)
  - `20802b14` (updated `frontend/dist` production bundle)
- Production verification passed:
  - `https://bcgpt.wickedlab.io/health` returns `ok=true`
  - frontend bundle hash updated to `/assets/index-tn4jd_Jq.js`
  - `/mcp` tool listing works
  - `flow_*` tools still available and return expected auth-gated errors when unauthenticated

### PMOS Deployment Track (2026-02-15)

- Separate PMOS application deployed in Coolify:
  - App: `pmos`
  - Domain: `https://os.wickedlab.io`
  - Compose source: `docker-compose.pmos.yml`
  - Runtime image commit: `283098eb651aa553fbd62d924e99de700abb84cd`
- Live verification passed:
  - `https://os.wickedlab.io/health` returns `200`
  - `https://os.wickedlab.io/api/status` returns `200`
  - PMOS status config now reports:
    - `bcgpt_url: https://bcgpt.wickedlab.io`
    - `flow_url: https://flow.wickedlab.io`
- Incident fix applied:
  - Removed stale generated PMOS app env key `BCGPT_URL=http://bcgpt:10000` from Coolify app runtime env file (`/data/coolify/applications/vg88kok000o8csg8occgcskg/.env`) and recreated PMOS container.
  - This eliminated wrong internal URL routing and aligned PMOS to public BCGPT endpoint.
- BCGPT -> PMOS gateway bridge now verified live:
  - BCGPT runtime env includes `PMOS_URL=https://os.wickedlab.io` (from `scripts/start-bcgpt.sh` + compose defaults).
  - Direct MCP call works: `tools/call` with `pmos_status`.
  - Proxy MCP call works: `tools/call` with `mcp_call` targeting `pmos_status`.
  - `mcp_call` now accepts routed namespace tools (`pmos_*`, `flow_*`) even if not listed in static `getTools()` output.
- Frontend/domain split applied:
  - `bcgpt.wickedlab.io` now serves MCP landing page (`mcp-landing.html`) with primary CTA to `/connect`.
  - PMOS frontend/product surface continues on `https://os.wickedlab.io`.
  - `https://bcgpt.wickedlab.io/connect` remains the API key + Basecamp auth entrypoint.

Critical deploy note:
- Do not use `docker compose -f docker-compose.bcgpt.yml up/down` on the production host for normal BCGPT deploys.
- That stack shares `bcgpt-postgres-data` volume naming and can collide with the running production Postgres container.
- Safe production path:
  1. `git pull` on server
  2. `docker build --no-cache -t bcgptapi-bcgpt:latest -f Dockerfile.bcgpt .`
  3. `bash scripts/start-bcgpt.sh`

## Active Sprint Progress (2026-02-15, production)

- Completed (code + deploy):
  - Added execution audit event logging for `/apps/:id/execute` paths (success, failed, validation failure, payload-too-large, runtime failure).
  - Fixed `AuditEventEntity` schema primary key definition and registered it in DB entity wiring.
  - Fixed telemetry dashboard API paths to use `/apps/api/telemetry/*` endpoints.
- Verified locally:
  - `npx nx build server-api` passed.
  - `npx nx build react-ui` passed.
- Verified on production:
  - `https://flow.wickedlab.io/` returns `200`.
  - `https://flow.wickedlab.io/api/v1/flags` returns `200`.
  - `https://flow.wickedlab.io/apps` returns `200`.
  - `https://flow.wickedlab.io/apps/api/apps?limit=1` returns `200`.
  - `https://flow.wickedlab.io/apps/api/telemetry/platform` returns `403` unauthenticated (expected auth gate).
  - `audit_events` table receives `execute` events from `/apps/:id/execute` requests.
- Pending before declaring Phase D complete:
  - Implement Playwright E2E + CI integration.
  - Complete security hardening pass (rate limits/CORS/secret masking checks).
  - Add PMOS web shell on `os.wickedlab.io/` (currently API-first deployment).

## 0. Non-Negotiable Guardrails

1. Existing `flow_*` integration remains operational and unchanged during migration work.
2. Existing MCP server behavior and `/mcp` contract remain operational and unchanged.
3. New runtime work must be additive (parallel path + feature flag), never destructive.
4. Rollback to current runtime must remain one config switch away.

## 1. Target Product

Build a native, fast, single-repo PM Operating System that combines:

- BCGPT data layer (Basecamp + MCP tools)
- Flow execution layer (Activepieces integration via native code, no iframe)
- PMOS intelligence layer (chat agent, memory, reasoning, automation orchestration)

OpenClaw is used as a pattern source (tool loop, streaming, session model), not as a stack to clone.

## 2. Current Architecture (Code-Backed)

- Monorepo backend entrypoint: `index.js`
- Main app/API port: `10000`
- Frontend app: `frontend/` (built and served by backend)
- MCP gateway + tools: `mcp.js`
- Native Activepieces tools: `flow-tools.js`, `activepieces-client.js`
- Agent runtime: `agent-runtime.js`
- Database layer: `db.js`

### Key API Endpoints (live in code)

- `POST /api/chat`
- `GET /api/chat/stream` (SSE)
- `POST /api/chat/sessions`
- `GET /api/chat/sessions`
- `GET /api/chat/sessions/:sessionId`
- `DELETE /api/chat/sessions/:sessionId`
- `GET /api/config`
- `PUT /api/config`
- `POST /mcp`

Reference: `index.js:4169`, `index.js:4184`, `index.js:4195`, `index.js:4207`, `index.js:4217`, `index.js:4289`, `index.js:4323`, `index.js:4338`, `index.js:4356`

## 3. What Is Already Working

### Chat + PMOS UX

- Right-side AI chat UI is integrated in layout.
- Chat session history listing and session loading are wired.
- Streaming path exists through SSE API.

Reference: `frontend/src/components/Layout.tsx`, `frontend/src/components/ChatSidebar.tsx`, `frontend/src/api.ts`

### Native Flow Integration (Activepieces)

- `flow_*` tools are handled in-repo, not via iframe embedding.
- Tool set includes flow/project/run/pieces/connection operations.

Reference: `flow-tools.js`, `mcp.js:4576`

### Runtime hardening already present

- JSON body parse error guard returns standardized `INVALID_JSON`.
- Request IDs are attached for traceability.

Reference: `index.js:111`, `index.js:124`, `index.js:132`

### Recently closed (2026-02-15)

- Frontend/backend config contract alignment is complete:
  - Frontend `updateUserConfig` uses `PUT /api/config`.
  - Backend handler is `PUT /api/config`.

Reference: `frontend/src/api.ts:173`, `index.js:4338`

## 4. Known Gaps (Must Be Closed)

1. Status docs drift
- Vision docs and historical phase docs still contain point-in-time status tables.
- Action: enforce canonical tracker precedence and keep reconciliation matrix (Section 9) updated.

2. Activepieces coverage is partial
- Core flow tools are present, but not full platform/credential/runtime coverage.
- Action: complete flow tool coverage map and missing operations.

3. Release hardening still pending in code
- Audit/telemetry implementation is deployed and verified; E2E automation and security hardening remain pending.

Reference: `docs/flow/apps-platform/APPS_MASTER_TODO.md`, `docs/system/operations/summaries/NEXT_STEPS.md`

## 5. Execution Plan (Ordered)

### Phase A - Source of truth + interface alignment (no MCP/Flow behavior changes)

1. Update roadmap/status docs to match real code state.
2. Publish a canonical API/tool contract table used by frontend + agent runtime.
3. Keep doc-role boundaries explicit (canonical vs vision vs historical) across PMOS docs.

Completed in Phase A:
- `PUT /api/config` contract alignment (`frontend/src/api.ts` + backend `index.js`).

### Phase B - OpenClaw parity, native stack (parallel v2 runtime only)

1. Tighten agent tool loop behavior and streaming event model.
2. Ensure session/memory/operation-log paths are stable and tested.
3. Keep transport simple (REST + SSE), avoid gateway complexity unless needed.
4. Implement behind `AGENT_RUNTIME=v1|v2` flag with default `v1` until cutover gate is met.

### Phase C - Activepieces depth

1. Expand `flow_*` tool coverage to full required operations.
2. Implement credential resolution strategy:
   - personal credential
   - workspace fallback
   - fail with actionable setup message
3. Add approval gates for destructive/high-risk automation actions.

### Phase D - Hardening gate

1. Add audit event table + logging.
2. Add runtime telemetry + dashboard.
3. Add Playwright E2E + CI.
4. Enforce release gate before "next phase" declaration.

## 6. Fresh Session Boot Protocol

When a new session starts, do this in order:

1. Read this file: `docs/system/operations/summaries/CURRENT_STATE_AND_EXECUTION_PLAN.md`
2. Read immediate backlog: `docs/system/operations/summaries/NEXT_STEPS.md`
3. Read architecture context:
   - `docs/system/architecture/SYSTEM_ARCHITECTURE.md`
   - `docs/OPENCLAW_ANALYSIS.md`
4. Verify code reality:
   - `git status --short`
   - inspect `index.js`, `mcp.js`, `flow-tools.js`, `frontend/src/components/ChatSidebar.tsx`

Do not start new feature work before steps 1-4 are complete.

## 7. Definition of Done for "Ready for Next Phase"

All must be true:

1. Docs reflect code reality (no stale status tables).
2. Frontend and backend API contracts match.
3. Flow orchestration works natively for required operations.
4. E2E smoke suite passes on deployed environment.
5. Monitoring + audit + rollback path are confirmed.
6. Existing Flow + MCP behavior verified unchanged versus baseline.

## 8. Change Log Discipline

Any meaningful platform change must update:

1. This file (`CURRENT_STATE_AND_EXECUTION_PLAN.md`)
2. `docs/system/operations/summaries/NEXT_STEPS.md`
3. Relevant layer doc (`docs/bcgpt/`, `docs/flow/`, or `docs/pmos/`)

## 9. Documentation Reconciliation Matrix (2026-02-15)

| Scope | Primary docs | Role | Use for live execution decisions? | Reconciliation status |
|---|---|---|---|---|
| Session boot + current execution | `docs/00-START-HERE.md`, `docs/DOCS_INDEX.md`, `docs/NAVIGATION_MAP.md`, `docs/system/operations/summaries/CURRENT_STATE_AND_EXECUTION_PLAN.md`, `docs/system/operations/summaries/NEXT_STEPS.md` | Canonical navigation and active backlog | Yes | Reconciled |
| System architecture | `docs/system/architecture/SYSTEM_ARCHITECTURE.md`, `docs/system/architecture/CROSS_LAYER_INTERFACE_STATE.md` | Architecture contracts | Yes | Reconciled |
| OpenClaw strategy | `docs/OPENCLAW_ANALYSIS.md` | Pattern-extraction reference | Yes, for strategy only | Reconciled |
| PMOS vision/spec | `docs/pmos/vision/PROJECT_MANAGEMENT_OS.md`, `docs/pmos/vision/VISION_SUMMARY.md`, `docs/pmos/vision/FEATURES_CATALOG.md`, `docs/pmos/vision/INTELLIGENCE_PATTERNS.md`, `docs/pmos/vision/ROADMAP_VISUAL.md`, `docs/pmos/vision/README.md` | Target-state product design and roadmap intent | No (unless mirrored here) | Reconciled with explicit "vision-only" status notes |
| Flow implementation backlog | `docs/flow/apps-platform/APPS_MASTER_TODO.md`, `docs/flow/apps-platform/APPS_PLATFORM_PRD.md`, `docs/flow/apps-platform/APPS_RELEASE_CHECKLIST.md`, `docs/flow/apps-platform/PRD_APPS_PHASE2.md` | Activepieces execution backlog | Yes, for flow layer delivery | Partially complete (Phase 8 E2E + security tasks remain) |
| BCGPT audits/phases/coverage | `docs/bcgpt/audits/*`, `docs/bcgpt/phases/*`, `docs/bcgpt/coverage/*`, `docs/system/operations/summaries/SESSION_SUMMARY_COMPREHENSIVE_AUDIT.md`, `docs/system/operations/summaries/COMPLETION_REPORT.md` | Historical evidence and point-in-time reports | No | Reconciled as historical-only |
| Deployment/ops hardening | `docs/system/deployment/DEPLOYMENT_GUIDE.md`, `docs/system/deployment/PRODUCTION_HARDENING.md` | Operational runbooks | Yes | Reconciled (compose collision warning anchored in this file) |

### Interpretation rules (mandatory)

1. If any doc conflicts with current code or this tracker, this tracker wins until docs are updated.
2. Vision docs define target capability; they do not assert deployment completion.
3. Historical audits/phases are references, not current sprint status.
