import Link from "next/link";
import { requireGrownup } from "@/lib/auth";
import { enterKidMode, signOut } from "@/app/actions";
import { ParentBottomNav } from "@/components/bottom-nav";
import { Book, LogOut, Play, Settings } from "@/components/icons";
import { EverprimerMark, Wordmark } from "@/components/logo";

export default async function ParentLayout({ children }: LayoutProps<"/parent">) {
  const account = await requireGrownup();
  const individual = account.kind === "individual";
  const myLearning = account.selfChildId ? `/learn/${account.selfChildId}` : null;
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-line/80 bg-paper/85 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:py-3.5">
          <Link href={individual && myLearning ? myLearning : "/parent"} className="flex items-center gap-2.5 rounded-full pr-2">
            <EverprimerMark className="h-9 w-9" />
            <Wordmark className="text-lg sm:text-xl" />
          </Link>
          <nav className="hidden items-center gap-1 text-sm sm:flex">
            {myLearning ? (
              <Link href={myLearning} className="btn-ghost btn-sm">
                <Book size={14} />
                My learning
              </Link>
            ) : null}
            <Link href="/parent/settings" className="btn-ghost btn-sm btn-icon" title="Settings" aria-label="Settings">
              <Settings size={16} />
            </Link>
            {individual ? null : (
              <form action={enterKidMode}>
                <button type="submit" className="btn-primary btn-sm !px-3.5" aria-label="Switch to kid mode">
                  <Play size={14} />
                  Kid mode
                </button>
              </form>
            )}
            <form action={signOut}>
              <button type="submit" className="btn-ghost btn-sm btn-icon" title={`Sign out ${account.user.email ?? ""}`} aria-label="Sign out">
                <LogOut size={16} />
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 sm:py-8 lg:py-10">{children}</main>
      <footer className="mx-auto hidden w-full max-w-5xl px-4 pb-8 text-xs text-ink-faint sm:block">
        {individual ? "Everprimer only stores what lessons need." : "Everprimer only stores what lessons need. Nothing here is shown to your child."}
      </footer>
      <ParentBottomNav kind={account.kind} myLearning={myLearning} />
    </div>
  );
}
