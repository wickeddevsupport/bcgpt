# Deployment Auto-Update

This repo uses a safe auto-update flow for PMOS + OPS:

1. `PMOS Safe Auto Update` (`.github/workflows/pmos-safe-auto-update.yml`)
   - Runs weekly.
   - Detects latest stable `n8n@1.x.y`.
   - Updates `Dockerfile.openclaw.nx` pin.
   - Updates `docker-compose.ops.yml` pinned vendor tag.
   - Smoke-builds vendor and PMOS images.
   - Pushes vendor image tag for OPS (`n8n-x.y.z`).
   - Creates PR and enables auto-merge.

2. `Build OpenClaw n8n Vendor Image` (`.github/workflows/openclaw-n8n-vendor-image.yml`)
   - Runs on push/schedule.
   - Builds/pushes:
     - version tag (`n8n-x.y.z`)
     - `stable` tag
   - Optional: restarts OPS app in Coolify to pull the latest `stable` image.

3. `docker-compose.ops.yml`
   - Uses pinned vendor tags (`ghcr.io/wickeddevsupport/openclaw-n8n-vendor:n8n-x.y.z`).

## Required GitHub Secrets

Set these in repo secrets to auto-restart OPS after vendor image publishes:

- `COOLIFY_BASE_URL` (example: `https://cpanel.wickedlab.io`)
- `COOLIFY_API_TOKEN`
- `COOLIFY_OPS_APP_UUID`

If these secrets are not present, image publish still works; only the automatic OPS restart step is skipped.
