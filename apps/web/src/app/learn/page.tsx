import Link from "next/link";
import { redirect } from "next/navigation";
import type { ChildRow } from "@eco/db";
import { enterChildMode } from "@/app/actions";
import { Avatar } from "@/components/ui";
import { homeFor, requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Shared-device picker. Child logins and individuals go straight to their own home. */
export default async function LearnHome() {
  const account = await requireAccount();
  if (account.kind !== "parent") redirect(homeFor(account));

  const supabase = await createClient();
  const { data } = await supabase.from("children").select("*").eq("kind", "child").eq("shared_device", true).order("created_at");
  const children = (data ?? []) as ChildRow[];

  return (
    <div className="py-8">
      <p className="eyebrow mb-2 flex justify-center">Kid mode</p>
      <h1 className="mb-10 text-center text-4xl font-black tracking-tight sm:text-5xl">Who is learning today?</h1>
      {children.length === 0 ? (
        <p className="text-center text-ink-soft">
          No children on this device yet.{" "}
          <Link href="/parent" className="link">
            Add one in the grown-up area.
          </Link>
        </p>
      ) : (
        <ul className="mx-auto flex max-w-2xl flex-wrap justify-center gap-4">
          {children.map((c, i) => {
            const enter = enterChildMode.bind(null, c.id);
            return (
              <li key={c.id} className="animate-pop w-[calc(50%-0.5rem)] sm:w-44" style={{ animationDelay: `${i * 70}ms` }}>
                <form action={enter}>
                  <button type="submit" className="card card-hover flex w-full flex-col items-center gap-4 py-8 hover:border-brand/50 active:translate-y-0.5">
                    <Avatar emoji={c.avatar} size="xl" />
                    <span className="text-xl font-black">{c.display_name}</span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
