import Link from "next/link";
import { notFound } from "next/navigation";
import type { ChildRow, CurriculumRow, TopicProgressRow, TopicRow } from "@eco/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { Check, Play, Refresh, Sparkles } from "@/components/icons";
import { BackLink, ProgressRing } from "@/components/ui";
import { requireLearner } from "@/lib/auth";
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
  const list = (topics ?? []) as TopicRow[];

  const { data: progress } = list.length
    ? await supabase.from("topic_progress").select("*").eq("child_id", c.id).in("topic_id", list.map((t) => t.id))
    : { data: [] };
  const progressByTopic = new Map(((progress ?? []) as TopicProgressRow[]).map((p) => [p.topic_id, p]));
  const statusOf = (t: TopicRow): Status => progressByTopic.get(t.id)?.status ?? "not_started";

  const done = list.filter((t) => statusOf(t) === "completed").length;
  const current =
    list.find((t) => {
      const s = statusOf(t);
      return s === "in_progress" || s === "needs_review";
    }) ?? list.find((t) => statusOf(t) === "not_started");

  return (
    <div className="py-2">
      {cur.status === "generating" ? <AutoRefresh intervalMs={5000} /> : null}
      <BackLink href={`/learn/${c.id}`}>My topics</BackLink>
      <div className="mb-10 flex items-center gap-4">
        {list.length ? (
          <ProgressRing value={done / list.length} size={56} stroke={6}>
            <span className="text-xs font-black tabular-nums text-brand-deep">{done}/{list.length}</span>
          </ProgressRing>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{cur.title || "Getting ready…"}</h1>
          {cur.description ? <p className="text-ink-soft">{cur.description}</p> : null}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-soft text-violet">
            <Sparkles size={18} className="animate-pulse" />
          </span>
          <p>Your lessons are being prepared. They will appear here in a moment.</p>
        </div>
      ) : (
        <ol className="flex flex-col items-center gap-8 pb-8">
          {list.map((t, i) => {
            const status = statusOf(t);
            const isCurrent = current?.id === t.id;
            const nodeClass = isCurrent && status !== "needs_review" ? "path-node-current" : NODE_CLASS[status];
            return (
              <li
                key={t.id}
                className="animate-rise flex flex-col items-center"
                style={{ transform: `translateX(${WAVE[i % WAVE.length] * STEP_REM}rem)`, animationDelay: `${Math.min(i, 10) * 40}ms` }}
              >
                <Link
                  href={`/learn/${c.id}/topics/${t.id}`}
                  className="relative flex flex-col items-center gap-2"
                  aria-label={`${t.title}${isCurrent ? " (start here)" : ""}`}
                >
                  {isCurrent ? (
                    <span className="animate-float mb-1 rounded-xl border-2 border-line bg-card px-3 py-1 text-sm font-black tracking-wide text-brand-deep uppercase shadow-soft">
                      Start
                    </span>
                  ) : null}
                  <span className={`relative ${isCurrent ? "path-ring" : ""}`}>
                    <span className={`path-node ${nodeClass} ${isCurrent ? "path-node-lg" : ""}`}>
                      {status === "completed" ? (
                        <Check size={isCurrent ? 34 : 28} />
                      ) : status === "needs_review" ? (
                        <Refresh size={isCurrent ? 32 : 26} />
                      ) : isCurrent ? (
                        <Play size={32} />
                      ) : (
                        <span className="text-xl font-black tabular-nums">{t.position}</span>
                      )}
                    </span>
                  </span>
                  <span className="max-w-[9rem] text-center text-sm leading-tight font-extrabold">{t.title}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
