import Link from "next/link";
import { notFound } from "next/navigation";
import type { ChildRow, CurriculumRow, TopicProgressRow, TopicRow } from "@eco/db";
import { createCurriculum } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { BillingNotice, billingCode } from "@/components/billing-notice";
import { GenerationProgress } from "@/components/generation-progress";
import { GoalDialog } from "@/components/goal-dialog";
import { Check, Play, Plus } from "@/components/icons";
import { Avatar, Beads, EmptyState, fieldFor } from "@/components/ui";
import { isKidMode, requireLearner } from "@/lib/auth";
import { lessonFinished } from "@/lib/lesson-progress";
import { createClient } from "@/lib/supabase/server";

type Summary = {
  curriculum: CurriculumRow;
  total: number;
  done: number;
  started: boolean;
  lastActivity: number;
};

function ready(s: Summary) {
  return s.curriculum.status !== "generating" && s.total > 0;
}

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
    ? await supabase.from("topics").select("*").eq("kind", "lesson").in("curriculum_id", curriculumRows.map((cur) => cur.id))
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
        if (lessonFinished(p)) done++;
        if (p.status !== "not_started") started = true;
        if (p.last_activity_at) lastActivity = Math.max(lastActivity, Date.parse(p.last_activity_at));
      }
      return { curriculum: cur, total: list.length, done, started, lastActivity };
    })
    .sort((a, b) => b.lastActivity - a.lastActivity);

  const anyGenerating = curriculumRows.some((cur) => cur.status === "generating");
  const featured = summaries.find((s) => ready(s) && s.done < s.total) ?? summaries.find(ready);
  const shelf = summaries.filter((s) => s !== featured);
  const newGoal = setsOwnGoals ? createCurriculum.bind(null, c.id) : null;

  return (
    <div>
      {anyGenerating ? <AutoRefresh intervalMs={5000} /> : null}
      <BillingNotice code={billingCode(sp.billing)} audience={account.kind === "child" || kidMode ? "learner" : "grownup"} />

      <div className="mt-2 mb-7 flex items-center gap-4">
        <Avatar emoji={c.avatar} id={c.id} size="lg" />
        <h1 className="display min-w-0 text-[2.75rem] break-words sm:text-6xl">Hi {c.display_name}</h1>
      </div>

      {summaries.length === 0 ? (
        <EmptyState
          emoji="🌱"
          title="Nothing here yet"
          body={setsOwnGoals ? "What do you want to learn?" : "Ask a grown-up to add something to learn."}
          action={newGoal ? <GoalDialog action={newGoal} from="learn" self triggerClassName="btn-primary btn-lg" /> : null}
        />
      ) : null}

      {featured ? <Featured childId={c.id} summary={featured} /> : null}

      {shelf.length || newGoal ? (
        <section className="mt-8" aria-label="More to learn">
          {featured ? <h2 className="mb-3 font-semibold text-ink-soft">More to explore</h2> : null}
          <ul className="shelf">
            {shelf.map((s) => (
              <li key={s.curriculum.id}>
                <Book childId={c.id} summary={s} />
              </li>
            ))}
            {newGoal && summaries.length > 0 ? (
              <li>
                <GoalDialog
                  action={newGoal}
                  from="learn"
                  self
                  triggerClassName="press flex h-56 w-40 flex-col items-center justify-center gap-3 rounded-[1.75rem] border-2 border-dashed border-mist-deep font-semibold text-ink-soft"
                  trigger={
                    <>
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-mist text-ink">
                        <Plus size={22} />
                      </span>
                      New goal
                    </>
                  }
                />
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Featured({ childId, summary }: { childId: string; summary: Summary }) {
  const { curriculum, total, done, started } = summary;
  const allDone = done >= total;
  const label = allDone ? "All done" : started ? "Keep going" : "New";
  return (
    <Link
      href={`/learn/${childId}/curricula/${curriculum.id}`}
      className={`press field ${fieldFor(curriculum.id)} animate-rise relative flex min-h-[19rem] flex-col justify-between overflow-hidden rounded-[2rem] p-6 sm:min-h-[22rem] sm:p-8`}
    >
      <div>
        <p className="font-semibold opacity-75">{label}</p>
        <h2 className="display mt-2 max-w-lg text-[2.5rem] sm:text-6xl">{curriculum.title}</h2>
      </div>
      <div className="mt-8 flex items-end justify-between gap-6">
        <Beads done={done} total={total} className="max-w-[60%]" />
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-(--field-ink) text-(--field) shadow-[0_10px_24px_-8px_rgb(0_0_0/0.35)]" aria-hidden>
          {allDone ? <Check size={28} /> : <Play size={26} className="ml-1" />}
        </span>
      </div>
    </Link>
  );
}

function Book({ childId, summary }: { childId: string; summary: Summary }) {
  const { curriculum, total, done } = summary;
  const base = "flex h-56 w-40 flex-col justify-between rounded-[1.75rem] p-4";

  if (curriculum.status === "failed" && total === 0) {
    return (
      <div className={`${base} bg-mist text-ink-soft`}>
        <span className="text-3xl" aria-hidden>🛠️</span>
        <span>
          <span className="block leading-tight font-semibold text-ink">{curriculum.title || curriculum.goal_text}</span>
          <span className="mt-1 block text-sm">A grown-up can try again.</span>
        </span>
      </div>
    );
  }
  if (!ready(summary)) {
    return (
      <div className={`${base} field ${fieldFor(curriculum.id)} opacity-80`}>
        <span className="animate-breathe text-3xl" aria-hidden>✨</span>
        <span>
          <span className="block leading-tight font-semibold">{curriculum.status === "generating" ? "Getting ready" : curriculum.title}</span>
          {curriculum.status === "generating" ? (
            <GenerationProgress kind="curriculum" stage={curriculum.stage} stageAt={curriculum.stage_at} retrying={!!curriculum.error} size="compact" className="mt-2" />
          ) : null}
        </span>
      </div>
    );
  }
  return (
    <Link href={`/learn/${childId}/curricula/${curriculum.id}`} className={`press ${base} field ${fieldFor(curriculum.id)}`}>
      <Beads done={done} total={total} size="sm" />
      <span className="display text-[1.375rem] leading-[1.05]">{curriculum.title}</span>
    </Link>
  );
}
