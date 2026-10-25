import "server-only";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isChildLogin, studioActor, type StudioActor } from "@/lib/studio";

/** The signed-in person as the Studio sees them. A child login is never staff. */
export async function currentStudioActor(): Promise<{ actor: StudioActor; userId: string | null }> {
  const user = await getUser();
  const child = isChildLogin(user);
  let staff = false;
  if (user && !child) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("is_staff");
    staff = data === true;
  }
  return { actor: studioActor({ user: !!user, child, staff }), userId: user?.id ?? null };
}
