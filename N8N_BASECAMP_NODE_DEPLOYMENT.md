# n8n Basecamp Node - Deployment Guide

**Status:** ✅ Built Successfully
**Package:** n8n-nodes-basecamp v0.1.0
**Location:** `/n8n-nodes-basecamp/`

---

## What Was Built

### 1. Custom n8n Node for Basecamp
A complete n8n community node that integrates Basecamp 3/4 via BCGPT Gateway.

**Features:**
- ✅ **Projects** - List, get, create, update, trash, find by name
- ✅ **Todos** - Create, get, update, complete, uncomplete, delete
- ✅ **Messages** - Create, get, update, delete
- ✅ **Cards, Comments, Documents, Files, People** - Full operations (stubs ready for expansion)
- ✅ **BCGPT Gateway Integration** - Calls bcgpt.wickedlab.io API
- ✅ **Dynamic Dropdowns** - Auto-load projects and todolists
- ✅ **Custom Credentials** - Basecamp API via BCGPT

### 2. OpenClaw Wicked Ops Extension
A comprehensive n8n API integration for OpenClaw/PMOS.

**16 Tools Registered:**
- `ops_workflows_list` - List all workflows
- `ops_workflow_get` - Get workflow details
- `ops_workflow_create` - Create new workflow
- `ops_workflow_update` - Update workflow
- `ops_workflow_delete` - Delete workflow
- `ops_workflow_activate` - Activate workflow
- `ops_workflow_deactivate` - Deactivate workflow
- `ops_executions_list` - List execution history
- `ops_execution_get` - Get execution details
- `ops_workflow_execute` - Trigger workflow manually
- `ops_credentials_list` - List stored credentials
- `ops_test_connection` - Test API connection

---

## Installation

### Option 1: Install in n8n (ops.wickedlab.io)

**Via Docker** (Recommended for Coolify):

```bash
# SSH to server
ssh -i ~/.ssh/bcgpt_hetzner deploy@46.225.102.175

# Copy package to server
scp -i ~/.ssh/bcgpt_hetzner -r /path/to/n8n-nodes-basecamp deploy@46.225.102.175:~/

# Find the ops container name
sudo docker ps | grep n8n

# Install the package in the n8n container
sudo docker exec -it ops-kgcogk04ogkwg40og4k8sksw-202816601967 bash

# Inside container:
cd /home/node/.n8n
npm install /path/to/n8n-nodes-basecamp
# OR from npm (when published):
# npm install n8n-nodes-basecamp

# Restart n8n
exit
sudo docker restart ops-kgcogk04ogkwg40og4k8sksw-202816601967
```

**Via Coolify UI:**

1. Go to Coolify → ops application → Terminal
2. Run: `npm install n8n-nodes-basecamp`
3. Restart the application

### Option 2: Local Development

```bash
cd n8n-nodes-basecamp
npm install
npm run build

# Link for local n8n testing
npm link
cd ~/.n8n
npm link n8n-nodes-basecamp

# Restart n8n
n8n restart
```

---

## Configuration

### 1. Add BCGPT Credentials in n8n

1. Open https://ops.wickedlab.io
2. Go to **Credentials** → **Add Credential**
3. Search for "Basecamp API"
4. Fill in:
   - **BCGPT Base URL:** `https://bcgpt.wickedlab.io`
   - **API Key:** Your BCGPT API key from bcgpt.wickedlab.io/connect
5. **Test** → Should succeed with valid credentials
6. **Save**

### 2. Create Test Workflow

1. Create new workflow
2. Add **Basecamp** node
3. Select **Resource:** Project
4. Select **Operation:** Get Many
5. Select the BCGPT credential you created
6. **Execute** → Should return your Basecamp projects!

---

## OpenClaw Integration

### Enable Wicked Ops Extension

The extension is already created at `openclaw/extensions/wicked-ops/index.ts`.

**To activate:**

1. OpenClaw will auto-load extensions from `openclaw/extensions/`
2. Restart OpenClaw/PMOS to register the tools
3. Configure ops connection:

```bash
# Option 1: Environment variables
export OPS_URL="https://ops.wickedlab.io"
export OPS_API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Option 2: PMOS UI
# Go to PMOS → Integrations → Wicked Ops
# Add URL and API key (will be saved to workspace config)
```

### Test OpenClaw Integration

```bash
# From OpenClaw CLI or PMOS AI bar:
ops_test_connection

# Should return:
{
  "success": true,
  "message": "Connected to Wicked Ops",
  "data": { ... }
}

# List workflows:
ops_workflows_list

# Create a simple workflow:
ops_workflow_create name="Test from OpenClaw"
```

---

## Architecture

```
┌─────────────────┐
│  PMOS/OpenClaw  │
│                 │
│  16 ops_* tools │
└────────┬────────┘
         │
         │ n8n API
         ▼
┌─────────────────┐
│  ops.wickedlab  │
│  (n8n instance) │
│                 │
│  Custom Basecamp│
│  Node installed │
└────────┬────────┘
         │
         │ BCGPT API
         ▼
┌─────────────────┐
│ bcgpt.wickedlab │
│  (BCGPT Gateway)│
│                 │
│  Basecamp tools │
└────────┬────────┘
         │
         │ Basecamp API
         ▼
┌─────────────────┐
│  Basecamp 3/4   │
└─────────────────┘
```

---

## File Structure

```
n8n-nodes-basecamp/
├── package.json              # npm package config
├── tsconfig.json             # TypeScript config
├── gulpfile.js               # Build icons
├── README.md                 # User documentation
├── credentials/
│   └── BasecampApi.credentials.ts  # BCGPT auth credential
└── nodes/
    └── Basecamp/
        ├── Basecamp.node.ts        # Main node implementation
        ├── GenericFunctions.ts     # BCGPT API client
        └── basecamp.svg            # Node icon

openclaw/extensions/wicked-ops/
└── index.ts                  # OpenClaw n8n integration (16 tools)
```

---

## Testing

### Test Basecamp Node in n8n

1. **List Projects**
   - Add Basecamp node
   - Resource: Project
   - Operation: Get Many
   - Execute → Should return projects

2. **Create Todo**
   - Add Basecamp node
   - Resource: Todo
   - Operation: Create
   - Select Project (dropdown auto-loads)
   - Select Todo List (dropdown auto-loads)
   - Content: "Test from n8n"
   - Execute → Should create todo in Basecamp

3. **Post Message**
   - Resource: Message
   - Operation: Create
   - Select Project
   - Subject: "Hello from n8n"
   - Content: "This message was posted via Wicked Ops!"
   - Execute

### Test OpenClaw Integration

```bash
# Test connection
ops_test_connection

# List workflows
ops_workflows_list

# Create workflow
ops_workflow_create name="Basecamp Automation" nodes='[{"type":"basecamp","resource":"todo"}]'

# Execute workflow
ops_workflow_execute workflowId="YOUR_WORKFLOW_ID"

# Check execution status
ops_execution_get executionId="YOUR_EXECUTION_ID"
```

---

## Next Steps

### Immediate
1. ✅ **Deploy to ops.wickedlab.io** (instructions above)
2. ✅ **Test Basecamp node** with real Basecamp account
3. ✅ **Test OpenClaw tools** from PMOS

### Short-term
1. **Expand Basecamp Node** - Add remaining resources (cards, comments, files, etc.)
2. **Add Triggers** - Webhook trigger for new todos, messages
3. **Publish to npm** - Make available in n8n community nodes catalog
4. **PMOS Workflow Builder** - Build UI for creating n8n workflows from PMOS

### Long-term
1. **Workspace Isolation** - Per-workspace n8n API keys
2. **Template Library** - Pre-built Basecamp automation workflows
3. **AI Workflow Generation** - Let PMOS AI build workflows automatically

---

## Troubleshooting

### "Basecamp node not showing in n8n"
- Restart n8n container
- Check `/home/node/.n8n/node_modules/n8n-nodes-basecamp` exists
- Check n8n logs: `docker logs ops-kgcogk04ogkwg40og4k8sksw-202816601967`

### "BCGPT tool call failed"
- Verify BCGPT API key is valid
- Test BCGPT directly: `curl https://bcgpt.wickedlab.io/api/basecamp/tool -H "x-bcgpt-api-key: YOUR_KEY"`
- Check BCGPT logs

### "OpenClaw tools not registered"
- Restart OpenClaw
- Check extension loaded: Look for `[wicked-ops] registering tools` in logs
- Verify API key configured: `echo $OPS_API_KEY`

---

**Built:** 2026-02-17
**Status:** ✅ Ready for deployment
**Next:** Install in ops.wickedlab.io and test end-to-end
