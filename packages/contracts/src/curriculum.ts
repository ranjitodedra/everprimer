import { z } from "zod";

/**
 * Curriculum shapes. `GeneratedCurriculum` is what the model returns;
 * the database rows add ids, ownership and status on top.
 */

export const TopicSlug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case");

export const GeneratedTopic = z.object({
  slug: TopicSlug.describe("Stable kebab-case identifier unique within the curriculum"),
  title: z.string().min(2).max(80),
  description: z.string().min(10).max(400),
  difficulty: z.number().int().min(1).max(5).describe("1 = easiest, 5 = hardest"),
  prerequisites: z
    .array(TopicSlug)
    .default([])
    .describe("Slugs of topics in this curriculum that should be completed first"),
  learningObjectives: z
    .array(z.string().min(5).max(200))
    .min(2)
    .max(6)
    .describe("Observable outcomes; start with a verb (Identify, Explain, Compare...)"),
});
export type GeneratedTopic = z.infer<typeof GeneratedTopic>;

export const GeneratedCurriculum = z.object({
  title: z.string().min(2).max(80),
  description: z.string().min(10).max(400),
  topics: z.array(GeneratedTopic).min(3).max(20),
});
export type GeneratedCurriculum = z.infer<typeof GeneratedCurriculum>;

/**
 * Why the learner is studying this. Scope shapes both how broad the curriculum
 * is and how deep each lesson goes. It never maps to a fixed lesson count.
 */
export const LearningScope = z.enum(["overview", "hobby", "exam", "mastery"]);
export type LearningScope = z.infer<typeof LearningScope>;

export const SCOPE_GUIDANCE: Record<LearningScope, string> = {
  overview: "broad coverage, shallow depth: recognise and name the big ideas",
  hobby: "useful breadth plus interesting exploration: curiosity first, fewer drills",
  exam: "required coverage plus enough practice to demonstrate every objective",
  mastery: "deeper concept decomposition: explanation, practice and transfer to new situations",
};

/** What a grown-up types when adding a learning goal. */
export const GoalInput = z.object({
  goal: z.string().trim().min(5).max(600),
  scope: LearningScope,
  scopeNote: z.string().trim().max(300).optional(),
  interest: z.string().trim().max(120).optional(),
});
export type GoalInput = z.infer<typeof GoalInput>;

export const TopicKind = z.enum(["lesson", "unit"]);
export type TopicKind = z.infer<typeof TopicKind>;

export const TopicStatus = z.enum(["locked", "not_started", "in_progress", "needs_review", "completed"]);
export type TopicStatus = z.infer<typeof TopicStatus>;

export const CurriculumStatus = z.enum(["generating", "ready", "failed"]);
export type CurriculumStatus = z.infer<typeof CurriculumStatus>;
