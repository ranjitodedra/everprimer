"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { enterKidMode, exitChildMode, signOut } from "@/app/actions";
import { Book, Home, Lock, LogOut, Play, Users, Wrench } from "./icons";

const TAB = "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[0.6875rem] font-extrabold transition active:scale-95";

function Bar({ children }: { children: ReactNode }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/80 bg-card/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md sm:hidden"
    >
      <div className="mx-auto flex max-w-md items-stretch px-2">{children}</div>
    </nav>
  );
}

function TabLink({ href, label, icon, active }: { href: string; label: string; icon: ReactNode; active: boolean }) {
  return (
    <Link href={href} className={`${TAB} ${active ? "text-brand" : "text-ink-soft"}`} aria-current={active ? "page" : undefined}>
      {icon}
      {label}
    </Link>
  );
}

function TabAction({ action, label, icon }: { action: () => Promise<void>; label: string; icon: ReactNode }) {
  return (
    <form action={action} className="flex flex-1">
      <button type="submit" className={`${TAB} text-ink-soft`}>
        {icon}
        {label}
      </button>
    </form>
  );
}

export function ParentBottomNav({ kind, myLearning }: { kind: "individual" | "parent"; myLearning: string | null }) {
  const pathname = usePathname();
  if (kind === "individual") {
    return (
      <Bar>
        {myLearning ? <TabLink href={myLearning} label="My learning" icon={<Book size={22} />} active={false} /> : null}
        <TabLink href="/parent/settings" label="Settings" icon={<Wrench size={22} />} active={pathname.startsWith("/parent/settings")} />
        <TabAction action={signOut} label="Sign out" icon={<LogOut size={22} />} />
      </Bar>
    );
  }
  return (
    <Bar>
      <TabLink href="/parent" label="Children" icon={<Users size={22} />} active={pathname === "/parent" || pathname.startsWith("/parent/children")} />
      <TabAction action={enterKidMode} label="Kid mode" icon={<Play size={22} />} />
      <TabLink href="/parent/settings" label="Settings" icon={<Wrench size={22} />} active={pathname.startsWith("/parent/settings")} />
      <TabAction action={signOut} label="Sign out" icon={<LogOut size={22} />} />
    </Bar>
  );
}

export type LearnExit = { kind: "grownups" } | { kind: "account"; href: string } | { kind: "signout" };

/**
 * `exit` is what the second tab does: the PIN-gated grown-up area on a shared
 * device, the account area for a learner's own profile, or sign out for a
 * child login.
 */
export function KidBottomNav({ exit, settingsHref }: { exit: LearnExit; settingsHref?: string }) {
  const pathname = usePathname();
  if (/^\/learn\/[^/]+\/topics\//.test(pathname)) return null;
  const childId = pathname.match(/^\/learn\/([^/]+)/)?.[1];
  return (
    <Bar>
      <TabLink href={childId ? `/learn/${childId}` : "/learn"} label="Home" icon={<Home size={22} />} active />
      {exit.kind === "signout" ? (
        <TabAction action={signOut} label="Sign out" icon={<LogOut size={22} />} />
      ) : exit.kind === "account" ? (
        <TabLink href={exit.href} label={settingsHref ? "Goals" : "Account"} icon={settingsHref ? <Book size={22} /> : <Wrench size={22} />} active={false} />
      ) : (
        <TabAction action={exitChildMode} label="Grown-ups" icon={<Lock size={22} />} />
      )}
      {settingsHref ? <TabLink href={settingsHref} label="Settings" icon={<Wrench size={22} />} active={pathname.startsWith("/parent/settings")} /> : null}
    </Bar>
  );
}
