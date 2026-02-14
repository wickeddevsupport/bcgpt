# PM OS Vision Index & Roadmap
**Complete navigation for the Project Management OS documentation**

Last Updated: 2026-02-14

## 📚 Documentation Structure

```
docs/
├── PROJECT_MANAGEMENT_OS.md ⭐ START HERE
│   └── Executive vision, architecture, waves, platform strategy
│
├── vision/
│   ├── FEATURES_CATALOG.md
│   │   └── Detailed specs for all 100+ features
│   │
│   ├── INTELLIGENCE_PATTERNS.md
│   │   └── Reusable algorithms & decision frameworks
│   │
│   └── ROADMAP_VISUAL.md (this file)
│       └── Navigation & implementation timeline
│
├── phases/
│   ├── TRUE_MCP_ROADMAP.md (existing)
│   ├── INTELLIGENT_CHAINING_ARCHITECTURE.md (existing)
│   └── *new phase docs will go here*
│
└── reference/
    └── bc3-api/ (existing Basecamp API docs)
```

---

## 🎯 Quick Start Guide

**If you're new to this project:**
1. Read [PROJECT_MANAGEMENT_OS.md](../PROJECT_MANAGEMENT_OS.md) for the big picture
2. Review [FEATURES_CATALOG.md](FEATURES_CATALOG.md) for specific features you care about
3. Check [INTELLIGENCE_PATTERNS.md](INTELLIGENCE_PATTERNS.md) for implementation patterns
4. Follow the waves below for implementation order

**If you're implementing a feature:**
1. Find it in the [Features Catalog](FEATURES_CATALOG.md)
2. Check if it uses patterns from [Intelligence Patterns](INTELLIGENCE_PATTERNS.md)
3. Follow the technical spec
4. Update this roadmap when complete

**If you're an AI assistant:**
- Start with PROJECT_MANAGEMENT_OS.md to understand the full vision
- Reference specific patterns when implementing intelligence features
- Update docs as you build
- Never lose context — everything is documented

---

## 🗺️ Implementation Roadmap

### Wave 1: Foundation (Weeks 1-2) 🔴 NOT STARTED
**Goal:** Enable stateful, context-aware interactions

| Feature | Priority | Status | Dependencies | Est. Days |
|---------|----------|--------|--------------|-----------|
| Conversational Memory | P0 | 🔴 Not Started | Database schema | 3 |
| Time Machine (Snapshots) | P0 | 🔴 Not Started | Miner extension | 4 |
| Operation Log & Undo | P0 | 🔴 Not Started | Database schema | 2 |
| Reference Resolution | P0 | 🔴 Not Started | Memory system | 2 |

**Deliverables:**
- [ ] `session_memory` table
- [ ] `snapshots` table with diff engine
- [ ] `operation_log` table with undo mappings
- [ ] MCP tools: `resolve_reference`, `what_changed_since`, `who_did_what`, `undo_last`

**Success Criteria:**
- [ ] Can say "that project" and AI resolves correctly (>95% accuracy)
- [ ] Can undo any operation within 5 seconds
- [ ] Can query "what changed since yesterday" in <500ms

---

### Wave 2: Intelligence (Weeks 3-5) 🔴 NOT STARTED
**Goal:** Make PM OS visibly smart

| Feature | Priority | Status | Dependencies | Est. Days |
|---------|----------|--------|--------------|-----------|
| Project Pulse | P0 | 🔴 Not Started | Miner data | 5 |
| Focus Mode | P1 | 🔴 Not Started | Pulse, Priority scoring | 4 |
| NL Query Engine | P1 | 🔴 Not Started | Search index | 4 |
| Smart Dashboards | P1 | 🔴 Not Started | Pulse, Query engine | 3 |
| Ghost Work Detector | P1 | 🔴 Not Started | Pattern detection | 3 |

**Deliverables:**
- [ ] Health scoring algorithms (velocity, risk, communication, balance)
- [ ] MCP tools: `get_project_pulse`, `my_day`, `what_should_i_work_on`, `end_of_day`
- [ ] Natural language query parser
- [ ] Dashboard generation system
- [ ] Bottleneck & stall detection

**Success Criteria:**
- [ ] Health scores correlate with actual outcomes (>0.7 correlation)
- [ ] Users run `my_day` >3x per week
- [ ] NL queries succeed >90% of the time

---

### Wave 3: Construction (Weeks 6-8) 🔴 NOT STARTED
**Goal:** Build complex structures with natural language

| Feature | Priority | Status | Dependencies | Est. Days |
|---------|----------|--------|--------------|-----------|
| NL Project Builder | P1 | 🔴 Not Started | LLM integration | 5 |
| Smart Assignment | P1 | 🔴 Not Started | Skill graph, Load tracking | 4 |
| Predictive Deadlines | P1 | 🔴 Not Started | Velocity tracking | 4 |
| Recipe System | P1 | 🔴 Not Started | Operation log | 3 |
| Dependency Engine | P2 | 🔴 Not Started | NLP, Graph algorithms | 4 |

**Deliverables:**
- [ ] Project structure parser (NL → structured plan)
- [ ] Assignment optimization algorithm
- [ ] Velocity-based prediction model
- [ ] Recipe storage & execution system
- [ ] Dependency graph builder

**Success Criteria:**
- [ ] NL project builder >90% parsing accuracy
- [ ] Smart assignments not changed >80% of the time
- [ ] Deadline predictions within 20% of actual >70% of the time

---

### Wave 4: Autonomy (Weeks 9-12) 🔴 NOT STARTED
**Goal:** AI that acts on goals, not just commands

| Feature | Priority | Status | Dependencies | Est. Days |
|---------|----------|--------|--------------|-----------|
| Agent Framework | P0 | 🔴 Not Started | Operation log, Undo | 6 |
| Proactive Notifications | P1 | 🔴 Not Started | Agent framework | 4 |
| Webhook Bridge | P1 | 🔴 Not Started | Event system | 3 |
| Goal-Based Agent Mode | P1 | 🔴 Not Started | Agent framework | 5 |
| Multi-Agent Coordination | P2 | 🔴 Not Started | Agent framework | 5 |

**Deliverables:**
- [ ] Base Agent class with OADA loop
- [ ] PM Agent, Triage Agent, Quality Agent
- [ ] Event subscription system
- [ ] Goal definition & evaluation framework
- [ ] Agent coordination protocol

**Success Criteria:**
- [ ] Agents act autonomously 10+ times per day
- [ ] Agent actions approved by users >85% of the time
- [ ] No conflicts between agents (coordination works)

---

### Wave 5: Knowledge (Weeks 13-16) 🔴 NOT STARTED
**Goal:** Never forget, always learn

| Feature | Priority | Status | Dependencies | Est. Days |
|---------|----------|--------|--------------|-----------|
| Semantic Search | P1 | 🔴 Not Started | Embedding model, Vector DB | 5 |
| Decision Log Extraction | P1 | 🔴 Not Started | NLP | 3 |
| Retrospective Generator | P1 | 🔴 Not Started | Historical data | 4 |
| FAQ Builder | P2 | 🔴 Not Started | Semantic search | 3 |
| Knowledge Graph | P2 | 🔴 Not Started | Graph DB | 5 |

**Deliverables:**
- [ ] Embedding generation pipeline
- [ ] Vector database integration
- [ ] Decision extraction NLP patterns
- [ ] Retrospective templates & analysis
- [ ] Collaboration graph builder

**Success Criteria:**
- [ ] Semantic search finds relevant content >85% of the time
- [ ] Decision log completeness >90%
- [ ] Retrospectives surface actionable insights every time

---

### Wave 6: Enterprise (Weeks 17-20) 🔴 NOT STARTED
**Goal:** Compliance, governance, reporting

| Feature | Priority | Status | Dependencies | Est. Days |
|---------|----------|--------|--------------|-----------|
| Full Audit Trail | P1 | 🔴 Not Started | Operation log extension | 3 |
| Policy Engine | P1 | 🔴 Not Started | Agent framework | 4 |
| Approval Workflows | P1 | 🔴 Not Started | Policy engine | 4 |
| Enterprise Reporting | P1 | 🔴 Not Started | All analytics | 5 |
| Cost Intelligence | P2 | 🔴 Not Started | Time tracking | 4 |

**Deliverables:**
- [ ] Immutable audit log
- [ ] Policy definition DSL
- [ ] Approval routing system
- [ ] Report scheduler & templates
- [ ] Budget tracking & forecasting

**Success Criteria:**
- [ ] 100% operation coverage in audit log
- [ ] Policies enforced without manual intervention
- [ ] Reports generated on schedule with >95% accuracy

---

### Wave 7: Platform (Weeks 21-28) 🔴 NOT STARTED
**Goal:** Ecosystem and marketplace

| Feature | Priority | Status | Dependencies | Est. Days |
|---------|----------|--------|--------------|-----------|
| Multi-Tenant Architecture | P0 | 🔴 Not Started | Data isolation | 8 |
| Template Marketplace | P1 | 🔴 Not Started | Multi-tenant | 5 |
| Automation Library | P1 | 🔴 Not Started | Activepieces integration | 5 |
| Plugin System | P2 | 🔴 Not Started | API design | 6 |
| Community Features | P2 | 🔴 Not Started | Marketplace | 4 |

**Deliverables:**
- [ ] Tenant isolation & provisioning
- [ ] Marketplace backend & UI
- [ ] Automation sharing system
- [ ] Plugin SDK & registry
- [ ] Rating & discovery features

**Success Criteria:**
- [ ] Support 100+ tenants without performance degradation
- [ ] 50+ templates available in marketplace
- [ ] 10+ community-contributed plugins

---

### Wave 8: Expansion (Weeks 29+) 🔴 NOT STARTED
**Goal:** Multi-platform & advanced AI

| Feature | Priority | Status | Dependencies | Est. Days |
|---------|----------|--------|--------------|-----------|
| GitHub Adapter | P1 | 🔴 Not Started | Platform adapter pattern | 6 |
| Jira Adapter | P1 | 🔴 Not Started | Platform adapter pattern | 6 |
| Slack Integration | P2 | 🔴 Not Started | Notification system | 4 |
| Advanced AI Personas | P2 | 🔴 Not Started | LLM fine-tuning | 8 |
| Predictive Modeling | P2 | 🔴 Not Started | ML pipeline | 10 |

**Deliverables:**
- [ ] Platform adapter framework
- [ ] 3+ additional platform adapters
- [ ] Cross-platform queries
- [ ] Fine-tuned AI models
- [ ] ML prediction pipeline

**Success Criteria:**
- [ ] Unified queries across 3+ platforms
- [ ] Cross-platform intelligence (e.g., GitHub PRs + Basecamp tasks)
- [ ] Prediction accuracy >80%

---

## 📊 Progress Dashboard

### Overall Status
```
Foundation:   ▢▢▢▢ 0/4 features (0%)
Intelligence: ▢▢▢▢▢ 0/5 features (0%)
Construction: ▢▢▢▢▢ 0/5 features (0%)
Autonomy:     ▢▢▢▢▢ 0/5 features (0%)
Knowledge:    ▢▢▢▢▢ 0/5 features (0%)
Enterprise:   ▢▢▢▢▢ 0/5 features (0%)
Platform:     ▢▢▢▢▢ 0/5 features (0%)
Expansion:    ▢▢▢▢▢ 0/5 features (0%)
───────────────────────────────────
Total:        ▢▢▢▢▢ 0/40 core features
```

### Current Focus
🎯 **Wave 1: Foundation** (not started)
- Next Task: Implement conversational memory
- Blocked By: None
- Ready to Start: ✅

---

## 🏗️ Technical Architecture Reference

### Core Components

```
┌─────────────────────────────────────────────────────┐
│              PM OS Intelligence Core                 │
├─────────────────────────────────────────────────────┤
│  Conversational │ Time Machine │ Agent Framework    │
│  Memory        │ (Snapshots)  │                     │
├─────────────────┼──────────────┼────────────────────┤
│  Project Pulse  │ Focus Mode   │ NL Query Engine    │
│  (Health Score) │ (Personal AI)│                     │
├─────────────────┼──────────────┼────────────────────┤
│  Smart Assign   │ Predictions  │ Knowledge Graph    │
│                 │              │                     │
└─────────────────────────────────────────────────────┘
                        ↕
┌─────────────────────────────────────────────────────┐
│         Platform Adapter Layer (MCP Servers)         │
├──────────────┬──────────────┬──────────────────────┤
│  Basecamp ✅ │   Jira 🔜    │   GitHub 🔜          │
│  291 tools   │              │                       │
└──────────────┴──────────────┴──────────────────────┘
                        ↕
┌─────────────────────────────────────────────────────┐
│              Automation Layer                        │
│         (Activepieces + Custom Flows)                │
└─────────────────────────────────────────────────────┘
```

### Data Model

```yaml
# Core Intelligence Tables
session_memory:      # Conversational context
  - session_id, user_key, entity_type, entity_id, context

snapshots:           # Time machine
  - entity_type, entity_id, snapshot JSONB, timestamp

operation_log:       # Undo & audit
  - operation_type, target, args, undo_operation, undo_args

health_scores:       # Project pulse
  - project_id, score, breakdown JSONB, computed_at

predictions:         # Deadline forecasts
  - entity_id, predicted_date, confidence, factors JSONB

agent_actions:       # Autonomous activity
  - agent_id, action_type, target, decision_factors JSONB

# Vector DB (external)
embeddings:          # Semantic search
  - entity_id, embedding vector, metadata

# Graph DB (external - optional)
relationships:       # Collaboration & dependencies
  - from_id, to_id, rel_type, weight
```

---

## 🎓 Learning Resources

### For New Contributors
1. **Start Here:** [PROJECT_MANAGEMENT_OS.md](../PROJECT_MANAGEMENT_OS.md)
2. **Understand Features:** [FEATURES_CATALOG.md](FEATURES_CATALOG.md)
3. **Learn Patterns:** [INTELLIGENCE_PATTERNS.md](INTELLIGENCE_PATTERNS.md)
4. **Current Architecture:** [ARCHITECTURE.md](../ARCHITECTURE.md)
5. **Basecamp API:** [bc3-api docs](../reference/bc3-api/)

### For AI Assistants
- **Context Docs:** All of the above, especially FEATURES_CATALOG and INTELLIGENCE_PATTERNS
- **Current State:** Check [mcp.js](../../mcp.js) for existing tools
- **Data Layer:** Review [db.js](../../db.js) and [miner.js](../../miner.js)
- **Pattern Reference:** Use INTELLIGENCE_PATTERNS.md for algorithms

### For Product Managers
- **Vision:** PROJECT_MANAGEMENT_OS.md (Section 1-2)
- **Features:** FEATURES_CATALOG.md (user stories)
- **Timeline:** This file (waves & roadmap)
- **Success Metrics:** Each wave's success criteria

---

## 🔄 Update Protocol

**When you implement a feature:**
1. ✅ Update status in this roadmap (🔴 → 🟡 → 🟢)
2. 📝 Document implementation details in FEATURES_CATALOG.md
3. 🔗 Add any new patterns to INTELLIGENCE_PATTERNS.md
4. 🧪 Update success metrics with actual results
5. 📊 Regenerate progress dashboard above

**When you discover a new pattern:**
1. 📚 Add to INTELLIGENCE_PATTERNS.md
2. 🏷️ Tag which features use it
3. 💡 Add examples & use cases

**When you have an idea:**
1. 🚀 Add to FEATURES_CATALOG.md (assign next available number)
2. 📋 Include: description, user stories, technical spec, MCP API
3. 🗺️ Decide which wave it belongs to
4. 🔢 Update the feature index

---

## 🎯 Key Milestones

| Milestone | Target Date | Status | Progress |
|-----------|-------------|--------|----------|
| **Wave 1 Complete** | 2026-03-01 | 🔴 Not Started | 0/4 features |
| **Wave 2 Complete** | 2026-04-01 | 🔴 Not Started | 0/5 features |
| **Wave 3 Complete** | 2026-05-01 | 🔴 Not Started | 0/5 features |
| **Wave 4 Complete** | 2026-06-15 | 🔴 Not Started | 0/5 features |
| **Wave 5 Complete** | 2026-07-15 | 🔴 Not Started | 0/5 features |
| **Wave 6 Complete** | 2026-08-15 | 🔴 Not Started | 0/5 features |
| **Wave 7 Complete** | 2026-10-01 | 🔴 Not Started | 0/5 features |
| **MVP Launch** | 2026-04-01 | 🔴 Not Started | Waves 1-2 |
| **Public Beta** | 2026-07-01 | 🔴 Not Started | Waves 1-4 |
| **V1.0 Release** | 2026-10-01 | 🔴 Not Started | Waves 1-6 |

---

## 🚀 Next Actions

**Immediate (This Week):**
1. [ ] Read all vision docs (you're doing this now!)
2. [ ] Review existing codebase (mcp.js, index.js, basecamp.js)
3. [ ] Set up development environment
4. [ ] Design database schemas for Wave 1

**Short Term (Next 2 Weeks):**
1. [ ] Implement conversational memory
2. [ ] Build time machine snapshot system
3. [ ] Create operation log with undo
4. [ ] Test Wave 1 foundation

**Medium Term (Next Month):**
1. [ ] Build Project Pulse scoring
2. [ ] Implement Focus Mode
3. [ ] Launch Week 1 MVP with memory + intelligence

---

## 📞 Contact & Collaboration

**For Questions:**
- Check docs first (likely answered)
- Review existing code (might be implemented)
- Ask in context (with links to relevant docs)

**For Contributions:**
- Follow the update protocol above
- Keep docs in sync with code
- Write tests (when we have a test framework)
- Document patterns for reuse

---

**Remember: This isn't just a tool. This is an operating system for the future of work.**

*Every idea preserved. Every pattern documented. Every decision tracked. Nothing lost.*
