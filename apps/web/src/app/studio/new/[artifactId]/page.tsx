import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getArtifact } from "@eco/library";
import { PageHeader } from "@/components/ui";
import { fieldsFromManifest, listForStudio, studioGate, tagSuggestions } from "@/lib/studio";
import { currentStudioActor } from "@/lib/studio-session";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SittingForm } from "../sitting-form";

export const metadata = { title: "Next version" };

export default async function NextVersionPage(props: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await props.params;
  const { actor } = await currentStudioActor();
  const decision = studioGate(actor, `/studio/new/${artifactId}`);
  if (decision.type === "redirect") redirect(decision.to);
  if (decision.type === "not-found") notFound();

  const loaded = await getArtifact(createServiceClient(), artifactId);
  if (!loaded.ok) notFound();

  const listed = await listForStudio(actor, await createClient(), {});
  const suggestions = tagSuggestions(listed.type === "list" ? listed.versions : []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <PageHeader
        title="Next version"
        subtitle={`New files for ${artifactId}. The published version stays as it is.`}
        leading={<Link href="/studio" className="btn-ghost btn-sm">Library</Link>}
      />
      <SittingForm suggestions={suggestions} initial={fieldsFromManifest(loaded.version.manifest)} lockId artifactId={artifactId} />
    </main>
  );
}
