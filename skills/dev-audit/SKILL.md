---
name: dev-audit
description: Audit a codebase or feature for bugs, regressions, architecture risk, missing tests, performance issues, and deployment hazards. Use when the user asks for a dev audit, engineering audit, codebase health check, or implementation review.
---

# Dev Audit

Use this skill when the user wants an engineering audit rather than implementation work.

## Primary Audit Areas

- Correctness: bugs, broken assumptions, race conditions, state drift, error handling gaps.
- Regression risk: fragile codepaths, partial migrations, stale compatibility layers, hidden coupling.
- Test posture: missing unit coverage, absent integration checks, weak smoke coverage, unverifiable fixes.
- Maintainability: oversized files, duplicate logic, unclear ownership, configuration sprawl.
- Performance: slow renders, repeated fetches, wasteful work, blocking operations, hot paths.
- Security and operations: secret handling, auth boundaries, unsafe defaults, broken rollback paths.

## Working Style

- Start from the code and tests, not opinions.
- Prioritize findings by severity and user impact.
- Tie each finding to a file, subsystem, or workflow.
- Flag where docs and implementation disagree.

## Output Shape

Respond with:

1. Highest-severity findings first.
2. Open questions or assumptions.
3. A compact remediation sequence.

If no major issues are found, say that explicitly and still note residual testing or deployment risk.
