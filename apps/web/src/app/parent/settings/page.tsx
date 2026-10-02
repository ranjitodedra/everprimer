import type { Metadata } from "next";
import { setGrownupPin } from "@/app/actions";
import { Notice, PageHeader } from "@/components/ui";
import { hasGrownupPin, requireGrownup } from "@/lib/auth";
import { getBilling } from "@/lib/billing";
import { startCheckout, startPortal } from "./actions";
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

  return (
    <>
      <PageHeader eyebrow="Account" title="Settings" />

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
          periodEnd: billing.stripe_period_end,
          subscriptionStatus: billing.subscription_status,
          cancelAtPeriodEnd: billing.cancel_at_period_end,
          hasCustomer: Boolean(billing.stripe_customer_id),
        }}
        checkout={startCheckout}
        portal={startPortal}
        setPin={setGrownupPin}
      />
    </>
  );
}
