# BCGPT - Basecamp MCP Server (Data Layer)

**Layer:** Data Layer  
**Technology:** Node.js, Express, MCP Protocol  
**Purpose:** Deep Basecamp integration with 291 tools

---

## 🎯 What is BCGPT?

BCGPT is a **Model Context Protocol (MCP) server** that provides comprehensive access to Basecamp 3 data. It's the **data layer** of PM OS.

### Key Capabilities

- **291 MCP Tools**: Complete Basecamp API coverage
- **Multi-User OAuth**: Secure authentication with session keys
- **Intelligent Caching**: RequestContext reduces redundant API calls
- **Background Miner**: Periodic indexing of projects/people/todos
- **Dual Database**: SQLite (dev) + PostgreSQL (production)
- **Circuit Breaker**: Automatic retry with exponential backoff
- **OpenAPI Spec**: ChatGPT compatibility (30-action limit)

---

## 📂 Documentation

### Core Documentation
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System design, data flow, architecture patterns
- **[API_REFERENCE.md](API_REFERENCE.md)** - All 291 tools with parameters/returns
- **[INTELLIGENT_CHAINING.md](INTELLIGENT_CHAINING.md)** - RequestContext, QueryParser, PatternExecutors

### Development
- **[DEVELOPMENT_WORKFLOW.md](development/DEVELOPMENT_WORKFLOW.md)** - How to develop features
- **[CODE_STRUCTURE.md](development/CODE_STRUCTURE.md)** - File organization, module guide
- **[TESTING_GUIDE.md](development/TESTING_GUIDE.md)** - How to test (when tests exist)

### API & Integration
- **[MCP_PROTOCOL.md](api/MCP_PROTOCOL.md)** - MCP protocol spec, Claude integration
- **[OPENAPI_SPEC.md](api/OPENAPI_SPEC.md)** - OpenAPI 3.1.1, ChatGPT integration
- **[TOOLS_INDEX.md](api/TOOLS_INDEX.md)** - Categorized list of all 291 tools

### Deployment
- **[DEPLOYMENT.md](deployment/DEPLOYMENT.md)** - How to deploy BCGPT
- **[CONFIGURATION.md](deployment/CONFIGURATION.md)** - Environment variables, settings
- **[MONITORING.md](deployment/MONITORING.md)** - Health checks, logging, metrics

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     BCGPT Express Server                     │
│                      (port 10000)                            │
├─────────────────────────────────────────────────────────────┤
│  Routes:                                                     │
│  • /mcp              → MCP protocol (Claude)                │
│  • /action/*         → OpenAPI endpoints (ChatGPT)          │
│  • /startbcgpt       → OAuth flow                           │
│  • /health           → Health check                         │
│  • /miner/*          → Background indexer                   │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│               MCP Tools Layer (mcp.js)                       │
│                    291 Tools                                 │
├─────────────────────────────────────────────────────────────┤
│  Tool Categories:                                            │
│  • Projects (30 tools)    • People (15 tools)               │
│  • Todos (40 tools)       • Messages (25 tools)             │
│  • Documents (20 tools)   • Card Tables (35 tools)          │
│  • Schedules (15 tools)   • Campfires (20 tools)            │
│  • Webhooks (10 tools)    • Search (8 tools)                │
│  • Templates (8 tools)    • Recordings (65 tools)           │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│            Intelligent Chaining Layer                        │
├─────────────────────────────────────────────────────────────┤
│  • RequestContext      → Caching, preloading                │
│  • QueryParser         → NLP entity extraction              │
│  • PatternExecutors    → Composite operations               │
│  • ResultEnricher      → Cross-reference resolution         │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│              Basecamp API Client (basecamp.js)              │
├─────────────────────────────────────────────────────────────┤
│  • Circuit breaker     • Retry logic                        │
│  • Rate limiting       • Pagination                         │
│  • Error handling      • Link header parsing                │
└─────────────────────────────────────────────────────────────┘
                         ↓
                  Basecamp 3 API
```

---

## 📊 Quick Stats

- **Lines of Code:** ~12,000 (main files)
- **Tools Implemented:** 291 (218 named + 73 auto-generated)
- **API Coverage:** ~95% of Basecamp 3 API
- **Intelligent Tools:** 12 use intelligent chaining
- **File Size:** mcp.js (9,169 lines), index.js (1,151 lines)

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Configure
cp .env.example .env
# Edit .env with your Basecamp credentials

# Run locally
npm start

# Server starts on http://localhost:10000
```

See [DEPLOYMENT.md](deployment/DEPLOYMENT.md) for full setup.

---

## 🔧 Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `index.js` | Express server, routes, OAuth | 1,151 |
| `mcp.js` | All 291 MCP tools | 9,169 |
| `basecamp.js` | Basecamp API client | 454 |
| `intelligent-executor.js` | RequestContext, caching | 304 |
| `query-parser.js` | NLP parsing | 300 |
| `pattern-executors.js` | Composite patterns | 250 |
| `resolvers.js` | Reference resolution | 200 |
| `db.js` | Database abstraction | 150 |
| `cache-manager.js` | Cache layer | 100 |

---

## 🛠️ Development

### Adding a New Tool

1. Add tool definition in `mcp.js`:
```javascript
{
  name: "your_tool_name",
  description: "What it does",
  inputSchema: { /* JSON schema */ },
  handler: async (params, context) => {
    // Implementation
  }
}
```

2. Test with Claude or via `/action/your_tool_name`

3. Document in [API_REFERENCE.md](API_REFERENCE.md)

See [DEVELOPMENT_WORKFLOW.md](development/DEVELOPMENT_WORKFLOW.md) for details.

---

## 🔗 Integration with Other Layers

### → PMOS (Intelligence Layer)
BCGPT provides data that PMOS intelligence analyzes:
- Health scoring uses project activity data
- Predictions use historical todo completion patterns
- Agents trigger BCGPT tools to read Basecamp state

### → Flow (Execution Layer)
BCGPT and Flow work together:
- Basecamp webhooks → trigger Activepieces flows
- BCGPT intelligent chaining → can trigger flows
- Activepieces Basecamp piece uses BCGPT patterns

See [system/architecture/LAYER_INTEGRATION.md](../system/architecture/LAYER_INTEGRATION.md)

---

## 📈 Roadmap

### Current State
- ✅ 291 tools implemented
- ✅ Multi-user OAuth working
- ✅ Intelligent chaining (12 tools)
- ✅ Background miner running
- ✅ Circuit breaker active

### Wave 1-2 (Foundation)
- 📝 Expand intelligent chaining to more tools
- 📝 Add comprehensive test suite
- 📝 Refactor 9169-line mcp.js monolith
- 📝 Persistent cache (Redis)

### Wave 3-4 (Intelligence Integration)
- 📝 PMOS ↔ BCGPT integration
- 📝 Real-time webhook processing
- 📝 Bidirectional sync with Flow

See [../pmos/roadmap/ROADMAP_VISUAL.md](../pmos/roadmap/ROADMAP_VISUAL.md)

---

## 🆘 Troubleshooting

**Tools not loading?**
→ Check [deployment/TROUBLESHOOTING.md](deployment/TROUBLESHOOTING.md)

**OAuth failing?**
→ Verify Basecamp credentials in `.env`

**Rate limiting errors?**
→ Circuit breaker is working, check [MONITORING.md](deployment/MONITORING.md)

---

## 📚 Learn More

- **Basecamp 3 API:** https://github.com/basecamp/bc3-api
- **MCP Protocol:** https://modelcontextprotocol.io
- **PM OS Vision:** [../pmos/vision/PROJECT_MANAGEMENT_OS.md](../pmos/vision/PROJECT_MANAGEMENT_OS.md)
