# Coolify Deploy + Nx Runbook

**Last Updated:** 2026-02-18  
**Related:** [`NEXT_STEPS.md`](NEXT_STEPS.md), [`N8N_INTEGRATION_GUIDE.md`](N8N_INTEGRATION_GUIDE.md)

---

## Scope

Use this runbook to deploy OpenClaw/PMOS with embedded n8n through Coolify, with Nx validation before release.

---

## 1) Local Preflight (Required)

Run from repo root:

```bash
NX_DAEMON=false corepack pnpm exec nx run-many -t build --projects=openclaw-app,openclaw-control-ui,openclaw-frontend --output-style=stream
NX_DAEMON=false corepack pnpm exec nx run openclaw-app:test --output-style=stream
```

Optional smoke check (requires gateway token):

```bash
OPENCLAW_GATEWAY_TOKEN=*** node openclaw/scripts/pmos-smoke.mjs
```

---
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
Coolify token
12|cG6Bz3yyfgvNwSgIoJAwtZ1bCFVqNTo3CQWjSB990eb7383a


## 2) Coolify Environment Baseline

Set these in Coolify service env vars/secrets:

- `OPENCLAW_GATEWAY_TOKEN` (required)
- `PMOS_ALLOW_REMOTE_OPS_FALLBACK=0` (recommended for embedded-first runtime)
- `N8N_USER_FOLDER=/app/.openclaw/n8n` (recommended; persists embedded n8n state inside the OpenClaw volume)
- `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true` (recommended; silences wide-permissions warning and hardens settings file)
- `N8N_EMBED_PORT=5678` (optional; default is `5678`)
- `N8N_EMBED_HOST=127.0.0.1` (optional; default is `127.0.0.1`)
- `N8N_OWNER_EMAIL` (recommended)
- `N8N_OWNER_PASSWORD` (recommended)
- `BCGPT_URL` (if BCGPT connector is used)
- `BCGPT_API_KEY` (if BCGPT connector auth is required)

Notes:

- Activepieces install is disabled by default in `postinstall`; enable only for legacy path with `ENABLE_ACTIVEPIECES_INSTALL=true`.
- `pmos-activepieces` is now force-disabled in runtime plugin resolution; if it appears in logs, the container is running an older image.
- Keep Coolify API token out of git. Store in secret manager only.

---

## 3) Deploy Through Coolify

1. Push to `main`.
2. Trigger deploy from Coolify UI (or let webhook auto-deploy).
3. Confirm build logs show successful app build and container restart.

If using command-based build in Coolify, use:

```bash
corepack pnpm exec nx run openclaw-app:build --output-style=stream
```

### Optional: Trigger Deploy via Coolify API (SSH)

Use this when webhook auto-deploy is not configured or Coolify UI is unavailable.

On the server (SSH first), generate a short-lived token inside the `coolify` container, trigger deploy, then delete the token:

```bash
# 1) Create ephemeral token (do not paste tokens into git/docs).
TOKEN=$(
  docker exec coolify php artisan tinker --execute='session(["currentTeam" => \App\Models\Team::first()]); echo \App\Models\User::first()->createToken("codex-deploy")->plainTextToken;' \
    | tail -n 1
)

# 2) Find resource UUID (apps list).
docker exec coolify curl -sS http://127.0.0.1:8080/api/v1/applications \
  -H "Authorization: Bearer $TOKEN" \
  | docker exec -i coolify jq -r '.[] | [.name, .uuid] | @tsv'

# 3) Trigger deploy (example: pmos uuid).
docker exec coolify curl -sS -X POST http://127.0.0.1:8080/api/v1/deploy \
  -H "Authorization: Bearer $TOKEN" \
  -d uuid=<PMOS_UUID>

# 4) Cleanup (delete token).
docker exec coolify php artisan tinker --execute='\Laravel\Sanctum\PersonalAccessToken::where("name","codex-deploy")->delete();'
```

---

## 4) SSH Runtime Verification

```bash
ssh -i C:\Users\rjnd\.ssh\bcgpt_hetzner deploy@46.225.102.175
```

On server, verify container + logs:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker logs <openclaw-container-name> --tail 300
```

Expected log marker:

- `[n8n] embedded n8n started at http://127.0.0.1:5678`

Optional automated check (from repo root):

```bash
PMOS_SSH_KEY=C:\Users\rjnd\.ssh\bcgpt_hetzner \
PMOS_SSH_HOST=deploy@46.225.102.175 \
corepack pnpm --dir openclaw pmos:server-check
```

---

## 5) Production Smoke Checks

```bash
curl -I https://os.wickedlab.io/
curl -sS -o /dev/null -w "%{http_code}\n" https://os.wickedlab.io/ops-ui/
curl -I https://bcgpt.wickedlab.io/health
```

Authenticated ops proxy check:

```bash
curl -sS https://os.wickedlab.io/api/ops/workflows \
  -H "Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>"
```

End-to-end smoke:

```bash
PMOS_URL=https://os.wickedlab.io \
OPENCLAW_GATEWAY_TOKEN=<OPENCLAW_GATEWAY_TOKEN> \
node openclaw/scripts/pmos-smoke.mjs
```

`pmos-smoke.mjs` now verifies:
- root + health routes
- embedded editor route (`/ops-ui/`)
- authenticated ops proxy (`/api/ops/workflows`)
- tool invocation path (`ops_*`)
- gateway chat path

---

## 6) Troubleshooting

- If `https://os.wickedlab.io/ops-ui/` returns `503`, check gateway logs first:
  - You should see `[n8n] embedded n8n started at ...`
  - If missing, verify vendored n8n path detection and container layout (`/vendor/n8n` vs `/openclaw/vendor/n8n`)
- If logs still show `pmos-activepieces`, the deployed container is on an older runtime path and needs redeploy from latest `main`.
- If gateway logs show `Proxy headers detected from untrusted address...`:
  - Set `gateway.trustedProxies` in OpenClaw config to your reverse proxy IP(s).
  - CIDR entries are supported (example: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) but only trust networks that cannot reach the gateway directly.

---

## 7) Rollback

1. Roll back to previous successful commit in git.
2. Re-deploy from Coolify.
3. Re-run section 5 smoke checks.
