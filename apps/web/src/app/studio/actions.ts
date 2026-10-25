"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { retireForStudio } from "@/lib/studio";
import { currentStudioActor } from "@/lib/studio-session";
import { createServiceClient } from "@/lib/supabase/server";

export async function retireSitting(artifactId: string, version: number) {
  const { actor, userId } = await currentStudioActor();
  const result = await retireForStudio(actor, createServiceClient(), artifactId, version, userId);
  if (result.type === "redirect") redirect(result.to);
  if (result.type === "not-found") notFound();
  if (result.type === "retired") {
    revalidatePath("/studio");
    revalidatePath(`/studio/artifacts/${artifactId}`);
  }
  return result;
}
