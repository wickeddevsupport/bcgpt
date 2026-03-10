# Agent Management Guide

**Last Updated:** 2026-02-17
**Related:** [`OPENCLAW_AUTOMATION_OS.md`](OPENCLAW_AUTOMATION_OS.md)

---

## Overview

Agents are specialized AI assistants that users create for different tasks. Each workspace can have multiple agents, each with its own configuration, memory, and skills.

---

## Agent Types

### Pre-Built Templates (Coming Soon)

| Template | Purpose | Default Skills |
|----------|---------|----------------|
| **Personal Agent** | General tasks, scheduling, reminders | All |
| **Sales Agent** | Lead qualification, CRM updates | Basecamp, Email, Slack |
| **Support Agent** | Ticket handling, responses | Email, Slack, Knowledge Base |
| **Dev Agent** | Code review, GitHub management | GitHub, Slack, Terminal |
| **PM Agent** | Project tracking, reports | Basecamp, GitHub, Reports |
| **Custom Agent** | User-defined purpose | User-selected |

### Agent Configuration

Each agent has:

```typescript
interface AgentConfig {
  id: string;                    // Unique identifier
  name: string;                  // Display name (e.g., "Sales Agent")
  workspaceId: string;           // Workspace isolation
  workspace: string;             // Agent directory path
  model: string;                 // AI model (e.g., "claude-3-opus")
  skills: string[];              // Allowed capabilities
  identity?: IdentityConfig;     // Personality, tone
  memory?: MemoryConfig;         // What to remember
}
```

---

## User Experience

### Agent Dashboard

```
+----------------------------------------------------------+
|  Your Agents                                    [+ Create] |
+----------------------------------------------------------+
|                                                           |
|  +------------------+  +------------------+               |
|  | Sales Agent      |  | Support Agent    |               |
|  | ---------------- |  | ---------------- |               |
|  | Model: GPT-4     |  | Model: Claude-3  |               |
|  | Status: Active   |  | Status: Active   |               |
|  | Sessions: 12     |  | Sessions: 8      |               |
|  | Last: 2h ago     |  | Last: 5h ago     |               |
|  |                  |  |                  |               |
|  | [Chat] [Edit]    |  | [Chat] [Edit]    |               |
|  +------------------+  +------------------+               |
|                                                           |
|  +------------------+  +------------------+               |
|  | Dev Agent        |  | PM Agent         |               |
|  | ---------------- |  | ---------------- |               |
|  | Model: Claude-3  |  | Model: GPT-4     |               |
|  | Status: Idle     |  | Status: Active   |               |
|  | Sessions: 3      |  | Sessions: 15     |               |
|  | Last: 1d ago     |  | Last: 30m ago    |               |
|  |                  |  |                  |               |
|  | [Chat] [Edit]    |  | [Chat] [Edit]    |               |
|  +------------------+  +------------------+               |
|                                                           |
+----------------------------------------------------------+
```

### Creating an Agent

```
+----------------------------------------------------------+
|  Create New Agent                                         |
+----------------------------------------------------------+
|                                                           |
|  Name: [________________________]                        |
|        (e.g., "Sales Agent")                              |
|                                                           |
|  Purpose: [________________________]                      |
|           (e.g., "Handle lead qualification")             |
|                                                           |
|  Model: [Select Model        v]                           |
|         - GPT-4 (OpenAI)                                  |
|         - Claude-3 Opus (Anthropic)                       |
|         - Claude-3 Sonnet (Anthropic)                     |
|                                                           |
|  Skills:                                                  |
|  [x] Basecamp      [ ] GitHub       [x] Email             |
|  [x] Slack         [ ] Terminal     [ ] Reports           |
|  [ ] Calendar      [ ] Knowledge    [ ] All Access        |
|                                                           |
|  Personality:                                             |
|  [Professional v] (Professional, Friendly, Technical)     |
|                                                           |
|  [Cancel]                        [Create Agent]            |
|                                                           |
+----------------------------------------------------------+
```

### Editing an Agent

```
+----------------------------------------------------------+
|  Edit: Sales Agent                                   [X]  |
+----------------------------------------------------------+
|                                                           |
|  Tabs: [Config] [Memory] [Identity] [Tools] [Sessions]   |
|                                                           |
|  Configuration:                                           |
|  - Name: Sales Agent                                      |
|  - Model: GPT-4                                           |
|  - Skills: Basecamp, Slack, Email                         |
|  - Max Tokens: 4096                                       |
|  - Temperature: 0.7                                       |
|                                                           |
|  Memory Files:                                            |
|  - identity.md (Edit)                                     |
|  - memory.md (Edit)                                       |
|  - soul.md (Edit)                                         |
|                                                           |
|  Recent Sessions:                                         |
|  - session-123 (2h ago) - Lead qualification             |
|  - session-122 (5h ago) - CRM update                      |
|  - session-121 (1d ago) - Email drafting                  |
|                                                           |
|  [Delete Agent]              [Save Changes]               |
|                                                           |
+----------------------------------------------------------+
```

---

## Agent Files Structure

Each agent has a dedicated workspace directory:

```
~/.openclaw/
  workspaces/
    {workspaceId}/
      agents/
        sales-agent/
          identity.md      # Personality, tone, style
          memory.md        # Long-term memory
          soul.md          # Core beliefs, values
          tools.md         # Custom tool definitions
          agents.json      # Agent config (model, skills)
          
        support-agent/
          identity.md
          memory.md
          soul.md
          tools.md
          agents.json
```

### File Purposes

| File | Purpose | User Can Edit |
|------|---------|---------------|
| `identity.md` | How the agent presents itself | Yes, via UI |
| `memory.md` | Facts the agent remembers | Yes, via UI |
| `soul.md` | Core beliefs and values | Yes, via UI |
| `tools.md` | Custom tool definitions | Advanced users |
| `agents.json` | Model, skills config | Via UI settings |

---

## API Methods

### List Agents

```typescript
// Request
{ method: "agents.list", params: {} }

// Response
{
  agents: [
    {
      id: "sales-agent",
      name: "Sales Agent",
      workspaceId: "ws-123",
      model: "gpt-4",
      skills: ["basecamp", "slack", "email"],
      status: "active",
      sessionCount: 12,
      lastActiveAt: "2026-02-17T09:00:00Z"
    },
    // ... more agents
  ]
}
```

### Create Agent

```typescript
// Request
{
  method: "agents.create",
  params: {
    name: "Dev Agent",
    model: "claude-3-opus",
    skills: ["github", "terminal", "slack"],
    identity: "You are a helpful development assistant..."
  }
}

// Response
{
  id: "dev-agent",
  name: "Dev Agent",
  workspaceId: "ws-123",
  status: "created"
}
```

### Update Agent

```typescript
// Request
{
  method: "agents.update",
  params: {
    id: "sales-agent",
    model: "claude-3-opus",  // Changed model
    skills: ["basecamp", "slack", "email", "calendar"]  // Added calendar
  }
}

// Response
{
  id: "sales-agent",
  status: "updated",
  changes: ["model", "skills"]
}
```

### Delete Agent

```typescript
// Request
{
  method: "agents.delete",
  params: {
    id: "old-agent"
  }
}

// Response
{
  id: "old-agent",
  status: "deleted"
}
```

---

## Workspace Isolation

Each user's agents are isolated to their workspace:

```
User A (workspace: ws-aaa-111)
  agents/
    sales-agent/
    support-agent/

User B (workspace: ws-bbb-222)
  agents/
    dev-agent/
    pm-agent/
```

**Implementation:**

```typescript
// In agents.ts
"agents.list": ({ params, respond, client }) => {
  const result = listAgentsForGateway(cfg);
  
  // Filter by workspace (unless super_admin)
  if (client && !isSuperAdmin(client)) {
    const filtered = filterByWorkspace(result.agents, client);
    respond(true, { agents: filtered }, undefined);
    return;
  }
  
  respond(true, result, undefined);
},
```

---

## Agent Memory Management

### What Agents Remember

```
Memory Types:
- Conversation history (per session)
- Long-term memory (memory.md)
- Identity/personality (identity.md)
- User preferences (learned over time)
```

### Memory Files UI

```
+----------------------------------------------------------+
|  Sales Agent > Memory                                     |
+----------------------------------------------------------+
|                                                           |
|  Long-Term Memory (memory.md):                            |
|  +----------------------------------------------------+  |
|  | User prefers morning meetings (9-11am)             |  |
|  | Main CRM is Basecamp project ID 12345              |  |
|  | Slack channel for sales: #sales-team               |  |
|  | Weekly report due every Friday 5pm                  |  |
|  | Key contacts: Sarah (PM), Mike (Dev), Lisa (Sales) |  |
|  +----------------------------------------------------+  |
|                                                           |
|  [Edit Memory]  [Clear Memory]  [Export]                 |
|                                                           |
+----------------------------------------------------------+
```

---

## Multi-Agent Workflows

### Parallel Execution (Planned)

```
User: "Prepare for my Monday meeting"

OpenClaw dispatches to multiple agents:
- Sales Agent: Pull latest deal status
- PM Agent: Get project updates
- Support Agent: Check for urgent tickets

All agents work in parallel, results consolidated.
```

### Agent Collaboration

```
Workflow: New Lead Handling

1. Sales Agent: Qualifies the lead
2. CRM Agent: Creates contact in Basecamp
3. Slack Agent: Notifies team in #sales
4. Email Agent: Sends welcome email

Each agent handles its specialty.
```

---

## Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| Agent CRUD | COMPLETE | Create, read, update, delete |
| Workspace Isolation | COMPLETE | Agents scoped to workspace |
| Agent Files | COMPLETE | identity, memory, soul, tools |
| Agent Dashboard UI | PARTIAL | Basic list, needs polish |
| Agent Templates | PENDING | Pre-built configurations |
| Parallel Execution | PENDING | Multi-agent orchestration |
| Agent Analytics | PENDING | Usage stats, performance |

---

## Next Steps

1. **Agent Templates** - Create pre-built agent configurations
2. **Agent Dashboard** - Polish UI for agent management
3. **Parallel Execution** - Enable multi-agent workflows
4. **Agent Analytics** - Track usage and performance

---

## Related Documentation

- [WORKSPACE_ISOLATION_STATUS.md](WORKSPACE_ISOLATION_STATUS.md) - Multi-tenant details
- [NEXT_STEPS.md](NEXT_STEPS.md) - Implementation plan
- [PRODUCT_VISION.md](PRODUCT_VISION.md) - User journey