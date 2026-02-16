/**
 * Usage Tracking & Metering (M2)
 *
 * Tracks usage metrics for billing and quota enforcement.
 */

import type { SubscriptionTier } from "./plans.js";
import { SUBSCRIPTION_TIERS } from "./plans.js";

export type UsageEventType = "agent_run" | "session_created" | "storage_used" | "api_call";

export interface UsageRecord {
  workspaceId: string;
  timestamp: number;
  eventType: UsageEventType;
  quantity: number;
  metadata?: Record<string, unknown>;
}

export interface UsageSummary {
  agentRuns: number;
  sessionsCreated: number;
  storageUsed: number;
  apiCalls: number;
}

export class UsageTracker {
  private records: UsageRecord[] = [];

  async trackAgentRun(workspaceId: string, agentId: string): Promise<void> {
    this.records.push({
      workspaceId,
      timestamp: Date.now(),
      eventType: "agent_run",
      quantity: 1,
      metadata: { agentId },
    });
  }

  async trackSessionCreated(workspaceId: string, sessionId: string): Promise<void> {
    this.records.push({
      workspaceId,
      timestamp: Date.now(),
      eventType: "session_created",
      quantity: 1,
      metadata: { sessionId },
    });
  }

  async trackStorageUsed(workspaceId: string, bytes: number): Promise<void> {
    this.records.push({
      workspaceId,
      timestamp: Date.now(),
      eventType: "storage_used",
      quantity: bytes,
    });
  }

  async trackApiCall(workspaceId: string, endpoint: string): Promise<void> {
    this.records.push({
      workspaceId,
      timestamp: Date.now(),
      eventType: "api_call",
      quantity: 1,
      metadata: { endpoint },
    });
  }

  async getUsageSummary(
    workspaceId: string,
    startTime: number,
    endTime: number,
  ): Promise<UsageSummary> {
    const workspaceRecords = this.records.filter(
      (r) => r.workspaceId === workspaceId && r.timestamp >= startTime && r.timestamp <= endTime,
    );

    return {
      agentRuns: workspaceRecords.filter((r) => r.eventType === "agent_run").length,
      sessionsCreated: workspaceRecords.filter((r) => r.eventType === "session_created").length,
      storageUsed: workspaceRecords
        .filter((r) => r.eventType === "storage_used")
        .reduce((sum, r) => sum + r.quantity, 0),
      apiCalls: workspaceRecords.filter((r) => r.eventType === "api_call").length,
    };
  }

  async checkLimits(
    workspaceId: string,
    tier: SubscriptionTier,
  ): Promise<{
    agentsOk: boolean;
    sessionsOk: boolean;
    storageOk: boolean;
  }> {
    const limits = SUBSCRIPTION_TIERS[tier].features;
    const usage = await this.getUsageSummary(workspaceId, 0, Date.now());

    return {
      agentsOk: typeof limits.agents === "number" ? usage.agentRuns < limits.agents : true,
      sessionsOk:
        typeof limits.sessions === "number" ? usage.sessionsCreated < limits.sessions : true,
      storageOk: true, // TODO: Implement storage limit checking
    };
  }

  async isWithinLimits(workspaceId: string, tier: SubscriptionTier): Promise<boolean> {
    const limits = await this.checkLimits(workspaceId, tier);
    return limits.agentsOk && limits.sessionsOk && limits.storageOk;
  }
}

// Singleton instance
export const usageTracker = new UsageTracker();
