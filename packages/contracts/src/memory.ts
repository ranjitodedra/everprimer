import { z } from "zod";

export const MemoryKind = z.enum(["interest", "preference", "strength", "misconception", "analogy_that_worked"]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.enum(["parent", "inferred"]);
export type MemorySource = z.infer<typeof MemorySource>;

/** What one compaction pass may change. The server drops anything outside this shape. */
export const MemoryUpdate = z.object({
  upserts: z
    .array(
      z.object({
        kind: MemoryKind,
        value: z.string().trim().min(1).max(200),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(8),
  deactivate: z
    .array(
      z.object({
        kind: MemoryKind,
        value: z.string().trim().min(1).max(200),
      }),
    )
    .max(8),
});
export type MemoryUpdate = z.infer<typeof MemoryUpdate>;

export const MEMORY_PROMPT_CAPS = {
  interests: 10,
  notes: 10,
  strengths: 5,
  misconceptions: 8,
  analogies: 5,
} as const;

/**
 * Completed years as of `today` (UTC). The birthday is the first of `month`.
 * Matches `public.age_from_birth`.
 */
export function ageFromBirth(year: number, month: number, today = new Date()): number {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  let age = y - year;
  if (m < month) age -= 1;
  return age;
}

/**
 * Health, family, address, school, religion, friends, and emotions.
 * A match drops the proposal. False positives are preferred to storing them.
 */
const FORBIDDEN_MEMORY = [
  /\b(adhd|autis\w*|anxiet\w*|depression|allerg\w*|medications?|medicines?|therap\w*|illness(?:es)?|diseases?|cancer|diabetes|asthma|disabilit\w*|hospitals?|diagnos\w*|symptoms?|doctors?|psychiatr\w*)\b/i,
  /\b(moms?|dads?|mothers?|fathers?|brothers?|sisters?|siblings?|grandmas?|grandpas?|grandmothers?|grandfathers?|uncles?|aunts?|cousins?|famil(?:y|ies)|divorc\w*|stepfathers?|stepmothers?|parents?)\b/i,
  /\b(address(?:es)?|streets?|avenues?|zip ?codes?|postals?|apartments?|lives at)\b/i,
  /\b(schools?|teachers?|classrooms?|classmates?|principals?|homework)\b/i,
  /\b(church(?:es)?|mosques?|temples?|synagogues?|prayers?|christians?|muslims?|jewish|hindu|buddhists?|bibles?|qurans?|korans?|religions?|religious|gods?)\b/i,
  /\b(friends?|boyfriends?|girlfriends?|crushes|besties?|buddies)\b/i,
  /\b(sad|angry|scared|lonely|anxious|upset|cried|crying|frustrated|embarrassed|worried|depressed|happy|excited|emotions?)\b/i,
  /\b\d{1,5}\s+\w+\s+(st|street|ave|avenue|rd|road|dr|drive|ln|lane)\b/i,
  /\b[\w.+-]+@[\w.-]+\.\w+\b/,
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
];

export function isForbiddenMemory(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  return FORBIDDEN_MEMORY.some((pattern) => pattern.test(text));
}

export interface PromptPersonalization {
  kind: "interest" | "preference" | "note";
  value: string;
  active: boolean;
}

export interface PromptMemoryCard {
  kind: MemoryKind;
  value: string;
  source: MemorySource;
  confidence: number;
  lastSeenAt: string;
  active: boolean;
}

export interface PromptLearnerFields {
  interests: string[];
  notes: string[];
  strengths: string[];
  misconceptions: string[];
  analogies: string[];
}

function dedupe(values: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Parent personalization always loads. Parent-sourced cards load on every tier.
 * Inferred cards load only for Plus and Max, highest confidence and newest first.
 */
export function cardsForPrompt(
  personalization: PromptPersonalization[],
  memories: PromptMemoryCard[],
  tier: "free" | "paid" | "max",
): PromptLearnerFields {
  const activeNotes = personalization.filter((row) => row.active);
  const activeCards = memories.filter((row) => row.active && (row.source === "parent" || tier !== "free"));
  const ranked = [...activeCards].sort((a, b) => {
    if (a.source !== b.source) return a.source === "parent" ? -1 : 1;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });
  const ofKind = (kind: MemoryKind) => ranked.filter((row) => row.kind === kind).map((row) => row.value);

  return {
    interests: dedupe(
      [...activeNotes.filter((row) => row.kind === "interest").map((row) => row.value), ...ofKind("interest")],
      MEMORY_PROMPT_CAPS.interests,
    ),
    notes: dedupe(
      [...activeNotes.filter((row) => row.kind !== "interest").map((row) => row.value), ...ofKind("preference")],
      MEMORY_PROMPT_CAPS.notes,
    ),
    strengths: dedupe(ofKind("strength"), MEMORY_PROMPT_CAPS.strengths),
    misconceptions: dedupe(ofKind("misconception"), MEMORY_PROMPT_CAPS.misconceptions),
    analogies: dedupe(ofKind("analogy_that_worked"), MEMORY_PROMPT_CAPS.analogies),
  };
}
