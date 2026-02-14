# BCGPT Architecture: Two Separate Systems

## Overview

The `bcgpt` repository contains **TWO DISTINCT APPLICATIONS** deployed separately:

```
────────────────────────────────────────────────────────────────
│                    bcgpt Repository                           │
│                   (github.com/wickeddevsupport/bcgpt)          │
├──────────────────────────────────┬──────────────────────────────┤
│                                  │                              │
│  BCGPT (MCP Server)              │  Activepieces (Workflow)     │
│  ✋ DO NOT TOUCH                  │  Development Happens Here    │
│  (Unless instructed)             │                              │
├──────────────────────────────────┼──────────────────────────────┤
│ Location: /                      │ Location: /activepieces/     │
│ Dockerfile: Dockerfile.bcgpt     │ Dockerfile: activepieces/    │
│ Compose: docker-compose.bcgpt.yml│ Compose: docker-compose.     │
│                                  │          activepieces.yml    │
│ Container: bcgpt-1               │ Containers:                  │
│ Port: N/A (internal MCP)         │ - activepieces              │
│ Network: Private                 │ - postgres (activepieces)    │
│                                  │ - redis (activepieces)       │
│ URL: N/A                         │ URL: https://flow.wickedlab.io
├──────────────────────────────────┼──────────────────────────────┤
│ Purpose:                         │ Purpose:                     │
│ - Model Context Protocol server  │ - Workflow automation        │
│ - Integrates ChatGPT AI with      │ - Visual flow builder        │
│   Basecamp APIs                  │ - Piece management           │
│ - Provides tools to ChatGPT       │ - Job execution              │
│ - Runs locally or remote         │                              │
─────────────────────────────────────────────────────────────────
```

---

## BCGPT (MCP Server) - ✋ DO NOT TOUCH

### What It Is
- **MCP Server** (Model Context Protocol) - integrates Claude AI with tools
- Provides Basecamp API access to Claude via MCP
- Runs on its own Docker container separate from Activepieces
- Internal server (no public URL)

### Files (DO NOT MODIFY)
```
bcgpt/
├── index.js                    # Main MCP server
├── basecamp.js                 # Basecamp API integration
├── db.js                       # Database utilities
├── docker-compose.bcgpt.yml    # BCGPT container orchestration
├── Dockerfile.bcgpt            # BCGPT build configuration
└── [...other server files]
```

### Container Details
- **Name**: `bcgpt-1`
- **Image**: Custom built from `Dockerfile.bcgpt`
- **Network**: Private (coolify network)
- **Database**: Shared PostgreSQL
- **Purpose**: Provides MCP tools to AI

### When to Touch
- ONLY if user explicitly says "modify BCGPT" or "update MCP server"
- Otherwise, leave it alone

---

## Activepieces (Workflow Server) - DEVELOPMENT FOCUS

### What It Is
- **Workflow Automation Platform** - visual flow builder like Zapier
- Runs Basecamp pieces for workflow automation
- Provides UI at `https://flow.wickedlab.io`
- Independent from BCGPT MCP server

### Files (ACTIVELY DEVELOPED)
```
activepieces/                                    # Main monorepo
├── Dockerfile                                  # Production build
├── docker-entrypoint.sh                        # Container startup
├── packages/
│   ├── server/
│   │   └── api/src/app/flow-gallery/          # ✏️ EDIT HERE
│   │       ├── flow-gallery.service.ts         # API logic
│   │       ├── flow-gallery.controller.ts      # API endpoints
│   │       └── flow-gallery.entity.ts          # Database schema
│   ├── pieces/
│   │   └── community/
│   │       ├── basecamp/                       # ✏️ CUSTOM PIECE
│   │       ├── framework/                      # Piece SDK
│   │       └── common/                         # Shared libraries
│   └── react-ui/                               # UI frontend
│
docker-compose.activepieces.yml                 # Container orchestration
.env.activepieces                               # Environment (server only)
```

### Container Details

**Activepieces Service**
- **Name**: `bcgpt-activepieces-1`
- **Image**: `ghcr.io/activepieces/activepieces:latest` (official)
- **Port**: 80 (inside) → Traefik proxy (outside)
- **URL**: `https://flow.wickedlab.io`
- **Purpose**: Workflow automation UI & API

**Supporting Services** (Internal to docker-compose.activepieces.yml)
- **PostgreSQL**: `bcgpt-postgres-1` (database)
  - Stores workflows, templates, execution logs
  - Database: `activepieces`
  - Host: `activepieces-postgres` (internal DNS)
  
- **Redis**: `bcgpt-redis-1` (job queue)
  - Handles background job processing
  - Stores cache and session data
  - Host: `activepieces-redis` (internal DNS)

### Network Architecture
```
┌────────────────────────────────────────────────┐
│           Traefik Reverse Proxy                │
│          (Coolify Shared Network)              │
└─────────────┬──────────────────────────────────┘
              │
         https://flow.wickedlab.io
              │
              ▼
┌────────────────────────────────────────────────┐
│      Docker Network: activepieces              │
├────────────────────────────────────────────────┤
│                                                │
│  ┌─────────────────────────────────────────┐  │
│  │   activepieces container                │  │
│  │   - Server API (Fastify)                │  │
│  │   - Job Worker                          │  │
│  │   - Nginx Frontend                      │  │
│  │   Connects to:                          │  │
│  │   - postgres (activepieces-postgres)   │  │
│  │   - redis (activepieces-redis)         │  │
│  └─────────────────────────────────────────┘  │
│                                                │
│  ┌─────────────────────┐  ┌──────────────────┐│
│  │  PostgreSQL:5432    │  │  Redis:6379      ││
│  │  activepieces-      │  │  activepieces-   ││
│  │  postgres           │  │  redis           ││
│  └─────────────────────┘  └──────────────────┘│
│                                                │
└────────────────────────────────────────────────┘
```

### When to Touch
- **Always** - This is where development happens
- Edit flow-gallery for API changes
- Edit basecamp pieces for workflow actions
- Push changes → Server rebuild

---

## Important Separation Rules

### DO NOT
```bash
❌ Use bcgpt database for Activepieces data
❌ Put Activepieces containers in bcgpt docker-compose
❌ Modify bcgpt code without explicit instruction
❌ Mix MCP server logic with Activepieces workflows
❌ Access bcgpt container from Activepieces workflows
```

### DO
```bash
✅ Keep bcgpt and activepieces separate
✅ Rebuild only activepieces when making changes
✅ Use activepieces-specific environment variables
✅ Interact with Activepieces via flow.wickedlab.io UI
✅ Ask user before touching bcgpt
```

---

## Development Workflow (Activepieces Only)

```
1. Edit code in activepieces/packages/server/api/ or activepieces/packages/pieces/
2. git push origin main
3. SSH to server
4. cd /home/deploy/bcgpt
5. git pull origin main
6. sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build --no-deps
7. Monitor: sudo docker compose -f docker-compose.activepieces.yml logs -f activepieces
```

---

## File Structure Reference

### Root Level (BCGPT - Untouched)
```
bcgpt/
├── index.js                 ← MCP Server entry point
├── basecamp.js              ← Basecamp API tools for Claude
├── db.js                    ← Database connection
├── docker-compose.bcgpt.yml ← BCGPT containers only
├── Dockerfile.bcgpt         ← BCGPT build
└── ...
```

### Activepieces Directory (Active Development)
```
activepieces/
├── Dockerfile               ← Activepieces build configuration
├── docker-entrypoint.sh     ← Container startup
├── packages/
│   ├── server/
│   │   └── api/src/app/
│   │       └── flow-gallery/    ← 🎯 Edit this
│   └── pieces/
│       └── community/
│           ├── basecamp/        ← 🎯 Edit this
│           ├── framework/
│           └── common/
└── ...
```

### Root Level (Activepieces Orchestration)
```
bcgpt/
├── docker-compose.activepieces.yml  ← Activepieces services
├── .env.activepieces                ← Activepieces secrets (server only)
└── DEVELOPMENT_WORKFLOW.md          ← This: How to develop
```

---

## When Confused

**Q: Should I modify this file?**
- In `/activepieces/` → **YES** (always safe, use dev workflow)
- In `/` (root, not activepieces/) → **NO** (ask first, it's likely BCGPT)

**Q: Which docker-compose should I use?**
- `docker-compose.bcgpt.yml` → BCGPT (don't touch unless told)
- `docker-compose.activepieces.yml` → Activepieces (use this for development)
- `docker-compose.yaml` → May be legacy, check contents

**Q: Which containers should I rebuild?**
- Only: `activepieces` (benefits from changes)
- Never: `bcgpt-1` (independent MCP server)

**Q: Where does my code change go?**
- Flow-gallery: `activepieces/packages/server/api/src/app/flow-gallery/`
- Basecamp pieces: `activepieces/packages/pieces/community/basecamp/`
- Nowhere else

---

## Deployment Summary

| Component | Type | Network | Compose File | When to Rebuild |
|-----------|------|---------|--------------|-----------------|
| **BCGPT** | MCP Server | Private | docker-compose.bcgpt.yml | ✋ Never (unless instructed) |
| **Activepieces** | Workflow Platform | Coolify + Internal | docker-compose.activepieces.yml | After every code change |
| **PostgreSQL** | Database | Internal | docker-compose.activepieces.yml | Never (data persistent) |
| **Redis** | Job Queue | Internal | docker-compose.activepieces.yml | Never (ephemeral cache) |

---

## See Also
- [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md) - How to work with Activepieces
- [QUICK_START.md](QUICK_START.md) - Fast commands for developers
