/**
 * Stripe Integration for PMOS Billing (M2)
 *
 * Handles subscription management, customer creation, and billing portal access.
 */

// Uncomment when Stripe is installed:
// import Stripe from "stripe";

// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
//   apiVersion: "2024-11-20.acacia",
// });

export interface CreateCustomerParams {
  email: string;
  workspaceId: string;
  name?: string;
}

export interface CreateSubscriptionParams {
  customerId: string;
  priceId: string;
}

export interface CreateCheckoutSessionParams {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateBillingPortalSessionParams {
  customerId: string;
  returnUrl: string;
}

export async function createCustomer(params: CreateCustomerParams) {
  // TODO: Install Stripe SDK: npm install stripe
  // return await stripe.customers.create({
  //   email: params.email,
  //   metadata: { workspaceId: params.workspaceId },
  //   name: params.name,
  // });

  throw new Error("Stripe not configured. Install stripe SDK and configure STRIPE_SECRET_KEY");
}

export async function createSubscription(params: CreateSubscriptionParams) {
  // return await stripe.subscriptions.create({
  //   customer: params.customerId,
  //   items: [{ price: params.priceId }],
  //   payment_behavior: "default_incomplete",
  //   payment_settings: { save_default_payment_method: "on_subscription" },
  //   expand: ["latest_invoice.payment_intent"],
  // });

  throw new Error("Stripe not configured");
}

export async function createCheckoutSession(params: CreateCheckoutSessionParams) {
  // return await stripe.checkout.sessions.create({
  //   customer: params.customerId,
  //   mode: "subscription",
  //   line_items: [{ price: params.priceId, quantity: 1 }],
  //   success_url: params.successUrl,
  //   cancel_url: params.cancelUrl,
  // });

  throw new Error("Stripe not configured");
}

export async function createBillingPortalSession(params: CreateBillingPortalSessionParams) {
  // return await stripe.billingPortal.sessions.create({
  //   customer: params.customerId,
  //   return_url: params.returnUrl,
  // });

  throw new Error("Stripe not configured");
}

export async function getSubscription(subscriptionId: string) {
  // return await stripe.subscriptions.retrieve(subscriptionId);
  throw new Error("Stripe not configured");
}

export async function cancelSubscription(subscriptionId: string) {
  // return await stripe.subscriptions.cancel(subscriptionId);
  throw new Error("Stripe not configured");
}
