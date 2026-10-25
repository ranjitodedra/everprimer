import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { listStaff } from "@/lib/studio";
import { currentStudioActor } from "@/lib/studio-session";
import { staffDeps } from "@/lib/studio-staff";
import { AddStaffForm, RemoveStaffButton } from "./staff-form";

export const metadata = { title: "Staff" };

export default async function StaffPage() {
  const { actor } = await currentStudioActor();
  const listed = await listStaff(actor, staffDeps());
  if (listed.type === "redirect") redirect(listed.to);
  if (listed.type === "not-found") notFound();

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <PageHeader
        title="Staff"
        subtitle="A new staff member signs in and lands in the Artifact Studio. They have no learner and no parent area."
        leading={<Link href="/studio" className="btn-ghost btn-sm">Library</Link>}
      />
      {listed.type === "unavailable" ? (
        <p className="text-berry">{listed.problems.join(" ")}</p>
      ) : (
        <>
          <AddStaffForm />
          {listed.staff.length === 0 ? (
            <p className="text-ink-soft">No staff yet.</p>
          ) : (
            <ul className="list-group">
              {listed.staff.map((person) => (
                <li key={person.userId} className="list-row">
                  <span className="min-w-0 break-all font-semibold">{person.email}</span>
                  {listed.staff.length > 1 ? <RemoveStaffButton userId={person.userId} email={person.email} /> : null}
                </li>
              ))}
            </ul>
          )}
          {listed.staff.length === 1 ? <p className="mt-4 text-sm text-ink-soft">The last staff member cannot be removed.</p> : null}
        </>
      )}
    </main>
  );
}
