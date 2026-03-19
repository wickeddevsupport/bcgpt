# Documentation Index

**Last Updated:** 2026-03-10

## Canonical Top-Level Docs

| Document | Purpose |
|---|---|
| [README.md](README.md) | quick orientation |
| [PMOS_ACTIVEPIECES_STATUS.md](PMOS_ACTIVEPIECES_STATUS.md) | current production/runtime truth |
| [ROADMAP_AND_STATUS.md](ROADMAP_AND_STATUS.md) | what is shipped, partial, and next |
| [COOLIFY_DEPLOY_NX_RUNBOOK.md](COOLIFY_DEPLOY_NX_RUNBOOK.md) | deploy and verify PMOS/Flow via Coolify |
| [WORKSPACE_ISOLATION_STATUS.md](WORKSPACE_ISOLATION_STATUS.md) | workspace, connector, and memory isolation status |
| [NEXT_STEPS.md](NEXT_STEPS.md) | execution priorities from the current repo state |
| [COOLIFY_HOST_OWNERSHIP_GUARDRAILS.md](COOLIFY_HOST_OWNERSHIP_GUARDRAILS.md) | production host/deploy safety |
| [DEPLOYMENT_AUTO_UPDATE.md](DEPLOYMENT_AUTO_UPDATE.md) | automation around image/build update flow |
| [PRODUCT_VISION.md](PRODUCT_VISION.md) | product direction, not runtime truth |
| [BASECAMP_PMOS_PARITY_CHECKLIST.md](BASECAMP_PMOS_PARITY_CHECKLIST.md) | Basecamp capability parity checklist and PMOS UX/data backlog |

## What To Treat As Current Truth

Use these statements as the current baseline:

- PMOS is the primary product surface.
- Flow / Activepieces is the live workflow runtime.
- BCGPT is the Basecamp gateway and MCP/data layer.
- FM is the Figma File Manager and separate from official Figma access.
- Official Figma MCP and PAT-backed Figma REST audits are separate paths.
- Workspace memory, connectors, agents, sessions, and files are intended to be workspace-scoped and durable across deployments.

## Archived / Reference Material

Historical planning, audits, one-off investigations, n8n-first docs, UI mockups, and stale migration notes live under:

- [`docs/backup/`](backup/)
- [`docs/backup/top-level-legacy/`](backup/top-level-legacy/)

If a doc is not listed in the canonical table above, assume it is reference material unless explicitly refreshed.
