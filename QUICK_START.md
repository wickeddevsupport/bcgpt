# Quick Start: Development Workflow (TL;DR)

## Copy-Paste Commands by Task

### 1️⃣ Test Code Changes Locally (30 seconds)
```bash
cd c:\Users\rjnd\Documents\GitHub\bcgpt\activepieces
npx nx build flow-gallery --skip-nx-cache
npx nx build pieces-basecamp --skip-nx-cache
```

### 2️⃣ Deploy to Container (2-3 minutes)
```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175 "cd /home/deploy/bcgpt && git pull origin main && sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build --no-deps"
```

### 3️⃣ Check If It's Working
```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175 "sudo docker compose -f docker-compose.activepieces.yml logs --tail 20 activepieces"
```

### 4️⃣ Test API (After Deploy)
```bash
curl https://flow.wickedlab.io/apps
curl https://flow.wickedlab.io/apps/api/apps
```

### 5️⃣ Commit Changes
```bash
cd c:\Users\rjnd\Documents\GitHub\bcgpt
git add .
git commit -m "feat: your message here"
git push origin main
```

### 6️⃣ Trigger Production Docker Build (Optional)
```bash
# Manually trigger via GitHub Actions:
# https://github.com/wickeddevsupport/bcgpt/actions
# Click "Build Activepieces Image" → "Run workflow"

# OR tag a release to auto-trigger:
git tag release-v1.1
git push origin release-v1.1
```

---

## When Things Go Wrong

### Container won't start
```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
cd /home/deploy/bcgpt
sudo docker compose -f docker-compose.activepieces.yml logs -f activepieces
```

### Need to restart everything
```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
cd /home/deploy/bcgpt
sudo docker compose -f docker-compose.activepieces.yml down
sudo docker compose -f docker-compose.activepieces.yml up -d
```

### Clear Docker cache and rebuild
```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
cd /home/deploy/bcgpt
sudo docker builder prune --all -f
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build --no-deps
```

---

## Key Paths

| What | Path |
|------|------|
| **Flow-Gallery** | `activepieces/packages/server/api/src/app/flow-gallery/` |
| **Basecamp Piece** | `activepieces/packages/pieces/community/basecamp/` |
| **Server** | ssh to `46.225.102.175` as `deploy` |
| **Server Repo** | `/home/deploy/bcgpt/` |
| **Docker Compose** | `/home/deploy/bcgpt/docker-compose.activepieces.yml` |
| **Environment** | `/home/deploy/bcgpt/.env.activepieces` (server only) |

---

## Status Check
```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175 "sudo docker compose -f /home/deploy/bcgpt/docker-compose.activepieces.yml ps"
```

---

## SSH Connection Shortcut (Add to PowerShell Profile)
```powershell
function ssh-bcgpt {
    ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175 -t "cd /home/deploy/bcgpt && bash"
}

# Then just use: ssh-bcgpt
```

---

See **DEVELOPMENT_WORKFLOW.md** for full details.
