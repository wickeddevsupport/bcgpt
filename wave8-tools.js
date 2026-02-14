/**
 * Wave 8: Expansion Tools
 * Multi-Platform Adapters, Cross-Platform Queries, Notifications, AI Personas, Predictions
 */
export function getWave8Tools() {
  return [
    {
      name: 'connect_platform',
      description: 'Connect an external platform (GitHub, Jira, Slack, Linear, Asana, etc.) to enable cross-platform intelligence. Once connected, data from these platforms feeds into search, alerts, and analytics.',
      inputSchema: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['github', 'jira', 'slack', 'linear', 'asana', 'trello', 'notion', 'custom'], description: 'Platform to connect' },
          action: { type: 'string', enum: ['connect', 'disconnect', 'status', 'sync'], description: 'Action: connect, disconnect, check status, or sync data' },
          config: { type: 'object', description: 'Connection config (API key, org, repo, etc.)' }
        },
        required: ['platform', 'action']
      }
    },

    {
      name: 'cross_query',
      description: 'Query across all connected platforms with a single natural language question. "Show me all open PRs on GitHub that relate to Basecamp tasks" or "What Jira tickets are blocked?" Unifies data from multiple platforms.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language cross-platform query' },
          platforms: { type: 'array', items: { type: 'string' }, description: 'Limit to specific platforms (default: all connected)' },
          limit: { type: 'number', description: 'Max results (default: 20)' }
        },
        required: ['query']
      }
    },

    {
      name: 'send_notification',
      description: 'Send a notification or message through a connected platform. Post to Slack channels, create GitHub issues, send emails, or trigger webhooks.',
      inputSchema: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['slack', 'email', 'webhook', 'github', 'basecamp'], description: 'Platform to send through' },
          target: { type: 'string', description: 'Target: channel name, email address, webhook URL, or repo' },
          message: { type: 'string', description: 'Message content' },
          title: { type: 'string', description: 'Optional title/subject' }
        },
        required: ['platform', 'target', 'message']
      }
    },

    {
      name: 'set_persona',
      description: 'Configure the AI persona for interactions. Personas affect tone, verbosity, and focus areas. Built-in: "pm" (project manager), "engineer" (technical), "executive" (high-level), "coach" (supportive), or create custom personas.',
      inputSchema: {
        type: 'object',
        properties: {
          persona: { type: 'string', description: 'Persona name: "pm", "engineer", "executive", "coach", or custom name' },
          traits: { type: 'object', description: 'Custom persona traits: {tone, verbosity, focus_areas, communication_style}' },
          action: { type: 'string', enum: ['set', 'get', 'list', 'delete'], description: 'Action (default: set)' }
        },
        required: ['persona']
      }
    },

    {
      name: 'predict_outcome',
      description: 'ML-powered predictions about project outcomes. Predict probability of on-time delivery, risk of scope creep, team burnout likelihood, and resource bottlenecks based on historical patterns.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['delivery', 'risk', 'burnout', 'bottleneck', 'comprehensive'], description: 'Prediction type' },
          project: { type: 'string', description: 'Project name or ID' },
          horizon: { type: 'string', description: 'Prediction horizon: "1w", "2w", "1m", "3m" (default: 2w)' }
        },
        required: ['type']
      }
    }
  ];
}
