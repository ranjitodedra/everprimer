import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { LibraryArtifactVersionRow } from "@eco/db";
import { EmptyState, ListRow, PageHeader, StatusBadge } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { libraryListQuery, listForStudio, studioGate } from "@/lib/studio";
import { currentStudioActor } from "@/lib/studio-session";

export const metadata = { title: "Artifact Studio" };

function manifestText(row: LibraryArtifactVersionRow) {
  const manifest = (row.manifest ?? {}) as { title?: string; ageRange?: [number, number]; subjects?: string[] };
  const title = manifest.title?.trim() || row.artifact_id;
  const ages = Array.isArray(manifest.ageRange) ? `ages ${manifest.ageRange[0]}–${manifest.ageRange[1]}` : "no age range";
  const subjects = Array.isArray(manifest.subjects) && manifest.subjects.length ? manifest.subjects.join(", ") : "no subject";
  return {
    title,
    subtitle: `${row.artifact_id} · version ${row.version} · ${subjects} · ${ages} · compliance ${row.compliance_level}`,
  };
}

/** Staff home. The request gate is the primary check. This repeats it so a skipped gate still cannot render the page. */
export default async function StudioHome(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { actor } = await currentStudioActor();
  const decision = studioGate(actor, "/studio");
  if (decision.type === "redirect") redirect(decision.to);
  if (decision.type === "not-found") notFound();

  const sp = await props.searchParams;
  const query = libraryListQuery(sp);
  const listed = await listForStudio(actor, await createClient(), query);
  if (listed.type === "redirect") redirect(listed.to);
  if (listed.type === "not-found") notFound();

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <PageHeader
        title="Artifact Studio"
        subtitle="Library versions, including drafts."
        actions={
          <>
            <Link href="/studio/new" className="btn-primary btn-sm">
              New artifact
            </Link>
            <Link href="/studio/staff" className="btn-secondary btn-sm">
              Staff
            </Link>
          </>
        }
      />

      <form method="get" className="mb-8 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-semibold">
          Title
          <input name="title" defaultValue={query.title ?? ""} className="input mt-1" />
        </label>
        <label className="block text-sm font-semibold">
          Id
          <input name="id" defaultValue={query.id ?? ""} className="input mt-1" placeholder="solar-system-simulator" />
        </label>
        <label className="block text-sm font-semibold">
          Status
          <select name="status" defaultValue={query.status ?? ""} className="input mt-1">
            <option value="">Any</option>
            <option value="draft">Draft</option>
            <option value="testing">Testing</option>
            <option value="published">Published</option>
            <option value="retired">Retired</option>
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Subject
          <input name="subject" defaultValue={query.subject ?? ""} className="input mt-1" />
        </label>
        <label className="block text-sm font-semibold">
          Age
          <input name="age" inputMode="numeric" defaultValue={query.age ?? ""} className="input mt-1" />
        </label>
        <label className="block text-sm font-semibold">
          Compliance
          <select name="compliance" defaultValue={query.compliance ?? ""} className="input mt-1">
            <option value="">Any</option>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </label>
        <button type="submit" className="btn-secondary btn-sm sm:col-span-3 sm:justify-self-start">
          Filter
        </button>
      </form>

      {listed.type === "unavailable" ? (
        <p className="text-berry">{listed.problems.join(" ")}</p>
      ) : listed.versions.length === 0 ? (
        <EmptyState title="No artifacts match" body="Try another title, id, status, subject, age, or compliance level." />
      ) : (
        <ul className="list-group">
          {listed.versions.map((row) => {
            const text = manifestText(row);
            return (
              <li key={`${row.artifact_id}@${row.version}`}>
                <ListRow
                  href={`/studio/artifacts/${row.artifact_id}`}
                  title={text.title}
                  subtitle={text.subtitle}
                  trailing={<StatusBadge status={row.status} />}
                />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
