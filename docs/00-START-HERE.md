# PM OS Documentation - Start Here

**Last Updated:** February 14, 2026

## 🎯 What Is This?

**PM OS** (Project Management Operating System) is the world's first AI-powered operating system for project managers. It combines:

1. **BCGPT** - Basecamp MCP Server (Data Layer)
2. **Flow** - Activepieces (Execution Layer)  
3. **PMOS** - Intelligence Layer (The Brain)

Together, these three layers create a complete autonomous system that can read from, analyze, and control 200+ platforms.

---

## 🏗️ The 3-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  PMOS (Intelligence Layer)                   │
│   The Brain: Predicts, analyzes, decides, orchestrates      │
│   Location: docs/pmos/                                       │
└─────────────────────────────────────────────────────────────┘
                         ↓              ↓
        ┌────────────────────┐   ┌──────────────────────────┐
        │  BCGPT (Data Layer)│   │  Flow (Execution Layer)  │
        │  Basecamp MCP      │   │  Activepieces            │
        │  291 tools         │   │  200+ pieces             │
        │  docs/bcgpt/       │   │  docs/flow/              │
        └────────────────────┘   └──────────────────────────┘
```

---

## 📂 Documentation Structure

### Layer 1: BCGPT (Basecamp MCP Server)
**Path:** [`docs/bcgpt/`](bcgpt/)

The data layer that provides deep Basecamp integration.

- **What it does:** 291 MCP tools for complete Basecamp control
- **When to read:** Building/extending Basecamp integrations, understanding data layer
- **Key docs:** [Architecture](bcgpt/ARCHITECTURE.md), [API Reference](bcgpt/API_REFERENCE.md)

### Layer 2: Flow (Activepieces)
**Path:** [`docs/flow/`](flow/)

The execution engine that provides 200+ platform integrations.

- **What it does:** Cross-platform workflows, automations, 200+ pieces
- **When to read:** Creating workflows, platform integrations, automation
- **Key docs:** [Overview](flow/README.md), [Pieces Catalog](flow/PIECES_CATALOG.md)

### Layer 3: PMOS (Intelligence Layer)
**Path:** [`docs/pmos/`](pmos/)

The brain that analyzes, predicts, decides, and orchestrates.

- **What it does:** AI intelligence, agent orchestration, predictive analytics
- **When to read:** Understanding vision, implementing AI features, building intelligence
- **Key docs:** [Vision](pmos/vision/PROJECT_MANAGEMENT_OS.md), [Features](pmos/features/FEATURES_CATALOG.md)

### System-Wide
**Path:** [`docs/system/`](system/)

Cross-cutting concerns that span all three layers.

- **What it covers:** Deployment, architecture, operations, security
- **When to read:** Deploying, troubleshooting, understanding overall system
- **Key docs:** [Deployment Guide](system/deployment/DEPLOYMENT_GUIDE.md)

---

## 🚀 Quick Navigation

### I want to...

**Understand the vision:**
→ Start with [`docs/pmos/vision/PROJECT_MANAGEMENT_OS.md`](pmos/vision/PROJECT_MANAGEMENT_OS.md)

**Build a new feature:**
→ Check [`docs/pmos/features/FEATURES_CATALOG.md`](pmos/features/FEATURES_CATALOG.md)  
→ Review [`docs/pmos/patterns/INTELLIGENCE_PATTERNS.md`](pmos/patterns/INTELLIGENCE_PATTERNS.md)

**Work with Basecamp data:**
→ See [`docs/bcgpt/API_REFERENCE.md`](bcgpt/API_REFERENCE.md)  
→ Review [`docs/bcgpt/ARCHITECTURE.md`](bcgpt/ARCHITECTURE.md)

**Create automation workflows:**
→ Browse [`docs/flow/PIECES_CATALOG.md`](flow/PIECES_CATALOG.md)  
→ Check [`docs/flow/workflows/WORKFLOW_PATTERNS.md`](flow/workflows/WORKFLOW_PATTERNS.md)

**Deploy the system:**
→ Follow [`docs/system/deployment/DEPLOYMENT_GUIDE.md`](system/deployment/DEPLOYMENT_GUIDE.md)

**Understand how it all fits together:**
→ Read [`docs/system/architecture/SYSTEM_ARCHITECTURE.md`](system/architecture/SYSTEM_ARCHITECTURE.md)

---

## 📊 Documentation Stats

- **Total Documentation:** 30+ documents, 40,000+ words
- **BCGPT Layer:** Complete API docs, 291 tools documented
- **Flow Layer:** 200+ pieces cataloged, workflow patterns
- **PMOS Layer:** 100+ features specified, 20+ intelligence patterns
- **Architecture Diagrams:** 25+ mermaid/ASCII diagrams

---

## 🎓 Learning Path

### New to PM OS? Follow this path:

1. **Week 1: Understand the Vision**
   - [ ] Read [PROJECT_MANAGEMENT_OS.md](pmos/vision/PROJECT_MANAGEMENT_OS.md)
   - [ ] Review [VISION_SUMMARY.md](pmos/vision/VISION_SUMMARY.md)
   - [ ] Browse [FEATURES_CATALOG.md](pmos/features/FEATURES_CATALOG.md)

2. **Week 2: Learn the Data Layer**
   - [ ] Study [BCGPT Architecture](bcgpt/ARCHITECTURE.md)
   - [ ] Review [Basecamp API coverage](bcgpt/API_REFERENCE.md)
   - [ ] Understand [intelligent chaining](bcgpt/INTELLIGENT_CHAINING.md)

3. **Week 3: Master the Execution Layer**
   - [ ] Explore [Activepieces pieces](flow/PIECES_CATALOG.md)
   - [ ] Learn [workflow patterns](flow/workflows/WORKFLOW_PATTERNS.md)
   - [ ] Build [your first automation](flow/tutorials/FIRST_WORKFLOW.md)

4. **Week 4: Build Intelligence**
   - [ ] Study [intelligence patterns](pmos/patterns/INTELLIGENCE_PATTERNS.md)
   - [ ] Implement [your first feature](pmos/features/)
   - [ ] Review [implementation roadmap](pmos/roadmap/ROADMAP_VISUAL.md)

---

## 🔗 Critical Documents

| Document | Layer | Purpose |
|----------|-------|---------|
| [PROJECT_MANAGEMENT_OS.md](pmos/vision/PROJECT_MANAGEMENT_OS.md) | PMOS | Master vision doc |
| [FEATURES_CATALOG.md](pmos/features/FEATURES_CATALOG.md) | PMOS | All 100+ features |
| [INTELLIGENCE_PATTERNS.md](pmos/patterns/INTELLIGENCE_PATTERNS.md) | PMOS | Reusable algorithms |
| [ROADMAP_VISUAL.md](pmos/roadmap/ROADMAP_VISUAL.md) | PMOS | Implementation plan |
| [ARCHITECTURE.md](bcgpt/ARCHITECTURE.md) | BCGPT | Data layer design |
| [API_REFERENCE.md](bcgpt/API_REFERENCE.md) | BCGPT | All 291 tools |
| [PIECES_CATALOG.md](flow/PIECES_CATALOG.md) | Flow | 200+ integrations |
| [SYSTEM_ARCHITECTURE.md](system/architecture/SYSTEM_ARCHITECTURE.md) | System | How it all connects |
| [DEPLOYMENT_GUIDE.md](system/deployment/DEPLOYMENT_GUIDE.md) | System | How to deploy |

---

## 🆘 Need Help?

- **Can't find something?** Check [DOCS_INDEX.md](DOCS_INDEX.md) (complete file listing)
- **Architecture questions?** See [system/architecture/](system/architecture/)
- **Implementation questions?** See layer-specific docs (bcgpt/, flow/, pmos/)
- **Vision questions?** Start with [pmos/vision/](pmos/vision/)

---

## 📝 Note on Organization

This documentation is organized by **architectural layer** (BCGPT, Flow, PMOS) because:

1. **Separation of Concerns**: Each layer has distinct responsibilities
2. **Independent Development**: Teams can work on layers independently
3. **Clear Navigation**: Immediately obvious which docs are relevant
4. **Unified System**: Cross-layer docs in `system/` show how it all fits

**But remember:** These are 3 parts of ONE system. Always consider how layers interact!

---

**Ready to dive in?** Pick a layer above and start exploring! 🚀
