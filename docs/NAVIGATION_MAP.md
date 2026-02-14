# Documentation Organization Map

**Quick Reference:** Where everything is now

---

## 📍 Root Level (Navigation Only)

```
docs/
├── 00-START-HERE.md          👈 START HERE!
├── DOCS_INDEX.md              Complete index
├── README.md                  Overview
└── REORGANIZATION_SUMMARY.md  What changed
```

---

## 🔷 Layer 1: BCGPT (Data)

**Path:** `docs/bcgpt/`

```
bcgpt/
├── README.md                  Layer guide
├── ARCHITECTURE.md            System design
├── README_ORIGINAL.md         Legacy docs
├── START_HERE_LEGACY.md       Legacy guide
│
├── audits/                    API endpoint audits
├── coverage/                  Basecamp API coverage analysis
├── reference/                 API reference docs
├── phases/                    Development phases
│
├── api/                       (planned - API specs)
├── architecture/              (planned - architecture docs)
├── development/
│   ├── EDGE_CASES_FRAMEWORK.md
│   └── E2E_TEST_SUITE.md
└── deployment/                (planned - deployment docs)
```

**What's here:**
- 291 Basecamp MCP tools documentation
- API coverage & audits
- Development guides & testing
- Architecture & design patterns

---

## 🔶 Layer 2: Flow (Execution)

**Path:** `docs/flow/`

```
flow/
├── README.md                  Layer guide
│
├── apps-platform/              Apps Platform (Activepieces-based)
│   ├── APPS_BASELINE_LOCK.md
│   ├── APPS_MASTER_TODO.md
│   ├── APPS_MILESTONE2_BACKLOG.md
│   ├── APPS_PLATFORM_PRD.md
│   ├── APPS_RELEASE_CHECKLIST.md
│   └── PRD_APPS_PHASE2.md
│
├── integrations-legacy/        Legacy integration docs
│
├── workflows/                  (planned - workflow patterns)
├── pieces/                     (planned - pieces catalog)
├── integration/                (planned - integration guides)
└── deployment/                 (planned - deployment)
```

**What's here:**
- 200+ Activepieces pieces documentation
- Apps Platform (marketplace) docs
- Workflow patterns & examples
- Cross-platform integration guides

---

## 🔺 Layer 3: PMOS (Intelligence)

**Path:** `docs/pmos/`

```
pmos/
├── README.md                   Layer guide
│
├── vision/                     ⭐ THE VISION
│   ├── PROJECT_MANAGEMENT_OS.md    Master vision (10,500 words)
│   ├── VISION_SUMMARY.md           Quick overview
│   ├── FEATURES_CATALOG.md         100+ features (7,000 words)
│   ├── INTELLIGENCE_PATTERNS.md    20+ algorithms (6,500 words)
│   ├── ROADMAP_VISUAL.md           8-wave plan (3,500 words)
│   ├── README.md                   Vision navigation
│   └── SESSION_LOG_2026-02-14.md   Session notes
│
├── features/           (planned - individual feature specs)
├── patterns/           (planned - algorithm patterns)
├── roadmap/            (planned - detailed roadmap)
└── implementation/     (planned - implementation guides)
```

**What's here:**
- Complete PM OS vision
- 100+ feature specifications
- 20+ intelligence patterns & algorithms
- Implementation roadmap
- AI & ML documentation

---

## ⚙️ System-Wide

**Path:** `docs/system/`

```
system/
├── architecture/               How it all fits together
│   └── SYSTEM_ARCHITECTURE.md  Complete system design
│
├── deployment/                 How to deploy
│   ├── DEPLOYMENT_GUIDE.md
│   └── PRODUCTION_HARDENING.md
│
└── operations/                 How to run & maintain
    ├── CE_MIGRATION_TODO.md
    ├── summaries/              Session summaries
    └── qa/                     QA documentation
```

**What's here:**
- Complete system architecture
- Layer integration patterns
- Deployment guides
- Operations & monitoring
- QA & testing strategies

---

## 🎯 Quick Navigation

### I want to...

**Understand the vision**
→ `pmos/vision/PROJECT_MANAGEMENT_OS.md`

**Work with Basecamp data**
→ `bcgpt/README.md` → `bcgpt/api/` or `bcgpt/coverage/`

**Create automations**
→ `flow/README.md` → `flow/workflows/`

**Implement AI features**
→ `pmos/README.md` → `pmos/features/` or `pmos/patterns/`

**Deploy the system**
→ `system/deployment/DEPLOYMENT_GUIDE.md`

**Understand architecture**
→ `system/architecture/SYSTEM_ARCHITECTURE.md`

**Find a specific doc**
→ `DOCS_INDEX.md`

**Get oriented**
→ `00-START-HERE.md`

---

## 📊 By the Numbers

| Layer | Folders | Files | Words |
|-------|---------|-------|-------|
| BCGPT | 8 | 20+ | 10,000+ |
| Flow | 6 | 10+ | 5,000+ |
| PMOS | 5 | 15+ | 25,000+ |
| System | 3 | 10+ | 5,000+ |
| **Total** | **22** | **55+** | **45,000+** |

---

## 🗺️ Visual Map

```
                      docs/
                        │
        ┌───────────────┼───────────────┐
        │               │               │
     bcgpt/          flow/           pmos/          system/
    (Data)       (Execution)    (Intelligence)   (Cross-cutting)
        │               │               │               │
  ┌─────┴─────┐   ┌────┴────┐     ┌────┴────┐     ┌────┴────┐
  │           │   │         │     │         │     │         │
audits/    api/  apps-   workflows/ vision/ features/ architecture/ deployment/
coverage/      platform/                                  
reference/                                    
phases/                                       
development/
deployment/
```

---

## 🚀 Navigation Flow

```
START HERE (00-START-HERE.md)
    ↓
Choose your path:
    ↓
┌───────────┬────────────┬───────────┬──────────┐
│           │            │           │          │
BCGPT     Flow        PMOS       System     DOCS_INDEX
 ↓          ↓           ↓          ↓           ↓
Read      Read        Read       Read      Browse
layer     layer       layer      system    complete
README    README      README     docs      index
 ↓          ↓           ↓          ↓           ↓
Browse    Browse      Browse     Choose    Find
specific  specific    specific   topic     anything
subfolder subfolder   subfolder            
```

---

**Use this map to quickly locate any document in the reorganized structure!** 🗺️
