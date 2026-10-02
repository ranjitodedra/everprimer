import Link from "next/link";
import { CURRICULUM_HOURLY_LIMIT, MAX_CONCURRENT_JOBS, PLANS, formatPrice } from "@/lib/plans";

export type BillingAudience = "grownup" | "learner";

export function billingCode(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Grown-ups see prices. Learners get a request to ask a grown-up, with no prices. */
export function BillingNotice({ code, audience }: { code?: string; audience: BillingAudience }) {
  if (!code) return null;
  if (code === "credits") return <Paywall audience={audience} reason="credits" />;
  if (code === "plan") return <Paywall audience={audience} reason="plan" />;
  if (code === "concurrency") {
    return (
      <div className="card mb-6">
        <h2 className="text-lg font-extrabold">Two lessons are already being built</h2>
        <p className="mt-1 text-sm text-ink-soft">This account can build {MAX_CONCURRENT_JOBS} lessons at a time. Wait for one to finish, then try again.</p>
      </div>
    );
  }
  if (code === "rate_limit") {
    return (
      <div className="card mb-6">
        <h2 className="text-lg font-extrabold">That is enough new goals for this hour</h2>
        <p className="mt-1 text-sm text-ink-soft">You can start {CURRICULUM_HOURLY_LIMIT} new curricula an hour. Try again a little later.</p>
      </div>
    );
  }
  if (code === "children") {
    return (
      <div className="card mb-6">
        <h2 className="text-lg font-extrabold">This plan is full of child profiles</h2>
        <p className="mt-1 text-sm text-ink-soft">Profiles you already added stay. Upgrade to add another.</p>
        {audience === "grownup" ? (
          <Link href="/parent/settings" className="btn-primary mt-4">
            View plans
          </Link>
        ) : null}
      </div>
    );
  }
  return (
    <div className="card mb-6">
      <h2 className="text-lg font-extrabold">That could not be started</h2>
      <p className="mt-1 text-sm text-ink-soft">Refresh the page and try again.</p>
    </div>
  );
}

function Paywall({ audience, reason }: { audience: BillingAudience; reason: "credits" | "plan" }) {
  if (audience === "learner") {
    return (
      <div className="card mx-auto max-w-lg py-10 text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-sun-soft text-3xl" aria-hidden>
          🌱
        </div>
        <h2 className="text-2xl font-black">No lessons left right now</h2>
        <p className="mt-2 text-ink-soft">Ask a grown-up to add more lessons.</p>
      </div>
    );
  }

  const title = reason === "plan" ? "Regenerating a lesson is on Plus and Max" : "This account is out of lesson credits";
  const body =
    reason === "plan"
      ? "A published lesson can be rebuilt on Plus or Max. Playing it again is free."
      : "A credit is one new lesson, or one new curriculum outline. Lessons you already have stay playable.";

  return (
    <div className="card mb-6">
      <h2 className="text-xl font-black">{title}</h2>
      <p className="mt-1 text-sm text-ink-soft">{body}</p>
      <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <li className="rounded-2xl bg-paper px-3 py-3">
          <span className="block font-extrabold">{PLANS.free.name}</span>
          <span className="text-ink-soft">{formatPrice(PLANS.free.price)} · {PLANS.free.credits} credits / month</span>
        </li>
        <li className="rounded-2xl bg-paper px-3 py-3">
          <span className="block font-extrabold">{PLANS.paid.name}</span>
          <span className="text-ink-soft">{formatPrice(PLANS.paid.price)}/month · {PLANS.paid.credits} credits</span>
        </li>
        <li className="rounded-2xl bg-paper px-3 py-3">
          <span className="block font-extrabold">{PLANS.max.name}</span>
          <span className="text-ink-soft">{formatPrice(PLANS.max.price)}/month · {PLANS.max.credits} credits</span>
        </li>
      </ul>
      <Link href="/parent/settings" className="btn-primary mt-4">
        See plans
      </Link>
    </div>
  );
}
