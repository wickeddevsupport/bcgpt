# Development Workflow: Local to Production

## Quick Status

**Current Deployment (2026-02-11):**
- ✅ Activepieces running at `https://flow.wickedlab.io`
- ✅ Flow-gallery module fixed and ready
- ✅ Basecamp pieces available
- ✅ Database + Redis + Nginx configured
- ⏳ Custom Docker image builds on-demand (GitHub Actions)

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

## 2. Code Structure

### Main Components
```
bcgpt/
├── activepieces/                    # Activepieces monorepo
│   ├── packages/
│   │   ├── server/
│   │   │   └── api/
│   │   │       └── src/app/
│   │   │           └── flow-gallery/    # ✅ Public app store
│   │   ├── pieces/
│   │   │   └── community/
│   │   │       ├── framework/           # Piece SDK framework
│   │   │       ├── common/              # Shared utilities
│   │   │       └── basecamp/            # ✅ Custom Basecamp piece
│   │   ├── react-ui/                    # Frontend (optional for builds)
│   │   └── shared/                      # Shared types
│   ├── Dockerfile                       # Multi-stage build
│   └── docker-entrypoint.sh
├── docker-compose.activepieces.yml      # Service orchestration
├── .env.activepieces                    # Environment variables
├── .github/workflows/
│   └── activepieces-image.yml          # Docker build workflow (manual trigger)
└── docs/
```

### Key Files
| File | Purpose |
|------|---------|
| `activepieces/Dockerfile` | Builds custom image with flow-gallery + pieces |
| `docker-compose.activepieces.yml` | Runs PostgreSQL, Redis, Activepieces, Nginx |
| `.env.activepieces` | Database, Redis, JWT secrets (on server only) |
| `activepieces/Dockerfile` | Multi-stage: build server-api, pieces, then runtime |

---

## 3. Local Development (Your Machine)

### Prerequisites
- Git configured with GitHub access
- Code editor (VS Code recommended)
- SSH access to server

### Edit Code Locally
```bash
# Flow-gallery locations
activepieces/packages/server/api/src/app/flow-gallery/flow-gallery.service.ts
activepieces/packages/server/api/src/app/flow-gallery/flow-gallery.controller.ts

# Basecamp piece location
activepieces/packages/pieces/community/basecamp/src/

# Make your changes, then push
cd c:\Users\rjnd\Documents\GitHub\bcgpt
git add .
git commit -m "feat: description"
git push origin main
```

### Why Server-Side Builds?
- Monorepo compiles faster on server with more CPU cores
- No waiting for npm downloads on your machine
- Server has better specs than local (8+ CPU cores vs your machine)
- Just push → pull → build is much simpler

---

## 4. Build & Test on Server (2-3 minutes)

### Development Workflow: Push → Pull → Build
```bash
# SSH first
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175

# Pull latest code changes
cd /home/deploy/bcgpt
git pull origin main

# Rebuild only activepieces service with your changes
# This rebuilds the Dockerfile with all your code changes
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build --no-deps

# Watch it build and start
sudo docker compose -f docker-compose.activepieces.yml logs -f activepieces

# Test endpoint (after it's up)
curl https://flow.wickedlab.io/apps

# View container status
sudo docker compose -f docker-compose.activepieces.yml ps
```

### Why Server-Side Build is Faster
1. **No local compilation needed** - Just push code to GitHub
2. **Nx rebuilds only changed packages** - Server has good CPU cores
3. **Docker layer caching** - Previous builds cached, only new changes rebuild
4. **Faster than full image builds** - ~2-3 minutes vs 15+ minutes
5. **Same environment as production** - Linux containers match deployment

### Typical Build Flow
```
git push → ssh to server → git pull → docker compose build → app ready
         (immediate)       (~30s)      (~2-3 mins)          (live)
```

---

## 5. Verify Changes

### Check Logs
```bash
# Real-time logs
sudo docker compose -f docker-compose.activepieces.yml logs -f activepieces

# Last 50 lines
sudo docker compose -f docker-compose.activepieces.yml logs --tail 50 activepieces
```

### Test API Endpoints
```bash
# Flow-gallery apps
curl https://flow.wickedlab.io/apps/api/apps

# Basecamp piece health
curl https://flow.wickedlab.io/api/v1/pieces/basecamp
```

### Container Health
```bash
# Check all services
sudo docker compose -f docker-compose.activepieces.yml ps

# Restart if needed
sudo docker compose -f docker-compose.activepieces.yml restart activepieces

# Full restart (postgres, redis, activepieces)
sudo docker compose -f docker-compose.activepieces.yml down
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
