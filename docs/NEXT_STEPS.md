# Next Steps

**Last Updated:** 2026-03-10

## Recently Completed

- **Chat output determinism**: 4-layer output guards across agent loop, PMOS handler, chat broadcast, and non-PMOS path. Tool success always produces a visible answer.
- **Chat panel recovery**: Extended recovery polling from 60s to 120s with auto-clear of stuck state. Sets `chatStreamStartedAt` on reconnect so run completion is detected.
- **Project operating views**: Status Board (Kanban by health status) and Timeline (chronological urgent/due-today items) added to command center alongside Cards view.
- **Basecamp prompt discipline**: System prompt explicitly forbids memory-only answers for project data. Force-tool regex broadened to catch overdue, blockers, deadlines, team, workload, and status report queries.
- **Workflow monitoring**: Dashboard shows flow names instead of IDs, success rate metric, failure callout, and 8 recent runs.

## P0: CI / Quality Gate

- Add Playwright smoke suite in GitHub Actions for Basecamp, FM/Figma, and workflow chat prompts.
- Add post-deploy smoke verification (PMOS root 200, Flow API 200, auth session check).
- Add multi-user isolation regression tests.

## P0: Figma / FM

- Keep FM MCP as the default for file-manager tasks.
- Keep PAT-backed Figma REST audit as the default production audit path.
- Treat official Figma MCP as optional/advanced until OAuth behavior is dependable in production.
- Add targeted prompts/tests for:
  - design audit
  - auto-layout audit
  - components/styles/fonts audit
  - FM tags/folders/categories flows

## P1: Memory

- Improve extraction policy for durable facts vs ephemeral chat chatter.
- Add stronger ranking/recall evaluation on top of current durable session extraction.
- Add restart/redeploy memory regression checks as part of the production smoke path.

## P1: New Capabilities

- Structured design audit reports with actionable recommendations.
- Workspace knowledge graphs for cross-session intelligence.
- Richer project views with person/owner data and workload distribution.

## P2: Cleanup

- Fix 17 pre-existing UI test failures (automations, format, navigation).
- Remove remaining stale `n8n` names from active runtime paths where practical.
- Continue archiving stale top-level docs and one-off audit files into backup/reference areas.
