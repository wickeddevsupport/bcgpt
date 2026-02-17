# Apps Release Checklist

Use this checklist before every apps release to `flow.wickedlab.io`.

## 1) Pre-release
- Confirm target branch and commit hash.
- Confirm rollback baseline from `docs/APPS_BASELINE_LOCK.md`.
- Confirm working tree only includes intended files for this release.
- Run builds:
  - `cd activepieces && npx nx build server-api --configuration production`
  - `cd activepieces && npx nx build react-ui --configuration production`

## 2) Deploy
- Push commit to `main`.
- Deploy on server:
  - `ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175`
  - `cd ~/bcgpt`
  - `git fetch origin && git reset --hard origin/main`
  - `sudo docker compose -f docker-compose.activepieces.yml up -d --build`
- Ensure activepieces container is connected to coolify network if needed:
  - `sudo docker network connect coolify bcgpt-activepieces-1` (ignore if already connected)

## 3) Smoke checks
- `https://flow.wickedlab.io/` loads.
- `https://flow.wickedlab.io/sign-in` loads.
- `https://flow.wickedlab.io/apps` loads.
- `https://flow.wickedlab.io/apps/publisher` loads for admin user.
- `https://flow.wickedlab.io/api/v1/flags` returns `200`.
- Publish flow as app from publisher UI.
- Run published app from `/apps/:id`.

## 4) Phase 5 seed checks
- Seed endpoint works:
  - `POST /apps/api/publisher/seed-defaults` with `{ "confirm": "SEED_DEFAULTS" }`
- Verify seeded defaults are visible in publisher/gallery.

## 5) Rollback (if needed)
- Follow `docs/APPS_BASELINE_LOCK.md`.
- Re-run smoke checks after rollback.
