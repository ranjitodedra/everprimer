import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isChildLogin, studioActor, studioGate } from "@/lib/studio";

export const metadata = { title: "Artifact Studio" };

/** Staff home. The request gate is the primary check. This repeats it so a skipped gate still cannot render the page. */
export default async function StudioHome() {
  const user = await getUser();
  const child = isChildLogin(user);
  let staff = false;
  if (user && !child) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("is_staff");
    staff = data === true;
  }
  const actor = studioActor({ user: !!user, child, staff });
  const decision = studioGate(actor, "/studio");
  if (decision.type === "redirect") redirect(decision.to);
  if (decision.type === "not-found") notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Artifact Studio</h1>
    </main>
  );
}
