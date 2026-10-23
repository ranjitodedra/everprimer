"use client";

import { useActionState, useEffect, useRef } from "react";
import { signOut, type FormState } from "@/app/actions";
import { Check, LogOut } from "@/components/icons";
import { PinField } from "@/components/pin-field";
import { SheetPanel, closeSheet, openSheet } from "@/components/sheet";
import { FormFeedback, ListRow, RowContent } from "@/components/ui";
import { PLANS, formatCredits, formatPrice, planFor, type PlanId } from "@/lib/plans";
import type { UsageSummary } from "@/lib/usage";

export type SettingsBilling = {
  tier: string;
  creditBalance: number;
  /** First day of the current credit month (UTC date). */
  periodStart: string | null;
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

/** Free credits refresh on the first of each UTC month. */
function freeResetLabel(billing: SettingsBilling): string {
  const start = billing.periodStart ? new Date(`${billing.periodStart}T00:00:00Z`) : new Date();
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return `Refreshes ${next.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.min(100, (Math.max(0, part) / whole) * 100).toFixed(2)}%` : "0%");

function conversationDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
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
  usage,
  checkout,
  portal,
  setPin,
  liveTutor,
  setLiveTutor,
}: {
  email: string;
  billing: SettingsBilling;
  hasPin: boolean;
  showPin: boolean;
  stripeReady: boolean;
  /** Null when usage could not be loaded. */
  usage: UsageSummary | null;
  checkout: (tier: string) => Promise<void>;
  portal: () => Promise<void>;
  setPin: (prev: FormState, formData: FormData) => Promise<FormState>;
  /** Null when the plan or the server does not offer the voice tutor. */
  liveTutor: { allowed: boolean } | null;
  setLiveTutor: (enabled: boolean) => Promise<void>;
}) {
  const plan = planFor(billing.tier);
  const open = isOpenSubscription(billing.subscriptionStatus);
  const when = periodLabel(billing) ?? (open ? null : freeResetLabel(billing));
  const left = `${formatCredits(billing.creditBalance)} of ${formatCredits(plan.credits)} credits left`;
  const showLive = !!liveTutor || (usage?.liveConversations ?? 0) > 0;
  const barTotal = usage ? usage.lessonCredits + usage.liveCredits + Math.max(0, billing.creditBalance) : 0;
  const plans = useRef<HTMLDialogElement>(null);
  const usageSheet = useRef<HTMLDialogElement>(null);
  const pin = useRef<HTMLDialogElement>(null);
  const voice = useRef<HTMLDialogElement>(null);
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
              subtitle={`${left}${when ? `. ${when}` : ""}`}
              trailing={<span className="font-semibold text-ink-soft">{plan.name}</span>}
            />
          </button>
        </li>
        {usage ? (
          <li>
            <button type="button" className="list-row w-full text-left" onClick={() => openSheet(usageSheet)}>
              <RowContent
                title="Usage"
                subtitle={
                  showLive
                    ? `Lessons ${formatCredits(usage.lessonCredits)}, live tutor ${formatCredits(usage.liveCredits)} credits this month`
                    : `Lessons ${formatCredits(usage.lessonCredits)} credits this month`
                }
                trailing={<span className="font-semibold text-ink-soft tabular-nums">{formatCredits(billing.creditBalance)} left</span>}
              />
            </button>
          </li>
        ) : null}
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
        {liveTutor ? (
          <li>
            <button type="button" className="list-row w-full text-left" onClick={() => openSheet(voice)}>
              <RowContent
                title="Live voice tutor"
                subtitle="Kids can talk through a lesson out loud"
                trailing={<span className={`font-semibold ${liveTutor.allowed ? "text-leaf" : "text-ink-soft"}`}>{liveTutor.allowed ? "On" : "Off"}</span>}
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
          {left} this month{when ? `. ${when}` : "."} Credits pay for new lessons, their pictures, and live tutor time.
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
                  <li>
                    {formatCredits(item.credits)} credits a month (about {item.lessons} lessons)
                  </li>
                  {item.id === "max" ? <li>Live voice tutor</li> : null}
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

      {usage ? (
        <SheetPanel ref={usageSheet} title="Usage">
          <p className="-mt-1 flex items-baseline gap-2">
            <span className="display text-5xl tabular-nums">{formatCredits(billing.creditBalance)}</span>
            <span className="text-ink-soft">of {formatCredits(plan.credits)} credits left</span>
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {usage.lessonsLeft === 1 ? "About 1 more lesson" : `About ${usage.lessonsLeft} more lessons`}
            {when ? `. ${when}.` : "."}
          </p>

          <div
            className="mt-5 flex h-3 overflow-hidden rounded-full bg-mist-deep"
            role="img"
            aria-label={`Used ${formatCredits(usage.lessonCredits)} credits on lessons and ${formatCredits(usage.liveCredits)} on the live tutor; ${formatCredits(billing.creditBalance)} left.`}
          >
            <span className="h-full bg-leaf" style={{ width: pct(usage.lessonCredits, barTotal) }} />
            <span className="h-full bg-spark" style={{ width: pct(usage.liveCredits, barTotal) }} />
          </div>

          <ul className="list-group mt-6">
            <li>
              <ListRow
                leading={<span className="h-3 w-3 shrink-0 rounded-full bg-leaf" aria-hidden />}
                title="Lessons"
                subtitle="New lessons, their pages and pictures"
                trailing={<span className="font-semibold tabular-nums">{formatCredits(usage.lessonCredits)}</span>}
              />
            </li>
            {showLive ? (
              <li>
                <ListRow
                  leading={<span className="h-3 w-3 shrink-0 rounded-full bg-spark" aria-hidden />}
                  title="Live tutor"
                  subtitle={
                    usage.liveConversations
                      ? `${usage.liveMinutes} min across ${usage.liveConversations === 1 ? "1 conversation" : `${usage.liveConversations} conversations`}`
                      : "No conversations yet this month"
                  }
                  trailing={<span className="font-semibold tabular-nums">{formatCredits(usage.liveCredits)}</span>}
                />
              </li>
            ) : null}
          </ul>
          <p className="mt-2 px-1 text-xs text-ink-faint">Credits used this month. A lesson still being made counts what it has set aside.</p>

          {usage.recent.length ? (
            <>
              <h3 className="mt-7 mb-2 px-1 text-sm font-semibold text-ink-soft">Recent conversations</h3>
              <ul className="list-group">
                {usage.recent.map((c) => (
                  <li key={c.id}>
                    <ListRow
                      title={c.lesson}
                      subtitle={`${c.child}, ${conversationDate(c.startedAt)}${c.open ? ", talking now" : ""}`}
                      trailing={
                        <span className="text-right text-sm tabular-nums">
                          <span className="block font-semibold">{formatCredits(c.credits)} credits</span>
                          <span className="block text-ink-soft">{c.minutes} min</span>
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </SheetPanel>
      ) : null}

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

      {liveTutor ? (
        <SheetPanel ref={voice} title="Live voice tutor">
          <p className="-mt-2 mb-5 text-ink-soft">
            A &ldquo;Live tutor&rdquo; button in each lesson lets your child talk with the lesson&rsquo;s guide. It coaches with hints instead of giving answers and stays on the lesson.
          </p>
          <div className="list-group">
            <div className="list-row">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Allow the voice tutor</span>
                <span className="block text-sm text-ink-soft">
                  No time limit. Talking uses credits; the tutor stops after two quiet minutes or when credits run out.
                </span>
              </span>
              <form action={setLiveTutor.bind(null, !liveTutor.allowed)}>
                <button
                  type="submit"
                  role="switch"
                  aria-checked={liveTutor.allowed}
                  aria-label="Allow the voice tutor"
                  className={`relative h-8 w-13 shrink-0 rounded-full transition-colors duration-200 ease-out ${liveTutor.allowed ? "bg-leaf" : "bg-mist-deep"}`}
                >
                  <span className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${liveTutor.allowed ? "translate-x-5" : ""}`} />
                </button>
              </form>
            </div>
          </div>
          <p className="mt-5 text-sm text-ink-soft">
            The microphone is on only while your child has the tutor open. Speech goes straight to Google&rsquo;s Gemini service to make the reply. We don&rsquo;t record or keep audio or transcripts, and the tutor gets the lesson, your child&rsquo;s age and reading level, and their progress, never their name.
          </p>
        </SheetPanel>
      ) : null}
    </div>
  );
}
