/**
 * Server Methods: Multi-Agent Orchestration
 * 
 * WebSocket handlers for parallel agent execution and coordination.
 */

import { z } from 'zod';
import type { ClientContext } from '../client.js';
import {
  createTask,
  executeParallel,
  broadcast,
  coordinate,
  getTaskStatus,
  cancelTask,
  getAgentTasks,
  getRunningTasks,
  getBroadcastHistory,
  createAgentFromTemplate,
  getAgentTemplates,
  AGENT_TEMPLATES,
  type AgentWorkflow,
  type OrchestrationPattern,
} from '../agent-orchestrator.js';

// Input schemas
const ParallelExecutionSchema = z.object({
  agents: z.array(z.string()).min(1),
  tasks: z.array(z.object({
    agentId: z.string(),
    payload: z.any(),
  })),
});

const BroadcastSchema = z.object({
  toAgentIds: z.array(z.string()),
  type: z.enum(['task', 'result', 'query', 'notification', 'coordination']),
  payload: z.any(),
});

const CoordinateSchema = z.object({
  workflow: z.object({
    id: z.string(),
    name: z.string(),
    pattern: z.enum(['parallel', 'sequential', 'pipeline', 'fan-out', 'fan-in', 'map-reduce']),
    agents: z.array(z.string()),
    tasks: z.array(z.object({
      id: z.string(),
      agentId: z.string(),
      dependsOn: z.array(z.string()).optional(),
      timeout: z.number().optional(),
      payload: z.any().optional(),
    })),
    onCompletion: z.object({
      aggregate: z.enum(['concat', 'merge', 'summarize', 'vote']),
      target: z.string().optional(),
    }).optional(),
  }),
});

const TaskStatusSchema = z.object({
  taskId: z.string(),
});

const AgentTasksSchema = z.object({
  agentId: z.string(),
});

const TemplateCreateSchema = z.object({
  templateId: z.string(),
  customizations: z.object({
    name: z.string().optional(),
    model: z.string().optional(),
    tools: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
  }).optional(),
});

/**
 * Handle parallel execution command
 */
export async function handleParallelExecution(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; results?: unknown[]; message?: string }> {
  const parsed = ParallelExecutionSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  try {
    const results = await executeParallel(
      parsed.data.agents,
      parsed.data.tasks,
      client
    );
    
    return {
      success: true,
      results,
    };
  } catch (error) {
    return {
      success: false,
      message: `Execution failed: ${error}`,
    };
  }
}

/**
 * Handle broadcast command
 */
export async function handleAgentBroadcast(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; broadcast?: unknown }> {
  const parsed = BroadcastSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  const agentId = client.agentId || 'main';
  
  const broadcastResult = broadcast(
    agentId,
    parsed.data.toAgentIds,
    parsed.data.type,
    parsed.data.payload
  );
  
  return {
    success: true,
    broadcast: broadcastResult,
  };
}

/**
 * Handle orchestration command
 */
export async function handleOrchestration(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; results?: unknown[]; message?: string }> {
  const parsed = CoordinateSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  try {
    const workflow: AgentWorkflow = {
      ...parsed.data.workflow,
      tasks: parsed.data.workflow.tasks.map(t => ({
        ...t,
        payload: t.payload || {},
      })),
    };
    
    const results = await coordinate(workflow, client);
    
    return {
      success: true,
      results,
    };
  } catch (error) {
    return {
      success: false,
      message: `Orchestration failed: ${error}`,
    };
  }
}

/**
 * Handle task status query
 */
export async function handleTaskStatusQuery(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; task?: unknown }> {
  const parsed = TaskStatusSchema.safeParse(params);
  
  if (!parsed.success) {
    return { success: false };
  }
  
  const task = getTaskStatus(parsed.data.taskId);
  
  return {
    success: true,
    task,
  };
}

/**
 * Handle task cancellation
 */
export async function handleTaskCancel(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; message: string }> {
  const parsed = TaskStatusSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: 'Invalid parameters',
    };
  }
  
  const cancelled = cancelTask(parsed.data.taskId);
  
  return {
    success: cancelled,
    message: cancelled ? 'Task cancelled' : 'Task not found or already completed',
  };
}

/**
 * Handle agent tasks query
 */
export async function handleAgentTasksQuery(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; tasks?: unknown[] }> {
  const parsed = AgentTasksSchema.safeParse(params);
  
  if (!parsed.success) {
    return { success: false };
  }
  
  const tasks = getAgentTasks(parsed.data.agentId);
  
  return {
    success: true,
    tasks,
  };
}

/**
 * Handle running tasks query
 */
export async function handleRunningTasksQuery(
  _params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; tasks: unknown[] }> {
  const tasks = getRunningTasks();
  
  return {
    success: true,
    tasks,
  };
}

/**
 * Handle broadcast history query
 */
export async function handleBroadcastHistoryQuery(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; history: unknown[] }> {
  const schema = z.object({ limit: z.number().optional() }).optional();
  const parsed = schema.safeParse(params);
  const limit = parsed.success ? parsed.data?.limit : 100;
  
  const history = getBroadcastHistory(limit);
  
  return {
    success: true,
    history,
  };
}

/**
 * Handle template list query
 */
export async function handleTemplateListQuery(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; templates: typeof AGENT_TEMPLATES }> {
  const schema = z.object({
    category: z.enum(['sales', 'support', 'dev', 'pm', 'marketing', 'research', 'general']).optional(),
  }).optional();
  
  const parsed = schema.safeParse(params);
  const category = parsed.success ? parsed.data?.category : undefined;
  
  const templates = getAgentTemplates(category);
  
  return {
    success: true,
    templates,
  };
}

/**
 * Handle template-based agent creation
 */
export async function handleTemplateCreate(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; template?: unknown; message?: string }> {
  const parsed = TemplateCreateSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  const template = createAgentFromTemplate(
    parsed.data.templateId,
    parsed.data.customizations
  );
  
  if (!template) {
    return {
      success: false,
      message: `Template not found: ${parsed.data.templateId}`,
    };
  }
  
  // In a real implementation, this would save to config
  // For now, we return the template configuration
  
  return {
    success: true,
    template,
    message: `Agent template "${template.name}" created`,
  };
}

export default {
  handleParallelExecution,
  handleAgentBroadcast,
  handleOrchestration,
  handleTaskStatusQuery,
  handleTaskCancel,
  handleAgentTasksQuery,
  handleRunningTasksQuery,
  handleBroadcastHistoryQuery,
  handleTemplateListQuery,
  handleTemplateCreate,
};