"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GoalInput, ReadingLevel } from "@eco/contracts";
import { parseBirth } from "@/lib/birth";
import { hasGrownupPin, isKidMode, requireAccount, requireGrownup } from "@/lib/auth";
import { childPassword, hashPin, isLocked, lockedUntil, newChildAuthUser, Pin, Username, verifyPin } from "@/lib/child-login";
import { retryCurriculumJob, startArtifactJob, startCurriculumJob } from "@/lib/credits";
import { kickJob } from "@/lib/jobs";
import { planFor } from "@/lib/plans";
import { KID_MODE_COOKIE, KID_MODE_COOKIE_OPTIONS } from "@/lib/kid-mode";
import { buildDailyReport, todayIso } from "@/lib/report";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export type FormState = { error?: string; message?: string };

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input";
}

/* ---------------- children ---------------- */

const ChildInput = z.object({
  display_name: z.string().trim().min(1).max(40),
  reading_level: ReadingLevel.nullable(),
  avatar: z.string().max(8).default("🙂"),
});

export async function createChild(formData: FormData) {
  const account = await requireGrownup();
  if (account.kind !== "parent") throw new Error("Only parent accounts can add children");
  const supabase = await createClient();
  const { count } = await supabase.from("children").select("id", { count: "exact", head: true }).eq("parent_id", account.user.id).eq("kind", "child");
  if ((count ?? 0) >= planFor(account.parent.tier).childCap) redirect("/parent?billing=children");
  const birth = parseBirth(formData, { required: false, minAge: 4, maxAge: 18 });
  if (!birth.ok) throw new Error(birth.error);
  const input = ChildInput.parse({
    display_name: formData.get("display_name"),
    reading_level: formData.get("reading_level") || null,
    avatar: formData.get("avatar") || "🙂",
  });
  const { data, error } = await supabase
    .from("children")
    .insert({
      ...input,
      birth_month: birth.birth?.birth_month ?? null,
      birth_year: birth.birth?.birth_year ?? null,
      kind: "child",
      parent_id: account.user.id,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "P0001") redirect("/parent?billing=children");
    throw new Error(error.message);
  }
  revalidatePath("/parent");
  redirect(`/parent/children/${data.id}`);
}

const SelfInput = z.object({
  display_name: z.string().trim().min(1).max(40),
});

/** A parent's own learner profile, on the same login. */
export async function createSelfProfile(formData: FormData) {
  const account = await requireGrownup();
  if (account.selfChildId) redirect(`/learn/${account.selfChildId}`);
  const birth = parseBirth(formData, { required: true, minAge: 13, maxAge: 120 });
  if (!birth.ok || !birth.birth) throw new Error(birth.ok ? "Enter a birth month and year." : birth.error);
  const input = SelfInput.parse({ display_name: formData.get("display_name") });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("children")
    .insert({ ...input, ...birth.birth, kind: "self", avatar: "🎒", parent_id: account.user.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/parent");
  redirect(`/learn/${data.id}`);
}

export async function removeContext(childId: string, id: string) {
  await requireGrownup();
  const supabase = await createClient();
  await supabase.from("personalization_context").update({ active: false }).eq("id", id);
  revalidatePath(`/parent/children/${childId}`);
}

export async function setLearnerBirth(childId: string, formData: FormData) {
  await requireGrownup();
  const supabase = await createClient();
  const { data: child, error: readError } = await supabase.from("children").select("kind").eq("id", childId).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!child) throw new Error("Learner not found");
  const self = (child as { kind: string }).kind === "self";
  const birth = parseBirth(formData, { required: true, minAge: self ? 13 : 4, maxAge: self ? 120 : 18 });
  if (!birth.ok || !birth.birth) throw new Error(birth.ok ? "Enter a birth month and year." : birth.error);
  const { error } = await supabase.from("children").update(birth.birth).eq("id", childId);
  if (error) throw new Error(error.message);
  revalidatePath(`/parent/children/${childId}`);
  revalidatePath("/parent");
}

export async function removeMemory(childId: string, id: string) {
  await requireGrownup();
  const supabase = await createClient();
  const { error } = await supabase.from("learner_memories").update({ active: false }).eq("id", id).eq("child_id", childId);
  if (error) throw new Error(error.message);
  revalidatePath(`/parent/children/${childId}`);
}

/* ---------------- child access: shared device and child logins ---------------- */

async function ownedChildProfile(childId: string) {
  const supabase = await createClient();
  const [{ data: child }, { data: login }] = await Promise.all([
    supabase.from("children").select("id, kind, shared_device").eq("id", childId).maybeSingle(),
    supabase.from("child_logins").select("user_id, username").eq("child_id", childId).maybeSingle(),
  ]);
  if (!child || child.kind !== "child") throw new Error("child not found");
  return { supabase, child: child as { id: string; kind: "child"; shared_device: boolean }, login: login as { user_id: string; username: string } | null };
}

export async function setSharedDevice(childId: string, enabled: boolean) {
  await requireGrownup();
  const { supabase, login } = await ownedChildProfile(childId);
  if (!enabled && !login) throw new Error("Create a child login before turning off shared-device access");
  const { error } = await supabase.from("children").update({ shared_device: enabled }).eq("id", childId);
  if (error) throw new Error(error.message);
  revalidatePath(`/parent/children/${childId}`);
}

export async function createChildLogin(childId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const account = await requireGrownup();
  const { login } = await ownedChildProfile(childId);
  if (login) return { error: "This child already has a login." };

  const parsed = z.object({ username: Username, pin: Pin }).safeParse({ username: formData.get("username"), pin: formData.get("pin") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { username, pin } = parsed.data;

  const db = createServiceClient();
  const { data: taken } = await db.from("child_logins").select("user_id").eq("username", username).maybeSingle();
  if (taken) return { error: "That username is taken. Try another." };

  const authUser = newChildAuthUser();
  const { error: createError } = await db.auth.admin.createUser({
    id: authUser.id,
    email: authUser.email,
    password: childPassword(authUser.id, pin),
    email_confirm: true,
    app_metadata: { account: "child", child_id: childId },
  });
  if (createError) return { error: createError.message };

  const { error: linkError } = await db
    .from("child_logins")
    .insert({ user_id: authUser.id, child_id: childId, parent_id: account.user.id, username, auth_email: authUser.email });
  if (linkError) {
    await db.auth.admin.deleteUser(authUser.id);
    return { error: linkError.code === "23505" ? "That username is taken. Try another." : linkError.message };
  }

  revalidatePath(`/parent/children/${childId}`);
  return { message: `Login created. ${username} can now sign in with their PIN.` };
}

export async function resetChildPin(childId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireGrownup();
  const { login } = await ownedChildProfile(childId);
  if (!login) return { error: "This child has no login yet." };
  const parsed = Pin.safeParse(formData.get("pin"));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const db = createServiceClient();
  const { error } = await db.auth.admin.updateUserById(login.user_id, { password: childPassword(login.user_id, parsed.data) });
  if (error) return { error: error.message };
  await db.from("child_logins").update({ failed_attempts: 0, locked_until: null }).eq("user_id", login.user_id);
  return { message: "PIN updated." };
}

export async function removeChildLogin(childId: string) {
  await requireGrownup();
  const { supabase, child, login } = await ownedChildProfile(childId);
  if (!login) return;
  // Keep the profile reachable once its login is gone.
  if (!child.shared_device) {
    const { error } = await supabase.from("children").update({ shared_device: true }).eq("id", childId);
    if (error) throw new Error(error.message);
  }
  const { error } = await createServiceClient().auth.admin.deleteUser(login.user_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/parent/children/${childId}`);
}

/* ---------------- curriculum ---------------- */

export async function createCurriculum(childId: string, formData: FormData) {
  await requireGrownup();
  const optional = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" && v.trim() ? v : undefined;
  };
  const input = GoalInput.parse({
    goal: formData.get("goal"),
    scope: formData.get("scope") || "hobby",
    scopeNote: optional("scopeNote"),
    interest: optional("interest"),
  });
  const supabase = await createClient();
  const { data: child } = await supabase.from("children").select("id").eq("id", childId).maybeSingle();
  if (!child) throw new Error("child not found");

  const started = await startCurriculumJob(childId, input.goal);
  const back = formData.get("from") === "learn" ? `/learn/${childId}` : `/parent/children/${childId}`;
  if (!started.ok) redirect(`${back}?billing=${started.error}`);
  if (!started.jobId || !started.curriculumId) throw new Error("curriculum was not enqueued");
  // Saved before the job is kicked, so generation sees the scope and interest.
  const { error } = await createServiceClient()
    .from("curricula")
    .update({ scope: input.scope, scope_note: input.scopeNote ?? null, interest: input.interest ?? null })
    .eq("id", started.curriculumId);
  if (error) throw new Error(error.message);
  kickJob(started.jobId);
  redirect(formData.get("from") === "learn" ? `/learn/${childId}/curricula/${started.curriculumId}` : `/parent/curricula/${started.curriculumId}`);
}

export async function regenerateArtifact(topicId: string, curriculumId: string) {
  await requireGrownup();
  // Ownership: RLS-scoped read must succeed before the service-role write.
  const supabase = await createClient();
  const { data: topic } = await supabase.from("topics").select("id").eq("id", topicId).maybeSingle();
  if (!topic) throw new Error("topic not found");
  const db = createServiceClient();
  const { data: latest } = await db.from("artifacts").select("status").eq("topic_id", topicId).order("version", { ascending: false }).limit(1).maybeSingle();
  const reason = latest?.status === "published" ? "regenerate" : "initial";
  const started = await startArtifactJob(topicId, reason);
  if (!started.ok) redirect(`/parent/curricula/${curriculumId}?billing=${started.error}`);
  if (started.jobId) kickJob(started.jobId);
  revalidatePath(`/parent/curricula/${curriculumId}`);
}

export async function retryTopicGeneration(childId: string, topicId: string) {
  const account = await requireAccount();
  if (account.kind === "child" && account.childId !== childId) redirect(`/learn/${account.childId}`);
  const supabase = await createClient();
  const { data: topic } = await supabase.from("topics").select("id, curricula!inner(child_id)").eq("id", topicId).eq("curricula.child_id", childId).maybeSingle();
  if (!topic) throw new Error("topic not found");
  const started = await startArtifactJob(topicId, "initial");
  if (!started.ok) redirect(`/learn/${childId}/topics/${topicId}?billing=${started.error}`);
  if (started.jobId) kickJob(started.jobId);
  revalidatePath(`/learn/${childId}/topics/${topicId}`);
}

export async function retryCurriculum(curriculumId: string) {
  await requireGrownup();
  const supabase = await createClient();
  const { data: cur } = await supabase.from("curricula").select("id").eq("id", curriculumId).maybeSingle();
  if (!cur) throw new Error("curriculum not found");
  const started = await retryCurriculumJob(curriculumId);
  if (!started.ok) redirect(`/parent/curricula/${curriculumId}?billing=${started.error}`);
  if (started.jobId) kickJob(started.jobId);
  revalidatePath(`/parent/curricula/${curriculumId}`);
}

/* ---------------- reports ---------------- */

export async function generateReportNow(childId: string, date?: string) {
  await requireGrownup();
  const supabase = await createClient();
  const { data: child } = await supabase.from("children").select("id").eq("id", childId).maybeSingle();
  if (!child) throw new Error("child not found");
  await buildDailyReport(childId, date ?? todayIso());
  revalidatePath(`/parent/children/${childId}/report`);
}

/* ---------------- grown-up PIN ---------------- */

export async function setGrownupPin(_prev: FormState, formData: FormData): Promise<FormState> {
  const account = await requireGrownup();
  const parsed = Pin.safeParse(formData.get("pin"));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  if (formData.get("confirm") !== parsed.data) return { error: "The two PINs don't match." };
  const { error } = await createServiceClient()
    .from("parents")
    .update({ grownup_pin_hash: await hashPin(parsed.data), pin_failed: 0, pin_locked_until: null })
    .eq("id", account.user.id);
  if (error) return { error: error.message };
  revalidatePath("/parent/settings");
  return { message: "PIN saved. You'll need it to leave kid mode." };
}

export async function unlockGrownup(_prev: FormState, formData: FormData): Promise<FormState> {
  const account = await requireAccount();
  if (account.kind === "child") redirect(`/learn/${account.childId}`);
  const next = formData.get("next");
  const target = typeof next === "string" && (next === "/parent" || next.startsWith("/parent/")) ? next : "/parent";

  const parsed = Pin.safeParse(formData.get("pin"));
  if (!parsed.success) return { error: "That PIN isn't right." };

  const db = createServiceClient();
  const { data: row } = await db.from("parents").select("grownup_pin_hash, pin_failed, pin_locked_until").eq("id", account.user.id).single();
  if (!row) return { error: "Account not found." };
  // No PIN yet (or it was cleared): don't trap the session behind the gate.
  if (!row.grownup_pin_hash) {
    (await cookies()).delete(KID_MODE_COOKIE);
    redirect(target);
  }
  if (isLocked(row.pin_locked_until)) return { error: "Too many tries. Wait 15 minutes, or sign out and sign back in with your password." };

  if (!(await verifyPin(parsed.data, row.grownup_pin_hash))) {
    const failed = row.pin_failed + 1;
    await db.from("parents").update({ pin_failed: failed, pin_locked_until: lockedUntil(failed) }).eq("id", account.user.id);
    return { error: "That PIN isn't right." };
  }

  await db.from("parents").update({ pin_failed: 0, pin_locked_until: null }).eq("id", account.user.id);
  (await cookies()).delete(KID_MODE_COOKIE);
  redirect(target);
}

/* ---------------- kid mode (shared device) ---------------- */

async function startKidMode(value: string) {
  const store = await cookies();
  if (!store.has(KID_MODE_COOKIE)) {
    const account = await requireGrownup();
    if (account.kind !== "parent") redirect("/");
    if (!(await hasGrownupPin(account.user.id))) redirect("/parent/settings?pin=required");
  }
  store.set(KID_MODE_COOKIE, value, KID_MODE_COOKIE_OPTIONS);
}

/** Hand the device to a child: opens the picker behind the grown-up PIN. */
export async function enterKidMode() {
  await startKidMode("picker");
  redirect("/learn");
}

export async function enterChildMode(childId: string) {
  const account = await requireAccount();
  if (account.kind === "child") redirect(`/learn/${account.childId}`);
  const supabase = await createClient();
  const { data: child } = await supabase.from("children").select("id, kind, shared_device").eq("id", childId).maybeSingle();
  if (!child || child.kind !== "child" || !child.shared_device) throw new Error("child not found");
  await startKidMode(childId);
  redirect(`/learn/${childId}`);
}

export async function exitChildMode() {
  redirect((await isKidMode()) ? "/unlock" : "/parent");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(KID_MODE_COOKIE);
  redirect("/login");
}
