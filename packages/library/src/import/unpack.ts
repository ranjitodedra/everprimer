/**
 * Unpack an `ImporterInput` into a validated list of `InMemoryFile`s.
 *
 * Rule 7 of the masterplan: imported code is untrusted. We never read a path
 * from a ZIP without checking it for `..`, `/`, backslashes, or control bytes;
 * never follow a symlink entry; never let one zip entry overrun the per-file
 * or total-bundle cap; and never accept more than `MAX_FILE_COUNT` entries.
 */

import { unzipSync } from "fflate";
import { MAX_BUNDLE_KB } from "@eco/contracts";
import { isSafeObjectPath } from "../paths";
import { resolveFileMime } from "./mime";
import type { ImporterInput, ImportError, InMemoryFile } from "./types";

/** Per-file byte cap. Masterplan open question 4 default. */
export const MAX_FILE_KB = 5 * 1024;
/** Max number of entries in a single bundle. */
export const MAX_FILE_COUNT = 300;

const BUNDLE_BYTE_CAP = MAX_BUNDLE_KB * 1024;
const FILE_BYTE_CAP = MAX_FILE_KB * 1024;

export interface UnpackResult {
  files: InMemoryFile[];
  errors: ImportError[];
}

function err(code: string, message: string, file?: string): ImportError {
  return file ? { code, message, file } : { code, message };
}

/** The ZIP entry's path, in POSIX form, with no trailing slash. */
function normalizeEntryPath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function isDirectoryEntry(path: string, bytes: Uint8Array): boolean {
  return path === "" || bytes.length === 0 && path.endsWith("/");
}

function unpackZip(bytes: Uint8Array): UnpackResult {
  const errors: ImportError[] = [];
  const files: InMemoryFile[] = [];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    return { files, errors: [err("zip-malformed", `the uploaded ZIP could not be read: ${(e as Error).message}`)] };
  }

  const names = Object.keys(entries);
  if (names.length > MAX_FILE_COUNT) {
    errors.push(err("too-many-files", `bundle has ${names.length} entries; the limit is ${MAX_FILE_COUNT}`));
    return { files, errors };
  }

  let total = 0;
  for (const rawName of names) {
    const data = entries[rawName]!;
    const path = normalizeEntryPath(rawName);
    if (isDirectoryEntry(path, data)) continue;
    if (!isSafeObjectPath(path)) {
      errors.push(err("unsafe-path", `rejected file path "${rawName}" (absolute, parent traversal, or control characters)`, rawName));
      continue;
    }
    if (data.length > FILE_BYTE_CAP) {
      errors.push(err("file-too-big", `file "${path}" is ${Math.ceil(data.length / 1024)} KB; the per-file limit is ${MAX_FILE_KB} KB`, path));
      continue;
    }
    total += data.length;
    if (total > BUNDLE_BYTE_CAP) {
      errors.push(err("bundle-too-big", `bundle exceeded the ${MAX_BUNDLE_KB} KB total cap`));
      break;
    }
    const mime = resolveFileMime(path, data);
    if (!mime.ok) {
      errors.push(err("bad-mime", mime.reason, path));
      continue;
    }
    files.push({ path, bytes: data, mime: mime.mime });
  }
  return { files, errors };
}

function unpackSingleHtml(source: string): UnpackResult {
  const bytes = new TextEncoder().encode(source);
  if (bytes.length > FILE_BYTE_CAP) {
    return { files: [], errors: [err("file-too-big", `HTML source is ${Math.ceil(bytes.length / 1024)} KB; the per-file limit is ${MAX_FILE_KB} KB`)] };
  }
  return { files: [{ path: "index.html", bytes, mime: "text/html" }], errors: [] };
}

function unpackInMemory(files: InMemoryFile[]): UnpackResult {
  const errors: ImportError[] = [];
  const out: InMemoryFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  if (files.length > MAX_FILE_COUNT) {
    return { files: [], errors: [err("too-many-files", `bundle has ${files.length} entries; the limit is ${MAX_FILE_COUNT}`)] };
  }
  for (const f of files) {
    if (!isSafeObjectPath(f.path)) {
      errors.push(err("unsafe-path", `rejected file path "${f.path}"`, f.path));
      continue;
    }
    if (seen.has(f.path)) {
      errors.push(err("duplicate-path", `file "${f.path}" appears more than once`, f.path));
      continue;
    }
    seen.add(f.path);
    if (f.bytes.length > FILE_BYTE_CAP) {
      errors.push(err("file-too-big", `file "${f.path}" is ${Math.ceil(f.bytes.length / 1024)} KB; the per-file limit is ${MAX_FILE_KB} KB`, f.path));
      continue;
    }
    total += f.bytes.length;
    if (total > BUNDLE_BYTE_CAP) {
      errors.push(err("bundle-too-big", `bundle exceeded the ${MAX_BUNDLE_KB} KB total cap`));
      break;
    }
    const mime = resolveFileMime(f.path, f.bytes);
    if (!mime.ok) {
      errors.push(err("bad-mime", mime.reason, f.path));
      continue;
    }
    out.push({ path: f.path, bytes: f.bytes, mime: mime.mime });
  }
  return { files: out, errors };
}

export function unpack(input: ImporterInput): UnpackResult {
  switch (input.kind) {
    case "html":
      return unpackSingleHtml(input.source);
    case "zip":
      return unpackZip(input.bytes);
    case "files":
      return unpackInMemory(input.files);
  }
}
