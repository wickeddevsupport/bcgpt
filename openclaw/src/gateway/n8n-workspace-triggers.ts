/**
 * n8n Workspace-Aware Trigger System
 *
 * Ensures all n8n workflow triggers respect workspace isolation.
 * When a trigger fires, the execution context is tagged with the
 * workspace that owns the workflow, preventing cross-workspace data access.
 *
 * Integration points:
 *   1. Webhook triggers → workspace ID injected from URL path or headers
 *   2. Cron/Schedule triggers → workspace ID stored with workflow metadata
 *   3. Manual triggers → workspace ID from authenticated user session
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveOpenClawUser } from "./n8n-auth-bridge.js";
import { isSuperAdmin } from "./workspace-context.js";

/**
 * Metadata attached to n8n workflow executions for workspace isolation.
 */
export type WorkspaceExecutionContext = {
  workspaceId: string;
  userId?: string;
  role?: string;
};

/**
 * Registry of workflow → workspace mappings.
 * Loaded from workspace connectors and n8n project associations.
 */
const workflowWorkspaceMap = new Map<string, string>();

/**
 * Register a workflow as belonging to a workspace.
 * Called when workflows are created or imported via the OpenClaw UI.
 */
export function registerWorkflowWorkspace(
  workflowId: string,
  workspaceId: string,
): void {
  workflowWorkspaceMap.set(workflowId, workspaceId);
}

/**
 * Look up the workspace that owns a given workflow.
 */
export function getWorkflowWorkspace(workflowId: string): string | undefined {
  return workflowWorkspaceMap.get(workflowId);
}

/**
 * Remove a workflow from the registry (on deletion).
 */
export function unregisterWorkflow(workflowId: string): void {
  workflowWorkspaceMap.delete(workflowId);
}

/**
 * Validate that a webhook request targets a workflow owned by the expected workspace.
 * Used to prevent cross-workspace webhook spoofing.
 *
 * Returns the workspace context if valid, null if the webhook target is unknown
 * (which is OK for public webhooks), or throws on explicit workspace mismatch.
 */
export function validateWebhookWorkspace(
  workflowId: string,
  expectedWorkspaceId?: string,
): WorkspaceExecutionContext | null {
  const ownerWorkspace = workflowWorkspaceMap.get(workflowId);
  if (!ownerWorkspace) {
    // Workflow not in registry — might be a legacy or external workflow
    return null;
  }

  if (expectedWorkspaceId && ownerWorkspace !== expectedWorkspaceId) {
    throw new Error(
      `Webhook workspace mismatch: workflow ${workflowId} belongs to workspace ${ownerWorkspace}, not ${expectedWorkspaceId}`,
    );
  }

  return { workspaceId: ownerWorkspace };
}

/**
 * Middleware for webhook endpoints that tags the execution with workspace context.
 * Reads workspace from the n8n project association or authenticated session.
 *
 * Returns true if the request was intercepted (blocked due to workspace violation).
 */
export async function enforceWebhookWorkspaceIsolation(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  // Only intercept webhook paths
  const webhookPrefixes = ["/webhook/", "/webhook-test/", "/webhook-waiting/"];
  const isWebhook = webhookPrefixes.some(
    (p) => pathname.startsWith(p) || pathname === p.slice(0, -1),
  );
  if (!isWebhook) return false;

  // Extract workflow ID from webhook path (format: /webhook/{workflowId}/{path})
  // n8n webhook paths vary, so we do best-effort extraction
  const pathParts = pathname.split("/").filter(Boolean);
  // pathParts[0] = "webhook" | "webhook-test" | "webhook-waiting"
  // pathParts[1] = webhook path or ID
  const webhookPath = pathParts[1];
  if (!webhookPath) return false;

  // Check if the authenticated user (if any) owns this workflow's workspace
  const user = await resolveOpenClawUser(req);
  if (user && !isSuperAdmin({ pmosRole: user.role, connect: {} as never })) {
    const ownerWorkspace = workflowWorkspaceMap.get(webhookPath);
    if (ownerWorkspace && ownerWorkspace !== user.workspaceId) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "Workspace access denied" }));
      return true;
    }
  }

  // Tag the request with workspace context for downstream use
  if (user) {
    (req as IncomingMessage & { workspaceContext?: WorkspaceExecutionContext }).workspaceContext = {
      workspaceId: user.workspaceId,
      userId: user.id,
      role: user.role,
    };
  }

  return false;
}

/**
 * List all workflows registered for a specific workspace.
 */
export function listWorkspaceWorkflows(workspaceId: string): string[] {
  const result: string[] = [];
  for (const [workflowId, wsId] of workflowWorkspaceMap) {
    if (wsId === workspaceId) {
      result.push(workflowId);
    }
  }
  return result;
}

/**
 * Bulk-register workflow → workspace mappings.
 * Called on startup to hydrate the registry from n8n's project associations.
 */
export function hydrateWorkflowRegistry(
  mappings: Array<{ workflowId: string; workspaceId: string }>,
): void {
  for (const { workflowId, workspaceId } of mappings) {
    workflowWorkspaceMap.set(workflowId, workspaceId);
  }
}
