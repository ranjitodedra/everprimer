"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormState } from "@/app/actions";
import { ChevronRight, X } from "@/components/icons";
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
  if (billing.subscriptionStatus === "past_due") return `Payment past due · period ends ${formatted}`;
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
  const used = Math.max(0, plan.credits - billing.creditBalance);
  const when = periodLabel(billing);
  const open = isOpenSubscription(billing.subscriptionStatus);
  const subscriptionRef = useRef<HTMLDialogElement>(null);
  const pinRef = useRef<HTMLDialogElement>(null);
  const [pinState, pinAction, pinPending] = useActionState<FormState, FormData>(setPin, {});
  const pinTitle = hasPin ? "Change PIN" : "Set a PIN";

  useEffect(() => {
    if (pinState.message) pinRef.current?.close();
  }, [pinState]);

  return (
    <div className="max-w-xl">
      <div className="divide-y divide-line border-y border-line">
        <div className="flex items-center justify-between gap-4 py-3">
          <p className="font-extrabold">Profile</p>
          <p className="truncate text-sm text-ink-soft">{email || "No email"}</p>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <p className="font-extrabold">Usage</p>
          <p className="text-sm text-ink-soft">{billing.creditBalance} left · {used} used</p>
        </div>
        <button type="button" className="flex w-full items-center justify-between gap-4 py-3 text-left" onClick={() => subscriptionRef.current?.showModal()}>
          <span className="font-extrabold">Subscription</span>
          <span className="inline-flex items-center gap-1 text-sm text-ink-soft">
            {plan.name}
            <ChevronRight size={16} />
          </span>
        </button>
        {showPin ? (
          <button type="button" className="flex w-full items-center justify-between gap-4 py-3 text-left" onClick={() => pinRef.current?.showModal()}>
            <span className="font-extrabold">PIN</span>
            <span className="inline-flex items-center gap-1 text-sm text-ink-soft">
              {hasPin ? "On" : "Set"}
              <ChevronRight size={16} />
            </span>
          </button>
        ) : null}
      </div>
      {pinState.message ? <p role="status" className="mt-3 rounded-xl border border-brand/25 bg-brand-soft px-3 py-2 text-sm font-bold text-brand-deep">{pinState.message}</p> : null}

      <dialog
        ref={subscriptionRef}
        aria-labelledby="subscription_title"
        className="card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto text-ink backdrop:bg-ink/40"
        onClick={(e) => {
          if (e.target === subscriptionRef.current) subscriptionRef.current?.close();
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="subscription_title" className="text-lg font-extrabold">{plan.name}</h2>
            <p className="text-sm text-ink-soft">
              {billing.creditBalance} of {plan.credits} lesson credits left
              {when ? ` · ${when}` : ""}
            </p>
          </div>
          <button type="button" className="btn-ghost shrink-0" aria-label="Close" onClick={() => subscriptionRef.current?.close()}>
            <X size={18} />
          </button>
        </div>
        {billing.hasCustomer && stripeReady ? (
          <form action={portal} className="mb-4">
            <button type="submit" className="btn-secondary">Manage billing</button>
          </form>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-3">
          {(Object.keys(PLANS) as PlanId[]).map((id) => {
            const item = PLANS[id];
            const current = item.id === plan.id;
            return (
              <article key={id} className={`rounded-2xl border p-4 ${current ? "border-brand bg-brand-soft/40" : "border-line bg-paper"}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-black">{item.name}</h3>
                  {current ? <span className="badge bg-brand text-white">Current</span> : null}
                </div>
                <p className="mt-1 text-sm font-extrabold">{item.price === 0 ? formatPrice(0) : `${formatPrice(item.price)}/month`}</p>
                <ul className="mt-3 space-y-1 text-sm text-ink-soft">
                  <li>{item.credits} lesson credits a month</li>
                  <li>{item.id === "free" ? "Gemini lessons" : "Claude writes the lessons"}</li>
                  <li>{item.regenerate ? "Regenerate a lesson" : "New lessons from your credits"}</li>
                  <li>{item.childCap === 1 ? "1 child profile" : `Up to ${item.childCap} child profiles`}</li>
                </ul>
                {current || item.id === "free" || !stripeReady ? null : (
                  <form action={checkout.bind(null, item.id)} className="mt-4">
                    <button type="submit" className="btn-primary w-full">{open ? `Switch to ${item.name}` : `Get ${item.name}`}</button>
                  </form>
                )}
              </article>
            );
          })}
        </div>
        {stripeReady ? null : <p className="mt-4 text-sm text-ink-soft">Checkout turns on after the Stripe price and secret keys are set.</p>}
      </dialog>

      {showPin ? (
        <dialog
          ref={pinRef}
          aria-labelledby="pin_title"
          className="card m-auto w-[calc(100%-2rem)] max-w-md text-ink backdrop:bg-ink/40"
          onClick={(e) => {
            if (e.target === pinRef.current) pinRef.current?.close();
          }}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="pin_title" className="text-lg font-extrabold">{pinTitle}</h2>
            <button type="button" className="btn-ghost" aria-label="Close" onClick={() => pinRef.current?.close()}>
              <X size={18} />
            </button>
          </div>
          <p className="mb-4 text-sm text-ink-soft">Needed to leave kid mode on a shared device. Forgot it? Sign out and sign back in with your password.</p>
          <form action={pinAction} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pin" className="label">{hasPin ? "New PIN" : "PIN"}</label>
                <input id="pin" name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" required className="input tracking-[0.3em]" placeholder="4–6 digits" />
              </div>
              <div>
                <label htmlFor="confirm" className="label">Repeat PIN</label>
                <input id="confirm" name="confirm" type="password" inputMode="numeric" pattern="\d{4,6}" required className="input tracking-[0.3em]" placeholder="Again" />
              </div>
            </div>
            {pinState.error ? <p role="alert" className="rounded-xl border border-berry/25 bg-berry-soft px-3 py-2 text-sm font-bold text-berry">{pinState.error}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => pinRef.current?.close()}>Cancel</button>
              <button type="submit" disabled={pinPending} className="btn-primary">{hasPin ? "Change PIN" : "Save PIN"}</button>
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
