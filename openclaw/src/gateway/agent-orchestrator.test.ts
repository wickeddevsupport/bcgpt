import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTask,
  getTaskStatus,
  cancelTask,
  getAgentTasks,
  getRunningTasks,
  getBroadcastHistory,
  createAgentFromTemplate,
  getAgentTemplates,
  AGENT_TEMPLATES,
  type AgentTask,
} from './agent-orchestrator.js';
import type { ClientContext } from './client.js';

const mockClient = {
  sessionId: 'test-session',
  agentId: 'test-agent',
  pmosWorkspaceId: 'test-workspace',
} as unknown as ClientContext;

describe('Agent Orchestrator', () => {
  beforeEach(() => {
    // Clear state between tests if needed
  });
  
  describe('createTask', () => {
    it('creates a task with correct properties', () => {
      const task = createTask('agent-1', 'chat', { message: 'Hello' }, 'normal');
      
      expect(task.id).toBeDefined();
      expect(task.agentId).toBe('agent-1');
      expect(task.type).toBe('chat');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe('normal');
    });
    
    it('defaults priority to normal', () => {
      const task = createTask('agent-1', 'chat', { message: 'Hello' });
      
      expect(task.priority).toBe('normal');
    });
  });
  
  describe('getTaskStatus', () => {
    it('returns the task if it exists', () => {
      const task = createTask('agent-1', 'chat', { message: 'Hello' });
      
      const status = getTaskStatus(task.id);
      
      expect(status).toBeDefined();
      expect(status?.id).toBe(task.id);
    });
    
    it('returns undefined for non-existent task', () => {
      const status = getTaskStatus('non-existent-task');
      
      expect(status).toBeUndefined();
    });
  });
  
  describe('getAgentTasks', () => {
    it('returns tasks for a specific agent', () => {
      createTask('agent-1', 'chat', { message: 'Hello' });
      createTask('agent-1', 'workflow', { workflowId: 'wf-1' });
      createTask('agent-2', 'chat', { message: 'World' });
      
      const tasks = getAgentTasks('agent-1');
      
      expect(tasks.length).toBeGreaterThanOrEqual(2);
      expect(tasks.every(t => t.agentId === 'agent-1')).toBe(true);
    });
  });
  
  describe('getRunningTasks', () => {
    it('returns only running tasks', () => {
      const task1 = createTask('agent-1', 'chat', { message: 'Hello' });
      const task2 = createTask('agent-2', 'chat', { message: 'World' });
      
      // Mark one as running
      const status1 = getTaskStatus(task1.id);
      if (status1) {
        status1.status = 'running';
      }
      
      const running = getRunningTasks();
      
      // Only task1 should be running
      expect(running.some(t => t.id === task1.id)).toBe(true);
    });
  });
  
  describe('getBroadcastHistory', () => {
    it('returns broadcast history with default limit', () => {
      const history = getBroadcastHistory();
      
      expect(Array.isArray(history)).toBe(true);
    });
    
    it('respects limit parameter', () => {
      const history = getBroadcastHistory(5);
      
      expect(history.length).toBeLessThanOrEqual(5);
    });
  });
  
  describe('AGENT_TEMPLATES', () => {
    it('has pre-built agent templates', () => {
      expect(AGENT_TEMPLATES.length).toBeGreaterThan(0);
    });
    
    it('each template has required fields', () => {
      for (const template of AGENT_TEMPLATES) {
        expect(template.id).toBeDefined();
        expect(template.name).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.category).toBeDefined();
        expect(template.defaultModel).toBeDefined();
      }
    });
    
    it('includes common agent types', () => {
      const ids = AGENT_TEMPLATES.map(t => t.id);
      
      expect(ids).toContain('sales-agent');
      expect(ids).toContain('support-agent');
      expect(ids).toContain('dev-agent');
      expect(ids).toContain('pm-agent');
    });
  });
  
  describe('getAgentTemplates', () => {
    it('returns all templates without category filter', () => {
      const templates = getAgentTemplates();
      
      expect(templates.length).toBe(AGENT_TEMPLATES.length);
    });
    
    it('filters by category', () => {
      const templates = getAgentTemplates('sales');
      
      expect(templates.every(t => t.category === 'sales')).toBe(true);
    });
  });
  
  describe('createAgentFromTemplate', () => {
    it('creates an agent from a template', () => {
      const agent = createAgentFromTemplate('sales-agent');
      
      expect(agent).toBeDefined();
      expect(agent?.id).toBe('sales-agent');
      expect(agent?.name).toBe('Sales Agent');
    });
    
    it('applies customizations', () => {
      const agent = createAgentFromTemplate('sales-agent', {
        name: 'Custom Sales Agent',
        defaultModel: 'gpt-4',
      });
      
      expect(agent?.name).toBe('Custom Sales Agent');
      expect(agent?.defaultModel).toBe('gpt-4');
    });
    
    it('returns null for invalid template', () => {
      const agent = createAgentFromTemplate('invalid-template');
      
      expect(agent).toBeNull();
    });
  });
});
