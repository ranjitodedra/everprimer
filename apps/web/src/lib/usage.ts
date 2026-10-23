import "server-only";
import { CREDITS_PER_LESSON } from "@eco/ai";
import type { CreditLedgerRow, TutorSessionRow } from "@eco/db";
import { createServiceClient } from "@/lib/supabase/server";

export interface TutorConversation {
  id: string;
  child: string;
  lesson: string;
  startedAt: string;
  minutes: number;
  credits: number;
  open: boolean;
}

export interface UsageSummary {
  /** Credits used this period by lessons: outlines, pages and pictures, including holds on lessons still being made. */
  lessonCredits: number;
  liveCredits: number;
  liveMinutes: number;
  liveConversations: number;
  recent: TutorConversation[];
  /** Rough lessons the balance still covers. */
  lessonsLeft: number;
}

const PAGE = 1000;

function periodStartIso(periodStart: string | null): string {
  if (periodStart) return new Date(`${periodStart}T00:00:00Z`).toISOString();
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

const minutesOf = (seconds: number | null | undefined) => Math.ceil(Math.max(0, seconds ?? 0) / 60);

/** This period's usage, split into lessons and the live tutor. Service role: the ledger has no client policies. */
export async function getUsage(parentId: string, periodStart: string | null, balance: number): Promise<UsageSummary> {
  const db = createServiceClient();
  const since = periodStartIso(periodStart);

  let lessonCredits = 0;
  let liveCredits = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("credit_ledger")
      .select("category, amount")
      .eq("parent_id", parentId)
      .not("category", "is", null)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Pick<CreditLedgerRow, "category" | "amount">[];
    for (const r of rows) {
      if (r.category === "live") liveCredits -= r.amount;
      else lessonCredits -= r.amount;
    }
    if (rows.length < PAGE) break;
  }

  const { data: sessions, error: sessionsError } = await db
    .from("tutor_sessions")
    .select("id, status, started_at, seconds_used, credits_used, children(display_name), topics(title)")
    .eq("parent_id", parentId)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(500);
  if (sessionsError) throw new Error(sessionsError.message);
  type SessionWithNames = Pick<TutorSessionRow, "id" | "status" | "started_at" | "seconds_used" | "credits_used"> & {
    children: { display_name: string } | null;
    topics: { title: string } | null;
  };
  const list = (sessions ?? []) as unknown as SessionWithNames[];

  return {
    lessonCredits: Math.max(0, lessonCredits),
    liveCredits: Math.max(0, liveCredits),
    liveMinutes: list.reduce((sum, s) => sum + minutesOf(s.seconds_used), 0),
    liveConversations: list.length,
    recent: list.slice(0, 10).map((s) => ({
      id: s.id,
      child: s.children?.display_name ?? "A learner",
      lesson: s.topics?.title ?? "A lesson",
      startedAt: s.started_at,
      minutes: minutesOf(s.seconds_used),
      credits: s.credits_used ?? 0,
      open: s.status === "issued",
    })),
    lessonsLeft: Math.floor(Math.max(0, balance) / CREDITS_PER_LESSON),
  };
}
