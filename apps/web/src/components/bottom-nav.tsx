"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { enterKidMode } from "@/app/actions";
import { Book, Chart, Play, Settings, Users } from "./icons";

const TAB = "press flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold";

function Bar({ children }: { children: ReactNode }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 bg-paper/90 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-1px_0_var(--color-line)] backdrop-blur-xl sm:hidden"
    >
      <div className="mx-auto flex max-w-md items-stretch px-4 pt-1">{children}</div>
    </nav>
  );
}

function TabLink({ href, label, icon, active }: { href: string; label: string; icon: ReactNode; active: boolean }) {
  return (
    <Link href={href} className={`${TAB} ${active ? "text-leaf" : "text-ink-faint"}`} aria-current={active ? "page" : undefined}>
      {icon}
      {label}
    </Link>
  );
}

/** Phone tab bar for grown-ups. Sign out lives in Settings, never one tap away. */
export function ParentBottomNav({ kind, selfChildId }: { kind: "individual" | "parent"; selfChildId: string | null }) {
  const pathname = usePathname();
  const inSettings = pathname.startsWith("/parent/settings");
  if (kind === "individual") {
    return (
      <Bar>
        {selfChildId ? <TabLink href={`/learn/${selfChildId}`} label="Learn" icon={<Book size={24} />} active={false} /> : null}
        {selfChildId ? <TabLink href={`/parent/children/${selfChildId}`} label="Progress" icon={<Chart size={24} />} active={!inSettings} /> : null}
        <TabLink href="/parent/settings" label="Settings" icon={<Settings size={24} />} active={inSettings} />
      </Bar>
    );
  }
  return (
    <Bar>
      <TabLink href="/parent" label="Family" icon={<Users size={24} />} active={!inSettings} />
      <form action={enterKidMode} className="flex flex-1">
        <button type="submit" className={`${TAB} text-ink`}>
          <span className="grid h-7 w-12 place-items-center rounded-full bg-leaf text-white">
            <Play size={14} />
          </span>
          Kid mode
        </button>
      </form>
      <TabLink href="/parent/settings" label="Settings" icon={<Settings size={24} />} active={inSettings} />
    </Bar>
  );
}
