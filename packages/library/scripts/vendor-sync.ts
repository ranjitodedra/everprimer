/**
 * Downloads, verifies, and extracts the vendored third-party libraries listed
 * in `packages/library/vendor/lock.json` into `packages/library/vendor/files/`.
 *
 * See `packages/library/vendor/README.md`. Run with:
 *
 *   pnpm --filter @eco/library vendor:sync          (sync everything)
 *   pnpm --filter @eco/library vendor:sync --check  (verify only; non-zero exit on drift)
 *   pnpm --filter @eco/library vendor:sync --write-integrity  (populate missing hashes)
 *
 * The script keeps the bytes out of the repo so clone size stays small; CI
 * runs it before any test that needs real vendored files. Stage 3 itself only
 * uses the lock metadata, so `test` does not depend on this script.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { VENDOR_LOCK, type VendorPackage } from "../src/vendor/lock";

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = resolve(HERE, "..", "vendor");
const FILES_DIR = join(VENDOR_DIR, "files");
const LOCK_PATH = join(VENDOR_DIR, "lock.json");

interface Args {
  check: boolean;
  writeIntegrity: boolean;
}

function parseArgs(argv: string[]): Args {
  return { check: argv.includes("--check"), writeIntegrity: argv.includes("--write-integrity") };
}

function sha512Base64(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

async function fetchTarball(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Minimal POSIX tar reader. Supports regular files only (type flag '0' or ''). */
function extractTar(bytes: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const out: Array<{ name: string; data: Uint8Array }> = [];
  for (let off = 0; off + 512 <= bytes.length; ) {
    const header = bytes.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = readStr(header, 0, 100);
    const sizeOct = readStr(header, 124, 12).trim();
    const size = parseInt(sizeOct, 8) || 0;
    const type = String.fromCharCode(header[156] ?? 0);
    off += 512;
    if (name && (type === "0" || type === "\0" || type === "")) {
      out.push({ name, data: bytes.subarray(off, off + size) });
    }
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

function readStr(buf: Uint8Array, start: number, len: number): string {
  let end = start;
  while (end < start + len && buf[end] !== 0) end++;
  return new TextDecoder().decode(buf.subarray(start, end));
}

function wantedPath(pkg: VendorPackage, entryName: string): string | null {
  // npm tarballs put files under a `package/` prefix.
  if (!entryName.startsWith("package/")) return null;
  const rel = entryName.slice("package/".length);
  for (const want of pkg.files) {
    if (want.endsWith("/") ? rel.startsWith(want) : rel === want) return rel;
  }
  return null;
}

async function syncPackage(pkg: VendorPackage, args: Args, state: { changed: boolean; drift: string[] }): Promise<void> {
  const dest = join(FILES_DIR, `${pkg.name}@${pkg.version}`);
  const tarball = await fetchTarball(pkg.tarball);
  const integrity = sha512Base64(tarball);
  if (pkg.tarballIntegrity && pkg.tarballIntegrity !== integrity) {
    throw new Error(`${pkg.name}@${pkg.version}: tarball integrity mismatch (got ${integrity})`);
  }
  if (!pkg.tarballIntegrity) {
    if (args.writeIntegrity) {
      pkg.tarballIntegrity = integrity;
      state.changed = true;
    } else {
      state.drift.push(`${pkg.name}@${pkg.version}: tarballIntegrity is empty; rerun with --write-integrity`);
    }
  }
  if (args.check) return;
  rmSync(dest, { recursive: true, force: true });
  const entries = extractTar(gunzipSync(tarball));
  let wrote = 0;
  for (const entry of entries) {
    const rel = wantedPath(pkg, entry.name);
    if (!rel) continue;
    const abs = join(dest, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, entry.data);
    wrote++;
  }
  if (wrote === 0) throw new Error(`${pkg.name}@${pkg.version}: no files matched the declared paths`);
  console.log(`${pkg.name}@${pkg.version}: wrote ${wrote} files to ${dest}`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(FILES_DIR, { recursive: true });
  const state = { changed: false, drift: [] as string[] };
  for (const pkg of VENDOR_LOCK.packages) {
    await syncPackage(pkg, args, state);
  }
  if (state.changed) {
    const raw = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
    for (const pkg of raw.packages) {
      const live = VENDOR_LOCK.packages.find((p) => p.name === pkg.name && p.version === pkg.version);
      if (live) pkg.tarballIntegrity = live.tarballIntegrity;
    }
    writeFileSync(LOCK_PATH, JSON.stringify(raw, null, 2) + "\n");
    console.log(`updated ${LOCK_PATH}`);
  }
  if (state.drift.length) {
    for (const d of state.drift) console.error(d);
    return 1;
  }
  try {
    statSync(FILES_DIR);
  } catch {
    // ignore
  }
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err);
  process.exit(1);
});
