import { z } from "zod";

/**
 * Learning events are the only channel from an artifact back to the platform.
 * They are emitted inside the sandbox, relayed by the host page, and ingested
 * in batches. `clientEventId` makes ingestion idempotent.
 */

export const LearningEventType = z.enum([
  "topic_opened",
  "lesson_started",
  "section_viewed",
  "animation_started",
  "animation_completed",
  "flashcard_viewed",
  "flashcard_recalled",
  "item_explored",
  "activity_started",
  "activity_completed",
  "question_answered",
  "hint_requested",
  "answer_revealed",
  "quiz_started",
  "quiz_completed",
  "session_completed",
  "final_test_completed",
  "topic_completed",
  "review_completed",
]);
export type LearningEventType = z.infer<typeof LearningEventType>;

/** The learner's submitted answer, shape depends on question kind. */
export const SubmittedAnswer = z.union([
  z.string(), // mcq option id or short answer text
  z.boolean(), // true/false
  z.array(z.string()), // ordering
]);
export type SubmittedAnswer = z.infer<typeof SubmittedAnswer>;

export const QuestionAnsweredPayload = z.object({
  activityId: z.string(),
  questionId: z.string(),
  answer: SubmittedAnswer,
  attempt: z.number().int().min(1),
  hintsUsed: z.number().int().min(0).default(0),
  latencyMs: z.number().int().min(0).optional(),
  /** Client-side verdict for instant feedback; the server re-grades and is authoritative. */
  clientCorrect: z.boolean().optional(),
});
export type QuestionAnsweredPayload = z.infer<typeof QuestionAnsweredPayload>;

export const FlashcardRecalledPayload = z.object({
  activityId: z.string(),
  cardId: z.string(),
  recalled: z.boolean(),
});

export const ItemExploredPayload = z.object({
  activityId: z.string(),
  itemId: z.string(),
});

export const LearningEvent = z.object({
  clientEventId: z.string().uuid(),
  type: LearningEventType,
  occurredAt: z.string().datetime(),
  sectionId: z.string().optional(),
  activityId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type LearningEvent = z.infer<typeof LearningEvent>;

export const EventBatch = z.object({
  sessionId: z.string().uuid(),
  events: z.array(LearningEvent).min(1).max(200),
});
export type EventBatch = z.infer<typeof EventBatch>;

/** postMessage envelope used between the sandboxed artifact and the host page. */
export const LEARNKIT_SOURCE = "learnkit" as const;
export const LEARNKIT_PROTOCOL_VERSION = 1 as const;

export const LearnKitMessage = z.discriminatedUnion("kind", [
  z.object({
    source: z.literal(LEARNKIT_SOURCE),
    v: z.literal(LEARNKIT_PROTOCOL_VERSION),
    kind: z.literal("ready"),
  }),
  z.object({
    source: z.literal(LEARNKIT_SOURCE),
    v: z.literal(LEARNKIT_PROTOCOL_VERSION),
    kind: z.literal("event"),
    nonce: z.string(),
    event: LearningEvent,
  }),
  z.object({
    source: z.literal(LEARNKIT_SOURCE),
    v: z.literal(LEARNKIT_PROTOCOL_VERSION),
    kind: z.literal("resize"),
    height: z.number(),
  }),
]);
export type LearnKitMessage = z.infer<typeof LearnKitMessage>;

/** Sent host -> artifact once the iframe has loaded. */
export const HostInitMessage = z.object({
  source: z.literal("learnkit-host"),
  v: z.literal(LEARNKIT_PROTOCOL_VERSION),
  kind: z.literal("init"),
  nonce: z.string(),
  topicId: z.string(),
  artifactId: z.string(),
  reducedMotion: z.boolean(),
  /** Session index the player should open on (0-based). */
  startSession: z.number().int().min(0).optional(),
});
export type HostInitMessage = z.infer<typeof HostInitMessage>;
