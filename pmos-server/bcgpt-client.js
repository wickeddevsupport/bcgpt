/**
 * BCGPT Client
 * Helper to communicate with BCGPT server for data access
 */

export class BCGPTClient {
  constructor(baseUrl, apiKey = '') {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async request(toolName, args = {}) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
      }

      const response = await fetch(`${this.baseUrl}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args
          }
        })
      });
      
      if (!response.ok) {
        throw new Error(`BCGPT request failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(`BCGPT error: ${data.error.message}`);
      }
      
      return JSON.parse(data.result.content[0].text);
    } catch (error) {
      console.error(`BCGPT client error: ${error.message}`);
      throw error;
    }
  }

  // Projects
  async getProjects() {
    return this.request('bc_projects_list');
  }

  async getProject(projectId) {
    return this.request('bc_project_get', { project_id: projectId });
  }

  // Todolists
  async getTodolists(projectId) {
    return this.request('bc_todolists_list', { project_id: projectId });
  }

  async getTodos(todolistId) {
    return this.request('bc_todos_list', { todolist_id: todolistId });
  }

  // Messages
  async getMessages(projectId, options = {}) {
    return this.request('bc_messages_list', {
      project_id: projectId,
      ...options
    });
  }

  // People
  async getPerson(personId) {
    return this.request('bc_people_get', { person_id: personId });
  }

  async getPeople() {
    return this.request('bc_people_list');
  }

  async getPersonAssignments(personId) {
    return this.request('bc_people_assignments', { person_id: personId });
  }

  // Schedule
  async getScheduleEntries(scheduleId, options = {}) {
    return this.request('bc_schedule_entries_list', {
      schedule_id: scheduleId,
      ...options
    });
  }
}

export default BCGPTClient;
