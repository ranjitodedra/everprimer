/**
 * Shared types for the Stage 3 importer: inputs, outputs, intermediate file
 * representations, warnings, and errors. All types are pure values; nothing
 * here touches Supabase, Next.js, the file system, or network.
 */

import type { ArtifactManifest } from "@eco/contracts";
import type { LibraryFileEntry } from "@eco/db";

/** A file inside a bundle during import (bytes + path + sniffed mime). */
export interface InMemoryFile {
  /** POSIX relative path inside the bundle (no leading slash, no `..`). */
  path: string;
  bytes: Uint8Array;
  /** Mime from the extension allowlist, agreed with the magic-byte sniff. */
  mime: string;
}

export type ImporterInput =
  | { kind: "html"; source: string }
  | { kind: "zip"; bytes: Uint8Array }
  | { kind: "files"; files: InMemoryFile[] };

export interface ImportOptions {
  /** Manifest the Studio collected from the staff user. */
  manifest: unknown;
  /** Who's importing (auth.users id); null for scripts. Flows into `VersionInput.actor`. */
  actor?: string | null;
}

/** One rewrite the importer applied to a text file. */
export interface RewriteChange {
  file: string;
  rule: "jsdelivr" | "unpkg" | "cdnjs" | "import-map" | "bare-import" | "google-fonts-strip";
  from: string;
  to: string | null;
  notes?: string;
}

export interface ImportWarning {
  code: string;
  message: string;
  file?: string;
}

export interface ImportError {
  code: string;
  message: string;
  file?: string;
}

export interface ImportResult {
  ok: boolean;
  errors: ImportError[];
  warnings: ImportWarning[];
  /** Only set when `ok` is true. */
  normalized?: {
    manifest: ArtifactManifest;
    files: LibraryFileEntry[];
    /** Post-rewrite, post-injection bytes. These are what get stored for preview. */
    contents: InMemoryFile[];
    bundleSha256: string;
    changes: RewriteChange[];
  };
}
