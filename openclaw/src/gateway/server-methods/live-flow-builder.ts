/**
 * Server Methods: Live Flow Builder
 * 
 * WebSocket handlers for real-time workflow canvas updates.
 */

import { z } from 'zod';
import type { ClientContext } from '../client.js';
import {
  subscribeToCanvas,
  unsubscribeFromCanvas,
  subscribeToExecutions,
  unsubscribeFromExecutions,
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
  type NodePosition,
} from '../live-flow-builder.js';

// Input schemas
const WorkflowIdSchema = z.object({
  workflowId: z.string(),
});

const NodeMoveSchema = z.object({
  workflowId: z.string(),
  nodeId: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

const NodeAddSchema = z.object({
  workflowId: z.string(),
  node: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    typeVersion: z.number(),
    position: z.tuple([z.number(), z.number()]),
    parameters: z.record(z.any()).optional(),
  }),
});

const NodeRemoveSchema = z.object({
  workflowId: z.string(),
  nodeId: z.string(),
});

const ConnectionSchema = z.object({
  workflowId: z.string(),
  fromNode: z.string(),
  toNode: z.string(),
  fromOutput: z.number().optional(),
});

const FlowControlSchema = z.object({
  workflowId: z.string(),
  action: z.enum(['activate', 'deactivate', 'execute', 'pause', 'resume', 'rollback']),
});

const TemplateSearchSchema = z.object({
  query: z.string().optional(),
  category: z.enum(['automation', 'integration', 'notification', 'data', 'communication']).optional(),
  tags: z.array(z.string()).optional(),
});

const TemplateDeploySchema = z.object({
  templateId: z.string(),
  name: z.string().optional(),
  config: z.record(z.any()).optional(),
});

/**
 * Handle canvas subscription
 */
export async function handleCanvasSubscribe(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; message: string }> {
  const parsed = WorkflowIdSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  const clientId = client.sessionId || 'unknown';
  subscribeToCanvas(parsed.data.workflowId, clientId);
  
  return {
    success: true,
    message: `Subscribed to canvas updates for workflow ${parsed.data.workflowId}`,
  };
}

/**
 * Handle canvas unsubscription
 */
export async function handleCanvasUnsubscribe(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; message: string }> {
  const parsed = WorkflowIdSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  const clientId = client.sessionId || 'unknown';
  unsubscribeFromCanvas(parsed.data.workflowId, clientId);
  
  return {
    success: true,
    message: `Unsubscribed from canvas updates for workflow ${parsed.data.workflowId}`,
  };
}

/**
 * Handle execution subscription
 */
export async function handleExecutionSubscribe(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; message: string }> {
  const parsed = WorkflowIdSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  const clientId = client.sessionId || 'unknown';
  subscribeToExecutions(parsed.data.workflowId, clientId);
  
  return {
    success: true,
    message: `Subscribed to execution events for workflow ${parsed.data.workflowId}`,
  };
}

/**
 * Handle execution unsubscription
 */
export async function handleExecutionUnsubscribe(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; message: string }> {
  const parsed = WorkflowIdSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  const clientId = client.sessionId || 'unknown';
  unsubscribeFromExecutions(parsed.data.workflowId, clientId);
  
  return {
    success: true,
    message: `Unsubscribed from execution events for workflow ${parsed.data.workflowId}`,
  };
}

/**
 * Handle pending updates fetch
 */
export async function handlePendingUpdatesFetch(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; updates?: unknown[] }> {
  const parsed = WorkflowIdSchema.safeParse(params);
  
  if (!parsed.success) {
    return { success: false };
  }
  
  const updates = getPendingUpdates(parsed.data.workflowId);
  
  return {
    success: true,
    updates,
  };
}

/**
 * Handle execution history fetch
 */
export async function handleExecutionHistoryFetch(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; history?: unknown[] }> {
  const schema = WorkflowIdSchema.extend({ limit: z.number().optional() });
  const parsed = schema.safeParse(params);
  
  if (!parsed.success) {
    return { success: false };
  }
  
  const history = getExecutionHistory(
    parsed.data.workflowId,
    parsed.data.limit
  );
  
  return {
    success: true,
    history,
  };
}

/**
 * Handle flow control command
 */
export async function handleFlowControl(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; message: string; data?: unknown }> {
  const parsed = FlowControlSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  const result = await executeFlowControl(
    parsed.data.action,
    parsed.data.workflowId,
    client
  );
  
  return {
    success: result.success,
    message: result.message,
    data: result.data,
  };
}

/**
 * Handle node move command
 */
export async function handleNodeMove(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; message: string }> {
  const parsed = NodeMoveSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  updateNodePosition(
    parsed.data.workflowId,
    parsed.data.nodeId,
    parsed.data.position as NodePosition
  );
  
  return {
    success: true,
    message: `Node ${parsed.data.nodeId} moved`,
  };
}

/**
 * Handle node add command
 */
export async function handleNodeAdd(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; message: string }> {
  const parsed = NodeAddSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  addNode(parsed.data.workflowId, parsed.data.node as any);
  
  return {
    success: true,
    message: `Node ${parsed.data.node.name} added`,
  };
}

/**
 * Handle node remove command
 */
export async function handleNodeRemove(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; message: string }> {
  const parsed = NodeRemoveSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  removeNode(parsed.data.workflowId, parsed.data.nodeId);
  
  return {
    success: true,
    message: `Node ${parsed.data.nodeId} removed`,
  };
}

/**
 * Handle connection add command
 */
export async function handleConnectionAdd(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; message: string }> {
  const parsed = ConnectionSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  addConnection(
    parsed.data.workflowId,
    parsed.data.fromNode,
    parsed.data.toNode,
    parsed.data.fromOutput
  );
  
  return {
    success: true,
    message: `Connection added from ${parsed.data.fromNode} to ${parsed.data.toNode}`,
  };
}

/**
 * Handle connection remove command
 */
export async function handleConnectionRemove(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; message: string }> {
  const parsed = ConnectionSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  removeConnection(
    parsed.data.workflowId,
    parsed.data.fromNode,
    parsed.data.toNode
  );
  
  return {
    success: true,
    message: `Connection removed from ${parsed.data.fromNode} to ${parsed.data.toNode}`,
  };
}

/**
 * Handle template search
 */
export async function handleTemplateSearch(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; templates?: unknown[] }> {
  const parsed = TemplateSearchSchema.safeParse(params);
  
  const templates = searchTemplates(
    parsed.success ? parsed.data.query : undefined,
    parsed.success ? parsed.data.category : undefined,
    parsed.success ? parsed.data.tags : undefined
  );
  
  return {
    success: true,
    templates,
  };
}

/**
 * Handle featured templates fetch
 */
export async function handleFeaturedTemplatesFetch(
  _params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; templates: unknown[] }> {
  const templates = getFeaturedTemplates();
  
  return {
    success: true,
    templates,
  };
}

/**
 * Handle template deployment
 */
export async function handleTemplateDeployment(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; message: string; workflow?: unknown }> {
  const parsed = TemplateDeploySchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  const workspaceId = client.pmosWorkspaceId;
  if (!workspaceId) {
    return {
      success: false,
      message: 'Workspace context required for template deployment',
    };
  }
  
  const workflow = await deployTemplate(
    parsed.data.templateId,
    workspaceId,
    parsed.data
  );
  
  if (!workflow) {
    return {
      success: false,
      message: `Template not found: ${parsed.data.templateId}`,
    };
  }
  
  return {
    success: true,
    message: `Template deployed as workflow "${workflow.name}"`,
    workflow,
  };
}

/**
 * Handle flow builder status query
 */
export async function handleFlowBuilderStatusQuery(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; status?: unknown }> {
  const parsed = WorkflowIdSchema.safeParse(params);
  
  if (!parsed.success) {
    return { success: false };
  }
  
  const status = getFlowBuilderStatus(parsed.data.workflowId);
  
  return {
    success: true,
    status,
  };
}

/**
 * Handle workflow library list
 */
export async function handleWorkflowLibraryList(
  _params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; library: typeof WORKFLOW_LIBRARY }> {
  return {
    success: true,
    library: WORKFLOW_LIBRARY,
  };
}

export default {
  handleCanvasSubscribe,
  handleCanvasUnsubscribe,
  handleExecutionSubscribe,
  handleExecutionUnsubscribe,
  handlePendingUpdatesFetch,
  handleExecutionHistoryFetch,
  handleFlowControl,
  handleNodeMove,
  handleNodeAdd,
  handleNodeRemove,
  handleConnectionAdd,
  handleConnectionRemove,
  handleTemplateSearch,
  handleFeaturedTemplatesFetch,
  handleTemplateDeployment,
  handleFlowBuilderStatusQuery,
  handleWorkflowLibraryList,
};