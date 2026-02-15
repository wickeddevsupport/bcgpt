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

Critical deploy note:
- Do not use `docker compose -f docker-compose.bcgpt.yml up/down` on the production host for normal BCGPT deploys.
- That stack shares `bcgpt-postgres-data` volume naming and can collide with the running production Postgres container.
- Safe production path:
  1. `git pull` on server
  2. `docker build --no-cache -t bcgptapi-bcgpt:latest -f Dockerfile.bcgpt .`
  3. `bash scripts/start-bcgpt.sh`

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

## 4. Known Gaps (Must Be Closed)

1. Status docs drift
- Some roadmap tables still say "not started" even though core pieces exist in code.
- Action: update roadmap status from code truth before new feature work.

2. Frontend/backend config method mismatch
- Backend uses `PUT /api/config`; frontend update currently sends `POST`.
- Action: align frontend method with backend contract.

Reference: `index.js:4338`, `frontend/src/api.ts:173`

3. Activepieces coverage is partial
- Core flow tools are present, but not full platform/credential/runtime coverage.
- Action: complete flow tool coverage map and missing operations.

4. Release hardening still pending in code
- Audit events, telemetry dashboards, and E2E automation are documented but not fully implemented.

Reference: `docs/flow/apps-platform/APPS_MASTER_TODO.md`, `docs/system/operations/summaries/NEXT_STEPS.md`

## 5. Execution Plan (Ordered)

### Phase A - Source of truth + interface alignment (no MCP/Flow behavior changes)

1. Update roadmap/status docs to match real code state.
2. Fix `PUT/POST` config mismatch.
3. Publish a canonical API/tool contract table used by frontend + agent runtime.

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
