import { LibraryArtifactId } from "@eco/contracts";

export const LIBRARY_BUCKET = "library";

const MAX_PATH_LENGTH = 200;

/** A relative POSIX path inside a bundle: no leading slash, no `.` or `..` segments, no backslashes or control characters. */
export function isSafeObjectPath(path: string): boolean {
  if (!path || path.length > MAX_PATH_LENGTH) return false;
  if (path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function versionPrefix(kind: "bundles" | "previews", artifactId: string, version: number): string {
  if (!LibraryArtifactId.safeParse(artifactId).success) throw new Error(`invalid library artifact id: ${artifactId}`);
  if (!Number.isInteger(version) || version < 1) throw new Error(`invalid library version: ${version}`);
  return `${kind}/${artifactId}/${version}`;
}

export function bundleObjectPath(artifactId: string, version: number, file: string): string {
  if (!isSafeObjectPath(file)) throw new Error(`unsafe bundle path: ${file}`);
  return `${versionPrefix("bundles", artifactId, version)}/${file}`;
}

export function previewObjectPath(artifactId: string, version: number): string {
  return `${versionPrefix("previews", artifactId, version)}/thumb.webp`;
}
