/**
 * Wave 6: Enterprise Tools
 * Audit Trail, Policy Engine, Approval Workflows, Reporting, Budget Tracking
 */
export function getWave6Tools() {
  return [
    {
      name: 'audit_log',
      description: 'Query the immutable audit trail of all operations. See who did what, when, and on which entity. Filter by user, operation type, entity, or time range. Supports compliance and governance requirements.',
      inputSchema: {
        type: 'object',
        properties: {
          user: { type: 'string', description: 'Filter by user name or email' },
          operation: { type: 'string', description: 'Filter by operation type, e.g. "create_task", "delete_project"' },
          entity: { type: 'string', description: 'Filter by entity name or ID' },
          period: { type: 'string', description: 'Time period: "1d", "7d", "30d", "90d" (default: 7d)' },
          limit: { type: 'number', description: 'Max results (default: 50)' }
        }
      }
    },

    {
      name: 'create_policy',
      description: 'Create an automated policy rule that enforces constraints. Examples: "all tasks must have assignees", "no project without a description", "maximum 15 tasks per person". Policies are checked by agents and reported in alerts.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Policy name' },
          rule: { type: 'string', description: 'Policy rule in natural language, e.g. "every task must have an assignee"' },
          type: { type: 'string', enum: ['task', 'project', 'assignment', 'deadline', 'custom'], description: 'Policy category' },
          severity: { type: 'string', enum: ['block', 'warn', 'info'], description: 'What happens on violation: block=prevent, warn=alert, info=log (default: warn)' },
          active: { type: 'boolean', description: 'Whether policy is active (default: true)' }
        },
        required: ['name', 'rule']
      }
    },

    {
      name: 'list_policies',
      description: 'List all policies and their violation counts.',
      inputSchema: {
        type: 'object',
        properties: {
          active_only: { type: 'boolean', description: 'Only show active policies (default: true)' }
        }
      }
    },

    {
      name: 'check_compliance',
      description: 'Run all active policies against current project data and report violations. Returns a compliance scorecard showing which policies pass and which have violations.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Optional: check compliance for a specific project only' },
          policy_id: { type: 'string', description: 'Optional: check a specific policy only' }
        }
      }
    },

    {
      name: 'generate_report',
      description: 'Generate a structured report with real data. Report types: status (project status), velocity (work speed trends), team (workload + activity), executive (high-level summary), custom. Reports include data tables, metrics, and analysis.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['status', 'velocity', 'team', 'executive', 'custom'], description: 'Report type' },
          project: { type: 'string', description: 'Optional: scope to a specific project' },
          period: { type: 'string', description: 'Report period: "7d", "14d", "30d", "90d" (default: 30d)' },
          format: { type: 'string', enum: ['summary', 'detailed', 'data_only'], description: 'Output format (default: summary)' }
        },
        required: ['type']
      }
    },

    {
      name: 'track_budget',
      description: 'Track project budget and costs. Log expenses, set budgets, and get forecasts. Supports cost categories (labor, tools, infrastructure) and burn rate analysis.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['set_budget', 'log_expense', 'get_summary', 'forecast'], description: 'Budget action to perform' },
          project: { type: 'string', description: 'Project name or ID' },
          amount: { type: 'number', description: 'Amount (for set_budget or log_expense)' },
          category: { type: 'string', description: 'Cost category (for log_expense): labor, tools, infrastructure, other' },
          description: { type: 'string', description: 'Description of expense or budget note' }
        },
        required: ['action', 'project']
      }
    }
  ];
}
