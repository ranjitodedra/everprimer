import type { Metadata } from "next";
import { setGrownupPin } from "@/app/actions";
import { Notice, PageHeader } from "@/components/ui";
import { hasGrownupPin, requireGrownup } from "@/lib/auth";
import { getBilling } from "@/lib/billing";
import { liveTutorEnv } from "@/lib/env";
import { getUsage } from "@/lib/usage";
import { setLiveTutorAllowed, startCheckout, startPortal } from "./actions";
import { SettingsMenu } from "./settings-menu";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage(props: PageProps<"/parent/settings">) {
  const account = await requireGrownup();
  const sp = await props.searchParams;
  const hasPin = await hasGrownupPin(account.user.id);
  const billing = (await getBilling(account.user.id)) ?? {
    tier: account.parent.tier,
    credit_balance: account.parent.credit_balance,
    tutor_enabled: account.parent.tutor_enabled,
    credits_period_start: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_period_end: null,
    subscription_status: null,
    cancel_at_period_end: false,
  };
  const stripeReady = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PLUS && process.env.STRIPE_PRICE_MAX);
  const usage = await getUsage(account.user.id, billing.credits_period_start, billing.credit_balance).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    // Hosted DB before 0010_metered_credits.sql has no usage category yet.
    if (!/does not exist|42703/.test(message)) console.error("[settings] usage failed:", message);
    return null;
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" />

      {sp.checkout === "success" ? <Notice tone="success">Payment received. Credits show up as soon as Stripe confirms the invoice.</Notice> : null}
      {sp.checkout === "cancel" ? <Notice>Checkout closed. Your plan is unchanged.</Notice> : null}
      {sp.pin === "required" && !hasPin ? <Notice>Set a grown-up PIN first. Kid mode uses it to keep children out of this area.</Notice> : null}

      <SettingsMenu
        email={account.user.email ?? ""}
        hasPin={hasPin}
        showPin={account.kind === "parent"}
        stripeReady={stripeReady}
        billing={{
          tier: billing.tier,
          creditBalance: billing.credit_balance,
          periodStart: billing.credits_period_start,
          periodEnd: billing.stripe_period_end,
          subscriptionStatus: billing.subscription_status,
          cancelAtPeriodEnd: billing.cancel_at_period_end,
          hasCustomer: Boolean(billing.stripe_customer_id),
        }}
        usage={usage}
        checkout={startCheckout}
        portal={startPortal}
        setPin={setGrownupPin}
        liveTutor={billing.tutor_enabled && liveTutorEnv.enabled ? { allowed: account.parent.live_tutor_allowed } : null}
        setLiveTutor={setLiveTutorAllowed}
      />
    </div>
  );
}
