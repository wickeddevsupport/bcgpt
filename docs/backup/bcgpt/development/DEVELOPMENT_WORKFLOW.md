# Development Workflow (Activepieces)

This document defines the current development and deployment workflow for **Activepieces only**.

- Activepieces app: `https://flow.wickedlab.io`
- Repo root on server: `/home/deploy/bcgpt`
- Activepieces monorepo on server: `/home/deploy/bcgpt/activepieces`

BCGPT (MCP server) is separate. Do not modify BCGPT unless explicitly requested.

---

## 1. Server Access

```powershell
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
```

---

## 2. Current Build/Test Strategy

Use **Nx-first** for fast validation, then use Docker deployment when needed.

### Why
Docker rebuilds include image/layer work and are slower. Nx builds only needed targets and can reuse cache.

### Measured on server (containerized Nx run)
- `server-api` cold: **83s**
- `react-ui` cold: **30s**
- `server-api` warm: **4s**
- `react-ui` warm: **3s**

Combined:
- Cold: about **1m53s**
- Warm: about **7s**

---

## 3. Standard Workflow (Recommended)

### Step A: Edit and push
```bash
cd c:\Users\rjnd\Documents\GitHub\bcgpt
git add .
git commit -m "feat: ..."
git push origin main
```

### Step B: Validate quickly with Nx on server (no full image rebuild)

Server does not have host `npx` tooling, so run Nx inside the existing Activepieces build image:

```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175

sudo docker run --rm --entrypoint bash \
  -v /home/deploy/bcgpt/activepieces:/work \
  ghcr.io/wickeddevsupport/activepieces-bcgpt:latest \
  -lc 'cd /work && npx nx build server-api --configuration production && npx nx build react-ui --configuration production'
```

If this passes, code-level validation is done.

### Step C: Deploy
Choose one:

1. **Deploy latest GitHub-built image (fastest runtime rollout)**
```bash
cd /home/deploy/bcgpt
git pull origin main
sudo docker compose -f docker-compose.activepieces.yml pull activepieces
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces
```

2. **Rebuild from source on server (slower)**
```bash
cd /home/deploy/bcgpt
git pull origin main
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build --no-deps
```

---

## 4. Verify Deployment

```bash
# Container status
sudo docker compose -f /home/deploy/bcgpt/docker-compose.activepieces.yml ps

# Recent logs
sudo docker compose -f /home/deploy/bcgpt/docker-compose.activepieces.yml logs --tail 100 activepieces

# Public checks
curl -I https://flow.wickedlab.io
curl https://flow.wickedlab.io/api/v1/flags
curl https://flow.wickedlab.io/apps
```

Expected:
- `flow.wickedlab.io` returns HTTP 200
- `/api/v1/flags` returns JSON
- `/apps` route loads

---

## 5. Nx Cloud Notes

If Nx output shows:
- `Nx Cloud manually disabled`

Then remote cache is not being used for that run.

Check for:
- `NX_NO_CLOUD=true`
- `--no-cloud` flags
- CI/runtime env overrides

Even without Nx Cloud, local Nx cache still gives major speedups after first run.

---

## 6. Troubleshooting (Known Patterns)

### A) 502 from `flow.wickedlab.io`
- Check activepieces container up
- Ensure container is connected to `coolify` network if required by current routing setup
- Check logs for startup errors

### B) Redis auth errors (`NOAUTH` / `WRONGPASS`)
- Ensure app env and Redis config match
- Clear stale Redis volume data when changing auth mode

### C) UI partially loads (sidebar/tools missing)
- Check browser console + server logs for API 500s
- Verify `/api/v1/flags` and user/session endpoints return expected responses

---

## 7. Guardrails

- Treat `docker-compose.activepieces.yml` and `.env.activepieces` as sensitive config.
- Do not change BCGPT compose or BCGPT runtime unless specifically requested.
- Prefer Nx validation before any Docker rebuild.

---

## 8. Quick Command Block

```bash
# 1) Pull latest
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
cd /home/deploy/bcgpt
git pull origin main

# 2) Fast Nx validate
sudo docker run --rm --entrypoint bash \
  -v /home/deploy/bcgpt/activepieces:/work \
  ghcr.io/wickeddevsupport/activepieces-bcgpt:latest \
  -lc 'cd /work && npx nx build server-api --configuration production && npx nx build react-ui --configuration production'

# 3) Deploy latest image
sudo docker compose -f docker-compose.activepieces.yml pull activepieces
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces

# 4) Verify
curl -I https://flow.wickedlab.io
curl https://flow.wickedlab.io/api/v1/flags
```
