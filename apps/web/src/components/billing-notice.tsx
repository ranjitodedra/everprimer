import Link from "next/link";
import type { ReactNode } from "react";
import { CURRICULUM_HOURLY_LIMIT, MAX_CONCURRENT_JOBS } from "@/lib/plans";

export type BillingAudience = "grownup" | "learner";

export function billingCode(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function Box({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div role="status" className="mb-6 flex flex-col gap-4 rounded-3xl bg-spark-soft px-5 py-4 text-spark-deep sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-bold">{title}</p>
        <p className="mt-0.5 text-sm">{body}</p>
      </div>
      {action}
    </div>
  );
}

/** Grown-ups get a way to fix it. Learners get a request to ask a grown-up, with no prices. */
export function BillingNotice({ code, audience }: { code?: string; audience: BillingAudience }) {
  if (!code) return null;
  const plans = audience === "grownup" ? <Link href="/parent/settings" className="btn-primary btn-sm shrink-0">See plans</Link> : undefined;

  if (code === "credits" || code === "plan") {
    if (audience === "learner") {
      return (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <span className="text-6xl" aria-hidden>🌱</span>
          <h2 className="display mt-4 text-3xl">No new lessons right now</h2>
          <p className="mt-2 opacity-75">Ask a grown-up to add more.</p>
        </div>
      );
    }
    return code === "plan" ? (
      <Box title="Rebuilding a lesson is on Plus and Max" body="Playing it again is always free." action={plans} />
    ) : (
      <Box title="Out of lesson credits" body="Lessons you already have still play. Credits refresh each month." action={plans} />
    );
  }
  if (code === "concurrency") return <Box title="Two lessons are already being made" body={`Up to ${MAX_CONCURRENT_JOBS} at a time. Try again when one is ready.`} />;
  if (code === "rate_limit") return <Box title="That's enough new goals for now" body={`Up to ${CURRICULUM_HOURLY_LIMIT} an hour. Try again a little later.`} />;
  if (code === "children") return <Box title="This plan is full" body="Profiles you added stay. Upgrade to add another." action={plans} />;
  return <Box title="That couldn't start" body="Refresh the page and try again." />;
}
