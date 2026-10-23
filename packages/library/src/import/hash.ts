/**
 * sha256 helpers for the Stage 3 importer.
 *
 * `fileSha256` hashes one file. `bundleSha256` hashes the manifest-wide
 * identity: the sorted `path + sha256` list, so the same bytes always produce
 * the same bundle hash regardless of input ordering.
 */

import { webcrypto } from "node:crypto";
import type { LibraryFileEntry } from "@eco/db";

const subtle = webcrypto.subtle;

function toHex(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    const b = view[i]!;
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}

export async function fileSha256(bytes: Uint8Array): Promise<string> {
  const buf = await subtle.digest("SHA-256", bytes);
  return toHex(buf);
}

/** Deterministic hash of the sorted `(path, sha256)` list; stable across input ordering. */
export async function bundleSha256(files: LibraryFileEntry[]): Promise<string> {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const body = sorted.map((f) => `${f.path}\n${f.sha256}`).join("\n");
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(body));
  return toHex(buf);
}
