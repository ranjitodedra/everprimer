import type { LibraryVersionStatus } from "@eco/db";

/** Mirrors guard_library_version() in 0011_artifact_library.sql; the trigger is the authority. */
export const LIBRARY_TRANSITIONS: Readonly<Record<LibraryVersionStatus, readonly LibraryVersionStatus[]>> = {
  draft: ["testing"],
  testing: ["draft", "published"],
  published: ["retired"],
  retired: [],
};

export function canTransition(from: LibraryVersionStatus, to: LibraryVersionStatus): boolean {
  return LIBRARY_TRANSITIONS[from].includes(to);
}

export function transitionProblem(from: LibraryVersionStatus, to: LibraryVersionStatus): string | null {
  if (from === to) return `version is already ${to}`;
  if (canTransition(from, to)) return null;
  const allowed = LIBRARY_TRANSITIONS[from];
  return allowed.length
    ? `a ${from} version can only move to ${allowed.join(" or ")}, not ${to}`
    : `a ${from} version cannot change`;
}
