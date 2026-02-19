# OpenClaw Documentation Index

**Last Updated:** 2026-02-19

---

## Quick Start

New to OpenClaw? Start here:

1. **[OPENCLAW_AUTOMATION_OS.md](OPENCLAW_AUTOMATION_OS.md)** - Master overview of the AI-powered Automation OS
2. **[NEXT_STEPS.md](NEXT_STEPS.md)** - Actionable implementation plan + consolidated current TODO list

---

## Core Documentation

| Document | Purpose | Audience |
|----------|---------|----------|
| [PRODUCT_VISION.md](PRODUCT_VISION.md) | User journey, anti-hallucination, robustness | All |
| [AUTONOMOUS_AGENTS.md](AUTONOMOUS_AGENTS.md) | AI team that works autonomously 24/7 | All |
| [UI_MOCKUPS.md](UI_MOCKUPS.md) | Complete UI mockups for all pages | All |
| [OPENCLAW_AUTOMATION_OS.md](OPENCLAW_AUTOMATION_OS.md) | Master product vision and architecture | All |
| [AGENT_MANAGEMENT.md](AGENT_MANAGEMENT.md) | How users create, configure, and manage agents | All |
| [UI_AUDIT.md](UI_AUDIT.md) | Broken/missing UI elements and gaps | All |
| [AI_PROVIDER_UNIFICATION.md](AI_PROVIDER_UNIFICATION.md) | Plan to unify AI provider config across Integrations & Agents | All |
| [INCONSISTENCIES_AUDIT.md](INCONSISTENCIES_AUDIT.md) | Comprehensive audit of disconnected systems, terminology issues | All |
| [NEXT_STEPS.md](NEXT_STEPS.md) | Implementation plan and tasks | Developers |
| [N8N_INTEGRATION_GUIDE.md](N8N_INTEGRATION_GUIDE.md) | n8n workflow engine integration | Developers |
| [COOLIFY_DEPLOY_NX_RUNBOOK.md](COOLIFY_DEPLOY_NX_RUNBOOK.md) | Coolify + Nx deploy and SSH verification runbook | Developers |
| [WORKSPACE_ISOLATION_STATUS.md](WORKSPACE_ISOLATION_STATUS.md) | Multi-tenant implementation status | Developers |
| [BASECAMP_NODE_SETUP.md](BASECAMP_NODE_SETUP.md) | Custom n8n node for Basecamp | Developers |

---

## Documentation Structure

```
docs/
  README.md                    # Quick start guide
  OPENCLAW_AUTOMATION_OS.md    # Master document
  NEXT_STEPS.md                # Implementation plan
  N8N_INTEGRATION_GUIDE.md     # n8n technical guide
  COOLIFY_DEPLOY_NX_RUNBOOK.md # deployment runbook
  WORKSPACE_ISOLATION_STATUS.md # Multi-tenant status
  BASECAMP_NODE_SETUP.md       # Basecamp node guide
  DOCS_INDEX.md                # This file
  
  backup/                      # Archived documentation
    BACKUP_README.md           # Backup index
    bcgpt/                     # BCGPT reference (archived)
    flow/                      # Flow documentation (archived)
    pmos/                      # PMOS vision (archived)
    system/                    # System docs (archived)
```

---

## Key Topics

### Architecture

- System components and data flow
- n8n integration architecture
- Multi-tenant workspace isolation
- Agent runtime structure

### Implementation

- Workspace isolation completion
- n8n UI embedding
- BYOK (Bring Your Own Keys) management
- Chat-to-workflow creation
- Multi-agent parallel execution

### Deployment

- Primary runbook: [COOLIFY_DEPLOY_NX_RUNBOOK.md](COOLIFY_DEPLOY_NX_RUNBOOK.md)
- NX build/test orchestration (pre-deploy validation)
- Server access via SSH
- Coolify container management
- Container architecture (bcgpt, pmos)
- Deployment verification

---

## Server Access

```bash
# Optional pre-deploy validation (NX)
NX_DAEMON=false corepack pnpm exec nx run-many -t build --projects=openclaw-app,openclaw-control-ui,openclaw-frontend
NX_DAEMON=false corepack pnpm exec nx run openclaw-app:test

# SSH to server
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175

# Deploy runbook
# See docs/COOLIFY_DEPLOY_NX_RUNBOOK.md (keep tokens/secrets out of git)
```

**Note:** NX validates builds/tests; Coolify performs runtime deployment.

- Preferred: deploy via Coolify UI (webhook or manual redeploy).
- If API access is required: SSH to the server and run API calls inside the `coolify` container using a short-lived token, then revoke it (never store tokens in git/docs).
- For faster server builds: set `N8N_VENDOR_IMAGE=ghcr.io/wickeddevsupport/openclaw-n8n-vendor:n8n-1.76.1` in Coolify so n8n is pulled instead of rebuilt.

---

## Deployment URLs

| Service | URL | Purpose |
|---------|-----|---------|
| OpenClaw PMOS | https://os.wickedlab.io | Main product UI (includes embedded n8n) |
| OpenClaw n8n Editor | https://os.wickedlab.io/ops-ui/ | Embedded n8n editor route |
| BCGPT MCP | https://bcgpt.wickedlab.io | MCP server |

---

## Key Code Locations

| Component | Location |
|-----------|----------|
| Gateway Server | `openclaw/src/gateway/` |
| n8n Embed | `openclaw/src/gateway/n8n-embed.ts` |
| n8n Auth Bridge | `openclaw/src/gateway/n8n-auth-bridge.ts` |
| n8n Workspace Triggers | `openclaw/src/gateway/n8n-workspace-triggers.ts` |
| n8n Ops Proxy | `openclaw/src/gateway/pmos-ops-proxy.ts` |
| Workspace Context | `openclaw/src/gateway/workspace-context.ts` |
| Workspace Isolation Tests | `openclaw/src/gateway/workspace-isolation.test.ts` |
| Agent Handlers | `openclaw/src/gateway/server-methods/agents.ts` |
| Cron Handlers | `openclaw/src/gateway/server-methods/cron.ts` |
| Session Handlers | `openclaw/src/gateway/server-methods/sessions.ts` |
| Migration Script | `openclaw/scripts/migrate-workspace-isolation.ts` |
| Basecamp n8n Node | `n8n-nodes-basecamp/` |
| BYOK Encrypted Store | `openclaw/src/gateway/byok-store.ts` |
| BYOK HTTP API | `openclaw/src/gateway/byok-http.ts` |
| Active Control UI | `openclaw/ui/` |
| Automations View | `openclaw/ui/src/ui/views/automations.ts` |
| Main Render Wiring | `openclaw/ui/src/ui/app-render.ts` |
| Vendor Setup Script | `openclaw/scripts/setup-vendor-n8n.sh` |

---

## Session Start Protocol

Before starting work:

1. Read [OPENCLAW_AUTOMATION_OS.md](OPENCLAW_AUTOMATION_OS.md)
2. Read [NEXT_STEPS.md](NEXT_STEPS.md)
3. Read [UI_AUDIT.md](UI_AUDIT.md) - check for UI gaps
4. Check current phase status
5. Run `git status --short`
6. Confirm guardrails

---

## Guardrails

1. **MCP Stability** - Do not change MCP contracts on bcgpt.wickedlab.io
2. **n8n Stability** - Do not break existing embedded n8n workflows and workspace isolation
3. **Additive Development** - PMOS work is additive to OpenClaw core
4. **Rollback Ready** - Every deployment must have immediate rollback path
5. **Smoke Tests** - Every phase must pass smoke checks before complete

---

## Archived Documentation

The following directories have been moved to `docs/backup/`:

- `backup/bcgpt/` - BCGPT-specific documentation
- `backup/flow/` - Flow/Activepieces documentation (now replaced by n8n)
- `backup/pmos/` - PMOS vision documents
- `backup/system/` - System architecture and operations

These are preserved for reference. See [backup/BACKUP_README.md](backup/BACKUP_README.md) for details.

---

## Contributing

When adding new documentation:

1. Place core documents in `docs/` root
2. Update this index file
3. Cross-reference related documents
4. Keep documents focused and actionable
5. Update "Last Updated" dates
