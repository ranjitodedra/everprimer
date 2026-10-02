import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

/** Why a billable enqueue did not start. `credits` is the paywall. */
export type CreditError = "credits" | "concurrency" | "rate_limit" | "plan" | "forbidden";

export type StartResult =
  | { ok: true; jobId: string | null; curriculumId?: string; artifactId?: string; skipped?: boolean }
  | { ok: false; error: CreditError };

const CREDIT_ERRORS = new Set<CreditError>(["credits", "concurrency", "rate_limit", "plan", "forbidden"]);

export function parseStart(data: unknown): StartResult {
  if (!data || typeof data !== "object") return { ok: false, error: "forbidden" };
  const row = data as Record<string, unknown>;
  if (row.ok !== true) {
    const error = typeof row.error === "string" && CREDIT_ERRORS.has(row.error as CreditError) ? (row.error as CreditError) : "forbidden";
    return { ok: false, error };
  }
  return {
    ok: true,
    jobId: typeof row.job_id === "string" ? row.job_id : null,
    curriculumId: typeof row.curriculum_id === "string" ? row.curriculum_id : undefined,
    artifactId: typeof row.artifact_id === "string" ? row.artifact_id : undefined,
    skipped: row.skipped === true,
  };
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<StartResult> {
  const db = createServiceClient();
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return parseStart(data);
}

export function startCurriculumJob(childId: string, goal: string): Promise<StartResult> {
  return rpc("start_curriculum_job", { p_child_id: childId, p_goal: goal });
}

export function retryCurriculumJob(curriculumId: string): Promise<StartResult> {
  return rpc("retry_curriculum_job", { p_curriculum_id: curriculumId });
}

export function startArtifactJob(topicId: string, reason: "initial" | "prewarm" | "regenerate"): Promise<StartResult> {
  return rpc("start_artifact_job", { p_topic_id: topicId, p_reason: reason });
}

export async function spendCredit(jobId: string): Promise<void> {
  const db = createServiceClient();
  const { error } = await db.rpc("spend_credit", { p_job_id: jobId });
  if (error) throw new Error(error.message);
}

export async function refundCredit(jobId: string): Promise<void> {
  const db = createServiceClient();
  const { error } = await db.rpc("refund_credit", { p_job_id: jobId });
  if (error) throw new Error(error.message);
}

/** Free monthly grants and lapsed-subscription downgrades. Safe to run often. */
export async function refreshBillingPeriods(): Promise<void> {
  const db = createServiceClient();
  const free = await db.rpc("refresh_free_grants");
  if (free.error) throw new Error(free.error.message);
  const lapsed = await db.rpc("downgrade_lapsed_subscriptions");
  if (lapsed.error) throw new Error(lapsed.error.message);
}
