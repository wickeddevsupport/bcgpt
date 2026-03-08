# Figma Design Audit

Use this skill when the user wants a structured review of a Figma file, component library, or design system.

## What To Audit

- Design tokens: color variables, text styles, effect styles, spacing scales, and naming consistency.
- Typography: font families, weight ramps, text style reuse, line-height consistency, and semantic naming.
- Color system: duplicate fills, near-duplicate tokens, missing semantic aliases, and inaccessible contrast pairs.
- Components: detached patterns, duplicate variants, missing component properties, and inconsistent slot behavior.
- Auto-layout: missing auto-layout, broken hugging/fill rules, inconsistent padding, and fragile nested layouts.
- Reusability: repeated groups that should become components, repeated local styles that should become variables, and ad hoc one-off frames.
- Responsiveness: constraints, fill behavior, breakpoints, overflow handling, and layout collapse risks.

## Operating Rules

- Ground findings in the active Figma context if it is available.
- Prefer concrete, fixable observations over generic design commentary.
- Group issues into: critical system drift, repeated medium-severity cleanup, and low-risk polish.
- Call out the exact artifact when possible: page, frame, component set, token group, or style name.
- When information is incomplete, say what is missing instead of inventing file structure.

## Output Shape

Respond with:

1. Overall assessment in 2-4 sentences.
2. Highest-severity findings first.
3. A short remediation plan with the smallest set of changes that will improve consistency fastest.
4. Optional follow-up checks for accessibility, token migration, or component consolidation.

## Useful Prompt Frames

- Audit the current file for design-system drift.
- Review this file for color and typography token hygiene.
- Find components that should be variants or shared primitives.
- Review auto-layout quality and identify brittle frames.
- Suggest a cleanup plan to standardize this file without a full redesign.
