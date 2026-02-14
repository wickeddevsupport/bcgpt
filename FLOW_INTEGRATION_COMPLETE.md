# Flow Tools Integration - Complete ✅

## Overview
Successfully integrated Flow automation tools (Activepieces) into BCGPT container for native API access. Flow tools are now handled locally within BCGPT instead of requiring a separate Flow server.

## Architecture Decision
**Option A (Implemented):** Merge flow-server into BCGPT container
- ✅ BCGPT calls Activepieces API directly via `activepieces-client.js`
- ✅ Reduces network hops (no inter-container communication)
- ✅ Simplifies deployment (no separate Flow container needed)
- ✅ Native integration with existing Activepieces deployment at flow.wickedlab.io

## Files Created/Modified

### New Files
1. **flow-tools.js** (335 lines)
   - Exports 14 flow tool definitions
   - Handles all `flow_*` tool execution
   - Uses ActivepiecesClient for API calls

2. **activepieces-client.js** (112 lines)
   - API client for Activepieces
   - Methods: listFlows, getFlow, createFlow, updateFlow, deleteFlow, triggerFlow, listFlowRuns, listProjects, listPieces, listConnections, createConnection

3. **flow-config.js** (28 lines)
   - Configuration for Activepieces integration
   - Environment variables: ACTIVEPIECES_URL, ACTIVEPIECES_API_KEY

### Modified Files
1. **mcp.js**
   - Added import: `import { handleFlowTool } from "./flow-tools.js"`
   - Added flow_* tool handler (lines ~4417-4432)
   - Handles flow tools locally before other tool checks

2. **mcp/tools.js**
   - Added import: `import { getFlowTools } from "../flow-tools.js"`
   - Added flow tools to tools array (automatically appended)

3. **gateway-router.js**
   - Updated `shouldRoute()` to only route `pmos_*` tools
   - Removed flow_* routing (handled locally now)

4. **.env**
   - Added: `ACTIVEPIECES_URL=https://flow.wickedlab.io`
   - Added: `ACTIVEPIECES_API_KEY=` (needs to be filled)
   - Added: `PMOS_URL=http://localhost:10001`

## Flow Tools Available (14)

### Flow Management
- `flow_list` - List all automation flows
- `flow_get` - Get details of a specific flow
- `flow_create` - Create a new automation flow
- `flow_update` - Update an existing flow
- `flow_delete` - Delete a flow

### Flow Execution
- `flow_trigger` - Manually trigger a flow with optional payload
- `flow_runs_list` - Get recent runs/executions of a flow
- `flow_run_get` - Get details of a specific flow run

### Projects
- `flow_projects_list` - List all Activepieces projects
- `flow_project_create` - Create a new Activepieces project

### Pieces (Integrations)
- `flow_pieces_list` - List all available integration pieces (200+ services)

### Connections (API Keys)
- `flow_connections_list` - List configured connections/API keys
- `flow_connection_create` - Create a new connection/API key

### Utility
- `flow_status` - Get Flow integration status and statistics

## Deployment Status

### ✅ Ready to Deploy
- BCGPT container (with integrated flow tools)
  - File: `docker-compose.bcgpt.yml`
  - URL: bcgpt.wickedlab.io
  - Port: 10000
  - **Action Required:** Set `ACTIVEPIECES_API_KEY` in .env

### ✅ Already Deployed
- Activepieces
  - File: `docker-compose.activepieces.yml`
  - URL: flow.wickedlab.io
  - Status: Running (ghcr.io/wickeddevsupport/activepieces-bcgpt:latest)

### ⏭️ Next: Deploy PMOS
- PMOS container (intelligence layer)
  - File: `docker-compose.pmos.yml`
  - URL: pmos.wickedlab.io (planned)
  - Port: 10001
  - **Action Required:** Deploy new container

## Testing Checklist

### Local Testing (Before Deployment)
```powershell
# 1. Set Activepieces API key in .env
# ACTIVEPIECES_API_KEY=<your-key-here>

# 2. Start BCGPT locally
node index.js

# 3. Test flow_status
curl -X POST http://localhost:10000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "flow_status",
      "arguments": {}
    }
  }'

# 4. Test flow_list
curl -X POST http://localhost:10000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "flow_list",
      "arguments": {}
    }
  }'
```

### Production Testing (After Deployment)
```powershell
# 1. Test BCGPT health
curl https://bcgpt.wickedlab.io/health

# 2. Test flow tools via BCGPT
# Use ChatGPT with bcgpt.wickedlab.io/openapi.json
# Try: "List all my Activepieces flows"
# Try: "Show me available integration pieces"

# 3. Test gateway routing to PMOS (after PMOS deployment)
# Try: "Check project health scores"
```

## Environment Variables Summary

### BCGPT (.env)
```env
# Activepieces Integration
ACTIVEPIECES_URL=https://flow.wickedlab.io
ACTIVEPIECES_API_KEY=<YOUR_PERMANENT_API_KEY_HERE>

# PMOS Integration
PMOS_URL=http://localhost:10001
```

### How to Get Activepieces API Key

✨ **NEW: Permanent API Keys Now Available!**

We've built a custom API key feature for Activepieces CE (see `activepieces/API_KEY_IMPLEMENTATION.md` for details).

**Quick Start:**

1. **Rebuild Activepieces image:**
   ```bash
   cd activepieces
   docker build -t ghcr.io/wickeddevsupport/activepieces-bcgpt:latest -f Dockerfile .
   ```

2. **Deploy updated image:**
   ```bash
   docker-compose -f ../docker-compose.activepieces.yml down
   docker-compose -f ../docker-compose.activepieces.yml up -d
   ```

3. **Get JWT token from browser:**
   - Login to flow.wickedlab.io
   - Open DevTools (F12) → Console
   - Run: `localStorage.getItem('token')`
   - Copy the JWT value

4. **Create permanent API key:**
   ```bash
   JWT_TOKEN="<paste-token-here>"
   
   curl -X POST https://flow.wickedlab.io/api/v1/api-keys \
     -H "Authorization: Bearer $JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"displayName": "BCGPT Integration"}'
   ```

5. **Save the returned `value` field** - this is your permanent API key (format: `ap_...`)

6. **Add to BCGPT .env:**
   ```env
   ACTIVEPIECES_API_KEY=ap_A8k2Jd9fP3mL6nQ4tR7wE1xY5bC0vH2sZ9gF8jK4
   ```

**Benefits:**
- ✅ Never expires (unlike JWT tokens)
- ✅ Use same key in multiple services
- ✅ Revoke anytime from UI
- ✅ Track usage via `lastUsedAt` timestamp
- ✅ Secure SHA-256 hashed storage

See full documentation: [activepieces/API_KEY_IMPLEMENTATION.md](activepieces/API_KEY_IMPLEMENTATION.md)

## Tool Routing Summary

| Tool Prefix | Handled By | Location |
|-------------|------------|----------|
| `bc_*` | BCGPT | Local (mcp.js) |
| `api_*` | BCGPT | Local (mcp.js via endpoint-tools.js) |
| `flow_*` | BCGPT | Local (flow-tools.js) → Activepieces API |
| `pmos_*` | PMOS | Gateway routed to pmos.wickedlab.io |

## Total Tools Available
- **BCGPT Base Tools:** 291 (Basecamp operations)
- **PMOS Tools:** 17 (intelligence layer - not yet deployed)
- **Flow Tools:** 14 (automation layer - ✅ integrated)
- **Total:** 322 tools (308 currently active)

## Next Steps

1. **Get Activepieces API Key**
   - Login to flow.wickedlab.io
   - Create API key in Settings
   - Add to BCGPT .env file

2. **Deploy Updated BCGPT**
   ```bash
   cd /path/to/bcgpt
   docker-compose -f docker-compose.bcgpt.yml up -d --build
   ```

3. **Test Flow Tools**
   - Use test commands above
   - Verify flow_status returns success
   - Try listing flows via ChatGPT

4. **Deploy PMOS Container**
   - Review docker-compose.pmos.yml
   - Set PMOS environment variables
   - Deploy: `docker-compose -f docker-compose.pmos.yml up -d --build`

5. **Update OpenAPI Spec** (if needed)
   - Verify flow tools appear in /openapi.json
   - Test via ChatGPT Actions

## Troubleshooting

### Flow tools return "Not connected" error
- Check ACTIVEPIECES_API_KEY is set in .env
- Verify flow.wickedlab.io is accessible
- Check ACTIVEPIECES_URL points to https://flow.wickedlab.io

### Flow tools return 401 Unauthorized
- API key is invalid or expired
- Generate new API key in Activepieces settings
- Update .env and restart BCGPT

### Flow tools return 404 Not Found
- Check ACTIVEPIECES_URL has no trailing slash
- Verify Activepieces API version (v1) in activepieces-client.js
- Test direct API call: `curl https://flow.wickedlab.io/api/v1/flows -H "Authorization: Bearer YOUR_KEY"`

## Files to Keep/Remove

### Keep (Integrated into BCGPT)
- ✅ flow-tools.js
- ✅ activepieces-client.js
- ✅ flow-config.js

### Can Remove (Optional Cleanup)
- ⚠️ flow-server/ directory (reference only, not used by BCGPT)
  - Kept for documentation purposes
  - Can delete to save space

## Success Metrics
- ✅ No syntax errors in modified files
- ✅ Flow tools added to BCGPT tool list
- ✅ Gateway routing updated (pmos_* only)
- ✅ Environment variables documented
- ⏭️ Activepieces API key needed
- ⏭️ Deployment and testing pending

## Integration Complete! 🎉
Flow automation tools are now natively integrated into BCGPT. Ready to deploy after setting ACTIVEPIECES_API_KEY.
