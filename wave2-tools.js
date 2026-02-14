/**
 * Wave 2: Intelligence Tools
 * Project Pulse, Focus Mode, Ghost Work Detector, NL Query, Smart Dashboards
 */
export function getWave2Tools() {
  return [
    // ===== Project Pulse =====
    {
      name: 'get_project_pulse',
      description: 'Get an AI-computed health score for a project. Combines velocity (task completion rate), risk (overdue/stale tasks), communication (message activity), and workload balance into a 0-100 score with letter grade. Shows trends, risks, and recommendations.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name or ID' },
          period: { type: 'string', description: 'Analysis period: "1 week", "2 weeks", "1 month". Default: "2 weeks"' }
        },
        required: ['project']
      }
    },
    {
      name: 'get_portfolio_pulse',
      description: 'Get health scores for all projects (or a subset). Returns a sorted overview showing which projects need attention. Great for managers wanting a portfolio-level view.',
      inputSchema: {
        type: 'object',
        properties: {
          sort_by: { type: 'string', enum: ['score', 'risk', 'trend', 'name'], description: 'Sort by score (default), risk, trend, or name' },
          limit: { type: 'integer', description: 'Max projects to return (default: all)' }
        }
      }
    },

    // ===== Focus Mode =====
    {
      name: 'my_day',
      description: 'Get a personalized daily briefing: priority tasks, what changed overnight, things waiting on you, and suggested focus areas. Like a PM assistant morning standup.',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date to brief on (default: today). ISO date or "yesterday"' }
        }
      }
    },
    {
      name: 'what_should_i_work_on',
      description: 'AI-prioritized task recommendations based on urgency, impact (blocking others), context (current project), and effort match. Returns top N tasks with reasons.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Number of tasks to suggest (default: 5)' },
          project: { type: 'string', description: 'Filter to specific project' },
          energy_level: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Match task complexity to your energy. High = deep work, low = quick wins.' }
        }
      }
    },
    {
      name: 'end_of_day',
      description: 'End-of-day summary: what you completed, contributed, time distribution by project, wins, and blockers. Generates a shareable standup-ready summary.',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date to summarize (default: today)' }
        }
      }
    },

    // ===== Ghost Work Detector =====
    {
      name: 'detect_ghost_work',
      description: 'Find stalled, orphaned, or at-risk work items. Detects: tasks with no activity for 7+ days, unassigned tasks in active projects, tasks marked "blocked" in comments, overdue items, and over-loaded team members. Returns categorized risk items with recommendations.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Specific project to scan, or omit for all projects' },
          stale_days: { type: 'integer', description: 'Days of inactivity before flagging as stale (default: 7)' },
          include_completed: { type: 'boolean', description: 'Include recently completed items in analysis (default: false)' }
        }
      }
    },

    // ===== NL Query Engine =====
    {
      name: 'query',
      description: 'Natural language query engine for project data. Ask questions like "how many tasks are overdue?", "who has the most tasks?", "show me stale projects", "tasks due this week", "messages in the last 3 days". Translates natural language into structured data queries.',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'Natural language question about your projects, tasks, people, or activity' },
          project: { type: 'string', description: 'Optional project context to narrow the query' }
        },
        required: ['q']
      }
    },

    // ===== Smart Dashboards =====
    {
      name: 'generate_dashboard',
      description: 'Generate a structured dashboard with key metrics. Types: "overview" (portfolio summary), "project" (single project deep-dive), "team" (workload & activity), "velocity" (completion trends), "risk" (all risks across projects).',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['overview', 'project', 'team', 'velocity', 'risk'], description: 'Dashboard type' },
          project: { type: 'string', description: 'Project name/ID (required for "project" type)' },
          period: { type: 'string', description: 'Time period for trends: "1 week", "2 weeks", "1 month". Default: "2 weeks"' }
        },
        required: ['type']
      }
    }
  ];
}
