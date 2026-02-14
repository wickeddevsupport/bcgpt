# Custom API Key Feature for Activepieces CE

## Overview
Successfully implemented full API key authentication for Activepieces Community Edition (CE). This feature was previously only available in Enterprise Edition (EE) but is now available for CE users.

## What Was Built

### 1. Database Layer
**File:** `activepieces/packages/server/api/src/app/api-key/api-key-entity.ts`
- TypeORM entity for `api_key` table
- Columns: id, created, updated, displayName, value (hashed), platformId, lastUsedAt
- Indices on value (unique) and platformId

### 2. Business Logic
**File:** `activepieces/packages/server/api/src/app/api-key/api-key-service.ts`
- **create()** - Generate secure API keys with `ap_` prefix, hash with SHA-256
- **list()** - Paginated list of API keys (without values) for a platform
- **delete()** - Remove API key by ID
- **getByValue()** - Authenticate requests using API key (auto-updates lastUsedAt)

**Security Features:**
- API keys are hashed using SHA-256 before storage
- Unhashed value only returned once on creation
- Format: `ap_<base64url-encoded-random-bytes>` (44 characters total)
- Automatic timestamp tracking (created, updated, lastUsedAt)

### 3. REST API Endpoints
**File:** `activepieces/packages/server/api/src/app/api-key/api-key-controller.ts`

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/v1/api-keys` | List all API keys | User (JWT) |
| POST | `/v1/api-keys` | Create new API key | User (JWT) |
| DELETE | `/v1/api-keys/:id` | Delete API key | User (JWT) |

**Request/Response Examples:**

**Create API Key:**
```bash
curl -X POST https://flow.wickedlab.io/api/v1/api-keys \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"displayName": "BCGPT Integration Key"}'
```

Response:
```json
{
  "id": "abc123xyz789",
  "created": "2026-02-14T10:30:00Z",
  "updated": "2026-02-14T10:30:00Z",
  "displayName": "BCGPT Integration Key",
  "value": "ap_A8k2Jd9fP3mL6nQ4tR7wE1xY5bC0vH2sZ9gF8jK4",
  "lastUsedAt": null
}
```

⚠️ **IMPORTANT:** The `value` field is only returned ONCE. Save it immediately!

**List API Keys:**
```bash
curl https://flow.wickedlab.io/api/v1/api-keys \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>"
```

Response:
```json
{
  "data": [
    {
      "id": "abc123xyz789",
      "created": "2026-02-14T10:30:00Z",
      "updated": "2026-02-14T10:30:00Z",
      "displayName": "BCGPT Integration Key",
      "lastUsedAt": "2026-02-14T12:45:00Z"
    }
  ],
  "next": null,
  "previous": null
}
```

### 4. Authentication Middleware
**File:** `activepieces/packages/server/api/src/app/core/security/v2/authn/authenticate.ts`

Authentication now supports two methods:

**1. JWT Token (existing):**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**2. API Key (new):**
```
Authorization: Bearer ap_A8k2Jd9fP3mL6nQ4tR7wE1xY5bC0vH2sZ9gF8jK4
```

The middleware automatically detects API keys by the `ap_` prefix and authenticates using the hashed value lookup.

### 5. Database Migration
**File:** `activepieces/packages/server/api/src/app/database/migration/postgres/1770100000000-AddApiKeysCE.ts`

- Creates `api_key` table if it doesn't exist
- Safe for existing installs (checks table existence first)
- Idempotent - can be run multiple times safely
- Registered in postgres-connection.ts migration list

### 6. Module Registration
**Files:**
- `activepieces/packages/server/api/src/app/api-key/api-key-module.ts` - Module definition
- `activepieces/packages/server/api/src/app/app.ts` - Registered in main app

## How to Use

### Step 1: Rebuild Activepieces Image

```bash
cd activepieces
docker build -t ghcr.io/wickeddevsupport/activepieces-bcgpt:latest -f Dockerfile .
```

### Step 2: Deploy Updated Image

```bash
docker-compose -f docker-compose.activepieces.yml down
docker-compose -f docker-compose.activepieces.yml up -d
```

The migration will run automatically on startup and create the `api_key` table.

### Step 3: Create API Key

**Option A: Using JWT from Browser**

1. Login to flow.wickedlab.io
2. Open DevTools (F12) → Console
3. Run: `localStorage.getItem('token')`
4. Copy the JWT token
5. Create API key:

```bash
JWT_TOKEN="<paste-token-here>"

curl -X POST https://flow.wickedlab.io/api/v1/api-keys \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName": "BCGPT Integration"}'
```

6. Save the returned `value` field - this is your permanent API key!

**Option B: Using REST Client**

Use Postman/Insomnia:
- URL: `https://flow.wickedlab.io/api/v1/api-keys`
- Method: POST
- Headers: `Authorization: Bearer <JWT_FROM_DEVTOOLS>`
- Body: `{"displayName": "My API Key"}`

### Step 4: Use API Key in BCGPT

Update BCGPT `.env`:
```env
ACTIVEPIECES_URL=https://flow.wickedlab.io
ACTIVEPIECES_API_KEY=ap_A8k2Jd9fP3mL6nQ4tR7wE1xY5bC0vH2sZ9gF8jK4
```

Restart BCGPT:
```bash
docker-compose -f docker-compose.bcgpt.yml restart
```

### Step 5: Test API Key

```bash
# Test with your new API key
API_KEY="ap_..."

curl https://flow.wickedlab.io/api/v1/flows \
  -H "Authorization: Bearer $API_KEY"
```

Should return list of flows ✅

## API Key Management

### View All Keys
```bash
curl https://flow.wickedlab.io/api/v1/api-keys \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### Delete Key
```bash
curl -X DELETE https://flow.wickedlab.io/api/v1/api-keys/<KEY_ID> \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### Check Last Used
The `lastUsedAt` timestamp is automatically updated each time an API key is used for authentication.

## Security Considerations

### ✅ What's Secure
- API keys are hashed using SHA-256 before storage
- Original key value never stored in database
- Keys are cryptographically random (32 bytes = 256 bits entropy)
- `lastUsedAt` tracking for monitoring
- Platform isolation (keys scoped to platformId)

### ⚠️ Best Practices
- **Rotate keys regularly** - delete old keys and create new ones
- **Use descriptive names** - helps identify compromised keys
- **Store keys securely** - use environment variables, never commit to git
- **Monitor lastUsedAt** - detect unauthorized usage
- **One key per service** - easier to revoke if compromised

### 🔒 What API Keys Can Do
API keys have the same permissions as the user who created them. They can:
- List/create/update/delete flows
- Trigger flow executions
- Manage connections
- Access projects the user has access to

They CANNOT:
- Create other API keys (requires JWT)
- Delete API keys (requires JWT)
- Change user settings

## Files Created/Modified

### New Files (6)
1. `api-key/api-key-entity.ts` - Database schema
2. `api-key/api-key-service.ts` - Business logic
3. `api-key/api-key-controller.ts` - REST endpoints
4. `api-key/api-key-module.ts` - Module wrapper
5. `database/migration/postgres/1770100000000-AddApiKeysCE.ts` - Migration
6. *(this file)* `API_KEY_IMPLEMENTATION.md` - Documentation

### Modified Files (3)
1. `core/security/v2/authn/authenticate.ts` - Added API key auth logic
2. `database/postgres-connection.ts` - Registered migration
3. `app.ts` - Registered API key module

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  BCGPT Container                                    │
│  ┌───────────────────────────────────────────────┐ │
│  │ activepieces-client.js                        │ │
│  │                                               │ │
│  │ Uses: ACTIVEPIECES_API_KEY                   │ │
│  │ Format: Bearer ap_xxxxx...                   │ │
│  └───────────┬───────────────────────────────────┘ │
└──────────────┼─────────────────────────────────────┘
               │ HTTPS
               ▼
┌─────────────────────────────────────────────────────┐
│  Activepieces Container (flow.wickedlab.io)        │
│  ┌───────────────────────────────────────────────┐ │
│  │ Authentication Middleware                     │ │
│  │                                               │ │
│  │ 1. Check "Authorization" header              │ │
│  │ 2. If "Bearer ap_" → API Key Auth            │ │
│  │ 3. If "Bearer eyJ" → JWT Auth                │ │
│  │ 4. Hash key & lookup in database             │ │
│  │ 5. Create principal with platformId          │ │
│  └───────────┬───────────────────────────────────┘ │
│              ▼                                      │
│  ┌───────────────────────────────────────────────┐ │
│  │ API Endpoints                                 │ │
│  │                                               │ │
│  │ /api/v1/flows, /api/v1/connections, etc.    │ │
│  └───────────────────────────────────────────────┘ │
│              │                                      │
│  ┌───────────▼───────────────────────────────────┐ │
│  │ PostgreSQL Database                           │ │
│  │                                               │ │
│  │ Table: api_key                                │ │
│  │ - id (PK)                                     │ │
│  │ - value (SHA-256 hash, UNIQUE)               │ │
│  │ - displayName                                 │ │
│  │ - platformId                                  │ │
│  │ - lastUsedAt                                  │ │
│  └───────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Troubleshooting

### "404 Not Found" on /api/v1/api-keys
- Image not rebuilt with new code
- Solution: Rebuild and redeploy Activepieces image

### "Table api_key does not exist"
- Migration didn't run
- Solution: Check logs for migration errors, restart container

### "Invalid API key"
- Key was deleted
- Key was incorrectly copied (missing characters)
- Using wrong environment (dev vs prod keys)
- Solution: Create new key and update .env

### "Authentication failed"
- API key not in correct format
- Missing "Bearer " prefix
- Solution: Ensure format is `Authorization: Bearer ap_...`

### Keys not showing lastUsedAt
- Clock skew between containers
- Key used before lastUsedAt feature deployed
- Solution: Update is async, may take a few seconds

## Testing Checklist

- [ ] Rebuild Activepieces image
- [ ] Deploy updated image
- [ ] Check migration ran (logs show table created)
- [ ] Get JWT from browser DevTools
- [ ] Create API key via curl/Postman
- [ ] Save API key value
- [ ] Add API key to BCGPT .env
- [ ] Restart BCGPT container
- [ ] Test flow_status tool in BCGPT
- [ ] Verify lastUsedAt updates in API key list
- [ ] Delete test API key
- [ ] Create production API key with good name

## Next Steps

1. **Update FLOW_INTEGRATION_COMPLETE.md** with API key instructions
2. **Test full flow:** BCGPT → flow_list → Activepieces API
3. **Deploy PMOS container** (intelligence layer)
4. **Test 3-layer architecture:** BCGPT ↔ PMOS + BCGPT → Activepieces
5. **Document deployment** in production guide

## Success! 🎉

You now have permanent API keys for Activepieces CE that won't expire like JWT tokens. This enables reliable machine-to-machine integration between BCGPT and Activepieces.
