import { complianceLevel, type ComplianceLevel } from "@eco/contracts";
import type { LibraryArtifactVersionRow, LibraryVersionStatus } from "@eco/db";
import { bundleObjectPath, deleteDraft, getArtifact, importArtifact, listArtifacts, registerDraft } from "@eco/library";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signDraftToken, type DraftToken } from "./artifact-headers";

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

const PREVIEW_TTL_SEC = 30 * 60;

export type SittingFields = {
  id: string;
  title: string;
  description: string;
  subjects: string;
  topics: string;
  concepts: string;
  params: string;
  events: string;
  entry: string;
  ageYoungest: string;
  ageOldest: string;
  objective: string;
  summary: string;
  tutorIntro: string;
};

function tags(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function jsonList(value: string): unknown[] {
  const text = value.trim();
  if (!text) return [];
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) throw new Error("expected a JSON list");
  return parsed;
}

/** The manifest for a new artifact. Compliance is not a field; the catalog calculates it. */
export function sittingManifest(fields: SittingFields, createdAt = "2026-10-24T00:00:00.000Z") {
  const manifest: Record<string, unknown> = {
    manifestVersion: 1,
    id: fields.id.trim(),
    version: 1,
    title: fields.title.trim(),
    description: fields.description.trim(),
    format: "html",
    entry: fields.entry.trim() || "index.html",
    rendering: { dimension: "2d", tech: [], webgl: false },
    subjects: tags(fields.subjects),
    topics: tags(fields.topics),
    concepts: tags(fields.concepts),
    prerequisites: [],
    learningObjectives: [fields.objective.trim()].filter(Boolean),
    objectiveIntents: ["explain"],
    visualKinds: ["parts"],
    interactionTypes: ["observe"],
    ageRange: [Number(fields.ageYoungest), Number(fields.ageOldest)],
    difficulty: 1,
    durationSec: [60, 180],
    params: jsonList(fields.params),
    events: jsonList(fields.events),
    accessibility: {
      reducedMotion: true,
      keyboard: true,
      screenReaderSummary: fields.summary.trim(),
      colorSafe: true,
    },
    performance: { mobileTested: false },
    provenance: { createdWith: ["artifact-studio"], createdAt },
    license: { artifact: "proprietary", thirdParty: [], attributions: [] },
  };
  const intro = fields.tutorIntro.trim();
  if (intro) manifest.tutorGuide = { intro };
  return manifest;
}

export function tagSuggestions(versions: { manifest: unknown }[]) {
  const collect = (key: "subjects" | "topics" | "concepts") => {
    const found = new Set<string>();
    for (const version of versions) {
      const manifest = version.manifest as Record<string, unknown> | null;
      const values = manifest?.[key];
      if (!Array.isArray(values)) continue;
      for (const value of values) if (typeof value === "string" && value.trim()) found.add(value.trim());
    }
    return [...found].sort((a, b) => a.localeCompare(b));
  };
  return { subjects: collect("subjects"), topics: collect("topics"), concepts: collect("concepts") };
}

export function draftPreviewUrl(origin: string, artifactId: string, version: number, entry: string, token: DraftToken): string {
  const path = entry.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${origin.replace(/\/$/, "")}/a/${encodeURIComponent(artifactId)}/${version}/${path}?t=${token.signature}&e=${token.expiry}`;
}

export type NewArtifactInput = {
  html?: string;
  zip?: Uint8Array;
  manifest: unknown;
  actorId: string | null;
};

export type PreviewDeps = {
  db: SupabaseClient;
  origin: string | null;
  secret: string;
  now: number;
  upload: (path: string, bytes: Uint8Array, mime: string) => Promise<string | null>;
  remove: (paths: string[]) => Promise<string | null>;
};

export type StudioNotice = { code: string; message: string; file?: string };

export type PreviewResult =
  | { type: "redirect"; to: string }
  | { type: "not-found" }
  | { type: "invalid"; errors: StudioNotice[]; warnings: StudioNotice[] }
  | { type: "unavailable"; problems: string[] }
  | {
      type: "preview";
      artifactId: string;
      version: number;
      entry: string;
      url: string;
      warnings: StudioNotice[];
      compliance: ComplianceLevel;
      manifest: unknown;
      publish: "off";
    };

/** Import, store a draft, and sign a preview url. Publish stays off. */
export async function previewNewArtifact(actor: StudioActor, input: NewArtifactInput, deps: PreviewDeps): Promise<PreviewResult> {
  const gate = studioGate(actor, "/studio/new");
  if (gate.type !== "allow") return gate;
  if (!input.zip?.byteLength && !input.html?.trim()) {
    return { type: "invalid", errors: [{ code: "empty", message: "Paste HTML or upload a ZIP." }], warnings: [] };
  }

  const source = input.zip ? { kind: "zip" as const, bytes: input.zip } : { kind: "html" as const, source: input.html ?? "" };
  const imported = await importArtifact(source, { manifest: input.manifest, actor: input.actorId });
  if (!imported.ok || !imported.normalized) return { type: "invalid", errors: imported.errors, warnings: imported.warnings };
  if (!deps.origin || !deps.secret) return { type: "unavailable", problems: ["The artifact host is not configured."] };

  const registered = await registerDraft(deps.db, {
    manifest: imported.normalized.manifest,
    files: imported.normalized.files,
    bundleSha256: imported.normalized.bundleSha256,
    actor: input.actorId,
  });
  if (!registered.ok) return { type: "unavailable", problems: registered.problems };

  const uploaded: string[] = [];
  for (const file of imported.normalized.contents) {
    const path = bundleObjectPath(registered.artifactId, registered.version, file.path);
    const error = await deps.upload(path, file.bytes, file.mime);
    if (error) {
      await deps.remove(uploaded);
      await deleteDraft(deps.db, registered.artifactId, registered.version);
      return { type: "unavailable", problems: [error] };
    }
    uploaded.push(path);
  }

  const token = signDraftToken(registered.artifactId, registered.version, deps.now + PREVIEW_TTL_SEC, deps.secret);
  return {
    type: "preview",
    artifactId: registered.artifactId,
    version: registered.version,
    entry: imported.normalized.manifest.entry,
    url: draftPreviewUrl(deps.origin, registered.artifactId, registered.version, imported.normalized.manifest.entry, token),
    warnings: imported.warnings,
    compliance: complianceLevel(imported.normalized.manifest),
    manifest: imported.normalized.manifest,
    publish: "off",
  };
}

export type AbandonResult =
  | { type: "redirect"; to: string }
  | { type: "not-found" }
  | { type: "deleted" }
  | { type: "refused"; problems: string[] }
  | { type: "unavailable"; problems: string[] };

/** Deletes a draft and its stored files. A published or retired version is refused. */
export async function abandonPreview(
  actor: StudioActor,
  artifactId: string,
  version: number,
  deps: Pick<PreviewDeps, "db" | "remove">,
): Promise<AbandonResult> {
  const gate = studioGate(actor, "/studio/new");
  if (gate.type !== "allow") return gate;
  const loaded = await getArtifact(deps.db, artifactId, version);
  if (!loaded.ok) return { type: "refused", problems: loaded.problems };
  if (loaded.version.status !== "draft") {
    return { type: "refused", problems: [`${artifactId}@${version} is ${loaded.version.status} and cannot be deleted`] };
  }
  const paths = loaded.version.files.map((file) => bundleObjectPath(artifactId, version, file.path));
  const storageError = await deps.remove(paths);
  if (storageError) return { type: "unavailable", problems: [storageError] };
  const deleted = await deleteDraft(deps.db, artifactId, version);
  if (!deleted.ok) return { type: "unavailable", problems: deleted.problems };
  return { type: "deleted" };
}
