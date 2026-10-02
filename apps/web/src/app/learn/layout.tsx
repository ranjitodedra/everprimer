import Link from "next/link";
import { exitChildMode, signOut } from "@/app/actions";
import { isKidMode, requireAccount } from "@/lib/auth";
import { KidBottomNav, type LearnExit } from "@/components/bottom-nav";
import { Lock, LogOut, Wrench } from "@/components/icons";
import { EverprimerMark, Wordmark } from "@/components/logo";

/** Learner shell. Billing stays on the grown-up settings page; child logins and kid mode never see it. */
export default async function LearnLayout({ children }: LayoutProps<"/learn">) {
  const account = await requireAccount();
  const kidMode = await isKidMode();

  let exit: LearnExit;
  let homeHref = "/learn";
  let settingsHref: string | undefined;
  if (account.kind === "child") {
    exit = { kind: "signout" };
    homeHref = `/learn/${account.childId}`;
  } else if (kidMode) {
    exit = { kind: "grownups" };
  } else {
    exit = { kind: "account", href: account.kind === "individual" && account.selfChildId ? `/parent/children/${account.selfChildId}` : "/parent" };
    if (account.kind === "individual" && account.selfChildId) homeHref = `/learn/${account.selfChildId}`;
    if (account.kind === "individual") settingsHref = "/parent/settings";
  }

  return (
    <div className="kid-sky flex min-h-full flex-1 flex-col text-[17px]">
      <header className="mx-auto w-full max-w-4xl px-4 pt-[max(1rem,env(safe-area-inset-top,0px))]">
        <div className="flex items-center justify-between gap-3 rounded-full border border-line/80 bg-card/80 py-2 pr-2 pl-3 shadow-soft backdrop-blur">
          <Link href={homeHref} className="flex items-center gap-2 rounded-full">
            <EverprimerMark className="h-9 w-9" />
            <Wordmark className="text-lg sm:text-xl" />
          </Link>
          <div className="hidden sm:block">
            {exit.kind === "signout" ? (
              <form action={signOut}>
                <button type="submit" className="btn-ghost btn-sm text-ink-soft">
                  <LogOut size={14} />
                  Sign out
                </button>
              </form>
            ) : exit.kind === "account" ? (
              <span className="flex items-center gap-1">
                {settingsHref ? (
                  <Link href={settingsHref} className="btn-ghost btn-sm text-ink-soft">
                    Settings
                  </Link>
                ) : null}
                <Link href={exit.href} className="btn-ghost btn-sm text-ink-soft">
                  <Wrench size={14} />
                  {account.kind === "individual" ? "Goals and reports" : "Parent area"}
                </Link>
              </span>
            ) : (
              <form action={exitChildMode}>
                <button type="submit" className="btn-ghost btn-sm text-ink-soft" aria-label="Switch to parent mode">
                  <Lock size={14} />
                  For grown-ups
                </button>
              </form>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-6 pb-28 sm:pb-20">{children}</main>
      <KidBottomNav exit={exit} settingsHref={settingsHref} />
    </div>
  );
}
