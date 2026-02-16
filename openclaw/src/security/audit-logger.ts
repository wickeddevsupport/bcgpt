/**
 * Security Audit Logging (M3)
 *
 * Logs all security-relevant events for compliance and forensics.
 */

export type AuditAction =
  | "user.login"
  | "user.logout"
  | "user.created"
  | "user.deleted"
  | "workspace.created"
  | "workspace.deleted"
  | "agent.created"
  | "agent.updated"
  | "agent.deleted"
  | "session.created"
  | "config.updated"
  | "api.key.created"
  | "api.key.revoked"
  | "permission.granted"
  | "permission.revoked"
  | "auth.failed";

export interface AuditLogEntry {
  timestamp: number;
  workspaceId?: string;
  userId?: string;
  action: AuditAction;
  resource?: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export class AuditLogger {
  private logs: AuditLogEntry[] = [];

  log(entry: Omit<AuditLogEntry, "timestamp">): void {
    const fullEntry: AuditLogEntry = {
      timestamp: Date.now(),
      ...entry,
    };

    this.logs.push(fullEntry);

    // In production, write to persistent storage
    console.log(`[AUDIT] ${JSON.stringify(fullEntry)}`);
  }

  logSuccess(action: AuditAction, context: Partial<AuditLogEntry>): void {
    this.log({
      action,
      success: true,
      ...context,
    });
  }

  logFailure(action: AuditAction, error: string, context: Partial<AuditLogEntry>): void {
    this.log({
      action,
      success: false,
      error,
      ...context,
    });
  }

  query(filter: {
    workspaceId?: string;
    userId?: string;
    action?: AuditAction;
    startTime?: number;
    endTime?: number;
  }): AuditLogEntry[] {
    return this.logs.filter((entry) => {
      if (filter.workspaceId && entry.workspaceId !== filter.workspaceId) return false;
      if (filter.userId && entry.userId !== filter.userId) return false;
      if (filter.action && entry.action !== filter.action) return false;
      if (filter.startTime && entry.timestamp < filter.startTime) return false;
      if (filter.endTime && entry.timestamp > filter.endTime) return false;
      return true;
    });
  }

  getRecentFailures(limit = 100): AuditLogEntry[] {
    return this.logs
      .filter((entry) => !entry.success)
      .slice(-limit)
      .reverse();
  }
}

// Singleton instance
export const auditLogger = new AuditLogger();
