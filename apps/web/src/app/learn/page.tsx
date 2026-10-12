import Link from "next/link";
import { redirect } from "next/navigation";
import type { ChildRow } from "@eco/db";
import { enterChildMode } from "@/app/actions";
import { EmptyState, fieldFor } from "@/components/ui";
import { homeFor, requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Shared-device picker. Child logins and individuals go straight to their own home. */
export default async function LearnHome() {
  const account = await requireAccount();
  if (account.kind !== "parent") redirect(homeFor(account));

  const supabase = await createClient();
  const { data } = await supabase.from("children").select("*").eq("kind", "child").eq("shared_device", true).order("created_at");
  const children = (data ?? []) as ChildRow[];

  if (children.length === 0) {
    return (
      <EmptyState
        emoji="🌱"
        title="No one here yet"
        body="Add a child in the grown-up area."
        action={<Link href="/parent" className="btn-primary">Grown-up area</Link>}
      />
    );
  }

  return (
    <div className="pt-6 sm:pt-12">
      <h1 className="display text-center text-5xl sm:text-6xl">Who&apos;s learning?</h1>
      <ul className={`mx-auto mt-10 grid max-w-2xl gap-4 ${children.length === 1 ? "max-w-[12rem] grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
        {children.map((c, i) => {
          const enter = enterChildMode.bind(null, c.id);
          return (
            <li key={c.id} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
              <form action={enter}>
                <button type="submit" className={`press field ${fieldFor(c.id)} flex aspect-[4/5] w-full flex-col items-center justify-center gap-4 rounded-[2rem]`}>
                  <span className="text-7xl" aria-hidden>{c.avatar}</span>
                  <span className="display text-2xl">{c.display_name}</span>
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
