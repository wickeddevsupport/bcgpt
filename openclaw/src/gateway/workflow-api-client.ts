/**
 * Workflow Engine API Client
 *
 * Neutral export surface over the historical `n8n-api-client` module. The
 * runtime is Activepieces/Flow, but legacy callers can continue to work while
 * new code imports workflow-engine terminology.
 */

export {
  type N8nExecution as WorkflowEngineRun,
  type N8nNodeType as WorkflowEngineNodeType,
  type N8nTag as WorkflowEngineTag,
  type N8nWorkflow as WorkflowEngineWorkflow,
  cancelN8nExecution as cancelWorkflowEngineRun,
  createN8nCredential as createWorkflowEngineConnection,
  createN8nWorkflow as createWorkflowEngineWorkflow,
  deleteN8nCredential as deleteWorkflowEngineConnection,
  deleteN8nWorkflow as deleteWorkflowEngineWorkflow,
  executeN8nWorkflow as executeWorkflowEngineWorkflow,
  getN8nExecution as getWorkflowEngineRun,
  getN8nWorkflow as getWorkflowEngineWorkflow,
  listN8nCredentials as listWorkflowEngineConnections,
  listN8nNodeTypes as listWorkflowEngineNodeTypes,
  listN8nWorkflows as listWorkflowEngineWorkflows,
  setWorkflowActive as setWorkflowEngineWorkflowActive,
  updateN8nWorkflow as updateWorkflowEngineWorkflow,
  upsertBasecampCredential as upsertBasecampWorkflowConnection,
} from "./n8n-api-client.js";
