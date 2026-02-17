# PMOS System Architecture (OpenClaw + Activepieces and Wicked Ops/n8n)

Last updated: 2026-02-17

PMOS is one product UI/UX built on top of proven engines. We do not rebuild OpenClaw, Activepieces, or Wicked Ops from scratch. We customize and integrate them.

## What Runs Where (Current)

1. `os.wickedlab.io`
   - PMOS product surface.
   - Runs OpenClaw gateway + Control UI from `openclaw/`.
   - Deployed via `docker-compose.pmos.yml` in the Coolify app named `pmos`.

2. `flow.wickedlab.io`
   - Activepieces (automation engine).
   - Stays operational and unchanged unless explicitly approved.

3. `bcgpt.wickedlab.io`
   - BCGPT MCP server + Basecamp OAuth connect surface (`/connect`).
   - Stays operational and unchanged unless explicitly approved.

4. `ops.wickedlab.io`
   - Wicked Ops (n8n) — self-hosted n8n instance(s) used for workspace-level workflow automation and the Basecamp node.
   - Provides Projects API and API-key management; PMOS can provision per-workspace Projects + API keys where supported.
   - Deployed and integrated; PMOS dashboard exposes provisioning + manual API-key fallback for workspace connectors.

## Engines In This Repo

1. `openclaw/`
   - OpenClaw engine and Control UI (Lit + Vite).
   - PMOS "base" runtime and UI shell are built here.

2. `activepieces/`
   - Activepieces engine and UI codebase (vendored).
   - One supported flow engine for PMOS; used for Flow Pieces screens.

3. `wicked-ops/` (n8n integration)
   - Wicked Ops (n8n) integration surfaced via `openclaw/extensions/wicked-ops/`.
   - Supports per-workspace Project provisioning, API-key management, workflow CRUD and Basecamp node operations.

3. Repo root (BCGPT)
   - MCP server, Basecamp OAuth, MCP tools, Flow tool wrappers.

## Product Goal

One unified app experience in `os.wickedlab.io`:

1. Chat/agent orchestration (OpenClaw patterns).
2. Deep native flow creation/editing/runs/logs inside PMOS UI (supports Activepieces and Wicked Ops / n8n — PMOS can surface either engine; per-workspace n8n Projects + API-key provisioning is available).
3. Connectors for data and actions (BCGPT MCP tools is one connector among many).
4. Admin and identity owned by PMOS (workspaces, roles, policies, audit).

No app switching and no iframe-first dependency for core workflows.

## Integration Boundaries (Guardrails)

1. BCGPT is treated as an external connector from the PMOS perspective.
   - PMOS must adapt to BCGPT MCP tool contracts as-is.
   - Do not change tool names/behavior on `bcgpt.wickedlab.io` unless explicitly approved.

2. Activepieces is treated as an engine.
   - PMOS UI and OpenClaw extensions call Activepieces APIs to list/create/update/run flows and manage connections/pieces.
   - Do not break `flow.wickedlab.io` behavior.

## Near-Term Architecture (v1)

PMOS is the OpenClaw app plus PMOS-specific extensions:

PMOS UI (OpenClaw Control UI, customized)
  -> OpenClaw gateway (same service)
     -> tool/adapters:
        - Activepieces adapter (flows/runs/pieces/connections) and Wicked Ops (n8n) adapter (workspace Projects, api-keys, workflow CRUD)
        - BCGPT adapter (MCP tools for Basecamp/data)
  -> events streamed back into PMOS UI

Implementation strategy:

1. Put PMOS UX changes in `openclaw/ui/`.
2. Put PMOS connector/tooling in `openclaw/extensions/` (or `openclaw/src/agents/tools/` if it is core-level).
3. Keep deployment simple: `docker-compose.pmos.yml` builds OpenClaw and exposes it on port `10001`.

## Long-Term Architecture (v2 Options)

Once PMOS identity and admin exist, we can optionally migrate Activepieces into the same PMOS stack to reduce cross-app friction:

1. Run Activepieces services inside the PMOS compose stack.
2. Unify auth (SSO) and surface Activepieces capabilities through PMOS UI.
3. Keep a hard internal boundary so Activepieces can still be upgraded.

## Deployment Entry Points

1. PMOS (OpenClaw)
   - Compose: `docker-compose.pmos.yml`
   - Source: `openclaw/`

2. Activepieces
   - Compose: `docker-compose.activepieces.yml`
   - Source: `activepieces/`

3. BCGPT MCP server
   - Production start: `scripts/start-bcgpt.sh`
   - Dev compose: `docker-compose.bcgpt.yml`

