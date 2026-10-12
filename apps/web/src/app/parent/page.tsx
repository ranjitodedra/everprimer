import Link from "next/link";
import { redirect } from "next/navigation";
import type { ChildRow, TopicProgressRow } from "@eco/db";
import { ageFromBirth } from "@eco/contracts";
import { createChild, createSelfProfile, enterChildMode } from "@/app/actions";
import { BillingNotice, billingCode } from "@/components/billing-notice";
import { Play, Plus } from "@/components/icons";
import { Avatar, EmptyState, ListRow, PageHeader, RowContent } from "@/components/ui";
import { requireGrownup } from "@/lib/auth";
import { planFor } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { AddChildDialog } from "./add-child-dialog";
import { SelfProfileDialog } from "./self-profile-dialog";

function learnerAge(child: ChildRow): number | null {
  if (child.birth_year != null && child.birth_month != null) return ageFromBirth(child.birth_year, child.birth_month);
  return child.age;
}

function summary(child: ChildRow, done: number) {
  const age = learnerAge(child);
  const lessons = done ? `${done} ${done === 1 ? "lesson" : "lessons"} done` : "No lessons yet";
  return age ? `${age} years old, ${lessons.toLowerCase()}` : lessons;
}

export default async function ParentHome(props: PageProps<"/parent">) {
  const account = await requireGrownup();
  const sp = await props.searchParams;
  if (account.kind === "individual" && account.selfChildId) redirect(`/learn/${account.selfChildId}`);
  const supabase = await createClient();
  const [{ data }, { data: progress }] = await Promise.all([
    supabase.from("children").select("*").eq("kind", "child").order("created_at"),
    supabase.from("topic_progress").select("child_id, status"),
  ]);
  const children = (data ?? []) as ChildRow[];
  const completedByChild = new Map<string, number>();
  for (const p of (progress ?? []) as Pick<TopicProgressRow, "child_id" | "status">[]) if (p.status === "completed") completedByChild.set(p.child_id, (completedByChild.get(p.child_id) ?? 0) + 1);

  const plan = planFor(account.parent.tier);
  const atCap = children.length >= plan.childCap;

  return (
    <>
      <BillingNotice code={billingCode(sp.billing)} audience="grownup" />
      <PageHeader title="Your family" />

      {children.length === 0 ? (
        <EmptyState
          emoji="🌱"
          title="Who's learning?"
          body="Add a name and a birthday. Lessons are written for their age."
          action={<AddChildDialog action={createChild} triggerClassName="btn-primary btn-lg" />}
        />
      ) : (
        <ul className="list-group">
          {children.map((c) => {
            const enter = enterChildMode.bind(null, c.id);
            return (
              <li key={c.id} className="flex items-center">
                <Link href={`/parent/children/${c.id}`} className="list-row min-w-0 flex-1">
                  <RowContent leading={<Avatar emoji={c.avatar} id={c.id} size="md" />} title={c.display_name} subtitle={summary(c, completedByChild.get(c.id) ?? 0)} />
                </Link>
                {c.shared_device ? (
                  <form action={enter} className="pr-3">
                    <button type="submit" className="btn-primary btn-icon" aria-label={`Start learning as ${c.display_name}`}>
                      <Play size={16} className="ml-0.5" />
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ul className="list-group mt-6">
          {children.length > 0 ? (
            <li>
              {atCap ? (
                <ListRow href="/parent/settings" title="Add a child" subtitle={`The ${plan.name} plan includes ${plan.childCap === 1 ? "1 child" : `${plan.childCap} children`}. See plans.`} leading={<RowIcon />} />
              ) : (
                <AddChildDialog action={createChild} triggerClassName="list-row w-full text-left" trigger={<RowContent leading={<RowIcon />} title="Add a child" />} />
              )}
            </li>
          ) : null}
          <li>
            {account.selfChildId ? (
              <ListRow href={`/learn/${account.selfChildId}`} title="My own lessons" subtitle="Learn something yourself" leading={<RowIcon emoji="📖" />} />
            ) : (
              <SelfProfileDialog action={createSelfProfile} triggerClassName="list-row w-full text-left" trigger={<RowContent leading={<RowIcon emoji="📖" />} title="Learn something yourself" subtitle="Your own lessons, at your level" />} />
            )}
          </li>
      </ul>
    </>
  );
}

function RowIcon({ emoji }: { emoji?: string }) {
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-paper text-xl text-leaf" aria-hidden>
      {emoji ?? <Plus size={20} />}
    </span>
  );
}