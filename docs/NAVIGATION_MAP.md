# Documentation Navigation Map

Last updated: 2026-02-15

## Fast path (fresh sessions)

Use this exact order:

1. `docs/00-START-HERE.md`
2. `docs/system/operations/summaries/CURRENT_STATE_AND_EXECUTION_PLAN.md`
3. `docs/system/operations/summaries/NEXT_STEPS.md`
4. `docs/system/architecture/SYSTEM_ARCHITECTURE.md`
5. `docs/OPENCLAW_ANALYSIS.md`

## Folder map

```
docs/
|-- 00-START-HERE.md
|-- DOCS_INDEX.md
|-- NAVIGATION_MAP.md
|
|-- bcgpt/      (Data layer: Basecamp + MCP)
|-- flow/       (Execution layer: Activepieces integration)
|-- pmos/       (Intelligence layer: PM OS vision + patterns)
|-- system/     (Architecture, deployment, operations)
```

## Intent-based routing

- "Need current truth and action plan"
  - `docs/system/operations/summaries/CURRENT_STATE_AND_EXECUTION_PLAN.md`

- "Need immediate backlog"
  - `docs/system/operations/summaries/NEXT_STEPS.md`

- "Need full architecture"
  - `docs/system/architecture/SYSTEM_ARCHITECTURE.md`

- "Need OpenClaw extraction strategy"
  - `docs/OPENCLAW_ANALYSIS.md`

- "Need PMOS product vision and roadmap"
  - `docs/pmos/vision/PROJECT_MANAGEMENT_OS.md`
  - `docs/pmos/vision/ROADMAP_VISUAL.md`

- "Need Activepieces/apps execution plan"
  - `docs/flow/apps-platform/APPS_MASTER_TODO.md`

- "Need data layer details"
  - `docs/bcgpt/README.md`
  - `docs/bcgpt/reference/BASECAMP_API_ENDPOINTS_REFERENCE.md`

## Rule for future updates

If docs and code disagree, update docs immediately and always update:

1. `docs/system/operations/summaries/CURRENT_STATE_AND_EXECUTION_PLAN.md`
2. `docs/system/operations/summaries/NEXT_STEPS.md`
3. One layer-specific doc (`bcgpt`, `flow`, or `pmos`)
