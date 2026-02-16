/**
 * Workspace Context & Data Isolation Utilities
 *
 * Provides helpers to ensure all data operations are scoped to the correct workspace.
 * Critical for multi-tenant PMOS security.
 */

import type { GatewayClient } from "./server-methods/types.js";

/**
 * Extract workspace ID from gateway client
 */
export function getWorkspaceId(client: GatewayClient): string | undefined {
  return client.pmosWorkspaceId;
}

/**
 * Require workspace ID - throws if missing
 */
export function requireWorkspaceId(client: GatewayClient): string {
  const workspaceId = getWorkspaceId(client);
  if (!workspaceId) {
    throw new Error("Workspace ID required for this operation");
  }
  return workspaceId;
}

/**
 * Check if workspace ID matches (for ownership validation)
 */
export function isWorkspaceOwned(client: GatewayClient, resourceWorkspaceId?: string): boolean {
  if (!resourceWorkspaceId) {
    return false;
  }
  const clientWorkspaceId = getWorkspaceId(client);
  return clientWorkspaceId === resourceWorkspaceId;
}

/**
 * Require workspace ownership - throws if not owned
 */
export function requireWorkspaceOwnership(
  client: GatewayClient,
  resourceWorkspaceId?: string,
  resourceType = "resource",
): void {
  if (!isWorkspaceOwned(client, resourceWorkspaceId)) {
    throw new Error(`Access denied: ${resourceType} belongs to different workspace`);
  }
}

/**
 * Filter array by workspace ID
 */
export function filterByWorkspace<T extends { workspaceId?: string }>(
  items: T[],
  client: GatewayClient,
): T[] {
  const workspaceId = getWorkspaceId(client);
  if (!workspaceId) {
    // No workspace context - return all (backwards compatibility for non-PMOS usage)
    return items;
  }
  return items.filter((item) => item.workspaceId === workspaceId);
}

/**
 * Add workspace ID to a new resource
 */
export function addWorkspaceId<T extends Record<string, unknown>>(
  resource: T,
  client: GatewayClient,
): T & { workspaceId?: string } {
  const workspaceId = getWorkspaceId(client);
  if (!workspaceId) {
    return resource;
  }
  return { ...resource, workspaceId };
}

/**
 * Check if client has super admin role (can access all workspaces)
 */
export function isSuperAdmin(client: GatewayClient): boolean {
  return client.pmosRole === "super_admin";
}

/**
 * Get effective workspace ID (super admins can optionally target specific workspace)
 */
export function getEffectiveWorkspaceId(
  client: GatewayClient,
  targetWorkspaceId?: string,
): string | undefined {
  if (isSuperAdmin(client) && targetWorkspaceId) {
    return targetWorkspaceId;
  }
  return getWorkspaceId(client);
}
