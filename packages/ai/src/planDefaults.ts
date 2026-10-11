import {
  LESSON_LIMITS,
  ageBandFor,
  isGameBlueprint,
  type AgeBand,
  type ArtifactBlueprint,
  type BiteType,
  type LearningScope,
  type LessonPlan,
  type ObjectiveDepth,
  type ObjectiveIntent,
  type PlanSession,
  type QuestionKind,
  type ReadingLevel,
} from "@eco/contracts";

/**
 * Deterministic plans. `defaultLessonPlan` is the safe structure used when the
 * planner model cannot produce a valid plan; `planFromBlueprint` describes an
 * existing (seeded) blueprint as the plan it implements, for the mock provider.
 */

const INTENT_PATTERNS: Array<[RegExp, ObjectiveIntent]> = [
  [/^(apply|use|solve|design|build|plan|calculate)\b/i, "apply"],
  [/^(predict|estimate|forecast)\b/i, "predict"],
  [/^(compare|contrast|distinguish|differentiate)\b/i, "compare"],
  [/^(order|sequence|arrange|rank|put)\b/i, "sequence"],
  [/^explain\b.*\b(how|process|cycle|steps|happens|works|changes|causes)\b/i, "explain_process"],
  [/^(explain|describe|summari[sz]e|understand|justify)\b/i, "explain"],
];

export function classifyIntent(text: string): ObjectiveIntent {
  const trimmed = text.trim();
  for (const [pattern, intent] of INTENT_PATTERNS) if (pattern.test(trimmed)) return intent;
  return "identify";
}

function depthFor(intent: ObjectiveIntent, scope: LearningScope): ObjectiveDepth {
  if (intent === "apply") return "transfer";
  if (intent === "identify") return "recognize";
  if (intent === "compare" || intent === "sequence") return scope === "mastery" ? "explain" : "recognize";
  return "explain";
}

export interface DefaultPlanInput {
  objectives: string[];
  age: number | null;
  readingLevel: ReadingLevel | null;
  scope: LearningScope;
  framingInterest: string | null;
}

/** Bite kinds that always satisfy coverage: representation, explanation, apply, and 40%+ tasks. */
export function defaultBiteKinds(band: AgeBand): BiteType[] {
  const limits = LESSON_LIMITS[band];
  const per = Math.max(limits.bitesPerSessionMin, Math.ceil(limits.minBites / limits.sessions));
  const kinds: BiteType[] = ["explore", "quiz", "simple_explain", "quiz", "apply"];
  const extras: BiteType[] = ["key_points", "quiz", "mnemonic"];
  let e = 0;
  while (kinds.length < per) {
    kinds.splice(kinds.length - 1, 0, extras[e % extras.length]!);
    e += 1;
  }
  return kinds.slice(0, per);
}

/** A plain plan that always satisfies lintLessonPlan for a single cluster. */
export function defaultLessonPlan(input: DefaultPlanInput): LessonPlan {
  const band = ageBandFor(input.age);
  const limits = LESSON_LIMITS[band];
  const biteKinds = defaultBiteKinds(band);
  const taskCount = biteKinds.filter((k) => k === "quiz" || k === "apply").length;
  const codes = input.objectives.map((_, i) => `lo${i + 1}`);
  const objectives = input.objectives.map((text, i) => {
    const intent = classifyIntent(text);
    return { code: codes[i]!, intent, depth: depthFor(intent, input.scope) };
  });
  if (input.scope === "mastery" && !objectives.some((o) => o.depth === "transfer")) {
    objectives[objectives.length - 1]!.depth = "transfer";
  }

  const sessions: PlanSession[] = Array.from({ length: limits.sessions }, (_, n) => ({
    id: `sess_${n + 1}`,
    title: `Round ${n + 1}`,
    emoji: ["🌟", "🔍", "🎯", "🚀", "🏆"][n] ?? "✨",
    purpose: "teach then try",
    objectiveCodes: codes,
    biteKinds: [...biteKinds],
    taskCount,
  }));

  const finalKinds: QuestionKind[] = ["mcq", "true_false"];
  return {
    planVersion: 2,
    mode: "single",
    scope: input.scope,
    rationale: "Default structure: short sessions that teach then try, then a final test.",
    conceptClusters: [{ id: "c1", title: "Main idea", objectiveCodes: codes }],
    objectives,
    learnerConstraints: {
      ageBand: band,
      readingLevel: input.readingLevel,
      textBudget: limits.wordsPerBite,
      misconceptionIds: [],
      framingInterest: input.framingInterest,
    },
    sessions,
    finalTest: { questionCount: limits.finalTestQuestions, objectiveCodes: codes, questionKinds: finalKinds },
    recall: [],
  };
}

/** The plan a finished blueprint implements. Used for seeded mock lessons. */
export function planFromBlueprint(bp: ArtifactBlueprint, input: { scope: LearningScope; framingInterest: string | null }): LessonPlan {
  const band = ageBandFor(bp.audience.age);
  const limits = LESSON_LIMITS[band];
  const codes = bp.learningObjectives.map((o) => o.code);
  if (!isGameBlueprint(bp)) {
    return defaultLessonPlan({
      objectives: bp.learningObjectives.map((o) => o.text),
      age: bp.audience.age,
      readingLevel: bp.audience.readingLevel,
      scope: input.scope,
      framingInterest: input.framingInterest,
    });
  }
  return {
    planVersion: 2,
    mode: "single",
    scope: input.scope,
    rationale: "Seeded lesson: the plan mirrors the hand-checked blueprint.",
    conceptClusters: [{ id: "c1", title: bp.title, objectiveCodes: codes }],
    objectives: bp.learningObjectives.map((o) => {
      const intent = classifyIntent(o.text);
      return { code: o.code, intent, depth: depthFor(intent, input.scope) };
    }),
    learnerConstraints: {
      ageBand: band,
      readingLevel: bp.audience.readingLevel,
      textBudget: limits.wordsPerBite,
      misconceptionIds: [],
      framingInterest: input.framingInterest,
    },
    sessions: bp.sessions.map((s) => ({
      id: s.id,
      title: s.title,
      emoji: s.emoji,
      purpose: s.opener,
      objectiveCodes: s.objectiveCodes,
      biteKinds: s.bites.map((b) => b.type),
      taskCount: s.bites.filter((b) => b.type === "quiz" || b.type === "apply").length,
    })),
    finalTest: {
      questionCount: bp.finalTest.questions.length,
      objectiveCodes: codes,
      questionKinds: [...new Set(bp.finalTest.questions.map((q) => q.kind))],
    },
    recall: [],
  };
}
