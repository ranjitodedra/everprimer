import "server-only";
import type { UsageCategory } from "@eco/db";
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

/** Charge a finished job its measured cost in credits; the rest of its hold goes back. */
export async function settleCredit(jobId: string, actual: number): Promise<void> {
  const db = createServiceClient();
  const { error } = await db.rpc("settle_credit", { p_job_id: jobId, p_actual: Math.max(0, Math.ceil(actual)) });
  if (error) throw new Error(error.message);
}

export interface UsageCharge {
  parentId: string;
  category: UsageCategory;
  credits: number;
  reason: string;
  tutorSessionId?: string | null;
  topicId?: string | null;
}

/** Charge usage outside the job queue. Takes at most what is left; returns the balance afterwards. */
export async function chargeUsage(c: UsageCharge): Promise<number> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("charge_usage", {
    p_parent_id: c.parentId,
    p_category: c.category,
    p_amount: Math.max(0, Math.ceil(c.credits)),
    p_reason: c.reason,
    p_tutor_session_id: c.tutorSessionId ?? null,
    p_topic_id: c.topicId ?? null,
  });
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : 0;
}

export async function creditBalance(parentId: string): Promise<number> {
  const { data } = await createServiceClient().from("parents").select("credit_balance").eq("id", parentId).maybeSingle();
  return (data as { credit_balance?: number } | null)?.credit_balance ?? 0;
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
