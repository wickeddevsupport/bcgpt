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
): Promise<{ success: boolean; message: string; workflow?: Workflow; workflowId?: string }> {
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
  
  // Persist workflow to n8n via API
  const { createN8nWorkflow } = await import('../n8n-api-client.js');

  // Auto-link credentials to workflow nodes
  const { fetchWorkspaceCredentials, autoLinkNodeCredentials } = await import('../credential-sync.js');
  const templateCredentials = await fetchWorkspaceCredentials(workspaceId).catch(() => []);
  const linkedTemplateNodes = autoLinkNodeCredentials(
    workflow.nodes as Array<Record<string, unknown>>,
    templateCredentials,
  );

  const result = await createN8nWorkflow(workspaceId, {
    name: workflow.name,
    active: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes: linkedTemplateNodes as any,
    connections: workflow.connections,
    settings: workflow.settings,
    staticData: workflow.staticData,
    tags: workflow.tags,
    triggerCount: workflow.triggerCount,
    updatedAt: workflow.updatedAt,
    versionId: workflow.versionId,
  });

  if (!result.ok) {
    return {
      success: false,
      message: `Template deployment failed: ${result.error}`,
    };
  }
  
  return {
    success: true,
    message: `Template "${template.name}" deployed successfully`,
    workflow: result.workflow as Workflow,
    workflowId: result.workflow!.id,
  };
}

/**
 * Handle workflow confirmation
 */
export async function handleWorkflowConfirm(
  params: unknown,
  client: ClientContext
): Promise<{ success: boolean; message: string; workflowId?: string; workflow?: Workflow }> {
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
  
  // Persist workflow to n8n via API
  const { createN8nWorkflow } = await import('../n8n-api-client.js');

  // Auto-link credentials to workflow nodes based on node types
  const { fetchWorkspaceCredentials, autoLinkNodeCredentials } = await import('../credential-sync.js');
  const credentials = await fetchWorkspaceCredentials(workspaceId).catch(() => []);
  const linkedNodes = autoLinkNodeCredentials(
    parsed.data.workflow.nodes as Array<Record<string, unknown>>,
    credentials,
  );

  const result = await createN8nWorkflow(workspaceId, {
    name: parsed.data.workflow.name,
    active: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes: linkedNodes as any,
    connections: parsed.data.workflow.connections,
    settings: { executionOrder: 'v1' },
    staticData: null,
    tags: [],
    triggerCount: 1,
    updatedAt: new Date().toISOString(),
    versionId: crypto.randomUUID(),
  });
  
  if (!result.ok) {
    return {
      success: false,
      message: `Failed to create workflow: ${result.error}`,
    };
  }
  
  return {
    success: true,
    message: `Workflow "${parsed.data.workflow.name}" created successfully`,
    workflowId: result.workflow!.id,
    workflow: result.workflow as Workflow,
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