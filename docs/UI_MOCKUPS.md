# UI Mockups - Complete Interface Guide

**Last Updated:** 2026-02-17
**Related:** [AUTONOMOUS_AGENTS.md](AUTONOMOUS_AGENTS.md), [WORKSPACE_ISOLATION_STATUS.md](WORKSPACE_ISOLATION_STATUS.md)

---

## Overview

This document contains all UI mockups for OpenClaw, covering both workspace_admin (regular user) and super_admin views. Each mockup includes the purpose, user flow, and key interactions.

---

## Page Index

| Page | workspace_admin | super_admin | Status |
|------|-----------------|-------------|--------|
| Login/Signup | Yes | Yes | Mocked |
| Dashboard | Yes | Yes | Mocked |
| Agents | Yes | Yes | Mocked |
| Agent Detail | Yes | Yes | Mocked |
| Agent Chat | Yes | Yes | Mocked |
| Workflows | Yes | Yes | Mocked |
| Workflow Builder | Yes | Yes | Mocked |
| Connections | Yes | Yes | Mocked |
| Settings | Yes | Yes | Mocked |
| Notifications | Yes | Yes | Mocked |
| Admin Dashboard | No | Yes | Mocked |
| Admin Users | No | Yes | Mocked |
| Admin Workspaces | No | Yes | Mocked |
| Admin System | No | Yes | Mocked |

---

## 1. Login Page

```
+----------------------------------------------------------+
|                                                           |
|                    [OpenClaw Logo]                        |
|                                                           |
|              Your AI Team That Works For You              |
|                                                           |
|  +----------------------------------------------------+  |
|  |  Email: [________________________]                 |  |
|  |  Password: [________________________]              |  |
|  |                                                    |  |
|  |  [Login]                                          |  |
|  |                                                    |  |
|  |  Don't have an account? [Sign Up]                 |  |
|  +----------------------------------------------------+  |
|                                                           |
|  Or continue with:                                        |
|  [Google] [GitHub] [Microsoft]                            |
|                                                           |
+----------------------------------------------------------+
```

**User Flow:**
1. User enters email/password
2. System validates credentials
3. First user becomes super_admin
4. Subsequent users become workspace_admin
5. Redirect to Dashboard

---

## 2. Signup Page

```
+----------------------------------------------------------+
|                                                           |
|                    [OpenClaw Logo]                        |
|                                                           |
|                 Create Your AI Team                       |
|                                                           |
|  +----------------------------------------------------+  |
|  |  Name: [________________________]                  |  |
|  |  Email: [________________________]                 |  |
|  |  Password: [________________________]              |  |
|  |  Confirm Password: [________________________]      |  |
|  |                                                    |  |
|  |  Workspace Name: [________________________]       |  |
|  |  (e.g., "Acme Corp" or "Personal")                 |  |
|  |                                                    |  |
|  |  [Create Account]                                 |  |
|  |                                                    |  |
|  |  Already have an account? [Login]                 |  |
|  +----------------------------------------------------+  |
|                                                           |
+----------------------------------------------------------+
```

**User Flow:**
1. User fills in details
2. System creates workspace
3. System assigns role (first = super_admin, others = workspace_admin)
4. Redirect to Onboarding

---

## 3. Onboarding Wizard

```
+----------------------------------------------------------+
|  Welcome to OpenClaw!                              [1/3]  |
+----------------------------------------------------------+
|                                                           |
|  Step 1: Connect Your Tools                               |
|  ------------------------------                           |
|                                                           |
|  Connect the services your AI team will use:              |
|                                                           |
|  +-----------------+  +-----------------+                 |
|  | [+] Basecamp    |  | [+] Slack       |                 |
|  | Not connected   |  | Not connected   |                 |
|  +-----------------+  +-----------------+                 |
|                                                           |
|  +-----------------+  +-----------------+                 |
|  | [+] GitHub      |  | [+] Email       |                 |
|  | Not connected   |  | Not connected   |                 |
|  +-----------------+  +-----------------+                 |
|                                                           |
|  [Skip for Now]                        [Next Step]         |
|                                                           |
+----------------------------------------------------------+
```

```
+----------------------------------------------------------+
|  Set Up Your AI Team                               [2/3]  |
+----------------------------------------------------------+
|                                                           |
|  Step 2: Choose Your Agents                               |
|  ------------------------------                           |
|                                                           |
|  Select pre-built agents to get started:                  |
|                                                           |
|  [x] Personal Agent - General assistant                   |
|  [ ] Sales Agent - Lead monitoring & CRM                  |
|  [ ] Project Manager - Deadlines & reports                |
|  [ ] Developer Agent - Code & GitHub                      |
|  [ ] Support Agent - Tickets & responses                  |
|                                                           |
|  Or create a custom agent later.                          |
|                                                           |
|  [Back]                               [Next Step]          |
|                                                           |
+----------------------------------------------------------+
```

```
+----------------------------------------------------------+
|  Add Your AI Keys                                  [3/3]  |
+----------------------------------------------------------+
|                                                           |
|  Step 3: Bring Your Own Keys (BYOK)                       |
|  ------------------------------                           |
|                                                           |
|  Your agents need AI to work. Add your API keys:          |
|                                                           |
|  OpenAI API Key:                                          |
|  [________________________________________]               |
|  [Test Key]                                               |
|                                                           |
|  Anthropic API Key:                                       |
|  [________________________________________]               |
|  [Test Key]                                               |
|                                                           |
|  Keys are encrypted and never shared.                     |
|                                                           |
|  [Skip for Now]                        [Complete Setup]    |
|                                                           |
+----------------------------------------------------------+
```

---

## 4. Dashboard (workspace_admin)

```
+----------------------------------------------------------+
|  [Menu] OpenClaw                    [?] [Notification] [Profile] |
+----------------------------------------------------------+
|                                                           |
|  Good morning, John!                                      |
|                                                           |
|  [What would you like to do today?              ] [Ask]   |
|                                                           |
|  Quick Actions:                                           |
|  [Check leads] [Daily report] [Create workflow] [Settings]|
|                                                           |
+----------------------------------------------------------+
|  Your AI Team                           Status: 4 Active  |
|  ---------------------                                    |
|                                                           |
|  +---------+  +---------+  +---------+  +---------+       |
|  | Sales   |  | Dev     |  | PM      |  | Support |       |
|  | Agent   |  | Agent   |  | Agent   |  | Agent   |       |
|  | ------- |  | ------- |  | ------- |  | ------- |       |
|  | 3 tasks |  | 1 task  |  | 2 tasks |  | 5 tasks |       |
|  | running |  | running |  | running |  | queued  |       |
|  |         |  |         |  |         |  |         |       |
|  | [Chat]  |  | [Chat]  |  | [Chat]  |  | [Chat]  |       |
|  +---------+  +---------+  +---------+  +---------+       |
|                                                           |
+----------------------------------------------------------+
|  Recent Activity                                          |
|  ----------------                                         |
|  - Sales Agent qualified 3 leads (2 min ago)              |
|  - Dev Agent detected critical bug (1h ago)               |
|  - PM Agent sent weekly report (yesterday)                |
|                                                           |
|  [View All Activity]                                      |
|                                                           |
+----------------------------------------------------------+
```

**Sidebar:**
```
+------------------+
| Dashboard        |
| Agents           |
| Workflows        |
| Connections      |
| Settings         |
| ---------------- |
| Help & Support   |
| Logout           |
+------------------+
```

---

## 5. Dashboard (super_admin)

```
+----------------------------------------------------------+
|  [Menu] OpenClaw Admin              [?] [Notification] [Profile] |
+----------------------------------------------------------+
|                                                           |
|  Admin Dashboard                            [Admin Mode]  |
|                                                           |
|  Workspace Overview                                       |
|  -----------------                                        |
|                                                           |
|  +--------+  +--------+  +--------+  +--------+           |
|  | 12     |  | 45     |  | 89     |  | 234    |           |
|  | Worksp |  | Users  |  | Agents |  | Workfl |           |
|  +--------+  +--------+  +--------+  +--------+           |
|                                                           |
+----------------------------------------------------------+
|  Recent Workspaces                                        |
|  -----------------                                        |
|                                                           |
|  +----------------------------------------------------+  |
|  | Acme Corp (5 users, 12 agents)    [View] [Manage] |  |
|  +----------------------------------------------------+  |
|  | TechStart (3 users, 8 agents)     [View] [Manage] |  |
|  +----------------------------------------------------+  |
|  | DesignLab (2 users, 5 agents)     [View] [Manage] |  |
|  +----------------------------------------------------+  |
|                                                           |
|  [View All Workspaces]                                    |
|                                                           |
+----------------------------------------------------------+
|  System Health                                            |
|  --------------                                           |
|                                                           |
|  API Response: 45ms      n8n Queue: 12 pending            |
|  Memory: 62% used        CPU: 34% used                    |
|                                                           |
|  [View System Logs]  [System Settings]                    |
|                                                           |
+----------------------------------------------------------+
```

**Sidebar (super_admin):**
```
+------------------+
| Admin Dashboard  |
| All Workspaces   |
| All Users        |
| All Agents       |
| All Workflows    |
| System Settings  |
| Audit Logs       |
| ---------------- |
| Switch to User   |
| Help & Support   |
| Logout           |
+------------------+
```

---

## 6. Agents Page (workspace_admin)

```
+----------------------------------------------------------+
|  Agents                                          [+ New]  |
+----------------------------------------------------------+
|                                                           |
|  Filter: [All v]  Mode: [All v]  Sort: [Activity v]       |
|                                                           |
|  +----------------------------------------------------+  |
|  | Sales Agent                              [Active]   |  |
|  | --------------------------------------------------- |  |
|  | Model: GPT-4 | Mode: Autonomous                     |  |
|  | Tasks: 3 running | Last: 2 min ago                  |  |
|  |                                                    |  |
|  | Autonomous Tasks:                                  |  |
|  | - Check leads every 30 min                        |  |
|  | - Notify on hot leads                             |  |
|  |                                                    |  |
|  | [Chat] [Settings] [Pause] [View Logs]             |  |
|  +----------------------------------------------------+  |
|                                                           |
|  +----------------------------------------------------+  |
|  | Dev Agent                                [Active]   |  |
|  | --------------------------------------------------- |  |
|  | Model: Claude-3 | Mode: Hybrid                     |  |
|  | Tasks: 1 queued | Last: 1 hour ago                |  |
|  |                                                    |  |
|  | [Chat] [Settings] [Pause] [View Logs]             |  |
|  +----------------------------------------------------+  |
|                                                           |
|  [+ Create Agent]  [Browse Templates]                     |
|                                                           |
+----------------------------------------------------------+
```

---

## 7. Create Agent Modal

```
+----------------------------------------------------------+
|  Create New Agent                                   [X]   |
+----------------------------------------------------------+
|                                                           |
|  Name: [________________________]                        |
|        (e.g., "Sales Agent")                              |
|                                                           |
|  Purpose: [________________________]                      |
|           (e.g., "Handle lead qualification")             |
|                                                           |
|  Mode: [Autonomous v]                                     |
|        (Autonomous, Interactive, Hybrid)                   |
|                                                           |
|  Model: [GPT-4 v]                                         |
|         (Uses your connected AI keys)                      |
|                                                           |
|  Skills:                                                  |
|  [x] Basecamp      [ ] GitHub       [x] Email             |
|  [x] Slack         [ ] Terminal     [ ] Reports           |
|  [ ] Calendar      [ ] Knowledge    [ ] All Access        |
|                                                           |
|  Personality: [Professional v]                             |
|               (Professional, Friendly, Technical, Custom)  |
|                                                           |
|  Autonomous Tasks (if Autonomous mode):                   |
|  [x] Check for new leads                                  |
|  [x] Qualify leads automatically                          |
|  [x] Notify on hot leads                                  |
|  [ ] Auto-send follow-ups                                 |
|                                                           |
|  [Cancel]                        [Create Agent]            |
|                                                           |
+----------------------------------------------------------+
```

---

## 8. Agent Chat Interface

```
+----------------------------------------------------------+
|  Sales Agent                                    [Settings] |
+----------------------------------------------------------+
|                                                           |
|  Chat History:                                            |
|  ----------------                                         |
|  User: Check the latest leads                             |
|                                                           |
|  Sales Agent: I found 3 new leads:                        |
|  1. Acme Corp - Score: 85 (Hot!)                          |
|  2. TechStart - Score: 72                                 |
|  3. DesignLab - Score: 65                                 |
|                                                           |
|  Would you like me to qualify them further?                |
|                                                           |
|  User: Yes, qualify Acme Corp                             |
|                                                           |
|  Sales Agent: Qualifying Acme Corp...                     |
|  - Company size: 50-100 employees                         |
|  - Industry: Technology                                   |
|  - Budget: $50k+                                          |
|  - Timeline: Q2 2026                                      |
|                                                           |
|  Recommendation: High priority. Contact immediately.      |
|                                                           |
|  [Create Workflow] [Add to CRM] [Send Email]              |
|                                                           |
+----------------------------------------------------------+
|                                                           |
|  [Type your message...                    ] [Send]        |
|                                                           |
+----------------------------------------------------------+
```

---

## 9. Workflows Page

```
+----------------------------------------------------------+
|  Workflows                                     [+ Create]  |
+----------------------------------------------------------+
|                                                           |
|  Filter: [All v]  Status: [All v]  Sort: [Recent v]       |
|                                                           |
|  Active Workflows (5)                                     |
|  ---------------------                                     |
|                                                           |
|  +----------------------------------------------------+  |
|  | Lead Qualification        [Running] [Edit] [Pause]|  |
|  | Trigger: Webhook (Basecamp)                       |  |
|  | Last run: 2 min ago | Success rate: 98%          |  |
|  | [View Details] [View Logs]                        |  |
|  +----------------------------------------------------+  |
|                                                           |
|  +----------------------------------------------------+  |
|  | Daily Report              [Scheduled] [Edit] [Pause]| |
|  | Trigger: Schedule (9:00 AM daily)                 |  |
|  | Next run: Tomorrow 9:00 AM                        |  |
|  | [View Details] [View Logs]                        |  |
|  +----------------------------------------------------+  |
|                                                           |
|  Paused Workflows (2)                                      |
|  -------------------                                       |
|  - Weekly Summary (Paused 2 days ago)                     |
|  - GitHub Sync (Paused 1 week ago)                        |
|                                                           |
|  [Create with AI]  [Browse Templates]  [Import]           |
|                                                           |
+----------------------------------------------------------+
```

---

## 10. Workflow Builder (n8n Canvas Embedded)

```
+----------------------------------------------------------+
|  Workflow: Lead Qualification                    [Save]    |
+----------------------------------------------------------+
|                                        |                   |
|  Canvas Area               |  Chat Sidebar     |
|                                        |                   |
|  +--------+    +--------+    +--------+  |  User: Create a   |
|  | Webhook|---| AI     |---| Filter |  |  lead workflow    |
|  | Trigger|    | Score  |    | > 70   |  |                   |
|  +--------+    +--------+    +--------+  |  AI: I've added   |
|       |                            |       |  the nodes...    |
|       v                            v       |                   |
|  +--------+                  +--------+  |  [Add Slack]      |
|  | Log    |                  | Slack  |  |  [Add Email]      |
|  +--------+                  | Alert  |  |  [Test Flow]      |
|                              +--------+  |                   |
|                                        |                   |
|  [Add Node] [+ AI Add]                 |                   |
|                                        |                   |
+----------------------------------------------------------+
|  Node Settings: [Webhook Trigger]                        |
|  - URL: https://openclaw.io/webhook/abc123               |
|  - Method: POST                                           |
|  - Authentication: None                                   |
|                                                           |
+----------------------------------------------------------+
```

---

## 11. Connections Page

```
+----------------------------------------------------------+
|  Connections                                     [+ Add]   |
+----------------------------------------------------------+
|                                                           |
|  Connected Services                                       |
|  -----------------                                        |
|                                                           |
|  Your agents use these connections. Connect once, use     |
|  everywhere.                                              |
|                                                           |
|  +-----------------+  +-----------------+                 |
|  | Basecamp        |  | Slack           |                 |
|  | Account: acme   |  | Workspace: dev  |                 |
|  | Connected       |  | Connected       |                 |
|  | [Edit] [Remove] |  | [Edit] [Remove] |                 |
|  +-----------------+  +-----------------+                 |
|                                                           |
|  +-----------------+  +-----------------+                 |
|  | GitHub          |  | Email (SMTP)   |                 |
|  | Org: acme-inc   |  | user@acme.com  |                 |
|  | Connected       |  | Connected       |                 |
|  | [Edit] [Remove] |  | [Edit] [Remove] |                 |
|  +-----------------+  +-----------------+                 |
|                                                           |
|  Available Services:                                      |
|  [+] Google Workspace  [+] Microsoft 365  [+] Jira        |
|  [+] Notion           [+] Linear        [+] Asana         |
|  [+] Salesforce       [+] HubSpot       [+] Custom API    |
|                                                           |
+----------------------------------------------------------+
```

---

## 12. Add Connection Modal

```
+----------------------------------------------------------+
|  Connect Basecamp                                  [X]    |
+----------------------------------------------------------+
|                                                           |
|  Basecamp Project Management                              |
|                                                           |
|  Step 1: Authorize Access                                 |
|  [Connect with Basecamp]                                  |
|                                                           |
|  This will open Basecamp to authorize OpenClaw.           |
|                                                           |
|  What you're allowing:                                    |
|  - Read your projects and todos                           |
|  - Create and update items                                |
|  - Read messages and comments                             |
|                                                           |
|  [Cancel]                                                 |
|                                                           |
+----------------------------------------------------------+
```

---

## 13. Settings Page (workspace_admin)

```
+----------------------------------------------------------+
|  Settings                                                 |
+----------------------------------------------------------+
|                                                           |
|  [Profile] [AI Keys] [Notifications] [Workspace]          |
|                                                           |
|  Profile Settings                                         |
|  ----------------                                         |
|                                                           |
|  Name: [John Doe_________________]                        |
|  Email: [john@acme.com__________]                         |
|                                                           |
|  Password: [Change Password]                              |
|                                                           |
|  [Save Changes]                                           |
|                                                           |
+----------------------------------------------------------+
```

**AI Keys Tab:**
```
+----------------------------------------------------------+
|  Settings                                                 |
+----------------------------------------------------------+
|                                                           |
|  [Profile] [AI Keys] [Notifications] [Workspace]          |
|                                                           |
|  AI Provider Keys (BYOK)                                  |
|  -------------------------                                |
|                                                           |
|  Your keys are encrypted and never shared.                |
|                                                           |
|  OpenAI:                                                  |
|  Key: [sk-...abc123_______________] [Test] [Remove]       |
|  Status: Valid | Usage: 45,000 tokens this month          |
|                                                           |
|  Anthropic:                                               |
|  Key: [sk-ant-...xyz789__________] [Test] [Remove]       |
|  Status: Valid | Usage: 12,000 tokens this month          |
|                                                           |
|  [+ Add Provider]                                         |
|                                                           |
+----------------------------------------------------------+
```

---

## 14. Notifications Page

```
+----------------------------------------------------------+
|  Notifications                              [Mark All Read] |
+----------------------------------------------------------+
|                                                           |
|  Today                                                    |
|  -----                                                    |
|                                                           |
|  [!] Sales Agent: Hot lead detected - Acme Corp (score 85) |
|      10 minutes ago                                       |
|      [View Lead] [Dismiss]                                |
|                                                           |
|  [i] Dev Agent: PR #142 approved by 2 reviewers           |
|      1 hour ago                                           |
|      [View PR] [Dismiss]                                  |
|                                                           |
|  [i] PM Agent: 3 tasks overdue this week                  |
|      2 hours ago                                          |
|      [View Tasks] [Dismiss]                               |
|                                                           |
|  Yesterday                                                |
|  --------                                                 |
|                                                           |
|  [i] Sales Agent: Daily summary - 5 new leads             |
|      Yesterday 9:00 AM                                    |
|      [View Summary]                                       |
|                                                           |
|  [i] System: Weekly report generated                      |
|      Yesterday 5:00 PM                                    |
|      [View Report]                                        |
|                                                           |
+----------------------------------------------------------+
```

---

## 15. Admin Users Page (super_admin only)

```
+----------------------------------------------------------+
|  Admin - Users                                   [+ Add]   |
+----------------------------------------------------------+
|                                                           |
|  Filter: [All v]  Role: [All v]  Workspace: [All v]       |
|                                                           |
|  +----------------------------------------------------+  |
|  | John Doe (john@acme.com)                          |  |
|  | Role: super_admin | Workspace: All                |  |
|  | Agents: 0 | Workflows: 0 | Status: Active         |  |
|  | [View] [Edit] [Impersonate] [Suspend]             |  |
|  +----------------------------------------------------+  |
|                                                           |
|  +----------------------------------------------------+  |
|  | Jane Smith (jane@techstart.com)                   |  |
|  | Role: workspace_admin | Workspace: TechStart      |  |
|  | Agents: 8 | Workflows: 12 | Status: Active        |  |
|  | [View] [Edit] [Impersonate] [Suspend]             |  |
|  +----------------------------------------------------+  |
|                                                           |
|  +----------------------------------------------------+  |
|  | Bob Wilson (bob@designlab.com)                    |  |
|  | Role: workspace_admin | Workspace: DesignLab      |  |
|  | Agents: 5 | Workflows: 8 | Status: Suspended      |  |
|  | [View] [Edit] [Impersonate] [Reactivate]          |  |
|  +----------------------------------------------------+  |
|                                                           |
+----------------------------------------------------------+
```

---

## 16. Admin Workspaces Page (super_admin only)

```
+----------------------------------------------------------+
|  Admin - Workspaces                       [+ Create New]  |
+----------------------------------------------------------+
|                                                           |
|  Filter: [All v]  Status: [All v]  Sort: [Name v]         |
|                                                           |
|  +----------------------------------------------------+  |
|  | Acme Corp                                         |  |
|  | Users: 5 | Agents: 12 | Workflows: 23            |  |
|  | Created: Jan 15, 2026 | Status: Active            |  |
|  | [View] [Edit] [Manage Users] [Suspend] [Delete]   |  |
|  +----------------------------------------------------+  |
|                                                           |
|  +----------------------------------------------------+  |
|  | TechStart                                         |  |
|  | Users: 3 | Agents: 8 | Workflows: 12             |  |
|  | Created: Jan 20, 2026 | Status: Active            |  |
|  | [View] [Edit] [Manage Users] [Suspend] [Delete]   |  |
|  +----------------------------------------------------+  |
|                                                           |
|  +----------------------------------------------------+  |
|  | DesignLab                                         |  |
|  | Users: 2 | Agents: 5 | Workflows: 8              |  |
|  | Created: Feb 1, 2026 | Status: Suspended          |  |
|  | [View] [Edit] [Manage Users] [Reactivate] [Delete]|  |
|  +----------------------------------------------------+  |
|                                                           |
+----------------------------------------------------------+
```

---

## 17. Admin System Settings (super_admin only)

```
+----------------------------------------------------------+
|  Admin - System Settings                                  |
+----------------------------------------------------------+
|                                                           |
|  [General] [Security] [Email] [n8n] [Logs]                |
|                                                           |
|  General Settings                                         |
|  ----------------                                         |
|                                                           |
|  App Name: [OpenClaw______________]                       |
|  App URL: [https://os.wickedlab.io]                       |
|                                                           |
|  Default AI Model: [GPT-4 v]                              |
|  Default Agent Mode: [Hybrid v]                           |
|                                                           |
|  Rate Limiting:                                           |
|  Requests per minute: [60___]                             |
|  Tokens per day: [100000_]                                |
|                                                           |
|  [Save Changes]                                           |
|                                                           |
+----------------------------------------------------------+
```

**n8n Tab:**
```
+----------------------------------------------------------+
|  Admin - System Settings                                  |
+----------------------------------------------------------+
|                                                           |
|  [General] [Security] [Email] [n8n] [Logs]                |
|                                                           |
|  n8n Configuration                                        |
|  -----------------                                        |
|                                                           |
|  n8n Status: [Running]                                    |
|  Version: 1.50.0                                          |
|                                                           |
|  Webhook URL: [https://os.wickedlab.io/n8n/webhook]       |
|  API URL: [https://os.wickedlab.io/n8n/api]               |
|                                                           |
|  Queue Status:                                            |
|  - Active executions: 5                                   |
|  - Pending executions: 12                                 |
|  - Failed (last 24h): 2                                   |
|                                                           |
|  [Restart n8n]  [View n8n Dashboard]  [Clear Queue]        |
|                                                           |
+----------------------------------------------------------+
```

---

## 18. Mobile Views

### Mobile Dashboard

```
+----------------------+
|  [Menu] OpenClaw     |
+----------------------+
|                      |
|  Good morning, John! |
|                      |
|  [What can I help?]  |
|                      |
+----------------------+
|  Your AI Team        |
|  ----------------    |
|                      |
|  +----------------+ |
|  | Sales Agent    | |
|  | 3 tasks active | |
|  | [Chat] [View]  | |
|  +----------------+ |
|                      |
|  +----------------+ |
|  | Dev Agent      | |
|  | 1 task queued  | |
|  | [Chat] [View]  | |
|  +----------------+ |
|                      |
+----------------------+
|  [Dashboard]        |
|  [Agents]           |
|  [Workflows]        |
|  [Settings]         |
+----------------------+
```

### Mobile Chat

```
+----------------------+
|  [Back] Sales Agent  |
+----------------------+
|                      |
|  User:               |
|  Check latest leads  |
|                      |
|  Sales Agent:        |
|  Found 3 new leads:  |
|  1. Acme - 85        |
|  2. TechStart - 72   |
|  3. DesignLab - 65   |
|                      |
|  [Create Workflow]   |
|                      |
+----------------------+
|  [Type message...]   |
|  [Send]              |
+----------------------+
```

---

## Missing UI Elements Checklist

### OpenClaw Core

- [x] Login/Signup
- [x] Onboarding Wizard
- [x] Dashboard (workspace_admin)
- [x] Dashboard (super_admin)
- [x] Agents List
- [x] Create Agent
- [x] Agent Chat
- [x] Workflows List
- [x] Workflow Builder
- [x] Connections
- [x] Settings
- [x] Notifications
- [x] Admin Users
- [x] Admin Workspaces
- [x] Admin System Settings
- [x] Mobile Views

### n8n Integration

- [x] Workflow Canvas (embedded)
- [x] Node Configuration Panel
- [x] Execution Logs
- [ ] Workflow Templates Gallery
- [ ] Node Search/Discovery
- [ ] Credential Management (per-service)
- [ ] Execution History Detail View

### Additional Pages Needed

| Page | Description | Priority |
|------|-------------|----------|
| Workflow Templates | Pre-built workflow gallery | High |
| Execution History | Detailed execution logs | High |
| Agent Memory View | View/edit agent memory files | Medium |
| Audit Logs (super_admin) | Security audit trail | Medium |
| Billing/Usage | Token usage, costs | Low |
| Team Invites | Invite users to workspace | Low |

---

## Implementation Priority

1. **Phase 1: Core UI**
   - Login/Signup
   - Dashboard
   - Agents (list, create, chat)
   - Settings

2. **Phase 2: Workflow UI**
   - Workflows list
   - Workflow builder (n8n canvas)
   - Execution history

3. **Phase 3: Admin UI**
   - Admin dashboard
   - User management
   - Workspace management

4. **Phase 4: Polish**
   - Mobile optimization
   - Templates gallery
   - Advanced settings

---

## Related Documentation

- [AUTONOMOUS_AGENTS.md](AUTONOMOUS_AGENTS.md) - Agent behavior
- [WORKSPACE_ISOLATION_STATUS.md](WORKSPACE_ISOLATION_STATUS.md) - Role differences
- [NEXT_STEPS.md](NEXT_STEPS.md) - Implementation plan