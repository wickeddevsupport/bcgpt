/**
 * Rate Limiting (M3)
 *
 * Prevents abuse by limiting request rates per workspace/user.
 */

export interface RateLimitRule {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

export const RATE_LIMITS: Record<string, RateLimitRule> = {
  // Agent operations
  "agents.create": { windowMs: 60000, maxRequests: 10 }, // 10 per minute
  "agents.update": { windowMs: 60000, maxRequests: 30 },
  "agents.delete": { windowMs: 60000, maxRequests: 10 },

  // Session operations
  "sessions.create": { windowMs: 60000, maxRequests: 30 },
  "chat.send": { windowMs: 1000, maxRequests: 5 }, // 5 per second

  // API operations
  "api.call": { windowMs: 60000, maxRequests: 100 },

  // Workflow operations
  "ops_workflow_create": { windowMs: 60000, maxRequests: 20 },
  "ops_workflow_execute": { windowMs: 60000, maxRequests: 100 },
};

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number; // Seconds to wait before retry
  remaining?: number; // Requests remaining in window
}

export class RateLimiter {
  private requests = new Map<string, number[]>();

  check(workspaceId: string, method: string): RateLimitResult {
    const rule = RATE_LIMITS[method];
    if (!rule) {
      return { allowed: true };
    }

    const key = `${workspaceId}:${method}`;
    const now = Date.now();
    const windowStart = now - rule.windowMs;

    // Get existing requests in current window
    const timestamps = (this.requests.get(key) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= rule.maxRequests) {
      const oldestRequest = Math.min(...timestamps);
      const retryAfter = Math.ceil((oldestRequest + rule.windowMs - now) / 1000);
      return {
        allowed: false,
        retryAfter,
        remaining: 0,
      };
    }

    // Record this request
    timestamps.push(now);
    this.requests.set(key, timestamps);

    return {
      allowed: true,
      remaining: rule.maxRequests - timestamps.length,
    };
  }

  reset(workspaceId: string, method?: string): void {
    if (method) {
      this.requests.delete(`${workspaceId}:${method}`);
    } else {
      // Reset all for workspace
      const prefix = `${workspaceId}:`;
      for (const key of this.requests.keys()) {
        if (key.startsWith(prefix)) {
          this.requests.delete(key);
        }
      }
    }
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();
