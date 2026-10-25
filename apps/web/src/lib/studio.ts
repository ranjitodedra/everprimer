import type { ComplianceLevel } from "@eco/contracts";
import type { LibraryArtifactVersionRow, LibraryVersionStatus } from "@eco/db";
import { listArtifacts } from "@eco/library";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who may open the Artifact Studio, and where everyone else is sent.
 * The request gate and the Studio pages both call this. Tests call it directly.
 */

export type StudioActor = "signed-out" | "parent" | "child" | "staff";

export type StudioDecision = { type: "allow" } | { type: "redirect"; to: string } | { type: "not-found" };

export function studioActor(input: { user: boolean; child: boolean; staff: boolean }): StudioActor {
  if (!input.user) return "signed-out";
  if (input.child) return "child";
  if (input.staff) return "staff";
  return "parent";
}

/** A child login is `account: "child"` in app metadata. A missing child id still counts. */
export function isChildLogin(user: { app_metadata?: unknown } | null | undefined): boolean {
  const meta = user?.app_metadata as { account?: string } | undefined;
  return meta?.account === "child";
}

function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function studioGate(actor: StudioActor, path: string): StudioDecision {
  const studio = under(path, "/studio");
  if (actor === "signed-out") {
    if (studio) return { type: "redirect", to: `/login?next=${encodeURIComponent(path)}` };
    return { type: "allow" };
  }
  if (actor === "parent" || actor === "child") {
    if (studio) return { type: "not-found" };
    return { type: "allow" };
  }
  if (studio) return { type: "allow" };
  if (path === "/" || path === "/login" || under(path, "/parent") || under(path, "/learn")) {
    return { type: "redirect", to: "/studio" };
  }
  return { type: "allow" };
}

const VERSION_STATUSES: readonly LibraryVersionStatus[] = ["draft", "testing", "published", "retired"];

export type LibraryListQuery = {
  title?: string;
  id?: string;
  status?: LibraryVersionStatus;
  subject?: string;
  age?: number;
  compliance?: ComplianceLevel;
};

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? "";
}

/** The list filters a staff member typed. Anything else is ignored, including a usage sort. */
export function libraryListQuery(params: Record<string, string | string[] | undefined>): LibraryListQuery {
  const query: LibraryListQuery = {};
  const title = firstParam(params.title);
  const id = firstParam(params.id);
  const subject = firstParam(params.subject);
  const status = firstParam(params.status);
  const age = firstParam(params.age);
  const compliance = firstParam(params.compliance);
  if (title) query.title = title;
  if (id) query.id = id;
  if (subject) query.subject = subject;
  if (VERSION_STATUSES.includes(status as LibraryVersionStatus)) query.status = status as LibraryVersionStatus;
  if (/^\d{1,2}$/.test(age)) query.age = Number(age);
  if (compliance === "0" || compliance === "1" || compliance === "2" || compliance === "3") {
    query.compliance = Number(compliance) as ComplianceLevel;
  }
  return query;
}

export type StudioList =
  | { type: "redirect"; to: string }
  | { type: "not-found" }
  | { type: "list"; versions: LibraryArtifactVersionRow[] }
  | { type: "unavailable"; problems: string[] };

/** Staff see every status, including drafts. A status filter narrows that. Everyone else is refused. */
export async function listForStudio(actor: StudioActor, db: SupabaseClient, query: LibraryListQuery): Promise<StudioList> {
  const gate = studioGate(actor, "/studio");
  if (gate.type !== "allow") return gate;
  const listed = await listArtifacts(db, { ...query, allStatuses: query.status == null });
  if (!listed.ok) return { type: "unavailable", problems: listed.problems };
  return { type: "list", versions: listed.versions };
}
