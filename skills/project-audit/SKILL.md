---
name: project-audit
description: Audit an app, website, or client project for delivery readiness across scope, docs, architecture, QA, deployment, analytics, and operational risk. Use when the user asks for a project audit, readiness check, or agency delivery review.
---

# Project Audit

Use this skill for project-level audits, not line-by-line code review.

## What To Audit

- Scope clarity: goals, audience, core flows, acceptance criteria, open questions.
- Design coverage: source of truth, Figma linkage, design-system status, responsive coverage.
- Engineering status: architecture, critical dependencies, feature completeness, known breakpoints.
- QA posture: smoke tests, regression coverage, manual test gaps, staging/prod verification.
- Delivery readiness: deployment method, rollback path, monitoring, analytics, SEO, content readiness.
- Operational risk: missing owners, undocumented secrets, unclear environments, brittle handoffs.

## Process

1. Read the closest source-of-truth docs first.
2. Inspect the repo structure and deployment/config files.
3. Identify mismatches between stated status and code or runtime reality.
4. Separate blocking issues from cleanup work.

## Output Shape

Respond with:

1. Overall status: green, yellow, or red.
2. Blockers first.
3. Significant gaps next.
4. A shortest-path remediation plan grouped into:
   - must fix before delivery
   - should fix next
   - can defer

## Rules

- Prefer evidence from docs, code, tests, and config over assumptions.
- Call out stale docs explicitly.
- Be specific about what is missing: owner, test, environment variable, deployment step, design source, or acceptance criteria.
