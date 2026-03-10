# Next Steps

**Last Updated:** 2026-03-10

## P0: Chat Reliability

- Add deterministic output guards for every major tool family, not just Basecamp/Figma/FM.
- Persist and expose run-state more authoritatively so every chat panel survives hard refresh mid-run.
- Add regression tests for "tool succeeded but assistant returned nothing".

## P0: Figma / FM

- Keep FM MCP as the default for file-manager tasks.
- Keep PAT-backed Figma REST audit as the default production audit path.
- Treat official Figma MCP as optional/advanced until OAuth behavior is dependable in production.
- Add targeted prompts/tests for:
  - design audit
  - auto-layout audit
  - components/styles/fonts audit
  - FM tags/folders/categories flows

## P0: Basecamp

- Tighten Basecamp prompt discipline so live BCGPT tools are always preferred over memory-only answers.
- Continue reducing slow or redundant smart-action loops.
- Add direct tests for project list, project summary, overdue work, and person/task lookup flows.

## P1: Memory

- Improve extraction policy for durable facts vs ephemeral chat chatter.
- Add stronger ranking/recall evaluation on top of current durable session extraction.
- Add restart/redeploy memory regression checks as part of the production smoke path.

## P1: CI / Ops

- Add Playwright or API smoke for Basecamp, FM/Figma, and workflow chat prompts in CI.
- Add multi-user isolation smoke coverage.
- Keep Coolify deploy verification documented and repeatable.

## P2: Cleanup

- Remove remaining stale `n8n` names from active runtime paths where practical.
- Continue archiving stale top-level docs and one-off audit files into backup/reference areas.
- Trim duplicate product/planning docs so the active top-level set stays small.
