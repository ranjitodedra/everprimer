import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { ParentRow } from "@eco/db";
import { KID_MODE_COOKIE } from "@/lib/kid-mode";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export type ChildAccount = { kind: "child"; user: User; childId: string };
export type AdultAccount = { kind: ParentRow["kind"]; user: User; parent: ParentRow; selfChildId: string | null };
export type Account = ChildAccount | AdultAccount;

const PARENT_COLUMNS = "id, email, tier, timezone, kind, tutor_enabled, credit_balance, created_at";

export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** Child logins carry `account` and `child_id` in app_metadata, which only the service role can set. */
export function childIdOf(user: Pick<User, "app_metadata">): string | null {
  const meta = user.app_metadata as { account?: string; child_id?: string } | undefined;
  return meta?.account === "child" && meta.child_id ? meta.child_id : null;
}

export async function getParent(userId: string): Promise<ParentRow> {
  const supabase = await createClient();
  const { data } = await supabase.from("parents").select(PARENT_COLUMNS).eq("id", userId).maybeSingle();
  if (data) return data as ParentRow;
  // The trigger creates this row on signup; tolerate a race on first request.
  return { id: userId, email: null, tier: "free", timezone: "UTC", kind: "parent", tutor_enabled: false, credit_balance: 0, created_at: new Date().toISOString() };
}

export const getAccount = cache(async (): Promise<Account | null> => {
  const user = await getUser();
  if (!user) return null;
  const childId = childIdOf(user);
  if (childId) return { kind: "child", user, childId };

  const supabase = await createClient();
  const [parent, { data: self }] = await Promise.all([
    getParent(user.id),
    supabase.from("children").select("id").eq("parent_id", user.id).eq("kind", "self").maybeSingle(),
  ]);
  return { kind: parent.kind, user, parent, selfChildId: (self?.id as string | undefined) ?? null };
});

export async function requireAccount(): Promise<Account> {
  const account = await getAccount();
  if (!account) redirect("/login");
  return account;
}

/** Where an account lands after sign-in. */
export function homeFor(account: Account): string {
  if (account.kind === "child") return `/learn/${account.childId}`;
  if (account.kind === "individual" && account.selfChildId) return `/learn/${account.selfChildId}`;
  return "/parent";
}

/** The PIN hash is service-role only; this exposes just whether one is set. */
export async function hasGrownupPin(userId: string): Promise<boolean> {
  const { data } = await createServiceClient().from("parents").select("grownup_pin_hash").eq("id", userId).maybeSingle();
  return !!data?.grownup_pin_hash;
}

export async function isKidMode(): Promise<boolean> {
  return (await cookies()).has(KID_MODE_COOKIE);
}

/** Adults outside kid mode only: parent UI, billing, profile and curriculum edits. */
export async function requireGrownup(): Promise<AdultAccount> {
  const account = await requireAccount();
  if (account.kind === "child") redirect(`/learn/${account.childId}`);
  if (await isKidMode()) redirect("/unlock");
  return account;
}

/** A child login may only open its own learn pages. */
export async function requireLearner(childId: string): Promise<Account> {
  const account = await requireAccount();
  if (account.kind === "child" && account.childId !== childId) redirect(`/learn/${account.childId}`);
  return account;
}
