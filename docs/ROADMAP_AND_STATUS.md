# OpenClaw Automation OS - Roadmap & Current Status

**Generated:** 2026-02-18
**Author:** Link 🔮

---

## Vision

**"Your AI Team That Works For You"**

OpenClaw is an AI-powered Automation OS where users get specialized autonomous agents that work 24/7. Not just chat — real actions, real workflows, real results.

### Core Experience

1. **Login** → Auto workspace + n8n provisioning
2. **BYOK** → Bring your own AI keys (OpenAI, Anthropic, etc.)
3. **Chat** → Natural language interface for everything
4. **Agents** → Create specialized agents (Sales, PM, Dev, Support)
5. **Workflows** → AI creates n8n workflows from chat
6. **Automation** → Agents work autonomously, notify when needed

### Anti-Hallucination Architecture

| Problem | Solution |
|---------|----------|
| AI hallucinates | n8n workflows use real APIs |
| Actions unreliable | Workflows are deterministic |
| No audit trail | Every execution logged |
| Context loss | Workflow state persists |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER EXPERIENCE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│   │   Control    │    │   Embedded   │    │    Chat      │      │
│   │     UI       │    │    n8n       │    │   Sidebar    │      │
│   │  (React)     │    │   Editor     │    │              │      │
│   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│          │                   │                   │               │
└──────────┼───────────────────┼───────────────────┼───────────────┘
           │                   │                   │
           └───────────────────┼───────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│                         GATEWAY                                  │
├──────────────────────────────┼──────────────────────────────────┤
│                              │                                   │
│   ┌──────────────┐    ┌──────▼───────┐    ┌──────────────┐      │
│   │    Auth &    │    │   Workspace  │    │    Agent     │      │
│   │   Sessions   │    │   Context    │    │   Runtime    │      │
│   └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                                  │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│   │    BYOK      │    │   Cron &     │    │   Ops        │      │
│   │   Key Store  │    │   Schedules  │    │   Proxy      │      │
│   └──────────────┘    └──────────────┘    └──────┬───────┘      │
│                                                   │               │
└───────────────────────────────────────────────────┼───────────────┘
                                                    │
┌───────────────────────────────────────────────────┼───────────────┐
│                         n8n ENGINE                                │
├───────────────────────────────────────────────────┼───────────────┤
│                                                    │               │
│   ┌──────────────┐    ┌──────────────┐    ┌──────▼───────┐      │
│   │  Workflows   │    │    Nodes     │    │   Triggers   │      │
│   │   (JSON)     │    │  (400+ types)│    │  (Webhooks)  │      │
│   └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                                  │
│   ┌──────────────┐    ┌──────────────┐                          │
│   │   Custom     │    │   Basecamp   │                          │
│   │   Nodes      │    │    Node      │                          │
│   └──────────────┘    └──────────────┘                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│                      EXTERNAL SERVICES                           │
├──────────────────────────────┼──────────────────────────────────┤
│                              │                                   │
│   ┌──────────────┐    ┌──────▼───────┐    ┌──────────────┐      │
│   │   Basecamp   │    │   GitHub     │    │    Slack     │      │
│   └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                                  │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│   │    Email     │    │   Calendar   │    │   400+ more  │      │
│   └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Roadmap Phases

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  PHASE 1          PHASE 2          PHASE 3          PHASE 4                 │
│  Foundation       Integration      Intelligence     Autonomy                │
│  ─────────        ─────────        ─────────        ─────────               │
│                                                                              │
│  ✅ COMPLETE      ✅ COMPLETE      🔄 IN PROGRESS   ⏳ NOT STARTED           │
│                                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │Workspace │    │  Embed   │    │  n8n UI  │    │ Chat-to- │              │
│  │Isolation │───▶│   n8n    │───▶│ Integration│──▶│ Workflow │              │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
│        │              │               │               │                     │
│        ▼              ▼               ▼               ▼                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │   Auth   │    │  Custom  │    │  BYOK    │    │ Multi-   │              │
│  │  System  │    │   Auth   │    │Management│    │  Agent   │              │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
│        │              │               │               │                     │
│        ▼              ▼               ▼               ▼                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │  Agent   │    │Workspace │    │  Agent   │    │  Live    │              │
│  │   CRUD   │    │ Triggers │    │ Templates│    │  Flow    │              │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase Details

### Phase 1: Foundation ✅ COMPLETE

**Goal:** Multi-tenant workspace isolation + core auth

| Component | Status | File Location |
|-----------|--------|---------------|
| Auth System | ✅ | `openclaw/src/gateway/auth.ts`, `pmos-auth-http.ts` |
| Role Bootstrap | ✅ | First user = super_admin |
| Workspace Context | ✅ | `workspace-context.ts`, `workspace-config.ts` |
| Agent CRUD | ✅ | `server-methods/agents.ts` |
| Session Filtering | ✅ | `server-methods/sessions.ts` |
| Cron Filtering | ✅ | `server-methods/cron.ts` |
| Workspace Configs | ✅ | `workspace-config-http.ts` |

### Phase 2: Integration ✅ COMPLETE

**Goal:** Embed n8n source + custom auth/triggers

| Component | Status | File Location |
|-----------|--------|---------------|
| n8n Vendored | ✅ | `openclaw/vendor/n8n` (v1.76.1) |
| n8n Embed | ✅ | `n8n-embed.ts` |
| Auth Bridge | ✅ | `n8n-auth-bridge.ts` |
| Workspace Triggers | ✅ | `n8n-workspace-triggers.ts` |
| Custom Nodes | ✅ | `vendor/n8n/custom/nodes/n8n-nodes-basecamp` |
| Ops Proxy | ✅ | `pmos-ops-proxy.ts` |

### Phase 3: Intelligence 🔄 IN PROGRESS

**Goal:** n8n UI integration + BYOK + agent templates

| Component | Status | Details |
|-----------|--------|---------|
| Control UI Native Workflows | ✅ | No new-tab redirect |
| BYOK Management | ✅ | `byok-store.ts`, `byok-http.ts` |
| n8n UI Branding | ⏳ | Custom styling pending |
| Agent Templates | ⏳ | Pre-built agents not started |
| Chat Sidebar | ⏳ | Integrated chat in flow builder |

### Phase 4: Autonomy ⏳ NOT STARTED

**Goal:** Chat-to-workflow + multi-agent + live flow builder

| Component | Status | Details |
|-----------|--------|---------|
| Chat-to-Workflow | ⏳ | Natural language → n8n JSON |
| Multi-Agent Parallel | ⏳ | Concurrent agent execution |
| Live Flow Builder | ⏳ | Real-time canvas updates |
| Agent Dashboard | ⏳ | Multi-agent status view |
| Template Library | ⏳ | Pre-built workflow templates |

---

## Current Status (2026-02-18)

### Production Deployments

| Service | URL | Status |
|---------|-----|--------|
| MCP Server | bcgpt.wickedlab.io | ✅ Healthy (bcgpt-full-v3) |
| PMOS UI | os.wickedlab.io | ✅ Running |
| Embedded n8n | os.wickedlab.io/ops-ui/ | ✅ Running |
| n8n REST API | os.wickedlab.io/rest/* | ✅ Responding |

### Completed P0 Items

- [x] Remove Activepieces from runtime path
- [x] Fix embedded n8n path discovery
- [x] Add workspace connector schema
- [x] Fix config filtering bugs
- [x] Deploy via Coolify on main branch
- [x] Smoke test production routes

### Remaining P0 Items

- [ ] Fix pre-existing test suites (outside PMOS scope)
- [ ] Configure prebuilt vendor image for faster deploys

### P1 Cleanup Items

- [ ] Archive `openclaw/extensions/pmos-activepieces/`
- [ ] Remove stale "Flow Pieces" wording
- [ ] Finish n8n UI branding customization

---

## Immediate Next Steps

### Option A: Polish Current Features
1. **n8n UI Branding** — Customize n8n editor for OpenClaw look/feel
2. **Agent Templates** — Create pre-built agent configurations
3. **Chat Sidebar** — Integrate chat into flow builder
4. **Testing** — Fix failing test suites

### Option B: Start Phase 4 Features
1. **Chat-to-Workflow Parser** — Natural language → workflow JSON
2. **Workflow Generator** — Create n8n workflows from parsed intent
3. **Preview System** — Show workflow before creation
4. **Multi-Agent Orchestrator** — Parallel agent execution

### Option C: Infrastructure & DX
1. **Prebuilt Vendor Image** — Faster deploys via `ghcr.io/wickeddevsupport/openclaw-n8n-vendor`
2. **CI/CD Pipeline** — Automated Nx validation
3. **Monitoring** — Better observability for production
4. **Documentation** — API docs, user guides

---

## Key Files Reference

| Area | Location |
|------|----------|
| Gateway Core | `openclaw/src/gateway/` |
| Auth System | `openclaw/src/gateway/auth.ts`, `pmos-auth-http.ts` |
| n8n Integration | `openclaw/src/gateway/n8n-embed.ts`, `pmos-ops-proxy.ts` |
| Workspace Isolation | `openclaw/src/gateway/workspace-context.ts` |
| BYOK | `openclaw/src/gateway/byok-store.ts` |
| Agent Runtime | `openclaw/src/gateway/server-methods/agents.ts` |
| Control UI | `openclaw/ui/src/ui/` |
| Vendored n8n | `openclaw/vendor/n8n/` |
| Custom Nodes | `openclaw/vendor/n8n/custom/nodes/` |
| Deployment | `Dockerfile.openclaw.nx`, `docker-compose.pmos.yml` |

---

## Metrics for Success

| Metric | Target | Current |
|--------|--------|---------|
| Workspace Isolation | 100% tests pass | ✅ 31/31 tests |
| n8n Embed | Starts on gateway boot | ✅ Working |
| BYOK | Multi-provider support | ✅ OpenAI, Anthropic, Google, Custom |
| User Activation | Create first workflow | ⏳ Pending chat-to-workflow |
| Workflow Success Rate | >95% | ⏳ Need production data |
| User Retention (30-day) | >50% | ⏳ Need production data |

---

## Risk Areas

1. **n8n Version Lock** — Vendored at v1.76.1, upgrades require manual effort
2. **Custom Node Maintenance** — Basecamp node needs updates if n8n API changes
3. **Workspace Scaling** — Need load testing for multi-tenant scenarios
4. **AI Provider Limits** — BYOK means user rate limits affect system
5. **Chat-to-Workflow Complexity** — Natural language parsing is hard

---

*Generated by Link 🔮 — Your AI construct for wicked development*
