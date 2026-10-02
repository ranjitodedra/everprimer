"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { enterKidMode } from "@/app/actions";
import { parseBirth } from "@/lib/birth";
import { childPassword, isLocked, lockedUntil, Pin, Username } from "@/lib/child-login";
import { KID_MODE_COOKIE } from "@/lib/kid-mode";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const Credentials = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const Signup = z.discriminatedUnion("account_kind", [
  Credentials.extend({
    account_kind: z.literal("individual"),
    display_name: z.string().trim().min(1, "Tell us your name").max(40),
  }),
  Credentials.extend({
    account_kind: z.literal("parent"),
    adult: z.literal("on", { error: "Parent accounts are for adults 18 or older" }),
  }),
]);

export type AuthState = { error?: string; message?: string };

function safeNext(value: FormDataEntryValue | null): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = Credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.message };
  // Signing in with the account password proves a grown-up is here.
  (await cookies()).delete(KID_MODE_COOKIE);
  // Shared-device sign-in opens the kid picker. Individuals are sent home;
  // a parent without a grown-up PIN is sent to set one first.
  if (formData.get("intent") === "shared") await enterKidMode();
  redirect(safeNext(formData.get("next")));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = Signup.safeParse({
    account_kind: formData.get("account_kind"),
    email: formData.get("email"),
    password: formData.get("password"),
    display_name: formData.get("display_name") ?? undefined,
    adult: formData.get("adult") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const input = parsed.data;
  let metadata: Record<string, string> = { account_kind: "parent" };
  if (input.account_kind === "individual") {
    const birth = parseBirth(formData, { required: true, minAge: 13, maxAge: 120 });
    if (!birth.ok || !birth.birth) return { error: birth.ok ? "Enter a birth month and year." : birth.error };
    metadata = {
      account_kind: "individual",
      display_name: input.display_name,
      birth_year: String(birth.birth.birth_year),
      birth_month: String(birth.birth.birth_month),
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email: input.email, password: input.password, options: { data: metadata } });
  if (error) return { error: error.message };
  if (!data.session) return { message: "Check your email to confirm your account, then sign in." };

  if (input.account_kind === "individual") {
    const { data: self } = await supabase.from("children").select("id").eq("kind", "self").maybeSingle();
    redirect(self ? `/learn/${self.id}` : "/");
  }
  redirect("/parent");
}

const KidCredentials = z.object({ username: Username, pin: Pin });
const NO_MATCH = "That username and PIN don't match. Try again.";

/**
 * Child logins are resolved server-side: the username maps to a hidden auth
 * email and the PIN to a password only this server can derive. Failed tries
 * lock the login for a while.
 */
export async function signInChild(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = KidCredentials.safeParse({ username: formData.get("username"), pin: formData.get("pin") });
  if (!parsed.success) return { error: NO_MATCH };
  const { username, pin } = parsed.data;

  const db = createServiceClient();
  const { data: login } = await db
    .from("child_logins")
    .select("user_id, child_id, auth_email, failed_attempts, locked_until")
    .eq("username", username)
    .maybeSingle();
  if (!login) return { error: NO_MATCH };
  if (isLocked(login.locked_until)) return { error: "Too many tries. Wait 15 minutes or ask a grown-up to reset your PIN." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: login.auth_email, password: childPassword(login.user_id, pin) });
  if (error) {
    const failed = login.failed_attempts + 1;
    await db.from("child_logins").update({ failed_attempts: failed, locked_until: lockedUntil(failed) }).eq("user_id", login.user_id);
    return { error: NO_MATCH };
  }

  await db.from("child_logins").update({ failed_attempts: 0, locked_until: null }).eq("user_id", login.user_id);
  (await cookies()).delete(KID_MODE_COOKIE);
  redirect(`/learn/${login.child_id}`);
}
