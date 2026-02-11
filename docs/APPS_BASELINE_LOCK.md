# Apps Baseline Lock

- Branch: `main`
- Baseline commit: `641ef349`

## Purpose
Use this as the known-good rollback point before implementing the remaining apps phases.

## Rollback Commands
```bash
git checkout main
git reset --hard 641ef349
git push --force origin main
```

## Server Redeploy (after rollback)
```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
cd ~/bcgpt
git fetch origin
git reset --hard origin/main
sudo docker compose -f docker-compose.activepieces.yml up -d --build
```

## Smoke Checks
- `https://flow.wickedlab.io/`
- `https://flow.wickedlab.io/apps`
- sign-in
- app publish flow
- app execute flow
