import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { LibraryArtifactVersionRow, LibraryVersionStatus } from "@eco/db";
import { PageHeader } from "@/components/ui";
import { historyForStudio } from "@/lib/studio";
import { currentStudioActor } from "@/lib/studio-session";
import { createClient } from "@/lib/supabase/server";
import { RetireButton } from "../../retire-button";

export const metadata = { title: "Version history" };

const STATUS_LABEL: Record<LibraryVersionStatus, string> = {
  draft: "Draft",
  testing: "Testing",
  published: "Published",
  retired: "Retired",
};

function manifestTitle(row: LibraryArtifactVersionRow) {
  const title = (row.manifest as { title?: string }).title?.trim();
  return title || row.artifact_id;
}

function rowHeading(row: LibraryArtifactVersionRow) {
  if (row.status === "draft") return `Draft ${row.version}`;
  if (row.status === "testing") return `Testing ${row.version}`;
  return `Version ${row.version}`;
}

export default async function ArtifactHistoryPage(props: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await props.params;
  const { actor } = await currentStudioActor();
  const history = await historyForStudio(actor, await createClient(), artifactId);
  if (history.type === "redirect") redirect(history.to);
  if (history.type === "not-found") notFound();

  if (history.type === "unavailable") {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16">
        <PageHeader title={artifactId} leading={<Link href="/studio" className="btn-ghost btn-sm">Library</Link>} />
        <p className="text-berry">{history.problems.join(" ")}</p>
      </main>
    );
  }

  const newest = history.versions[history.versions.length - 1]!;
  const canContinue = history.versions.some((row) => row.status === "published" || row.status === "retired");

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <PageHeader
        title={manifestTitle(newest)}
        subtitle="Retire keeps a version open for a lesson that already has it, and stops offering it to a new lesson."
        leading={<Link href="/studio" className="btn-ghost btn-sm">Library</Link>}
        actions={
          canContinue ? (
            <Link href={`/studio/new/${artifactId}`} className="btn-secondary btn-sm">
              Next version
            </Link>
          ) : null
        }
      />
      <ol className="space-y-8">
        {history.versions.map((row) => (
          <li key={row.version} className="rounded-2xl border border-ink/10 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{rowHeading(row)}</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {STATUS_LABEL[row.status]}
                  {" · "}
                  {row.published_at ? `Published ${row.published_at}` : "No publish time"}
                </p>
              </div>
              {row.status === "published" ? <RetireButton artifactId={artifactId} version={row.version} /> : null}
            </div>
            <h3 className="mt-5 text-sm font-semibold">Files</h3>
            {row.files.length ? (
              <ul className="mt-1 text-sm text-ink-soft">
                {row.files.map((file) => (
                  <li key={file.path}>{file.path}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-ink-soft">No files</p>
            )}
            <h3 className="mt-5 text-sm font-semibold">Manifest</h3>
            <pre className="mt-1 overflow-x-auto text-xs text-ink-soft">{JSON.stringify(row.manifest, null, 2)}</pre>
          </li>
        ))}
      </ol>
    </main>
  );
}
