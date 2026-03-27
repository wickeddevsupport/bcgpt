# PMOS Priming Report

Date: 2026-03-27
Scope: TODO List #1 — Baseline Separation + Runtime Sanity

## Executive Summary
PMOS is already running a workspace-native multi-agent model. The global `openclaw.json` may show `agents.list: []`, but active behavior is sourced from workspace configs under `/app/.openclaw/workspaces/<workspaceId>/config.json`.

Discord non-mention mode has been explicitly configured and is now deterministic in runtime config.

## What was validated

### 1) Runtime container + config baseline
- Active PMOS container confirmed.
- Timestamped backup created for global runtime config:
  - `/app/.openclaw/openclaw.json.prime.20260327-163830.bak`

### 2) Discord non-mention behavior (PMOS)
- In active PMOS runtime config:
  - `channels.discord.groupPolicy = "open"`
  - `channels.discord.guilds."*".requireMention = false`
  - `channels.discord.guilds."*".channels."*" = { allow: true, requireMention: false }`
- Gateway restart/reload and Discord relogin observed in logs.

### 3) Workspace separation reality check
- PMOS uses workspace-native separation in:
  - `/app/.openclaw/workspaces/<workspaceId>/...`
- Active workspace config inspected (workspace id `67475cbf-9954-4b4f-b0f2-fd3fcfc2b563`) and contains a populated `agents.list` with specialized agents.
- Session stores are separated per workspace and per agent under workspace paths.

## Key findings

1. **Global vs Workspace config divergence is expected in PMOS**
   - Global `openclaw.json` does not represent final active agent topology.
   - Workspace config is the source of truth for agent list/topology.

2. **State sprawl exists**
   - Many historical workspace IDs and legacy agent directories remain.
   - Not blocking runtime now, but increases operational complexity.

3. **Discord channel behavior now explicitly set**
   - Non-mention responses in guild channels are now config-driven and explicit.

## TODO List #1 status
- [x] Capture PMOS runtime snapshot
- [x] Enforce/verify explicit Discord non-mention config
- [x] Validate runtime health after restart
- [~] Canonical agent/workspace structure in global config (not authoritative for PMOS; moved to workspace-level plan)
- [x] Record findings

## TODO List #2 Results — Routing + Workspace Isolation

### Canonical workspace selected
- **Production canonical workspace ID:** `67475cbf-9954-4b4f-b0f2-fd3fcfc2b563`
- Agent count in canonical workspace config: **9**
- Agent IDs: `assistant`, `dev-agent`, `pm-agent`, `qa-agent`, `seo-agent`, `design-agent`, `sales-agent`, `marketing-agent`, `heartbeat-agent`

### Route determinism checks
- Workspace bindings present: **8**
- Discord routing config present in workspace config (`groupPolicy`, `guilds`, per-channel controls).
- This confirms PMOS is using workspace-level routing rules rather than global-only defaults.

### Isolation checks
- Workspace path isolation mismatches: **0** (all canonical agents resolve inside canonical workspace path)
- Per-agent session stores for canonical agents: **all present** under:
  - `/app/.openclaw/workspaces/<workspaceId>/agents/<agentId>/sessions/sessions.json`
- `tools.agentToAgent.enabled`: **true**
- Commander (`assistant`) subagent allowlist: `[*]` (delegate orchestration enabled)

### Dry-run cleanup inventory (no deletion performed)
- Stale workspace directories (excluding canonical): **34**
- Legacy top-level agent dirs outside canonical set: **8**
  - `aa`, `growth-hacker`, `main`, `personal-assistant`, `pmos-e2e-1771967136372`, `pw_ws_agent_1771863824054`, `pw_ws_debug_1771863920488`, `research-agent`

## Next TODO (List #3)
1. End-to-end channel behavior tests (Discord/Telegram/Webchat) against canonical workspace.
2. Manual Coolify deploy + post-deploy smoke + rollback check.
3. Freeze baseline config templates for dev/staging/prod and document promotion flow.
