import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { refreshBillingPeriods } from "@/lib/credits";
import { runQueuedJobs } from "@/lib/jobs";
import { refreshLearnerMaintenance } from "@/lib/memory";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Sweeps the job queue. Wire this to Vercel Cron (every minute) or call it
 * manually in development: curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/jobs/run
 */
async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = env.cronSecret;
  if (secret && auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let billing: "ok" | "error" = "ok";
  try {
    await refreshBillingPeriods();
  } catch (err) {
    billing = "error";
    console.error("[billing] period refresh failed:", err instanceof Error ? err.message : err);
  }
  let memory: "ok" | "error" = "ok";
  try {
    await refreshLearnerMaintenance();
  } catch (err) {
    memory = "error";
    console.error("[memory] maintenance failed:", err instanceof Error ? err.message : err);
  }
  const ran = await runQueuedJobs(5);
  return NextResponse.json({ ran, billing, memory });
}

export const GET = handle;
export const POST = handle;
