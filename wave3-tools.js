/**
 * Wave 3: Construction Tools
 * NL Project Builder, Smart Assignment, Predictive Deadlines, Recipe System
 */
export function getWave3Tools() {
  return [
    // ===== NL Project Builder =====
    {
      name: 'build_project',
      description: 'Build an entire project structure from a natural language description. Describe what you need and AI will parse it into projects, todo lists, tasks, card tables, assignments, and messages. Use dry_run to preview the plan before executing.',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Natural language description of the project to build, e.g. "Create a Q2 Marketing project with todo lists for Content, Design, and Ads, add Sarah as PM"' },
          dry_run: { type: 'boolean', description: 'If true, returns the parsed plan without executing (default: false)' },
          project: { type: 'string', description: 'If provided, adds items to this existing project instead of creating a new one' }
        },
        required: ['description']
      }
    },

    // ===== Smart Assignment =====
    {
      name: 'smart_assign',
      description: 'AI-recommended task assignment based on workload balance, skills (past task patterns), availability, and project context. Recommends the best person for a task or rebalances assignments across a project.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Task title or ID to assign (for single assignment)' },
          project: { type: 'string', description: 'Project name or ID (for rebalancing or context)' },
          mode: { type: 'string', enum: ['assign', 'rebalance', 'suggest'], description: 'assign = pick best person for one task, rebalance = redistribute project tasks, suggest = return recommendations only (default: suggest)' }
        },
        required: ['project']
      }
    },

    // ===== Predictive Deadlines =====
    {
      name: 'predict_deadline',
      description: 'Predict when tasks or a project will be completed based on historical velocity, current workload, and remaining work. Uses completion rate trends to forecast realistic deadlines.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name or ID' },
          task: { type: 'string', description: 'Specific task title or ID (optional — predicts project-level if omitted)' },
          confidence: { type: 'string', enum: ['optimistic', 'likely', 'pessimistic'], description: 'Confidence level: optimistic (best case), likely (median), pessimistic (worst case). Default: likely' }
        },
        required: ['project']
      }
    },

    // ===== Recipe System =====
    {
      name: 'save_recipe',
      description: 'Save a sequence of operations as a reusable recipe/template. Capture recent operations as a recipe that can be replayed later for similar setups.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Recipe name, e.g. "Sprint Setup", "Client Onboarding"' },
          description: { type: 'string', description: 'What this recipe does' },
          operation_count: { type: 'integer', description: 'Number of recent operations to capture (default: 10, max: 50)' }
        },
        required: ['name']
      }
    },
    {
      name: 'list_recipes',
      description: 'List all saved recipes/templates for the current user.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max recipes to return (default: 20)' }
        }
      }
    },
    {
      name: 'run_recipe',
      description: 'Execute a saved recipe, optionally with variable substitutions (e.g. different project name, different people). Returns a dry-run plan first if no auto_execute flag.',
      inputSchema: {
        type: 'object',
        properties: {
          recipe_id: { type: 'string', description: 'Recipe ID or name to execute' },
          variables: { type: 'object', description: 'Variable substitutions, e.g. {"project_name": "Q3 Campaign", "pm": "Sarah"}' },
          auto_execute: { type: 'boolean', description: 'If true, execute immediately without preview (default: false)' }
        },
        required: ['recipe_id']
      }
    },
    {
      name: 'delete_recipe',
      description: 'Delete a saved recipe by ID or name.',
      inputSchema: {
        type: 'object',
        properties: {
          recipe_id: { type: 'string', description: 'Recipe ID or name to delete' }
        },
        required: ['recipe_id']
      }
    }
  ];
}
