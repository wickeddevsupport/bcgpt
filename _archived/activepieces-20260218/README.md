# Archived Activepieces Code

**Archived:** 2026-02-18
**Reason:** Migration to n8n (Wicked Ops) completed successfully

## What Was Archived

- `activepieces/` - Full Activepieces codebase (132MB)
- `activepieces-client.js` - Activepieces client library
- `docker-compose.activepieces.yml` - Production Docker Compose
- `docker-compose.activepieces.local.yml` - Local development Docker Compose
- `scripts/prepare-activepieces-install.js` - Postinstall script
- `scripts/verify-activepieces-local.mjs` - Verification script

## Replacement

The Activepieces integration has been replaced by:
- **Wicked Ops** (n8n) at https://ops.wickedlab.io
- **Docker Compose:** `docker-compose.ops.yml`
- **API Config:** `ops-config.json`

## Restoration

If needed, restore with:
```bash
cd /root/.openclaw/workspace/projects/bcgpt
mv _archived/activepieces-20260218/activepieces ./
mv _archived/activepieces-20260218/activepieces-client.js ./
mv _archived/activepieces-20260218/docker-compose.activepieces*.yml ./
```

And restore package.json scripts (see git history for original version).

## References

- [WICKED_OPS_DEPLOYMENT_SUCCESS.md](../WICKED_OPS_DEPLOYMENT_SUCCESS.md)
- [deploy-ops.md](../deploy-ops.md)
- [PMOS_PRODUCTIZATION_IMPLEMENTATION.md](../PMOS_PRODUCTIZATION_IMPLEMENTATION.md)
