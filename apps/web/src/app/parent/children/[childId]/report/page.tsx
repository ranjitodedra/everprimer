import Link from "next/link";
import { notFound } from "next/navigation";
import type { ChildRow, DailyReportRow, LessonFeedbackRow, TopicProgressRow } from "@eco/db";
import { generateReportNow } from "@/app/actions";
import { ArrowLeft, ArrowRight, ChevronDown, Refresh, Sparkles } from "@/components/icons";
import { LessonFeedback } from "@/components/lesson-feedback";
import { BackLink } from "@/components/ui";
import { requireGrownup } from "@/lib/auth";
import { computeDailyStats, todayIso, type DailyStats } from "@/lib/report";
import { createClient } from "@/lib/supabase/server";

function prettyDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export default async function ReportPage(props: PageProps<"/parent/children/[childId]/report">) {
  await requireGrownup();
  const { childId } = await props.params;
  const sp = await props.searchParams;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIso();

  const supabase = await createClient();
  const { data: child } = await supabase.from("children").select("*").eq("id", childId).maybeSingle();
  if (!child) notFound();
  const c = child as ChildRow;

  const { data: reportRow } = await supabase.from("daily_reports").select("*").eq("child_id", childId).eq("report_date", date).maybeSingle();
  const report = reportRow as DailyReportRow | null;
  // Live numbers are always computed; the written summary is generated on demand.
  const stats: DailyStats = await computeDailyStats(childId, date);
  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = new Date(Date.parse(dayStart) + 86_400_000).toISOString();
  const { data: finished } = await supabase
    .from("topic_progress")
    .select("topic_id, feedback, last_activity_at, topics!inner(title)")
    .eq("child_id", childId)
    .not("feedback", "is", null)
    .gte("last_activity_at", dayStart)
    .lt("last_activity_at", dayEnd)
    .order("last_activity_at", { ascending: true });
  const lessonFeedback = ((finished ?? []) as unknown as Array<Pick<TopicProgressRow, "topic_id" | "feedback"> & { topics: { title: string } }>).filter(
    (r): r is typeof r & { feedback: LessonFeedbackRow } => r.feedback !== null,
  );
  const generate = generateReportNow.bind(null, childId, date);

  const prev = new Date(`${date}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const isToday = date === todayIso();

  const who = c.kind === "self" ? "You" : c.display_name;
  const lead = stats.topicsOpened.length === 0
    ? `${who} didn't open a lesson ${isToday ? "today" : "this day"}.`
    : `${who} opened ${stats.topicsOpened.length === 1 ? "one lesson" : `${stats.topicsOpened.length} lessons`}${stats.questionsAnswered ? ` and got ${stats.questionsCorrect} of ${stats.questionsAnswered} questions right` : ""}.`;

  return (
    <>
      <BackLink href={`/parent/children/${c.id}`}>{c.kind === "self" ? "Your progress" : c.display_name}</BackLink>
      <header className="mb-8 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="display text-[2.5rem] sm:text-5xl">{isToday ? "Today" : prettyDate(date)}</h1>
          <p className="mt-2 max-w-xl text-lg text-pretty">{lead}</p>
        </div>
        <nav className="flex shrink-0 gap-1" aria-label="Day">
          <Link href={`?date=${prev.toISOString().slice(0, 10)}`} className="btn-secondary btn-icon" aria-label="Previous day">
            <ArrowLeft size={18} />
          </Link>
          <Link href={`?date=${next.toISOString().slice(0, 10)}`} className={`btn-secondary btn-icon ${isToday ? "pointer-events-none opacity-30" : ""}`} aria-label="Next day" aria-disabled={isToday}>
            <ArrowRight size={18} />
          </Link>
        </nav>
      </header>

      <dl className="mb-10 grid grid-cols-3 gap-2 sm:gap-3">
        <Figure label="Lessons finished" value={String(stats.topicsCompleted.length)} />
        <Figure label="Right first time" value={stats.questionsAnswered ? `${stats.firstAttemptCorrect}/${stats.questionsAnswered}` : "0"} />
        <Figure label="Minutes" value={String(stats.minutesActive)} />
      </dl>

      <div className="grid gap-10 md:grid-cols-[1.4fr_1fr] md:gap-12">
        <div className="space-y-8">
          <section aria-labelledby="summary_title">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="summary_title" className="display text-2xl">In words</h2>
              {report ? (
                <form action={generate}>
                  <button type="submit" className="btn-ghost btn-sm">
                    <Refresh size={14} />
                    Rewrite
                  </button>
                </form>
              ) : null}
            </div>
            {report ? (
              <p className="text-[1.0625rem] leading-relaxed whitespace-pre-line">{report.summary}</p>
            ) : (
              <form action={generate} className="rounded-[1.25rem] bg-mist px-5 py-6">
                <p className="text-ink-soft">A short note written from the numbers above. It never guesses at mood.</p>
                <button type="submit" className="btn-secondary mt-4 bg-paper">
                  <Sparkles size={16} />
                  Write it
                </button>
              </form>
            )}
          </section>

          {lessonFeedback.length ? (
            <section aria-labelledby="lessons_title">
              <h2 id="lessons_title" className="display mb-3 text-2xl">Lessons</h2>
              <div className="space-y-3">
                {lessonFeedback.map((r) => (
                  <LessonFeedback key={r.topic_id} title={r.topics.title} feedback={r.feedback} />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          <section className="rounded-[1.25rem] bg-leaf-soft px-5 py-5 text-leaf-deep">
            <h2 className="text-sm font-semibold">Next up</h2>
            <p className="mt-1 text-lg font-semibold text-pretty">{stats.suggestedNext ?? "Nothing to review. Any next lesson is a good one."}</p>
          </section>

          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-ink-soft [&::-webkit-details-marker]:hidden">
              <ChevronDown size={18} className="transition-transform duration-200 group-open:rotate-180" />
              Details
            </summary>
            <dl className="mt-3 divide-y divide-line rounded-[1.25rem] bg-mist px-5">
              <Row label="Opened" items={stats.topicsOpened} />
              <Row label="Finished" items={stats.topicsCompleted} />
              <Row label="To review" items={stats.needsReview} />
              <Row label="Strong" items={stats.strengths} />
              <Row label="Found hard" items={stats.struggles} />
              <Row label="Hints used" items={[String(stats.hintsUsed)]} />
              <Row label="Things explored" items={[String(stats.itemsExplored)]} />
            </dl>
            <p className="mt-3 text-sm text-ink-faint">Numbers come straight from lesson activity. Minutes show time spent, not how much was learned.</p>
          </details>
        </aside>
      </div>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] bg-mist px-3 py-4 sm:px-5 sm:py-5">
      <dt className="text-sm leading-tight text-ink-soft">{label}</dt>
      <dd className="display mt-2 text-[2rem] tabular-nums sm:text-5xl">{value}</dd>
    </div>
  );
}

function Row({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex justify-between gap-4 py-3 text-sm">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className="text-right">{items.length ? items.join(", ") : <span className="text-ink-faint">None</span>}</dd>
    </div>
  );
}
