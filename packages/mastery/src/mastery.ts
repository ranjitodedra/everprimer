import { FINAL_TEST_PASS } from "@eco/contracts";

/**
 * Explainable mastery estimation (rules.md sections 9 and 22).
 *
 * Every piece of evidence nudges a per-objective score using an exponential
 * moving average whose step size depends on how informative the evidence is:
 * harder items, first attempts and unaided answers count more. Time on task is
 * never an input. "Mastered" additionally requires evidence from at least two
 * different activity types, so ten memorised quiz answers are not enough.
 */

export type ActivityType = "quiz" | "apply" | "explore" | "review";

export interface ObjectiveEvidence {
  correct: boolean;
  /** 1 easy .. 3 hard */
  difficulty: 1 | 2 | 3;
  attempt: number;
  hintsUsed: number;
  /** The answer was shown to the learner instead of being produced by them. */
  revealed?: boolean;
  activityType: ActivityType;
  /** First-attempt answers on the lesson's final test weigh more. */
  finalTest?: boolean;
  /** Milliseconds since this objective was last practised, if known. */
  msSinceLastEvidence?: number;
}

export type MasteryStatus = "unknown" | "developing" | "proficient" | "mastered";

export interface ObjectiveMasteryState {
  score: number; // 0..1
  evidenceCount: number;
  activityTypes: ActivityType[];
  status: MasteryStatus;
}

export const EMPTY_MASTERY: ObjectiveMasteryState = {
  score: 0,
  evidenceCount: 0,
  activityTypes: [],
  status: "unknown",
};

const BASE_ALPHA = 0.35;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** How much one piece of evidence should move the estimate. */
export function evidenceWeight(e: ObjectiveEvidence): number {
  const difficulty = e.difficulty === 3 ? 1.25 : e.difficulty === 2 ? 1 : 0.8;
  const attempt = e.attempt <= 1 ? 1 : e.attempt === 2 ? 0.6 : 0.35;
  const hints = e.hintsUsed === 0 ? 1 : 0.5;
  // Correct answers after a gap are stronger evidence of retention.
  const delay =
    e.correct && e.msSinceLastEvidence !== undefined && e.msSinceLastEvidence >= ONE_DAY_MS ? 1.3 : 1;
  const exam = e.finalTest ? 1.4 : 1;
  const w = difficulty * attempt * hints * delay * exam;
  return Math.min(1.5, Math.max(0.15, w));
}

export function statusFor(score: number, evidenceCount: number, activityTypes: readonly ActivityType[]): MasteryStatus {
  if (evidenceCount === 0) return "unknown";
  if (score >= 0.8 && evidenceCount >= 3 && new Set(activityTypes).size >= 2) return "mastered";
  if (score >= 0.6 && evidenceCount >= 2) return "proficient";
  return "developing";
}

export function applyEvidence(state: ObjectiveMasteryState, e: ObjectiveEvidence): ObjectiveMasteryState {
  // A revealed answer is treated as an incorrect, low-weight observation.
  const correct = e.revealed ? false : e.correct;
  const weight = e.revealed ? 0.25 : evidenceWeight(e);
  const target = correct ? 1 : 0;
  const alpha = Math.min(0.9, BASE_ALPHA * weight);
  const score = clamp01(state.score + alpha * (target - state.score));
  const activityTypes = state.activityTypes.includes(e.activityType)
    ? state.activityTypes
    : [...state.activityTypes, e.activityType];
  const evidenceCount = state.evidenceCount + 1;
  return { score, evidenceCount, activityTypes, status: statusFor(score, evidenceCount, activityTypes) };
}

export interface TopicSummary {
  mastery: number; // mean objective score, 0..1
  objectivesAssessed: number;
  objectivesTotal: number;
  weakObjectiveCodes: string[];
}

export function summarizeTopic(objectives: Array<{ code: string; state: ObjectiveMasteryState }>): TopicSummary {
  const assessed = objectives.filter((o) => o.state.evidenceCount > 0);
  const mastery = assessed.length === 0 ? 0 : assessed.reduce((s, o) => s + o.state.score, 0) / assessed.length;
  const weak = assessed.filter((o) => o.state.evidenceCount >= 2 && o.state.score < 0.45).map((o) => o.code);
  return {
    mastery,
    objectivesAssessed: assessed.length,
    objectivesTotal: objectives.length,
    weakObjectiveCodes: weak,
  };
}

export type TopicProgressStatus = "not_started" | "in_progress" | "needs_review" | "completed";

/**
 * Topic status is driven by whether the learner reached the end AND what the
 * evidence says, not by time or by a single quiz score.
 */
export function topicStatus(
  summary: TopicSummary,
  reachedEnd: boolean,
  hasActivity: boolean,
  finalScore?: number | null,
): TopicProgressStatus {
  if (!hasActivity) return "not_started";
  if (finalScore != null) {
    if (finalScore >= FINAL_TEST_PASS) return "completed";
    return "needs_review";
  }
  if (!reachedEnd) return "in_progress";
  if (summary.weakObjectiveCodes.length > 0 || summary.mastery < 0.6) return "needs_review";
  return "completed";
}

export interface LessonFeedback {
  mastery: number;
  objectives: Array<{ code: string; text: string; status: MasteryStatus; score: number }>;
  /** Objective texts the learner showed they can do. */
  strong: string[];
  /** Objective texts that come back in upcoming lessons as recall. */
  practice: string[];
  kid: string;
  parent: string;
}

/**
 * End-of-lesson feedback for the learner and the grown-up, built only from
 * mastery evidence. Deterministic so it never invents how the lesson went.
 */
export function buildLessonFeedback(
  topicTitle: string,
  objectives: Array<{ code: string; text: string; state: ObjectiveMasteryState }>,
): LessonFeedback {
  const summary = summarizeTopic(objectives);
  const rows = objectives.map((o) => ({ code: o.code, text: o.text, status: o.state.status, score: Number(o.state.score.toFixed(3)) }));
  const assessed = objectives.filter((o) => o.state.evidenceCount > 0);
  const strong = assessed.filter((o) => o.state.score >= 0.6).map((o) => o.text);
  const practice = assessed.filter((o) => o.state.score < 0.6 || summary.weakObjectiveCodes.includes(o.code)).map((o) => o.text);
  const pct = Math.round(summary.mastery * 100);

  const kid =
    practice.length === 0
      ? `You finished ${topicTitle} and got the big ideas. Nice thinking!`
      : `You finished ${topicTitle}. You've got ${strong.length} idea${strong.length === 1 ? "" : "s"} down. We'll practise "${practice[0]}" again soon.`;
  const parent = [
    `Finished "${topicTitle}" with an estimated mastery of ${pct}%.`,
    strong.length ? `Showed: ${strong.join("; ")}.` : "No objective is secure yet.",
    practice.length ? `Needs more practice: ${practice.join("; ")}. These come back as recall questions in the next lessons.` : "Nothing flagged for extra practice.",
  ].join(" ");

  return { mastery: Number(summary.mastery.toFixed(3)), objectives: rows, strong, practice, kid, parent };
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}
