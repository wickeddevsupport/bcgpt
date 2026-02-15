# OpenClaw In PMOS (Vendor + Customization Guide)

Last updated: 2026-02-15

This repo includes OpenClaw under `openclaw/`. PMOS is now built directly on OpenClaw (engine + Control UI). This doc explains where to change things and how OpenClaw fits with Activepieces and BCGPT.

## Setup (Production Quickstart)

1. Open `https://os.wickedlab.io` (PMOS).
2. Dashboard -> System:
   - Paste **PMOS Access Key** = `OPENCLAW_GATEWAY_TOKEN` (from Coolify app `pmos` env vars).
   - Click **Connect**.
3. If you see **`disconnected (1008): pairing required`** (first-time browser/device):
   - Approve the browser device from the server:
     - `openclaw devices list`
     - `openclaw devices approve <requestId>`
   - Then refresh the page and click **Connect** again.
4. Go to **Integrations**:
   - Activepieces:
     - Base URL: `https://flow.wickedlab.io`
     - API Key: `ap_...`
     - Project ID: required for flows/runs/connections in Phase 2
   - BCGPT:
     - Base URL: `https://bcgpt.wickedlab.io`
     - API Key: from `https://bcgpt.wickedlab.io/connect`
5. Validate:
   - Automations (Flows) loads a flow list
   - Runs loads recent runs
   - Integrations shows pieces + connections

## Phase 1 Status (Completed)

Phase 1 shipped the PMOS shell + connector onboarding on top of OpenClaw.

Originally deployed: OpenClaw image tag `openclaw-afb4abc1`.

1. PMOS shell navigation + new PMOS-first pages (Dashboard, Integrations, etc).
2. Connector onboarding + health checks:
   - Activepieces + BCGPT status probes and configuration storage.
   - Gateway method: `pmos.connectors.status` (implemented under `openclaw/src/gateway/server-methods/pmos.ts`).

## Phase 2 Status (Completed)

Phase 2 shipped **native Activepieces embed inside PMOS** (no app-switching):

1. Integrations:
   - Pieces catalog (search + browse)
   - Connections CRUD (create/list/delete)
2. Automations (Flows):
   - List + create flows
   - Open flow details
   - Basic mutations (rename, enable/disable, publish, delete)
   - Webhook trigger with payload JSON
   - Advanced FlowOperationRequest editor (raw operation JSON)
3. Runs:
   - List runs + view run details
   - Retry (supported strategies)

Deployed to production: `os.wickedlab.io` (OpenClaw image tag `openclaw-e5cdc472`).

Important: many Activepieces APIs require `projectId`.
Set it in PMOS:
- PMOS -> Integrations -> Activepieces -> Project ID, then Save; or
- CLI: `openclaw config set pmos.connectors.activepieces.projectId <id>`

## What OpenClaw Provides For PMOS

1. A gateway/runtime (sessions, orchestration loop, tool execution patterns).
2. A Control UI (Lit + Vite) for chat and control surfaces.
3. An extension model (`openclaw/extensions/`) for adding connector tools.

PMOS uses OpenClaw as the base. We are not "extracting patterns into a new server". We customize OpenClaw in place.

## Where To Edit (Most Important Paths)

1. UI (PMOS UX changes live here)
   - `openclaw/ui/`
   - This is the app users see at `os.wickedlab.io`.

2. Gateway/runtime (PMOS engine integration points)
   - `openclaw/src/`
   - Use this when you need to add server-side endpoints, event streams, or gateway behaviors.

3. Connector tools (Activepieces + BCGPT adapters)
   - `openclaw/extensions/`
   - Preferred place to add "tools" that call:
     - Activepieces APIs (flows/runs/pieces/connections)
     - BCGPT MCP endpoint (Basecamp + data tools)

4. Skills (prompt modules)
   - `openclaw/skills/`
   - Optional. Use when you want packaged behaviors/personas that ship with PMOS.

## How OpenClaw Deploys As PMOS

PMOS (Coolify app: `pmos`) uses:

1. Compose: `docker-compose.pmos.yml`
2. Build context: `./openclaw`
3. Command: `node dist/index.js gateway --allow-unconfigured --bind lan --port 10001`

Important env:

1. `OPENCLAW_GATEWAY_TOKEN` (required for LAN bind behind Traefik)
2. Optional model/provider auth envs as needed (Claude/OpenAI/etc), set in Coolify.

## How Activepieces Fits (Engine)

Activepieces remains a separate service right now (`flow.wickedlab.io`). PMOS must surface Activepieces functionality natively inside the OpenClaw UI:

1. Flows: list/create/edit/run
2. Runs: timeline, logs, retries
3. Integrations: pieces catalog + connections management

Implementation approach:

1. Add an OpenClaw extension (e.g. `openclaw/extensions/activepieces/`) that exposes tools like:
   - `ap_flows_list`, `ap_flow_get`, `ap_flow_update`, `ap_flow_run`
   - `ap_pieces_list`, `ap_connections_list`, `ap_connection_upsert`
2. The tools call Activepieces HTTP APIs using:
   - `ACTIVEPIECES_URL` (default `https://flow.wickedlab.io`)
   - `ACTIVEPIECES_API_KEY` (per user/workspace long-term; bootstrap with one key first)
3. OpenClaw Control UI calls these tools and renders the PMOS-native screens.

Guardrail: do not require users to "switch apps" to manage flows. The PMOS UI must be the primary surface.

## How BCGPT Fits (Connector)

BCGPT remains the MCP/connect surface (`bcgpt.wickedlab.io`).

1. PMOS should support BCGPT connect as an onboarding option.
2. PMOS should store the user's BCGPT API key as a connector credential.
3. PMOS tools call BCGPT MCP endpoints to execute Basecamp/data actions.

Guardrail: PMOS adapts to MCP contracts; do not change MCP tool names/behavior as part of PMOS work unless explicitly approved.

## Local Dev (When You Need It)

OpenClaw:

1. `cd openclaw`
2. `pnpm install`
3. Run gateway dev:
   - `pnpm gateway:dev`
4. Run UI dev:
   - `pnpm ui:dev`

Notes:

1. OpenClaw uses Node >= 22 and pnpm.
2. The production container uses `openclaw/Dockerfile` and runs the built `dist/` gateway.

## The PMOS Build Order (OpenClaw First)

1. Streamline OpenClaw Control UI into the PMOS shell (nav + dashboard scaffolding).
2. Add Activepieces connector tools (HTTP adapter) + PMOS Flows/Integrations screens.
3. Add PMOS identity (email auth) + RBAC/admin.
4. Add AI-assisted flow creation (graph-ops streaming and commit to Activepieces).
