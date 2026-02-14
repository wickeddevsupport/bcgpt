/**
 * Wave 1: PM OS Foundation Tools
 * Conversational Memory, Time Machine, Operation Log & Undo
 */

export function getWave1Tools() {
  return [
    // ===== Reference Resolution =====
    {
      name: 'resolve_reference',
      description: 'Resolve a natural language reference like "that project", "it", or "the task I mentioned" to a specific entity. Uses conversational memory to find the most recently discussed entity matching the reference.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: {
            type: 'string',
            description: 'The reference to resolve, e.g. "that project", "the person I mentioned", "it", "this task"'
          },
          type: {
            type: 'string',
            enum: ['project', 'person', 'task', 'board', 'message', 'todolist', 'todo', 'comment'],
            description: 'Optional entity type hint to narrow the search'
          }
        },
        required: ['ref']
      }
    },

    // ===== Time Machine =====
    {
      name: 'what_changed_since',
      description: 'Show what changed on a project, task, or other entity since a given time. Uses snapshots to compute diffs and returns human-readable change summaries. Great for "what happened since yesterday?" or "show me changes this week".',
      inputSchema: {
        type: 'object',
        properties: {
          entity_type: {
            type: 'string',
            description: 'Type of entity: project, task, todolist, person, board, message'
          },
          entity_id: {
            type: 'string',
            description: 'Specific entity ID. If omitted, shows changes across all entities of the given type.'
          },
          since: {
            type: 'string',
            description: 'Start time — ISO timestamp or natural language like "yesterday", "last week", "2 hours ago", "Monday"'
          },
          until: {
            type: 'string',
            description: 'End time (optional, defaults to now). ISO timestamp or natural language.'
          }
        },
        required: ['entity_type', 'since']
      }
    },
    {
      name: 'who_did_what',
      description: 'Show activity by a specific person or the current user. Returns a timeline of operations performed, including what was created, changed, or moved. Great for standup summaries and accountability.',
      inputSchema: {
        type: 'object',
        properties: {
          person: {
            type: 'string',
            description: 'Person name, email, or user_key. Defaults to the current user if omitted.'
          },
          since: {
            type: 'string',
            description: 'Start time — ISO timestamp or natural language like "yesterday", "this week"'
          },
          until: {
            type: 'string',
            description: 'End time (optional, defaults to now)'
          },
          project: {
            type: 'string',
            description: 'Optional project name or ID to filter activities'
          }
        },
        required: ['since']
      }
    },

    // ===== Operation Log & Undo =====
    {
      name: 'undo_last',
      description: 'Undo the last operation(s) performed. Reverses the most recent write operation by executing its inverse (e.g., delete what was created, restore what was deleted). Safe and audited.',
      inputSchema: {
        type: 'object',
        properties: {
          count: {
            type: 'number',
            description: 'Number of operations to undo (default 1, max 5)'
          }
        },
        required: []
      }
    },
    {
      name: 'undo_operation',
      description: 'Undo a specific operation by its ID. Use list_recent_operations to find the ID.',
      inputSchema: {
        type: 'object',
        properties: {
          operation_id: {
            type: 'string',
            description: 'The operation ID to undo (from operation log)'
          }
        },
        required: ['operation_id']
      }
    },
    {
      name: 'list_recent_operations',
      description: 'List recent operations performed by the current user. Shows what actions were taken, when, and whether they can be undone. Useful for reviewing history before undoing.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Max operations to return (default 20)'
          },
          since: {
            type: 'string',
            description: 'Only show operations after this time'
          },
          type: {
            type: 'string',
            description: 'Filter by operation type (e.g. "create_task", "assign", "move_card")'
          }
        },
        required: []
      }
    }
  ];
}
