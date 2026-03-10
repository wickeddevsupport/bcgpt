# Autonomous Agents - AI Team That Works For You

**Last Updated:** 2026-02-17
**Related:** [AGENT_MANAGEMENT.md](AGENT_MANAGEMENT.md)

---

## The Vision

Every user gets an **AI Team** - a group of specialized agents that work autonomously in the background, just like a real company team. Your AI team can include:

- **Sales Manager** - Monitors leads, qualifies prospects, updates CRM
- **Project Manager** - Tracks deadlines, sends reminders, generates reports
- **Developer** - Reviews code, monitors issues, deploys fixes
- **Designer** - Creates assets, manages brand consistency
- **Support Agent** - Handles tickets, responds to common queries
- **Marketing Agent** - Schedules posts, tracks engagement, suggests content

**These agents work 24/7, never sleep, and keep you informed only when needed.**

---

## Autonomous vs Interactive Mode

### Agent Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Autonomous** | Runs in background, executes tasks independently, notifies user of important events | Monitoring, routine tasks, alerts |
| **Interactive** | Only responds when user chats with it | On-demand tasks, creative work |
| **Hybrid** | Autonomous for routine, interactive for complex decisions | Best of both worlds |

### User Control

```
+----------------------------------------------------------+
|  Sales Agent Settings                                     |
+----------------------------------------------------------+
|                                                           |
|  Mode: [Autonomous v]                                     |
|        (Autonomous, Interactive, Hybrid)                  |
|                                                           |
|  Autonomous Tasks:                                        |
|  [x] Check for new leads every 30 minutes                 |
|  [x] Qualify leads automatically (score > 70)             |
|  [x] Update CRM with lead status                          |
|  [x] Notify me when hot lead detected                     |
|  [ ] Auto-send follow-up emails                           |
|                                                           |
|  Notification Preferences:                                |
|  [x] Push notification for hot leads                     |
|  [x] Daily summary at 9:00 AM                             |
|  [ ] Slack message for every lead                         |
|                                                           |
|  Connections:                                             |
|  Basecamp: [Connected v]  [Manage]                        |
|  Slack:    [Connected v]  [Manage]                        |
|  Email:    [Connected v]  [Manage]                        |
|                                                           |
+----------------------------------------------------------+
```

---

## How Autonomous Agents Work

### Architecture

```
+----------------------------------------------------------+
|                    Autonomous Agent                        |
+----------------------------------------------------------+
|                                                           |
|  +-------------+    +-------------+    +-------------+    |
|  |  Scheduler  |--->|   Trigger   |--->|  Executor   |    |
|  | (Cron/Event)|    | (Condition) |    |  (Action)   |    |
|  +-------------+    +-------------+    +-------------+    |
|        |                  |                  |            |
|        v                  v                  v            |
|  "Every 30 min"    "New lead?"         "Qualify &        |
|                                          notify"          |
|                                                           |
|  +-------------+    +-------------+    +-------------+    |
|  |   Memory    |<---|   AI Brain  |--->|  n8n Flow   |    |
|  | (Context)   |    | (Decision)  |    | (Actions)   |    |
|  +-------------+    +-------------+    +-------------+    |
|                                                           |
+----------------------------------------------------------+
                           |
                           v
+----------------------------------------------------------+
|                    n8n Workflows                          |
|  (Pre-built or agent-created)                             |
|                                                           |
|  Lead Qualification Flow:                                 |
|  [Webhook] --> [AI Score] --> [Filter] --> [Slack Alert]  |
|                                                           |
|  Daily Report Flow:                                       |
|  [Schedule] --> [Fetch Data] --> [Format] --> [Email]     |
|                                                           |
+----------------------------------------------------------+
```

### Execution Flow

```
1. TRIGGER
   - Time-based (every 30 min, daily at 9am)
   - Event-based (new lead, ticket created, issue opened)
   - Webhook-based (external service notification)

2. EVALUATE
   - Agent checks if action is needed
   - Uses AI to assess relevance and priority
   - References memory for context

3. DECIDE
   - Should I notify the user?
   - Should I execute an action?
   - Should I create a workflow?

4. EXECUTE
   - Run n8n workflow
   - Send notification
   - Update external service

5. LEARN
   - Store results in memory
   - Improve future decisions
   - Report to user if configured
```

---

## Connection Management

### Connect Once, Use Everywhere

Users connect services (Slack, Basecamp, GitHub, etc.) **once** at the workspace level. All agents can use these connections.

```
+----------------------------------------------------------+
|  Workspace Connections                                    |
+----------------------------------------------------------+
|                                                           |
|  Connected Services:                                      |
|                                                           |
|  +------------------+  +------------------+               |
|  | Basecamp         |  | Slack            |               |
|  | Account: acme    |  | Workspace: dev   |               |
|  | [Edit] [Remove]  |  | [Edit] [Remove]  |               |
|  +------------------+  +------------------+               |
|                                                           |
|  +------------------+  +------------------+               |
|  | GitHub           |  | Email (SMTP)    |               |
|  | Org: acme-inc    |  | user@acme.com   |               |
|  | [Edit] [Remove]  |  | [Edit] [Remove]  |               |
|  +------------------+  +------------------+               |
|                                                           |
|  [+ Add Connection]                                       |
|                                                           |
+----------------------------------------------------------+
```

### How Agents Use Connections

```
Sales Agent:
  - Uses Basecamp connection to check for new todos
  - Uses Slack connection to notify team
  - Uses Email connection to send follow-ups

Dev Agent:
  - Uses GitHub connection to monitor issues
  - Uses Slack connection to alert on bugs
  - Uses Basecamp connection to update project status

All agents share the same connections - no per-agent setup needed.
```

---

## Agent Templates

### Pre-Built Autonomous Agents

| Template | Autonomous Tasks | Notifications |
|----------|------------------|---------------|
| **Sales Manager** | Lead monitoring, CRM updates, follow-ups | Hot leads, daily summary |
| **Project Manager** | Deadline tracking, status updates, reports | Overdue items, weekly report |
| **Developer** | Issue monitoring, PR reviews, deployments | Critical bugs, deployment status |
| **Support Agent** | Ticket triage, auto-responses, escalation | Urgent tickets, satisfaction drop |
| **Marketing Agent** | Post scheduling, engagement tracking | Viral content, campaign results |
| **Designer** | Asset management, brand consistency | New requests, deadline alerts |

### Creating Custom Autonomous Agents

```
User: "Create an agent that monitors my Basecamp project 
       and notifies me when tasks are overdue"

OpenClaw: "I'll create a 'Project Monitor' agent for you.
           
           Configuration:
           - Name: Project Monitor
           - Mode: Autonomous
           - Schedule: Check every hour
           - Trigger: Task overdue
           - Action: Slack notification
           - Connection: Uses your existing Basecamp & Slack
           
           [Create Agent] [Customize]"
```

---

## Notification System

### Smart Notifications

Agents don't spam users. They notify intelligently:

```
Notification Rules:

1. PRIORITY-BASED
   - Critical: Immediate push + Slack
   - High: Push notification
   - Medium: Daily digest
   - Low: Weekly summary

2. LEARNING-BASED
   - Agent learns what you care about
   - Reduces noise over time
   - Adjusts based on your responses

3. CONTEXT-BASED
   - Don't notify during meetings (calendar aware)
   - Batch similar notifications
   - Respect do-not-disturb hours
```

### Notification Center

```
+----------------------------------------------------------+
|  Notifications                                     [Mark All Read] |
+----------------------------------------------------------+
|                                                           |
|  Today                                                    |
|  ---------                                                |
|  [!] Sales Agent: Hot lead detected - Acme Corp (score 85) |
|      10 minutes ago                    [View] [Dismiss]    |
|                                                           |
|  [i] Dev Agent: PR #142 approved by 2 reviewers           |
|      1 hour ago                        [View] [Dismiss]    |
|                                                           |
|  [i] PM Agent: 3 tasks overdue this week                   |
|      2 hours ago                       [View] [Dismiss]    |
|                                                           |
|  Yesterday                                                |
|  ---------                                                |
|  [i] Sales Agent: Daily summary - 5 new leads, 2 qualified |
|      Yesterday 9:00 AM                 [View]             |
|                                                           |
+----------------------------------------------------------+
```

---

## Dashboard UI - Reimagined

### Natural Language First

The entire UI is designed around natural language interaction:

```
+----------------------------------------------------------+
|  OpenClaw - Your AI Team                                  |
+----------------------------------------------------------+
|                                                           |
|  [What would you like to do today?              ] [Ask]   |
|                                                           |
|  Quick Actions:                                           |
|  [Check leads] [Daily report] [Create workflow] [Settings]|
|                                                           |
+----------------------------------------------------------+
|                                                           |
|  Your AI Team                           [Team Status: 4 Active] |
|                                                           |
|  +---------+  +---------+  +---------+  +---------+       |
|  | Sales   |  | Dev     |  | PM      |  | Support |       |
|  | Manager |  | Agent   |  | Agent   |  | Agent   |       |
|  | ------- |  | ------- |  | ------- |  | ------- |       |
|  | 3 tasks |  | 1 task  |  | 2 tasks |  | 5 tasks |       |
|  | running |  | running |  | running |  | queued  |       |
|  |         |  |         |  |         |  |         |       |
|  | [Chat]  |  | [Chat]  |  | [Chat]  |  | [Chat]  |       |
|  +---------+  +---------+  +---------+  +---------+       |
|                                                           |
+----------------------------------------------------------+
|                                                           |
|  Recent Activity                                          |
|  ----------------                                         |
|  - Sales Agent qualified 3 leads (2 min ago)              |
|  - Dev Agent detected critical bug in production (1h ago)  |
|  - PM Agent sent weekly report (yesterday)                |
|                                                           |
+----------------------------------------------------------+
```

### Chat-Centric Navigation

Instead of navigating through menus, users can just chat:

```
User: "Show me the sales agent settings"
OpenClaw: [Opens Sales Agent settings panel]

User: "What did the dev agent do today?"
OpenClaw: [Shows Dev Agent activity log]

User: "Create a new workflow for lead routing"
OpenClaw: [Opens workflow builder with lead routing template]
```

### Minimal, Clean Interface

```
Design Principles:

1. ONE INPUT FIELD
   - Natural language is the primary interface
   - Everything can be done through chat
   - Traditional UI elements are secondary

2. CONTEXTUAL CARDS
   - Information appears when needed
   - No cluttered dashboards
   - Agents surface relevant data

3. PROGRESSIVE DISCLOSURE
   - Simple by default
   - Power features hidden until needed
   - Learn as you go

4. MOBILE-FIRST
   - Works perfectly on phone
   - Push notifications primary
   - Quick actions accessible
```

---

## Page Redesigns

### Dashboard (Home)

```
+----------------------------------------------------------+
|  Good morning, John!                                      |
+----------------------------------------------------------+
|                                                           |
|  [What can I help you with?                    ] [Ask]    |
|                                                           |
|  Your AI Team Today                                       |
|  ---------------------                                     |
|  Sales Agent: 3 hot leads waiting for follow-up          |
|  Dev Agent:  1 PR ready for merge                        |
|  PM Agent:   Weekly report generated                      |
|                                                           |
|  [View All Activity]                                      |
|                                                           |
+----------------------------------------------------------+
```

### Agents Page

```
+----------------------------------------------------------+
|  Agents                                          [+ New]  |
+----------------------------------------------------------+
|                                                           |
|  Filter: [All v]  Sort: [Activity v]                      |
|                                                           |
|  +----------------------------------------------------+  |
|  | Sales Agent                              [Active]   |  |
|  | Model: GPT-4 | Mode: Autonomous | Tasks: 3 running |  |
|  | Last action: Qualified lead 2 min ago              |  |
|  |                                                    |  |
|  | [Chat] [Settings] [Pause] [View Logs]             |  |
|  +----------------------------------------------------+  |
|                                                           |
|  +----------------------------------------------------+  |
|  | Dev Agent                                [Active]   |  |
|  | Model: Claude-3 | Mode: Hybrid | Tasks: 1 queued  |  |
|  | Last action: Reviewed PR 1 hour ago                |  |
|  |                                                    |  |
|  | [Chat] [Settings] [Pause] [View Logs]             |  |
|  +----------------------------------------------------+  |
|                                                           |
+----------------------------------------------------------+
```

### Workflows Page

```
+----------------------------------------------------------+
|  Workflows                                     [+ Create] |
+----------------------------------------------------------+
|                                                           |
|  Active Workflows (5)                                     |
|  ---------------------                                     |
|                                                           |
|  Lead Qualification        [Running] [Edit] [Pause]       |
|  Daily Report              [Scheduled] [Edit] [Pause]     |
|  GitHub Issue Sync         [Running] [Edit] [Pause]       |
|  Slack Notifications       [Running] [Edit] [Pause]       |
|  Weekly Summary            [Scheduled] [Edit] [Pause]     |
|                                                           |
|  [Create with AI]  [Browse Templates]  [Import]           |
|                                                           |
+----------------------------------------------------------+
```

### Settings Page

```
+----------------------------------------------------------+
|  Settings                                                 |
+----------------------------------------------------------+
|                                                           |
|  [Profile] [Connections] [AI Keys] [Notifications] [Team] |
|                                                           |
|  Connections                                              |
|  ----------                                               |
|  Manage your connected services. All agents use these.    |
|                                                           |
|  +-----------------+  +-----------------+                 |
|  | Basecamp        |  | Slack           |                 |
|  | Connected       |  | Connected       |                 |
|  | [Manage]        |  | [Manage]        |                 |
|  +-----------------+  +-----------------+                 |
|                                                           |
|  +-----------------+  +-----------------+                 |
|  | GitHub          |  | Email           |                 |
|  | Connected       |  | Connected       |                 |
|  | [Manage]        |  | [Manage]        |                 |
|  +-----------------+  +-----------------+                 |
|                                                           |
|  [+ Add Connection]                                       |
|                                                           |
+----------------------------------------------------------+
```

---

## Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| Agent CRUD | COMPLETE | Create, update, delete agents |
| Workspace Isolation | COMPLETE | Per-user agents |
| Agent Files | COMPLETE | Memory, identity, soul |
| Autonomous Mode | PENDING | Background execution |
| Scheduler Integration | PENDING | Cron-based triggers |
| Notification System | PENDING | Push, email, Slack |
| Connection Sharing | PENDING | Workspace-level connections |
| Agent Templates | PENDING | Pre-built configurations |
| Natural Language UI | PENDING | Chat-centric interface |

---

## Next Steps

1. **Autonomous Mode Implementation**
   - Add scheduler to agent config
   - Implement background execution
   - Create notification system

2. **Connection Management**
   - Workspace-level credential storage
   - Per-service connection UI
   - Agent access to connections

3. **UI Redesign**
   - Natural language input everywhere
   - Minimal, clean interface
   - Mobile-first design

4. **Agent Templates**
   - Pre-built autonomous agents
   - One-click deployment
   - Customizable settings

---

## Related Documentation

- [AGENT_MANAGEMENT.md](AGENT_MANAGEMENT.md) - Agent configuration
- [PRODUCT_VISION.md](PRODUCT_VISION.md) - User journey
- [NEXT_STEPS.md](NEXT_STEPS.md) - Implementation plan
- [N8N_INTEGRATION_GUIDE.md](N8N_INTEGRATION_GUIDE.md) - Workflow engine