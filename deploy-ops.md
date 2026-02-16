# Wicked Ops (n8n) Deployment Guide

**Domain:** ops.wickedlab.io
**Engine:** n8n (white-labeled as "Wicked Ops")
**Platform:** Coolify/Docker Compose + Traefik

---

## 1. Pre-Flight Checklist

✅ DNS A record created: `ops.wickedlab.io` → Your server IP
✅ Files created:
- `docker-compose.ops.yml`
- `.env.ops` (with secure passwords generated)

---

## 2. Deployment Options

### Option A: Deploy via Coolify UI (Recommended)

1. **Login to Coolify** at your Coolify admin panel

2. **Create New Resource**
   - Type: Docker Compose
   - Name: `wicked-ops` or `ops`
   - Project: Same as your other apps

3. **Configure Docker Compose**
   - Upload or paste contents of `docker-compose.ops.yml`
   - Set environment variables from `.env.ops`:
     ```
     OPS_POSTGRES_PASSWORD=Z0bl7DobhT2en6eQqYLWv6tox
     OPS_REDIS_PASSWORD=2i07iMWHyvFcyLm9vpSesGzLX
     OPS_ENCRYPTION_KEY=05746d3c27d1297389489878b005bb9bb990c0a31dfb1f2564d0f0a1dd4fa11b
     ```

4. **Create External Volume**
   - Name: `ops-data`
   - This ensures data persists across deployments

5. **Deploy**
   - Coolify will pull images, create networks, start services
   - Traefik will auto-configure SSL via Let's Encrypt

6. **Verify**
   - Visit https://ops.wickedlab.io
   - You should see n8n setup screen

---

### Option B: Deploy via Command Line (Advanced)

```bash
# SSH to your server
ssh your-user@your-server

# Navigate to app directory (wherever you keep docker-compose files)
cd /path/to/your/apps

# Create directory for ops
mkdir -p wicked-ops
cd wicked-ops

# Copy files (you'll need to scp these from your local machine)
# scp docker-compose.ops.yml your-server:/path/to/wicked-ops/
# scp .env.ops your-server:/path/to/wicked-ops/

# Create external volume for data persistence
docker volume create ops-data

# Start services
docker-compose -f docker-compose.ops.yml --env-file .env.ops up -d

# Check logs
docker-compose -f docker-compose.ops.yml logs -f ops

# Should see: "Editor is now accessible via: https://ops.wickedlab.io"
```

---

## 3. Initial Setup (First Launch)

Once deployed, visit https://ops.wickedlab.io

### Create Owner Account
1. Fill in:
   - **Email:** your-email@example.com
   - **First Name:** Your name
   - **Last Name:** Your name
   - **Password:** Strong password

2. This becomes the n8n admin account

### Configure API Access

1. Go to **Settings** → **API**
2. Create API key:
   - Name: `PMOS Integration` or `Super Admin`
   - Click **Create**
   - **Copy the API key** (you'll need this for OpenClaw integration)

---

## 4. Test Deployment

### Test 1: Web Access
```bash
curl -I https://ops.wickedlab.io
# Expected: HTTP/2 200
```

### Test 2: API Access
```bash
# Replace YOUR_API_KEY with the key you created
curl https://ops.wickedlab.io/api/v1/workflows \
  -H "X-N8N-API-KEY: YOUR_API_KEY"

# Expected: {"data":[],"nextCursor":null}
```

### Test 3: Container Status
```bash
docker ps | grep wicked-ops

# Expected: 3 containers running
# - wicked-ops
# - wicked-ops-postgres
# - wicked-ops-redis
```

---

## 5. Security Notes

### Backup Encryption Key
The `OPS_ENCRYPTION_KEY` in `.env.ops` is **critical**:
- **Cannot be changed** after first use
- **All workflow credentials are encrypted with this key**
- **Backup this file securely**

### Recommended: Add to your backup script
```bash
# Add to your backup routine
cp .env.ops /secure-backup-location/env.ops.backup.$(date +%Y%m%d)
```

---

## 6. Next Steps

### For Multi-Tenant Isolation

Each workspace will get its own n8n API key:

1. **Super Admin Workspace:**
   - Use the API key you created during setup
   - Store in OpenClaw config as `WICKED_OPS_SUPER_ADMIN_KEY`

2. **Per-Workspace Keys:**
   - Create separate API keys for each workspace
   - Store in workspace-specific config:
     ```
     ~/.openclaw/workspaces/{workspaceId}/connectors.json
     {
       "ops": {
         "url": "https://ops.wickedlab.io",
         "apiKey": "workspace-specific-key"
       }
     }
     ```

### For OpenClaw Integration

Next step: Create `openclaw/extensions/wicked-ops/index.ts` to integrate n8n with OpenClaw.

---

## 7. Troubleshooting

### Logs
```bash
# All services
docker-compose -f docker-compose.ops.yml logs -f

# Just n8n
docker logs -f wicked-ops

# Just database
docker logs -f wicked-ops-postgres
```

### Reset (if needed)
```bash
# Stop services
docker-compose -f docker-compose.ops.yml down

# Remove volumes (WARNING: deletes all data)
docker volume rm ops-data ops-postgres-data ops-redis-data

# Recreate and start
docker volume create ops-data
docker-compose -f docker-compose.ops.yml up -d
```

---

## 8. Monitoring

### Health Check
```bash
curl https://ops.wickedlab.io/healthz
# Expected: {"status":"ok"}
```

### Database Connection
```bash
docker exec -it wicked-ops-postgres psql -U ops_user -d wicked_ops -c "SELECT COUNT(*) FROM workflow_entity;"
# Expected: count of workflows
```

---

**Deployment created:** 2026-02-17
**Files:** `docker-compose.ops.yml`, `.env.ops`
**Domain:** ops.wickedlab.io
**Status:** Ready to deploy ✅
