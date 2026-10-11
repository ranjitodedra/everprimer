import { z } from "zod";

/**
 * Age-band lesson limits. Content is written for ages 4 to 18. Hard
 * application rules: the planner may choose a shorter lesson but lint
 * rejects anything over them.
 */

export const AgeBand = z.enum(["4-6", "7-9", "10-12", "13-18"]);
export type AgeBand = z.infer<typeof AgeBand>;

export interface LessonLimits {
  sessions: number;
  minSessions: number;
  maxSessions: number;
  minBites: number;
  bitesPerSessionMin: number;
  bitesPerSessionMax: number;
  wordsPerBite: number;
  finalTestQuestions: number;
  minTaskShare: number;
  maxConceptClusters: number;
  /** Kept so stored v2 lessons still lint. */
  maxSections: number;
  maxGradedQuestions: number;
  wordsPerSection: number;
  wordsPerBlock: number;
}

export const LESSON_LIMITS: Record<AgeBand, LessonLimits> = {
  "4-6": {
    sessions: 3, minSessions: 3, maxSessions: 3, minBites: 21,
    bitesPerSessionMin: 5, bitesPerSessionMax: 8, wordsPerBite: 25,
    finalTestQuestions: 5, minTaskShare: 0.4, maxConceptClusters: 2,
    maxSections: 6, maxGradedQuestions: 4, wordsPerSection: 80, wordsPerBlock: 30,
  },
  "7-9": {
    sessions: 4, minSessions: 4, maxSessions: 4, minBites: 24,
    bitesPerSessionMin: 5, bitesPerSessionMax: 8, wordsPerBite: 45,
    finalTestQuestions: 8, minTaskShare: 0.4, maxConceptClusters: 3,
    maxSections: 8, maxGradedQuestions: 8, wordsPerSection: 180, wordsPerBlock: 70,
  },
  "10-12": {
    sessions: 4, minSessions: 4, maxSessions: 4, minBites: 24,
    bitesPerSessionMin: 5, bitesPerSessionMax: 8, wordsPerBite: 60,
    finalTestQuestions: 10, minTaskShare: 0.4, maxConceptClusters: 4,
    maxSections: 8, maxGradedQuestions: 8, wordsPerSection: 300, wordsPerBlock: 110,
  },
  "13-18": {
    sessions: 5, minSessions: 5, maxSessions: 5, minBites: 25,
    bitesPerSessionMin: 5, bitesPerSessionMax: 8, wordsPerBite: 80,
    finalTestQuestions: 12, minTaskShare: 0.4, maxConceptClusters: 5,
    maxSections: 9, maxGradedQuestions: 8, wordsPerSection: 450, wordsPerBlock: 160,
  },
};

/** Content age: younger than 4 reads as 4, older than 18 reads as 18. */
export function clampLearnerAge(age: number | null | undefined): number {
  if (age == null || !Number.isFinite(age)) return 10;
  return Math.min(18, Math.max(4, Math.round(age)));
}

/** Unknown age plans for the middle band. */
export function ageBandFor(age: number | null | undefined): AgeBand {
  const a = clampLearnerAge(age);
  if (a <= 6) return "4-6";
  if (a <= 9) return "7-9";
  if (a <= 12) return "10-12";
  return "13-18";
}

export function limitsFor(age: number | null | undefined): LessonLimits {
  return LESSON_LIMITS[ageBandFor(age)];
}

export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export const FINAL_TEST_PASS = 0.7;

/** Kept so stored v2 lessons with image blocks still lint. */
export const MAX_LESSON_IMAGES = 3;
