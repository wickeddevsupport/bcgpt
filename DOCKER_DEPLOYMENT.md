# Docker Deployment Guide

## Overview

You now have **2 ways** to run the 3-layer platform:

### 1. **Local (No Containers)** - For Development
```powershell
.\start-all.ps1
```

### 2. **Docker (Containers)** - For Production
```bash
docker-compose -f docker-compose.full-stack.yml up -d
```

---

## Docker Files Created

- `Dockerfile.pmos` - PMOS container
- `Dockerfile.flow` - Flow container  
- `docker-compose.pmos.yml` - PMOS standalone
- `docker-compose.flow.yml` - Flow standalone
- `docker-compose.full-stack.yml` - **All 3 layers together**

---

## Deployment Options

### Option A: Deploy All 3 Layers Together (Recommended)

```bash
# Build and start everything
docker-compose -f docker-compose.full-stack.yml up -d --build

# Check status
docker-compose -f docker-compose.full-stack.yml ps

# View logs
docker-compose -f docker-compose.full-stack.yml logs -f

# Stop everything
docker-compose -f docker-compose.full-stack.yml down
```

**Exposes:**
- `bcgpt.wickedlab.io` → BCGPT (port 10000)
- `pmos.wickedlab.io` → PMOS (port 10001)
- `flow-api.wickedlab.io` → Flow (port 10002)

---

### Option B: Deploy Each Layer Separately

```bash
# BCGPT only
docker-compose -f docker-compose.bcgpt.yml up -d

# PMOS only
docker-compose -f docker-compose.pmos.yml up -d

# Flow only
docker-compose -f docker-compose.flow.yml up -d
```

---

### Option C: Mix Docker + Local

You can run some in Docker and some locally:

```bash
# BCGPT in Docker
docker-compose -f docker-compose.bcgpt.yml up -d

# PMOS and Flow locally
cd pmos-server && node index.js &
cd flow-server && node index.js &
```

---

## Environment Variables

Create `.env` file in project root:

```bash
# BCGPT
APP_BASE_URL=https://bcgpt.wickedlab.io
BASECAMP_CLIENT_ID=your_client_id
BASECAMP_CLIENT_SECRET=your_secret
BCGPT_POSTGRES_PASSWORD=secure_password
CHATGPT_API_KEY=your_key
OTP_SECRET=your_otp_secret

# PMOS
BCGPT_URL=http://bcgpt:10000
FLOW_URL=http://flow:10002
LOG_LEVEL=info

# Flow
ACTIVEPIECES_URL=https://flow.wickedlab.io
ACTIVEPIECES_API_KEY=your_activepieces_key

# Optional
PAYLOAD_CACHE_TTL_SEC=3600
ACTIVEPIECES_PROXY_ENABLED=false
```

---

## Network Architecture

### Internal Communication (Docker)
```
bcgpt:10000  ←→  pmos:10001
     ↓              ↓
     └──→  flow:10002
```

Services communicate via internal network using container names.

### External Access (Traefik)
```
Internet → Traefik → bcgpt.wickedlab.io (BCGPT)
                  → pmos.wickedlab.io (PMOS)
                  → flow-api.wickedlab.io (Flow)
```

---

## Volumes

Data persists in Docker volumes:

- `bcgpt-data` - BCGPT SQLite database
- `pmos-data` - PMOS intelligence data (JSON)
- `postgres-data` - PostgreSQL database

**Backup volumes:**
```bash
docker run --rm -v bcgpt-data:/data -v $(pwd):/backup alpine tar czf /backup/bcgpt-backup.tar.gz /data
```

---

## Health Checks

```bash
# Check all services
curl http://bcgpt.wickedlab.io/health
curl http://pmos.wickedlab.io/health
curl http://flow-api.wickedlab.io/health

# Or via docker exec
docker exec bcgpt-bcgpt-1 curl localhost:10000/health
docker exec bcgpt-pmos-1 curl localhost:10001/health
docker exec bcgpt-flow-1 curl localhost:10002/health
```

---

## Scaling

Scale individual services:

```bash
# Scale PMOS for more intelligence processing
docker-compose -f docker-compose.full-stack.yml up -d --scale pmos=3

# Scale Flow for more automation throughput
docker-compose -f docker-compose.full-stack.yml up -d --scale flow=2
```

---

## Troubleshooting

### Container won't start
```bash
# View logs
docker-compose -f docker-compose.full-stack.yml logs pmos

# Check if port is in use
netstat -ano | findstr :10001

# Rebuild container
docker-compose -f docker-compose.full-stack.yml up -d --build pmos
```

### Gateway routing fails
```bash
# Test internal connectivity
docker exec bcgpt-bcgpt-1 curl http://pmos:10001/health
docker exec bcgpt-bcgpt-1 curl http://flow:10002/health

# Check networks
docker network inspect coolify
docker network inspect bcgpt_internal
```

### Database issues
```bash
# Reset PMOS data
docker volume rm bcgpt_pmos-data

# Reset all data (WARNING: deletes everything)
docker-compose -f docker-compose.full-stack.yml down -v
```

---

## Production Checklist

- [ ] Set strong passwords in `.env`
- [ ] Configure ACTIVEPIECES_API_KEY
- [ ] Set up SSL certificates (Traefik/Let's Encrypt)
- [ ] Configure backup strategy for volumes
- [ ] Set up monitoring (health endpoints)
- [ ] Configure log rotation
- [ ] Test gateway routing between layers
- [ ] Verify all 323 tools are accessible
- [ ] Set up firewall rules (only expose via Traefik)

---

## Quick Commands Reference

```bash
# Start everything
docker-compose -f docker-compose.full-stack.yml up -d

# Stop everything
docker-compose -f docker-compose.full-stack.yml down

# Restart one service
docker-compose -f docker-compose.full-stack.yml restart pmos

# View logs (all)
docker-compose -f docker-compose.full-stack.yml logs -f

# View logs (one service)
docker-compose -f docker-compose.full-stack.yml logs -f pmos

# Rebuild after code changes
docker-compose -f docker-compose.full-stack.yml up -d --build

# Shell into container
docker exec -it bcgpt-pmos-1 sh

# Check resource usage
docker stats
```

---

## Summary

**For Development:** Use `.\start-all.ps1` (no Docker needed)

**For Production:** Use `docker-compose -f docker-compose.full-stack.yml up -d`

Both work identically - containers are just for easier production deployment!
