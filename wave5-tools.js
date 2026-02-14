/**
 * Wave 5: Knowledge Tools
 * Semantic Search, Decision Extraction, Retrospectives, Expert Finder, Snapshot Comparison
 */
export function getWave5Tools() {
  return [
    {
      name: 'search_knowledge',
      description: 'Semantic search across all project data — messages, comments, tasks, documents. Finds relevant content by meaning, not just keywords. Searches titles, descriptions, and cached content. Great for "find all discussions about the redesign" or "what was decided about pricing?"',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          scope: { type: 'string', enum: ['all', 'messages', 'comments', 'tasks', 'projects'], description: 'Limit search to specific entity types (default: all)' },
          project: { type: 'string', description: 'Optional: limit search to a specific project' },
          limit: { type: 'number', description: 'Max results to return (default: 10)' }
        },
        required: ['query']
      }
    },

    {
      name: 'extract_decisions',
      description: 'Auto-extract decisions, action items, and key outcomes from project messages and comments. Looks for patterns like "decided to", "agreed on", "action item:", "we will", "going with". Returns a structured decision log.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name or ID to extract decisions from' },
          period: { type: 'string', description: 'Time period: "7d", "30d", "90d", "all" (default: 30d)' },
          type: { type: 'string', enum: ['decisions', 'action_items', 'outcomes', 'all'], description: 'What to extract (default: all)' }
        },
        required: ['project']
      }
    },

    {
      name: 'generate_retrospective',
      description: 'Auto-generate a project retrospective (postmortem). Analyzes completed tasks, velocity, blockers, and team dynamics to produce a "What went well / What didn\'t / Action items" report.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name or ID' },
          period: { type: 'string', description: 'Time period for retrospective: "7d", "14d", "30d", "sprint" (default: 14d)' },
          format: { type: 'string', enum: ['standard', 'start_stop_continue', '4ls', 'brief'], description: 'Retrospective format (default: standard - What went well / What didn\'t / Action items)' }
        },
        required: ['project']
      }
    },

    {
      name: 'find_expert',
      description: 'Find who knows the most about a topic by analyzing task assignments, message authorship, and comment activity. Answer "Who knows about X?" or "Who worked on the payment system?"',
      inputSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Topic or keyword to find experts for, e.g. "payments", "API design", "onboarding"' },
          limit: { type: 'number', description: 'Max number of experts to return (default: 5)' }
        },
        required: ['topic']
      }
    },

    {
      name: 'compare_snapshots',
      description: 'Compare two points in time to see what changed. Uses the snapshot system to diff project state. See what tasks were added, completed, or modified between two dates.',
      inputSchema: {
        type: 'object',
        properties: {
          entity_type: { type: 'string', description: 'Entity type to compare: "project", "todolist", "todo"' },
          entity_id: { type: 'string', description: 'Entity ID to compare' },
          from_date: { type: 'string', description: 'Start date (ISO format or relative like "7d ago")' },
          to_date: { type: 'string', description: 'End date (ISO format or "now", default: now)' }
        },
        required: ['entity_type']
      }
    }
  ];
}
