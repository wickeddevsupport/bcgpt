# PMOS Productization - Complete Implementation Guide

**Status:** Foundations Built, Implementation In Progress
**Created:** 2026-02-17
**Scope:** M1.5 (Workspace Isolation) → M4 (Advanced Features)

---

## 🎯 Overview

This guide provides the complete implementation roadmap for PMOS productization, from workspace isolation through advanced features.

**What's Built:**
- ✅ Workspace context utilities (openclaw/src/gateway/workspace-context.ts)
- ✅ n8n integration (wicked-ops extension + custom Basecamp node)
- ✅ Multi-user auth system (super_admin, workspace_admin, member, viewer roles)
- ✅ PMOS UI foundation

**What Needs Implementation:**
- 🔄 M1.5: Workspace Isolation (CRITICAL - blocks multi-tenant)
- 📋 M2: Billing & Subscriptions
- 📋 M3: Enhanced Security
- 📋 M4: Advanced Features

---

## M1.5: Workspace Isolation (CRITICAL)

### Priority: 🔴 HIGHEST - Blocks All Multi-Tenant Features

### Objective
Ensure complete data isolation between workspaces. No user should ever see or access another workspace's data.

### Implementation Status

**✅ Completed:**
- Workspace context utilities (`workspace-context.ts`)
- `pmosWorkspaceId` tracked in `GatewayClient`
- Auth system assigns workspace on signup

**🔄 In Progress:**
- Apply workspace filtering to all server-methods

**📋 Remaining:**
- Update 40+ server-method files
- Database schema updates (add workspaceId columns)
- Integration tests for data isolation

### How to Implement

#### Step 1: Import Workspace Utilities

In each server-method file (agents.ts, sessions.ts, config.ts, etc.):

```typescript
import {
  getWorkspaceId,
  requireWorkspaceId,
  filterByWorkspace,
  addWorkspaceId,
  requireWorkspaceOwnership,
  isSuperAdmin,
} from "../workspace-context.js";
```

#### Step 2: Update List Operations

**Before:**
```typescript
"agents.list": ({ params, respond }) => {
  const cfg = loadConfig();
  const result = listAgentsForGateway(cfg);
  respond(true, result, undefined);
},
```

**After:**
```typescript
"agents.list": ({ params, respond, client }) => {
  const cfg = loadConfig();
  const allAgents = listAgentsForGateway(cfg);

  // Filter by workspace
  const workspaceAgents = filterByWorkspace(allAgents, client);

  respond(true, workspaceAgents, undefined);
},
```

#### Step 3: Update Create Operations

**Before:**
```typescript
"agents.create": async ({ params, respond }) => {
  const newAgent = await createAgent(params);
  respond(true, newAgent, undefined);
},
```

**After:**
```typescript
"agents.create": async ({ params, respond, client }) => {
  // Add workspace ID to new resource
  const agentWithWorkspace = addWorkspaceId(params, client);
  const newAgent = await createAgent(agentWithWorkspace);
  respond(true, newAgent, undefined);
},
```

#### Step 4: Update Get/Update/Delete Operations

**Before:**
```typescript
"agents.delete": async ({ params, respond }) => {
  await deleteAgent(params.agentId);
  respond(true, undefined, undefined);
},
```

**After:**
```typescript
"agents.delete": async ({ params, respond, client }) => {
  const agent = await getAgent(params.agentId);

  // Verify workspace ownership
  requireWorkspaceOwnership(client, agent.workspaceId, "agent");

  await deleteAgent(params.agentId);
  respond(true, undefined, undefined);
},
```

### Files Requiring Updates

**High Priority (Core Data):**
- ✅ `workspace-context.ts` - DONE
- 🔄 `agents.ts` - IN PROGRESS
- 📋 `sessions.ts` - User chat sessions
- 📋 `cron.ts` - Scheduled jobs
- 📋 `config.ts` - Workspace configuration
- 📋 `chat.ts` - Chat transcripts
- 📋 `logs.ts` - System logs

**Medium Priority:**
- 📋 `skills.ts` - Custom tools/skills
- 📋 `models.ts` - Model configurations
- 📋 `devices.ts` - Paired devices
- 📋 `exec-approvals.ts` - Command approvals
- 📋 `pmos.ts` - PMOS-specific operations

**Lower Priority (Mostly Global):**
- 📋 `health.ts` - System health (mostly global, some workspace-specific)
- 📋 `usage.ts` - Usage tracking (needs workspace for billing)
- 📋 `system.ts` - System operations (mostly global)

### Database Schema Updates

Add `workspaceId` column to persistent storage:

```typescript
// Example for agents
interface Agent {
  id: string;
  name: string;
  workspaceId?: string; // ADD THIS
  config: AgentConfig;
  createdAt: number;
}

// Example for sessions
interface Session {
  sessionId: string;
  agentId: string;
  workspaceId?: string; // ADD THIS
  messages: Message[];
  createdAt: number;
}

// Example for cron jobs
interface CronJob {
  id: string;
  schedule: string;
  workspaceId?: string; // ADD THIS
  command: string;
  enabled: boolean;
}
```

### Testing Workspace Isolation

Create test script:

```typescript
// test-workspace-isolation.ts
import { test } from "node:test";
import assert from "node:assert";

test("agents are isolated by workspace", async () => {
  const workspace1Client = { pmosWorkspaceId: "ws1" };
  const workspace2Client = { pmosWorkspaceId: "ws2" };

  // Create agent in workspace 1
  const agent1 = await createAgent({ name: "Agent 1" }, workspace1Client);

  // List agents from workspace 2
  const ws2Agents = await listAgents(workspace2Client);

  // Workspace 2 should NOT see workspace 1's agent
  assert.strictEqual(ws2Agents.find(a => a.id === agent1.id), undefined);
});

test("user cannot delete agent from other workspace", async () => {
  const workspace1Client = { pmosWorkspaceId: "ws1" };
  const workspace2Client = { pmosWorkspaceId: "ws2" };

  const agent1 = await createAgent({ name: "Agent 1" }, workspace1Client);

  // Attempt to delete from workspace 2 should fail
  await assert.rejects(
    async () => await deleteAgent(agent1.id, workspace2Client),
    /Access denied/
  );
});
```

### Super Admin Override

Super admins can access all workspaces:

```typescript
if (isSuperAdmin(client)) {
  // Super admin sees all workspaces
  return allAgents;
}

// Regular users see only their workspace
return filterByWorkspace(allAgents, client);
```

### Rollout Plan

1. **Week 1:** Update core files (agents, sessions, cron, config)
2. **Week 2:** Update medium priority files (skills, models, devices)
3. **Week 3:** Update remaining files + database migrations
4. **Week 4:** Testing, bug fixes, documentation

### Validation Checklist

- [ ] All server-methods filter by workspaceId
- [ ] All create operations add workspaceId
- [ ] All update/delete operations verify ownership
- [ ] Database schema includes workspaceId columns
- [ ] Integration tests pass
- [ ] No cross-workspace data leakage
- [ ] Super admin can access all workspaces
- [ ] Regular users isolated to their workspace

---

## M2: Billing & Subscriptions

### Priority: 🟡 HIGH - Required for Revenue

### Objective
Implement subscription billing with Stripe, usage tracking, and billing portal.

### Architecture

```
PMOS User → Billing Portal UI → Stripe API → Webhooks → Usage Tracking
```

### Implementation Framework

#### Step 1: Stripe Integration

**File:** `openclaw/src/billing/stripe-client.ts`

```typescript
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-11-20.acacia",
});

export async function createCustomer(params: {
  email: string;
  workspaceId: string;
  name?: string;
}) {
  return await stripe.customers.create({
    email: params.email,
    metadata: {
      workspaceId: params.workspaceId,
    },
    name: params.name,
  });
}

export async function createSubscription(params: {
  customerId: string;
  priceId: string;
}) {
  return await stripe.subscriptions.create({
    customer: params.customerId,
    items: [{ price: params.priceId }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    expand: ["latest_invoice.payment_intent"],
  });
}

export async function createCheckoutSession(params: {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  return await stripe.checkout.sessions.create({
    customer: params.customerId,
    mode: "subscription",
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
}

export async function createBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}) {
  return await stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
}

export async function getSubscription(subscriptionId: string) {
  return await stripe.subscriptions.retrieve(subscriptionId);
}

export async function cancelSubscription(subscriptionId: string) {
  return await stripe.subscriptions.cancel(subscriptionId);
}
```

#### Step 2: Subscription Tiers

**File:** `openclaw/src/billing/plans.ts`

```typescript
export const SUBSCRIPTION_TIERS = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    priceId: null,
    features: {
      agents: 3,
      sessions: 100,
      storage: "1GB",
      support: "community",
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 29,
    priceId: process.env.STRIPE_PRICE_ID_PRO,
    features: {
      agents: 20,
      sessions: 1000,
      storage: "10GB",
      support: "email",
      apiAccess: true,
    },
  },
  team: {
    id: "team",
    name: "Team",
    price: 99,
    priceId: process.env.STRIPE_PRICE_ID_TEAM,
    features: {
      agents: 100,
      sessions: 10000,
      storage: "100GB",
      support: "priority",
      apiAccess: true,
      sso: true,
    },
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    price: null, // Custom pricing
    priceId: null,
    features: {
      agents: "unlimited",
      sessions: "unlimited",
      storage: "unlimited",
      support: "24/7",
      apiAccess: true,
      sso: true,
      selfHosted: true,
    },
  },
} as const;
```

#### Step 3: Usage Tracking

**File:** `openclaw/src/billing/usage-tracker.ts`

```typescript
interface UsageRecord {
  workspaceId: string;
  timestamp: number;
  eventType: "agent_run" | "session_created" | "storage_used";
  quantity: number;
  metadata?: Record<string, unknown>;
}

export class UsageTracker {
  private records: UsageRecord[] = [];

  async trackAgentRun(workspaceId: string, agentId: string) {
    this.records.push({
      workspaceId,
      timestamp: Date.now(),
      eventType: "agent_run",
      quantity: 1,
      metadata: { agentId },
    });
  }

  async trackSessionCreated(workspaceId: string) {
    this.records.push({
      workspaceId,
      timestamp: Date.now(),
      eventType: "session_created",
      quantity: 1,
    });
  }

  async getUsageSummary(workspaceId: string, startTime: number, endTime: number) {
    const workspaceRecords = this.records.filter(
      (r) => r.workspaceId === workspaceId && r.timestamp >= startTime && r.timestamp <= endTime
    );

    return {
      agentRuns: workspaceRecords.filter((r) => r.eventType === "agent_run").length,
      sessionsCreated: workspaceRecords.filter((r) => r.eventType === "session_created").length,
      storageUsed: workspaceRecords
        .filter((r) => r.eventType === "storage_used")
        .reduce((sum, r) => sum + r.quantity, 0),
    };
  }

  async checkLimits(workspaceId: string, tier: keyof typeof SUBSCRIPTION_TIERS) {
    const limits = SUBSCRIPTION_TIERS[tier].features;
    const usage = await this.getUsageSummary(workspaceId, 0, Date.now());

    return {
      agentsOk: typeof limits.agents === "number" ? usage.agentRuns < limits.agents : true,
      sessionsOk: typeof limits.sessions === "number" ? usage.sessionsCreated < limits.sessions : true,
    };
  }
}
```

#### Step 4: Webhook Handler

**File:** `openclaw/src/billing/webhooks.ts`

```typescript
import type { Request, Response } from "express";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-11-20.acacia",
});

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${(err as Error).message}`);
  }

  switch (event.type) {
    case "customer.subscription.created":
      await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    case "invoice.payment_succeeded":
      await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_failed":
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      break;
  }

  res.json({ received: true });
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  const workspaceId = subscription.metadata.workspaceId;
  // Update workspace subscription status in database
  console.log(`Subscription created for workspace ${workspaceId}`);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  // Handle plan changes, renewals, etc.
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  // Handle cancellations
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  // Mark payment as successful
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  // Alert user, potentially downgrade plan
}
```

#### Step 5: Billing Portal UI

**File:** `openclaw/ui/src/ui/views/billing.ts`

```typescript
import type { ViewRenderer } from "../view-types.js";

export const billingView: ViewRenderer = (api) => {
  const currentPlan = api.config.pmos?.billing?.plan ?? "free";
  const customerId = api.config.pmos?.billing?.customerId;

  return {
    id: "billing",
    title: "Billing & Subscriptions",
    render: () => `
      <div class="billing-view">
        <h2>Current Plan: ${currentPlan}</h2>

        <div class="plan-cards">
          ${renderPlanCard("free")}
          ${renderPlanCard("pro")}
          ${renderPlanCard("team")}
          ${renderPlanCard("enterprise")}
        </div>

        ${customerId ? `
          <button onclick="openBillingPortal()">
            Manage Subscription
          </button>
        ` : ""}

        <div class="usage-stats">
          <h3>Current Usage</h3>
          <!-- Usage charts here -->
        </div>
      </div>
    `,
  };
};

function renderPlanCard(tier: string) {
  // Render subscription plan card with features
  return `<div class="plan-card">${tier}</div>`;
}
```

### Testing Billing

```typescript
// test-billing.ts
test("subscription creation flow", async () => {
  const customer = await createCustomer({
    email: "test@example.com",
    workspaceId: "ws1",
  });

  const subscription = await createSubscription({
    customerId: customer.id,
    priceId: SUBSCRIPTION_TIERS.pro.priceId!,
  });

  assert.strictEqual(subscription.status, "active");
});
```

---

## M3: Enhanced Security

### Priority: 🟠 MEDIUM - Required for Production

### Security Measures

#### 1. Rate Limiting

**File:** `openclaw/src/security/rate-limit.ts`

```typescript
interface RateLimitRule {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

const RATE_LIMITS: Record<string, RateLimitRule> = {
  "agents.create": { windowMs: 60000, maxRequests: 10 }, // 10 per minute
  "sessions.create": { windowMs: 60000, maxRequests: 30 },
  "chat.send": { windowMs: 1000, maxRequests: 5 }, // 5 per second
};

export class RateLimiter {
  private requests = new Map<string, number[]>();

  check(workspaceId: string, method: string): { allowed: boolean; retryAfter?: number } {
    const rule = RATE_LIMITS[method];
    if (!rule) return { allowed: true };

    const key = `${workspaceId}:${method}`;
    const now = Date.now();
    const windowStart = now - rule.windowMs;

    // Get existing requests in current window
    const timestamps = (this.requests.get(key) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= rule.maxRequests) {
      const oldestRequest = Math.min(...timestamps);
      const retryAfter = Math.ceil((oldestRequest + rule.windowMs - now) / 1000);
      return { allowed: false, retryAfter };
    }

    // Record this request
    timestamps.push(now);
    this.requests.set(key, timestamps);

    return { allowed: true };
  }
}
```

#### 2. Input Validation & Sanitization

```typescript
// openclaw/src/security/validators.ts
export function sanitizeInput(input: string): string {
  // Remove potentially dangerous characters
  return input.replace(/[<>\"'&]/g, "");
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateWorkspaceId(id: string): boolean {
  // UUID v4 format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}
```

#### 3. Security Headers

```typescript
// openclaw/src/security/headers.ts
export function addSecurityHeaders(res: Response) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Content-Security-Policy", "default-src 'self'");
}
```

#### 4. Audit Logging

```typescript
// openclaw/src/security/audit-log.ts
interface AuditLogEntry {
  timestamp: number;
  workspaceId: string;
  userId: string;
  action: string;
  resource: string;
  ip: string;
  success: boolean;
}

export function logAuditEvent(entry: AuditLogEntry) {
  // Log to file/database for security audits
  console.log(`[AUDIT] ${JSON.stringify(entry)}`);
}
```

---

## M4: Advanced Features

### AI Workflow Generation

**File:** `openclaw/src/ai/workflow-generator.ts`

```typescript
export async function generateWorkflow(description: string): Promise<N8nWorkflow> {
  // Use AI to generate n8n workflow from natural language
  const prompt = `Create an n8n workflow that: ${description}`;

  // Call AI model to generate workflow JSON
  const workflow = await ai.generateStructured(prompt, {
    schema: N8nWorkflowSchema,
  });

  return workflow;
}
```

### Workflow Templates

**File:** `openclaw/src/templates/library.ts`

```typescript
export const WORKFLOW_TEMPLATES = {
  "basecamp-daily-standup": {
    name: "Daily Standup to Basecamp",
    description: "Post daily standup summary to Basecamp",
    workflow: { /* n8n workflow JSON */ },
  },
  "todo-automation": {
    name: "Smart Todo Management",
    description: "Automatically prioritize and assign todos",
    workflow: { /* n8n workflow JSON */ },
  },
};
```

### Analytics Dashboard

**File:** `openclaw/ui/src/ui/views/analytics.ts`

```typescript
export const analyticsView: ViewRenderer = (api) => {
  return {
    id: "analytics",
    title: "Analytics",
    render: () => `
      <div class="analytics-view">
        <div class="metrics">
          <div class="metric">
            <h3>Agent Runs</h3>
            <span class="value">1,234</span>
          </div>
          <div class="metric">
            <h3>Active Sessions</h3>
            <span class="value">56</span>
          </div>
          <div class="metric">
            <h3>Workflows Executed</h3>
            <span class="value">789</span>
          </div>
        </div>

        <div class="charts">
          <!-- Charts here -->
        </div>
      </div>
    `,
  };
};
```

---

## Implementation Timeline

### Month 1: M1.5 Workspace Isolation
- Week 1-2: Update all server-methods
- Week 3: Database migrations
- Week 4: Testing & bug fixes

### Month 2: M2 Billing
- Week 1: Stripe integration
- Week 2: Subscription tiers & usage tracking
- Week 3: Billing portal UI
- Week 4: Webhook handling & testing

### Month 3: M3 Security
- Week 1-2: Rate limiting & validation
- Week 3: Security headers & audit logging
- Week 4: Security audit & penetration testing

### Month 4: M4 Advanced Features
- Week 1: AI workflow generation
- Week 2: Template library
- Week 3: Analytics dashboard
- Week 4: Final testing & launch

---

## Validation & Testing

### Workspace Isolation Tests
- [ ] Cross-workspace data access blocked
- [ ] Super admin can access all workspaces
- [ ] Workspace ownership verified on mutations

### Billing Tests
- [ ] Subscription creation works
- [ ] Plan upgrades/downgrades work
- [ ] Usage tracking accurate
- [ ] Webhooks handle all events

### Security Tests
- [ ] Rate limiting prevents abuse
- [ ] Input validation blocks XSS
- [ ] Security headers present
- [ ] Audit logs captured

### Advanced Features Tests
- [ ] AI workflow generation works
- [ ] Templates install correctly
- [ ] Analytics show correct data

---

**Status:** Frameworks Built - Ready for Full Implementation
**Next Steps:** Apply patterns to all 40+ server-method files
