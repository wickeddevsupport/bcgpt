# Development Workflow: Local to Production

⚠️ **CRITICAL**: This guide covers **Activepieces development ONLY**.

**BCGPT (the MCP server) is a separate system and should NOT be modified unless explicitly instructed.**

See [ARCHITECTURE.md](ARCHITECTURE.md) to understand the two systems and their separation.

---

## Quick Status

**Current Deployment (2026-02-11):**
- ✅ Activepieces running at `https://flow.wickedlab.io`
- ✅ Flow-gallery module fixed and ready
- ✅ Basecamp pieces available
- ✅ Database + Redis + Nginx configured
- ⏳ Custom Docker image builds on-demand (GitHub Actions)

---

## Architecture Overview

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system separation, network diagrams, and container details.

**TL;DR**: Two separate systems:
1. **BCGPT** - MCP server (hands off)
2. **Activepieces** - Workflow platform (your development focus)

---

## 1. Server Access

### SSH Connection
```powershell
# From Windows PowerShell
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175

# Server location
/home/deploy/bcgpt/        # Main repo
/home/deploy/bcgpt/activepieces/  # Activepieces monorepo
```

### Key Credentials
- **Server**: 46.225.102.175 (Hetzner)
- **SSH Key**: `C:\Users\rjnd\.ssh\bcgpt_hetzner`
- **GitHub**: wickeddevsupport/bcgpt

---

## 2. Code Structure: Two Separate Systems

### BCGPT (MCP Server) - DO NOT MODIFY ✋
```
bcgpt/
├── index.js                     # MCP server entry
├── basecamp.js                  # Basecamp tools for Claude AI
├── db.js                        # Database utilities  
├── docker-compose.bcgpt.yml     # BCGPT containers only
├── Dockerfile.bcgpt             # BCGPT build
└── [...other MCP files]
```

**Rule**: Never touch these files unless explicitly instructed by user.

### Activepieces (Workflow) - ACTIVELY DEVELOPED ✏️
```
activepieces/                       # Monorepo you develop in
├── Dockerfile                      # Build config (may contain flow-gallery)
├── packages/
│   ├── server/
│   │   └── api/src/app/
│   │       └── flow-gallery/       # 🎯 EDIT: Public app store
│   ├── pieces/
│   │   └── community/
│   │       ├── basecamp/           # 🎯 EDIT: Basecamp piece
│   │       ├── framework/
│   │       └── common/
│   └── react-ui/                   # UI frontend
└── docker-entrypoint.sh
```

### Root Level (Orchestration & Docs)
```
bcgpt/
├── ARCHITECTURE.md              # 📖 READ THIS FIRST: System separation
├── DEVELOPMENT_WORKFLOW.md      # 📖 You are here
├── QUICK_START.md              # 📖 Fast commands
├── docker-compose.activepieces.yml  # Container orchestration
├── docker-compose.bcgpt.yml     # ✋ MCP server - hands off
└── .github/workflows/           # CI/CD (GitHub Actions)
```

**Navigation Rule**:
- Files in `activepieces/` → Safe to edit
- Files in root (`/`) → Check ARCHITECTURE.md first
- If not sure → Ask before touching

---

## 3. Container Infrastructure

### Activepieces Containers (What You Develop With)
```
Activepieces Service (Your focus)
├── activepieces-1 (main application)
│   ├── Fastify server (API)
│   ├── Job worker (background tasks)
│   └── Nginx (reverse proxy for UI)
├── postgres-1 (database)
│   └── Stores flows, templates, logs
└── redis-1 (job queue & cache)
    └── Handles background jobs
```

### BCGPT Container (Hands Off)
```
BCGPT MCP Service (separate from Activepieces)
└── bcgpt-1 (MCP server for Claude)
    └── Independent from Activepieces
```

**Network Separation**:
- Activepieces uses internal network `activepieces`
- BCGPT uses its own internal network
- Both connect to shared `coolify` network for external access
- **No direct container-to-container communication between systems**

---

## 4. Local Development (Your Machine)

### Prerequisites
- Git configured with GitHub access
- Code editor (VS Code recommended)
- SSH access to server (no local Node.js needed!)

### Edit Code Locally
```bash
# Flow-gallery locations
activepieces/packages/server/api/src/app/flow-gallery/flow-gallery.service.ts
activepieces/packages/server/api/src/app/flow-gallery/flow-gallery.controller.ts

# Basecamp piece location
activepieces/packages/pieces/community/basecamp/src/

# Make your changes locally, then commit
cd c:\Users\rjnd\Documents\GitHub\bcgpt
git add .
git commit -m "feat: description"
git push origin main
```

### Why This Approach?
- ✅ No local compilation overhead (use server resources)
- ✅ Just edit files and push (Git does the heavy lifting)
- ✅ Server rebuilds in 2-3 minutes with Docker cache
- ✅ Same Linux environment as production

---

## 5. Build & Test on Server (2-3 minutes)

### Development Workflow: Push → Pull → Build
```bash
# SSH to server
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175

# Enter project directory
cd /home/deploy/bcgpt

# Pull latest code changes
git pull origin main

# Rebuild ONLY activepieces (not bcgpt!)
# This rebuilds the Dockerfile with all your code changes
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build --no-deps

# Watch it build and check for errors
sudo docker compose -f docker-compose.activepieces.yml logs -f activepieces

# Test after it's up
curl https://flow.wickedlab.io/apps

# View container status
sudo docker compose -f docker-compose.activepieces.yml ps
```

### What This Does (NOT touching BCGPT)
1. ✅ Pulls your code changes
2. ✅ Rebuilds activepieces container only
3. ✅ Uses Docker cache (faster on subsequent builds)
4. ✅ Skips postgres and redis (they're independent)
5. ✅ Nginx loads new UI and API
6. **Result**: Your changes live in 2-3 minutes

### Docker Compose File Important Note
```bash
# CORRECT - This rebuilds activepieces
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build

# WRONG - Don't use bcgpt compose (it's separate)
# sudo docker compose -f docker-compose.bcgpt.yml ...

# OLD - May be legacy
# sudo docker compose -f docker-compose.yaml ...

# Always use: docker-compose.activepieces.yml
```

---

## 6. Verify Changes

### Check Activepieces Logs (Your focus)
```bash
# Real-time logs from activepieces container
sudo docker compose -f docker-compose.activepieces.yml logs -f activepieces

# Last 50 lines
sudo docker compose -f docker-compose.activepieces.yml logs --tail 50 activepieces
```

### Check BCGPT Status (Observation only - don't touch)
```bash
# View bcgpt container status
sudo docker compose -f docker-compose.bcgpt.yml ps

# Check bcgpt logs (read-only, don't modify)
sudo docker compose -f docker-compose.bcgpt.yml logs --tail 20

# DO NOT restart or modify bcgpt
```

### Test Activepieces API Endpoints
```bash
# Flow-gallery apps
curl https://flow.wickedlab.io/apps
curl https://flow.wickedlab.io/apps/api/apps

# Basecamp piece health
curl https://flow.wickedlab.io/api/v1/pieces/basecamp
```

### Container Health
```bash
# All Activepieces containers
sudo docker compose -f docker-compose.activepieces.yml ps

# Restart only activepieces if needed
sudo docker compose -f docker-compose.activepieces.yml restart activepieces

# Full restart (postgres, redis, activepieces)
sudo docker compose -f docker-compose.activepieces.yml up -d
```

---

## 6. Production Deployment

### When Ready (After Testing)

#### Option A: Manual Docker Build (15+ mins)
```bash
# Only if you want a full custom image in ghcr.io
# Trigger GitHub Actions manually:
# Go to: https://github.com/wickeddevsupport/bcgpt/actions
# Click: "Build Activepieces Image" → "Run workflow"

# Wait for build to complete (~15 mins)
# Then update docker-compose to use it:
# image: ghcr.io/wickeddevsupport/activepieces-bcgpt:sha-xxx

# Pull and restart
sudo docker compose -f docker-compose.activepieces.yml pull
sudo docker compose -f docker-compose.activepieces.yml up -d
```

#### Option B: Direct Server Rebuild (Recommended)
```bash
# On server, just rebuild the running container
cd /home/deploy/bcgpt
git pull origin main
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build --no-deps

# That's it! Already live
```

---

## 7. Git Workflow

### Daily Development Cycle
```bash
cd c:\Users\rjnd\Documents\GitHub\bcgpt

# 1. Edit code locally
# activepieces/packages/server/api/src/app/flow-gallery/
# activepieces/packages/pieces/community/basecamp/

# 2. Stage and commit
git add .
git commit -m "feat(flow-gallery): add new feature"

# 3. Push to main - this triggers server rebuild
git push origin main

# 4. On server, rebuild immediately:
# ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
# cd /home/deploy/bcgpt
# git pull && sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build --no-deps
```

### Production Release (Full Docker Image Build)
```bash
# When you want a complete optimized image in ghcr.io:

# Tag for release (triggers GitHub Actions if manually triggered)
git tag release-v1.1
git push origin release-v1.1

# Goes to GitHub Actions:
# - Builds full image (15-20 minutes)
# - All pieces, react-ui, dependencies included
# - Pushes to ghcr.io/wickeddevsupport/activepieces-bcgpt:latest

# Then on server, switch to new image (optional):
# Edit docker-compose.activepieces.yml to use new tag
# sudo docker compose -f docker-compose.activepieces.yml pull
# sudo docker compose -f docker-compose.activepieces.yml up -d
```

### Workflow Summary
```
Local        →    git push    →    Server pulls    →    Docker rebuilds    →    Live
(edit code)      (1 second)       (30 seconds)       (2-3 minutes)       (instant)
```

---

## 8. Environment Configuration

### On Server: `.env.activepieces`
```bash
# Located at: /home/deploy/bcgpt/.env.activepieces
# This file exists on server only (not in git)

AP_POSTGRES_USERNAME=activepieces
AP_POSTGRES_PASSWORD=<secure-password>
AP_POSTGRES_DATABASE=activepieces
AP_REDIS_PASSWORD=<secure-password>
AP_JWT_SECRET=<jwt-secret>
AP_ENCRYPTION_KEY=<encryption-key>
AP_FRONTEND_URL=https://flow.wickedlab.io
```

### Access on Server
```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
cd /home/deploy/bcgpt
cat .env.activepieces
```

---

## 9. Debugging

### Build Fails
```bash
# Check Docker logs
sudo docker compose -f docker-compose.activepieces.yml logs --tail 100 activepieces

# Check for specific error patterns
# Look for TypeScript errors, missing modules, or configuration issues

# Common issues:
# - Missing pieces directory → check activepieces/packages/pieces/community/
# - TypeScript compilation → run `npx nx build <package>` locally first
# - Environment variables → check .env.activepieces on server
```

### Container Won't Start
```bash
# Check what's running
sudo docker ps -a | grep activepieces

# Remove stopped container if stuck
sudo docker compose -f docker-compose.activepieces.yml down

# Rebuild and start fresh
sudo docker compose -f docker-compose.activepieces.yml up -d
```

### Clear Docker Cache (Nuclear Option)
```bash
# Only if you really need to rebuild everything from scratch
sudo docker builder prune --all -f

# Then rebuild
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build
```

---

## 10. Current Status & Next Steps

### What's Working ✅
- Activepieces service running on `flow.wickedlab.io`
- Flow-gallery code compiled and deployed
- Basecamp custom piece available
- PostgreSQL + Redis operational
- Nginx reverse proxy routing to Traefik

### What's Manual 🔄
- **Code changes** → Push to main → SSH and rebuild on server (2-3 mins)
- **Docker image builds** → Manual trigger via GitHub Actions or tag release
- **Server restart** → SSH + docker compose commands

### What's Automated ⚙️
- GitHub Actions builds full Docker images on manual trigger or tags
- Environment variables managed via `.env.activepieces` (server only)
- Database migrations run on container start
- Piece registration happens automatically
- Nx builds only changed packages during rebuild

---

## 11. Quick Command Reference

```bash
# Local development (your machine)
cd c:\Users\rjnd\Documents\GitHub\bcgpt
git add .
git commit -m "feat: message"
git push origin main

# Build on server (in new terminal)
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
cd /home/deploy/bcgpt
git pull origin main
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build --no-deps

# Check if working
curl https://flow.wickedlab.io/apps
sudo docker compose -f docker-compose.activepieces.yml logs -f activepieces

# For production Docker build (optional)
git tag release-v1.0
git push origin release-v1.0
# Then manually trigger GitHub Actions or wait for auto-build
```

---

## 12. Session Resume Guide

**If returning after session clear:**

1. **Check what's running**: `ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175 && sudo docker compose -f /home/deploy/bcgpt/docker-compose.activepieces.yml ps`
2. **Check recent logs**: `sudo docker compose -f docker-compose.activepieces.yml logs --tail 30 activepieces`
3. **Edit code locally**: Edit files, then `git push origin main`
4. **Rebuild on server**: SSH back, git pull, docker compose build
5. **See QUICK_START.md for immediate commands**

Last known state: GitHub Actions Docker build running (or completed)

Last commit (2026-02-11 08:00 UTC): `2819847e` - "fix(workflow): only build on manual trigger or tags"

---

## Useful Links

- **Live App**: https://flow.wickedlab.io
- **GitHub Repo**: https://github.com/wickeddevsupport/bcgpt
- **GitHub Actions**: https://github.com/wickeddevsupport/bcgpt/actions
- **Server**: 46.225.102.175 (Hetzner)
