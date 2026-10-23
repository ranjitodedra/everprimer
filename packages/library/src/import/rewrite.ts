/**
 * Rewrites CDN references in artifact source files to the artifact origin's
 * vendored copies, per ADR-003. The rewriter is pure: input is the file text
 * and its path; output is the rewritten text plus a change log, warnings, and
 * errors. Stage 4 will mount a route that serves the vendored bytes under
 * `/v/{name}@{version}/{path}`.
 *
 * The rewriter never fetches anything. The lock list is the single source of
 * truth for what's allowed; anything else is a hard error with an actionable
 * message.
 */

import { cdnjsPath, findVendorPackage, hasVendoredFile, isAllowedPin } from "../vendor/lock";
import type { ImportError, ImportWarning, RewriteChange } from "./types";

/** URL prefix the artifact origin will serve vendored files under. */
export const VENDOR_PATH_PREFIX = "/v";

export interface RewriteResult {
  text: string;
  changes: RewriteChange[];
  warnings: ImportWarning[];
  errors: ImportError[];
}

const JSDELIVR_RE = /https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+)\/([^"'\s)<>]+)/gi;
const UNPKG_RE = /https:\/\/unpkg\.com\/((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+)\/([^"'\s)<>]+)/gi;
const CDNJS_RE = /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/([a-z0-9._-]+)\/(\d+\.\d+\.\d+)\/([^"'\s)<>]+)/gi;
const GOOGLE_FONTS_LINK_RE = /<link\b[^>]+href=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"']*["'][^>]*>\s*/gi;
const GOOGLE_FONTS_IMPORT_RE = /@import\s+(?:url\()?["']?https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"')]+["']?\)?\s*;?/gi;
const GOOGLE_FONTS_PRECONNECT_RE = /<link\b[^>]+rel=["']preconnect["'][^>]+href=["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"']*["'][^>]*>\s*/gi;

const UNVERSIONED_CDN_RE = /https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/[^"'\s)<>@]+@(?:latest|next|beta|canary)[^"'\s)<>]*/gi;
const PARTIAL_VERSION_CDN_RE = /https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/[^"'\s)<>@]+@\d+(?:\.\d+)?(?![.\d])[^"'\s)<>]*/gi;
const OTHER_CDN_RE = /https:\/\/(?:esm\.sh|cdn\.skypack\.dev|unpkg\.sh|jspm\.dev)\/[^"'\s)<>]+/gi;

function vendorUrl(name: string, version: string, path: string): string {
  return `${VENDOR_PATH_PREFIX}/${name}@${version}/${path}`;
}

/**
 * Rewrite one allowlisted CDN URL, substituting a `.min.js` the package doesn't
 * ship with its unminified sibling (jsDelivr minifies on the fly; the vendored
 * tarball doesn't). Returns the rewritten URL plus the final path.
 */
function rewritePackagePath(name: string, version: string, path: string): { url: string; path: string } | null {
  if (!isAllowedPin(`${name}@${version}`)) return null;
  if (hasVendoredFile(name, version, path)) return { url: vendorUrl(name, version, path), path };
  const pkg = findVendorPackage(name, version);
  const aliased = pkg?.minifyAliases?.[path];
  if (aliased && hasVendoredFile(name, version, aliased)) return { url: vendorUrl(name, version, aliased), path: aliased };
  if (path.endsWith(".min.js")) {
    const sibling = path.replace(/\.min\.js$/, ".js");
    if (hasVendoredFile(name, version, sibling)) return { url: vendorUrl(name, version, sibling), path: sibling };
  }
  return null;
}

function rejection(file: string, name: string, version: string): ImportError {
  return {
    code: "unknown-library",
    file,
    message: `${name}@${version} is not on the allowlist; bundle it locally or request it be added`,
  };
}

function missingFileError(file: string, name: string, version: string, path: string): ImportError {
  return {
    code: "unknown-library-file",
    file,
    message: `${name}@${version} is allowlisted but file "${path}" is not; add it to packages/library/vendor/lock.json or pick a different file`,
  };
}

function replaceWithLog(
  text: string,
  re: RegExp,
  file: string,
  rule: RewriteChange["rule"],
  mapName: (name: string, version: string, path: string) => { url: string; path: string } | null,
  changes: RewriteChange[],
  errors: ImportError[],
): string {
  return text.replace(re, (whole, nameOrPkg: string, version: string, path: string) => {
    const mapped = mapName(nameOrPkg, version, path);
    if (!mapped) {
      // Decide between "package not allowed" and "file not allowed".
      if (!isAllowedPin(`${nameOrPkg}@${version}`)) errors.push(rejection(file, nameOrPkg, version));
      else errors.push(missingFileError(file, nameOrPkg, version, path));
      return whole;
    }
    changes.push({ file, rule, from: whole, to: mapped.url });
    return mapped.url;
  });
}

function stripWithLog(
  text: string,
  re: RegExp,
  file: string,
  rule: RewriteChange["rule"],
  changes: RewriteChange[],
  notes: string,
): string {
  return text.replace(re, (whole) => {
    changes.push({ file, rule, from: whole, to: null, notes });
    return "";
  });
}

function rewriteImportMapValues(text: string, file: string, changes: RewriteChange[], errors: ImportError[]): string {
  // Match <script type="importmap">…</script> and rewrite URL-shaped values.
  return text.replace(/<script\b[^>]+type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi, (whole, body: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Non-JSON import map; let the inline-script syntax check catch it later.
      return whole;
    }
    const rewriteValue = (value: string): string => {
      // Prefix mapping ends with "/", e.g. "three/addons/" -> "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
      const match =
        value.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+)\/(.*)$/i) ||
        value.match(/^https:\/\/unpkg\.com\/((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+)\/(.*)$/i);
      if (!match) return value;
      const [, name, version, rest] = match;
      if (!isAllowedPin(`${name!}@${version!}`)) {
        errors.push(rejection(file, name!, version!));
        return value;
      }
      // Prefix mappings (end with /) don't resolve to a specific file; accept them wholesale.
      if (rest!.endsWith("/") || rest === "") {
        const url = `${VENDOR_PATH_PREFIX}/${name}@${version}/${rest}`;
        changes.push({ file, rule: "import-map", from: value, to: url, notes: "prefix mapping" });
        return url;
      }
      const mapped = rewritePackagePath(name!, version!, rest!);
      if (!mapped) {
        errors.push(missingFileError(file, name!, version!, rest!));
        return value;
      }
      changes.push({ file, rule: "import-map", from: value, to: mapped.url });
      return mapped.url;
    };
    const walk = (node: unknown): unknown => {
      if (typeof node === "string") return rewriteValue(node);
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(v);
        return out;
      }
      return node;
    };
    const rewritten = walk(parsed);
    const serialised = JSON.stringify(rewritten, null, 2);
    return whole.replace(body, `\n${serialised}\n`);
  });
}

/** Detect bare `import "name"` / `import x from "name"` lacking a matching import map entry. */
function detectBareImports(text: string, file: string, errors: ImportError[], warnings: ImportWarning[]): void {
  const importMap = extractImportMap(text);
  const re = /\bimport\s+(?:[^"'`;]+\s+from\s+)?["']([^"'./][^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const specifier = m[1]!;
    if (importMap.hasSpecifier(specifier)) continue;
    const bareName = specifier.split("/")[0]!;
    if (!bareName) continue;
    // We can't guess the version, so this is always an error.
    errors.push({
      code: "bare-import",
      file,
      message: `bare import "${specifier}" has no import map entry; add an allowlisted import map or qualify the URL`,
    });
    warnings.push({ code: "bare-import-no-version", file, message: `cannot infer a vendored version for "${specifier}"` });
  }
}

interface ImportMapIndex {
  hasSpecifier(specifier: string): boolean;
}

function extractImportMap(text: string): ImportMapIndex {
  const match = text.match(/<script\b[^>]+type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return { hasSpecifier: () => false };
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[1]!);
  } catch {
    return { hasSpecifier: () => false };
  }
  const imports = (parsed["imports"] as Record<string, unknown> | undefined) ?? {};
  const keys = Object.keys(imports);
  return {
    hasSpecifier(specifier) {
      if (specifier in imports) return true;
      // Prefix mappings end with "/" and cover `name/subpath`.
      return keys.some((k) => k.endsWith("/") && specifier.startsWith(k));
    },
  };
}

function detectForbiddenCdns(text: string, file: string, errors: ImportError[]): void {
  for (const re of [UNVERSIONED_CDN_RE, PARTIAL_VERSION_CDN_RE, OTHER_CDN_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      errors.push({
        code: "forbidden-cdn",
        file,
        message: `rejected external reference "${m[0]}"; only exact-version jsDelivr/unpkg/cdnjs URLs on the allowlist are permitted`,
      });
    }
  }
}

export interface RewriteOptions {
  /** When true, Google Fonts stripping is applied in HTML and CSS. Defaults to true. */
  stripGoogleFonts?: boolean;
  /** When true, detect bare imports (`import "three"`) with no matching import map. Default: only for HTML files. */
  detectBareImports?: boolean;
}

/** Rewrite one text file in place. The caller decides what counts as a text file (see `mime.ts`). */
export function rewriteSource(path: string, text: string, options: RewriteOptions = {}): RewriteResult {
  const stripGoogleFonts = options.stripGoogleFonts ?? true;
  const changes: RewriteChange[] = [];
  const warnings: ImportWarning[] = [];
  const errors: ImportError[] = [];
  let out = text;

  out = rewriteImportMapValues(out, path, changes, errors);
  out = replaceWithLog(out, JSDELIVR_RE, path, "jsdelivr", (n, v, p) => rewritePackagePath(n, v, p), changes, errors);
  out = replaceWithLog(out, UNPKG_RE, path, "unpkg", (n, v, p) => rewritePackagePath(n, v, p), changes, errors);
  out = replaceWithLog(out, CDNJS_RE, path, "cdnjs", (n, v, p) => {
    const mapped = cdnjsPath(n, p);
    if (!mapped) return null;
    return rewritePackagePath(n, v, mapped);
  }, changes, errors);

  if (stripGoogleFonts) {
    const before = out.length;
    out = stripWithLog(out, GOOGLE_FONTS_PRECONNECT_RE, path, "google-fonts-strip", changes, "preconnect removed; vendor an OFL font instead");
    out = stripWithLog(out, GOOGLE_FONTS_LINK_RE, path, "google-fonts-strip", changes, "<link> removed; vendor an OFL font instead");
    out = stripWithLog(out, GOOGLE_FONTS_IMPORT_RE, path, "google-fonts-strip", changes, "@import removed; vendor an OFL font instead");
    if (out.length !== before) warnings.push({ code: "google-fonts-stripped", file: path, message: "Google Fonts references were removed; text falls back to the CSS font stack" });
  }

  detectForbiddenCdns(out, path, errors);
  const checkBare = options.detectBareImports ?? /\.html?$/i.test(path);
  if (checkBare) detectBareImports(out, path, errors, warnings);

  return { text: out, changes, warnings, errors };
}
