/**
 * A lesson counts as done on path and curriculum cards once the learner has
 * reached the end. Needs-review is still finished; mastery stays a separate signal.
 */
export function lessonFinished(
  progress: { status?: string | null; reached_end?: boolean | null } | null | undefined,
): boolean {
  if (!progress) return false;
  return progress.reached_end === true || progress.status === "completed" || progress.status === "needs_review";
}
