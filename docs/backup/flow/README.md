# Flow - Activepieces (Execution Layer)

**Layer:** Execution Layer  
**Technology:** Activepieces, 200+ Pieces  
**Purpose:** Universal cross-platform workflow automation

---

## 🎯 What is Flow?

Flow is the execution engine powered by **Activepieces** - an open-source workflow automation platform. It's the **execution layer** that makes PM OS omnipotent across 200+ platforms.

### Key Capabilities

- **200+ Pre-Built Pieces**: Platform integrations (FREE!)
- **Visual Flow Builder**: No-code automation designer
- **Event-Driven**: Webhooks, schedules, triggers, polling
- **Cross-Platform**: One flow can control multiple platforms
- **Custom Pieces**: Can build custom integrations
- **Self-Hosted**: Deployed at flow.wickedlab.io

---

## 🚀 Why Flow Changes Everything

### Before Flow
- ❌ Need to build MCP server for every platform (months each)
- ❌ Maintain 20+ custom integrations forever
- ❌ Limited to platforms we build
- ❌ Years to achieve multi-platform coverage

### With Flow
- ✅ **200+ platforms ready immediately** (FREE!)
- ✅ **Community maintains pieces** (we focus on intelligence)
- ✅ **New platforms added constantly** by Activepieces community
- ✅ **Months to market** instead of years

**Result:** PM OS can control the entire work stack from day one.

---

## 📂 Documentation

### Getting Started
- **[OVERVIEW.md](OVERVIEW.md)** - What is Flow, why it matters
- **[PIECES_CATALOG.md](PIECES_CATALOG.md)** - All 200+ available pieces
- **[QUICK_START.md](QUICK_START.md)** - Build your first flow

### Workflows
- **[workflows/WORKFLOW_PATTERNS.md](workflows/WORKFLOW_PATTERNS.md)** - Reusable flow patterns
- **[workflows/PM_OS_FLOWS.md](workflows/PM_OS_FLOWS.md)** - PM OS-specific automations
- **[workflows/EXAMPLES.md](workflows/EXAMPLES.md)** - Complete flow examples

### Integration
- **[integration/BCGPT_INTEGRATION.md](integration/BCGPT_INTEGRATION.md)** - Connecting BCGPT ↔ Flow
- **[integration/PMOS_ORCHESTRATION.md](integration/PMOS_ORCHESTRATION.md)** - PMOS → Flow triggers
- **[integration/WEBHOOKS.md](integration/WEBHOOKS.md)** - Webhook bridge setup

### Pieces
- **[pieces/BASECAMP_PIECE.md](pieces/BASECAMP_PIECE.md)** - Custom Basecamp piece docs
- **[pieces/BUILDING_CUSTOM.md](pieces/BUILDING_CUSTOM.md)** - How to build pieces
- **[pieces/POPULAR_PIECES.md](pieces/POPULAR_PIECES.md)** - Most-used pieces guide

### Deployment
- **[deployment/DEPLOYMENT.md](deployment/DEPLOYMENT.md)** - How to deploy Activepieces
- **[deployment/CONFIGURATION.md](deployment/CONFIGURATION.md)** - Environment variables
- **[deployment/MONITORING.md](deployment/MONITORING.md)** - Flow monitoring

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  PMOS Intelligence Layer                     │
│         (Decides what to do, triggers flows)                │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│              Flow Orchestration API                          │
│  • Create flows      • Trigger flows                        │
│  • List flows        • Get status                           │
│  • Pause/resume      • Monitor execution                    │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│              Activepieces Flow Engine                        │
│               (flow.wickedlab.io)                           │
├─────────────────────────────────────────────────────────────┤
│  Flow Components:                                            │
│  • Triggers    → Webhooks, schedules, manual                │
│  • Actions     → Execute piece operations                   │
│  • Conditions  → If/else logic                              │
│  • Loops       → Iterate over data                          │
│  • Branches    → Parallel execution                         │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│              200+ Platform Pieces                            │
├─────────────────────────────────────────────────────────────┤
│  Project Management: Basecamp, Jira, Asana, Linear...       │
│  Development:        GitHub, GitLab, Bitbucket...           │
│  Communication:      Slack, Discord, Teams, Email...        │
│  Data:               Sheets, Airtable, Notion...            │
│  AI:                 OpenAI, Anthropic, Hugging Face...     │
│  + 150 more platforms                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 Available Pieces (200+)

### Project Management (15 pieces)
- ✅ **Basecamp** (custom piece)
- ✅ Jira, Asana, Monday, Linear
- ✅ Trello, ClickUp, Notion, Todoist
- ✅ Airtable, ClickUp, Wrike

### Development (12 pieces)
- ✅ GitHub, GitLab, Bitbucket
- ✅ Azure DevOps, Jenkins
- ✅ Docker, Kubernetes

### Communication (18 pieces)
- ✅ Slack, Discord, Microsoft Teams
- ✅ Telegram, WhatsApp Business
- ✅ Twilio, SMS

### Email (10 pieces)
- ✅ Gmail, Outlook, SendGrid
- ✅ Mailchimp, Postmark, SMTP

### Calendar (5 pieces)
- ✅ Google Calendar, Outlook Calendar
- ✅ Calendly, Cal.com

### Data & Sheets (12 pieces)
- ✅ Google Sheets, Airtable, Excel
- ✅ CSV, JSON, PostgreSQL, MySQL

### Documents (8 pieces)
- ✅ Notion, Confluence, Google Docs
- ✅ Dropbox, OneDrive, Box

### AI (15 pieces)
- ✅ OpenAI, Anthropic
- ✅ Hugging Face, Stability AI
- ✅ Google AI, Azure AI

### CRM & Sales (20 pieces)
- ✅ Salesforce, HubSpot, Pipedrive
- ✅ Zendesk, Intercom, Freshdesk

### E-Commerce (10 pieces)
- ✅ Shopify, WooCommerce, Stripe
- ✅ PayPal, Square

### **+ 100 more pieces** covering every major platform!

See [PIECES_CATALOG.md](PIECES_CATALOG.md) for complete list.

---

## 🎯 Use Cases

### 1. Intelligence-Triggered Automation
```
PMOS detects: Project health < 60
      ↓
Flow executes:
  1. Post alert to Slack
  2. Create Jira escalation ticket
  3. Email stakeholders
  4. Update dashboard in Sheets
  5. Log to Notion wiki
```

### 2. Cross-Platform Sync
```
Basecamp todo completed
      ↓
Flow executes:
  1. Update related GitHub issue
  2. Post celebration in Slack
  3. Update time tracking in Jira
  4. Log completion in calendar
```

### 3. Natural Language → Automation
```
User says: "When a card moves to Done, celebrate"
      ↓
PMOS generates flow JSON
      ↓
Flow executes:
  Trigger: Card status changed
  Condition: Status = Done
  Action: Post celebration message
```

See [workflows/EXAMPLES.md](workflows/EXAMPLES.md) for more.

---

## 📊 Quick Stats

- **Pieces Available:** 200+
- **Platforms Covered:** Every major work platform
- **Custom Pieces:** 1 (Basecamp, more planned)
- **Deployment:** flow.wickedlab.io
- **Maintenance:** Community-maintained

---

## 🚀 Quick Start

### Create Your First Flow

1. **Access Flow Builder**
   - Navigate to https://flow.wickedlab.io
   - Login with credentials

2. **Create New Flow**
   - Click "Create Flow"
   - Choose trigger (webhook, schedule, manual)

3. **Add Actions**
   - Drag pieces from sidebar
   - Configure piece settings
   - Connect pieces together

4. **Test & Deploy**
   - Click "Test" to run flow
   - Review execution log
   - Click "Publish" to activate

See [QUICK_START.md](QUICK_START.md) for detailed tutorial.

---

## 🔗 Integration with Other Layers

### → BCGPT (Data Layer)
Flow and BCGPT work together:
- **Basecamp piece** uses BCGPT patterns
- **Webhooks** from Basecamp trigger flows
- **Flows** can call BCGPT tools for deep operations

### → PMOS (Intelligence Layer)
PMOS orchestrates Flow:
- **Intelligence decides** → Flow executes
- **Agents trigger flows** automatically
- **NL requests** → PMOS generates flows
- **Learning loop**: Flow results → PMOS learns

See [integration/PMOS_ORCHESTRATION.md](integration/PMOS_ORCHESTRATION.md)

---

## 🛠️ Development

### Building a Custom Piece

```typescript
// packages/pieces/community/my-piece/src/index.ts
import { createPiece } from '@activepieces/pieces-framework';

export const myPiece = createPiece({
  name: 'my-piece',
  displayName: 'My Platform',
  auth: PieceAuth.OAuth2({...}),
  actions: [
    {
      name: 'create_task',
      displayName: 'Create Task',
      description: 'Creates a new task',
      props: {
        title: Property.ShortText({...}),
        description: Property.LongText({...})
      },
      run: async (context) => {
        // Implementation
      }
    }
  ]
});
```

See [pieces/BUILDING_CUSTOM.md](pieces/BUILDING_CUSTOM.md)

---

## 📈 Roadmap

### Current State
- ✅ Activepieces deployed at flow.wickedlab.io
- ✅ 200+ pieces available
- ✅ Custom Basecamp piece built
- ✅ Visual flow builder working

### Wave 1-2 (Integration)
- 📝 Webhook bridge (Basecamp → Flow)
- 📝 MCP tools to manage flows
- 📝 BCGPT ↔ Flow orchestration

### Wave 3 (Intelligence)
- 📝 Natural language → flow generation
- 📝 AI flow optimizer
- 📝 Cross-platform health monitoring

### Wave 4 (Autonomy)
- 📝 Agent → flow integration
- 📝 Auto-generate & execute flows
- 📝 Learning from flow results

### Wave 7 (Platform)
- 📝 Flow marketplace
- 📝 Template sharing
- 📝 Community contributions

See [../pmos/roadmap/ROADMAP_VISUAL.md](../pmos/roadmap/ROADMAP_VISUAL.md)

---

## 🆘 Troubleshooting

**Flows not triggering?**
→ Check [deployment/TROUBLESHOOTING.md](deployment/TROUBLESHOOTING.md)

**Piece not working?**
→ Verify API credentials in piece settings

**Need custom integration?**
→ See [pieces/BUILDING_CUSTOM.md](pieces/BUILDING_CUSTOM.md)

---

## 📚 Learn More

- **Activepieces Docs:** https://www.activepieces.com/docs
- **Pieces Framework:** https://www.activepieces.com/docs/developers/piece-framework
- **PM OS Vision:** [../pmos/vision/PROJECT_MANAGEMENT_OS.md](../pmos/vision/PROJECT_MANAGEMENT_OS.md)
- **System Architecture:** [../system/architecture/SYSTEM_ARCHITECTURE.md](../system/architecture/SYSTEM_ARCHITECTURE.md)
