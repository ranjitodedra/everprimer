"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { grantStaff, removeStaff, type GrantResult, type RemoveStaffResult } from "@/lib/studio";
import { currentStudioActor } from "@/lib/studio-session";
import { staffDeps } from "@/lib/studio-staff";

export async function grantStaffAction(_prev: GrantResult | null, formData: FormData): Promise<GrantResult> {
  const { actor } = await currentStudioActor();
  const result = await grantStaff(
    actor,
    { email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") },
    staffDeps(),
  );
  if (result.type === "redirect") redirect(result.to);
  if (result.type === "not-found") notFound();
  if (result.type === "granted") revalidatePath("/studio/staff");
  return result;
}

export async function removeStaffAction(userId: string, _prev: RemoveStaffResult | null): Promise<RemoveStaffResult> {
  const { actor } = await currentStudioActor();
  const result = await removeStaff(actor, userId, staffDeps());
  if (result.type === "redirect") redirect(result.to);
  if (result.type === "not-found") notFound();
  if (result.type === "removed") revalidatePath("/studio/staff");
  return result;
}
