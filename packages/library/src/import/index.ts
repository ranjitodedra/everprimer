/**
 * `importArtifact` — the single pure entry point of the Stage 3 importer.
 *
 * Given raw input (pasted HTML, a ZIP, or an in-memory file list) and the
 * manifest a staff user filled in, it:
 *
 *   1. unpacks and bounds-checks the bundle (`unpack`)
 *   2. validates the manifest against `parseManifest` + `lintManifest`
 *   3. rewrites text files per ADR-003 (`rewriteSource`)
 *   4. injects the ArtifactKit runtime into the entry HTML (`injectArtifactKit`)
 *   5. runs the shared sandbox + manifest cross-check (`validateLibraryBundle`)
 *   6. hashes files and the bundle (`fileSha256`, `bundleSha256`)
 *
 * The output is a shape Stage 2's catalog (`registerDraft` / `addVersion`)
 * accepts directly. No network, no AI, no file system — easy to unit-test and
 * easy to run from a Studio server action or an offline script.
 */

import { lintManifest, parseManifest, type ArtifactManifest } from "@eco/contracts";
import type { LibraryFileEntry } from "@eco/db";
import { bundleSha256, fileSha256 } from "./hash";
import { injectArtifactKit } from "./inject";
import { rewriteSource, type RewriteOptions } from "./rewrite";
import { unpack } from "./unpack";
import type {
  ImportError,
  ImportOptions,
  ImportResult,
  ImportWarning,
  ImporterInput,
  InMemoryFile,
  RewriteChange,
} from "./types";
import { validateLibraryBundle } from "./validate";

const TEXT_MIMES = new Set([
  "text/html",
  "text/css",
  "application/javascript",
  "application/json",
  "image/svg+xml",
  "model/gltf+json",
]);

function isTextFile(file: InMemoryFile): boolean {
  return TEXT_MIMES.has(file.mime);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function problem(code: string, message: string, file?: string): ImportError {
  return file ? { code, message, file } : { code, message };
}

function parseManifestOrErrors(input: unknown): { manifest?: ArtifactManifest; errors: ImportError[] } {
  const parsed = parseManifest(input);
  if (!parsed.ok) return { errors: parsed.problems.map((p) => problem("manifest-schema", p)) };
  const lint = lintManifest(parsed.manifest);
  if (lint.length) return { manifest: parsed.manifest, errors: lint.map((p) => problem("manifest-lint", p)) };
  return { manifest: parsed.manifest, errors: [] };
}

async function toLibraryFile(file: InMemoryFile): Promise<LibraryFileEntry> {
  return {
    path: file.path,
    size: file.bytes.length,
    sha256: await fileSha256(file.bytes),
    mime: file.mime,
  };
}

export interface ImportInternalOptions extends ImportOptions, RewriteOptions {}

/** Normalize `input` + `manifest` into a bundle ready for `registerDraft` / `addVersion`. */
export async function importArtifact(input: ImporterInput, options: ImportInternalOptions): Promise<ImportResult> {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const changes: RewriteChange[] = [];

  const manifestCheck = parseManifestOrErrors(options.manifest);
  if (manifestCheck.errors.length) errors.push(...manifestCheck.errors);
  const manifest = manifestCheck.manifest;

  const unpacked = unpack(input);
  errors.push(...unpacked.errors);
  if (!manifest || unpacked.errors.length) return { ok: false, errors, warnings };

  // Rewrite text files.
  const rewritten: InMemoryFile[] = [];
  for (const file of unpacked.files) {
    if (!isTextFile(file)) {
      rewritten.push(file);
      continue;
    }
    const r = rewriteSource(file.path, decode(file.bytes), { stripGoogleFonts: options.stripGoogleFonts });
    changes.push(...r.changes);
    warnings.push(...r.warnings);
    errors.push(...r.errors);
    rewritten.push({ path: file.path, mime: file.mime, bytes: encode(r.text) });
  }

  if (!rewritten.some((f) => f.path === manifest.entry)) {
    errors.push(problem("missing-entry", `manifest entry "${manifest.entry}" is not in the bundle`));
    return { ok: false, errors, warnings };
  }

  // Inject the ArtifactKit runtime into the entry HTML.
  const withRuntime: InMemoryFile[] = rewritten.map((f) =>
    f.path === manifest.entry
      ? { path: f.path, mime: f.mime, bytes: encode(injectArtifactKit(decode(f.bytes))) }
      : f,
  );

  const entry = withRuntime.find((f) => f.path === manifest.entry)!;
  const validation = validateLibraryBundle({ manifest, files: withRuntime, entryHtml: decode(entry.bytes) });
  errors.push(...validation.errors);
  warnings.push(...validation.warnings);

  if (errors.length) return { ok: false, errors, warnings };

  const files: LibraryFileEntry[] = [];
  for (const f of withRuntime) files.push(await toLibraryFile(f));
  const bundle = await bundleSha256(files);

  return {
    ok: true,
    errors: [],
    warnings,
    normalized: { manifest, files, contents: withRuntime, bundleSha256: bundle, changes },
  };
}
