/**
 * File-extension allowlist for library bundles, plus a magic-byte sniff that
 * must agree with the declared extension. The importer refuses files whose
 * extension isn't on the list, and files whose bytes don't look like the type
 * their extension claims (defense against renamed binaries smuggling past
 * extension-only checks).
 *
 * The list intentionally omits WASM, server source, project configs
 * (`package.json`, `tsconfig.json`), hidden files, and anything that would
 * imply a build step. Stage 3 scope only accepts static assets runnable by
 * the browser as-is.
 */

const EXT_MIME: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  js: "application/javascript",
  mjs: "application/javascript",
  css: "text/css",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  bin: "application/octet-stream",
  woff2: "font/woff2",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  json: "application/json",
};

export const ALLOWED_MIMES = Object.freeze(Object.values(EXT_MIME).filter((v, i, a) => a.indexOf(v) === i));

export function mimeFromExtension(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return EXT_MIME[ext] ?? null;
}

/** Signatures that let us detect a renamed binary trying to pose as something else. */
interface Signature {
  mime: string;
  starts?: readonly number[];
  startsText?: string;
}

const SIGNATURES: readonly Signature[] = [
  { mime: "image/png", starts: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", starts: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", starts: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", starts: [0x52, 0x49, 0x46, 0x46] }, // RIFF; checked further below
  { mime: "font/woff2", starts: [0x77, 0x4f, 0x46, 0x32] },
  { mime: "audio/mpeg", starts: [0x49, 0x44, 0x33] }, // ID3; also allow raw MPEG frames below
  { mime: "audio/ogg", starts: [0x4f, 0x67, 0x67, 0x53] },
  { mime: "model/gltf-binary", starts: [0x67, 0x6c, 0x54, 0x46] },
];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

function looksLikeText(bytes: Uint8Array): boolean {
  // No NULs in the first 1 KB and at least 95% printable or whitespace.
  const n = Math.min(bytes.length, 1024);
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    if (b === 0) return false;
    if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
    else if (b >= 0x80) printable++; // allow UTF-8 continuation bytes
  }
  return n === 0 || printable / n >= 0.95;
}

/** Returns the detected mime, or null when the bytes don't match any signature we care about. */
export function sniffMime(bytes: Uint8Array): string | null {
  for (const sig of SIGNATURES) {
    if (sig.starts && startsWith(bytes, sig.starts)) {
      if (sig.mime === "image/webp") {
        // RIFF....WEBP
        if (bytes.length < 12) return null;
        const tag = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
        return tag === "WEBP" ? "image/webp" : null;
      }
      return sig.mime;
    }
  }
  // audio/mpeg without ID3: look for an MPEG frame sync (0xFF 0xFB/0xFA/0xF3/0xF2).
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "audio/mpeg";
  return null;
}

/** Agreed-upon mime for a file, or an error string explaining why not. */
export function resolveFileMime(path: string, bytes: Uint8Array): { ok: true; mime: string } | { ok: false; reason: string } {
  const expected = mimeFromExtension(path);
  if (!expected) return { ok: false, reason: `file "${path}" has an extension that is not on the allowlist` };
  // Text formats and JSON don't have a reliable magic signature; accept them if they look like text.
  if (expected.startsWith("text/") || expected === "application/javascript" || expected === "application/json" || expected === "image/svg+xml" || expected === "model/gltf+json") {
    if (!looksLikeText(bytes)) return { ok: false, reason: `file "${path}" is declared as ${expected} but contains binary bytes` };
    return { ok: true, mime: expected };
  }
  if (expected === "application/octet-stream") {
    return { ok: true, mime: expected };
  }
  const sniffed = sniffMime(bytes);
  if (!sniffed) return { ok: false, reason: `file "${path}" does not look like ${expected}` };
  if (sniffed !== expected) return { ok: false, reason: `file "${path}" claims ${expected} but its bytes look like ${sniffed}` };
  return { ok: true, mime: expected };
}
