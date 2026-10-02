import { ageFromBirth, cardsForPrompt, type LearnerContext } from "@eco/contracts";
import type { ChildRow, MemoryRow, PersonalizationRow, Tier } from "@eco/db";

/** Build the minimal learner context generators are allowed to see. */
export function learnerContextFrom(
  child: ChildRow,
  context: PersonalizationRow[],
  memories: MemoryRow[] = [],
  tier: Tier = "free",
): LearnerContext {
  const folded = cardsForPrompt(
    context.map((row) => ({ kind: row.kind, value: row.value, active: row.active })),
    memories.map((row) => ({
      kind: row.kind,
      value: row.value,
      source: row.source,
      confidence: Number(row.confidence),
      lastSeenAt: row.last_seen_at,
      active: row.active,
    })),
    tier,
  );
  const age = child.birth_year != null && child.birth_month != null ? ageFromBirth(child.birth_year, child.birth_month) : child.age;
  return {
    displayName: child.display_name,
    age,
    readingLevel: child.reading_level,
    ...folded,
  };
}
