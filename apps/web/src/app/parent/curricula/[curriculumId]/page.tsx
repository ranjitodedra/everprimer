import Link from "next/link";
import { notFound } from "next/navigation";
import type { ArtifactRow, ChildRow, CurriculumRow, ObjectiveMasteryRow, ObjectiveRow, TopicProgressRow, TopicRow } from "@eco/db";
import { regenerateArtifact, retryCurriculum } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { BillingNotice, billingCode } from "@/components/billing-notice";
import { Check, ChevronDown, Play, Refresh } from "@/components/icons";
import { LessonFeedback } from "@/components/lesson-feedback";
import { BackLink, Notice, ProgressLine, StatusBadge } from "@/components/ui";
import { requireGrownup } from "@/lib/auth";
import { lessonFinished } from "@/lib/lesson-progress";
import { planFor } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";

export default async function CurriculumPage(props: PageProps<"/parent/curricula/[curriculumId]">) {
  const account = await requireGrownup();
  const { curriculumId } = await props.params;
  const sp = await props.searchParams;
  const canRegenerate = planFor(account.parent.tier).regenerate;
  const supabase = await createClient();

  const { data: cur } = await supabase.from("curricula").select("*").eq("id", curriculumId).maybeSingle();
  if (!cur) notFound();
  const curriculum = cur as CurriculumRow;

  const [{ data: child }, { data: topics }, { data: progress }] = await Promise.all([
    supabase.from("children").select("*").eq("id", curriculum.child_id).single(),
    supabase.from("topics").select("*").eq("curriculum_id", curriculumId).order("position"),
    supabase.from("topic_progress").select("*").eq("child_id", curriculum.child_id),
  ]);
  const topicRows = (topics ?? []) as TopicRow[];
  const topicIds = topicRows.map((t) => t.id);
  const [{ data: objectives }, { data: artifacts }, { data: mastery }] = topicIds.length
    ? await Promise.all([
        supabase.from("learning_objectives").select("*").in("topic_id", topicIds).order("position"),
        supabase.from("artifacts").select("*").in("topic_id", topicIds).order("version", { ascending: false }),
        supabase.from("objective_mastery").select("*").eq("child_id", curriculum.child_id),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const progressByTopic = new Map(((progress ?? []) as TopicProgressRow[]).map((p) => [p.topic_id, p]));
  const objectivesByTopic = new Map<string, ObjectiveRow[]>();
  for (const o of (objectives ?? []) as ObjectiveRow[]) objectivesByTopic.set(o.topic_id, [...(objectivesByTopic.get(o.topic_id) ?? []), o]);
  const latestArtifact = new Map<string, ArtifactRow>();
  for (const a of (artifacts ?? []) as ArtifactRow[]) if (!latestArtifact.has(a.topic_id)) latestArtifact.set(a.topic_id, a);
  const masteryByObjective = new Map(((mastery ?? []) as ObjectiveMasteryRow[]).map((m) => [m.objective_id, m]));
  const c = child as ChildRow;

  const generating = curriculum.status === "generating" || [...latestArtifact.values()].some((a) => a.status === "generating");
  const lessons = topicRows.filter((t) => t.kind === "lesson");
  const completedCount = lessons.filter((t) => lessonFinished(progressByTopic.get(t.id))).length;
  const lessonNumber = new Map(lessons.map((t, i) => [t.id, i + 1]));
  const partsOf = (unitId: string) => topicRows.filter((t) => t.parent_topic_id === unitId).length;

  return (
    <>
      {generating ? <AutoRefresh intervalMs={4000} /> : null}
      <BillingNotice code={billingCode(sp.billing)} audience="grownup" />
      <BackLink href={`/parent/children/${c.id}`}>{c.kind === "self" ? "Your progress" : c.display_name}</BackLink>
      <header className="mb-8">
        <h1 className="display text-[2.5rem] break-words sm:text-5xl">{curriculum.status === "generating" || !curriculum.title ? curriculum.goal_text : curriculum.title}</h1>
        <p className="mt-3 max-w-2xl text-ink-soft">{curriculum.description || curriculum.goal_text}</p>
        {lessons.length ? (
          <div className="mt-5 flex max-w-sm items-center gap-3 text-leaf">
            <ProgressLine value={completedCount / lessons.length} />
            <span className="shrink-0 text-sm text-ink-soft tabular-nums">{completedCount} of {lessons.length} done</span>
          </div>
        ) : null}
      </header>

      {curriculum.status === "generating" && curriculum.error ? (
        <Notice tone="warning">The last attempt failed. Trying again now.</Notice>
      ) : curriculum.status === "generating" ? (
        <Notice>Planning the lessons. This page updates on its own.</Notice>
      ) : null}
      {curriculum.status === "failed" ? (
        <Notice
          tone="error"
          action={
            <form action={retryCurriculum.bind(null, curriculum.id)}>
              <button className="btn-secondary btn-sm" type="submit">Try again</button>
            </form>
          }
        >
          These lessons couldn&apos;t be planned{curriculum.error ? `: ${curriculum.error}` : "."}
        </Notice>
      ) : null}

      <ol className="space-y-2">
        {topicRows.map((t) => {
          if (t.kind === "unit") {
            return (
              <li key={t.id} className="pt-6 pb-1">
                <h2 className="font-semibold">{t.title}</h2>
                <p className="text-sm text-ink-soft">Split into {partsOf(t.id)} parts because it was too big for one lesson. The credit was refunded.</p>
              </li>
            );
          }
          const p = progressByTopic.get(t.id);
          const art = latestArtifact.get(t.id);
          const objs = objectivesByTopic.get(t.id) ?? [];
          const status = p?.status ?? "not_started";
          const regen = regenerateArtifact.bind(null, t.id, curriculum.id);
          const total = sessionTotalOf(art);
          const marker =
            status === "completed"
              ? "bg-leaf text-white"
              : status === "needs_review"
                ? "bg-spark text-white"
                : status === "in_progress"
                  ? "bg-leaf-soft text-leaf-deep"
                  : "bg-paper text-ink-soft";
          return (
            <li key={t.id} className={t.parent_topic_id ? "sm:pl-8" : ""}>
              <details className="group rounded-[1.25rem] bg-mist open:bg-mist">
                <summary className="press flex min-h-16 cursor-pointer list-none items-center gap-4 rounded-[1.25rem] px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums ${marker}`} aria-hidden>
                    {status === "completed" ? <Check size={18} /> : status === "needs_review" ? <Refresh size={16} /> : lessonNumber.get(t.id)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold break-words">{t.title}</span>
                    <span className="mt-0.5 block">
                      <StatusBadge status={art?.status === "generating" ? "generating" : art?.status === "failed" ? "failed" : status} />
                    </span>
                  </span>
                  <ChevronDown size={18} className="shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-180" />
                </summary>

                <div className="space-y-5 px-4 pt-1 pb-5 sm:pl-[4.5rem]">
                  {t.description ? <p className="text-ink-soft">{t.description}</p> : null}

                  {p?.sessions_completed || p?.status === "in_progress" ? (
                    <dl className="grid max-w-md grid-cols-2 gap-4">
                      {p?.sessions_completed ? (
                        <div>
                          <dt className="text-sm text-ink-soft">Parts done</dt>
                          <dd className="display text-2xl tabular-nums">{p.sessions_completed}{total ? ` of ${total}` : ""}</dd>
                        </div>
                      ) : null}
                      {p?.final_score != null ? (
                        <div>
                          <dt className="text-sm text-ink-soft">Final check</dt>
                          <dd className="display text-2xl tabular-nums">{Math.round(Number(p.final_score) * 100)}%</dd>
                        </div>
                      ) : p?.status === "in_progress" ? (
                        <div>
                          <dt className="text-sm text-ink-soft">Mastery</dt>
                          <dd className="mt-3 text-leaf"><ProgressLine value={Number(p.mastery)} label="Mastery" /></dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}

                  {p?.feedback ? <LessonFeedback feedback={p.feedback} compact /> : null}

                  {objs.length ? (
                    <div>
                      <h3 className="mb-2 text-sm text-ink-soft">What it teaches</h3>
                      <ul className="divide-y divide-line rounded-2xl bg-paper">
                        {objs.map((o) => {
                          const m = masteryByObjective.get(o.id);
                          return (
                            <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                              <span>{o.text}</span>
                              {m && m.status !== "unknown" ? <StatusBadge status={m.status} /> : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  {art?.status === "failed" ? <p className="text-sm font-semibold text-berry">Last attempt failed: {art.error}</p> : null}
                  {art?.status === "generating" && art.error ? <p className="text-sm font-semibold text-spark-deep">Retrying after an error: {art.error}</p> : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/learn/${c.id}/topics/${t.id}`} className="btn-secondary btn-sm bg-paper">
                      <Play size={13} />
                      Preview
                    </Link>
                    {art?.status === "published" && !canRegenerate ? null : (
                      <form action={regen}>
                        <button type="submit" className="btn-ghost btn-sm" disabled={art?.status === "generating"}>
                          <Refresh size={14} className={art?.status === "generating" ? "animate-spin" : ""} />
                          {art?.status === "published" ? "Rewrite lesson" : art ? "Try again" : "Make it now"}
                        </button>
                      </form>
                    )}
                    <span className="ml-auto text-xs text-ink-faint">
                      {art ? `Version ${art.version}${art.used_fallback ? ", standard player" : ""}` : "Made the first time it's opened"}
                    </span>
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function sessionTotalOf(art: ArtifactRow | undefined): number | null {
  const sessions = art?.blueprint && typeof art.blueprint === "object" && art.blueprint !== null && "sessions" in art.blueprint
    ? (art.blueprint as { sessions?: unknown }).sessions
    : null;
  return Array.isArray(sessions) ? sessions.length : null;
}
