# PM OS Documentation Index

**Last Updated:** February 14, 2026  
**Organization:** 3-Layer Architecture (BCGPT, Flow, PMOS)

---

## 🎯 Start Here

**New to PM OS?** → **[00-START-HERE.md](00-START-HERE.md)** ← Read this first!

This index organizes all documentation by architectural layer for easy navigation.

---

## 🏗️ Architecture Overview

```
┌──────────────────────────┐
│  PMOS (Intelligence)     │  docs/pmos/
│  The Brain               │
└──────────────────────────┘
         ↓         ↓
┌──────────────┐  ┌──────────────────┐
│ BCGPT (Data) │  │ Flow (Execution) │
│ docs/bcgpt/  │  │ docs/flow/       │
└──────────────┘  └──────────────────┘

System-wide: docs/system/
```

---

## 📂 Layer 1: BCGPT (Basecamp MCP Server - Data Layer)

**Location:** [`docs/bcgpt/`](bcgpt/)

### Core Documentation
- **[README.md](bcgpt/README.md)** - BCGPT overview & quick start
- **[ARCHITECTURE.md](bcgpt/ARCHITECTURE.md)** - Data layer architecture

### API & Tools (planned)
- **[api/MCP_PROTOCOL.md](bcgpt/api/)** - MCP protocol specification
- **[api/OPENAPI_SPEC.md](bcgpt/api/)** - OpenAPI for ChatGPT
- **[api/TOOLS_INDEX.md](bcgpt/api/)** - All 291 tools catalog
- **[api/API_REFERENCE.md](bcgpt/api/)** - Complete API reference

### Development (planned)
- **[development/DEVELOPMENT_WORKFLOW.md](bcgpt/development/)** - How to develop
- **[development/CODE_STRUCTURE.md](bcgpt/development/)** - File organization
- **[development/TESTING_GUIDE.md](bcgpt/development/)** - Testing guide
- **[development/INTELLIGENT_CHAINING.md](bcgpt/development/)** - Smart patterns

### Deployment (planned)
- **[deployment/DEPLOYMENT.md](bcgpt/deployment/)** - How to deploy
- **[deployment/CONFIGURATION.md](bcgpt/deployment/)** - Environment setup
- **[deployment/MONITORING.md](bcgpt/deployment/)** - Health & metrics
- **[deployment/TROUBLESHOOTING.md](bcgpt/deployment/)** - Common issues

---

## 📂 Layer 2: Flow (Activepieces - Execution Layer)

**Location:** [`docs/flow/`](flow/)

### Core Documentation
- **[README.md](flow/README.md)** - Flow overview & why it matters
- **[OVERVIEW.md](flow/OVERVIEW.md)** - Detailed Flow explanation
- **[PIECES_CATALOG.md](flow/PIECES_CATALOG.md)** - All 200+ pieces
- **[QUICK_START.md](flow/QUICK_START.md)** - Build your first flow

### Workflows (planned)
- **[workflows/WORKFLOW_PATTERNS.md](flow/workflows/)** - Reusable patterns
- **[workflows/PM_OS_FLOWS.md](flow/workflows/)** - PM OS automations
- **[workflows/EXAMPLES.md](flow/workflows/)** - Complete examples

### Integration (planned)
- **[integration/BCGPT_INTEGRATION.md](flow/integration/)** - BCGPT ↔ Flow
- **[integration/PMOS_ORCHESTRATION.md](flow/integration/)** - PMOS → Flow
- **[integration/WEBHOOKS.md](flow/integration/)** - Webhook bridge

### Pieces (planned)
- **[pieces/BASECAMP_PIECE.md](flow/pieces/)** - Custom Basecamp piece
- **[pieces/BUILDING_CUSTOM.md](flow/pieces/)** - Build custom pieces
- **[pieces/POPULAR_PIECES.md](flow/pieces/)** - Most-used pieces

### Deployment (planned)
- **[deployment/DEPLOYMENT.md](flow/deployment/)** - Deploy Activepieces
- **[deployment/CONFIGURATION.md](flow/deployment/)** - Configuration
- **[deployment/MONITORING.md](flow/deployment/)** - Monitor flows

---

## 📂 Layer 3: PMOS (Intelligence Layer - The Brain)

**Location:** [`docs/pmos/`](pmos/)

### Core Documentation
- **[README.md](pmos/README.md)** - PMOS overview & capabilities

### Vision
- **[vision/PROJECT_MANAGEMENT_OS.md](pmos/vision/PROJECT_MANAGEMENT_OS.md)** ⭐ **Master vision (10,500 words)**
- **[vision/VISION_SUMMARY.md](pmos/vision/VISION_SUMMARY.md)** - Quick overview
- **[vision/README.md](pmos/vision/README.md)** - Vision docs navigation
- **[vision/SESSION_LOG_2026-02-14.md](pmos/vision/SESSION_LOG_2026-02-14.md)** - Session notes
- **[vision/FEATURES_CATALOG.md](pmos/vision/FEATURES_CATALOG.md)** ⭐ **All 100+ features (7,000 words)**
- **[vision/INTELLIGENCE_PATTERNS.md](pmos/vision/INTELLIGENCE_PATTERNS.md)** ⭐ **20+ algorithms (6,500 words)**
- **[vision/ROADMAP_VISUAL.md](pmos/vision/ROADMAP_VISUAL.md)** ⭐ **8-wave plan (3,500 words)**

### Implementation (planned)
- **[implementation/DATABASE_SCHEMA.md](pmos/implementation/)** - All schemas
- **[implementation/MCP_TOOLS.md](pmos/implementation/)** - New MCP tools
- **[implementation/API_DESIGN.md](pmos/implementation/)** - API contracts

---

## 📂 System-Wide Documentation

**Location:** [`docs/system/`](system/)

### Architecture
- **[architecture/SYSTEM_ARCHITECTURE.md](system/architecture/SYSTEM_ARCHITECTURE.md)** ⭐ **Complete system design**
- **[architecture/LAYER_INTEGRATION.md](system/architecture/)** - How layers connect (planned)
- **[architecture/DATA_FLOW.md](system/architecture/)** - Data flow patterns (planned)

### Deployment
- **[deployment/DEPLOYMENT_GUIDE.md](system/deployment/DEPLOYMENT_GUIDE.md)** - Full deployment

---

## 📂 Legacy/Archive Documentation

### Classic Docs
- [START_HERE.md](START_HERE.md) - Original Basecamp MCP guide

### Apps Platform
- [APPS_BASELINE_LOCK.md](APPS_BASELINE_LOCK.md)
- [APPS_MASTER_TODO.md](APPS_MASTER_TODO.md)
- [APPS_MILESTONE2_BACKLOG.md](APPS_MILESTONE2_BACKLOG.md)
- [APPS_PLATFORM_PRD.md](APPS_PLATFORM_PRD.md)
- [PRD_APPS_PHASE2.md](PRD_APPS_PHASE2.md)

### Audits & Testing
- [audits/](audits/) - System audits
- [E2E_TEST_SUITE.md](E2E_TEST_SUITE.md)
- [EDGE_CASES_FRAMEWORK.md](EDGE_CASES_FRAMEWORK.md)

### Reference
- [reference/](reference/) - API references
- [coverage/](coverage/) - Coverage reports
- [summaries/](summaries/) - Session summaries

---

## 🌟 Most Important Documents

| Doc | Layer | Why Read |
|-----|-------|----------|
| [00-START-HERE.md](00-START-HERE.md) | Entry | Navigation guide |
| [PROJECT_MANAGEMENT_OS.md](pmos/vision/PROJECT_MANAGEMENT_OS.md) | PMOS | Master vision |
| [VISION_SUMMARY.md](pmos/vision/VISION_SUMMARY.md) | PMOS | Quick overview |
| [FEATURES_CATALOG.md](pmos/vision/FEATURES_CATALOG.md) | PMOS | All 100+ features |
| [INTELLIGENCE_PATTERNS.md](pmos/vision/INTELLIGENCE_PATTERNS.md) | PMOS | Algorithms |
| [ROADMAP_VISUAL.md](pmos/vision/ROADMAP_VISUAL.md) | PMOS | Implementation plan |
| [SYSTEM_ARCHITECTURE.md](system/architecture/SYSTEM_ARCHITECTURE.md) | System | Complete architecture |
| [BCGPT README](bcgpt/README.md) | BCGPT | Data layer |
| [Flow README](flow/README.md) | Flow | Execution layer |

---

## 🔍 Quick Navigation

### By Task

**"Understand the vision"** → [PROJECT_MANAGEMENT_OS.md](pmos/vision/PROJECT_MANAGEMENT_OS.md)  
**"Build a feature"** → [FEATURES_CATALOG.md](pmos/vision/FEATURES_CATALOG.md)  
**"Work with Basecamp"** → [bcgpt/README.md](bcgpt/README.md)  
**"Create automations"** → [flow/README.md](flow/README.md)  
**"Deploy system"** → [system/deployment/DEPLOYMENT_GUIDE.md](system/deployment/DEPLOYMENT_GUIDE.md)  
**"How layers connect"** → [system/architecture/SYSTEM_ARCHITECTURE.md](system/architecture/SYSTEM_ARCHITECTURE.md)

### By Layer

📂 **BCGPT** → [docs/bcgpt/](bcgpt/)  
📂 **Flow** → [docs/flow/](flow/)  
📂 **PMOS** → [docs/pmos/](pmos/)  
📂 **System** → [docs/system/](system/)

---

**Questions?** Check [00-START-HERE.md](00-START-HERE.md) for help!
