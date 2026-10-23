import { z } from "zod";
import { LibraryArtifactId } from "./blueprint";
import { ArtifactEventData, ArtifactEventName } from "./library";

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
  "artifact_interaction",
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

/**
 * An event a library artifact sent, relayed by the lesson player. Stored as
 * tutor and analytics evidence; never graded.
 */
export const ArtifactInteractionPayload = z.object({
  libraryArtifactId: LibraryArtifactId,
  version: z.number().int().min(1),
  name: ArtifactEventName,
  data: ArtifactEventData.default({}),
});
export type ArtifactInteractionPayload = z.infer<typeof ArtifactInteractionPayload>;

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

/**
 * What the learner is looking at, sent by the artifact so the live tutor can
 * talk about the current screen. Explanations are only included once the
 * learner has answered, so the tutor cannot give answers away early.
 */
export const TutorContext = z.object({
  screen: z.enum(["section", "map", "bite", "session_done", "final", "score"]),
  title: z.string().max(200).optional(),
  sessionTitle: z.string().max(200).optional(),
  biteType: z.string().max(40).optional(),
  text: z.string().max(1500).optional(),
  question: z
    .object({
      prompt: z.string().max(600),
      options: z.array(z.string().max(200)).max(12).optional(),
      hint: z.string().max(300).optional(),
    })
    .optional(),
  answered: z.boolean().optional(),
  correct: z.boolean().optional(),
  explanation: z.string().max(600).optional(),
  progress: z
    .object({
      round: z.number().int().min(0).max(50),
      rounds: z.number().int().min(0).max(50),
    })
    .optional(),
});
export type TutorContext = z.infer<typeof TutorContext>;

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
  z.object({
    source: z.literal(LEARNKIT_SOURCE),
    v: z.literal(LEARNKIT_PROTOCOL_VERSION),
    kind: z.literal("context"),
    nonce: z.string(),
    context: TutorContext,
  }),
]);
export type LearnKitMessage = z.infer<typeof LearnKitMessage>;

/** Inline image the sandbox can show under its `img-src data:` policy. */
export const TutorImageDataUri = z
  .string()
  .max(8_000_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/);

/** Sent host -> artifact once both character poses have loaded. */
export const HostTutorArtMessage = z.object({
  source: z.literal("learnkit-host"),
  v: z.literal(LEARNKIT_PROTOCOL_VERSION),
  kind: z.literal("tutor_art"),
  talk: TutorImageDataUri,
  teach: TutorImageDataUri,
  /** Transparent poses stand on the page; without it the player blends the white background away. */
  cutout: z.boolean().default(false),
});
export type HostTutorArtMessage = z.infer<typeof HostTutorArtMessage>;

export const TutorVoiceState = z.enum(["idle", "listening", "thinking", "speaking"]);
export type TutorVoiceState = z.infer<typeof TutorVoiceState>;

/** Sent host -> artifact while a live voice session runs; drives the character's glow. */
export const HostTutorStateMessage = z.object({
  source: z.literal("learnkit-host"),
  v: z.literal(LEARNKIT_PROTOCOL_VERSION),
  kind: z.literal("tutor_state"),
  state: TutorVoiceState,
});
export type HostTutorStateMessage = z.infer<typeof HostTutorStateMessage>;

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
