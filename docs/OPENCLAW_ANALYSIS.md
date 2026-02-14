# OpenClaw Architecture Analysis

## Summary

OpenClaw is a sophisticated agent operating system with multi-model support, WebSocket-based communication, and a Lit-based web UI. This document analyzes patterns we can extract for PMOS (PM Operating System).

---

## Key Components

### 1. Gateway (WebSocket Server)
**Location:** `src/gateway/`

**Pattern:**
- WebSocket server at `ws://127.0.0.1:18789`
- JSON-RPC style protocol with `request(method, params)` 
- Methods: `chat.send`, `session.list`, `status.*`, etc.
- Handles authentication, routing, and session management

**What to extract:** The WebSocket protocol pattern for real-time streaming responses.

**For PMOS:** We can add WebSocket support to our existing Express server for streaming AI responses, or use Server-Sent Events (simpler).

---

### 2. Agent Runtime (Pi Embedded Runner)
**Location:** `src/agents/pi-embedded-runner/run.ts`

**Pattern:**
```typescript
// Core loop structure
async function runAgent(session, tools, prompt) {
  while (true) {
    const response = await llmCall(messages, tools);
    if (response.type === 'tool_call') {
      const result = await executeTool(response.tool, response.args);
      messages.push(toolResult(result));
      continue;
    }
    if (response.type === 'text') {
      stream(response.text);
      break;
    }
  }
}
```

**Features:**
- Auth profile rotation (try multiple API keys)
- Automatic model failover (Claude → GPT → Gemini)
- Context window management (compaction when full)
- Usage/cost tracking

**What to extract:** The tool-calling loop pattern.

**For PMOS:** Implement a simpler version using our 50 MCP tools directly.

---

### 3. Tool System
**Location:** `src/agents/tools/`, `src/agents/openclaw-tools.ts`

**Pattern:**
```typescript
// Tool definition
function createMyTool(options): AnyAgentTool {
  return {
    label: "My Tool",
    name: "my_tool",
    description: "Does something useful",
    parameters: Type.Object({
      param1: Type.String(),
      param2: Type.Optional(Type.Number()),
    }),
    execute: async (toolCallId, args) => {
      // Tool logic
      return jsonResult({ success: true, data: "..." });
    },
  };
}
```

**What to extract:** The tool format is similar to what Claude/GPT expect. We already have this!

**For PMOS:** Our 50 MCP tools already follow a similar pattern. We just need to wrap them for the LLM.

---

### 4. Skills System
**Location:** `src/agents/skills.ts`, `skills/*/SKILL.md`

**Pattern:** Markdown files with YAML frontmatter:
```markdown
```skill
---
name: github
description: "Interact with GitHub using the gh CLI"
metadata:
  openclaw:
    emoji: "🐙"
    requires:
      bins: ["gh"]
---
# GitHub Skill

## Instructions
When asked about GitHub...

## Examples
- "Create a PR" → run `gh pr create`
```

**What to extract:** The idea of user-definable "skills" as prompt augmentations.

**For PMOS:** Users can create custom "personas" or "skills" that add context to the system prompt.

---

### 5. Chat UI
**Location:** `ui/src/ui/`

**Stack:** Lit (Web Components), TypeScript, Vite

**Key Components:**
- `app.ts` - Main application
- `gateway.ts` - WebSocket client
- `controllers/chat.ts` - Chat state management
- `views/chat.ts` - Chat rendering

**Pattern:**
```typescript
// Sending a message
async function sendChatMessage(content: string) {
  const response = await client.request("chat.send", {
    sessionId: currentSession,
    content: [{ type: "text", text: content }],
    stream: true,
  });
  // Handle streaming response
}
```

**What to extract:** The chat interaction pattern.

**For PMOS:** Build a simpler React-based chat UI with our existing REST API + optional WebSocket for streaming.

---

## Architecture Comparison

| Feature | OpenClaw | PMOS (Our Approach) |
|---------|----------|---------------------|
| UI Framework | Lit (Web Components) | React + Tailwind |
| Transport | WebSocket only | REST API + SSE for streaming |
| Agent Runtime | Pi Embedded Runner | Simple tool-calling loop |
| Tools | Dynamic loading | Pre-registered 50 MCP tools |
| Auth | Complex multi-account | Basecamp OAuth per user |
| Multi-tenant | Full OS metaphor | Project-scoped |
| Skills | Markdown files | DB-stored personas |

---

## What We'll Extract

### ✅ Take These Patterns

1. **Tool-calling loop** - LLM → tool call → execute → continue
2. **Streaming responses** - Use SSE instead of WebSocket (simpler)
3. **Conversation management** - Session state with message history
4. **Persona/Skills concept** - User-defined prompt augmentations

### ❌ Skip These (Too Complex)

1. **Full WebSocket gateway** - Overkill for our needs
2. **Lit/Web Components** - React is more familiar
3. **Multi-model failover** - Start with single provider
4. **Sandbox/security** - Not needed for PM tools
5. **OS desktop metaphor** - Focus on PM workflows

---

## PMOS Architecture (Simplified)

```
┌─────────────────────────────────────────────────────────────┐
│                     PMOS Frontend (React)                    │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│  Today   │  Board   │  People  │ Reports  │    Settings    │
│  View    │  View    │   View   │   View   │                │
├──────────┴──────────┴──────────┴──────────┴────────────────┤
│                        AI Bar (Chat)                         │
│  ┌────────────────────────────────────────┐ ┌────────────┐ │
│  │ "What did we accomplish this week?"    │ │   Send     │ │
│  └────────────────────────────────────────┘ └────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    BCGPT API Server                          │
├─────────────────────────────────────────────────────────────┤
│  POST /api/chat         - Send message, get response         │
│  GET  /api/chat/stream  - SSE for streaming responses        │
│  GET  /api/sessions     - List chat sessions                 │
│  POST /api/personas     - Create custom personas             │
│  *    /mcp/*            - Existing 50 MCP tools              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Agent Runtime                            │
├─────────────────────────────────────────────────────────────┤
│  1. Receive user message                                     │
│  2. Build system prompt (base + persona + context)           │
│  3. Call LLM (Gemini/Claude/GPT)                            │
│  4. If tool_call → execute MCP tool → add result → loop      │
│  5. If text → stream to client → done                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   50 MCP Tools (Existing)                    │
├──────────────┬──────────────┬──────────────┬───────────────┤
│ Wave 1       │ Wave 2       │ Wave 3       │ Wave 4-8      │
│ Projects     │ Todos        │ Messages     │ Intelligence  │
│ People       │ Schedules    │ Comments     │ Analytics     │
│ Companies    │ Documents    │ ...          │ ...           │
└──────────────┴──────────────┴──────────────┴───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Basecamp API                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Database Schema (Multi-tenant)

```sql
-- Users (linked to Basecamp accounts)
CREATE TABLE pmos_users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  basecamp_account_id VARCHAR(50),
  basecamp_access_token TEXT,
  basecamp_refresh_token TEXT,
  basecamp_token_expires_at TIMESTAMP,
  llm_provider VARCHAR(50) DEFAULT 'gemini', -- gemini, anthropic, openai
  llm_api_key TEXT, -- optional, encrypted
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Chat sessions
CREATE TABLE pmos_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES pmos_users(id),
  title VARCHAR(255),
  project_id VARCHAR(50), -- Basecamp project context
  persona_id INTEGER REFERENCES pmos_personas(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Chat messages
CREATE TABLE pmos_messages (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES pmos_sessions(id),
  role VARCHAR(20) NOT NULL, -- user, assistant, tool
  content TEXT NOT NULL,
  tool_calls JSONB, -- tool calls made by assistant
  tool_results JSONB, -- results from tool executions
  created_at TIMESTAMP DEFAULT NOW()
);

-- Custom personas (skills)
CREATE TABLE pmos_personas (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES pmos_users(id),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  emoji VARCHAR(10),
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Default personas (shipped with PMOS)
INSERT INTO pmos_personas (name, description, system_prompt, emoji, is_default) VALUES
('PM Assistant', 'General project management assistant', 
 'You are a helpful project management assistant. You have access to Basecamp tools...', 
 '📋', true),
('Standup Writer', 'Generates daily standup reports',
 'You help write daily standup reports based on recent activity...', 
 '☀️', true),
('Sprint Planner', 'Helps plan and organize sprints',
 'You help plan sprints by analyzing backlogs and workloads...', 
 '🎯', true);
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Set up React frontend with Vite
- [ ] Create basic layout (header, sidebar, main, AI bar)
- [ ] Implement Basecamp OAuth flow
- [ ] Create database tables for multi-tenancy

### Phase 2: Chat Core (Week 2)
- [ ] Build agent runtime (tool-calling loop)
- [ ] Integrate with Gemini API (free tier)
- [ ] Connect 50 MCP tools to agent
- [ ] Build chat UI component
- [ ] Add SSE streaming

### Phase 3: PM Views (Week 3)
- [ ] Today view (dashboard)
- [ ] Board view (kanban)
- [ ] People view (workload)
- [ ] Reports view (analytics)

### Phase 4: Polish (Week 4)
- [ ] Personas/skills management
- [ ] Conversation history
- [ ] Settings page
- [ ] Mobile responsiveness

---

## Tech Stack Decision

| Layer | Technology | Why |
|-------|------------|-----|
| Frontend | React + Vite | Fast, familiar, good ecosystem |
| Styling | Tailwind CSS | Rapid development, consistent |
| State | Zustand | Simple, lightweight |
| Backend | Express (existing) | Already built |
| Database | PostgreSQL (existing) | Already have schema |
| LLM | Gemini 1.5 Flash | Free, good quality |
| Streaming | Server-Sent Events | Simpler than WebSocket |
| Auth | Basecamp OAuth | Already implemented |

---

## Next Steps

1. **Confirm tech stack** with user
2. **Create frontend directory** structure
3. **Build basic layout** with placeholder views
4. **Implement auth flow** (Basecamp OAuth)
5. **Build agent runtime** and connect to tools
6. **Build chat component** with streaming

---

*Document created: Analysis of OpenClaw for PMOS hybrid approach*
