# PMOS / OpenClaw Docs

**Last Updated:** 2026-03-10

This docs directory now has one rule: top-level docs should describe the current production/runtime truth, not old planning snapshots.

Start here:

1. [DOCS_INDEX.md](DOCS_INDEX.md)
2. [PMOS_ACTIVEPIECES_STATUS.md](PMOS_ACTIVEPIECES_STATUS.md)
3. [ROADMAP_AND_STATUS.md](ROADMAP_AND_STATUS.md)
4. [COOLIFY_DEPLOY_NX_RUNBOOK.md](COOLIFY_DEPLOY_NX_RUNBOOK.md)

## Current Runtime Shape

- PMOS: `https://os.wickedlab.io`
- Flow / Activepieces: `https://flow.wickedlab.io`
- BCGPT Basecamp gateway: `https://bcgpt.wickedlab.io`
- FM (Figma File Manager): `https://fm.wickedlab.io`
- Local Ollama orchestration: `https://bot.wickedlab.io`

PMOS is the main user surface. It owns workspace auth, workspace config, agent runtime, memory, chat, and embedded integrations.

## Current Integration Model

- Basecamp: PMOS uses the BCGPT MCP/data gateway. `bcgpt_smart_action` is the preferred general Basecamp tool.
- Workflows: Flow / Activepieces is the live workflow engine. Embedded vendored `n8n` is legacy-only.
- Figma design analysis: official Figma MCP is optional and can fail on OAuth/auth constraints. PAT-backed REST audit is the reliable fallback.
- FM file management: FM MCP is separate from official Figma MCP. Use FM for files/tags/folders/categories/links and Figma REST/MCP for document analysis.
- Memory: workspace-scoped durable memory lives under persistent OpenClaw workspace storage and now includes extracted durable session notes.

## Doc Hygiene Rules

- Top-level docs are active docs only.
- Stale plans, audits, mockups, and n8n-first material belong under [`docs/backup/`](backup/).
- If a doc describes historical behavior, mark it as archive/reference instead of current truth.
