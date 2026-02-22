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
    nodes: z.array(z.unknown()),
    // Keep this broad and validate object-shape manually to avoid zod record edge-cases.
    connections: z.unknown().optional(),
  }),
  confirmed: z.boolean(),
});

type WorkflowNodeRecord = Record<string, unknown>;
type N8nConnectionRef = { node: string; type: "main"; index: number };
type N8nConnectionMap = Record<string, { main: N8nConnectionRef[][] }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureNodeNames(nodes: WorkflowNodeRecord[]): WorkflowNodeRecord[] {
  return nodes.map((node, idx) => {
    const name = typeof node.name === "string" ? node.name.trim() : "";
    if (name) return node;
    return { ...node, name: `Step ${idx + 1}` };
  });
}

function buildLinearConnections(nodes: WorkflowNodeRecord[]): N8nConnectionMap {
  const connections: N8nConnectionMap = {};
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const from = nodes[i];
    const to = nodes[i + 1];
    const fromName = typeof from?.name === "string" ? from.name.trim() : "";
    const toName = typeof to?.name === "string" ? to.name.trim() : "";
    if (!fromName || !toName) continue;
    connections[fromName] = {
      main: [[{ node: toName, type: "main", index: 0 }]],
    };
  }
  return connections;
}

function normalizeConnectionRef(
  value: unknown,
  validNames: Set<string>,
): N8nConnectionRef | null {
  if (!isRecord(value)) return null;
  const nodeName = typeof value.node === "string" ? value.node.trim() : "";
  if (!nodeName || !validNames.has(nodeName)) return null;
  const indexRaw = value.index;
  const index =
    typeof indexRaw === "number" && Number.isFinite(indexRaw) && indexRaw >= 0
      ? Math.floor(indexRaw)
      : 0;
  return {
    node: nodeName,
    type: "main",
    index,
  };
}

function normalizeWorkflowConnections(
  raw: Record<string, unknown>,
  nodes: WorkflowNodeRecord[],
): N8nConnectionMap {
  const normalized: N8nConnectionMap = {};
  const validNames = new Set(
    nodes
      .map((node) => (typeof node.name === "string" ? node.name.trim() : ""))
      .filter((name): name is string => Boolean(name)),
  );

  for (const [sourceNameRaw, target] of Object.entries(raw)) {
    const sourceName = sourceNameRaw.trim();
    if (!sourceName || !validNames.has(sourceName) || !isRecord(target)) continue;
    const mainRaw = target.main;
    if (!Array.isArray(mainRaw)) continue;

    const normalizedBranches: N8nConnectionRef[][] = [];
    for (const branch of mainRaw) {
      if (!Array.isArray(branch)) continue;
      const refs: N8nConnectionRef[] = [];
      for (const candidate of branch) {
        const ref = normalizeConnectionRef(candidate, validNames);
        if (ref) refs.push(ref);
      }
      if (refs.length > 0) {
        normalizedBranches.push(refs);
      }
    }

    if (normalizedBranches.length > 0) {
      normalized[sourceName] = { main: normalizedBranches };
    }
  }

  if (Object.keys(normalized).length === 0 && nodes.length > 1) {
    return buildLinearConnections(nodes);
  }
  return normalized;
}

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

  const rawConnections = parsed.data.workflow.connections ?? {};
  if (
    typeof rawConnections !== "object" ||
    rawConnections === null ||
    Array.isArray(rawConnections)
  ) {
    return {
      success: false,
      message: "Invalid workflow.connections: expected an object",
    };
  }
  
  const workspaceId = client.pmosWorkspaceId;
  if (!workspaceId) {
    return {
      success: false,
      message: 'Workspace context required',
    };
  }

  const workflowNodes = ensureNodeNames(
    parsed.data.workflow.nodes.filter((node): node is WorkflowNodeRecord => isRecord(node)),
  );
  if (workflowNodes.length === 0) {
    return {
      success: false,
      message: 'Invalid workflow.nodes: expected at least one node object',
    };
  }
  const normalizedConnections = normalizeWorkflowConnections(
    rawConnections as Record<string, unknown>,
    workflowNodes,
  );
  
  // Persist workflow to n8n via API
  const { createN8nWorkflow } = await import('../n8n-api-client.js');

  // Auto-link credentials to workflow nodes based on node types
  const { fetchWorkspaceCredentials, autoLinkNodeCredentials } = await import('../credential-sync.js');
  const credentials = await fetchWorkspaceCredentials(workspaceId).catch(() => []);
  const linkedNodes = autoLinkNodeCredentials(
    workflowNodes,
    credentials,
  );

  const result = await createN8nWorkflow(workspaceId, {
    name: parsed.data.workflow.name,
    active: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes: linkedNodes as any,
    connections: normalizedConnections as Record<string, unknown>,
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
