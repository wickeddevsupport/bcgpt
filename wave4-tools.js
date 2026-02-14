/**
 * Wave 4: Autonomy Tools
 * Agent Framework (OADA loop), Proactive Alerts, Event Subscriptions, Goal-Based Agents
 */
export function getWave4Tools() {
  return [
    // ===== Agent Framework =====
    {
      name: 'create_agent',
      description: 'Create an autonomous agent with a goal and strategy. The agent uses an OADA loop (Observe → Analyze → Decide → Act) to work toward goals like "keep inbox zero", "triage new tasks daily", or "ensure all projects have weekly updates". Agents run when you call run_agent or can be set to suggest actions proactively.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Agent name, e.g. "Triage Bot", "Inbox Zero Agent"' },
          goal: { type: 'string', description: 'The agent\'s goal in natural language, e.g. "Ensure every new task is assigned within 24 hours"' },
          type: { type: 'string', enum: ['pm', 'triage', 'quality', 'review', 'custom'], description: 'Agent type: pm (project management), triage (task sorting), quality (check completeness), review (audit recent work), custom' },
          strategy: { type: 'string', description: 'Optional strategy/instructions for how the agent should achieve its goal' },
          auto_execute: { type: 'boolean', description: 'If true, agent actions are executed automatically. If false (default), agent only suggests actions for human approval.' },
          schedule: { type: 'string', enum: ['on_demand', 'hourly', 'daily', 'weekly'], description: 'How often the agent should run (default: on_demand)' }
        },
        required: ['name', 'goal']
      }
    },

    {
      name: 'list_agents',
      description: 'List all your autonomous agents with their status, last run time, and action counts.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'paused', 'all'], description: 'Filter by agent status (default: all)' }
        }
      }
    },

    {
      name: 'run_agent',
      description: 'Execute one OADA cycle of an agent: Observe (gather data) → Analyze (evaluate against goal) → Decide (choose actions) → Act (execute or suggest). Returns the agent\'s observations, analysis, decisions, and actions taken.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID or name to run' },
          dry_run: { type: 'boolean', description: 'If true, runs Observe+Analyze+Decide but does NOT Act — returns suggested actions only (default: false)' }
        },
        required: ['agent_id']
      }
    },

    {
      name: 'pause_agent',
      description: 'Pause or resume an autonomous agent.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID or name' },
          action: { type: 'string', enum: ['pause', 'resume'], description: 'Whether to pause or resume the agent' }
        },
        required: ['agent_id', 'action']
      }
    },

    {
      name: 'delete_agent',
      description: 'Delete an autonomous agent and its history.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID or name to delete' }
        },
        required: ['agent_id']
      }
    },

    // ===== Proactive Notifications / Alerts =====
    {
      name: 'get_alerts',
      description: 'Get proactive AI-generated alerts about your projects. Detects: overdue tasks, stale projects (no activity in N days), unbalanced workloads, approaching deadlines, unassigned tasks, projects without recent updates. The AI speaks first — surfacing issues before you notice them.',
      inputSchema: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'warning', 'info', 'all'], description: 'Filter by severity level (default: all)' },
          project: { type: 'string', description: 'Filter alerts to a specific project name or ID' },
          categories: {
            type: 'array',
            items: { type: 'string', enum: ['overdue', 'stale', 'unassigned', 'workload', 'deadline', 'blocked', 'quality'] },
            description: 'Filter by alert categories'
          }
        }
      }
    },

    // ===== Event Subscriptions (Webhook Bridge) =====
    {
      name: 'subscribe_event',
      description: 'Subscribe to project events to get notified when specific things happen. Events include: task_created, task_completed, task_overdue, project_stale, deadline_approaching, assignment_changed. Subscriptions feed into the agent system and alert generation.',
      inputSchema: {
        type: 'object',
        properties: {
          event: { type: 'string', description: 'Event type to subscribe to, e.g. "task_completed", "deadline_approaching", "project_stale"' },
          project: { type: 'string', description: 'Optional: limit subscription to a specific project' },
          action: { type: 'string', enum: ['subscribe', 'unsubscribe'], description: 'Subscribe or unsubscribe (default: subscribe)' }
        },
        required: ['event']
      }
    },

    {
      name: 'list_subscriptions',
      description: 'List all your active event subscriptions.',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    }
  ];
}
