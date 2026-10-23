/**
 * Typed access to `packages/library/vendor/lock.json`. The lock list is the
 * ADR-003 allowlist of third-party libraries artifacts may use; the Stage 3
 * importer consults it to decide which CDN URLs may be rewritten and which
 * `name@version` pins the manifest may declare.
 *
 * The actual vendored bytes live in `packages/library/vendor/files/`, written
 * on demand by `scripts/vendor-sync.ts`. This module only reads metadata.
 */

import lockData from "../../vendor/lock.json" with { type: "json" };

export interface VendorPackage {
  name: string;
  version: string;
  license: string;
  licenseNotes?: string;
  tarball: string;
  tarballIntegrity: string | null;
  files: string[];
  /** Map `requested-path` → `alternative-path-in-tarball`, for `.min.js` files jsDelivr minifies on the fly. */
  minifyAliases?: Record<string, string>;
}

export interface VendorLock {
  lockVersion: 1;
  packages: VendorPackage[];
  /** cdnjs doesn't mirror npm layout; this maps cdnjs file names back to npm paths per package. */
  cdnjsFileMap: Record<string, Record<string, string>>;
}

const RAW = lockData as unknown as {
  lockVersion: number;
  packages: VendorPackage[];
  cdnjsFileMap: Record<string, Record<string, string> | string>;
};

function stripComments(map: Record<string, Record<string, string> | string>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k.startsWith("$") || typeof v !== "object" || v === null) continue;
    out[k] = v;
  }
  return out;
}

if (RAW.lockVersion !== 1) throw new Error(`unsupported vendor lock version: ${RAW.lockVersion}`);

export const VENDOR_LOCK: VendorLock = {
  lockVersion: 1,
  packages: RAW.packages,
  cdnjsFileMap: stripComments(RAW.cdnjsFileMap),
};

/** The index of allowlisted `name@version` pins, lowercased. */
const PIN_INDEX: ReadonlySet<string> = new Set(VENDOR_LOCK.packages.map((p) => `${p.name}@${p.version}`.toLowerCase()));

export function isAllowedPin(pin: string): boolean {
  return PIN_INDEX.has(pin.toLowerCase());
}

export function findVendorPackage(name: string, version: string): VendorPackage | undefined {
  return VENDOR_LOCK.packages.find((p) => p.name === name && p.version === version);
}

/** Known versions of a package, newest first (string sort is sufficient for our pins). */
export function versionsOf(name: string): string[] {
  return VENDOR_LOCK.packages
    .filter((p) => p.name === name)
    .map((p) => p.version)
    .sort()
    .reverse();
}

/** Resolve the npm-tarball path a cdnjs path maps to, or null when it isn't mapped. */
export function cdnjsPath(name: string, file: string): string | null {
  return VENDOR_LOCK.cdnjsFileMap[name]?.[file] ?? null;
}

/** Does the lock list say this package serves this file (allowing minify aliases)? */
export function hasVendoredFile(name: string, version: string, path: string): boolean {
  const pkg = findVendorPackage(name, version);
  if (!pkg) return false;
  if (pkg.minifyAliases?.[path]) return true;
  return pkg.files.some((f) => (f.endsWith("/") ? path.startsWith(f) : f === path));
}
