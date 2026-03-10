# Workspace Isolation Status

**Last Updated:** 2026-03-10

## Scope

This file covers the active production isolation model for:

- PMOS auth and workspace resolution
- workspace config overlays
- workspace connectors
- agent/session/file roots
- durable memory paths
- embedded Flow bootstrap
- FM/Figma connector sync into PMOS

## Current Isolation Model

Current intent and active runtime behavior:

1. User signs into PMOS.
2. PMOS resolves the user and `workspaceId`.
3. Workspace config overlays are merged on top of shared config.
4. Workspace connector state is read from workspace-scoped storage.
5. Agents, sessions, files, and durable memory resolve under workspace-scoped paths.
6. PMOS-authenticated Flow bootstrap opens the correct embedded project context.

## Implementation Matrix

| Domain | Status | Primary Enforcement |
|---|---|---|
| Workspace config overlays | COMPLETE | `openclaw/src/gateway/workspace-config.ts` |
| Workspace connectors | COMPLETE | `openclaw/src/gateway/workspace-connectors.ts` |
| Agent/session workspace routing | COMPLETE | gateway server methods |
| Workspace file roots | COMPLETE | runtime config + UI defaults |
| Durable memory roots | COMPLETE | `openclaw/src/gateway/pmos-auth-http.ts` |
| FM/Figma auth handoff into workspace connectors | COMPLETE | PMOS connector sync + FM context payload |
| Flow bootstrap from PMOS auth | COMPLETE | PMOS auth HTTP + ops proxy |
| Multi-user regression coverage | PARTIAL | still needs broader automated smoke coverage |

## Memory Isolation

Memory should persist across:

- chat sessions
- compaction
- PMOS restarts
- container rebuilds
- source deployments

Current design target is:

- workspace-scoped durable storage
- per-agent memory roots
- no global cross-workspace leakage by default
- optional workspace-level shared facts only when intentionally written

## Remaining Risks

- Retrieval quality and extraction policy still need tuning even though storage is durable.
- Multi-user regression testing should be stronger before claiming this fully hardened.
- Any hotfix that bypasses the workspace config/connector path can still undermine the intended model.

## Verification Checklist

1. Sign into two different workspaces and verify connectors, agents, and chat history do not cross.
2. Verify FM/Figma context in workspace A does not appear in workspace B.
3. Verify Basecamp prompts only use the signed-in workspace connector state.
4. Restart/redeploy PMOS and confirm durable memory remains available.
5. Open embedded Flow from PMOS and confirm project context belongs to the current workspace user.
