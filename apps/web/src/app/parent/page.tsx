import Link from "next/link";
import { redirect } from "next/navigation";
import type { ChildRow, CurriculumRow, TopicProgressRow } from "@eco/db";
import { ageFromBirth } from "@eco/contracts";
import { createChild, createSelfProfile, enterChildMode } from "@/app/actions";
import { BillingNotice, billingCode } from "@/components/billing-notice";
import { Book, ChevronRight, Play, Users } from "@/components/icons";
import { Avatar, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { requireGrownup } from "@/lib/auth";
import { planFor } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { AddChildDialog } from "./add-child-dialog";
import { SelfProfileDialog } from "./self-profile-dialog";

function readingLabel(level: string | null) {
  return level ? `${level.replace("_", " ")} reader` : null;
}

function learnerAge(child: ChildRow): number | null {
  if (child.birth_year != null && child.birth_month != null) return ageFromBirth(child.birth_year, child.birth_month);
  return child.age;
}

export default async function ParentHome(props: PageProps<"/parent">) {
  const account = await requireGrownup();
  const sp = await props.searchParams;
  if (account.kind === "individual" && account.selfChildId) redirect(`/learn/${account.selfChildId}`);
  const supabase = await createClient();
  const [{ data }, { data: curricula }, { data: progress }] = await Promise.all([
    supabase.from("children").select("*").eq("kind", "child").order("created_at"),
    supabase.from("curricula").select("id, child_id, status").order("created_at"),
    supabase.from("topic_progress").select("child_id, status"),
  ]);
  const children = (data ?? []) as ChildRow[];
  const curriculaByChild = new Map<string, number>();
  for (const c of (curricula ?? []) as Pick<CurriculumRow, "id" | "child_id" | "status">[]) curriculaByChild.set(c.child_id, (curriculaByChild.get(c.child_id) ?? 0) + 1);
  const completedByChild = new Map<string, number>();
  for (const p of (progress ?? []) as Pick<TopicProgressRow, "child_id" | "status">[]) if (p.status === "completed") completedByChild.set(p.child_id, (completedByChild.get(p.child_id) ?? 0) + 1);

  const plan = planFor(account.parent.tier);
  const atCap = children.length >= plan.childCap;

  return (
    <>
      <BillingNotice code={billingCode(sp.billing)} audience="grownup" />
      <PageHeader eyebrow="Your family" title="Children" description="Each child gets their own curricula, progress and daily summaries." />

      <div>
        <section>
          <SectionTitle hint={children.length ? `${children.length} ${children.length === 1 ? "learner" : "learners"}` : undefined}>Learners</SectionTitle>
          {children.length === 0 ? (
            <EmptyState icon={<Users size={22} />} title="Add your first child" body="Start with a name and birthday. You can add interests afterwards so lessons feel familiar to them." />
          ) : (
            <ul className="space-y-3">
              {children.map((c, i) => {
                const enter = enterChildMode.bind(null, c.id);
                const age = learnerAge(c);
                const meta = [age ? `Age ${age}` : "Age not set", readingLabel(c.reading_level)].filter(Boolean).join(" · ");
                const n = curriculaByChild.get(c.id) ?? 0;
                const done = completedByChild.get(c.id) ?? 0;
                return (
                  <li key={c.id} className="card card-hover animate-rise flex flex-wrap items-center gap-4" style={{ animationDelay: `${i * 40}ms` }}>
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      <Avatar emoji={c.avatar} size="lg" />
                      <div className="min-w-0">
                        <h3 className="text-lg font-extrabold">{c.display_name}</h3>
                        <p className="text-sm text-ink-soft">{meta}</p>
                        <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-ink-soft">
                          <span className="inline-flex items-center gap-1.5"><Book size={14} className="text-brand" />{n} {n === 1 ? "curriculum" : "curricula"}</span>
                          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand" />{done} {done === 1 ? "topic" : "topics"} completed</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Link href={`/parent/children/${c.id}`} className="btn-secondary">
                        Manage
                        <ChevronRight size={16} />
                      </Link>
                      {c.shared_device ? (
                        <form action={enter}>
                          <button type="submit" className="btn-primary">
                            <Play size={14} />
                            Start learning
                          </button>
                        </form>
                      ) : (
                        <span className="badge bg-paper-deep text-ink-soft">Uses their own login</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-8 space-y-3">
            {account.selfChildId ? (
              <div className="card flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm text-ink-soft">You have your own learner profile.</p>
                <div className="flex gap-2">
                  <Link href={`/parent/children/${account.selfChildId}`} className="btn-secondary">
                    Manage
                    <ChevronRight size={16} />
                  </Link>
                  <Link href={`/learn/${account.selfChildId}`} className="btn-primary">
                    <Book size={14} />
                    My learning
                  </Link>
                </div>
              </div>
            ) : (
              <SelfProfileDialog action={createSelfProfile} />
            )}
            {atCap ? (
              <div className="card flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm text-ink-soft">The {plan.name} plan includes {plan.childCap === 1 ? "1 child profile" : `${plan.childCap} child profiles`}. Profiles you already added stay.</p>
                <Link href="/parent/settings" className="btn-primary shrink-0">View plans</Link>
              </div>
            ) : (
              <AddChildDialog action={createChild} />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
