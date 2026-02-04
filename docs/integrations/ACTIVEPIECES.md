# Activepieces Integration

Last updated: 2026-02-04

This doc shows how to run Activepieces alongside BCGPT on the same Render service and expose it at `https://automate.wickedlab.io`. The Activepieces source is vendored under `activepieces/`.

## Reverse proxy (host-based)
BCGPT proxies requests by host. Set these env vars:

```
ACTIVEPIECES_PROXY_ENABLED=true
ACTIVEPIECES_PROXY_HOST=automate.wickedlab.io
ACTIVEPIECES_PROXY_TARGET=http://127.0.0.1:4200
```

The target points to the Activepieces UI dev server (Vite). It internally proxies `/api` to the backend on `http://127.0.0.1:3000`.

## Runtime configuration (community + PGLite + in-memory Redis)
Recommended minimum for single-host setup:

```
AP_EDITION=ce
AP_ENVIRONMENT=prod
AP_FRONTEND_URL=https://automate.wickedlab.io
AP_DB_TYPE=PGLITE
AP_REDIS_TYPE=MEMORY
AP_EXECUTION_MODE=UNSANDBOXED
AP_ENCRYPTION_KEY=<32 hex chars>
AP_JWT_SECRET=<random string>
AP_CONFIG_PATH=/var/data/activepieces
AP_DEV_PIECES=bcgpt,basecamp
```

Notes:
- `AP_ENCRYPTION_KEY` must be 32 hex chars (16 bytes).
- `AP_JWT_SECRET` is required.
- `AP_CONFIG_PATH` is where PGLite stores data. Ensure this path is persistent on your host.
- `AP_REDIS_TYPE=MEMORY` is fine for small, internal setups; use Redis for scale.
- `AP_DEV_PIECES` loads local custom pieces from `dist/packages/pieces/community/*`.

## Start command
Use the root script:

```
npm run start:all
```

This runs:
- BCGPT server (`index.js`)
- Activepieces backend + engine (`dev:backend`)
- Activepieces UI (`serve:frontend`)

Before the servers start, the script builds the dev pieces:
- `bcgpt`
- `basecamp`

Note: Activepieces API uses port `3000`. Keep BCGPT on a different port (default in `.env.example` is `10000`).

## Production hardening (future)
The UI currently runs via Vite dev server for simplicity. For production:
1. Build UI (`nx build react-ui`).
2. Serve static UI via a dedicated server or configure the API server to host it.
3. Keep `/api` on the same origin as the UI.
