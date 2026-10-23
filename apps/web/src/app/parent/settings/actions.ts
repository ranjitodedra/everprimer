"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireGrownup } from "@/lib/auth";
import { getBilling, isOpenSubscription, tierForPrice } from "@/lib/billing";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";

const Choice = z.enum(["paid", "max"]);

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) throw new Error("Missing host");
  const forwarded = h.get("x-forwarded-proto");
  const proto = forwarded ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

async function portalUrl(customerId: string, origin: string): Promise<string> {
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/parent/settings`,
  });
  return session.url;
}

async function ensureCustomer(parentId: string, email: string | undefined, existing: string | null): Promise<string> {
  if (existing) return existing;
  const customer = await getStripe().customers.create(
    { email, metadata: { parent_id: parentId } },
    { idempotencyKey: `parent-customer-${parentId}` },
  );
  const { error } = await createServiceClient().from("parents").update({ stripe_customer_id: customer.id }).eq("id", parentId);
  if (error) throw new Error(error.message);
  return customer.id;
}

/** Same-currency plans swap in place. A currency change cannot; the old subscription is canceled so Checkout can start a new one. */
async function switchPrice(subscriptionId: string, priceId: string, parentId: string): Promise<"updated" | "currency_mismatch"> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const item = sub.items.data[0];
  if (!item) throw new Error("Subscription has no items");
  if (item.price.id === priceId) return "updated";
  if (!tierForPrice(priceId)) throw new Error("Unknown Stripe price");
  const target = await stripe.prices.retrieve(priceId);
  if (item.price.currency !== target.currency) {
    await stripe.subscriptions.cancel(subscriptionId);
    return "currency_mismatch";
  }
  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
    items: [{ id: item.id, price: priceId }],
    metadata: { parent_id: parentId },
    proration_behavior: "create_prorations",
  });
  return "updated";
}

export async function startCheckout(tierInput: string) {
  const tier = Choice.parse(tierInput);
  const account = await requireGrownup();
  const billing = await getBilling(account.user.id);
  const price = tier === "max" ? env.stripePriceMax : env.stripePricePlus;
  const origin = await requestOrigin();

  if (billing?.stripe_customer_id && billing.stripe_subscription_id && isOpenSubscription(billing.subscription_status)) {
    if (billing.subscription_status === "past_due") redirect(await portalUrl(billing.stripe_customer_id, origin));
    const switched = await switchPrice(billing.stripe_subscription_id, price, account.user.id);
    if (switched === "updated") redirect("/parent/settings?checkout=success");
  }

  const customerId = await ensureCustomer(account.user.id, account.user.email ?? undefined, billing?.stripe_customer_id ?? null);
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: account.user.id,
    metadata: { parent_id: account.user.id },
    subscription_data: { metadata: { parent_id: account.user.id } },
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/parent/settings?checkout=success`,
    cancel_url: `${origin}/parent/settings?checkout=cancel`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  redirect(session.url);
}

/** Grown-up switch for the live voice tutor. Clients cannot write parents, so this runs with the service role. */
export async function setLiveTutorAllowed(enabled: boolean) {
  const account = await requireGrownup();
  const { error } = await createServiceClient().from("parents").update({ live_tutor_allowed: z.boolean().parse(enabled) }).eq("id", account.user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/parent/settings");
}

export async function startPortal() {
  const account = await requireGrownup();
  const billing = await getBilling(account.user.id);
  if (!billing?.stripe_customer_id) redirect("/parent/settings");
  redirect(await portalUrl(billing.stripe_customer_id, await requestOrigin()));
}
