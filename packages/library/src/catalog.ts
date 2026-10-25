import {
  MAX_BUNDLE_KB,
  complianceLevel,
  lintManifest,
  parseManifest,
  type ArtifactManifest,
  type ComplianceLevel,
} from "@eco/contracts";
import type {
  LibraryArtifactRow,
  LibraryArtifactVersionRow,
  LibraryFileEntry,
  LibraryVersionStatus,
} from "@eco/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { browserReportProblems, type BrowserReport } from "./browser-report";
import { isSafeObjectPath } from "./paths";
import { transitionProblem } from "./status";

export type CatalogResult<T> = ({ ok: true } & T) | { ok: false; problems: string[] };

export interface VersionInput {
  manifest: unknown;
  files: LibraryFileEntry[];
  bundleSha256: string;
  /** auth.users id of whoever is adding the version; null for scripts. */
  actor: string | null;
}

export interface ArtifactWithVersion {
  artifact: LibraryArtifactRow;
  version: LibraryArtifactVersionRow;
}

export interface ListFilters {
  status?: LibraryVersionStatus;
  /** Staff list. Omit the published-only default so drafts and testing versions are included. */
  allStatuses?: boolean;
  subject?: string;
  visualKind?: string;
  /** Case-insensitive substring of the manifest title. A list filter, not lesson search. */
  title?: string;
  /** Case-insensitive substring of the artifact id. */
  id?: string;
  /** A learner age that must fall inside the manifest age range. */
  age?: number;
  compliance?: ComplianceLevel;
  limit?: number;
}

const SHA256 = /^[0-9a-f]{64}$/;
const VERSION_COLUMNS =
  "artifact_id, version, manifest, entry_file, files, bundle_sha256, status, validation_report, compliance_level, created_by, created_at, published_at, published_by, retired_at";
const ARTIFACT_COLUMNS = "id, title, owner, current_version, created_at, updated_at";

type Db = SupabaseClient;
type DbError = { message: string; code?: string } | null;

function fail(...problems: string[]): { ok: false; problems: string[] } {
  return { ok: false, problems };
}

function dbProblem(error: NonNullable<DbError>, context: string): string {
  if (error.code === "23505") return `${context}: already exists`;
  return `${context}: ${error.message}`;
}

function fileProblems(files: LibraryFileEntry[], manifest: ArtifactManifest): string[] {
  const problems: string[] = [];
  if (files.length === 0) return ["a version needs at least one file"];
  const seen = new Set<string>();
  let bytes = 0;
  for (const f of files) {
    if (!isSafeObjectPath(f.path)) problems.push(`unsafe file path "${f.path}"`);
    if (seen.has(f.path)) problems.push(`duplicate file "${f.path}"`);
    seen.add(f.path);
    if (!Number.isInteger(f.size) || f.size < 0) problems.push(`file "${f.path}" has an invalid size`);
    if (!SHA256.test(f.sha256)) problems.push(`file "${f.path}" needs a lowercase hex sha256`);
    if (!f.mime) problems.push(`file "${f.path}" needs a mime type`);
    bytes += f.size;
  }
  if (!seen.has(manifest.entry)) problems.push(`entry "${manifest.entry}" is not one of the files`);
  const limitKB = Math.min(manifest.performance.maxBundleKB ?? MAX_BUNDLE_KB, MAX_BUNDLE_KB);
  if (bytes > limitKB * 1024) problems.push(`bundle is ${Math.ceil(bytes / 1024)} KB, over the ${limitKB} KB limit`);
  return problems;
}

/** Everything the database cannot check: manifest schema and lint rules, file list, compliance level. */
export function checkVersionInput(
  input: VersionInput,
): CatalogResult<{ manifest: ArtifactManifest; compliance: ComplianceLevel }> {
  const parsed = parseManifest(input.manifest);
  if (!parsed.ok) return fail(...parsed.problems);
  const problems = [...lintManifest(parsed.manifest), ...fileProblems(input.files, parsed.manifest)];
  if (!SHA256.test(input.bundleSha256)) problems.push("bundleSha256 must be a lowercase hex sha256");
  if (problems.length) return fail(...problems);
  return { ok: true, manifest: parsed.manifest, compliance: complianceLevel(parsed.manifest) };
}

function rpcArgs(artifactId: string, input: VersionInput, manifest: ArtifactManifest, compliance: ComplianceLevel) {
  return {
    p_artifact_id: artifactId,
    p_manifest: manifest,
    p_files: input.files,
    p_bundle_sha256: input.bundleSha256,
    p_compliance: compliance,
    p_actor: input.actor,
  };
}

/** Creates the artifact and its version 1 as a draft. The manifest id becomes the artifact id. */
export async function registerDraft(db: Db, input: VersionInput): Promise<CatalogResult<{ artifactId: string; version: number }>> {
  const checked = checkVersionInput(input);
  if (!checked.ok) return checked;
  const artifactId = checked.manifest.id;
  const { data, error } = await db.rpc("library_register_draft", rpcArgs(artifactId, input, checked.manifest, checked.compliance));
  if (error) return fail(dbProblem(error, `artifact "${artifactId}"`));
  return { ok: true, artifactId, version: data as number };
}

/** Adds the next version as a draft. The database assigns the number and writes it into the manifest. */
export async function addVersion(
  db: Db,
  artifactId: string,
  input: VersionInput,
): Promise<CatalogResult<{ artifactId: string; version: number }>> {
  const checked = checkVersionInput(input);
  if (!checked.ok) return checked;
  if (checked.manifest.id !== artifactId) {
    return fail(`manifest id "${checked.manifest.id}" does not match artifact "${artifactId}"`);
  }
  const { data, error } = await db.rpc("library_add_version", rpcArgs(artifactId, input, checked.manifest, checked.compliance));
  if (error) return fail(dbProblem(error, `artifact "${artifactId}"`));
  return { ok: true, artifactId, version: data as number };
}

/** One version of an artifact; without `version`, its current published version. */
export async function getArtifact(db: Db, artifactId: string, version?: number): Promise<CatalogResult<ArtifactWithVersion>> {
  const artifactRes = await db.from("library_artifacts").select(ARTIFACT_COLUMNS).eq("id", artifactId).maybeSingle();
  if (artifactRes.error) return fail(dbProblem(artifactRes.error, `artifact "${artifactId}"`));
  const artifact = artifactRes.data as LibraryArtifactRow | null;
  if (!artifact) return fail(`artifact "${artifactId}" not found`);

  const wanted = version ?? artifact.current_version;
  if (wanted == null) return fail(`artifact "${artifactId}" has no published version`);

  const versionRes = await db
    .from("library_artifact_versions")
    .select(VERSION_COLUMNS)
    .eq("artifact_id", artifactId)
    .eq("version", wanted)
    .maybeSingle();
  if (versionRes.error) return fail(dbProblem(versionRes.error, `${artifactId}@${wanted}`));
  const row = versionRes.data as LibraryArtifactVersionRow | null;
  if (!row) return fail(`${artifactId}@${wanted} not found`);
  return { ok: true, artifact, version: row };
}

/** A literal substring for ILIKE. `%`, `_`, and `\` in the typed text stay literal. */
function containsPattern(value: string): string {
  return `%${value.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** Versions matching the filters, newest first per artifact. Defaults to published versions. */
export async function listArtifacts(db: Db, filters: ListFilters = {}): Promise<CatalogResult<{ versions: LibraryArtifactVersionRow[] }>> {
  let query = db.from("library_artifact_versions").select(VERSION_COLUMNS);
  if (filters.status) query = query.eq("status", filters.status);
  else if (!filters.allStatuses) query = query.eq("status", "published");
  if (filters.subject) query = query.contains("manifest", { subjects: [filters.subject] });
  if (filters.visualKind) query = query.contains("manifest", { visualKinds: [filters.visualKind] });
  if (filters.compliance != null) query = query.eq("compliance_level", filters.compliance);
  if (filters.id?.trim()) query = query.ilike("artifact_id", containsPattern(filters.id));
  if (filters.title?.trim()) query = query.filter("manifest->>title", "ilike", containsPattern(filters.title));
  if (filters.age != null) {
    query = query.filter("manifest->ageRange->0", "lte", filters.age);
    query = query.filter("manifest->ageRange->1", "gte", filters.age);
  }
  const { data, error } = await query
    .order("artifact_id", { ascending: true })
    .order("version", { ascending: false })
    .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200));
  if (error) return fail(dbProblem(error, "library list"));
  return { ok: true, versions: (data ?? []) as LibraryArtifactVersionRow[] };
}

/** Every draft and version of one artifact, oldest first. Does not offer one to a lesson. */
export async function listVersions(db: Db, artifactId: string): Promise<CatalogResult<{ versions: LibraryArtifactVersionRow[] }>> {
  const { data, error } = await db
    .from("library_artifact_versions")
    .select(VERSION_COLUMNS)
    .eq("artifact_id", artifactId)
    .order("version", { ascending: true });
  if (error) return fail(dbProblem(error, artifactId));
  const versions = ((data ?? []) as LibraryArtifactVersionRow[]).slice().sort((a, b) => a.version - b.version);
  return { ok: true, versions };
}

async function loadVersion(db: Db, artifactId: string, version: number): Promise<CatalogResult<{ row: LibraryArtifactVersionRow }>> {
  const { data, error } = await db
    .from("library_artifact_versions")
    .select(VERSION_COLUMNS)
    .eq("artifact_id", artifactId)
    .eq("version", version)
    .maybeSingle();
  if (error) return fail(dbProblem(error, `${artifactId}@${version}`));
  if (!data) return fail(`${artifactId}@${version} not found`);
  return { ok: true, row: data as LibraryArtifactVersionRow };
}

async function moveTo(
  db: Db,
  artifactId: string,
  version: number,
  status: LibraryVersionStatus,
  actor: string | null,
): Promise<CatalogResult<{ status: LibraryVersionStatus; currentVersion: number | null }>> {
  const { data, error } = await db.rpc("library_set_status", {
    p_artifact_id: artifactId,
    p_version: version,
    p_status: status,
    p_actor: actor,
  });
  if (error) return fail(dbProblem(error, `${artifactId}@${version}`));
  const out = data as { status: LibraryVersionStatus; current_version: number | null };
  return { ok: true, status: out.status, currentVersion: out.current_version };
}

/** Moves a draft into testing, or a version in testing back to draft. */
export async function setStatus(db: Db, artifactId: string, version: number, status: "draft" | "testing", actor: string | null) {
  const loaded = await loadVersion(db, artifactId, version);
  if (!loaded.ok) return loaded;
  const problem = transitionProblem(loaded.row.status, status);
  if (problem) return fail(`${artifactId}@${version}: ${problem}`);
  return moveTo(db, artifactId, version, status, actor);
}

/** Publishes a version in testing. The stored manifest must still pass every check. */
export async function publishVersion(db: Db, artifactId: string, version: number, actor: string | null) {
  const loaded = await loadVersion(db, artifactId, version);
  if (!loaded.ok) return loaded;
  const { row } = loaded;
  const problem = transitionProblem(row.status, "published");
  if (problem) return fail(`${artifactId}@${version}: ${problem}`);
  const checked = checkVersionInput({ manifest: row.manifest, files: row.files, bundleSha256: row.bundle_sha256, actor });
  if (!checked.ok) return fail(...checked.problems.map((p) => `${artifactId}@${version}: ${p}`));
  if (checked.manifest.id !== artifactId || checked.manifest.version !== version) {
    return fail(`${artifactId}@${version}: manifest says ${checked.manifest.id}@${checked.manifest.version}`);
  }
  const reportProblems = browserReportProblems(row.validation_report, checked.manifest, row.bundle_sha256);
  if (reportProblems.length) return fail(...reportProblems.map((problem) => `${artifactId}@${version}: ${problem}`));
  return moveTo(db, artifactId, version, "published", actor);
}

/** Stores a browser report on a draft or a version in testing. A published report stays as it was. */
export async function recordBrowserReport(
  db: Db,
  artifactId: string,
  version: number,
  report: BrowserReport,
): Promise<CatalogResult<{ report: BrowserReport }>> {
  const loaded = await loadVersion(db, artifactId, version);
  if (!loaded.ok) return loaded;
  if (loaded.row.status !== "draft" && loaded.row.status !== "testing") {
    return fail(`${artifactId}@${version} is ${loaded.row.status} and its browser report cannot change`);
  }
  const updated = await db
    .from("library_artifact_versions")
    .update({ validation_report: report })
    .eq("artifact_id", artifactId)
    .eq("version", version);
  if (updated.error) return fail(dbProblem(updated.error, `${artifactId}@${version}`));
  return { ok: true, report };
}

/** Deletes a draft and, when it was the only version, the artifact row. Published and retired versions stay. */
export async function deleteDraft(db: Db, artifactId: string, version: number): Promise<CatalogResult<{ files: LibraryFileEntry[] }>> {
  const loaded = await loadVersion(db, artifactId, version);
  if (!loaded.ok) return loaded;
  if (loaded.row.status !== "draft") return fail(`${artifactId}@${version} is ${loaded.row.status} and cannot be deleted`);

  const removed = await db.from("library_artifact_versions").delete().eq("artifact_id", artifactId).eq("version", version);
  if (removed.error) return fail(dbProblem(removed.error, `${artifactId}@${version}`));

  const rest = await db.from("library_artifact_versions").select("version").eq("artifact_id", artifactId);
  if (rest.error) return fail(dbProblem(rest.error, artifactId));
  if (!rest.data?.length) {
    const artifact = await db.from("library_artifacts").delete().eq("id", artifactId);
    if (artifact.error) return fail(dbProblem(artifact.error, `artifact "${artifactId}"`));
  }
  return { ok: true, files: loaded.row.files };
}

/** Retires a published version. Lessons already pinned to it keep playing it. */
export async function retireVersion(db: Db, artifactId: string, version: number, actor: string | null) {
  const loaded = await loadVersion(db, artifactId, version);
  if (!loaded.ok) return loaded;
  const problem = transitionProblem(loaded.row.status, "retired");
  if (problem) return fail(`${artifactId}@${version}: ${problem}`);
  return moveTo(db, artifactId, version, "retired", actor);
}
