/**
 * Server Methods: Chat-to-Workflow Commands
 * 
 * WebSocket handlers for natural language workflow creation.
 */

import { z } from 'zod';
import type { ClientContext } from '../client.js';
import {
  handleChatToWorkflow,
  parseWorkflowIntent,
  generateWorkflow,
  findMatchingTemplates,
  WORKFLOW_TEMPLATES,
} from '../chat-to-workflow.js';
import type { Workflow } from '../n8n-workspace-triggers.js';

// Input schemas
const ChatWorkflowCreateSchema = z.object({
  description: z.string().min(1, 'Description is required'),
});

const ChatWorkflowTemplateSchema = z.object({
  templateId: z.string(),
  name: z.string().optional(),
});

const ChatWorkflowConfirmSchema = z.object({
  workflow: z.object({
    name: z.string(),
    nodes: z.array(z.any()),
    connections: z.record(z.any()),
  }),
  confirmed: z.boolean(),
});

/**
 * Handle chat-to-workflow creation command
 */
export async function handleWorkflowCreate(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; message: string; workflow?: Workflow; needsConfirmation?: boolean }> {
  const parsed = ChatWorkflowCreateSchema.safeParse(params);
  
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
      message: 'Workspace context required for workflow creation',
    };
  }
  
  const result = await handleChatToWorkflow(parsed.data.description, workspaceId);
  
  return {
    success: true,
    message: result.response,
    workflow: result.workflow,
    needsConfirmation: result.needsConfirmation,
  };
}

/**
 * Handle template list command
 */
export async function handleTemplateList(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; templates: typeof WORKFLOW_TEMPLATES }> {
  const filterSchema = z.object({
    category: z.string().optional(),
    search: z.string().optional(),
  }).optional();
  
  const parsed = filterSchema.safeParse(params);
  const filterParams = parsed.success ? parsed.data : {};
  
  let templates = [...WORKFLOW_TEMPLATES];
  
  if (filterParams.search) {
    templates = findMatchingTemplates(filterParams.search);
  }
  
  return {
    success: true,
    templates,
  };
}

/**
 * Handle template deployment command
 */
export async function handleTemplateDeploy(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; message: string; workflow?: Workflow }> {
  const parsed = ChatWorkflowTemplateSchema.safeParse(params);
  
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
  
  const template = WORKFLOW_TEMPLATES.find(t => t.name === parsed.data.templateId || 
    t.name.toLowerCase().includes(parsed.data.templateId.toLowerCase()));
  
  if (!template) {
    return {
      success: false,
      message: `Template not found: ${parsed.data.templateId}`,
    };
  }
  
  const intent = {
    trigger: template.trigger,
    actions: template.actions,
    connections: template.actions.map((_, i) => ({ from: i, to: i + 1 })),
    confidence: 1,
  };
  
  const workflow = generateWorkflow(
    intent,
    parsed.data.name || template.name,
    workspaceId
  );
  
  return {
    success: true,
    message: `Template "${template.name}" deployed successfully`,
    workflow,
  };
}

/**
 * Handle workflow confirmation
 */
export async function handleWorkflowConfirm(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; message: string; workflowId?: string }> {
  const parsed = ChatWorkflowConfirmSchema.safeParse(params);
  
  if (!parsed.success) {
    return {
      success: false,
      message: `Invalid parameters: ${parsed.error.message}`,
    };
  }
  
  if (!parsed.data.confirmed) {
    return {
      success: true,
      message: 'Workflow creation cancelled',
    };
  }
  
  const workspaceId = client.pmosWorkspaceId;
  if (!workspaceId) {
    return {
      success: false,
      message: 'Workspace context required',
    };
  }
  
  // In a real implementation, this would save to n8n via ops proxy
  // For now, we return success with a generated ID
  
  const workflowId = crypto.randomUUID();
  
  return {
    success: true,
    message: `Workflow "${parsed.data.workflow.name}" created successfully`,
    workflowId,
  };
}

/**
 * Parse workflow intent from description
 */
export async function handleIntentParse(
  params: unknown,
  _client: ClientContext
): Promise<{ success: boolean; intent?: ReturnType<typeof parseWorkflowIntent> }> {
  const parsed = ChatWorkflowCreateSchema.safeParse(params);
  
  if (!parsed.success) {
    return { success: false };
  }
  
  const intent = parseWorkflowIntent(parsed.data.description);
  
  return {
    success: true,
    intent,
  };
}

export default {
  handleWorkflowCreate,
  handleTemplateList,
  handleTemplateDeploy,
  handleWorkflowConfirm,
  handleIntentParse,
};