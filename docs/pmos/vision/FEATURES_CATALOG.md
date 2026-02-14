# PM OS Features Catalog
**Comprehensive reference of all 100+ intelligence features**

Last Updated: 2026-02-14

## Table of Contents
1. [Foundation Features (1-10)](#1-foundation-features)
2. [Project Intelligence (11-20)](#2-project-intelligence)
3. [Team Intelligence (21-30)](#3-team-intelligence)
4. [Autonomous Operations (31-40)](#4-autonomous-operations)
5. [Knowledge Management (41-50)](#5-knowledge-management)
6. [Advanced Analytics (51-60)](#6-advanced-analytics)
7. [Collaboration Enhancement (61-70)](#7-collaboration-enhancement)
8. [Workflow Automation (71-80)](#8-workflow-automation)
9. [Predictive Intelligence (81-90)](#9-predictive-intelligence)
10. [Enterprise Features (91-100)](#10-enterprise-features)

---

## 1. Foundation Features

### Feature 1: Conversational Memory
**Status:** 🔴 Not Started | **Priority:** P0 - Critical | **Wave:** 1

**Description:**
Persistent conversation context that remembers entities, preferences, and past interactions across multiple queries.

**User Stories:**
- As a PM, I want to say "show me todos for that project" and have the AI remember which project I was just viewing
- As a team member, I want the AI to remember my preferences (timezone, working hours, notification style)
- As a manager, I want to continue conversations across days without re-explaining context

**Technical Spec:**
```typescript
interface SessionMemory {
  session_id: string;
  user_key: string;
  entities: Map<EntityType, EntityReference[]>;
  preferences: UserPreferences;
  conversation_history: ConversationTurn[];
  created_at: timestamp;
  last_accessed: timestamp;
  expires_at: timestamp;
}

interface EntityReference {
  type: 'project' | 'person' | 'task' | 'board' | 'message';
  id: string;
  name: string;
  mentioned_at: timestamp;
  context: string; // what was being discussed
}
```

**MCP Tool API:**
```javascript
// Implicit - all tools automatically store context
// Explicit resolution when needed:
resolve_reference({
  ref: string, // "that project", "the person I mentioned", "it"
  type?: EntityType // optional hint
}) → { type, id, name, confidence }
```

**Database Schema:**
```sql
CREATE TABLE session_memory (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  entity_name TEXT,
  context TEXT,
  mentioned_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_session (session_id, user_key),
  INDEX idx_entity (entity_type, entity_id)
);

CREATE TABLE user_preferences (
  user_key TEXT PRIMARY KEY,
  timezone TEXT,
  work_hours JSONB, -- {start: "09:00", end: "17:00"}
  notification_style TEXT, -- 'immediate', 'batched', 'digest'
  preferences JSONB, -- extensible
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Success Metrics:**
- Reference resolution accuracy > 95%
- User queries using pronouns/references > 30% of all queries
- Failed reference resolution < 5%

**Implementation Notes:**
- TTL: 24 hours for session memory (configurable)
- LRU eviction: Keep last 10 entities per type
- Confidence scoring: Exact match = 1.0, time decay for ambiguous references

---

### Feature 2: Time Machine (Change Tracking)
**Status:** 🔴 Not Started | **Priority:** P0 - Critical | **Wave:** 1

**Description:**
Snapshot-based change tracking that enables "what changed since X" queries and activity summaries.

**User Stories:**
- As a PM, I want to see "what changed in this project since yesterday"
- As a developer, I want to know "what did I work on this week"
- As a manager, I want to see "who's been active vs. inactive"

**Technical Spec:**
```typescript
interface Snapshot {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  snapshot: any; // full entity state
  created_at: timestamp;
  user_key: string;
}

interface ChangeSet {
  entity: Entity;
  changes: Change[];
  summary: string;
}

interface Change {
  field: string;
  old_value: any;
  new_value: any;
  change_type: 'added' | 'removed' | 'modified';
}
```

**MCP Tool API:**
```javascript
what_changed_since({
  entity_type: string, // 'project', 'person', 'task'
  entity_id?: string, // specific entity or all
  since: timestamp | string, // ISO timestamp or "yesterday", "last week"
  until?: timestamp
}) → ChangeSet[]

who_did_what({
  person?: string, // person name/id or current user
  since: timestamp | string,
  until?: timestamp,
  project?: string
}) → Activity[]
```

**Database Schema:**
```sql
CREATE TABLE snapshots (
  id SERIAL PRIMARY KEY,
  user_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_entity_time (entity_type, entity_id, created_at DESC),
  INDEX idx_user_time (user_key, created_at DESC)
);

-- Partition by time for performance
CREATE TABLE snapshots_2026_02 PARTITION OF snapshots
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
```

**Snapshot Strategy:**
- **Frequency**: On every write operation + periodic (every 6 hours for active entities)
- **Retention**: 90 days (configurable)
- **Diff Algorithm**: JSON diff with contextual field names
- **Compression**: gzip JSON for storage efficiency

**Success Metrics:**
- Query response time < 500ms for "since yesterday"
- Storage overhead < 30% of main data
- Diff accuracy (no false positives/negatives) > 99%

---

### Feature 3: Operation Log & Undo
**Status:** 🔴 Not Started | **Priority:** P0 - Critical | **Wave:** 1

**Description:**
Complete audit trail of all operations with reversible actions for safety.

**User Stories:**
- As any user, I want to undo the last action if I made a mistake
- As an admin, I want to see everything an agent did
- As a compliance officer, I want an immutable audit trail

**Technical Spec:**
```typescript
interface Operation {
  id: string;
  user_key: string;
  session_id: string;
  operation_type: string; // 'create_task', 'assign', 'move_card'
  target: OperationTarget;
  args: any;
  result: any;
  undo_operation?: string;
  undo_args?: any;
  created_at: timestamp;
  undone_at?: timestamp;
  undone_by?: string;
}

interface OperationTarget {
  type: EntityType;
  id: string;
  name?: string;
  project_id?: string;
}
```

**MCP Tool API:**
```javascript
undo_last({
  count?: number, // how many operations to undo (default 1)
  session_id?: string // specific session or current
}) → UndoResult[]

undo_operation({
  operation_id: string
}) → UndoResult

list_recent_operations({
  limit?: number,
  since?: timestamp,
  type?: string
}) → Operation[]
```

**Undo Strategy:**
```javascript
// Every write operation records its reverse
const UNDO_MAP = {
  'create_task': {
    undo: 'delete_task',
    args_map: (result) => ({ task_id: result.id })
  },
  'assign_task': {
    undo: 'unassign_task',
    args_map: (args, prev_state) => ({
      task_id: args.task_id,
      person_id: prev_state.assignee_ids // restore previous
    })
  },
  'move_card': {
    undo: 'move_card',
    args_map: (args, prev_state) => ({
      card_id: args.card_id,
      column_id: prev_state.column_id // previous column
    })
  }
};
```

**Database Schema:**
```sql
CREATE TABLE operation_log (
  id SERIAL PRIMARY KEY,
  user_key TEXT NOT NULL,
  session_id TEXT,
  agent_id TEXT, -- if performed by agent
  operation_type TEXT NOT NULL,
  target JSONB NOT NULL,
  args JSONB NOT NULL,
  result JSONB,
  undo_operation TEXT,
  undo_args JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  undone_at TIMESTAMP,
  undone_by TEXT,
  INDEX idx_user_time (user_key, created_at DESC),
  INDEX idx_session (session_id),
  INDEX idx_agent (agent_id)
);
```

**Success Metrics:**
- Undo success rate > 98% (some operations may not be reversible)
- Undo latency < 2 seconds
- Audit log completeness = 100% (every operation logged)

---

### Feature 4: Project Pulse (Health Scoring)
**Status:** 🔴 Not Started | **Priority:** P0 - Critical | **Wave:** 2

**Description:**
AI-computed health score combining velocity, risk, communication, and workload balance.

**User Stories:**
- As a PM, I want a single score showing if my project is healthy
- As a manager, I want to see which projects need attention
- As a stakeholder, I want to understand project status at a glance

**Health Score Components:**
```typescript
interface ProjectPulse {
  project_id: string;
  score: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  trend: 'improving' | 'stable' | 'declining';
  breakdown: {
    velocity: number; // 0-25
    risk: number; // 0-25
    communication: number; // 0-25
    balance: number; // 0-25
  };
  risks: Risk[];
  insights: string[];
  recommendations: string[];
  computed_at: timestamp;
}

interface Risk {
  type: 'deadline' | 'overload' | 'stalled' | 'scope_creep';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affected_entities: Entity[];
  suggested_actions: string[];
}
```

**Scoring Algorithms:**

**Velocity Score (0-25):**
```javascript
function calculateVelocityScore(project, period = '2 weeks') {
  const completed = countCompletions(project, period);
  const created = countCreated(project, period);
  const historical_avg = getHistoricalAverage(project);
  
  // Compare to historical average
  const ratio = completed / (historical_avg || completed);
  
  // Points
  let score = 0;
  if (ratio >= 1.2) score = 25; // 20% above average
  else if (ratio >= 1.0) score = 22; // meeting average
  else if (ratio >= 0.8) score = 18; // 20% below
  else if (ratio >= 0.6) score = 12; // 40% below
  else score = 5; // < 60% of average
  
  // Penalty for negative velocity (creating more than completing)
  if (created > completed * 1.5) score *= 0.7;
  
  return score;
}
```

**Risk Score (0-25):**
```javascript
function calculateRiskScore(project) {
  const tasks = getAllTasks(project);
  const now = Date.now();
  
  let score = 25; // start perfect
  
  // Overdue penalty
  const overdue = tasks.filter(t => t.due_date < now && !t.completed);
  score -= overdue.length * 2; // -2 points per overdue
  
  // Unassigned penalty
  const unassigned = tasks.filter(t => !t.assignees?.length);
  score -= (unassigned.length / tasks.length) * 10;
  
  // Stale tasks (no activity in 7+ days)
  const stale = tasks.filter(t => {
    const lastActivity = getLastActivity(t);
    return (now - lastActivity) > 7 * 24 * 60 * 60 * 1000;
  });
  score -= (stale.length / tasks.length) * 8;
  
  // Blocked items
  const blocked = tasks.filter(t => 
    t.description?.toLowerCase().includes('blocked') ||
    t.comments?.some(c => c.content.toLowerCase().includes('blocked'))
  );
  score -= blocked.length * 3;
  
  return Math.max(0, score);
}
```

**Communication Score (0-25):**
```javascript
function calculateCommScore(project, period = '1 week') {
  const messages = getMessages(project, period);
  const comments = getComments(project, period);
  const people = getProjectPeople(project);
  
  const total_comms = messages.length + comments.length;
  const avg_per_person = total_comms / people.length;
  
  // Optimal: 2-5 communications per person per week
  let score = 25;
  if (avg_per_person < 1) score = 10; // under-communication
  else if (avg_per_person < 2) score = 18;
  else if (avg_per_person <= 5) score = 25; // ideal
  else if (avg_per_person <= 8) score = 22;
  else score = 15; // over-communication (meetings?)
  
  // Participation distribution
  const gini = calculateGiniCoefficient(
    people.map(p => countCommsFromPerson(p, period))
  );
  if (gini > 0.5) score *= 0.8; // uneven participation
  
  return score;
}
```

**Balance Score (0-25):**
```javascript
function calculateBalanceScore(project) {
  const tasks = getAllActiveTasks(project);
  const people = getProjectPeople(project);
  
  const workload = people.map(person => ({
    person,
    tasks: tasks.filter(t => t.assignees?.includes(person.id)).length
  }));
  
  // Gini coefficient for workload distribution
  const gini = calculateGiniCoefficient(workload.map(w => w.tasks));
  
  // 0 = perfect equality, 1 = one person has everything
  const score = 25 * (1 - gini);
  
  return score;
}

function calculateGiniCoefficient(values) {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  
  let numerator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (n - i) * sorted[i];
  }
  
  return (2 * numerator) / (n * sum) - (n + 1) / n;
}
```

**MCP Tool API:**
```javascript
get_project_pulse({
  project: string, // name or ID
  period?: string, // "1 week", "2 weeks", "1 month"
  include_history?: boolean // trend data
}) → ProjectPulse

get_portfolio_pulse({
  projects?: string[], // specific projects or all
  sort_by?: 'score' | 'risk' | 'trend'
}) → ProjectPulse[]
```

**Caching Strategy:**
- Compute on-demand, cache for 30 minutes
- Invalidate on any project activity
- Pre-compute for active projects in background (every hour)

**Success Metrics:**
- Correlation with actual project outcomes > 0.7
- User agreement with scores > 80% ("feels accurate")
- Response time < 2 seconds for cached, < 5 seconds for computed

---

### Feature 5: Focus Mode (Personal Productivity)
**Status:** 🔴 Not Started | **Priority:** P1 - High | **Wave:** 2

**Description:**
Personalized daily briefings and task prioritization for individual contributors.

**User Stories:**
- As a developer, I want to know "what should I work on now"
- As a designer, I want a morning brief of my day
- As anyone, I want an end-of-day summary of what I accomplished

**Technical Spec:**
```typescript
interface DailyBrief {
  user: Person;
  date: string;
  priority_tasks: PriorityTask[];
  meetings_today: ScheduleEntry[];
  waiting_on_me: Task[]; // others blocked by my tasks
  blocked_by: Task[]; // I'm waiting for these
  news: ProjectUpdate[]; // overnight changes in my projects
  suggested_focus: string; // AI recommendation
}

interface PriorityTask {
  task: Task;
  score: number; // 0-100
  reason: string; // why it's prioritized
  factors: {
    urgency: number;
    impact: number;
    context: number;
    energy: number;
  };
}

interface EndOfDayeSummary {
  user: Person;
  date: string;
  completed: Task[];
  started: Task[];
  contributed: Activity[]; // comments, reviews, etc.
  time_distribution: { project: string, hours: number }[];
  wins: string[];
  blockers: string[];
  tomorrow_preview: PriorityTask[];
}
```

**Priority Scoring:**
```javascript
function scorePriority(task, user, context) {
  const now = Date.now();
  
  // Urgency (0-25): due date proximity
  const urgency = task.due_date 
    ? Math.max(0, 25 - (task.due_date - now) / (24*60*60*1000))
    : 10; // no due date = medium urgency
  
  // Impact (0-25): is it blocking others?
  const blockedTasks = findBlockedBy(task);
  const impact = Math.min(25, blockedTasks.length * 8);
  
  // Context (0-25): am I already working in this project?
  const recentActivity = getUserRecentActivity(user, '2 hours');
  const sameProject = recentActivity.some(a => 
    a.project_id === task.project_id
  );
  const context = sameProject ? 25 : 10;
  
  // Energy (0-25): task complexity vs. time of day
  const hour = new Date().getHours();
  const peakHours = user.preferences?.peak_hours || [9, 10, 11]; // morning
  const isComplexTask = task.effort_estimate > 4; // hours
  
  let energy = 15;
  if (isComplexTask && peakHours.includes(hour)) energy = 25;
  if (!isComplexTask && !peakHours.includes(hour)) energy = 20;
  
  return {
    score: urgency + impact + context + energy,
    factors: { urgency, impact, context, energy }
  };
}
```

**MCP Tool API:**
```javascript
my_day({
  date?: string // default today
}) → DailyBrief

what_should_i_work_on({
  limit?: number, // top N tasks (default 3)
  project?: string, // filter to specific project
  energy_level?: 'high' | 'medium' | 'low' // task complexity filter
}) → PriorityTask[]

end_of_day({
  date?: string // default today
}) → EndOfDaySummary
```

**Success Metrics:**
- Task completion rate for top 3 priority tasks > 70%
- User satisfaction with prioritization > 85%
- Engagement: users running my_day > 3x per week

---

## 2. Project Intelligence

*(Features 11-20 detailed specifications...)*

### Feature 11: Natural Language Project Builder
**Status:** 🔴 Not Started | **Priority:** P1 - High | **Wave:** 3

**Description:**
Describe a project structure in plain English, AI builds the entire structure.

**Example Input:**
> "Create a project called 'Q2 Marketing Campaign'. Set up 4 todo lists: Content (10 blog post todos due weekly starting March 1), Design (5 graphic tasks), Ads (Google, Facebook, LinkedIn campaigns), and Analytics (tracking setup, weekly reports). Create a card table with columns: Ideas, In Progress, Review, Done. Add Sarah (PM), Mike (designer), Lisa (copywriter), and Ahmed (analyst). Post a kickoff message explaining we're launching a new product line and need coordinated marketing across all channels."

**Output:**
- ✅ Project created
- ✅ 4 todo lists with 20+ todos, due dates, descriptions
- ✅ Card table with 4 columns
- ✅ 4 people added
- ✅ Kickoff message posted with context
- ⏱️ Completed in 8 seconds

**Technical Approach:**
```javascript
async function buildProject(description, options = {}) {
  // 1. Parse with LLM
  const plan = await parseProjectDescription(description);
  
  // 2. Validate and get user confirmation
  const confirmed = options.auto_execute || await getUserApproval(plan);
  if (!confirmed) return { status: 'cancelled', plan };
  
  // 3. Execute in order
  const results = {
    project: await createProject(plan.project),
    lists: [],
    tasks: [],
    boards: [],
    people: [],
    messages: []
  };
  
  // Create lists
  for (const list of plan.lists) {
    const created = await createTodolist(results.project.id, list);
    results.lists.push(created);
    
    // Create tasks in this list
    for (const task of list.tasks) {
      const createdTask = await createTodo(created.id, task);
      results.tasks.push(createdTask);
    }
  }
  
  // Create boards
  for (const board of plan.boards) {
    const created = await createCardTable(results.project.id, board);
    results.boards.push(created);
  }
  
  // Add people
  for (const person of plan.people) {
    await addPersonToProject(results.project.id, person);
    results.people.push(person);
  }
  
  // Post messages
  for (const message of plan.messages) {
    const posted = await postMessage(results.project.id, message);
    results.messages.push(posted);
  }
  
  return {
    status: 'success',
    results,
    summary: generateSummary(results)
  };
}

async function parseProjectDescription(description) {
  const prompt = `Parse this project description into structured data:
  
${description}

Return JSON with this structure:
{
  "project": {"name": "...", "description": "..."},
  "lists": [
    {
      "name": "...",
      "description": "...",
      "tasks": [
        {"title": "...", "description": "...", "due_date": "...", "assignee": "..."}
      ]
    }
  ],
  "boards": [{"name": "...", "columns": ["...", "..."]}],
  "people": [{"name": "...", "role": "..."}],
  "messages": [{"subject": "...", "content": "..."}]
}`;

  const response = await callLLM(prompt, { response_format: 'json' });
  return JSON.parse(response);
}
```

**MCP Tool API:**
```javascript
build_project({
  description: string, // natural language description
  auto_execute?: boolean, // skip confirmation (default false)
  dry_run?: boolean // just show plan, don't execute
}) → ProjectBuildResult
```

**Success Metrics:**
- Parsing accuracy > 90% (correct structure extraction)
- User edits < 10% of generated elements
- Time savings vs. manual: > 80% (8 min vs. 40 min)

---

*(Continue with detailed specs for features 12-100...)*

## Feature Index

Quick reference (full specs above in sections):

| # | Feature | Status | Priority | Wave |
|---|---------|--------|----------|------|
| 1 | Conversational Memory | 🔴 Not Started | P0 | 1 |
| 2 | Time Machine | 🔴 Not Started | P0 | 1 |
| 3 | Operation Log & Undo | 🔴 Not Started | P0 | 1 |
| 4 | Project Pulse | 🔴 Not Started | P0 | 2 |
| 5 | Focus Mode | 🔴 Not Started | P1 | 2 |
| 6 | NL Query Engine | 🔴 Not Started | P1 | 2 |
| 7 | Smart Dashboards | 🔴 Not Started | P1 | 2 |
| 8 | Ghost Work Detector | 🔴 Not Started | P1 | 2 |
| 9 | Dependency Engine | 🔴 Not Started | P1 | 3 |
| 10 | Critical Path Analysis | 🔴 Not Started | P1 | 3 |
| 11 | NL Project Builder | 🔴 Not Started | P1 | 3 |
| 12 | Smart Assignment | 🔴 Not Started | P1 | 3 |
| 13 | Predictive Deadlines | 🔴 Not Started | P1 | 3 |
| 14 | Recipe System | 🔴 Not Started | P1 | 3 |
| 15 | Workload Simulator | 🔴 Not Started | P2 | 3 |
| ... | *(91-100 more features)* | ... | ... | ... |

## Implementation Priority

**P0 - Critical (Must Have for MVP):**
1-4: Memory, Time Machine, Undo, Project Pulse

**P1 - High (Core Intelligence):**
5-20: Focus Mode, NL Builder, Smart Assign, Predictions

**P2 - Medium (Enhanced Intelligence):**
21-60: Advanced analytics, automation, knowledge

**P3 - Future (Platform Features):**
61-100: Enterprise, marketplace, multi-platform

---

*This is a living document. Each feature will get its own detailed spec as we implement.*
