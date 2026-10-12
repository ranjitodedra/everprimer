import { isKidMode, requireAccount } from "@/lib/auth";
import { LearnShell, type LearnExit } from "@/components/learn-shell";

/** Learner shell. Billing stays on the grown-up settings page; child logins and kid mode never see it. */
export default async function LearnLayout({ children }: LayoutProps<"/learn">) {
  const account = await requireAccount();
  const kidMode = await isKidMode();

  let exit: LearnExit;
  let homeHref = "/learn";
  if (account.kind === "child") {
    exit = { kind: "signout" };
    homeHref = `/learn/${account.childId}`;
  } else if (kidMode) {
    exit = { kind: "grownups" };
  } else if (account.kind === "individual" && account.selfChildId) {
    homeHref = `/learn/${account.selfChildId}`;
    exit = { kind: "account", href: `/parent/children/${account.selfChildId}`, label: "Goals and progress", settingsHref: "/parent/settings" };
  } else {
    exit = { kind: "account", href: "/parent", label: account.kind === "individual" ? "Account" : "Parent area", settingsHref: account.kind === "individual" ? "/parent/settings" : undefined };
  }

  return (
    <LearnShell exit={exit} homeHref={homeHref}>
      {children}
    </LearnShell>
  );
}
