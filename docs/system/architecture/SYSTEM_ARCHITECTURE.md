# PM OS System Architecture

**Version:** 1.0  
**Last Updated:** February 14, 2026

---

## 🎯 Overview

PM OS is built on a **3-layer architecture** where each layer has distinct responsibilities but works together as a unified system:

1. **BCGPT** (Data Layer) - Reads data from Basecamp
2. **Flow** (Execution Layer) - Executes actions across 200+ platforms
3. **PMOS** (Intelligence Layer) - Analyzes, predicts, decides, orchestrates

---

## 🏗️ Complete System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User Interfaces                               │
├─────────────────────────────────────────────────────────────────────┤
│  • Claude Desktop (MCP)    • ChatGPT (OpenAPI)                      │
│  • Web UI (React)          • API (REST)                             │
│  • Slack Bot               • Mobile App (future)                    │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    PMOS Intelligence Layer                           │
│                        (The Brain)                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ Memory & Context │  │ Prediction       │  │ Agent           │  │
│  │ • Conversations  │  │ • Health Scoring │  │ • PM Agent      │  │
│  │ • Time Machine   │  │ • Burnout Risk   │  │ • Triage Agent  │  │
│  │ • Operation Log  │  │ • Velocity       │  │ • QA Agent      │  │
│  └──────────────────┘  └──────────────────┘  └─────────────────┘  │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ Natural Language │  │ Knowledge Graph  │  │ Smart Actions   │  │
│  │ • Intent Parser  │  │ • Semantic       │  │ • Assignment    │  │
│  │ • Entity Extract │  │ • Relationships  │  │ • Optimization  │  │
│  │ • NL Builder     │  │ • Pattern Learn  │  │ • Automation    │  │
│  └──────────────────┘  └──────────────────┘  └─────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
              ↓                                          ↓
┌──────────────────────────────┐     ┌──────────────────────────────────┐
│  BCGPT (Data Layer)          │     │  Flow (Execution Layer)          │
│  Basecamp MCP Server         │     │  Activepieces                    │
├──────────────────────────────┤     ├──────────────────────────────────┤
│  • 291 MCP Tools             │     │  • 200+ Platform Pieces          │
│  • Deep Basecamp Integration │     │  • Visual Flow Builder           │
│  • Intelligent Caching       │     │  • Cross-Platform Workflows      │
│  • Multi-User OAuth          │     │  • Event-Driven Execution        │
│  • Background Miner          │     │  • Webhook Handlers              │
│  • Circuit Breaker           │     │  • Schedule Triggers             │
└──────────────────────────────┘     └──────────────────────────────────┘
              ↓                                          ↓
┌──────────────────────────────┐     ┌──────────────────────────────────┐
│  Basecamp 3 API              │     │  200+ Platform APIs              │
│  • Projects • Todos          │     │  • Jira      • GitHub            │
│  • People   • Messages       │     │  • Slack     • Email             │
│  • Documents • Schedules     │     │  • Calendar  • Sheets            │
└──────────────────────────────┘     │  • Notion    • + 190 more        │
                                     └──────────────────────────────────┘
```

---

## 🔄 Data Flow

### 1. Read Operations (PMOS → BCGPT → Basecamp)

```
User/Agent Request
    ↓
PMOS Intelligence decides what data is needed
    ↓
BCGPT MCP Tool called (e.g., list_projects)
    ↓
Intelligent caching checks (RequestContext)
    ↓ (if cache miss)
Basecamp API call
    ↓
Response cached & enriched
    ↓
PMOS receives structured data
    ↓
PMOS analyzes & responds
```

### 2. Write Operations (PMOS → BCGPT → Basecamp)

```
PMOS Intelligence decides action needed
    ↓
BCGPT MCP Tool called (e.g., create_todo)
    ↓
Operation logged for undo
    ↓
Basecamp API call
    ↓
Result verified
    ↓
Operation recorded in history
    ↓
PMOS confirms completion
```

### 3. Cross-Platform Operations (PMOS → Flow → Multiple Platforms)

```
PMOS Intelligence triggers workflow
    ↓
Flow orchestration API called
    ↓
Activepieces flow executes:
  • Step 1: Read from Basecamp (via BCGPT)
  • Step 2: Analyze data
  • Step 3: Write to Slack
  • Step 4: Update GitHub issue
  • Step 5: Log to Google Sheets
    ↓
Results returned to PMOS
    ↓
PMOS logs execution & learns
```

### 4. Autonomous Agent Cycle (PMOS orchestrates everything)

```
PM Agent (OADA Loop)
    ↓
OBSERVE: Read state via BCGPT tools
    ↓
ANALYZE: Use intelligence patterns (health scoring, predictions)
    ↓
DECIDE: Determine actions needed
    ↓
ACT: 
  - Option A: Call BCGPT tools (Basecamp changes)
  - Option B: Trigger Flow workflows (cross-platform actions)
  - Option C: Delegate to another agent
    ↓
Log all actions for audit & undo
    ↓
Return to OBSERVE (continuous loop)
```

---

## 💾 Data Storage

### BCGPT Layer (SQLite/PostgreSQL)
```sql
-- User authentication & sessions
users (id, email, basecamp_user_id, tokens, created_at)
session_keys (key, user_id, expires_at)

-- Cached data from miner
cached_projects (id, account_id, data, updated_at)
cached_people (id, account_id, data, updated_at)
cached_todos (id, project_id, data, updated_at)
```

### PMOS Layer (PostgreSQL)
```sql
-- Intelligence data
session_memory (id, user_id, conversation, context, timestamp)
snapshots (id, user_id, project_id, full_state, timestamp)
operation_log (id, user_id, operation, params, undo_cmd, timestamp)
health_scores (id, project_id, score, factors, timestamp)
predictions (id, entity_type, entity_id, prediction_type, value, confidence)
agent_actions (id, agent_type, action, result, timestamp)

-- Knowledge graph
embeddings (id, entity_type, entity_id, embedding_vector, metadata)
relationships (id, from_entity, to_entity, relationship_type, strength)
patterns (id, pattern_type, pattern_data, learned_at, usage_count)
```

### Flow Layer (Activepieces DB)
```sql
-- Managed by Activepieces
flows (id, name, definition, status)
flow_runs (id, flow_id, status, input, output, started_at, completed_at)
connections (id, piece_name, credentials)
```

---

## 🔌 Integration Points

### BCGPT ↔ PMOS

**From PMOS to BCGPT:**
- All MCP tool calls (read/write Basecamp data)
- Intelligent chaining requests (complex operations)

**From BCGPT to PMOS:**
- Webhook events (Basecamp changes trigger PMOS analysis)
- Enriched data responses (with resolved references)

### PMOS ↔ Flow

**From PMOS to Flow:**
```javascript
// Trigger a flow
await flowOrchestrator.triggerFlow('risk-mitigation', {
  projectId: '12345',
  actions: ['notify_slack', 'create_jira_ticket', 'email_stakeholders']
});

// Generate & deploy flow from NL
const flowDef = await nlFlowGenerator.generate(
  "When a todo is overdue, notify the assignee in Slack"
);
await flowOrchestrator.deployFlow(flowDef);
```

**From Flow to PMOS:**
- Flow execution results (for learning)
- Flow status updates (for monitoring)

### BCGPT ↔ Flow

**Basecamp Piece in Activepieces:**
- Uses BCGPT API patterns
- Can call MCP tools directly
- Shares authentication

**Webhook Bridge:**
```
Basecamp Webhook → BCGPT Receiver → Flow Trigger
```

---

## 🔐 Security & Authentication

### User Authentication Flow

```
1. User initiates OAuth with Basecamp
   ↓
2. BCGPT handles OAuth flow (/startbcgpt)
   ↓
3. Receives access token + refresh token
   ↓
4. Generates session_key (UUID)
   ↓
5. Stores in database:
   users.tokens = { access_token, refresh_token }
   session_keys.key = session_key
   ↓
6. Returns session_key to user
   ↓
7. User includes session_key in all MCP requests
   ↓
8. BCGPT validates & retrieves tokens
   ↓
9. Makes authenticated Basecamp API calls
```

### Multi-User Isolation

- Each user has separate session_key
- PMOS memory scoped by user_id
- Flow executions tagged with user_id
- Snapshots & operation logs per user

---

## ⚡ Performance & Scaling

### Caching Strategy

**BCGPT Layer:**
- In-memory RequestContext cache (per-request)
- Large payload cache (10-entry Map)
- Background miner pre-populates cache

**PMOS Layer:**
- Session memory (LRU cache)
- Prediction cache (TTL-based)
- Embedding cache (persistent)

**Future: Redis**
- Distributed cache across instances
- Shared state for multi-instance PMOS
- Flow coordination

### Database Scaling

**Current:**
- SQLite for dev (single-file, fast)
- PostgreSQL for production (JSONB for flexibility)

**Future:**
- Read replicas for PMOS queries
- Sharding by user_id for horizontal scale
- TimescaleDB for time-series data (metrics, events)

### API Rate Limiting

**Basecamp API:**
- Circuit breaker (5 failures → 15s cooldown)
- Exponential backoff on 429/5xx
- Retry-After header respected
- Intelligent batching for list operations

**Flow Execution:**
- Queue-based execution
- Parallel execution within reason
- Rate limits per piece/platform

---

## 🛠️ Deployment Architecture

### Development Environment

```
docker-compose.bcgpt.yml
  ↓
services:
  - bcgpt (Node.js Express)
  - postgres (database)
  - pmos (Node.js)
  - flow (Activepieces via docker-compose.activepieces.yml)
```

### Production Environment

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    │   (Nginx/HAProxy)│
                    └─────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ↓               ↓               ↓
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │  BCGPT      │ │  PMOS       │ │  Flow       │
    │  Instance 1 │ │  Instance 1 │ │  (AP)       │
    └─────────────┘ └─────────────┘ └─────────────┘
            │               │               │
            └───────────────┼───────────────┘
                            ↓
                    ┌─────────────────┐
                    │  PostgreSQL     │
                    │  (Primary +     │
                    │   Replicas)     │
                    └─────────────────┘
```

See [deployment/DEPLOYMENT_GUIDE.md](../deployment/DEPLOYMENT_GUIDE.md)

---

## 📊 Monitoring & Observability

### Health Checks

- BCGPT: `GET /health`
- PMOS: `GET /pmos/health`
- Flow: Activepieces built-in health endpoints

### Metrics

```javascript
// BCGPT metrics
{
  apiCallsMade: 1234,
  apiCallsPrevented: 567,  // via caching
  circuitBreakerState: 'closed',
  activeSessions: 42
}

// PMOS metrics
{
  agentsActive: 4,
  predictionsGenerated: 89,
  memorySize: '234 MB',
  avgResponseTime: '120ms'
}

// Flow metrics (via Activepieces)
{
  activeFlows: 15,
  executionsToday: 456,
  successRate: 0.98
}
```

### Logging

- Structured JSON logs
- Correlation IDs across layers
- Log levels: DEBUG, INFO, WARN, ERROR
- Centralized logging (future: ELK stack)

---

## 🔮 Future Architecture Evolution

### Wave 3-4: Intelligence Scale
- Multi-instance PMOS with Redis coordination
- Dedicated prediction service
- Embedding service (vector DB: Pinecone/Weaviate)

### Wave 5-6: Knowledge Scale
- Knowledge graph service (Neo4j)
- Pattern learning service
- Semantic search service

### Wave 7-8: Platform Scale
- Multi-tenant architecture
- Marketplace infrastructure
- API gateway for third-party extensions
- Separate PMOS instances per enterprise tenant

---

## 📚 Related Documentation

- **Layer Details:**
  - [BCGPT Architecture](../../bcgpt/ARCHITECTURE.md)
  - [Flow Overview](../../flow/README.md)
  - [PMOS Vision](../../pmos/vision/PROJECT_MANAGEMENT_OS.md)

- **Integration:**
  - [BCGPT ↔ PMOS Integration](BCGPT_PMOS_INTEGRATION.md)
  - [PMOS ↔ Flow Integration](../../flow/integration/PMOS_ORCHESTRATION.md)
  - [Layer Communication Patterns](LAYER_INTEGRATION.md)

- **Deployment:**
  - [Deployment Guide](../deployment/DEPLOYMENT_GUIDE.md)
  - [Production Hardening](../deployment/PRODUCTION_HARDENING.md)
  - [Scaling Guide](../deployment/SCALING_GUIDE.md)
