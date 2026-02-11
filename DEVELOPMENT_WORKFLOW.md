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
- Node.js 20+ (for local builds)
- npm/yarn/bun installed

### Build Flow-Gallery Locally
```bash
cd c:\Users\rjnd\Documents\GitHub\bcgpt\activepieces

# Build just flow-gallery (fast - ~30 seconds)
npx nx build flow-gallery --skip-nx-cache

# Build pieces
npx nx build pieces-framework --skip-nx-cache
npx nx build pieces-common --skip-nx-cache
npx nx build pieces-basecamp --skip-nx-cache

# Check for errors
npx tsc --noEmit  # TypeScript verification
```

### Locations to Edit
- **Flow-gallery API**: `activepieces/packages/server/api/src/app/flow-gallery/flow-gallery.service.ts`
- **Flow-gallery UI**: `activepieces/packages/server/api/src/app/flow-gallery/flow-gallery.controller.ts`
- **Basecamp piece**: `activepieces/packages/pieces/community/basecamp/src/`

---

## 4. Test in Container (2-3 minutes)

### On Production Server
```bash
# SSH first
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175

# Pull latest code changes
cd /home/deploy/bcgpt
git pull origin main

# Rebuild only activepieces service (uses docker-compose build)
# This is much faster than full Docker build
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build --no-deps

# Watch it start
sudo docker compose -f docker-compose.activepieces.yml logs -f activepieces

# Test endpoint
curl https://flow.wickedlab.io/apps/api/apps

# View container status
sudo docker compose -f docker-compose.activepieces.yml ps
```

### What This Does
1. `docker compose up... --build --no-deps` recognizes there's a Dockerfile in compose
2. Rebuilds only the activepieces service (not postgres/redis)
3. Uses Docker cache, so only changed layers rebuild
4. Typically takes 2-3 minutes vs 15+ for full image

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

### Commit Changes
```bash
cd c:\Users\rjnd\Documents\GitHub\bcgpt

# Stage files
git add activepieces/packages/server/api/src/app/flow-gallery/
git add activepieces/packages/pieces/community/basecamp/

# Commit with message
git commit -m "feat(flow-gallery): add new feature"

# Push to main
git push origin main
```

### Release Version (for Docker builds)
```bash
# Create a version tag to trigger Docker build
git tag release-v1.1
git push origin release-v1.1

# GitHub Actions will automatically build and push to ghcr.io
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
- **Code changes** → Push to main → Test locally (30s) → Deploy to container (2-3 mins)
- **Docker image builds** → Manual trigger via GitHub Actions or tag release
- **Production restart** → SSH + docker compose command

### What's Automated ⚙️
- GitHub Actions workflow listens for git tags or manual triggers
- Environment variables managed via `.env.activepieces`
- Database migrations run on container start
- Piece registration happens automatically

---

## 11. Quick Command Reference

```bash
# Local development
cd c:\Users\rjnd\Documents\GitHub\bcgpt\activepieces
npx nx build flow-gallery --skip-nx-cache        # Test locally (30s)

# Deploy to staging (container)
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
cd /home/deploy/bcgpt
git pull origin main
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build --no-deps

# Check if working
curl https://flow.wickedlab.io/apps

# View logs
sudo docker compose -f docker-compose.activepieces.yml logs -f activepieces

# Git commit and push
git add .
git commit -m "message"
git push origin main

# Tag for production Docker build
git tag release-v1.0
git push origin release-v1.0
```

---

## 12. Session Resume Guide

**If returning after session clear:**

1. **Check status**: `ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175`
2. **See what's running**: `sudo docker compose -f docker-compose.activepieces.yml ps`
3. **Check logs**: `sudo docker compose -f docker-compose.activepieces.yml logs --tail 20 activepieces`
4. **Pull latest code**: `cd /home/deploy/bcgpt && git pull origin main`
5. **Continue development**

Last commit (2026-02-11 08:00 UTC): `2819847e` - "fix(workflow): only build on manual trigger or tags"

---

## Useful Links

- **Live App**: https://flow.wickedlab.io
- **GitHub Repo**: https://github.com/wickeddevsupport/bcgpt
- **GitHub Actions**: https://github.com/wickeddevsupport/bcgpt/actions
- **Server**: 46.225.102.175 (Hetzner)
