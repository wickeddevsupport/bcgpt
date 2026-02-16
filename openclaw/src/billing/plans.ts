/**
 * PMOS Subscription Plans & Pricing (M2)
 */

export const SUBSCRIPTION_TIERS = {
  free: {
    id: "free" as const,
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
    id: "pro" as const,
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
    id: "team" as const,
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
    id: "enterprise" as const,
    name: "Enterprise",
    price: null,
    priceId: null,
    features: {
      agents: "unlimited" as const,
      sessions: "unlimited" as const,
      storage: "unlimited" as const,
      support: "24/7",
      apiAccess: true,
      sso: true,
      selfHosted: true,
    },
  },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

export function getPlan(tier: SubscriptionTier) {
  return SUBSCRIPTION_TIERS[tier];
}

export function getAllPlans() {
  return Object.values(SUBSCRIPTION_TIERS);
}
