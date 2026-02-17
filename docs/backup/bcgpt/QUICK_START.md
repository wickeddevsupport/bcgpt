# Quick Start (Activepieces)

This is the fast, day-to-day workflow for Activepieces only.

- App: `https://flow.wickedlab.io`
- Server repo: `/home/deploy/bcgpt`
- Monorepo: `/home/deploy/bcgpt/activepieces`

Do not modify BCGPT unless explicitly requested.

---

## 1) Push Code

```bash
cd c:\Users\rjnd\Documents\GitHub\bcgpt
git add .
git commit -m "feat: your change"
git push origin main
```

---

## 2) Fast Validate with Nx on Server (Recommended)

Server host does not run local `npx`, so run Nx inside the Activepieces image:

```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175

sudo docker run --rm --entrypoint bash \
  -v /home/deploy/bcgpt/activepieces:/work \
  ghcr.io/wickeddevsupport/activepieces-bcgpt:latest \
  -lc 'cd /work && npx nx build server-api --configuration production && npx nx build react-ui --configuration production'
```

Observed timings:
- Cold: `server-api` ~83s, `react-ui` ~30s
- Warm: `server-api` ~4s, `react-ui` ~3s

---

## 3) Deploy

### Preferred: deploy latest GitHub-built image
```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
cd /home/deploy/bcgpt
git pull origin main
sudo docker compose -f docker-compose.activepieces.yml pull activepieces
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces
```

### Alternative: rebuild from source on server
```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
cd /home/deploy/bcgpt
git pull origin main
sudo docker compose -f docker-compose.activepieces.yml up -d activepieces --build --no-deps
```

---

## 4) Verify

```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175 \
  "sudo docker compose -f /home/deploy/bcgpt/docker-compose.activepieces.yml ps"

ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175 \
  "sudo docker compose -f /home/deploy/bcgpt/docker-compose.activepieces.yml logs --tail 100 activepieces"

curl -I https://flow.wickedlab.io
curl https://flow.wickedlab.io/api/v1/flags
curl https://flow.wickedlab.io/apps
```

---

## 5) Troubleshooting

### 502 / app unreachable
```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
cd /home/deploy/bcgpt
sudo docker compose -f docker-compose.activepieces.yml ps
sudo docker compose -f docker-compose.activepieces.yml logs --tail 200 activepieces
```

### Redis auth errors (`NOAUTH`, `WRONGPASS`)
```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
cd /home/deploy/bcgpt
sudo docker compose -f docker-compose.activepieces.yml down
sudo docker volume rm activepieces-redis-data
sudo docker volume create activepieces-redis-data
sudo docker compose -f docker-compose.activepieces.yml up -d
```

---

## 6) Key Paths

- `activepieces/packages/server/api/src/app/flow-gallery/`
- `activepieces/packages/pieces/community/basecamp/`
- `activepieces/packages/react-ui/`
- `/home/deploy/bcgpt/docker-compose.activepieces.yml`
- `/home/deploy/bcgpt/.env.activepieces` (server)

---

For full details, use `DEVELOPMENT_WORKFLOW.md`.
