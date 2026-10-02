import Link from "next/link";
import { notFound } from "next/navigation";
import type { ChildRow, CurriculumRow, TopicProgressRow, TopicRow } from "@eco/db";
import { createCurriculum } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { BillingNotice, billingCode } from "@/components/billing-notice";
import { ArrowRight, Check, Play, Sparkles } from "@/components/icons";
import { Avatar, ProgressRing } from "@/components/ui";
import { isKidMode, requireLearner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Summary = {
  curriculum: CurriculumRow;
  total: number;
  done: number;
  started: boolean;
  lastActivity: number;
};

export default async function ChildTopics(props: PageProps<"/learn/[childId]">) {
  const { childId } = await props.params;
  const sp = await props.searchParams;
  const account = await requireLearner(childId);
  const supabase = await createClient();
  const [{ data: child }, { data: curricula }, { data: progress }] = await Promise.all([
    supabase.from("children").select("*").eq("id", childId).maybeSingle(),
    supabase.from("curricula").select("*").eq("child_id", childId).order("created_at"),
    supabase.from("topic_progress").select("*").eq("child_id", childId),
  ]);
  if (!child) notFound();
  const c = child as ChildRow;
  const kidMode = await isKidMode();
  const setsOwnGoals = c.kind === "self" && account.kind !== "child" && !kidMode;
  const curriculumRows = (curricula ?? []) as CurriculumRow[];
  const progressByTopic = new Map(((progress ?? []) as TopicProgressRow[]).map((p) => [p.topic_id, p]));

  const { data: topics } = curriculumRows.length
    ? await supabase.from("topics").select("*").in("curriculum_id", curriculumRows.map((cur) => cur.id))
    : { data: [] };
  const topicsByCurriculum = new Map<string, TopicRow[]>();
  for (const t of (topics ?? []) as TopicRow[]) topicsByCurriculum.set(t.curriculum_id, [...(topicsByCurriculum.get(t.curriculum_id) ?? []), t]);

  const summaries: Summary[] = curriculumRows
    .map((cur) => {
      const list = topicsByCurriculum.get(cur.id) ?? [];
      let lastActivity = Date.parse(cur.created_at);
      let done = 0;
      let started = false;
      for (const t of list) {
        const p = progressByTopic.get(t.id);
        if (!p) continue;
        if (p.status === "completed") done++;
        if (p.status !== "not_started") started = true;
        if (p.last_activity_at) lastActivity = Math.max(lastActivity, Date.parse(p.last_activity_at));
      }
      return { curriculum: cur, total: list.length, done, started, lastActivity };
    })
    .sort((a, b) => b.lastActivity - a.lastActivity);

  const anyGenerating = curriculumRows.some((cur) => cur.status === "generating");

  return (
    <div className="py-2">
      {anyGenerating ? <AutoRefresh intervalMs={5000} /> : null}
      <BillingNotice code={billingCode(sp.billing)} audience={account.kind === "child" || kidMode ? "learner" : "grownup"} />
      <div className="mb-8 flex items-center gap-3 sm:mb-10 sm:gap-4">
        <Avatar emoji={c.avatar} size="lg" className="animate-float" />
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight sm:text-4xl">Hi {c.display_name}!</h1>
          <p className="text-ink-soft">{setsOwnGoals ? "Pick up where you left off, or set a new goal." : "Pick a topic to explore."}</p>
        </div>
      </div>

      {setsOwnGoals ? <NewGoal childId={c.id} /> : null}

      {summaries.length === 0 ? (
        <div className="card dotted-bg py-12 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-sun-soft text-3xl" aria-hidden>🌱</div>
          <p className="text-lg font-extrabold">Nothing here yet</p>
          <p className="text-ink-soft">{setsOwnGoals ? "Write your first learning goal above." : "Ask a grown-up to add a learning goal."}</p>
        </div>
      ) : null}

      <ul className="space-y-4">
        {summaries.map((s, i) => (
          <li key={s.curriculum.id} className="animate-rise" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
            {s.curriculum.status === "generating" || s.total === 0 ? (
              <div className="card flex items-center gap-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-violet-soft text-violet">
                  <Sparkles size={22} className="animate-pulse" />
                </span>
                <span className="min-w-0">
                  <span className="block text-lg font-extrabold">{s.curriculum.title || "Getting ready…"}</span>
                  <span className="block text-sm text-ink-soft">Your topic is being prepared.</span>
                </span>
              </div>
            ) : (
              <TopicCard childId={c.id} summary={s} featured={i === 0} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewGoal({ childId }: { childId: string }) {
  const create = createCurriculum.bind(null, childId);
  return (
    <form action={create} className="card mb-6 space-y-3">
      <input type="hidden" name="from" value="learn" />
      <label htmlFor="goal" className="flex items-center gap-2 font-extrabold">
        <Sparkles size={16} className="text-sun-deep" />
        New learning goal
      </label>
      <textarea id="goal" name="goal" required minLength={5} maxLength={600} rows={2} className="input" placeholder="I want to understand how compound interest works." />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-faint">Write it the way you would say it. 5 to 14 lessons.</p>
        <button type="submit" className="btn-primary">Create</button>
      </div>
    </form>
  );
}

function TopicCard({ childId, summary, featured }: { childId: string; summary: Summary; featured: boolean }) {
  const { curriculum, total, done, started } = summary;
  const allDone = done === total;
  const label = allDone ? "All done" : started ? "Keep going" : "New";
  const href = `/learn/${childId}/curricula/${curriculum.id}`;

  if (featured) {
    return (
      <Link
        href={href}
        className="group relative flex items-center gap-4 overflow-hidden rounded-3xl bg-brand p-5 text-white shadow-lift transition hover:-translate-y-0.5 sm:gap-6 sm:p-6"
      >
        <span className="pointer-events-none absolute -top-20 -right-12 h-48 w-48 rounded-full bg-white/10" aria-hidden />
        <span className="pointer-events-none absolute -bottom-28 right-36 h-40 w-40 rounded-full bg-sun/15" aria-hidden />
        <span className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white/15">
          <span className="text-sm font-black tabular-nums">{done}/{total}</span>
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="mb-0.5 block text-xs font-black tracking-widest text-white/75 uppercase">{label}</span>
          <span className="block text-xl leading-tight font-black sm:text-2xl">{curriculum.title}</span>
          {curriculum.description ? <span className="mt-1 line-clamp-1 block text-sm text-white/80">{curriculum.description}</span> : null}
        </span>
        <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-brand-deep shadow-soft transition group-hover:scale-105" aria-hidden>
          {allDone ? <Check size={20} /> : <Play size={20} />}
        </span>
      </Link>
    );
  }

  return (
    <Link href={href} className="card card-hover flex items-center gap-4 border-2">
      <ProgressRing value={total ? done / total : 0} size={56} stroke={6}>
        <span className="text-xs font-black tabular-nums text-brand-deep">{done}/{total}</span>
      </ProgressRing>
      <span className="min-w-0 flex-1">
        <span className="block text-lg leading-tight font-extrabold">{curriculum.title}</span>
        <span className="mt-0.5 block text-sm text-ink-soft">{label}</span>
      </span>
      <ArrowRight size={18} className="text-ink-faint" />
    </Link>
  );
}
