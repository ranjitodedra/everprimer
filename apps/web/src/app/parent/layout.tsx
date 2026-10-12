import Link from "next/link";
import { requireGrownup } from "@/lib/auth";
import { enterKidMode } from "@/app/actions";
import { ParentBottomNav } from "@/components/bottom-nav";
import { Play } from "@/components/icons";
import { EverprimerMark, Wordmark } from "@/components/logo";

export default async function ParentLayout({ children }: LayoutProps<"/parent">) {
  const account = await requireGrownup();
  const individual = account.kind === "individual";
  const selfId = account.selfChildId ?? null;
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 bg-paper/85 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-5 sm:h-16">
          <Link href={individual && selfId ? `/learn/${selfId}` : "/parent"} className="press flex items-center gap-2 rounded-full pr-2">
            <EverprimerMark className="h-8 w-8" />
            <Wordmark className="text-lg" />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
            {individual ? (
              <>
                {selfId ? (
                  <>
                    <Link href={`/learn/${selfId}`} className="btn-ghost btn-sm">Learn</Link>
                    <Link href={`/parent/children/${selfId}`} className="btn-ghost btn-sm">Progress</Link>
                  </>
                ) : null}
                <Link href="/parent/settings" className="btn-ghost btn-sm">Settings</Link>
              </>
            ) : (
              <>
                <Link href="/parent" className="btn-ghost btn-sm">Family</Link>
                <Link href="/parent/settings" className="btn-ghost btn-sm">Settings</Link>
                <form action={enterKidMode} className="ml-2">
                  <button type="submit" className="btn-primary btn-sm">
                    <Play size={13} />
                    Kid mode
                  </button>
                </form>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] sm:pt-10 sm:pb-16">{children}</main>
      <ParentBottomNav kind={account.kind} selfChildId={selfId} />
    </div>
  );
}
