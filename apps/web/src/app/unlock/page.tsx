import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import { Lock } from "@/components/icons";
import { EverprimerMark, Wordmark } from "@/components/logo";
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
    <main className="kid-sky flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <EverprimerMark className="h-10 w-10" />
        <Wordmark className="text-2xl" />
      </div>
      <div className="card w-full max-w-md p-5 shadow-lift sm:p-7">
        <div className="mb-4 flex items-center gap-3">
          <span className="tile h-11 w-11 bg-brand-soft text-brand-deep">
            <Lock size={20} />
          </span>
          <div>
            <h1 className="text-xl font-black">Grown-up PIN</h1>
            <p className="text-sm text-ink-soft">This keeps the parent area closed while someone is learning.</p>
          </div>
        </div>
        <UnlockForm next={next} />
        <form action={signOut} className="mt-5 text-center">
          <button type="submit" className="text-sm font-bold text-ink-soft underline-offset-2 hover:underline">
            Forgot the PIN? Sign out and use your password.
          </button>
        </form>
      </div>
    </main>
  );
}
