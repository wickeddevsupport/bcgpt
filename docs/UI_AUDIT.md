# PMOS UI Audit - Broken & Dumb Things

**Date:** 2026-02-19
**Status:** Documenting issues before fixes

---

## 🔴 CRITICAL - Non-Functional UI Elements

### 1. Dashboard NL Input Bar (Line 227)
**Location:** `openclaw/ui/src/ui/views/dashboard.ts`

**What it is:** 
A text input at the top of dashboard with placeholder "Ask your AI team to do something..." and an "Ask" button.

**What it should do:**
- Send the message to the active agent
- Use the AI to process the request
- Show response or execute action

**What it actually does:**
```html
<input type="text" placeholder="Ask your AI team to do something..." />
<button class="btn primary">Ask</button>
```
**NO EVENT HANDLERS.** The input and button have no `@input`, no `@click`, nothing wired. It's completely decorative.

---

### 2. Dashboard Quick Action Buttons (Line 230-233)
**Location:** `openclaw/ui/src/ui/views/dashboard.ts`

**What they are:**
Four buttons: "Check leads", "Daily report", "Create workflow", "Settings"

**What they should do:**
- "Check leads" → Query lead data from connected CRM
- "Daily report" → Generate/send daily summary
- "Create workflow" → Navigate to Automations with new flow modal
- "Settings" → Navigate to Settings tab

**What they actually do:**
```html
<button class="btn btn--secondary">Check leads</button>
<button class="btn btn--secondary">Daily report</button>
<button class="btn btn--secondary">Create workflow</button>
<button class="btn btn--secondary">Settings</button>
```
**NO EVENT HANDLERS.** All four buttons are dead. Pure decoration.

---

## 🟡 CONFUSING / DUMB UI DESIGN

### 3. Dashboard "Portfolio Pulse" Section
**What it shows:** Flows count, Recent Runs count, Pulse status

**Problem:** 
- "Pulse" label is vague - what does "Healthy" mean?
- No way to drill into what's actually happening
- The run status buckets are useful but buried

---

### 4. Dashboard "Focus Today" Section
**What it shows:** Suggested actions based on system state

**Problems:**
- Generic suggestions that don't use AI
- "Ask Wicked OS to execute" is just a link to chat
- Doesn't prioritize based on actual urgency

---

### 5. Dashboard "Your AI Team" Section
**Problems:**
- Shows status chips but "idle" is meaningless
- "tasks" count always 0 - doesn't track anything real
- "Chat" and "Settings" buttons but no "View Logs" or "Pause"

---

### 6. Automations "Templates" Section
**Location:** `openclaw/ui/src/ui/views/automations.ts`

**What it does:**
Clicking a template just copies the name to the "Flow name" input.

**Problems:**
- Templates are fake - they don't create actual workflow skeletons
- No preview of what the template would create
- User still has to manually build everything

---

### 7. Automations "AI Flow Builder" (Preview)
**What it claims:**
"Describe your automation in plain English — Wicked OS generates a workflow graph"

**Problems:**
- Labeled "Preview" - honest but underwhelming
- Generates nodes/edges display but unclear if they map to real n8n nodes
- "Commit draft flow" creates a shell, not a working workflow
- User must finish in n8n editor anyway

---

### 8. Chat "Automate" Button
**Location:** `openclaw/ui/src/ui/views/chat.ts` line 518

**What it is:**
Button next to "Send" that says "Automate"

**What it should do:**
- Take the draft message
- Generate an n8n workflow from it
- Open in Automations tab

**Status:** NEEDS VERIFICATION - backend may work, UI unclear

---

### 9. Onboarding Wizard
**Location:** `openclaw/ui/src/ui/views/onboarding.ts`

**Step 1 - Connect Your Tools:**
- Shows Basecamp, Slack, GitHub, Email
- Connect buttons exist but most services aren't actually wireable
- "Connected" status is fake for most

**Step 2 - Choose Your Agents:**
- Agent templates (Personal, Sales, PM, Dev, Support)
- Checkboxes don't actually create agents
- Just a visual mockup

**Step 3 - Add AI Keys:**
- BYOK form that works
- But doesn't explain which models need which keys

**Problems:**
- Steps 1 and 2 are theater - they don't actually configure anything
- User completes onboarding but nothing is set up

---

### 10. Connections Page
**Location:** `openclaw/ui/src/ui/views/connections.ts`

**Problems:**
- Lists 10 services (Basecamp, Slack, GitHub, Email, Google, Notion, Linear, Jira, Salesforce, HubSpot)
- Only Basecamp and GitHub have any backend support
- Others show "Connect" button but clicking does nothing useful
- "Custom API" option - no implementation

---

### 11. Integrations Page
**Location:** `openclaw/ui/src/ui/views/integrations.ts`

**Problems:**
- Duplicates some of Connections functionality
- "BCGPT URL" and "API Key" - what normal user knows this?
- Technical config exposed to end users
- No explanation of what BCGPT is

---

## 🟠 ARCHITECTURAL ISSUES

### 12. Dashboard vs Chat Duplication
**Problem:**
- Dashboard has "Ask your AI team" input (broken)
- Chat tab has message input (works)
- They do the same thing but one works, one doesn't

---

### 13. Sessions vs Agents Confusion
**Problem:**
- Chat dropdown shows "sessions" (active conversations)
- Users expect to see "agents" (configured assistants)
- Session key format `agent:personal-assistant:main` is technical
- No clear mapping of "I want to talk to Coder" → select from dropdown

---

### 14. Workflow Panel in Dashboard
**Problem:**
- Shows count of flows and runs
- No preview of what workflows DO
- No quick actions (run, pause, edit)
- Just numbers, no context

---

## 📋 SUMMARY

| Component | Status | Priority |
|-----------|--------|----------|
| Dashboard NL Input | 🔴 Broken (no handlers) | P0 |
| Quick Action Buttons | 🔴 Broken (no handlers) | P0 |
| Onboarding Steps 1&2 | 🔴 Theater (does nothing) | P1 |
| Connections Page | 🔴 Dead buttons | P1 |
| Portfolio Pulse | 🟡 Vague | P2 |
| Focus Today | 🟡 Generic | P2 |
| AI Team Section | 🟡 Weak data | P2 |
| Workflow Templates | 🟡 Fake | P2 |
| AI Flow Builder | 🟡 Incomplete | P3 |
| Chat Automate | 🟡 Needs check | P2 |
| Integrations | 🟡 Too technical | P3 |
| Dashboard/Chat Dup | 🟠 Architecture | P3 |
| Sessions vs Agents | 🟠 UX confusion | P2 |
| Workflow Panel | 🟡 Weak | P2 |

---

## QUESTIONS FOR RAJAN

1. **Dashboard NL Input** - Should this just navigate to Chat tab? Or be a full chat interface?

2. **Quick Actions** - What should "Check leads" and "Daily report" actually do? Do we have lead/report data sources?

3. **Onboarding** - Keep it simple (just BYOK) or actually implement tool connections?

4. **Templates** - Should we pre-build real n8n workflow templates or remove the feature?

5. **AI Flow Builder** - Keep "Preview" label or hide until it actually generates working flows?

6. **Sessions vs Agents** - Show agents by name in dropdown? How to handle multiple conversations per agent?
