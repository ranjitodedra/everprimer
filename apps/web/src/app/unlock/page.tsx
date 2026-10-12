import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import { Lock } from "@/components/icons";
import { isKidMode, requireAccount } from "@/lib/auth";
import { UnlockForm } from "./unlock-form";

export const metadata: Metadata = { title: "Grown-up PIN" };

export default async function UnlockPage(props: PageProps<"/unlock">) {
  const account = await requireAccount();
  if (account.kind === "child") redirect(`/learn/${account.childId}`);
  if (!(await isKidMode())) redirect("/parent");

  const sp = await props.searchParams;
  const raw = typeof sp.next === "string" ? sp.next : "/parent";
  const next = raw === "/parent" || raw.startsWith("/parent/") ? raw : "/parent";

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 pt-[max(2rem,env(safe-area-inset-top,0px))] pb-[max(2rem,env(safe-area-inset-bottom,0px))]">
      <div className="animate-rise w-full max-w-xs text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-mist text-ink" aria-hidden>
          <Lock size={24} />
        </span>
        <h1 className="display mt-5 text-[2.5rem]">Grown-ups only</h1>
        <p className="mt-2 mb-8 text-ink-soft">Enter your PIN.</p>
        <UnlockForm next={next} />
        <form action={signOut} className="mt-6">
          <button type="submit" className="btn-ghost btn-sm">
            Forgot it? Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
