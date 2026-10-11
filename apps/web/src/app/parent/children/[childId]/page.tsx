import Link from "next/link";
import { notFound } from "next/navigation";
import { ageFromBirth } from "@eco/contracts";
import type { ChildRow, CurriculumRow, MemoryRow, PersonalizationRow, TopicProgressRow, TopicRow } from "@eco/db";
import { createCurriculum, enterChildMode, removeContext, removeMemory, setLearnerBirth } from "@/app/actions";
import { Book, Chart, ChevronRight, Play, Sparkles, X } from "@/components/icons";
import { BillingNotice, billingCode } from "@/components/billing-notice";
import { GoalDialog } from "@/components/goal-dialog";
import { Avatar, EmptyState, PageHeader, ProgressRing, SectionTitle, StatusBadge } from "@/components/ui";
import { requireGrownup } from "@/lib/auth";
import { lessonFinished } from "@/lib/lesson-progress";
import { createClient } from "@/lib/supabase/server";
import { BirthdayCard } from "./birthday-card";
import { ChildAccess } from "./child-access";

export default async function ChildPage(props: PageProps<"/parent/children/[childId]">) {
  await requireGrownup();
  const { childId } = await props.params;
  const sp = await props.searchParams;
  const supabase = await createClient();

  const [{ data: child }, { data: ctx }, { data: memories }, { data: curricula }, { data: progress }, { data: login }] = await Promise.all([
    supabase.from("children").select("*").eq("id", childId).maybeSingle(),
    supabase.from("personalization_context").select("*").eq("child_id", childId).eq("active", true).order("created_at"),
    supabase.from("learner_memories").select("*").eq("child_id", childId).eq("active", true).eq("source", "inferred").order("last_seen_at", { ascending: false }),
    supabase.from("curricula").select("*").eq("child_id", childId).order("created_at", { ascending: false }),
    supabase.from("topic_progress").select("*").eq("child_id", childId),
    supabase.from("child_logins").select("username").eq("child_id", childId).maybeSingle(),
  ]);
  if (!child) notFound();
  const c = child as ChildRow;
  const isSelf = c.kind === "self";
  const context = (ctx ?? []) as PersonalizationRow[];
  const remembered = (memories ?? []) as MemoryRow[];
  const age = c.birth_year != null && c.birth_month != null ? ageFromBirth(c.birth_year, c.birth_month) : c.age;
  const curriculumRows = (curricula ?? []) as CurriculumRow[];
  const progressRows = (progress ?? []) as TopicProgressRow[];

  const { data: topics } = curriculumRows.length
    ? await supabase.from("topics").select("id, curriculum_id").eq("kind", "lesson").in("curriculum_id", curriculumRows.map((cur) => cur.id))
    : { data: [] };
  const topicsByCurriculum = new Map<string, string[]>();
  for (const t of (topics ?? []) as Pick<TopicRow, "id" | "curriculum_id">[]) topicsByCurriculum.set(t.curriculum_id, [...(topicsByCurriculum.get(t.curriculum_id) ?? []), t.id]);
  const scopeLabel: Record<CurriculumRow["scope"], string> = { overview: "Quick overview", hobby: "For fun", exam: "Test prep", mastery: "Deep mastery" };
  const progressByTopic = new Map(progressRows.map((p) => [p.topic_id, p]));

  const completed = progressRows.filter((p) => p.status === "completed").length;
  const needsReview = progressRows.filter((p) => p.status === "needs_review").length;
  const meta = [age ? `Age ${age}` : "Age not set", c.reading_level ? `${c.reading_level.replace("_", " ")} reader` : null].filter(Boolean).join(" · ");

  const enter = enterChildMode.bind(null, c.id);
  const saveBirth = setLearnerBirth.bind(null, c.id);
  const newCurriculum = createCurriculum.bind(null, c.id);
  const memoryLabel: Record<MemoryRow["kind"], string> = {
    interest: "Interest",
    preference: "Preference",
    strength: "Strength",
    misconception: "Misconception",
    analogy_that_worked: "Analogy",
  };

  return (
    <>
      <BillingNotice code={billingCode(sp.billing)} audience="grownup" />
      <PageHeader
        eyebrow={isSelf ? "Your learning" : "Child"}
        leading={<Avatar emoji={c.avatar} size="lg" className="mt-1" />}
        title={c.display_name}
        description={`${meta} · ${completed} topic${completed === 1 ? "" : "s"} completed${needsReview ? ` · ${needsReview} to review` : ""}`}
        actions={
          <>
            <Link href={`/parent/children/${c.id}/report`} className="btn-secondary">
              <Chart size={16} />
              Daily summary
            </Link>
            {isSelf ? (
              <Link href={`/learn/${c.id}`} className="btn-primary">
                <Play size={14} />
                Start learning
              </Link>
            ) : c.shared_device ? (
              <form action={enter}>
                <button type="submit" className="btn-primary">
                  <Play size={14} />
                  Open kid mode
                </button>
              </form>
            ) : null}
          </>
        }
      />

      <div className="flex w-full flex-col gap-6">
          <section>
            <SectionTitle hint="Every goal becomes an ordered set of lessons.">Curricula</SectionTitle>
            {curriculumRows.length === 0 ? (
              <EmptyState icon={<Book size={22} />} title="No curriculum yet" body="Describe what you'd like them to learn and we'll turn it into an ordered set of lessons." />
            ) : (
              <ul className="space-y-3">
                {curriculumRows.map((cur) => {
                  const ids = topicsByCurriculum.get(cur.id) ?? [];
                  const done = ids.filter((id) => lessonFinished(progressByTopic.get(id))).length;
                  const pct = ids.length ? done / ids.length : 0;
                  return (
                    <li key={cur.id}>
                      <Link href={`/parent/curricula/${cur.id}`} className="card card-hover flex items-center gap-4">
                        <ProgressRing value={pct} size={52} stroke={5}>
                          <span className="text-xs font-black tabular-nums text-brand-deep">{ids.length ? `${done}/${ids.length}` : "…"}</span>
                        </ProgressRing>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-extrabold">{cur.title || "Preparing…"}</h3>
                            <StatusBadge status={cur.status} />
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-sm text-ink-soft">{cur.description || cur.goal_text}</p>
                          <p className="mt-1 text-xs font-bold text-ink-faint">
                            {scopeLabel[cur.scope]}
                            {cur.interest ? ` · examples from ${cur.interest}` : ""}
                          </p>
                        </div>
                        <ChevronRight size={18} className="text-ink-faint" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <GoalDialog action={newCurriculum} self={isSelf} />

          {isSelf ? null : <ChildAccess childId={c.id} sharedDevice={c.shared_device} username={(login?.username as string | undefined) ?? null} />}
          <BirthdayCard action={saveBirth} birthMonth={c.birth_month} birthYear={c.birth_year} age={age} />
          <section className="card">
            <div className="mb-1 flex items-center gap-2">
              <Sparkles size={16} className="text-brand" />
              <h2 className="font-extrabold">Remembered</h2>
            </div>
            <p className="mb-4 text-sm text-ink-soft">
              Background for planning lessons: things you told us earlier, plus notes Plus and Max keep after each lesson. They shape the next lesson, not ones already published. Learners never see this list.
            </p>
            <ul className="mb-1 space-y-2">
              {remembered.length === 0 && context.length === 0 ? <li className="text-sm text-ink-faint">Nothing yet.</li> : null}
              {context.map((item) => {
                const remove = removeContext.bind(null, c.id, item.id);
                return (
                  <li key={item.id} className="flex items-start gap-2 rounded-xl bg-paper-deep px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold tracking-wide text-ink-faint uppercase">{item.kind === "interest" ? "You told us: likes" : "You told us"}</p>
                      <p className="text-sm font-semibold">{item.value}</p>
                    </div>
                    <form action={remove}>
                      <button type="submit" aria-label={`Remove ${item.value}`} className="grid h-7 w-7 place-items-center rounded-full transition hover:bg-black/10">
                        <X size={14} />
                      </button>
                    </form>
                  </li>
                );
              })}
              {remembered.map((item) => {
                const remove = removeMemory.bind(null, c.id, item.id);
                return (
                  <li key={item.id} className="flex items-start gap-2 rounded-xl bg-paper-deep px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold tracking-wide text-ink-faint uppercase">{memoryLabel[item.kind]}</p>
                      <p className="text-sm font-semibold">{item.value}</p>
                    </div>
                    <form action={remove}>
                      <button type="submit" aria-label={`Remove ${item.value}`} className="grid h-7 w-7 place-items-center rounded-full transition hover:bg-black/10">
                        <X size={14} />
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </section>
      </div>
    </>
  );
}
