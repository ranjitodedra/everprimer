import { z } from "zod";

export const ReadingLevel = z.enum(["pre_reader", "early", "developing", "fluent", "advanced"]);
export type ReadingLevel = z.infer<typeof ReadingLevel>;

export const PersonalizationKind = z.enum(["interest", "preference", "note"]);
export type PersonalizationKind = z.infer<typeof PersonalizationKind>;

/** Everything a generator is allowed to know about the learner. Deliberately minimal (rules.md section 14). */
export const LearnerContext = z.object({
  displayName: z.string().min(1).max(40),
  age: z.number().int().min(3).max(120).nullable(),
  readingLevel: ReadingLevel.nullable(),
  interests: z.array(z.string().max(200)).max(10),
  notes: z.array(z.string().max(200)).max(10),
  strengths: z.array(z.string().max(200)).max(5).default([]),
  misconceptions: z.array(z.string().max(200)).max(8).default([]),
  analogies: z.array(z.string().max(200)).max(5).default([]),
});
export type LearnerContext = z.infer<typeof LearnerContext>;
