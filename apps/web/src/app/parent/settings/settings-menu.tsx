"use client";

import { useActionState, useEffect, useRef } from "react";
import { signOut, type FormState } from "@/app/actions";
import { Check, LogOut } from "@/components/icons";
import { PinField } from "@/components/pin-field";
import { SheetPanel, closeSheet, openSheet } from "@/components/sheet";
import { FormFeedback, ListRow, RowContent } from "@/components/ui";
import { PLANS, formatPrice, planFor, type PlanId } from "@/lib/plans";

export type SettingsBilling = {
  tier: string;
  creditBalance: number;
  periodEnd: string | null;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
};

function periodLabel(billing: SettingsBilling): string | null {
  if (!billing.periodEnd) return null;
  const date = new Date(billing.periodEnd);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (billing.cancelAtPeriodEnd || billing.subscriptionStatus === "canceled") return `Access through ${formatted}`;
  if (billing.subscriptionStatus === "past_due") return `Payment past due. Period ends ${formatted}`;
  return `Renews ${formatted}`;
}

function isOpenSubscription(status: string | null): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

export function SettingsMenu({
  email,
  billing,
  hasPin,
  showPin,
  stripeReady,
  checkout,
  portal,
  setPin,
}: {
  email: string;
  billing: SettingsBilling;
  hasPin: boolean;
  showPin: boolean;
  stripeReady: boolean;
  checkout: (tier: string) => Promise<void>;
  portal: () => Promise<void>;
  setPin: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const plan = planFor(billing.tier);
  const when = periodLabel(billing);
  const open = isOpenSubscription(billing.subscriptionStatus);
  const plans = useRef<HTMLDialogElement>(null);
  const pin = useRef<HTMLDialogElement>(null);
  const [pinState, pinAction, pinPending] = useActionState<FormState, FormData>(setPin, {});

  useEffect(() => {
    if (pinState.message) closeSheet(pin);
  }, [pinState]);

  return (
    <div className="space-y-8">
      {pinState.message ? <FormFeedback message={pinState.message} /> : null}

      <ul className="list-group">
        <li>
          <ListRow title="Signed in as" subtitle={<span className="break-all">{email || "No email"}</span>} />
        </li>
      </ul>

      <ul className="list-group">
        <li>
          <button type="button" className="list-row w-full text-left" onClick={() => openSheet(plans)}>
            <RowContent
              title="Plan"
              subtitle={`${billing.creditBalance} of ${plan.credits} lessons left${when ? `. ${when}` : ""}`}
              trailing={<span className="font-semibold text-ink-soft">{plan.name}</span>}
            />
          </button>
        </li>
        {showPin ? (
          <li>
            <button type="button" className="list-row w-full text-left" onClick={() => openSheet(pin)}>
              <RowContent
                title="Grown-up PIN"
                subtitle={hasPin ? "Needed to leave kid mode" : "Set one before using kid mode"}
                trailing={<span className={`font-semibold ${hasPin ? "text-leaf" : "text-spark-deep"}`}>{hasPin ? "On" : "Off"}</span>}
              />
            </button>
          </li>
        ) : null}
      </ul>

      <form action={signOut}>
        <ul className="list-group">
          <li>
            <button type="submit" className="list-row w-full text-left font-semibold text-berry">
              <LogOut size={18} />
              Sign out
            </button>
          </li>
        </ul>
      </form>

      <SheetPanel ref={plans} title="Plans" wide>
        <p className="-mt-2 mb-5 text-ink-soft">
          {billing.creditBalance} of {plan.credits} lessons left this month{when ? `. ${when}` : "."}
        </p>
        <ul className="grid gap-3 lg:grid-cols-3">
          {(Object.keys(PLANS) as PlanId[]).map((id) => {
            const item = PLANS[id];
            const current = item.id === plan.id;
            return (
              <li key={id} className={`flex flex-col rounded-[1.25rem] px-5 py-5 ${current ? "bg-leaf-soft text-leaf-deep" : "bg-mist"}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="display text-2xl">{item.name}</h3>
                  <p className="font-semibold">{item.price === 0 ? formatPrice(0) : `${formatPrice(item.price)} a month`}</p>
                </div>
                <ul className="mt-3 flex-1 space-y-1.5 text-sm">
                  <li>{item.credits} lessons a month</li>
                  <li>{item.childCap === 1 ? "1 child" : `Up to ${item.childCap} children`}</li>
                  {item.regenerate ? <li>Rewrite any lesson</li> : null}
                </ul>
                {current ? (
                  <p className="mt-4 inline-flex items-center gap-1.5 font-semibold">
                    <Check size={16} />
                    Your plan
                  </p>
                ) : item.id === "free" || !stripeReady ? null : (
                  <form action={checkout.bind(null, item.id)} className="mt-4">
                    <button type="submit" className="btn-primary w-full">{open ? `Switch to ${item.name}` : `Get ${item.name}`}</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
        {billing.hasCustomer && stripeReady ? (
          <form action={portal} className="mt-5">
            <button type="submit" className="btn-ghost w-full">Billing and invoices</button>
          </form>
        ) : null}
        {stripeReady ? null : <p className="mt-5 text-sm text-ink-faint">Checkout turns on once the Stripe keys are set.</p>}
      </SheetPanel>

      {showPin ? (
        <SheetPanel ref={pin} title={hasPin ? "Change PIN" : "Set a PIN"}>
          <p className="-mt-2 mb-5 text-ink-soft">Kids need it to leave kid mode. Forgot it? Sign out and back in with your password.</p>
          <form action={pinAction} className="space-y-4">
            <PinField id="pin" name="pin" label={hasPin ? "New PIN" : "PIN"} autoComplete="new-password" showLabel />
            <PinField id="confirm" name="confirm" label="Again" autoComplete="new-password" showLabel />
            <FormFeedback error={pinState.error} />
            <button type="submit" disabled={pinPending} className="btn-primary btn-lg w-full">{pinPending ? "Saving…" : "Save PIN"}</button>
          </form>
        </SheetPanel>
      ) : null}
    </div>
  );
}
