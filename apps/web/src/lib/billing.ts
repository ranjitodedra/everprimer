import "server-only";
import type Stripe from "stripe";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENDED = new Set(["canceled", "unpaid", "incomplete_expired"]);

export type BillingRow = {
  tier: string;
  credit_balance: number;
  tutor_enabled: boolean;
  credits_period_start: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_period_end: string | null;
  subscription_status: string | null;
  cancel_at_period_end: boolean;
};

const BILLING_COLUMNS =
  "tier, credit_balance, tutor_enabled, credits_period_start, stripe_customer_id, stripe_subscription_id, stripe_period_end, subscription_status, cancel_at_period_end";

export async function getBilling(parentId: string): Promise<BillingRow | null> {
  const { data, error } = await createServiceClient().from("parents").select(BILLING_COLUMNS).eq("id", parentId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BillingRow | null) ?? null;
}

export function isOpenSubscription(status: string | null): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

function utcMonthStart(date = new Date()): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-01`;
}

function utcDateFromUnix(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID.test(value);
}

export function tierForPrice(priceId: string): "paid" | "max" | null {
  if (priceId === env.stripePricePlus) return "paid";
  if (priceId === env.stripePriceMax) return "max";
  return null;
}

async function parentExists(parentId: string): Promise<boolean> {
  const { data, error } = await createServiceClient().from("parents").select("id").eq("id", parentId).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

async function resolveParentId(sub: Stripe.Subscription, hint?: string | null): Promise<string | null> {
  if (isUuid(sub.metadata?.parent_id)) return sub.metadata.parent_id;
  if (isUuid(hint)) return hint;
  const customerId = idOf(sub.customer);
  if (customerId) {
    const { data, error } = await createServiceClient().from("parents").select("id").eq("stripe_customer_id", customerId).maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.id) return data.id as string;
  }
  if (sub.customer && typeof sub.customer !== "string" && "metadata" in sub.customer && isUuid(sub.customer.metadata?.parent_id)) {
    return sub.customer.metadata.parent_id;
  }
  return null;
}

async function downgradeToFree(parentId: string, customerId: string | null): Promise<void> {
  if (!(await parentExists(parentId))) {
    console.error(`[stripe] parent ${parentId} missing; skipping downgrade`);
    return;
  }
  const db = createServiceClient();
  const { error } = await db
    .from("parents")
    .update({
      tier: "free",
      tutor_enabled: false,
      subscription_status: "canceled",
      stripe_subscription_id: null,
      cancel_at_period_end: false,
      ...(customerId ? { stripe_customer_id: customerId } : {}),
    })
    .eq("id", parentId);
  if (error) throw new Error(error.message);
  const granted = await db.rpc("grant_tier_period", {
    p_parent_id: parentId,
    p_tier: "free",
    p_period: utcMonthStart(),
  });
  if (granted.error) throw new Error(granted.error.message);
}

/** Webhook-only tier changes. Past-due and cancel-at-period-end keep the paid tier. */
export async function syncSubscription(sub: Stripe.Subscription, parentHint?: string | null): Promise<void> {
  const parentId = await resolveParentId(sub, parentHint);
  if (!parentId || !(await parentExists(parentId))) {
    console.error(`[stripe] no parent for subscription ${sub.id}`);
    return;
  }

  const customerId = idOf(sub.customer);
  if (ENDED.has(sub.status)) {
    await downgradeToFree(parentId, customerId);
    return;
  }

  const item = sub.items.data[0];
  const tier = item ? tierForPrice(item.price.id) : null;
  const patch: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end,
    stripe_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
  };
  if (customerId) patch.stripe_customer_id = customerId;
  if ((sub.status === "active" || sub.status === "trialing") && tier) {
    patch.tier = tier;
    patch.tutor_enabled = tier === "max";
  } else if ((sub.status === "active" || sub.status === "trialing") && item && !tier) {
    console.error(`[stripe] subscription ${sub.id} uses an unknown price ${item.price.id}`);
  }

  const { error } = await createServiceClient().from("parents").update(patch).eq("id", parentId);
  if (error) throw new Error(error.message);
}

function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription;
  return idOf(sub);
}

async function onInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subId = subscriptionIdOfInvoice(invoice);
  if (!subId) return;
  const sub = await getStripe().subscriptions.retrieve(subId);
  if (ENDED.has(sub.status)) return;
  await syncSubscription(sub);
  const item = sub.items.data[0];
  const tier = item ? tierForPrice(item.price.id) : null;
  const parentId = await resolveParentId(sub);
  if (!item || !tier || !parentId || !(await parentExists(parentId))) return;
  const granted = await createServiceClient().rpc("grant_tier_period", {
    p_parent_id: parentId,
    p_tier: tier,
    p_period: utcDateFromUnix(item.current_period_start),
  });
  if (granted.error) throw new Error(granted.error.message);
}

async function onCheckout(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== "subscription") return;
  const hint = session.metadata?.parent_id ?? session.client_reference_id;
  const subId = idOf(session.subscription);
  if (!subId) return;
  const sub = await getStripe().subscriptions.retrieve(subId);
  await syncSubscription(sub, hint);
}

async function dispatchStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await onCheckout(event.data.object);
      return;
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      return;
    case "invoice.paid":
      await onInvoicePaid(event.data.object);
      return;
    default:
      return;
  }
}

/** Record the event id first. Delete it if handling fails so Stripe can retry. */
export async function handleStripeEvent(event: Stripe.Event): Promise<"ok" | "duplicate"> {
  const db = createServiceClient();
  const { error } = await db.from("stripe_events").insert({ id: event.id, type: event.type });
  if (error?.code === "23505") return "duplicate";
  if (error) throw new Error(error.message);
  try {
    await dispatchStripeEvent(event);
    return "ok";
  } catch (err) {
    await db.from("stripe_events").delete().eq("id", event.id);
    throw err;
  }
}
