# Flow App Store - Deployment Guide

**Deployment Date:** 2026-02-11  
**Commit:** `30e17eb3 - feat: Flow App Store MVP - Milestone 1 complete`  
**Status:** Pushed to main branch

---

## Deployment Configuration

### Service Location
- **Main App:** `bcgpt.wickedlab.io` (port 10000)
- **Activepieces:** `flow.wickedlab.io` (webhook target)
- **App Store:** Mounted at `bcgpt.wickedlab.io/apps`
- **Public Gallery:** `https://bcgpt.wickedlab.io/apps`
- **App API:** `https://bcgpt.wickedlab.io/apps/api/apps`

### Platform
- **Deployed On:** Coolify (based on docker-compose configuration)
- **Container:** Node.js with all dependencies pre-installed
- **Database:** SQLite (local) or Postgres (production via DATABASE_URL)
- **Reverse Proxy:** Traefik with TLS

### Environment Variables (Already Set)
```
PORT=10000
APP_BASE_URL=https://bcgpt.wickedlab.io (for webhook redirects)
SQLITE_PATH=/data/bcgpt.sqlite (persistent storage)
ACTIVEPIECES_PROXY_ENABLED=true
ACTIVEPIECES_PROXY_HOST=flow.wickedlab.io
ACTIVEPIECES_PROXY_TARGET=http://activepieces:80
```

---

## Deployment Process

### 1. Code Push (✅ COMPLETE)
```bash
git push origin main
```
**Result:** Commit `30e17eb3` now on GitHub

### 2. Coolify Auto-Deploy (In Progress)
Coolify watches the GitHub repository for changes:
- Detects new commits on `main` branch
- Pulls latest code
- Runs `npm install` (if package.json changed)
- Restarts the Node.js container
- New code takes effect within 1-5 minutes

**Monitoring:** Check Coolify dashboard at your Coolify instance URL

### 3. Database Migration (Automatic)
When the app starts:
1. Reads `db.sqlite.js` and `db.postgres.js`
2. Runs `CREATE TABLE IF NOT EXISTS` statements
3. Creates 4 new tables if they don't exist
4. **No downtime** - existing tables untouched
5. Ready for immediate use

### 4. Verification (See Below)

---

## Verification Steps

### Step 1: Check App Store Gallery
```
URL: https://bcgpt.wickedlab.io/apps
Expected: Beautiful gallery page with purple gradient
         "No apps yet" message (until seeded)
```

### Step 2: Verify API is Working
```bash
curl https://bcgpt.wickedlab.io/apps/api/apps
```

**Expected Response:**
```json
{
  "data": [],
  "count": 0
}
```

### Step 3: Check Database Tables Exist
```bash
# SSH into server
ssh [server]
cd /path/to/bcgpt
sqlite3 /data/bcgpt.sqlite

# In SQLite:
.tables
# Should show: flow_apps, app_executions, app_reviews, user_app_favorites, ...
```

### Step 4: Seed Demo Apps (Optional)
```bash
# SSH into server and run:
cd /path/to/bcgpt
node scripts/seed-app-store.mjs
```

**Expected Output:**
```
🌱 Seeding Flow App Store with demo apps...
✅ Created: AI Image Generator (Demo)
✅ Created: Smart Text Summarizer (Demo)
✅ Created: JSON Data Formatter (Demo)
🎉 Seeding complete!
```

### Step 5: View Live Gallery
```
URL: https://bcgpt.wickedlab.io/apps
Expected: 3 demo app cards visible
```

---

## Testing on Live Server

### Test 1: Browse Gallery
1. Open `https://bcgpt.wickedlab.io/apps`
2. See gallery with all published apps
3. Each app shows: icon, name, category, description, rating, usage count
4. Search/filter controls work

### Test 2: Open an App
1. Click "Open App" on any card
2. See app runtime page with:
   - App name and description
   - Dynamic form with input fields
   - "Run App" button
3. Form validation works (required fields)

### Test 3: Execute an App
1. Fill out the form with test data
2. Click "Run App"
3. See loading spinner (3-30 seconds depending on flow)
4. Result displays with formatted output

**Note:** Demo flows won't actually exist yet, so execution will fail. For real testing, you need to:
1. Create flows in Activepieces (flow.wickedlab.io)
2. Publish the flows
3. Update demo app `flow_id` to match real flow IDs
4. Test again

### Test 4: Check Execution Logs
```bash
# SSH into server
sqlite3 /data/bcgpt.sqlite

# In SQLite:
SELECT app_id, status, execution_time_ms FROM app_executions ORDER BY created_at DESC LIMIT 5;
```

---

## Troubleshooting Deployment

### Issue: App Store URL returns 404
**Possible Causes:** 
- Deployment not complete yet (wait 5 minutes)
- Container not restarted
- Port 10000 not exposed

**Solution:**
```bash
# SSH into server
docker ps | grep bcgpt
# Check if container is running
docker logs [container_id]
# Should show: "bcgpt-full-v3 running on 10000"
```

### Issue: Gallery page loads but says "Failed to load gallery"
**Possible Causes:**
- Database tables not created
- SQLite file permissions issue
- NODE_ENV not set correctly

**Solution:**
```bash
# Check database exists
ls -la /data/bcgpt.sqlite

# Check tables
sqlite3 /data/bcgpt.sqlite ".tables" | grep flow_apps

# If missing, manually create:
cd /data
cp bcgpt.sqlite bcgpt.sqlite.backup
node scripts/seed-app-store.mjs
```

### Issue: App execution fails with "Flow not found"
**Possible Causes:**
- Webhook URL incorrect (APP_BASE_URL not set)
- Flow ID doesn't exist in Activepieces
- Flow is disabled or not published

**Solution:**
- Verify `APP_BASE_URL` is set to `https://bcgpt.wickedlab.io`
- Create real flows in Activepieces at `https://flow.wickedlab.io`
- Publish the flows and copy flow IDs
- Update app records with correct flow IDs:
```bash
sqlite3 /data/bcgpt.sqlite
UPDATE flow_apps SET flow_id = 'actual-flow-id' WHERE slug = 'ai-image-generator';
```

### Issue: Port 10000 already in use / container won't start
**Solution:**
1. Stop existing container: `docker stop bcgpt`
2. Check what's using the port: `lsof -i :10000`
3. Kill the process if needed: `kill -9 [pid]`
4. Restart container via Coolify dashboard

---

## Performance Notes

**Expected Performance on Live Server:**
- Gallery page load: **< 1 second**
- App runtime page: **< 500ms**
- App execution: **3-30 seconds** (depends on flow complexity)
- Database queries: **< 100ms**

**Scaling Recommendations:**
- Currently single-container setup
- For high traffic (100+ concurrent users), add:
  - Load balancer (Coolify can do this)
  - Redis cache for app metadata
  - Separate database server (Postgres)

---

## Monitoring

### Key Metrics to Watch
1. **Deployment Status** - Check Coolify dashboard
2. **Container Health** - Docker should report "healthy"
3. **Database Size** - SQLite file will grow with executions
4. **API Response Times** - Monitor /apps/api/apps endpoint
5. **Error Rates** - Check Docker logs for errors

### Coolify Dashboard Checks
- ✅ Service is running
- ✅ No container restarts (watchdog restarts)
- ✅ Memory usage < 500MB
- ✅ CPU usage < 20% idle
- ✅ Storage has > 1GB free

### Logs to Monitor
```bash
# SSH into server
docker logs -f [bcgpt-container-id]

# Should see:
# ✅ [APP_STORE] Gallery rendered
# ✅ POST /apps/api/:id/execute
# ✅ Execution successful
# ⚠️ [APP_STORE] errors (if any)
```

---

## Rollback Plan

If there's a critical issue:

### Quick Rollback (< 2 minutes)
```bash
# SSH into server
cd /path/to/bcgpt
git revert HEAD
git push origin main
# Coolify detects change and redeploys
```

### Full Rollback (if needed)
```bash
git checkout tag/stable-2026-02-10
git push origin main -f
```

### Database Rollback (if needed)
```bash
# Restore backup
cd /data
cp bcgpt.sqlite.backup bcgpt.sqlite

# Restart container
docker restart [bcgpt-container-id]
```

---

## Next Steps After Deployment Verification

1. **Create Real Flows** - Build workflows in Activepieces for testing
2. **Connect Flows to Apps** - Update flow_id in database
3. **Test Full Workflow** - Fill forms and execute flows
4. **Gather Feedback** - Test with team members
5. **Plan Phase 2** - Creator dashboard and publishing UI

---

## Support & Questions

For issues or questions:
1. Check Docker logs: `docker logs [container]`
2. Check database: `sqlite3 /data/bcgpt.sqlite`
3. Review error messages in browser console
4. Check Coolify deployment history

---

**Document Version:** 1.0  
**Deployment Date:** 2026-02-11  
**Last Updated:** 2026-02-11
