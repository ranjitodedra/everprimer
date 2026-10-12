import Link from "next/link";
import { notFound } from "next/navigation";
import { ageFromBirth } from "@eco/contracts";
import type { ChildRow, CurriculumRow, MemoryRow, PersonalizationRow, TopicProgressRow, TopicRow } from "@eco/db";
import { createCurriculum, removeContext, removeMemory, setLearnerBirth } from "@/app/actions";
import { Chart, ChevronRight, X } from "@/components/icons";
import { BillingNotice, billingCode } from "@/components/billing-notice";
import { GoalDialog } from "@/components/goal-dialog";
import { Sheet } from "@/components/sheet";
import { Avatar, BackLink, ProgressLine, RowContent, StatusBadge, fieldFor } from "@/components/ui";
import { requireGrownup } from "@/lib/auth";
import { lessonFinished } from "@/lib/lesson-progress";
import { createClient } from "@/lib/supabase/server";
import { BirthdayCard } from "./birthday-card";
import { ChildAccess } from "./child-access";

const MEMORY_LABEL: Record<MemoryRow["kind"], string> = {
  interest: "Interest",
  preference: "Preference",
  strength: "Strength",
  misconception: "Mix-up",
  analogy_that_worked: "Comparison that clicked",
};

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
  const progressByTopic = new Map(progressRows.map((p) => [p.topic_id, p]));
  const needsReview = progressRows.filter((p) => p.status === "needs_review").length;

  const saveBirth = setLearnerBirth.bind(null, c.id);
  const newCurriculum = createCurriculum.bind(null, c.id);
  const memoryCount = context.length + remembered.length;

  return (
    <>
      <BillingNotice code={billingCode(sp.billing)} audience="grownup" />
      {isSelf ? null : <BackLink href="/parent">Family</BackLink>}

      <header className="mb-8 flex items-center gap-4 sm:gap-5">
        <Avatar emoji={c.avatar} id={c.id} size="xl" className="max-sm:h-20 max-sm:w-20 max-sm:text-5xl" />
        <div className="min-w-0 flex-1">
          <h1 className="display text-[2.5rem] break-words sm:text-6xl">{isSelf ? "Your progress" : c.display_name}</h1>
          <p className="mt-1 text-ink-soft">
            {age ? `${age} years old` : "Age not set"}
            {needsReview ? `, ${needsReview} to review` : ""}
          </p>
        </div>
      </header>

      <Link href={`/parent/children/${c.id}/report`} className="press mb-10 flex items-center gap-4 rounded-[1.5rem] bg-leaf-soft px-5 py-4 text-leaf-deep">
        <Chart size={22} />
        <span className="flex-1 font-semibold">{isSelf ? "Today's summary" : `How ${c.display_name} did today`}</span>
        <ChevronRight size={18} />
      </Link>

      <section aria-labelledby="learning_title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="learning_title" className="display text-2xl">Learning</h2>
          {curriculumRows.length ? <GoalDialog action={newCurriculum} self={isSelf} triggerClassName="btn-primary btn-sm" /> : null}
        </div>
        {curriculumRows.length === 0 ? (
          <div className="flex flex-col items-center rounded-[1.5rem] bg-mist px-6 py-10 text-center">
            <p className="max-w-xs text-ink-soft">{isSelf ? "What do you want to learn?" : `What should ${c.display_name} learn? Any topic works.`}</p>
            <div className="mt-5">
              <GoalDialog action={newCurriculum} self={isSelf} triggerClassName="btn-primary btn-lg" />
            </div>
          </div>
        ) : (
          <ul className="list-group">
            {curriculumRows.map((cur) => {
              const ids = topicsByCurriculum.get(cur.id) ?? [];
              const done = ids.filter((id) => lessonFinished(progressByTopic.get(id))).length;
              const settled = cur.status === "ready";
              return (
                <li key={cur.id}>
                  <Link href={`/parent/curricula/${cur.id}`} className="list-row">
                    <RowContent
                      leading={<span className={`field ${fieldFor(cur.id)} h-10 w-2 shrink-0 rounded-full`} aria-hidden />}
                      title={cur.status === "generating" || !cur.title ? cur.goal_text : cur.title}
                      subtitle={
                        ids.length && settled ? (
                          <span className="mt-2 flex items-center gap-3 text-leaf">
                            <ProgressLine value={done / ids.length} className="max-w-40" />
                            <span className="shrink-0 text-ink-soft tabular-nums">{done} of {ids.length}</span>
                          </span>
                        ) : (
                          <span className="mt-1 block">
                            <StatusBadge status={cur.status} />
                          </span>
                        )
                      }
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10" aria-labelledby="about_title">
        <h2 id="about_title" className="display mb-3 text-2xl">{isSelf ? "About you" : `About ${c.display_name}`}</h2>
        <ul className="list-group">
          <li>
            <BirthdayCard action={saveBirth} birthMonth={c.birth_month} birthYear={c.birth_year} age={age} />
          </li>
          {isSelf ? null : (
            <li>
              <ChildAccess childId={c.id} sharedDevice={c.shared_device} username={(login?.username as string | undefined) ?? null} />
            </li>
          )}
          <li>
            <Sheet
              triggerClassName="list-row w-full text-left"
              trigger={<RowContent title="What Everprimer remembers" trailing={<span className="text-ink-soft tabular-nums">{memoryCount}</span>} />}
              title="Remembered"
            >
              <p className="-mt-2 mb-5 text-ink-soft">
                What shapes the next lessons: things you told us and notes from past lessons. {isSelf ? "" : "Children never see this."}
              </p>
              {memoryCount === 0 ? (
                <p className="rounded-[1.25rem] bg-mist px-4 py-6 text-center text-ink-soft">Nothing yet.</p>
              ) : (
                <ul className="list-group">
                  {context.map((item) => (
                    <MemoryItem key={item.id} label={item.kind === "interest" ? "You said they like" : "You told us"} value={item.value} remove={removeContext.bind(null, c.id, item.id)} />
                  ))}
                  {remembered.map((item) => (
                    <MemoryItem key={item.id} label={MEMORY_LABEL[item.kind]} value={item.value} remove={removeMemory.bind(null, c.id, item.id)} />
                  ))}
                </ul>
              )}
            </Sheet>
          </li>
        </ul>
      </section>
    </>
  );
}

function MemoryItem({ label, value, remove }: { label: string; value: string; remove: () => Promise<void> }) {
  return (
    <li className="list-row">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold break-words">{value}</span>
        <span className="block text-sm text-ink-soft">{label}</span>
      </span>
      <form action={remove}>
        <button type="submit" aria-label={`Forget ${value}`} className="btn-ghost btn-icon -mr-2 text-ink-soft">
          <X size={16} />
        </button>
      </form>
    </li>
  );
}
