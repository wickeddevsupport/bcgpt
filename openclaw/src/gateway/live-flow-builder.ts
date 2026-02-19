/**
 * Live Flow Builder - Real-Time Workflow Canvas
 * 
 * Provides real-time workflow editing with WebSocket updates,
 * flow control panel, and template library integration.
 */

import type { Workflow } from './n8n-workspace-triggers.js';
import type { ClientContext } from './client.js';

// Canvas node position
export interface NodePosition {
  x: number;
  y: number;
}

// Canvas update event
export interface CanvasUpdate {
  type: 'node_add' | 'node_remove' | 'node_move' | 'node_update' | 
        'connection_add' | 'connection_remove' | 'workflow_activate' | 'workflow_deactivate';
  workflowId: string;
  timestamp: Date;
  data: unknown;
}

// Flow execution event
export interface FlowExecutionEvent {
  type: 'execution_start' | 'execution_end' | 'node_start' | 'node_end' | 'node_error';
  workflowId: string;
  executionId: string;
  nodeId?: string;
  timestamp: Date;
  data?: unknown;
  error?: string;
}

// Flow control action
export type FlowControlAction = 
  | 'activate' 
  | 'deactivate' 
  | 'execute' 
  | 'pause' 
  | 'resume' 
  | 'rollback';

// Flow control result
export interface FlowControlResult {
  success: boolean;
  action: FlowControlAction;
  workflowId: string;
  message: string;
  data?: unknown;
}

// Workflow template for library
export interface WorkflowTemplateItem {
  id: string;
  name: string;
  description: string;
  category: 'automation' | 'integration' | 'notification' | 'data' | 'communication';
  tags: string[];
  workflow: Partial<Workflow>;
  popularity: number;
  featured: boolean;
}

// WebSocket subscribers per workflow
const canvasSubscribers: Map<string, Set<string>> = new Map();
const executionSubscribers: Map<string, Set<string>> = new Map();

// Pending canvas updates (for batching)
const pendingUpdates: Map<string, CanvasUpdate[]> = new Map();

// Execution history
const executionHistory: Map<string, FlowExecutionEvent[]> = new Map();

// Workflow template library
export const WORKFLOW_LIBRARY: WorkflowTemplateItem[] = [
  {
    id: 'template-webhook-slack',
    name: 'Webhook to Slack Notification',
    description: 'Receive webhook data and send it to a Slack channel',
    category: 'notification',
    tags: ['webhook', 'slack', 'notification', 'real-time'],
    popularity: 95,
    featured: true,
    workflow: {
      name: 'Webhook to Slack',
      nodes: [
        {
          id: 'webhook-1',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [250, 300],
          parameters: { httpMethod: 'POST', path: 'slack-notify' },
        },
        {
          id: 'slack-1',
          name: 'Slack',
          type: 'n8n-nodes-base.slack',
          typeVersion: 1,
          position: [450, 300],
          parameters: { operation: 'postMessage', channel: '#notifications' },
        },
      ],
      connections: {
        'Webhook': { main: [[{ node: 'Slack', type: 'main', index: 0 }]] },
      },
    },
  },
  {
    id: 'template-scheduled-report',
    name: 'Scheduled Report Generator',
    description: 'Generate and email a report on a schedule',
    category: 'automation',
    tags: ['schedule', 'report', 'email', 'automation'],
    popularity: 88,
    featured: true,
    workflow: {
      name: 'Scheduled Report',
      nodes: [
        {
          id: 'schedule-1',
          name: 'Schedule',
          type: 'n8n-nodes-base.scheduleTrigger',
          typeVersion: 1,
          position: [250, 300],
          parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 24 }] } },
        },
        {
          id: 'http-1',
          name: 'Fetch Data',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 1,
          position: [450, 300],
          parameters: { url: 'https://api.example.com/report', method: 'GET' },
        },
        {
          id: 'email-1',
          name: 'Send Email',
          type: 'n8n-nodes-base.emailSend',
          typeVersion: 1,
          position: [650, 300],
          parameters: { to: 'team@example.com', subject: 'Daily Report' },
        },
      ],
      connections: {
        'Schedule': { main: [[{ node: 'Fetch Data', type: 'main', index: 0 }]] },
        'Fetch Data': { main: [[{ node: 'Send Email', type: 'main', index: 0 }]] },
      },
    },
  },
  {
    id: 'template-github-slack',
    name: 'GitHub Events to Slack',
    description: 'Send GitHub events (issues, PRs, pushes) to Slack',
    category: 'integration',
    tags: ['github', 'slack', 'integration', 'devops'],
    popularity: 92,
    featured: true,
    workflow: {
      name: 'GitHub to Slack',
      nodes: [
        {
          id: 'github-1',
          name: 'GitHub Trigger',
          type: 'n8n-nodes-base.githubTrigger',
          typeVersion: 1,
          position: [250, 300],
          parameters: { events: ['issues', 'pull_request', 'push'] },
        },
        {
          id: 'slack-1',
          name: 'Slack',
          type: 'n8n-nodes-base.slack',
          typeVersion: 1,
          position: [450, 300],
          parameters: { operation: 'postMessage', channel: '#github' },
        },
      ],
      connections: {
        'GitHub Trigger': { main: [[{ node: 'Slack', type: 'main', index: 0 }]] },
      },
    },
  },
  {
    id: 'template-basecamp-sync',
    name: 'Basecamp Todo Sync',
    description: 'Sync Basecamp todos to another service',
    category: 'integration',
    tags: ['basecamp', 'sync', 'productivity'],
    popularity: 75,
    featured: false,
    workflow: {
      name: 'Basecamp Sync',
      nodes: [
        {
          id: 'basecamp-1',
          name: 'Basecamp Trigger',
          type: 'n8n-nodes-basecamp',
          typeVersion: 1,
          position: [250, 300],
          parameters: { event: 'todo_created' },
        },
        {
          id: 'transform-1',
          name: 'Transform',
          type: 'n8n-nodes-base.set',
          typeVersion: 1,
          position: [450, 300],
          parameters: {},
        },
      ],
      connections: {
        'Basecamp Trigger': { main: [[{ node: 'Transform', type: 'main', index: 0 }]] },
      },
    },
  },
  {
    id: 'template-ai-response',
    name: 'AI-Powered Response',
    description: 'Use AI to generate responses to incoming messages',
    category: 'automation',
    tags: ['ai', 'automation', 'response', 'nlp'],
    popularity: 85,
    featured: true,
    workflow: {
      name: 'AI Response',
      nodes: [
        {
          id: 'trigger-1',
          name: 'Message Trigger',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 1,
          position: [250, 300],
          parameters: { httpMethod: 'POST' },
        },
        {
          id: 'ai-1',
          name: 'OpenAI',
          type: 'n8n-nodes-base.openAi',
          typeVersion: 1,
          position: [450, 300],
          parameters: { operation: 'message', model: 'gpt-4' },
        },
        {
          id: 'response-1',
          name: 'Response',
          type: 'n8n-nodes-base.respondToWebhook',
          typeVersion: 1,
          position: [650, 300],
          parameters: {},
        },
      ],
      connections: {
        'Message Trigger': { main: [[{ node: 'OpenAI', type: 'main', index: 0 }]] },
        'OpenAI': { main: [[{ node: 'Response', type: 'main', index: 0 }]] },
      },
    },
  },
  {
    id: 'template-database-backup',
    name: 'Database Backup',
    description: 'Regularly backup database to cloud storage',
    category: 'data',
    tags: ['database', 'backup', 'cloud', 'automation'],
    popularity: 70,
    featured: false,
    workflow: {
      name: 'Database Backup',
      nodes: [
        {
          id: 'schedule-1',
          name: 'Schedule',
          type: 'n8n-nodes-base.scheduleTrigger',
          typeVersion: 1,
          position: [250, 300],
          parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 24 }] } },
        },
        {
          id: 'db-1',
          name: 'Database',
          type: 'n8n-nodes-base.postgres',
          typeVersion: 1,
          position: [450, 300],
          parameters: { operation: 'executeQuery' },
        },
        {
          id: 'storage-1',
          name: 'Cloud Storage',
          type: 'n8n-nodes-base.googleDrive',
          typeVersion: 1,
          position: [650, 300],
          parameters: { operation: 'upload' },
        },
      ],
      connections: {
        'Schedule': { main: [[{ node: 'Database', type: 'main', index: 0 }]] },
        'Database': { main: [[{ node: 'Cloud Storage', type: 'main', index: 0 }]] },
      },
    },
  },
];

/**
 * Subscribe a client to workflow canvas updates
 */
export function subscribeToCanvas(workflowId: string, clientId: string): void {
  if (!canvasSubscribers.has(workflowId)) {
    canvasSubscribers.set(workflowId, new Set());
  }
  canvasSubscribers.get(workflowId)!.add(clientId);
}

/**
 * Unsubscribe a client from workflow canvas updates
 */
export function unsubscribeFromCanvas(workflowId: string, clientId: string): void {
  const subscribers = canvasSubscribers.get(workflowId);
  if (subscribers) {
    subscribers.delete(clientId);
    if (subscribers.size === 0) {
      canvasSubscribers.delete(workflowId);
    }
  }
}

/**
 * Subscribe to execution events
 */
export function subscribeToExecutions(workflowId: string, clientId: string): void {
  if (!executionSubscribers.has(workflowId)) {
    executionSubscribers.set(workflowId, new Set());
  }
  executionSubscribers.get(workflowId)!.add(clientId);
}

/**
 * Unsubscribe from execution events
 */
export function unsubscribeFromExecutions(workflowId: string, clientId: string): void {
  const subscribers = executionSubscribers.get(workflowId);
  if (subscribers) {
    subscribers.delete(clientId);
    if (subscribers.size === 0) {
      executionSubscribers.delete(workflowId);
    }
  }
}

/**
 * Emit a canvas update to all subscribers
 */
export function emitCanvasUpdate(update: CanvasUpdate): void {
  const subscribers = canvasSubscribers.get(update.workflowId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }
  
  // In a real implementation, this would send via WebSocket
  // For now, we queue it for polling
  if (!pendingUpdates.has(update.workflowId)) {
    pendingUpdates.set(update.workflowId, []);
  }
  pendingUpdates.get(update.workflowId)!.push(update);
}

/**
 * Emit an execution event
 */
export function emitExecutionEvent(event: FlowExecutionEvent): void {
  const subscribers = executionSubscribers.get(event.workflowId);
  if (!subscribers) {
    return;
  }
  
  // Store in history
  if (!executionHistory.has(event.workflowId)) {
    executionHistory.set(event.workflowId, []);
  }
  executionHistory.get(event.workflowId)!.push(event);
  
  // In a real implementation, this would send via WebSocket
}

/**
 * Get pending updates for a workflow
 */
export function getPendingUpdates(workflowId: string): CanvasUpdate[] {
  const updates = pendingUpdates.get(workflowId) || [];
  pendingUpdates.delete(workflowId);
  return updates;
}

/**
 * Get execution history for a workflow
 */
export function getExecutionHistory(workflowId: string, limit = 100): FlowExecutionEvent[] {
  const history = executionHistory.get(workflowId) || [];
  return history.slice(-limit);
}

/**
 * Execute a flow control action
 */
export async function executeFlowControl(
  action: FlowControlAction,
  workflowId: string,
  client: ClientContext
): Promise<FlowControlResult> {
  const workspaceId = client.pmosWorkspaceId;
  
  // Import n8n API client for real operations
  const { 
    setWorkflowActive, 
    executeN8nWorkflow, 
    getN8nWorkflow,
    getN8nExecution,
    cancelN8nExecution,
  } = await import('./n8n-api-client.js');
  
  switch (action) {
    case 'activate': {
      if (!workspaceId) {
        return {
          success: false,
          action,
          workflowId,
          message: 'Workspace context required for workflow activation',
        };
      }
      
      const result = await setWorkflowActive(workspaceId, workflowId, true);
      
      if (!result.ok) {
        return {
          success: false,
          action,
          workflowId,
          message: `Failed to activate workflow: ${result.error}`,
        };
      }
      
      emitCanvasUpdate({
        type: 'workflow_activate',
        workflowId,
        timestamp: new Date(),
        data: { active: true },
      });
      
      return {
        success: true,
        action,
        workflowId,
        message: `Workflow ${workflowId} activated successfully`,
        data: result.workflow,
      };
    }
      
    case 'deactivate': {
      if (!workspaceId) {
        return {
          success: false,
          action,
          workflowId,
          message: 'Workspace context required for workflow deactivation',
        };
      }
      
      const result = await setWorkflowActive(workspaceId, workflowId, false);
      
      if (!result.ok) {
        return {
          success: false,
          action,
          workflowId,
          message: `Failed to deactivate workflow: ${result.error}`,
        };
      }
      
      emitCanvasUpdate({
        type: 'workflow_deactivate',
        workflowId,
        timestamp: new Date(),
        data: { active: false },
      });
      
      return {
        success: true,
        action,
        workflowId,
        message: `Workflow ${workflowId} deactivated successfully`,
        data: result.workflow,
      };
    }
      
    case 'execute': {
      if (!workspaceId) {
        return {
          success: false,
          action,
          workflowId,
          message: 'Workspace context required for workflow execution',
        };
      }
      
      const result = await executeN8nWorkflow(workspaceId, workflowId);
      
      if (!result.ok) {
        return {
          success: false,
          action,
          workflowId,
          message: `Failed to execute workflow: ${result.error}`,
        };
      }
      
      emitExecutionEvent({
        type: 'execution_start',
        workflowId,
        executionId: result.executionId || `exec-${crypto.randomUUID()}`,
        timestamp: new Date(),
      });
      
      return {
        success: true,
        action,
        workflowId,
        message: `Workflow ${workflowId} execution started`,
        data: { executionId: result.executionId },
      };
    }
      
    case 'pause': {
      // n8n doesn't have a native "pause" action for executions
      // This would require storing execution state and resuming later
      return {
        success: false,
        action,
        workflowId,
        message: `Pause action not directly supported by n8n. Use rollback for state management.`,
      };
    }
      
    case 'resume': {
      // Resume would require stored state from a previous pause
      return {
        success: false,
        action,
        workflowId,
        message: `Resume action requires a previously paused execution.`,
      };
    }
      
    case 'rollback': {
      if (!workspaceId) {
        return {
          success: false,
          action,
          workflowId,
          message: 'Workspace context required for workflow rollback',
        };
      }
      
      // Get the current workflow state
      const result = await getN8nWorkflow(workspaceId, workflowId);
      
      if (!result.ok) {
        return {
          success: false,
          action,
          workflowId,
          message: `Failed to get workflow for rollback: ${result.error}`,
        };
      }
      
      // For rollback, we deactivate and return the current state
      // A full implementation would track version history
      if (result.workflow?.active) {
        const deactivateResult = await setWorkflowActive(workspaceId, workflowId, false);
        if (!deactivateResult.ok) {
          return {
            success: false,
            action,
            workflowId,
            message: `Rollback failed: ${deactivateResult.error}`,
          };
        }
      }
      
      return {
        success: true,
        action,
        workflowId,
        message: `Workflow ${workflowId} rolled back to inactive state`,
        data: result.workflow,
      };
    }
      
    default:
      return {
        success: false,
        action,
        workflowId,
        message: `Unknown action: ${action}`,
      };
  }
}

/**
 * Update a node position on the canvas
 */
export function updateNodePosition(
  workflowId: string,
  nodeId: string,
  position: NodePosition
): void {
  emitCanvasUpdate({
    type: 'node_move',
    workflowId,
    timestamp: new Date(),
    data: { nodeId, position },
  });
}

/**
 * Add a node to the canvas
 */
export function addNode(
  workflowId: string,
  node: Workflow['nodes'][0]
): void {
  emitCanvasUpdate({
    type: 'node_add',
    workflowId,
    timestamp: new Date(),
    data: { node },
  });
}

/**
 * Remove a node from the canvas
 */
export function removeNode(workflowId: string, nodeId: string): void {
  emitCanvasUpdate({
    type: 'node_remove',
    workflowId,
    timestamp: new Date(),
    data: { nodeId },
  });
}

/**
 * Add a connection between nodes
 */
export function addConnection(
  workflowId: string,
  fromNode: string,
  toNode: string,
  fromOutput = 0
): void {
  emitCanvasUpdate({
    type: 'connection_add',
    workflowId,
    timestamp: new Date(),
    data: { fromNode, toNode, fromOutput },
  });
}

/**
 * Remove a connection between nodes
 */
export function removeConnection(
  workflowId: string,
  fromNode: string,
  toNode: string
): void {
  emitCanvasUpdate({
    type: 'connection_remove',
    workflowId,
    timestamp: new Date(),
    data: { fromNode, toNode },
  });
}

/**
 * Search the template library
 */
export function searchTemplates(
  query?: string,
  category?: WorkflowTemplateItem['category'],
  tags?: string[]
): WorkflowTemplateItem[] {
  let results = [...WORKFLOW_LIBRARY];
  
  if (category) {
    results = results.filter(t => t.category === category);
  }
  
  if (tags && tags.length > 0) {
    results = results.filter(t => 
      tags.some(tag => t.tags.includes(tag))
    );
  }
  
  if (query) {
    const lowerQuery = query.toLowerCase();
    results = results.filter(t =>
      t.name.toLowerCase().includes(lowerQuery) ||
      t.description.toLowerCase().includes(lowerQuery) ||
      t.tags.some(tag => tag.includes(lowerQuery))
    );
  }
  
  // Sort by popularity
  return results.sort((a, b) => b.popularity - a.popularity);
}

/**
 * Get featured templates
 */
export function getFeaturedTemplates(): WorkflowTemplateItem[] {
  return WORKFLOW_LIBRARY.filter(t => t.featured).sort((a, b) => b.popularity - a.popularity);
}

/**
 * Deploy a template as a new workflow
 */
export async function deployTemplate(
  templateId: string,
  workspaceId: string,
  customizations?: { name?: string; config?: Record<string, unknown> }
): Promise<Workflow | null> {
  const template = WORKFLOW_LIBRARY.find(t => t.id === templateId);
  
  if (!template) {
    return null;
  }
  
  const workflow: Workflow = {
    id: crypto.randomUUID(),
    name: customizations?.name || template.name,
    active: false,
    nodes: template.workflow.nodes || [],
    connections: template.workflow.connections || {},
    settings: template.workflow.settings || { executionOrder: 'v1' },
    staticData: null,
    tags: template.tags,
    triggerCount: 1,
    updatedAt: new Date().toISOString(),
    versionId: crypto.randomUUID(),
    workspaceId,
  };
  
  // Persist workflow to n8n via API
  const { createN8nWorkflow } = await import('./n8n-api-client.js');
  
  const result = await createN8nWorkflow(workspaceId, {
    name: workflow.name,
    active: false,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings,
    staticData: workflow.staticData,
    tags: workflow.tags,
    triggerCount: workflow.triggerCount,
    updatedAt: workflow.updatedAt,
    versionId: workflow.versionId,
  });
  
  if (!result.ok) {
    console.error(`[live-flow-builder] Failed to deploy template: ${result.error}`);
    // Return the local workflow object even if persistence failed
    // This allows the caller to see what would have been created
    return workflow;
  }
  
  // Return the persisted workflow with real ID
  return result.workflow as Workflow;
}

/**
 * Get flow builder status
 */
export function getFlowBuilderStatus(workflowId: string): {
  canvasSubscribers: number;
  executionSubscribers: number;
  pendingUpdates: number;
  recentExecutions: number;
} {
  return {
    canvasSubscribers: canvasSubscribers.get(workflowId)?.size || 0,
    executionSubscribers: executionSubscribers.get(workflowId)?.size || 0,
    pendingUpdates: pendingUpdates.get(workflowId)?.length || 0,
    recentExecutions: executionHistory.get(workflowId)?.length || 0,
  };
}

export default {
  subscribeToCanvas,
  unsubscribeFromCanvas,
  subscribeToExecutions,
  unsubscribeFromExecutions,
  emitCanvasUpdate,
  emitExecutionEvent,
  getPendingUpdates,
  getExecutionHistory,
  executeFlowControl,
  updateNodePosition,
  addNode,
  removeNode,
  addConnection,
  removeConnection,
  searchTemplates,
  getFeaturedTemplates,
  deployTemplate,
  getFlowBuilderStatus,
  WORKFLOW_LIBRARY,
};