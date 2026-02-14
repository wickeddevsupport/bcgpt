/**
 * Activepieces Client
 * Helper to communicate with Activepieces API
 */

import fetch from 'node-fetch';
import { config } from './flow-config.js';

export class ActivepiecesClient {
  constructor() {
    this.baseUrl = config.activepiecesUrl;
    this.apiKey = config.activepiecesApiKey;
  }

  async request(endpoint, method = 'GET', body = null) {
    try {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        }
      };
      
      if (body) {
        options.body = JSON.stringify(body);
      }
      
      const response = await fetch(`${this.baseUrl}/api/v1/${endpoint}`, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Activepieces API error: ${response.statusText} - ${errorText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`Activepieces client error: ${error.message}`);
      throw error;
    }
  }

  // Flows
  async listFlows(projectId = null) {
    const endpoint = projectId ? `flows?projectId=${projectId}` : 'flows';
    return await this.request(endpoint);
  }

  async getFlow(flowId) {
    return await this.request(`flows/${flowId}`);
  }

  async createFlow(flowData) {
    return await this.request('flows', 'POST', flowData);
  }

  async updateFlow(flowId, flowData) {
    return await this.request(`flows/${flowId}`, 'PATCH', flowData);
  }

  async deleteFlow(flowId) {
    return await this.request(`flows/${flowId}`, 'DELETE');
  }

  // Flow Runs
  async triggerFlow(flowId, payload = {}) {
    return await this.request(`flows/${flowId}/trigger`, 'POST', payload);
  }

  async listFlowRuns(flowId, limit = 10) {
    return await this.request(`flow-runs?flowId=${flowId}&limit=${limit}`);
  }

  async getFlowRun(runId) {
    return await this.request(`flow-runs/${runId}`);
  }

  // Projects
  async listProjects() {
    return await this.request('projects');
  }

  async createProject(name, platformId = null) {
    return await this.request('projects', 'POST', {
      displayName: name,
      platformId
    });
  }

  // Pieces (Available Integrations)
  async listPieces() {
    return await this.request('pieces');
  }

  // Connections (API Keys for integrations)
  async listConnections(projectId = null) {
    const endpoint = projectId ? `connections?projectId=${projectId}` : 'connections';
    return await this.request(endpoint);
  }

  async createConnection(name, pieceName, value, projectId) {
    return await this.request('connections', 'POST', {
      name,
      pieceName,
      value,
      projectId
    });
  }
}

export default ActivepiecesClient;
