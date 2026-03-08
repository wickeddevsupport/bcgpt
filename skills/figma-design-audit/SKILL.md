---
name: figma-design-audit
description: Audit Figma files, frames, components, variables, and auto-layout quality using available Figma MCP context. Use when reviewing design systems, screen consistency, accessibility risks, or handoff readiness.
---

# Figma Design Audit

Use this skill when the user wants a structured review of a Figma file, frame, component library, or design system.

## Preconditions

- Prefer active Figma MCP context when it is available.
- With the remote Figma MCP server, use a Figma frame or layer link so the agent can extract the node ID.
- With the desktop Figma MCP server, selection-based prompts are acceptable.
- If the design context is missing, say exactly what is missing instead of inventing file structure.

## Audit Focus

- Tokens and variables: color variables, type scales, spacing tokens, effects, aliases, naming drift.
- Components: duplicate patterns, detached instances, missing variants, weak properties, inconsistent slots.
- Layout: auto-layout quality, padding rules, hug/fill misuse, brittle nesting, responsive collapse risks.
- Accessibility: contrast problems, touch target risks, weak hierarchy, low-state clarity, missing feedback states.
- Handoff readiness: reusable primitives, implementation hints, and code-connect opportunities.

## Suggested MCP Calls

- `get_design_context` for structure, hierarchy, spacing, and implementation context.
- `get_variable_defs` for variables, styles, and token drift.
- `get_screenshot` when visual verification is needed.
- `get_code_connect_map` when comparing design nodes to implemented components.
- `create_design_system_rules` when the user wants reusable implementation guidance from the current system.

## Operating Rules

- Ground findings in concrete artifacts: page, frame, component set, node, style, or variable collection.
- Prefer fixable observations over generic commentary.
- Group issues into:
  - critical system drift
  - repeated medium-severity cleanup
  - low-risk polish
- Call out whether a problem is a design-only issue, a design-system issue, or a handoff issue.

## Output Shape

Respond with:

1. Overall assessment in 2-4 sentences.
2. Highest-severity findings first.
3. A short remediation plan with the smallest set of changes that improves consistency fastest.
4. Optional follow-up checks for accessibility, token migration, or code-connect mapping.
