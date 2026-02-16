# ✅ Wicked Ops (n8n) - Deployment Successful

**Deployed:** 2026-02-16 20:26 UTC
**Platform:** Coolify (Docker Compose)
**Domain:** https://ops.wickedlab.io
**Status:** 🟢 **LIVE AND RUNNING**

---

## Deployment Summary

### Application Details
- **Coolify App Name:** ops
- **Coolify App UUID:** kgcogk04ogkwg40og4k8sksw
- **Project:** BCGPT Active Pieces > production
- **Server:** localhost (46.225.102.175)

### Running Containers
```
✅ ops-kgcogk04ogkwg40og4k8sksw-202816601967       (n8n:latest)
✅ ops-postgres-kgcogk04ogkwg40og4k8sksw-202816612557  (postgres:16-alpine)
✅ ops-redis-kgcogk04ogkwg40og4k8sksw-202816618392     (redis:7-alpine)
```

### Persistent Volumes
- `ops-data` (external) - n8n data
- `ops-postgres-data` - PostgreSQL database
- `ops-redis-data` - Redis queue

### Network Configuration
- **Public URL:** https://ops.wickedlab.io (SSL via Traefik/Let's Encrypt)
- **Traefik Network:** coolify
- **Internal Network:** ops_internal (isolated)

---

## API Configuration

### API Key
- **Name:** `os`
- **Created:** 2026-02-16
- **Type:** JWT (n8n public API)
- **Storage:** `ops-config.json`

### Test API Access
```bash
# List workflows
curl https://ops.wickedlab.io/api/v1/workflows \
  -H "X-N8N-API-KEY: [see ops-config.json]"

# Response: {"data":[],"nextCursor":null}
```

### Available Endpoints
- `/api/v1/workflows` - Workflow management
- `/api/v1/executions` - Execution history
- `/api/v1/credentials` - Credential storage (POST only)

---

## Security

### Credentials (Stored in .env.ops)
```
✅ OPS_POSTGRES_PASSWORD - PostgreSQL database
✅ OPS_REDIS_PASSWORD - Redis queue
✅ OPS_ENCRYPTION_KEY - n8n credential encryption (CRITICAL - DO NOT LOSE)
```

⚠️ **Important:** The `OPS_ENCRYPTION_KEY` cannot be changed after first use. All workflow credentials are encrypted with this key. **Backup .env.ops securely.**

---

## Files Created

| File | Purpose | Location |
|------|---------|----------|
| `docker-compose.ops.yml` | Container orchestration | Repository root |
| `.env.ops` | Environment variables (secrets) | Repository root (in git) |
| `deploy-ops.md` | Deployment guide | Repository root |
| `ops-config.json` | API configuration | Repository root |
| `WICKED_OPS_DEPLOYMENT_SUCCESS.md` | This summary | Repository root |

---

## Next Steps

### Phase 1: OpenClaw Integration (Priority: HIGH)
Create `openclaw/extensions/wicked-ops/index.ts` to integrate n8n with PMOS:

1. **Connection Tools**
   - `ops_connect` - Test connection to ops.wickedlab.io
   - `ops_list_workflows` - List all workflows
   - `ops_get_workflow` - Get workflow details
   - `ops_execute_workflow` - Trigger workflow execution
   - `ops_get_execution` - Get execution status/result

2. **Workflow Management Tools**
   - `ops_create_workflow` - Create new workflow
   - `ops_update_workflow` - Update existing workflow
   - `ops_delete_workflow` - Delete workflow
   - `ops_activate_workflow` - Activate/deactivate workflow

3. **Multi-Tenant Preparation**
   - Design workspace-specific API key storage
   - Plan per-workspace workflow isolation strategy
   - Consider n8n project API (if available in future n8n versions)

### Phase 2: Workspace Isolation (Priority: CRITICAL)
Before multi-tenant PMOS can launch, implement:

1. **Database Layer** (M1.5)
   - Add `workspaceId` filtering to all server-methods
   - Implement workspace context middleware
   - Add workspace ownership validation

2. **Ops Integration**
   - Per-workspace API keys (or workspace-tagged workflows)
   - Workflow naming convention: `{workspaceId}_{workflowName}`
   - Execution tracking per workspace

3. **Testing**
   - Create test workspaces
   - Verify data isolation (no cross-workspace access)
   - Test ops workflow isolation

### Phase 3: Migration from Activepieces
Once workspace isolation is stable:

1. **Parallel Run**
   - Keep flow.wickedlab.io running
   - Deploy new workflows to ops.wickedlab.io
   - Test equivalence

2. **BCGPT Migration**
   - Migrate BCGPT flows to n8n
   - Update BCGPT to use ops API
   - Sunset Activepieces integration

3. **Documentation**
   - Create n8n workflow templates
   - Document common automation patterns
   - Build workflow library for PMOS users

---

## Monitoring

### Health Checks
```bash
# Container status
ssh deploy@46.225.102.175 "sudo docker ps | grep ops-"

# n8n logs
ssh deploy@46.225.102.175 "sudo docker logs -f ops-kgcogk04ogkwg40og4k8sksw-202816601967"

# Web access test
curl -I https://ops.wickedlab.io
```

### Database Queries
```bash
# Via Coolify postgres container
ssh deploy@46.225.102.175 "sudo docker exec ops-postgres-kgcogk04ogkwg40og4k8sksw-202816612557 \
  psql -U ops_user -d wicked_ops -c 'SELECT COUNT(*) FROM workflow_entity;'"
```

---

## Troubleshooting

### Restart Services
```bash
# Via Coolify API
curl -X POST 'http://localhost:8000/api/v1/restart?uuid=kgcogk04ogkwg40og4k8sksw' \
  -H 'Authorization: Bearer [COOLIFY_API_TOKEN]'

# Or manually via docker
ssh deploy@46.225.102.175 "sudo docker restart ops-kgcogk04ogkwg40og4k8sksw-202816601967"
```

### View Deployment Logs
```bash
# Via Coolify UI
# Navigate to: BCGPT Active Pieces > production > ops > Deployments

# Or via API
curl 'http://localhost:8000/api/v1/deployments/w884gkwkw0gc4ok0gk44csok' \
  -H 'Authorization: Bearer [COOLIFY_API_TOKEN]'
```

---

## Related Documentation

- [deploy-ops.md](deploy-ops.md) - Full deployment guide
- [ops-config.json](ops-config.json) - API configuration
- [N8N_VS_ACTIVEPIECES_COMPARISON.md](docs/system/operations/N8N_VS_ACTIVEPIECES_COMPARISON.md) - Why n8n?
- [WORKSPACE_ISOLATION_PLAN.md](docs/system/operations/WORKSPACE_ISOLATION_PLAN.md) - Multi-tenant architecture
- [NEXT_STEPS.md](docs/system/operations/summaries/NEXT_STEPS.md) - PMOS productization roadmap

---

**Deployment completed by:** Claude Sonnet 4.5
**Session:** 2026-02-16
**Status:** ✅ Production-ready, awaiting OpenClaw integration
