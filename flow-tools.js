/**
 * Flow Tools - Activepieces Integration
 * Provides flow automation tools integrated into BCGPT
 */

import ActivepiecesClient from './activepieces-client.js';

let flowClient = null;

function getFlowClient() {
  if (!flowClient) {
    flowClient = new ActivepiecesClient();
  }
  return flowClient;
}

export function getFlowTools() {
  return [
    // Flow Management
    {
      name: 'flow_list',
      description: 'List all automation flows in Activepieces',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: {
            type: 'string',
            description: 'Optional project ID to filter flows'
          }
        },
        required: []
      }
    },
    {
      name: 'flow_get',
      description: 'Get details of a specific flow',
      inputSchema: {
        type: 'object',
        properties: {
          flow_id: {
            type: 'string',
            description: 'Flow ID'
          }
        },
        required: ['flow_id']
      }
    },
    {
      name: 'flow_create',
      description: 'Create a new automation flow',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Flow name'
          },
          trigger: {
            type: 'object',
            description: 'Trigger configuration'
          },
          actions: {
            type: 'array',
            description: 'Array of action steps',
            items: { type: 'object' }
          },
          project_id: {
            type: 'string',
            description: 'Project ID'
          }
        },
        required: ['name', 'trigger', 'project_id']
      }
    },
    {
      name: 'flow_update',
      description: 'Update an existing flow',
      inputSchema: {
        type: 'object',
        properties: {
          flow_id: {
            type: 'string',
            description: 'Flow ID'
          },
          data: {
            type: 'object',
            description: 'Flow data to update'
          }
        },
        required: ['flow_id', 'data']
      }
    },
    {
      name: 'flow_delete',
      description: 'Delete a flow',
      inputSchema: {
        type: 'object',
        properties: {
          flow_id: {
            type: 'string',
            description: 'Flow ID'
          }
        },
        required: ['flow_id']
      }
    },

    // Flow Execution
    {
      name: 'flow_trigger',
      description: 'Manually trigger a flow with optional payload',
      inputSchema: {
        type: 'object',
        properties: {
          flow_id: {
            type: 'string',
            description: 'Flow ID to trigger'
          },
          payload: {
            type: 'object',
            description: 'Data to pass to the flow',
            default: {}
          }
        },
        required: ['flow_id']
      }
    },
    {
      name: 'flow_runs_list',
      description: 'Get recent runs/executions of a flow',
      inputSchema: {
        type: 'object',
        properties: {
          flow_id: {
            type: 'string',
            description: 'Flow ID'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of runs to return',
            default: 10
          }
        },
        required: ['flow_id']
      }
    },
    {
      name: 'flow_run_get',
      description: 'Get details of a specific flow run',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: {
            type: 'string',
            description: 'Flow run ID'
          }
        },
        required: ['run_id']
      }
    },

    // Projects
    {
      name: 'flow_projects_list',
      description: 'List all Activepieces projects',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    },
    {
      name: 'flow_project_create',
      description: 'Create a new Activepieces project',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Project name'
          }
        },
        required: ['name']
      }
    },

    // Pieces (Available Integrations)
    {
      name: 'flow_pieces_list',
      description: 'List all available integration pieces (200+ services)',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    },

    // Connections (API Keys)
    {
      name: 'flow_connections_list',
      description: 'List configured connections/API keys for integrations',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: {
            type: 'string',
            description: 'Optional project ID to filter connections'
          }
        },
        required: []
      }
    },
    {
      name: 'flow_connection_create',
      description: 'Create a new connection/API key for an integration',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Connection name'
          },
          piece_name: {
            type: 'string',
            description: 'Name of the piece/integration'
          },
          value: {
            type: 'object',
            description: 'Authentication credentials'
          },
          project_id: {
            type: 'string',
            description: 'Project ID'
          }
        },
        required: ['name', 'piece_name', 'value', 'project_id']
      }
    },

    // Utility
    {
      name: 'flow_status',
      description: 'Get Flow integration status and statistics',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  ];
}

export async function handleFlowTool(toolName, args) {
  const client = getFlowClient();
  
  try {
    switch (toolName) {
      // Flow Management
      case 'flow_list':
        return await client.listFlows(args.project_id);
      
      case 'flow_get':
        return await client.getFlow(args.flow_id);
      
      case 'flow_create':
        return await client.createFlow({
          displayName: args.name,
          trigger: args.trigger,
          actions: args.actions || [],
          projectId: args.project_id
        });
      
      case 'flow_update':
        return await client.updateFlow(args.flow_id, args.data);
      
      case 'flow_delete':
        return await client.deleteFlow(args.flow_id);
      
      // Flow Execution
      case 'flow_trigger':
        return await client.triggerFlow(args.flow_id, args.payload || {});
      
      case 'flow_runs_list':
        return await client.listFlowRuns(args.flow_id, args.limit || 10);
      
      case 'flow_run_get':
        return await client.getFlowRun(args.run_id);
      
      // Projects
      case 'flow_projects_list':
        return await client.listProjects();
      
      case 'flow_project_create':
        return await client.createProject(args.name);
      
      // Pieces
      case 'flow_pieces_list':
        return await client.listPieces();
      
      // Connections
      case 'flow_connections_list':
        return await client.listConnections(args.project_id);
      
      case 'flow_connection_create':
        return await client.createConnection(
          args.name,
          args.piece_name,
          args.value,
          args.project_id
        );
      
      // Utility
      case 'flow_status':
        const projects = await client.listProjects();
        const flows = await client.listFlows();
        return {
          status: 'operational',
          activepieces: {
            url: client.baseUrl,
            connected: true,
            projects: projects.length || 0,
            flows: flows.length || 0
          },
          timestamp: Date.now()
        };
      
      default:
        throw new Error(`Unknown flow tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`Error executing flow tool ${toolName}:`, error);
    throw error;
  }
}
