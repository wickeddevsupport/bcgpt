# Cross-Layer Operation & Interface State

**Current Date:** February 14, 2026  
**Topic:** How ChatGPT, Claude, and APIs can access all 3 layers

---

## 🎯 Your Question

> "Can ChatGPT use PMOS features? What's the state of cross-operation between the three layers?"

**Short Answer:** ChatGPT can currently access **BCGPT** (data layer) via OpenAPI. PMOS (intelligence) isn't built yet, but when it is, **all interfaces will access all layers** through a unified architecture.

---

## 📊 Current State (What's Built)

### ✅ BCGPT (Data Layer) - RUNNING
```
Express Server: localhost:10000
Status: ✅ Deployed & Running
Access Methods:
  • Claude Desktop: /mcp endpoint (MCP protocol)
  • ChatGPT: /action/* endpoints (OpenAPI 3.1.1)
  • Direct API: POST /mcp with auth
```

**What works NOW:**
- ✅ Claude can call all 291 Basecamp tools via MCP
- ✅ ChatGPT can call limited tools via OpenAPI (30-action limit)
- ✅ Multi-user OAuth working
- ✅ Background miner running

### ✅ Flow (Execution Layer) - RUNNING
```
Activepieces: flow.wickedlab.io
Status: ✅ Deployed & Running
Access Methods:
  • Visual UI: https://flow.wickedlab.io
  • API: Activepieces REST API
  • Proxy: BCGPT can proxy (ACTIVEPIECES_PROXY_ENABLED)
```

**What works NOW:**
- ✅ 200+ pieces available
- ✅ Visual flow builder working
- ✅ Webhooks, schedules, triggers active
- ⚠️ NOT YET integrated with BCGPT/PMOS intelligence

### ❌ PMOS (Intelligence Layer) - NOT BUILT
```
Status: ❌ Vision only (not implemented)
Current State:
  • Vision documents complete (25,000+ words)
  • 100+ features specified
  • 20+ algorithms documented
  • Implementation: NOT STARTED
```

**What does NOT work yet:**
- ❌ No PMOS server
- ❌ No intelligence features (health scoring, predictions, agents)
- ❌ No memory/context system
- ❌ No agent orchestration

---

## 🔌 Current Interface Architecture

### How ChatGPT Accesses BCGPT Today

```
ChatGPT User
    ↓
ChatGPT Plugin System
    ↓
OpenAPI Spec (openapi.json)
    ↓
POST https://your-server:10000/action/{tool_name}
    ↓
BCGPT index.js (app.post("/action/:op"))
    ↓
Calls handleMCP() with tool name
    ↓
mcp.js executes tool
    ↓
Returns JSON result
    ↓
ChatGPT displays to user
```

**Current Limitations:**
- ⚠️ OpenAPI has 30-action limit (ChatGPT constraint)
- ⚠️ Only exposes subset of 291 tools
- ⚠️ No PMOS features (they don't exist yet)

### How Claude Accesses BCGPT Today

```
Claude Desktop
    ↓
MCP Protocol
    ↓
POST https://your-server:10000/mcp
    ↓
BCGPT index.js (app.post("/mcp"))
    ↓
Calls handleMCP()
    ↓
mcp.js executes tool
    ↓
Returns MCP-formatted result
    ↓
Claude uses result
```

**Advantages:**
- ✅ All 291 tools available
- ✅ No action limit
- ✅ Native MCP protocol

---

## 🚀 Vision: Unified Cross-Layer Access

### When PMOS is Built

```
┌─────────────────────────────────────────────────────────┐
│              User Interfaces (All Access Everything)     │
├─────────────────────────────────────────────────────────┤
│  • Claude Desktop (MCP)                                  │
│  • ChatGPT (OpenAPI)                                     │
│  • Web UI (React)                                        │
│  • Mobile App (future)                                   │
│  • Direct API (REST)                                     │
│  • Slack Bot (future)                                    │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│            Unified Gateway / Router                      │
│         (Routes requests to appropriate layer)           │
├─────────────────────────────────────────────────────────┤
│  Tool Categories:                                        │
│  • bcgpt_* → BCGPT layer                                │
│  • pmos_* → PMOS layer                                  │
│  • flow_* → Flow layer                                  │
│  • system_* → Cross-layer operations                    │
└─────────────────────────────────────────────────────────┘
         ↓              ↓              ↓
    ┌────────┐    ┌────────┐    ┌────────┐
    │ BCGPT  │    │ PMOS   │    │ Flow   │
    │ (Data) │    │ (Brain)│    │ (Exec) │
    └────────┘    └────────┘    └────────┘
```

### Example: ChatGPT Using All Three Layers

**User asks ChatGPT:** "What's the health of my projects and notify my team"

**Behind the scenes:**
```javascript
// 1. ChatGPT calls PMOS health scoring
POST /action/pmos_get_project_health
{
  "project_id": "12345"
}
↓ PMOS calculates health using BCGPT data
{
  "health_score": 65,
  "risks": ["overdue_todos", "low_velocity"],
  "recommendation": "Redistribute workload"
}

// 2. ChatGPT calls Flow to notify team
POST /action/flow_trigger_workflow
{
  "workflow": "team-notification",
  "data": {
    "project": "12345",
    "health_score": 65,
    "message": "Project health needs attention"
  }
}
↓ Flow executes across Slack + Email
{
  "slack_posted": true,
  "email_sent": true
}
```

**Result:** ChatGPT orchestrated PMOS intelligence + Flow execution!

---

## 🏗️ Implementation Plan for Full Cross-Operation

### Wave 1-2: Build PMOS Server (Weeks 1-5)

**Create new PMOS server:**
```
pmos-server/
├── index.js              (Express server on port 10001)
├── pmos-tools.js          (PMOS MCP tools)
├── intelligence/
│   ├── health-scoring.js
│   ├── predictions.js
│   ├── memory.js
│   └── agents.js
└── package.json
```

**Add PMOS tools to MCP:**
```javascript
// pmos-tools.js - new file
export const pmosTools = [
  {
    name: "pmos_get_project_health",
    description: "Get AI health score for a project",
    inputSchema: { projectId: "string" },
    handler: async (params) => {
      // Call BCGPT for data
      const projectData = await bcgptClient.call("get_project", params);
      // Calculate health
      const health = await healthScoring.calculate(projectData);
      return health;
    }
  },
  {
    name: "pmos_predict_completion",
    description: "Predict project completion date",
    // ... implementation
  },
  // ... 50+ more PMOS tools
];
```

### Wave 2: Unified Gateway (Week 3-4)

**Option A: Extend BCGPT as Gateway**
```javascript
// index.js - add routing logic
app.post("/mcp", async (req, res) => {
  const { method, params } = req.body;
  
  // Route based on tool name prefix
  if (method.startsWith("bcgpt_")) {
    return handleBCGPT(method, params);
  } else if (method.startsWith("pmos_")) {
    return handlePMOS(method, params);
  } else if (method.startsWith("flow_")) {
    return handleFlow(method, params);
  }
  
  // Legacy: no prefix = BCGPT
  return handleBCGPT(method, params);
});
```

**Option B: New Gateway Service**
```javascript
// gateway/index.js
app.post("/mcp", async (req, res) => {
  const layer = determineLayer(req.body.method);
  
  switch(layer) {
    case "bcgpt":
      return proxy(BCGPT_URL, req, res);
    case "pmos":
      return proxy(PMOS_URL, req, res);
    case "flow":
      return proxy(FLOW_URL, req, res);
  }
});
```

### Wave 3: Update OpenAPI Spec (Week 5)

**Combine all tools in openapi.json:**
```json
{
  "openapi": "3.1.1",
  "info": {
    "title": "PM OS - Complete API",
    "description": "All 3 layers: BCGPT (data), PMOS (intelligence), Flow (execution)"
  },
  "paths": {
    "/action/bcgpt_get_project": { ... },
    "/action/pmos_get_health": { ... },
    "/action/flow_trigger_workflow": { ... }
  }
}
```

**Workaround for 30-action limit:**
- Expose top 30 most-used tools
- Add `/action/call_any_tool` meta-endpoint that takes tool name as parameter

```json
{
  "/action/call_any_tool": {
    "post": {
      "parameters": {
        "tool_name": "string",
        "tool_params": "object"
      }
    }
  }
}
```

---

## 🎯 Practical Examples

### Example 1: ChatGPT Uses PMOS Health Scoring

**Today (doesn't work - PMOS not built):**
```
ChatGPT: "What's the health of Project X?"
❌ Error: pmos_get_health tool doesn't exist
```

**After Wave 1-2 (PMOS built):**
```
ChatGPT: "What's the health of Project X?"
✅ Routes to PMOS → "Health score: 72/100
   - Velocity: Good
   - Overdue items: 2 (low risk)
   - Team capacity: 85%
   - Recommendation: On track, monitor capacity"
```

### Example 2: Claude Triggers Flow Automation

**Today (manual, not integrated):**
```
Claude: "Create a flow to notify team when todos are overdue"
❌ User must manually:
   1. Go to flow.wickedlab.io
   2. Create flow
   3. Configure trigger
```

**After Wave 2-3 (integrated):**
```
Claude: "Create a flow to notify team when todos are overdue"
✅ Claude calls flow_create_from_intent →
   PMOS generates flow definition →
   Flow deploys it →
   Claude: "✅ Flow created and active. It will check every hour."
```

### Example 3: Any Interface Uses All Layers

**After full integration:**

**Via ChatGPT:**
```
User: "Analyze my projects and send report to Slack"
ChatGPT:
  1. Calls bcgpt_list_projects (BCGPT)
  2. Calls pmos_analyze_all_projects (PMOS)
  3. Calls flow_trigger_slack_report (Flow)
✅ "Analysis complete. Slack report sent to #pm-updates"
```

**Via Claude:**
```
User: "Analyze my projects and send report to Slack"
Claude: [Same tools, same result]
✅ "Analysis complete. Slack report sent to #pm-updates"
```

**Via Web UI:**
```
User clicks: "Analyze & Report" button
Web UI:
  1. POST /api/analyze (calls PMOS)
  2. POST /api/report (calls Flow)
✅ [Shows real-time progress, then success]
```

**Via API:**
```bash
curl -X POST https://api.pmos.io/v1/analyze-and-report \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action": "analyze_and_report"}'
✅ {"status": "success", "report_url": "..."}
```

---

## 📋 Current Action Items

### To Enable ChatGPT → PMOS Access

**Prerequisites:**
1. ✅ ChatGPT can already call BCGPT (working)
2. ❌ PMOS server needs to be built (not started)
3. ❌ PMOS tools need to be defined in MCP format (not started)

**Implementation Steps:**

**Step 1: Build PMOS Server (Week 1-2)**
```bash
# Create pmos server
mkdir pmos-server
cd pmos-server
npm init -y
npm install express cors dotenv

# Create basic server
# - Express on port 10001
# - MCP tools endpoint
# - Health check endpoint
```

**Step 2: Implement Core PMOS Tools (Week 2-3)**
```javascript
// Start with 5-10 essential tools:
// 1. pmos_get_project_health
// 2. pmos_predict_completion
// 3. pmos_get_memory
// 4. pmos_set_memory
// 5. pmos_smart_assign
```

**Step 3: Connect BCGPT → PMOS (Week 3)**
```javascript
// In bcgpt/index.js
const PMOS_URL = process.env.PMOS_URL || "http://localhost:10001";

async function callPMOS(tool, params) {
  const response = await fetch(`${PMOS_URL}/mcp`, {
    method: "POST",
    body: JSON.stringify({ method: tool, params })
  });
  return response.json();
}
```

**Step 4: Expose PMOS via OpenAPI (Week 4)**
```javascript
// Add PMOS tools to openapi.json
// Regenerate with top 30 tools including PMOS ones
```

**Step 5: Test with ChatGPT (Week 4)**
```
1. Reload openapi.json in ChatGPT
2. Test: "Get health score for Project X"
3. Verify PMOS is called
4. Verify result returned to ChatGPT
```

---

## 🔮 Future: Voice, Mobile, Slack

**Once unified gateway exists, adding interfaces is trivial:**

```
Voice (Alexa/Google):
  ↓ (uses OpenAPI)
  Gateway → All 3 layers

Mobile App:
  ↓ (uses REST API)
  Gateway → All 3 layers

Slack Bot:
  ↓ (uses MCP or REST)
  Gateway → All 3 layers

Email Integration:
  ↓ (uses webhooks)
  Gateway → All 3 layers
```

**Because layers are separated, interfaces are decoupled!**

---

## 💡 Key Insights

1. **ChatGPT CAN access BCGPT today** ✅
   - Via OpenAPI at `/action/*` endpoints
   - Limited to 30 actions (ChatGPT constraint)

2. **ChatGPT CANNOT access PMOS yet** ❌
   - PMOS doesn't exist (just vision docs)
   - Need to build PMOS server first

3. **Flow is isolated** ⚠️
   - Running but not integrated with BCGPT/PMOS
   - Need orchestration layer

4. **All interfaces will access all layers** 🎯
   - Once PMOS is built (Wave 1-2)
   - Once gateway routing is added (Wave 2-3)
   - Once OpenAPI is updated (Wave 3)

5. **Architecture supports it** ✅
   - Clean layer separation
   - MCP protocol is universal
   - Just need to build PMOS + routing

---

## 🚦 Status Summary

| Feature | Claude | ChatGPT | Status |
|---------|--------|---------|--------|
| Access BCGPT (Data) | ✅ Yes | ✅ Yes | Working |
| Access PMOS (Intelligence) | ❌ No | ❌ No | Not built |
| Access Flow (Execution) | ⚠️ Manual | ⚠️ Manual | Not integrated |
| Unified access to all 3 | ❌ No | ❌ No | Planned Wave 2-3 |

---

## 🎯 Bottom Line

**Today:**
- ChatGPT → BCGPT ✅
- Claude → BCGPT ✅
- Anyone → Flow (manual) ⚠️
- Anyone → PMOS ❌ (doesn't exist)

**After Wave 1-3 (Weeks 1-5):**
- **Any interface** → **All 3 layers** ✅
- ChatGPT, Claude, API, Web UI all equal
- Full cross-layer operations
- Unified PM OS experience

**Next immediate step:** Build PMOS server with first 10 intelligence tools, then connect it to BCGPT gateway.
