# Coolify Deploy + Nx Runbook

**Last Updated:** 2026-02-19  
**Related:** [`NEXT_STEPS.md`](NEXT_STEPS.md), [`N8N_INTEGRATION_GUIDE.md`](N8N_INTEGRATION_GUIDE.md)

---

## Scope

Use this runbook to deploy OpenClaw/PMOS with embedded n8n through Coolify.

Notes:
- Coolify deployments still run via Docker images. Nx is for local validation and task orchestration; it does not replace Docker.
- To speed Docker deploys, `Dockerfile.openclaw.nx` is structured so the expensive embedded n8n build step is cached (or pulled as a prebuilt vendor image) and does not rerun on every app code change.

---

## 0) Known Failure Modes (Seen in Prod)

These are the issues we hit during the initial Coolify+Nx rollout. If you see them again, follow the linked fix.

- `503 Control UI assets not found` on `https://os.wickedlab.io/`
  - Root cause: image missing `openclaw/dist/control-ui/index.html` at container start.
  - Fix: ensure `openclaw-control-ui:build` runs **after** `openclaw-app:build` in `Dockerfile.openclaw.nx`, then redeploy.
- `NX Could not find Nx modules at "/app"` during Docker build
  - Root cause: Nx deps not installed in the Docker workspace root.
  - Fix: `Dockerfile.openclaw.nx` must install root Nx deps (see the `npm install ...` step), then run Nx via `./node_modules/.bin/nx`.
- Slow builds from rebuilding n8n on every deploy
  - Root cause: cold Docker cache or no shared build cache between deployments.
  - Fix: set `N8N_VENDOR_IMAGE` to a prebuilt vendor image (see section 2).
- `Embedded n8n 500 Internal Server Error: SQLITE_CONSTRAINT: NOT NULL constraint failed: workflow_entity.active`
  - Root cause: `POST /rest/workflows` can insert `active=NULL` when the field is missing/invalid.
  - Fix: force `active: false` on embedded workflow create (tools path + proxy path), then redeploy.
- `POST /api/ops/workflows` returns `502 {"ok":false,"error":"Upstream unreachable: TypeError: fetch failed"}` (GET works)
  - Root cause: some clients/proxies send request headers (`Expect: 100-continue`, `Keep-Alive`) that Node's `fetch` (undici) rejects when forwarded upstream.
  - Fix: strip `expect` + `keep-alive` in `openclaw/src/gateway/pmos-ops-proxy.ts` (`STRIP_REQUEST_HEADERS`), then redeploy.
- `Unable to ensure workspace tag for embedded n8n.`
  - Root cause: n8n tag names are limited to 24 characters; raw workspace IDs often exceed this.
  - Fix: workspace isolation tag name is derived from a short hash (see `openclaw/src/gateway/pmos-ops-proxy.ts`), then redeploy.
- n8n iframe is blank and `/ops-ui/assets/*.js` returns HTML (index.html)
  - Root cause: embedded n8n expects the reverse proxy to **strip** the `N8N_PATH` prefix (`/ops-ui`) when forwarding requests. If you proxy `/ops-ui/assets/*` as-is, n8n's history fallback returns `index.html` for JS/CSS, so the editor never boots.
  - Fix: ensure the gateway strips `/ops-ui` when proxying to local n8n (see `openclaw/src/gateway/pmos-ops-proxy.ts`), then redeploy. Verify `GET /ops-ui/assets/*` returns `Content-Type: application/javascript`.
- Users see shared owner workflows instead of workspace-isolated workflows
  - Root cause: owner-cookie fallback is enabled and workspace-scoped n8n identity is bypassed.
  - Fix: set `N8N_ALLOW_OWNER_FALLBACK=0`; keep `N8N_OWNER_EMAIL` + `N8N_OWNER_PASSWORD` configured so workspace users can be auto-provisioned via invitation flow.

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

## Security Note

Do not store or paste credentials (SSH hosts/keys, API tokens) into this repo.
Use placeholders in documentation and keep secrets in Coolify's secret manager.


## 2) Coolify Environment Baseline

Set these in Coolify service env vars/secrets:

- `OPENCLAW_GATEWAY_TOKEN` (required)
- `PMOS_ALLOW_REMOTE_OPS_FALLBACK=0` (recommended for embedded-first runtime)
- `N8N_ALLOW_OWNER_FALLBACK=0` (required for strict per-workspace n8n identity)
- `N8N_USER_FOLDER=/app/.openclaw/n8n` (recommended; persists embedded n8n state inside the OpenClaw volume)
- `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true` (recommended; silences wide-permissions warning and hardens settings file)
- `N8N_VENDOR_IMAGE=ghcr.io/wickeddevsupport/openclaw-n8n-vendor:n8n-1.76.1` (recommended for speed; skips rebuilding vendored n8n on the server)
- `N8N_EMBED_PORT=5678` (optional; default is `5678`)
- `N8N_EMBED_HOST=127.0.0.1` (optional; default is `127.0.0.1`)
- `N8N_OWNER_EMAIL` (required for workspace user auto-provisioning)
- `N8N_OWNER_PASSWORD` (required for workspace user auto-provisioning)
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

If you are using the **Docker Compose** build pack (recommended), you should not set a custom build command in Coolify.

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
ssh -i <PATH_TO_SSH_KEY> <USER>@<HOST>
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
PMOS_SSH_KEY=<PATH_TO_SSH_KEY> \
PMOS_SSH_HOST=<USER>@<HOST> \
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
# 1) Login to PMOS and store the session cookie
curl -sS -c pmos.cookies.txt -X POST https://os.wickedlab.io/api/pmos/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"<EMAIL>","password":"<PASSWORD>"}'

# 2) Verify embedded n8n is auto-authenticated as the same user
curl -sS -b pmos.cookies.txt https://os.wickedlab.io/rest/login

# 3) Verify ops proxy works (workflow list)
curl -sS -b pmos.cookies.txt https://os.wickedlab.io/api/ops/workflows

# 4) Verify n8n identity is not falling back to shared owner account
curl -sS -b pmos.cookies.txt https://os.wickedlab.io/rest/login | jq -r '.data.email'
# Expect this to match the PMOS account email (or the workspace-bound mapped user),
# not a shared owner/admin email for all users.
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

- If `https://os.wickedlab.io/` returns `503` with `Control UI assets not found`:
  - The image is missing `openclaw/dist/control-ui/index.html`.
  - Ensure the Docker build runs `openclaw-control-ui:build` **after** `openclaw-app:build` (to avoid the app build wiping `dist/`), then redeploy.
- If the root started as `503` and you manually built UI assets inside the running container:
  - Restart the container so the gateway re-resolves the Control UI root and serves assets.
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
