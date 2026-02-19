/**
 * Multi-Agent Parallel Execution Orchestrator
 * 
 * Enables multiple agents to run in parallel, coordinate tasks,
 * and share results. Supports agent templates and orchestration patterns.
 */

import type { Agent } from '../config/schema.js';
import type { ClientContext } from './client.js';

// Agent task definition
export interface AgentTask {
  id: string;
  agentId: string;
  type: 'chat' | 'workflow' | 'automation' | 'monitoring';
  payload: unknown;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: unknown;
  error?: string;
}

// Agent execution result
export interface AgentResult {
  taskId: string;
  agentId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
}

// Orchestration pattern
export type OrchestrationPattern = 
  | 'parallel'      // All agents run simultaneously
  | 'sequential'    // Agents run one after another
  | 'pipeline'      // Output of one agent feeds the next
  | 'fan-out'       // One task splits to multiple agents
  | 'fan-in'        // Multiple agents contribute to one result
  | 'map-reduce';   // Distribute, process, aggregate

// Agent template definition
export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  category: 'sales' | 'support' | 'dev' | 'pm' | 'marketing' | 'research' | 'general';
  defaultModel: string;
  defaultTools: string[];
  systemPrompt?: string;
  skills?: string[];
  config: Partial<Agent>;
}

// Broadcast message for agent-to-agent communication
export interface AgentBroadcast {
  fromAgentId: string;
  toAgentIds: string[];
  type: 'task' | 'result' | 'query' | 'notification' | 'coordination';
  payload: unknown;
  timestamp: Date;
}

// Orchestration workflow
export interface AgentWorkflow {
  id: string;
  name: string;
  pattern: OrchestrationPattern;
  agents: string[]; // agent IDs
  tasks: Array<{
    id: string;
    agentId: string;
    dependsOn?: string[];
    timeout?: number;
  }>;
  onCompletion?: {
    aggregate: 'concat' | 'merge' | 'summarize' | 'vote';
    target?: string;
  };
}

// In-memory task queue
const taskQueue: Map<string, AgentTask> = new Map();
const runningTasks: Map<string, AbortController> = new Map();
const broadcastHistory: AgentBroadcast[] = [];

// Pre-built agent templates
export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'sales-agent',
    name: 'Sales Agent',
    description: 'Handles lead qualification, outreach, and CRM updates',
    category: 'sales',
    defaultModel: 'anthropic/claude-sonnet-4-5',
    defaultTools: ['read', 'web_search', 'message', 'exec'],
    systemPrompt: `You are a sales assistant. Help qualify leads, draft outreach emails, 
      and maintain CRM records. Always be professional and persuasive.`,
    config: {
      id: 'sales-agent',
      name: 'Sales Agent',
    },
  },
  {
    id: 'support-agent',
    name: 'Support Agent',
    description: 'Manages customer tickets, FAQs, and issue resolution',
    category: 'support',
    defaultModel: 'anthropic/claude-sonnet-4-5',
    defaultTools: ['read', 'web_search', 'message', 'exec', 'browser'],
    systemPrompt: `You are a customer support specialist. Help resolve customer issues 
      quickly and professionally. Escalate complex issues when needed.`,
    config: {
      id: 'support-agent',
      name: 'Support Agent',
    },
  },
  {
    id: 'dev-agent',
    name: 'Dev Agent',
    description: 'Monitors GitHub issues, PRs, and code quality',
    category: 'dev',
    defaultModel: 'anthropic/claude-opus-4-6',
    defaultTools: ['read', 'write', 'edit', 'exec', 'web_search', 'browser'],
    systemPrompt: `You are a developer assistant. Monitor code repositories, 
      review pull requests, and help with debugging and implementation.`,
    config: {
      id: 'dev-agent',
      name: 'Dev Agent',
    },
  },
  {
    id: 'pm-agent',
    name: 'PM Agent',
    description: 'Tracks project health, milestones, and team coordination',
    category: 'pm',
    defaultModel: 'anthropic/claude-sonnet-4-5',
    defaultTools: ['read', 'web_search', 'message', 'exec'],
    systemPrompt: `You are a project management assistant. Track project progress, 
      coordinate team efforts, and provide status updates.`,
    config: {
      id: 'pm-agent',
      name: 'PM Agent',
    },
  },
  {
    id: 'research-agent',
    name: 'Research Agent',
    description: 'Conducts web research, compiles reports, and summarizes findings',
    category: 'research',
    defaultModel: 'anthropic/claude-sonnet-4-5',
    defaultTools: ['read', 'web_search', 'web_fetch', 'browser'],
    systemPrompt: `You are a research assistant. Search the web for information, 
      compile reports, and summarize findings clearly.`,
    config: {
      id: 'research-agent',
      name: 'Research Agent',
    },
  },
  {
    id: 'marketing-agent',
    name: 'Marketing Agent',
    description: 'Handles content creation, social media, and campaign tracking',
    category: 'marketing',
    defaultModel: 'anthropic/claude-sonnet-4-5',
    defaultTools: ['read', 'write', 'web_search', 'message', 'browser'],
    systemPrompt: `You are a marketing assistant. Create content, manage social media 
      presence, and track campaign performance.`,
    config: {
      id: 'marketing-agent',
      name: 'Marketing Agent',
    },
  },
  {
    id: 'orchestrator-agent',
    name: 'Orchestrator Agent',
    description: 'Coordinates multiple agents for complex tasks',
    category: 'general',
    defaultModel: 'anthropic/claude-opus-4-6',
    defaultTools: ['read', 'exec', 'message', 'subagents'],
    systemPrompt: `You are an orchestrator. Coordinate multiple specialized agents 
      to accomplish complex tasks. Delegate efficiently and aggregate results.`,
    config: {
      id: 'orchestrator-agent',
      name: 'Orchestrator Agent',
    },
  },
];

/**
 * Create a task for an agent
 */
export function createTask(
  agentId: string,
  type: AgentTask['type'],
  payload: unknown,
  priority: AgentTask['priority'] = 'normal'
): AgentTask {
  const task: AgentTask = {
    id: `task-${crypto.randomUUID()}`,
    agentId,
    type,
    payload,
    priority,
    status: 'pending',
    createdAt: new Date(),
  };
  
  taskQueue.set(task.id, task);
  return task;
}

/**
 * Execute multiple agents in parallel
 */
export async function executeParallel(
  agents: string[],
  tasks: Array<{ agentId: string; payload: unknown }>,
  _client: ClientContext
): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  
  // Create tasks for each agent
  const agentTasks = tasks.map(t => createTask(t.agentId, 'chat', t.payload, 'normal'));
  
  // Execute all tasks concurrently
  const executions = agentTasks.map(async (task) => {
    task.status = 'running';
    task.startedAt = new Date();
    
    const controller = new AbortController();
    runningTasks.set(task.id, controller);
    
    try {
      // Simulate agent execution (actual implementation would call agent's chat handler)
      const result = await executeAgentTask(task, _client);
      
      task.status = 'completed';
      task.completedAt = new Date();
      task.result = result;
      
      return {
        taskId: task.id,
        agentId: task.agentId,
        success: true,
        data: result,
        duration: task.completedAt.getTime() - (task.startedAt?.getTime() || 0),
      } as AgentResult;
    } catch (error) {
      task.status = 'failed';
      task.completedAt = new Date();
      task.error = String(error);
      
      return {
        taskId: task.id,
        agentId: task.agentId,
        success: false,
        error: String(error),
        duration: task.completedAt.getTime() - (task.startedAt?.getTime() || 0),
      } as AgentResult;
    } finally {
      runningTasks.delete(task.id);
    }
  });
  
  // Wait for all to complete
  const execResults = await Promise.allSettled(executions);
  
  for (const r of execResults) {
    if (r.status === 'fulfilled') {
      results.push(r.value);
    } else {
      results.push({
        taskId: 'unknown',
        agentId: 'unknown',
        success: false,
        error: r.reason?.message || 'Unknown error',
        duration: 0,
      });
    }
  }
  
  return results;
}

/**
 * Execute a single agent task
 */
async function executeAgentTask(task: AgentTask, client: ClientContext): Promise<unknown> {
  const controller = runningTasks.get(task.id);
  
  if (controller?.signal.aborted) {
    throw new Error('Task aborted');
  }
  
  // Real agent execution via gateway RPC
  try {
    const { callGateway } = await import('./call.js');
    
    // Build session key for the target agent
    const sessionKey = `agent:${task.agentId}`;
    
    // Handle different task types
    if (task.type === 'chat') {
      // Execute chat message to the agent
      const payload = task.payload as { message?: string; content?: string } | undefined;
      const message = payload?.message || payload?.content || '';
      
      const result = await callGateway<{
        runId?: string;
        status?: string;
        response?: string;
        error?: string;
      }>({
        method: 'chat.send',
        params: {
          sessionKey,
          message,
          skipHistory: true,
        },
        timeoutMs: 120_000, // 2 minute timeout for agent tasks
      });
      
      if (result?.error) {
        throw new Error(result.error);
      }
      
      return {
        type: task.type,
        agentId: task.agentId,
        payload: task.payload,
        result: result?.response || result,
        runId: result?.runId,
        executedAt: new Date().toISOString(),
      };
    }
    
    if (task.type === 'workflow') {
      // Execute workflow via n8n
      const { executeN8nWorkflow } = await import('./n8n-api-client.js');
      const workspaceId = client.pmosWorkspaceId;
      const workflowId = (task.payload as { workflowId?: string })?.workflowId;
      
      if (!workspaceId || !workflowId) {
        throw new Error('Workflow execution requires workspaceId and workflowId');
      }
      
      const result = await executeN8nWorkflow(workspaceId, workflowId);
      
      return {
        type: task.type,
        agentId: task.agentId,
        payload: task.payload,
        executionId: result.executionId,
        executedAt: new Date().toISOString(),
      };
    }
    
    // Default: generic task execution
    return {
      type: task.type,
      agentId: task.agentId,
      payload: task.payload,
      executedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Fallback to placeholder for cases where gateway is unavailable
    // (e.g., during testing or when running in isolation)
    console.warn(`[agent-orchestrator] Gateway call failed, using fallback: ${error}`);
    
    return {
      type: task.type,
      agentId: task.agentId,
      payload: task.payload,
      executedAt: new Date().toISOString(),
      fallback: true,
    };
  }
}

/**
 * Broadcast a message to multiple agents
 */
export function broadcast(
  fromAgentId: string,
  toAgentIds: string[],
  type: AgentBroadcast['type'],
  payload: unknown
): AgentBroadcast {
  const message: AgentBroadcast = {
    fromAgentId,
    toAgentIds,
    type,
    payload,
    timestamp: new Date(),
  };
  
  broadcastHistory.push(message);
  
  // Queue message for delivery to target agents via session system
  // This integrates with the message channel system for actual delivery
  void (async () => {
    try {
      const { callGateway } = await import('./call.js');
      
      // Deliver broadcast to each target agent's session
      for (const targetAgentId of toAgentIds) {
        const sessionKey = `agent:${targetAgentId}`;
        
        await callGateway({
          method: 'sessions.patch',
          params: {
            key: sessionKey,
            label: type === 'task' ? 'Broadcast Task' : 
                   type === 'notification' ? 'Notification' : 'Broadcast',
            metadata: {
              broadcastFrom: fromAgentId,
              broadcastType: type,
              broadcastPayload: payload,
            },
          },
          timeoutMs: 10_000,
        }).catch(() => {
          // Ignore delivery failures for broadcast
        });
      }
    } catch {
      // Broadcast delivery is best-effort
    }
  })();
  
  return message;
}

/**
 * Coordinate agents with an orchestration workflow
 */
export async function coordinate(
  workflow: AgentWorkflow,
  client: ClientContext
): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  
  switch (workflow.pattern) {
    case 'parallel':
      // All agents work on the same task simultaneously
      return executeParallel(
        workflow.agents,
        workflow.agents.map(agentId => ({ agentId, payload: workflow.tasks[0]?.payload })),
        client
      );
      
    case 'sequential':
      // Agents work one after another
      for (const task of workflow.tasks) {
        const result = await executeSingleAgent(task.agentId, task, client);
        results.push(result);
        
        if (!result.success) {
          break; // Stop on failure
        }
      }
      return results;
      
    case 'pipeline':
      // Output of one agent feeds the next
      let currentPayload = workflow.tasks[0]?.payload;
      
      for (const task of workflow.tasks) {
        const result = await executeSingleAgent(task.agentId, {
          ...task,
          payload: currentPayload,
        }, client);
        
        results.push(result);
        
        if (!result.success) {
          break;
        }
        
        currentPayload = result.data;
      }
      return results;
      
    case 'fan-out':
      // One task splits to multiple agents
      const fanOutTasks = workflow.agents.map(agentId => ({
        agentId,
        payload: workflow.tasks[0]?.payload,
      }));
      return executeParallel(workflow.agents, fanOutTasks, client);
      
    case 'fan-in':
      // Multiple agents contribute to one result
      const fanInResults = await executeParallel(
        workflow.agents,
        workflow.agents.map(agentId => ({ agentId, payload: workflow.tasks[0]?.payload })),
        client
      );
      
      // Aggregate results
      const aggregated = aggregateResults(fanInResults, workflow.onCompletion?.aggregate || 'concat');
      
      return [{
        taskId: workflow.id,
        agentId: 'orchestrator',
        success: true,
        data: aggregated,
        duration: fanInResults.reduce((sum, r) => sum + r.duration, 0),
      }];
      
    case 'map-reduce':
      // Distribute tasks, process, then aggregate
      const mapTasks = workflow.tasks.slice(0, -1);
      const reduceTask = workflow.tasks[workflow.tasks.length - 1];
      
      const mapResults = await executeParallel(
        workflow.agents,
        mapTasks.map(t => ({ agentId: t.agentId, payload: t.payload })),
        client
      );
      
      // Run reduce on aggregated map results
      const reduceResult = await executeSingleAgent(reduceTask.agentId, {
        ...reduceTask,
        payload: aggregateResults(mapResults, 'concat'),
      }, client);
      
      return [...mapResults, reduceResult];
      
    default:
      throw new Error(`Unknown orchestration pattern: ${workflow.pattern}`);
  }
}

/**
 * Execute a single agent task
 */
async function executeSingleAgent(
  agentId: string,
  task: { id: string; payload: unknown },
  client: ClientContext
): Promise<AgentResult> {
  const agentTask = createTask(agentId, 'chat', task.payload);
  
  try {
    const result = await executeAgentTask(agentTask, client);
    
    return {
      taskId: agentTask.id,
      agentId,
      success: true,
      data: result,
      duration: 0,
    };
  } catch (error) {
    return {
      taskId: agentTask.id,
      agentId,
      success: false,
      error: String(error),
      duration: 0,
    };
  }
}

/**
 * Aggregate multiple results
 */
function aggregateResults(
  results: AgentResult[],
  method: 'concat' | 'merge' | 'summarize' | 'vote'
): unknown {
  switch (method) {
    case 'concat':
      return results.map(r => r.data).filter(Boolean);
      
    case 'merge':
      return results.reduce((acc, r) => {
        if (typeof r.data === 'object' && r.data !== null) {
          return { ...acc, ...r.data };
        }
        return acc;
      }, {});
      
    case 'summarize':
      return {
        totalResults: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        summaries: results.map(r => r.data).filter(Boolean),
      };
      
    case 'vote':
      // Simple majority vote on boolean results
      const votes = results.filter(r => typeof r.data === 'boolean');
      const yesVotes = votes.filter(r => r.data === true).length;
      return yesVotes > votes.length / 2;
      
    default:
      return results;
  }
}

/**
 * Get task status
 */
export function getTaskStatus(taskId: string): AgentTask | undefined {
  return taskQueue.get(taskId);
}

/**
 * Cancel a running task
 */
export function cancelTask(taskId: string): boolean {
  const controller = runningTasks.get(taskId);
  if (controller) {
    controller.abort();
    runningTasks.delete(taskId);
    
    const task = taskQueue.get(taskId);
    if (task) {
      task.status = 'failed';
      task.error = 'Cancelled by user';
      task.completedAt = new Date();
    }
    
    return true;
  }
  return false;
}

/**
 * Get all tasks for an agent
 */
export function getAgentTasks(agentId: string): AgentTask[] {
  return Array.from(taskQueue.values()).filter(t => t.agentId === agentId);
}

/**
 * Get all running tasks
 */
export function getRunningTasks(): AgentTask[] {
  return Array.from(taskQueue.values()).filter(t => t.status === 'running');
}

/**
 * Get broadcast history
 */
export function getBroadcastHistory(limit = 100): AgentBroadcast[] {
  return broadcastHistory.slice(-limit);
}

/**
 * Create an agent from a template
 */
export function createAgentFromTemplate(
  templateId: string,
  customizations?: Partial<AgentTemplate>
): AgentTemplate | null {
  const template = AGENT_TEMPLATES.find(t => t.id === templateId);
  
  if (!template) {
    return null;
  }
  
  return {
    ...template,
    ...customizations,
    config: {
      ...template.config,
      ...customizations?.config,
    },
  };
}

/**
 * Get available agent templates
 */
export function getAgentTemplates(category?: AgentTemplate['category']): AgentTemplate[] {
  if (category) {
    return AGENT_TEMPLATES.filter(t => t.category === category);
  }
  return AGENT_TEMPLATES;
}

export default {
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
};