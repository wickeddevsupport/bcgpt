import { describe, it, expect, beforeEach } from 'vitest';
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
} from './live-flow-builder.js';
import type { ClientContext } from './client.js';

const mockClient = {
  sessionId: 'test-session',
  agentId: 'test-agent',
  pmosWorkspaceId: 'test-workspace',
} as unknown as ClientContext;

const mockWorkflowId = 'test-workflow-id';
const mockClientId = 'test-client-id';

describe('Live Flow Builder', () => {
  beforeEach(() => {
    // Reset subscriptions
    unsubscribeFromCanvas(mockWorkflowId, mockClientId);
    unsubscribeFromExecutions(mockWorkflowId, mockClientId);
  });
  
  describe('subscribeToCanvas', () => {
    it('subscribes a client to canvas updates', () => {
      subscribeToCanvas(mockWorkflowId, mockClientId);
      
      const status = getFlowBuilderStatus(mockWorkflowId);
      expect(status.canvasSubscribers).toBeGreaterThan(0);
    });
  });
  
  describe('unsubscribeFromCanvas', () => {
    it('unsubscribes a client from canvas updates', () => {
      subscribeToCanvas(mockWorkflowId, mockClientId);
      unsubscribeFromCanvas(mockWorkflowId, mockClientId);
      
      const status = getFlowBuilderStatus(mockWorkflowId);
      expect(status.canvasSubscribers).toBe(0);
    });
  });
  
  describe('subscribeToExecutions', () => {
    it('subscribes a client to execution events', () => {
      subscribeToExecutions(mockWorkflowId, mockClientId);
      
      const status = getFlowBuilderStatus(mockWorkflowId);
      expect(status.executionSubscribers).toBeGreaterThan(0);
    });
  });
  
  describe('unsubscribeFromExecutions', () => {
    it('unsubscribes a client from execution events', () => {
      subscribeToExecutions(mockWorkflowId, mockClientId);
      unsubscribeFromExecutions(mockWorkflowId, mockClientId);
      
      const status = getFlowBuilderStatus(mockWorkflowId);
      expect(status.executionSubscribers).toBe(0);
    });
  });
  
  describe('getPendingUpdates', () => {
    it('returns empty array when no updates', () => {
      const updates = getPendingUpdates(mockWorkflowId);
      
      expect(updates).toEqual([]);
    });
  });
  
  describe('getExecutionHistory', () => {
    it('returns empty array when no history', () => {
      const history = getExecutionHistory(mockWorkflowId);
      
      expect(history).toEqual([]);
    });
  });
  
  describe('executeFlowControl', () => {
    it('activates a workflow', async () => {
      const result = await executeFlowControl('activate', mockWorkflowId, mockClient);
      
      expect(result.success).toBe(true);
      expect(result.action).toBe('activate');
    });
    
    it('deactivates a workflow', async () => {
      const result = await executeFlowControl('deactivate', mockWorkflowId, mockClient);
      
      expect(result.success).toBe(true);
      expect(result.action).toBe('deactivate');
    });
    
    it('executes a workflow', async () => {
      const result = await executeFlowControl('execute', mockWorkflowId, mockClient);
      
      expect(result.success).toBe(true);
      expect(result.action).toBe('execute');
    });
  });
  
  describe('updateNodePosition', () => {
    it('emits a node move update', () => {
      // Subscribe first so updates are queued
      subscribeToCanvas(mockWorkflowId, mockClientId);
      updateNodePosition(mockWorkflowId, 'node-1', { x: 100, y: 200 });
      
      const updates = getPendingUpdates(mockWorkflowId);
      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0].type).toBe('node_move');
    });
  });
  
  describe('addNode', () => {
    it('emits a node add update', () => {
      subscribeToCanvas(mockWorkflowId, mockClientId);
      addNode(mockWorkflowId, {
        id: 'node-new',
        name: 'New Node',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 1,
        position: [300, 300],
      });
      
      const updates = getPendingUpdates(mockWorkflowId);
      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0].type).toBe('node_add');
    });
  });
  
  describe('removeNode', () => {
    it('emits a node remove update', () => {
      subscribeToCanvas(mockWorkflowId, mockClientId);
      removeNode(mockWorkflowId, 'node-1');
      
      const updates = getPendingUpdates(mockWorkflowId);
      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0].type).toBe('node_remove');
    });
  });
  
  describe('addConnection', () => {
    it('emits a connection add update', () => {
      subscribeToCanvas(mockWorkflowId, mockClientId);
      addConnection(mockWorkflowId, 'node-1', 'node-2');
      
      const updates = getPendingUpdates(mockWorkflowId);
      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0].type).toBe('connection_add');
    });
  });
  
  describe('removeConnection', () => {
    it('emits a connection remove update', () => {
      subscribeToCanvas(mockWorkflowId, mockClientId);
      removeConnection(mockWorkflowId, 'node-1', 'node-2');
      
      const updates = getPendingUpdates(mockWorkflowId);
      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0].type).toBe('connection_remove');
    });
  });
  
  describe('WORKFLOW_LIBRARY', () => {
    it('has pre-built workflow templates', () => {
      expect(WORKFLOW_LIBRARY.length).toBeGreaterThan(0);
    });
    
    it('each template has required fields', () => {
      for (const template of WORKFLOW_LIBRARY) {
        expect(template.id).toBeDefined();
        expect(template.name).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.category).toBeDefined();
        expect(template.tags).toBeDefined();
        expect(template.workflow).toBeDefined();
      }
    });
  });
  
  describe('searchTemplates', () => {
    it('returns all templates without filters', () => {
      const templates = searchTemplates();
      
      expect(templates.length).toBe(WORKFLOW_LIBRARY.length);
    });
    
    it('filters by category', () => {
      const templates = searchTemplates(undefined, 'notification');
      
      expect(templates.every(t => t.category === 'notification')).toBe(true);
    });
    
    it('filters by query', () => {
      const templates = searchTemplates('slack');
      
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.some(t => 
        t.name.toLowerCase().includes('slack') || 
        t.description.toLowerCase().includes('slack')
      )).toBe(true);
    });
    
    it('filters by tags', () => {
      const templates = searchTemplates(undefined, undefined, ['webhook']);
      
      expect(templates.every(t => t.tags.includes('webhook'))).toBe(true);
    });
  });
  
  describe('getFeaturedTemplates', () => {
    it('returns only featured templates', () => {
      const templates = getFeaturedTemplates();
      
      expect(templates.every(t => t.featured)).toBe(true);
    });
    
    it('sorts by popularity', () => {
      const templates = getFeaturedTemplates();
      
      for (let i = 0; i < templates.length - 1; i++) {
        expect(templates[i].popularity).toBeGreaterThanOrEqual(templates[i + 1].popularity);
      }
    });
  });
  
  describe('deployTemplate', () => {
    it('deploys a template as a new workflow', async () => {
      const workflow = await deployTemplate(
        'template-webhook-slack',
        'test-workspace'
      );
      
      expect(workflow).toBeDefined();
      expect(workflow?.name).toBeDefined();
      expect(workflow?.nodes.length).toBeGreaterThan(0);
    });
    
    it('applies name customization', async () => {
      const workflow = await deployTemplate(
        'template-webhook-slack',
        'test-workspace',
        { name: 'Custom Workflow Name' }
      );
      
      expect(workflow?.name).toBe('Custom Workflow Name');
    });
    
    it('returns null for invalid template', async () => {
      const workflow = await deployTemplate('invalid-template', 'test-workspace');
      
      expect(workflow).toBeNull();
    });
  });
  
  describe('getFlowBuilderStatus', () => {
    it('returns status with subscriber counts', () => {
      const status = getFlowBuilderStatus(mockWorkflowId);
      
      expect(status).toHaveProperty('canvasSubscribers');
      expect(status).toHaveProperty('executionSubscribers');
      expect(status).toHaveProperty('pendingUpdates');
      expect(status).toHaveProperty('recentExecutions');
    });
  });
});
