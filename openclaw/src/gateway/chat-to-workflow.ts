/**
 * Chat-to-Workflow Creation Engine
 * 
 * Converts natural language descriptions into n8n workflow JSON.
 * Enables users to create and modify workflows via chat.
 */

import type { Workflow } from './n8n-workspace-triggers.js';

// n8n node type mappings
const NODE_TYPE_MAPPINGS: Record<string, string> = {
  // Triggers
  'webhook': 'n8n-nodes-base.webhook',
  'schedule': 'n8n-nodes-base.scheduleTrigger',
  'cron': 'n8n-nodes-base.scheduleTrigger',
  'manual': 'n8n-nodes-base.manualTrigger',
  
  // Services
  'slack': 'n8n-nodes-base.slack',
  'github': 'n8n-nodes-base.github',
  'gmail': 'n8n-nodes-base.gmail',
  'google sheets': 'n8n-nodes-base.googleSheets',
  'google docs': 'n8n-nodes-base.googleDocs',
  'notion': 'n8n-nodes-base.notion',
  'basecamp': 'n8n-nodes-basecamp',
  'trello': 'n8n-nodes-base.trello',
  'jira': 'n8n-nodes-base.jira',
  'asana': 'n8n-nodes-base.asana',
  
  // Actions
  'http': 'n8n-nodes-base.httpRequest',
  'email': 'n8n-nodes-base.emailSend',
  'send email': 'n8n-nodes-base.emailSend',
  'database': 'n8n-nodes-base.postgres',
  'postgres': 'n8n-nodes-base.postgres',
  'mysql': 'n8n-nodes-base.mySql',
  
  // Logic
  'if': 'n8n-nodes-base.if',
  'condition': 'n8n-nodes-base.if',
  'switch': 'n8n-nodes-base.switch',
  'merge': 'n8n-nodes-base.merge',
  'split': 'n8n-nodes-base.splitInBatches',
  
  // Transformation
  'set': 'n8n-nodes-base.set',
  'code': 'n8n-nodes-base.code',
  'function': 'n8n-nodes-base.code',
  'transform': 'n8n-nodes-base.set',
};

// Trigger keywords
const TRIGGER_KEYWORDS = [
  'when', 'on', 'every', 'once', 'triggered by', 'starts when',
  'scheduled', 'daily', 'weekly', 'monthly', 'hourly',
  'new', 'created', 'updated', 'deleted', 'received'
];

// Action keywords
const ACTION_KEYWORDS = [
  'create', 'send', 'update', 'delete', 'get', 'fetch', 'post',
  'notify', 'alert', 'message', 'email', 'call', 'write', 'add'
];

// Connector keywords
const CONNECTOR_KEYWORDS = [
  'then', 'and', 'also', 'after that', 'next', 'followed by'
];

export interface ParsedIntent {
  trigger?: {
    type: string;
    service: string;
    event?: string;
    params?: Record<string, unknown>;
  };
  actions: Array<{
    type: string;
    service: string;
    action: string;
    params?: Record<string, unknown>;
    mapping?: Record<string, string>;
  }>;
  connections: Array<{ from: number; to: number }>;
  confidence: number;
  clarificationNeeded?: string[];
}

export interface WorkflowTemplate {
  name: string;
  description: string;
  trigger: {
    type: string;
    service: string;
    event?: string;
  };
  actions: Array<{
    type: string;
    service: string;
    action: string;
  }>;
}

/**
 * Parse natural language description into workflow intent
 */
export function parseWorkflowIntent(description: string): ParsedIntent {
  const lowerDesc = description.toLowerCase();
  const result: ParsedIntent = {
    actions: [],
    connections: [],
    confidence: 0,
    clarificationNeeded: [],
  };

  // Detect trigger
  const triggerMatch = detectTrigger(lowerDesc);
  if (triggerMatch) {
    result.trigger = triggerMatch;
    result.confidence += 0.3;
  } else {
    result.clarificationNeeded.push('When should this workflow start? (e.g., "When a new ticket is created" or "Every day at 9am")');
  }

  // Detect actions
  const actions = detectActions(lowerDesc);
  if (actions.length > 0) {
    result.actions = actions;
    result.confidence += 0.3 * actions.length;
    
    // Create connections (sequential by default)
    for (let i = 0; i < actions.length - 1; i++) {
      result.connections.push({ from: i, to: i + 1 });
    }
  } else {
    result.clarificationNeeded.push('What should this workflow do? (e.g., "Send a Slack message" or "Create a GitHub issue")');
  }

  // Normalize confidence
  result.confidence = Math.min(result.confidence, 1);

  return result;
}

/**
 * Detect trigger from description
 */
function detectTrigger(description: string): ParsedIntent['trigger'] | null {
  // Check for schedule triggers
  if (/every\s+(day|daily|morning|evening)/i.test(description)) {
    return { type: 'schedule', service: 'schedule', event: 'daily' };
  }
  if (/every\s+(week|weekly)/i.test(description)) {
    return { type: 'schedule', service: 'schedule', event: 'weekly' };
  }
  if (/every\s+(hour|hourly)/i.test(description)) {
    return { type: 'schedule', service: 'schedule', event: 'hourly' };
  }
  if (/at\s+\d{1,2}(:\d{2})?\s*(am|pm)?/i.test(description)) {
    return { type: 'schedule', service: 'schedule', event: 'custom' };
  }

  // Check for service triggers
  for (const [service, nodeType] of Object.entries(NODE_TYPE_MAPPINGS)) {
    if (description.includes(service)) {
      // Check for event patterns
      const newMatch = description.match(/new\s+(\w+)/);
      const createdMatch = description.match(/(\w+)\s+(is\s+)?created/);
      const updatedMatch = description.match(/(\w+)\s+(is\s+)?updated/);
      
      if (newMatch) {
        return { type: 'trigger', service, event: `new_${newMatch[1]}` };
      }
      if (createdMatch) {
        return { type: 'trigger', service, event: `created_${createdMatch[1]}` };
      }
      if (updatedMatch) {
        return { type: 'trigger', service, event: `updated_${updatedMatch[1]}` };
      }
      
      return { type: 'trigger', service };
    }
  }

  return null;
}

/**
 * Detect actions from description
 */
function detectActions(description: string): ParsedIntent['actions'] {
  const actions: ParsedIntent['actions'] = [];
  
  // Split by action connectors
  const parts = description.split(/\s+(then|and|also)\s+/i);
  
  for (const part of parts) {
    const lowerPart = part.toLowerCase().trim();
    
    // Match action patterns
    for (const actionKeyword of ACTION_KEYWORDS) {
      if (lowerPart.includes(actionKeyword)) {
        // Find the service
        for (const [service, nodeType] of Object.entries(NODE_TYPE_MAPPINGS)) {
          if (lowerPart.includes(service)) {
            actions.push({
              type: nodeType,
              service,
              action: actionKeyword,
            });
            break;
          }
        }
        break;
      }
    }
  }
  
  return actions;
}

/**
 * Generate n8n workflow JSON from parsed intent
 */
export function generateWorkflow(
  intent: ParsedIntent,
  name: string,
  workspaceId: string
): Workflow {
  const nodes: Workflow['nodes'] = [];
  const connections: Workflow['connections'] = {};

  // Add trigger node
  if (intent.trigger) {
    const triggerNode = createTriggerNode(intent.trigger);
    nodes.push(triggerNode);
  }

  // Add action nodes
  intent.actions.forEach((action, index) => {
    const actionNode = createActionNode(action, index);
    nodes.push(actionNode);
    
    // Create connections
    if (index === 0 && intent.trigger) {
      connections[nodes[0].name] = {
        main: [[{ node: actionNode.name, type: 'main', index: 0 }]]
      };
    } else if (index > 0) {
      const prevNode = nodes[index];
      connections[prevNode.name] = {
        main: [[{ node: actionNode.name, type: 'main', index: 0 }]]
      };
    }
  });

  return {
    id: crypto.randomUUID(),
    name,
    active: false,
    nodes,
    connections,
    settings: {
      executionOrder: 'v1',
    },
    staticData: null,
    tags: [],
    triggerCount: intent.trigger ? 1 : 0,
    updatedAt: new Date().toISOString(),
    versionId: crypto.randomUUID(),
    workspaceId,
  };
}

/**
 * Create a trigger node
 */
function createTriggerNode(trigger: NonNullable<ParsedIntent['trigger']>): Workflow['nodes'][0] {
  const nodeType = NODE_TYPE_MAPPINGS[trigger.service] || 'n8n-nodes-base.manualTrigger';
  
  const parameters: Record<string, unknown> = {};
  
  if (trigger.event === 'daily') {
    parameters.rule = { interval: [{ field: 'hours', hoursInterval: 24 }] };
  } else if (trigger.event === 'hourly') {
    parameters.rule = { interval: [{ field: 'minutes', minutesInterval: 60 }] };
  } else if (trigger.event === 'weekly') {
    parameters.rule = { interval: [{ field: 'weeks', weeksInterval: 1 }] };
  }
  
  return {
    id: crypto.randomUUID(),
    name: `${trigger.service}_trigger`,
    type: nodeType,
    typeVersion: 1,
    position: [250, 300],
    parameters,
  };
}

/**
 * Create an action node
 */
function createActionNode(
  action: ParsedIntent['actions'][0],
  index: number
): Workflow['nodes'][0] {
  const nodeType = NODE_TYPE_MAPPINGS[action.service] || 'n8n-nodes-base.httpRequest';
  
  const parameters: Record<string, unknown> = {};
  
  // Add action-specific parameters
  if (action.action === 'create') {
    parameters.operation = 'create';
  } else if (action.action === 'send') {
    parameters.operation = 'send';
  } else if (action.action === 'update') {
    parameters.operation = 'update';
  } else if (action.action === 'delete') {
    parameters.operation = 'delete';
  } else if (action.action === 'get' || action.action === 'fetch') {
    parameters.operation = 'get';
  }
  
  return {
    id: crypto.randomUUID(),
    name: `${action.service}_${index + 1}`,
    type: nodeType,
    typeVersion: 1,
    position: [450 + index * 200, 300],
    parameters,
  };
}

/**
 * Generate clarifying questions for incomplete intents
 */
export function generateClarification(intent: ParsedIntent): string {
  if (intent.confidence >= 0.7) {
    return '';
  }
  
  const questions: string[] = [];
  
  if (intent.clarificationNeeded && intent.clarificationNeeded.length > 0) {
    questions.push(...intent.clarificationNeeded);
  }
  
  if (questions.length === 0) {
    return 'I need more details to create this workflow. Could you describe what triggers it and what actions it should perform?';
  }
  
  return `To create this workflow, I need to know:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
}

/**
 * Pre-built workflow templates
 */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    name: 'Basecamp to GitHub Sync',
    description: 'When a new todo is created in Basecamp, create a matching issue in GitHub',
    trigger: { type: 'trigger', service: 'basecamp', event: 'new_todo' },
    actions: [
      { type: 'n8n-nodes-base.github', service: 'github', action: 'create' }
    ]
  },
  {
    name: 'Slack Alerts for New Issues',
    description: 'When a new issue is created in GitHub, send a Slack notification',
    trigger: { type: 'trigger', service: 'github', event: 'new_issue' },
    actions: [
      { type: 'n8n-nodes-base.slack', service: 'slack', action: 'send' }
    ]
  },
  {
    name: 'Daily Report',
    description: 'Every day at 9am, generate and send a report via email',
    trigger: { type: 'schedule', service: 'schedule', event: 'daily' },
    actions: [
      { type: 'n8n-nodes-base.googleSheets', service: 'google sheets', action: 'get' },
      { type: 'n8n-nodes-base.emailSend', service: 'email', action: 'send' }
    ]
  },
  {
    name: 'Webhook to Database',
    description: 'When a webhook is received, store the data in a database',
    trigger: { type: 'trigger', service: 'webhook' },
    actions: [
      { type: 'n8n-nodes-base.postgres', service: 'postgres', action: 'create' }
    ]
  },
  {
    name: 'Email to Task',
    description: 'When a new email is received, create a task in Notion',
    trigger: { type: 'trigger', service: 'gmail', event: 'new_email' },
    actions: [
      { type: 'n8n-nodes-base.notion', service: 'notion', action: 'create' }
    ]
  },
];

/**
 * Find matching templates for a description
 */
export function findMatchingTemplates(description: string): WorkflowTemplate[] {
  const lowerDesc = description.toLowerCase();
  
  return WORKFLOW_TEMPLATES.filter(template => {
    const templateKeywords = [
      template.name.toLowerCase(),
      template.description.toLowerCase(),
      template.trigger.service,
      ...template.actions.map(a => a.service),
    ].join(' ');
    
    // Simple keyword matching
    const descWords = lowerDesc.split(/\s+/);
    const matchCount = descWords.filter(word => templateKeywords.includes(word)).length;
    
    return matchCount >= 2;
  });
}

/**
 * Chat-to-workflow command handler
 */
export async function handleChatToWorkflow(
  message: string,
  workspaceId: string
): Promise<{ response: string; workflow?: Workflow; needsConfirmation?: boolean }> {
  // Check if user wants to see templates
  if (/show\s+(me\s+)?templates/i.test(message)) {
    const templateList = WORKFLOW_TEMPLATES.map((t, i) => 
      `${i + 1}. **${t.name}**: ${t.description}`
    ).join('\n');
    
    return {
      response: `Here are available workflow templates:\n\n${templateList}\n\nSay "use template 1" to create a workflow from a template.`,
    };
  }
  
  // Check if user wants to use a template
  const templateMatch = message.match(/use\s+template\s+(\d+)/i);
  if (templateMatch) {
    const index = parseInt(templateMatch[1]) - 1;
    const template = WORKFLOW_TEMPLATES[index];
    
    if (template) {
      const intent: ParsedIntent = {
        trigger: template.trigger,
        actions: template.actions,
        connections: template.actions.map((_, i) => ({ from: i, to: i + 1 })),
        confidence: 1,
      };
      
      const workflow = generateWorkflow(intent, template.name, workspaceId);
      
      return {
        response: `I'll create the "${template.name}" workflow. This will:\n\n` +
          `- Trigger: ${template.trigger.event || template.trigger.service}\n` +
          `- Actions: ${template.actions.map(a => `${a.action} in ${a.service}`).join(', ')}\n\n` +
          `Should I create this workflow?`,
        workflow,
        needsConfirmation: true,
      };
    }
  }
  
  // Parse natural language description
  const intent = parseWorkflowIntent(message);
  
  // Check if we need clarification
  const clarification = generateClarification(intent);
  if (clarification) {
    // Check for matching templates as suggestions
    const matchingTemplates = findMatchingTemplates(message);
    
    if (matchingTemplates.length > 0) {
      const suggestions = matchingTemplates.slice(0, 2).map(t => `- ${t.name}`).join('\n');
      return {
        response: `${clarification}\n\nOr would you like to use one of these templates?\n${suggestions}`,
      };
    }
    
    return { response: clarification };
  }
  
  // Generate workflow name from description
  const nameMatch = message.match(/^(?:create|build|make)\s+(?:a\s+)?(.+?)(?:\s+workflow)?$/i);
  const name = nameMatch ? nameMatch[1] : 'New Workflow';
  
  // Generate workflow
  const workflow = generateWorkflow(intent, name, workspaceId);
  
  // Generate preview
  const preview = generateWorkflowPreview(intent);
  
  return {
    response: `I'll create a workflow with the following structure:\n\n${preview}\n\nShould I create this workflow?`,
    workflow,
    needsConfirmation: true,
  };
}

/**
 * Generate human-readable workflow preview
 */
function generateWorkflowPreview(intent: ParsedIntent): string {
  const lines: string[] = [];
  
  if (intent.trigger) {
    const event = intent.trigger.event ? ` (${intent.trigger.event})` : '';
    lines.push(`**Trigger**: ${intent.trigger.service}${event}`);
  }
  
  intent.actions.forEach((action, index) => {
    const prefix = index === 0 ? '→' : '→';
    lines.push(`${prefix} **Action ${index + 1}**: ${action.action} in ${action.service}`);
  });
  
  return lines.join('\n');
}

export default {
  parseWorkflowIntent,
  generateWorkflow,
  generateClarification,
  handleChatToWorkflow,
  findMatchingTemplates,
  WORKFLOW_TEMPLATES,
};
