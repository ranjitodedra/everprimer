import Link from "next/link";
import { notFound } from "next/navigation";
import { LESSON_LIMITS, ageBandFor } from "@eco/contracts";
import type { ChildRow, CurriculumRow, TopicProgressRow, TopicRow } from "@eco/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { GenerationProgress } from "@/components/generation-progress";
import { ArrowLeft, Check, Play, Refresh } from "@/components/icons";
import { Beads, fieldFor } from "@/components/ui";
import { requireLearner } from "@/lib/auth";
import { lessonFinished } from "@/lib/lesson-progress";
import { createClient } from "@/lib/supabase/server";

type Status = TopicProgressRow["status"];

/** Sideways offset per node, in rem, repeated down the path. */
const WAVE = [0, 1, 1.5, 1, 0, -1, -1.5, -1];
const STEP_REM = 3.25;

const NODE_CLASS: Record<Status, string> = {
  completed: "path-node-done",
  needs_review: "path-node-review",
  in_progress: "path-node-current",
  not_started: "path-node-new",
};

export default async function SubtopicPath(props: PageProps<"/learn/[childId]/curricula/[curriculumId]">) {
  const { childId, curriculumId } = await props.params;
  await requireLearner(childId);
  const supabase = await createClient();
  const [{ data: child }, { data: curriculum }, { data: topics }] = await Promise.all([
    supabase.from("children").select("*").eq("id", childId).maybeSingle(),
    supabase.from("curricula").select("*").eq("id", curriculumId).eq("child_id", childId).maybeSingle(),
    supabase.from("topics").select("*").eq("curriculum_id", curriculumId).order("position"),
  ]);
  if (!child || !curriculum) notFound();
  const c = child as ChildRow;
  const cur = curriculum as CurriculumRow;
  const all = (topics ?? []) as TopicRow[];
  const list = all.filter((t) => t.kind === "lesson");
  const lessonNumber = new Map(list.map((t, i) => [t.id, i + 1]));

  const { data: progress } = list.length
    ? await supabase.from("topic_progress").select("*").eq("child_id", c.id).in("topic_id", list.map((t) => t.id))
    : { data: [] };
  const progressByTopic = new Map(((progress ?? []) as TopicProgressRow[]).map((p) => [p.topic_id, p]));
  const statusOf = (t: TopicRow): Status => progressByTopic.get(t.id)?.status ?? "not_started";

  const sessionTotal = LESSON_LIMITS[ageBandFor(c.age)].sessions;
  const done = list.filter((t) => lessonFinished(progressByTopic.get(t.id))).length;
  const current =
    list.find((t) => statusOf(t) === "in_progress") ?? list.find((t) => statusOf(t) === "not_started");
  const currentSessions = current ? (progressByTopic.get(current.id)?.sessions_completed ?? 0) : 0;
  const field = fieldFor(cur.id);

  return (
    <div className={`${field} text-(--field-ink)`}>
      <div className="field fixed inset-0 -z-10" aria-hidden />
      {cur.status === "generating" ? <AutoRefresh intervalMs={3000} /> : null}
      <Link href={`/learn/${c.id}`} className="press -ml-2 inline-flex min-h-11 items-center gap-1 rounded-full pr-3 pl-2 font-semibold opacity-70">
        <ArrowLeft size={18} />
        My topics
      </Link>
      <div className="mt-3 mb-12">
        <h1 className="display text-[2.75rem] sm:text-6xl">{cur.status === "generating" || !cur.title ? "Getting ready" : cur.title}</h1>
        {list.length ? <Beads done={done} total={list.length} className="mt-4" /> : null}
      </div>

      {list.length === 0 && cur.status === "failed" ? (
        <div className="flex flex-col items-center py-10 text-center">
          <span className="text-6xl" aria-hidden>🛠️</span>
          <p className="mt-4 text-lg font-semibold">These lessons couldn&apos;t be made.</p>
          <p className="opacity-75">A grown-up can try again.</p>
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center" role="status">
          <span className="animate-breathe text-6xl" aria-hidden>✨</span>
          <p className="mt-4 text-lg font-semibold">Your lessons are on their way.</p>
          {cur.status === "generating" ? <GenerationProgress kind="curriculum" stage={cur.stage} stageAt={cur.stage_at} retrying={!!cur.error} className="mt-5 max-w-64" /> : null}
        </div>
      ) : (
        <ol className="flex flex-col items-center gap-9 pb-32">
          {all.map((t, i) => {
            if (t.kind === "unit") {
              return (
                <li key={t.id} className="w-full max-w-sm text-center">
                  <span className="inline-block rounded-full bg-paper/60 px-4 py-2 font-semibold">{t.title}</span>
                </li>
              );
            }
            const status = statusOf(t);
            const isCurrent = current?.id === t.id;
            const nodeClass = isCurrent && status !== "needs_review" ? "path-node-current" : NODE_CLASS[status === "in_progress" ? "not_started" : status];
            return (
              <li key={t.id} className="flex flex-col items-center" style={{ transform: `translateX(${WAVE[i % WAVE.length] * STEP_REM}rem)` }}>
                <Link href={`/learn/${c.id}/topics/${t.id}`} className="flex flex-col items-center gap-3" aria-label={`${t.title}${isCurrent ? ", up next" : ""}`}>
                  <span className={`path-node ${nodeClass}`}>
                    {status === "completed" ? (
                      <Check size={30} />
                    ) : status === "needs_review" ? (
                      <Refresh size={28} />
                    ) : isCurrent ? (
                      <Play size={34} className="ml-1" />
                    ) : (
                      <span className="display text-2xl tabular-nums">{lessonNumber.get(t.id)}</span>
                    )}
                  </span>
                  <span className={`max-w-[10rem] text-center leading-tight ${isCurrent ? "text-lg font-bold" : "text-sm font-semibold opacity-75"}`}>{t.title}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      {current ? (
        <div className="fixed inset-x-0 bottom-0 z-20 px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]">
          <Link href={`/learn/${c.id}/topics/${current.id}`} className="btn-field btn-lg mx-auto flex w-full max-w-sm shadow-[0_14px_30px_-12px_rgb(0_0_0/0.4)]">
            <Play size={16} />
            {currentSessions ? `Keep going, part ${currentSessions + 1} of ${sessionTotal}` : "Start next lesson"}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
