# PMOS Production Status

**Last Updated:** 2026-03-10

## Current Production Shape

- PMOS (`https://os.wickedlab.io`) is the main user-facing product.
- Flow / Activepieces (`https://flow.wickedlab.io`) is the live workflow engine.
- BCGPT (`https://bcgpt.wickedlab.io`) is the Basecamp gateway / MCP data plane.
- FM (`https://fm.wickedlab.io`) is the Figma File Manager and exposes FM MCP tools.
- Local Ollama (`https://bot.wickedlab.io`) is available for memory orchestration and cheap local AI support.

## What Is Working

### PMOS Core

- Workspace auth, sessions, and workspace config overlays are live.
- PMOS embeds Flow surfaces inside `/ops-ui`.
- Dashboard, projects, connections, chat, and Figma panels are live UI paths.
- Chat timeline UI now shows live thinking/tool/status events rather than only final blobs.
- Deterministic output guards ensure tool success always produces a user-visible answer.
- Chat panel state recovers gracefully after hard refresh via 120s recovery polling.

### Basecamp

- Basecamp token/config flows through PMOS workspace connectors.
- PMOS uses BCGPT tools directly in chat.
- `bcgpt_smart_action` is the preferred general Basecamp tool.
- Project listing and project panel snapshots use live Basecamp data, not just static config.
- System prompt forces live tool calls for project/todo/overdue/blocker/deadline/team queries -- memory-only answers are blocked.
- Force-tool regex detects Basecamp-related queries and routes to `bcgpt_smart_action` or `bcgpt_list_projects` automatically.

### Project Operating Views

- Command center offers 3 view modes: Cards, Status Board, and Timeline.
- **Cards**: Project cards with health status, todo counts, Basecamp links, and "Use in Chat" shortcuts.
- **Status Board**: Kanban-style 4-column board grouping projects by health (At Risk / Needs Attention / On Track / Quiet).
- **Timeline**: Chronological view of urgent and due-today items with color-coded overdue indicators.
- All views consume the same live `PmosProjectsSnapshot` from the gateway.

### Workflows

- Flow / Activepieces is the active workflow runtime.
- PMOS embeds workflow and connection surfaces instead of relying on the old custom shell.
- Flow credentials and project context are workspace-aware from PMOS bootstrap.
- Dashboard shows workflow names, success rate, failure callouts, and 8 recent runs.

### Figma + FM

- FM MCP is wired from `fm.wickedlab.io` into PMOS workspace chat.
- FM MCP is for file-manager operations only: files, tags, folders, categories, links, sync state.
- Official Figma access and PAT-backed REST audits are separate from FM.
- PAT-backed Figma REST audit is the reliable design-analysis fallback when official Figma MCP auth is unavailable.
- PMOS now explicitly distinguishes FM MCP failure from official Figma MCP failure.

### Memory

- Workspace memory persists under the durable OpenClaw volume, not only in live session state.
- Per-agent session transcripts now generate durable extracted session notes.
- Memory orchestration via local Ollama is enabled with `qwen3:1.7b`.
- Compaction defaults were loosened so chat compacts less aggressively than before.

## Current Runtime Defaults

- Shared primary model: `kilo/minimax/minimax-m2.5:free`
- Local orchestration fallback: `local-ollama/qwen3:1.7b`
- Memory orchestration model: `qwen3:1.7b`
- Default compaction posture:
  - `contextTokens: 200000`
  - `reserveTokensFloor: 4000`
  - `maxHistoryShare: 0.82`
  - `memoryFlush.enabled: false`

These defaults are enforced through:

- `scripts/prime-openclaw-state.mjs`
- `scripts/reset-and-seed.js`
- `openclaw/src/gateway/pmos-auth-http.ts`

## Current Figma Routing Rule

- Use `fm_*` tools for FM metadata and file-manager work.
- Use `figma_get_context` first for design/document tasks.
- Use official `figma_mcp_*` only when live official Figma MCP is actually needed and available.
- If official Figma MCP fails on auth/OAuth, use `figma_pat_audit_file` and continue with a PAT-backed REST audit.

## Still Partial / Still Risky

- Official Figma MCP remains less reliable than PAT-backed REST audit in production.
- Full CI coverage for multi-user production regression is still not the default gate.
- Memory retrieval/ranking quality needs improvement within the current Ollama setup.
- Remaining internal naming still contains historical `n8n` terminology in some paths.

## Operational Truth

Source-of-truth deployment is:

1. tracked source in git
2. push to `main`
3. Coolify deploy
4. smoke verify PMOS + Flow

Do not treat in-container hotfixes as the final state.
