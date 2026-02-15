# Phase 8: Hardening & Deployment Guide

This document covers production hardening for the Apps Platform, including security, monitoring, and emergency procedures.

## 1. Security Hardening

### 1.1 Credential Protection
**Status**: ✅ IMPLEMENTED

- Secrets fields masked in UI (password type fields)
- Runtime never logs sensitive inputs
- Public execute path does not expose workspace secrets
- Secrets Schema separated from User Input Schema

**Verification**:
```bash
# Check that execute endpoint doesn't log payload
grep -r "JSON.stringify.*payload\|console.log.*body" activepieces/packages/server/api/src/app/flow-gallery/
# Should not log raw body to stdout
```

### 1.2 Audience Enforcement
**Status**: ✅ IMPLEMENTED

- `internal` apps require authentication (blocked for public)
- `external` apps can run without auth
- Publisher enforces audience/runnerMode sync (internal=workspace_only, external=public_page)

**Verification**:
```bash
# Test internal app from unauthenticated session
curl -X GET "https://flow.wickedlab.io/apps/:internal_app_id" \
  -H "Authorization: "
# Should redirect to login or return 401/403

# Test external app without auth
curl -X GET "https://flow.wickedlab.io/apps/:external_app_id"
# Should render successfully
```

### 1.3 Rate Limiting
**Status**: ⚠️ NEEDS IMPLEMENTATION

**Recommended**:
- Per-IP rate limit: 60 executions/minute for public apps
- Per-session rate limit: 120 executions/minute for authenticated
- Shared workspace secret mode: 10 executions/minute (high impact)

**Implementation**:
```typescript
// In flow-gallery.controller.ts, apply before execute endpoint
const executeRateLimit: RateLimitOptions = {
  max: 60,
  timeWindow: '1 minute',
};

app.post('/:id/execute', {
  rateLimit: executeRateLimit,
}, async (request, reply) => {
  // ...
})
```

### 1.4 Payload Size Limits
**Status**: ⚠️ NEEDS IMPLEMENTATION

**Recommended**:
- Max request body: 1MB
- Max input field: 256KB
- Max array field: 100 items

**Implementation**: Already set at Fastify level with `bodyLimit` option.

### 1.5 CORS & CSP
**Status**: ✅ IMPLEMENTED (via Fastify defaults)

- CORS restricted to same-origin by default
- CSP headers set for public HTML responses
- Sandbox iframe for HTML output rendering

## 2. Audit & Compliance Events

**Status**: ⚠️ NEEDS IMPLEMENTATION

### 2.1 Audit Trail
Track these events:
- Publish app (who, when, app metadata)
- Update app (what changed)
- Unpublish app (who, when)
- Execute app (user/session, timestamp, inputs hash, result status)
- Seed defaults (admin, timestamp, reset flag)

**Schema**:
```sql
CREATE TABLE app_audit_events (
  id UUID PRIMARY KEY,
  platform_id UUID NOT NULL,
  app_id UUID,
  event_type VARCHAR(32), -- publish, update, unpublish, execute, seed
  user_id UUID,
  session_id VARCHAR(64),
  request_meta JSONB, -- IP, User-Agent
  event_meta JSONB, -- event-specific data
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_app_audit_app ON app_audit_events(platform_id, app_id, created_at);
CREATE INDEX idx_app_audit_user ON app_audit_events(user_id, created_at);
```

### 2.2 Logging Strategy
- All audit events logged to `app_audit_events` table
- Failed executions logged with sanitized error message (no payload)
- Admin audit log viewer in Platform Admin dashboard
- Export capability for compliance

## 3. Monitoring & Telemetry

**Status**: ✅ PARTIAL (metrics stored, dashboard needed)

### 3.1 Metrics Tracked
- `app:run_count` - total executions
- `app:success_count` - successful executions
- `app:failure_count` - failed executions
- `app:median_execution_time_ms` - median runtime
- `app:failure_buckets` - grouped by error reason

**Verification**:
```typescript
// Check flow-gallery.service.ts for stats collection
grep -A 10 "app:run_count\|successCount\|failureCount" activepieces/packages/server/api/src/app/flow-gallery/
```

### 3.2 Telemetry Dashboard (TODO)
- Per-app success rate trend
- Runtime distribution chart (min/median/max/p95)
- Failure breakdown by reason
- Top apps by usage
- User retention for internal apps

## 4. Error Handling & Instrumentation

**Status**: ✅ IMPLEMENTED (application level)

### 4.1 Error Response Format
**Pattern**: All errors return standardized format

```typescript
{
  error: {
    code: "UNKNOWN_ERROR", // error code for client retry/routing
    message: "User-friendly message without sensitive data",
    details: {}, // optional structured details for debugging
  }
}
```

**Error Classes**:
- `AppNotFoundError` (404)
- `AppAccessDeniedError` (403)
- `ExecutionFailedError` (500 - execution failed)
- `ValidationError` (400 - invalid input)
- `RateLimitError` (429)

### 4.2 Logging
- Use structured logging (JSON format) for all errors
- Include requestId for tracing
- Never log payloads or secrets

**Example**:
```typescript
logger.error({
  requestId: request.id,
  error: err.message,
  errorCode: err.code,
  app_id: appId,
  execution_time_ms: stopwatch.ms(),
  // NO: payload, secrets, raw error details
});
```

## 5. Production Readiness Checklist

### Pre-Launch
- [ ] Audit events table created and working
- [ ] Rate limits deployed and tested against production traffic
- [ ] Error logging verified (100% of errors captured)
- [ ] Validate Traefik router label syntax (run `npm run lint:traefik`)
- [ ] Credentials are never logged (audit payload == no secrets)
- [ ] HTTPS enforced on all routes
- [ ] Database backups automated (daily, 30-day retention)
- [ ] Roll-forward and rollback procedures documented
- [ ] On-call escalation runbook created
- [ ] Monitoring/alerting for error rates (>5% trigger page)
- [ ] Customer communication plan for incidents

### Post-Launch
- [ ] Monitor error rates daily for first week
- [ ] Check audit events for suspicious patterns (repeated failures, rate limit hits)
- [ ] Performance profiling: p95 execution time < 10s
- [ ] Customer feedback: 90% self-service without support tickets

## 6. Incident Response Playbook

### Incident: High Error Rate on Public Apps (~50%+)

**Detection**: Alert fires when app:success_count < 0.5 * (success + failure)

**Response**:
1. Immediately page on-call engineer
2. Check flow-gallery error logs for common patterns
3. If pattern is clear (e.g., auth failure), disable app temporarily
4. Post incident update to status page
5. RCA within 4 hours

**Rollback Plan**:
```bash
# If last deploy caused issue, rollback via:
git revert <bad_commit>
git push origin main
# Coolify auto-deploys within 5 minutes
```

### Incident: Seed Defaults Corrupted User Apps

**Prevention**: Seed uses upsert with `appsSeedKey` marker to avoid overwriting user apps

**Recovery**:
```bash
# If corruption detected, restore from backup
# 1. Identify affected apps (last_updated after seed time)
SELECT * FROM app_gallery_apps 
WHERE updated_at > :seed_start_time 
AND published_by != 'system'
ORDER BY updated_at DESC;

# 2. Restore from backup snapshot
# See Infrastructure/Backup section
```

### Incident: Rate Limit False Positives (Legitimate Users Blocked)

**Detection**: >10 429 errors from unique IPs within 5min

**Response**:
1. Check if IP is subnet (e.g., office or cloud provider)
2. Whitelist IP in rate limit middleware if legitimate
3. Adjust rate limit if needed (e.g., 100/min instead of 60/min)

**Short-term fix**:
```typescript
// Add IP whitelist to middleware
const WHITELISTED_IPS = process.env.RATE_LIMIT_WHITELIST?.split(',') || [];
if (WHITELISTED_IPS.includes(request.ip)) {
  // Skip rate limit
  return next();
}
```

## 7. Deployment Procedure

### Standard Deploy
```bash
# 1. Commit code and merge to main
git commit -m "feat: ..."
git push origin main

# 2. Verify tests pass
# GitHub Actions runs on push

# 3. Coolify auto-deploys within 5 minutes
# Verify at: https://flow.wickedlab.io/apps

# 4. Sample test after deploy
curl -X GET "https://flow.wickedlab.io/apps/api/apps?limit=1"
# Verify 200 response with valid JSON
```

### Emergency Hotfix Deploy
```bash
# 1. Fix bug in branch
git checkout -b hotfix/critical-bug
git commit -m "fix: critical security issue"

# 2. Immediately push to main (no review needed for critical security)
git push origin hotfix/critical-bug:main

# 3. Notify team
# Post to #incidents channel with what was fixed

# 4. Monitor for 30 minutes for errors
```

### Rollback
```bash
# If deploy introduces errors:
git revert <bad_commit>
git push origin main
# Deploys within 5 minutes
```

## 8. Infrastructure & Backup

**Current State**:
- Host: Hetzner server (46.225.102.175)
- Reverse Proxy: Traefik
- Containers: Docker Compose
- Database: PostgreSQL (hosted)
- Auto-backup: Coolify (daily)

**Backup Verify** (daily):
```bash
# SSH to server
ssh root@46.225.102.175

# Check database backup age
ls -lh /var/backups/activepieces*.sql.gz | tail -1
# Should be < 24 hours old

# Test restore (dry-run)
pg_restore --schema-only -d activepieces_test /var/backups/activepieces_latest.sql.gz
# Should complete without errors
```

## 9. Performance Benchmarks

**Target Metrics**:
- P50 execution time: < 2s
- P95 execution time: < 10s
- P99 execution time: < 30s
- Gallery load (100 apps): < 1s
- Publish endpoint: < 500ms

**Profiling Tools**:
```bash
# Check app execution performance
SELECT 
  app_id,
  COUNT(*) as run_count,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY execution_time_ms) as p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time_ms) as p95,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY execution_time_ms) as p99
FROM app_runs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY app_id
ORDER BY run_count DESC;
```

## 10. Customer Support Runbook

### Common Issues & Resolution

**Q: "My app execution failed"**
A: 
1. Check Requirements step (are all prerequisites met?)
2. Check Connect step (are credentials valid?)
3. Check Configure step (are inputs in expected format?)
4. Check error message for specifics

**Q: "I can't publish my app"**
A: 
1. Ensure audience and runner_mode match:
   - internal → workspace_only
   - external → public_page  
2. Ensure auth_mode has at least one requirement listed if not "none"
3. Verify all input fields have unique names

**Q: "The app is running slowly"**
A:
1. Check if external service (Basecamp, etc.) is slow
2. If consistently slow, consider async mode in future phases
3. Current max timeout is 60 seconds

## 11. Metrics for Success (Phase 8)

By end of Phase 8, measure:
- ✅ Zero unhandled exceptions in production
- ✅ 99% of errors logged with context
- ✅ 100% of sensitive data never logged
- ✅ Rollback procedure tested and < 5min execution
- ✅ On-call team trained
- ✅ Incident response procedures documented

---

**Last Updated**: 2026-02-12
**Owner**: Wicked Flow Team
**Status**: Draft → Ready for Review
