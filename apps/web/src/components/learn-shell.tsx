"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { exitChildMode, signOut } from "@/app/actions";
import { Lock, LogOut, Settings } from "./icons";
import { EverprimerMark } from "./logo";
import { Sheet } from "./sheet";

export type LearnExit =
  | { kind: "grownups" }
  | { kind: "signout" }
  | { kind: "account"; href: string; label: string; settingsHref?: string };

/** Learner chrome: a home mark and one exit. Lessons get the whole screen. */
export function LearnShell({ exit, homeHref, children }: { exit: LearnExit; homeHref: string; children: ReactNode }) {
  const pathname = usePathname();
  if (/^\/learn\/[^/]+\/topics\//.test(pathname)) return <>{children}</>;

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <header className="relative z-10 mx-auto flex w-full max-w-4xl items-center justify-between px-5 pt-[max(0.75rem,env(safe-area-inset-top,0px))]">
        <Link href={homeHref} className="press -ml-1 grid h-12 w-12 place-items-center rounded-full" aria-label="Home">
          <EverprimerMark className="h-9 w-9" />
        </Link>
        <Exit exit={exit} />
      </header>
      <main className="relative mx-auto w-full max-w-4xl flex-1 px-5 pt-2 pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))]">{children}</main>
    </div>
  );
}

function Exit({ exit }: { exit: LearnExit }) {
  if (exit.kind === "grownups") {
    return (
      <form action={exitChildMode}>
        <button type="submit" className="btn-ghost btn-icon text-current/60" aria-label="Grown-ups">
          <Lock size={20} />
        </button>
      </form>
    );
  }
  if (exit.kind === "signout") {
    return (
      <form action={signOut}>
        <button type="submit" className="btn-ghost btn-icon text-current/60" aria-label="Sign out">
          <LogOut size={20} />
        </button>
      </form>
    );
  }
  return (
    <Sheet trigger={<Settings size={20} />} triggerLabel="Menu" triggerClassName="btn-ghost btn-icon text-current/60" title="Menu">
      <div className="list-group">
        <Link href={exit.href} className="list-row font-semibold">{exit.label}</Link>
        {exit.settingsHref ? <Link href={exit.settingsHref} className="list-row font-semibold">Settings</Link> : null}
      </div>
    </Sheet>
  );
}
