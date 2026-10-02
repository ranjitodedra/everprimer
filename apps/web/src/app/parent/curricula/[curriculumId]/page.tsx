import Link from "next/link";
import { notFound } from "next/navigation";
import type { ArtifactRow, ChildRow, CurriculumRow, ObjectiveMasteryRow, ObjectiveRow, TopicProgressRow, TopicRow } from "@eco/db";
import { regenerateArtifact, retryCurriculum } from "@/app/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { BillingNotice, billingCode } from "@/components/billing-notice";
import { Check, ChevronDown, Play, Refresh } from "@/components/icons";
import { BackLink, MasteryBar, Notice, PageHeader, ProgressRing, StatusBadge } from "@/components/ui";
import { requireGrownup } from "@/lib/auth";
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
  const completedCount = topicRows.filter((t) => progressByTopic.get(t.id)?.status === "completed").length;

  return (
    <>
      {generating ? <AutoRefresh intervalMs={4000} /> : null}
      <BillingNotice code={billingCode(sp.billing)} audience="grownup" />
      <BackLink href={`/parent/children/${c.id}`}>{c.display_name}</BackLink>
      <PageHeader
        eyebrow="Curriculum"
        leading={
          topicRows.length ? (
            <ProgressRing value={completedCount / topicRows.length} size={64} stroke={6} className="mt-1">
              <span className="text-sm font-black tabular-nums text-brand-deep">{completedCount}/{topicRows.length}</span>
            </ProgressRing>
          ) : undefined
        }
        title={curriculum.title || "Preparing your curriculum…"}
        description={curriculum.description || curriculum.goal_text}
        actions={<StatusBadge status={curriculum.status} />}
      />

      {curriculum.status === "generating" ? (
        <Notice>
          Turning &ldquo;{curriculum.goal_text}&rdquo; into an ordered set of lessons. This page refreshes on its own.
        </Notice>
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
          Curriculum generation failed{curriculum.error ? `: ${curriculum.error}` : ""}.
        </Notice>
      ) : null}

      <ol className="relative space-y-4 before:absolute before:top-6 before:bottom-6 before:left-[1.4rem] before:w-0.5 before:bg-line sm:before:left-[1.65rem]">
        {topicRows.map((t) => {
          const p = progressByTopic.get(t.id);
          const art = latestArtifact.get(t.id);
          const objs = objectivesByTopic.get(t.id) ?? [];
          const status = p?.status ?? "not_started";
          const regen = regenerateArtifact.bind(null, t.id, curriculum.id);
          const marker =
            status === "completed"
              ? "bg-brand text-white"
              : status === "needs_review"
                ? "bg-sun text-[#3b2200]"
                : status === "in_progress"
                  ? "bg-sky text-white"
                  : "bg-card text-ink-soft border-2 border-line-strong";
          return (
            <li key={t.id} className="relative flex gap-4 sm:gap-5">
              <span className={`relative z-10 mt-4 grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-black shadow-soft sm:h-13 sm:w-13 ${marker}`} aria-hidden>
                {status === "completed" ? <Check size={20} /> : t.position}
              </span>
              <div className="card min-w-0 flex-1">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-extrabold">{t.title}</h2>
                      <StatusBadge status={status} />
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">{t.description}</p>
                    {p && p.status !== "not_started" ? <MasteryBar value={Number(p.mastery)} showLabel className="mt-3 max-w-sm" /> : null}
                    {objs.length ? (
                      <details className="group mt-3">
                        <summary className="inline-flex cursor-pointer items-center gap-1 text-sm font-bold text-brand-deep select-none">
                          <ChevronDown size={14} className="transition group-open:rotate-180" />
                          {objs.length} learning objective{objs.length === 1 ? "" : "s"}
                        </summary>
                        <ul className="mt-2 space-y-1.5 rounded-xl bg-paper p-3">
                          {objs.map((o) => {
                            const m = masteryByObjective.get(o.id);
                            return (
                              <li key={o.id} className="flex items-center justify-between gap-3 text-sm">
                                <span>{o.text}</span>
                                <StatusBadge status={m?.status ?? "unknown"} />
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    ) : null}
                    <p className="mt-3 text-xs text-ink-faint">
                      {art ? (
                        <>
                          Lesson v{art.version}
                          {art.status !== "published" ? ` · ${art.status}` : ""}
                          {art.used_fallback ? " · standard player" : ""}
                        </>
                      ) : (
                        "Lesson is built the first time it is opened."
                      )}
                    </p>
                    {art?.status === "failed" ? <p className="mt-1 text-xs font-bold text-berry">Last generation failed: {art.error}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Link href={`/learn/${c.id}/topics/${t.id}`} className="btn-secondary btn-sm">
                      <Play size={13} />
                      Preview
                    </Link>
                    {art?.status === "published" && !canRegenerate ? null : (
                      <form action={regen}>
                        <button type="submit" className="btn-ghost btn-sm" disabled={art?.status === "generating"}>
                          <Refresh size={14} className={art?.status === "generating" ? "animate-spin" : ""} />
                          {art?.status === "published" ? "Regenerate" : art ? "Try again" : "Generate"}
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
