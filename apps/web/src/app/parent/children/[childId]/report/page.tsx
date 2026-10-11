import Link from "next/link";
import { notFound } from "next/navigation";
import type { ChildRow, DailyReportRow, LessonFeedbackRow, TopicProgressRow } from "@eco/db";
import { generateReportNow } from "@/app/actions";
import { ArrowLeft, ArrowRight, Book, Check, Clock, Sparkles, Target } from "@/components/icons";
import { LessonFeedback } from "@/components/lesson-feedback";
import { Avatar, BackLink, PageHeader, Stat } from "@/components/ui";
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

  return (
    <>
      <BackLink href={`/parent/children/${c.id}`}>{c.display_name}</BackLink>
      <PageHeader
        eyebrow="Daily summary"
        leading={<Avatar emoji={c.avatar} size="lg" className="mt-1" />}
        title={isToday ? "Today" : prettyDate(date)}
        description="Numbers are computed from learning activity. The written summary only phrases them and never guesses at mood or behaviour."
        actions={
          <div className="flex items-center gap-1 rounded-full border border-line bg-card p-1 shadow-soft">
            <Link href={`?date=${prev.toISOString().slice(0, 10)}`} className="btn-ghost btn-sm btn-icon" aria-label="Previous day">
              <ArrowLeft size={16} />
            </Link>
            <span className="px-2 text-sm font-bold tabular-nums">{date}</span>
            <Link href={`?date=${next.toISOString().slice(0, 10)}`} className={`btn-ghost btn-sm btn-icon ${isToday ? "pointer-events-none opacity-30" : ""}`} aria-label="Next day" aria-disabled={isToday}>
              <ArrowRight size={16} />
            </Link>
          </div>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Topics opened" value={stats.topicsOpened.length} icon={<Book size={18} />} tone="sky" />
        <Stat label="Completed" value={stats.topicsCompleted.length} icon={<Check size={18} />} tone="brand" />
        <Stat label="Questions" value={`${stats.questionsCorrect}/${stats.questionsAnswered}`} hint={stats.questionsAnswered ? `${stats.firstAttemptCorrect} right first time` : undefined} icon={<Target size={18} />} tone="violet" />
        <Stat label="Active" value={`${stats.minutesActive} min`} hint="Context, not proof of learning" icon={<Clock size={18} />} tone="sun" />
      </div>

      <div className="grid gap-6 md:grid-cols-[1.5fr_1fr]">
        <section className="card h-fit">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold">Written summary</h2>
            <form action={generate}>
              <button type="submit" className="btn-secondary btn-sm">
                <Sparkles size={14} />
                {report ? "Regenerate" : "Write summary"}
              </button>
            </form>
          </div>
          {report ? (
            <p className="text-[1.05rem] leading-relaxed whitespace-pre-line">{report.summary}</p>
          ) : (
            <div className="card-muted dotted-bg text-center">
              <p className="font-bold">No written summary yet for this day.</p>
              <p className="mt-1 text-sm text-ink-soft">              Generate one from the numbers on this page. It takes a few seconds.</p>
            </div>
          )}
          {lessonFeedback.length ? (
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="mb-3 font-extrabold">End-of-lesson feedback</h3>
              <div className="space-y-3">
                {lessonFeedback.map((r) => (
                  <LessonFeedback key={r.topic_id} title={r.topics.title} feedback={r.feedback} />
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <section className="card">
            <h3 className="mb-3 font-extrabold">Observed</h3>
            <dl className="space-y-3 text-sm">
              <Row label="Opened" items={stats.topicsOpened} />
              <Row label="Completed" items={stats.topicsCompleted} />
              <Row label="Needs review" items={stats.needsReview} />
              <Row label="Strengths" items={stats.strengths} />
              <Row label="Struggled" items={stats.struggles} />
              <div className="flex justify-between border-t border-line pt-3">
                <dt className="text-ink-soft">Hints used</dt>
                <dd className="font-bold tabular-nums">{stats.hintsUsed}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">Items explored</dt>
                <dd className="font-bold tabular-nums">{stats.itemsExplored}</dd>
              </div>
            </dl>
          </section>
          <section className="rounded-2xl border border-brand/25 bg-brand-tint p-5">
            <p className="eyebrow mb-1">Next up</p>
            <p className="text-sm font-bold">{stats.suggestedNext ?? "Nothing to review. Pick any unlocked topic next."}</p>
          </section>
        </aside>
      </div>
    </>
  );
}

function Row({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <dt className="text-xs font-extrabold tracking-wider text-ink-soft uppercase">{label}</dt>
      <dd className="mt-0.5">{items.length ? items.join(", ") : <span className="text-ink-faint">—</span>}</dd>
    </div>
  );
}
