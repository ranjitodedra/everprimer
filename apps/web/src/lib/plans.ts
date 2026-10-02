/**
 * Display catalog for Free, Plus (`paid`), and Max.
 * Balances, child caps, and enqueue limits are enforced in
 * packages/db/supabase/migrations/0004_billing.sql. Keep the numbers together.
 */

export const PLANS = {
  free: {
    id: "free" as const,
    name: "Free",
    price: 0,
    credits: 10,
    childCap: 1,
    regenerate: false,
  },
  paid: {
    id: "paid" as const,
    name: "Plus",
    price: 12,
    credits: 50,
    childCap: 8,
    regenerate: true,
  },
  max: {
    id: "max" as const,
    name: "Max",
    price: 29,
    credits: 150,
    childCap: 8,
    regenerate: true,
  },
};

export type PlanId = keyof typeof PLANS;

/** At most this many curricula created per account per rolling hour. */
export const CURRICULUM_HOURLY_LIMIT = 5;

/** Queued plus running generation jobs per account. Memory jobs are not included. */
export const MAX_CONCURRENT_JOBS = 2;

/** Active inferred memory cards. Free accounts do not compact. */
export function inferredMemoryCap(tier: string): number {
  if (tier === "max") return 100;
  if (tier === "paid") return 30;
  return 0;
}

export function planFor(tier: string) {
  if (tier === "paid" || tier === "max" || tier === "free") return PLANS[tier];
  return PLANS.free;
}

export function formatPrice(price: number): string {
  return price === 0 ? "$0" : `$${price}`;
}
