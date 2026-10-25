import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { listForStudio, studioGate, tagSuggestions } from "@/lib/studio";
import { currentStudioActor } from "@/lib/studio-session";
import { createClient } from "@/lib/supabase/server";
import { SittingForm } from "./sitting-form";

export const metadata = { title: "New artifact" };

export default async function NewArtifactPage() {
  const { actor } = await currentStudioActor();
  const decision = studioGate(actor, "/studio/new");
  if (decision.type === "redirect") redirect(decision.to);
  if (decision.type === "not-found") notFound();

  const listed = await listForStudio(actor, await createClient(), {});
  const suggestions = tagSuggestions(listed.type === "list" ? listed.versions : []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <PageHeader title="New artifact" subtitle="Paste HTML or upload a ZIP, then preview it. Publish turns on when the preview is ready." leading={<Link href="/studio" className="btn-ghost btn-sm">Library</Link>} />
      <SittingForm suggestions={suggestions} />
    </main>
  );
}
