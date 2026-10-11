import { z } from "zod";
import {
  BiteType,
  ObjectiveCode,
  QuestionKind,
  TEACHING_SECTION_TYPES,
  VisualKind,
  collectQuestions,
  isGameBlueprint,
  type ArtifactBlueprint,
  type Bite,
} from "./blueprint";
import { ReadingLevel } from "./child";
import { LearningScope } from "./curriculum";
import { AgeBand, LESSON_LIMITS, ageBandFor } from "./limits";

/**
 * LessonPlan is the structural decision for one lesson, made before any
 * child-facing content exists. Version 2 outlines sessions of bites and a
 * final test. The blueprint then implements this plan exactly.
 */

export const ObjectiveIntent = z.enum(["identify", "explain", "explain_process", "compare", "sequence", "predict", "apply"]);
export type ObjectiveIntent = z.infer<typeof ObjectiveIntent>;

export const ObjectiveDepth = z.enum(["recognize", "explain", "transfer"]);
export type ObjectiveDepth = z.infer<typeof ObjectiveDepth>;

export const MisconceptionId = z.string().regex(/^m[1-9]\d?$/, "misconception ids look like m1, m2, ...");

export const PlanObjective = z.object({
  code: ObjectiveCode,
  intent: ObjectiveIntent.describe("What the learner actually has to do"),
  depth: ObjectiveDepth.describe("recognize = pick it out; explain = say why/how; transfer = use it somewhere new"),
});
export type PlanObjective = z.infer<typeof PlanObjective>;

export const PlanSession = z.object({
  id: z.string().min(3).max(40).describe("Unique, starts with sess_"),
  title: z.string().min(1).max(80),
  emoji: z.string().min(1).max(8),
  purpose: z.string().min(3).max(200),
  objectiveCodes: z.array(ObjectiveCode).min(1).max(6),
  biteKinds: z.array(BiteType).min(5).max(8),
  taskCount: z.number().int().min(1).max(6),
});
export type PlanSession = z.infer<typeof PlanSession>;

export const PlanFinalTest = z.object({
  questionCount: z.number().int().min(4).max(12),
  objectiveCodes: z.array(ObjectiveCode).min(1).max(6),
  questionKinds: z.array(QuestionKind).min(1).max(6),
});
export type PlanFinalTest = z.infer<typeof PlanFinalTest>;

export const ConceptCluster = z.object({
  id: z.string().regex(/^c[1-9]\d?$/, "cluster ids look like c1, c2, ..."),
  title: z.string().min(2).max(80),
  objectiveCodes: z.array(ObjectiveCode).min(1).max(6),
});
export type ConceptCluster = z.infer<typeof ConceptCluster>;

export const ChildTopicProposal = z.object({
  clusterId: z.string(),
  title: z.string().min(2).max(80),
  description: z.string().min(10).max(400),
  objectiveTexts: z.array(z.string().min(5).max(200)).min(2).max(6),
});
export type ChildTopicProposal = z.infer<typeof ChildTopicProposal>;

export const LearnerConstraints = z.object({
  ageBand: AgeBand,
  readingLevel: ReadingLevel.nullable(),
  textBudget: z.number().int().min(10).max(200).describe("Max words per bite"),
  misconceptionIds: z.array(MisconceptionId).max(8),
  framingInterest: z.string().max(120).nullable(),
});
export type LearnerConstraints = z.infer<typeof LearnerConstraints>;

export const LessonPlan = z.object({
  planVersion: z.literal(2),
  mode: z.enum(["single", "sub_index"]),
  scope: LearningScope,
  rationale: z.string().min(10).max(400).describe("One or two sentences on why this structure fits"),
  splitReason: z.string().max(400).optional(),
  conceptClusters: z.array(ConceptCluster).min(1).max(8),
  proposedChildTopics: z.array(ChildTopicProposal).max(8).optional(),
  objectives: z.array(PlanObjective).min(1).max(6),
  learnerConstraints: LearnerConstraints,
  sessions: z.array(PlanSession).max(5),
  finalTest: PlanFinalTest.optional(),
  recall: z
    .array(z.object({ objectiveId: z.string().min(1).max(64), reason: z.string().max(200) }))
    .max(2)
    .describe("Earlier-lesson objectives to revisit with one recall question each"),
});
export type LessonPlan = z.infer<typeof LessonPlan>;

export interface PlanLintContext {
  objectiveCodes: string[];
  age: number | null;
  scope: LearningScope;
  allowImages?: boolean;
  recallCandidateIds?: string[];
  misconceptionIds?: string[];
}

const EXPLANATION_TYPES = ["explain", "simple_explain"] as const;
const TASK_TYPES = new Set<string>(["quiz", "apply"]);

function covers(sessions: PlanSession[], code: string, pred: (kind: BiteType) => boolean): boolean {
  return sessions.some((s) => s.objectiveCodes.includes(code) && s.biteKinds.some(pred));
}

/** Hard rules the planner cannot override. Returns human-readable problems; empty means valid. */
export function lintLessonPlan(plan: LessonPlan, ctx: PlanLintContext): string[] {
  const problems: string[] = [];
  const band = ageBandFor(ctx.age);
  const limits = LESSON_LIMITS[band];
  const expected = new Set(ctx.objectiveCodes);

  if (plan.scope !== ctx.scope) problems.push(`plan scope "${plan.scope}" must be the requested scope "${ctx.scope}"`);
  if (plan.learnerConstraints.ageBand !== band) problems.push(`learnerConstraints.ageBand must be "${band}"`);
  if (plan.learnerConstraints.textBudget > limits.wordsPerBite) {
    problems.push(`learnerConstraints.textBudget ${plan.learnerConstraints.textBudget} exceeds ${limits.wordsPerBite} words for ages ${band}`);
  }
  const knownMisconceptions = new Set(ctx.misconceptionIds ?? []);
  for (const id of plan.learnerConstraints.misconceptionIds) {
    if (!knownMisconceptions.has(id)) problems.push(`unknown misconception id ${id}`);
  }

  const planned = plan.objectives.map((o) => o.code);
  if (new Set(planned).size !== planned.length) problems.push("objectives list has duplicate codes");
  for (const code of planned) if (!expected.has(code)) problems.push(`plan introduces objective ${code}, which is not in this topic`);
  for (const code of expected) if (!planned.includes(code)) problems.push(`plan omits objective ${code}`);

  const clusterIds = new Set<string>();
  const clustered = new Set<string>();
  for (const c of plan.conceptClusters) {
    if (clusterIds.has(c.id)) problems.push(`duplicate concept cluster id ${c.id}`);
    clusterIds.add(c.id);
    for (const code of c.objectiveCodes) {
      if (!expected.has(code)) problems.push(`cluster ${c.id} references unknown objective ${code}`);
      clustered.add(code);
    }
  }
  for (const code of expected) if (!clustered.has(code)) problems.push(`objective ${code} is in no concept cluster`);

  const candidates = new Set(ctx.recallCandidateIds ?? []);
  const recallIds = plan.recall.map((r) => r.objectiveId);
  if (new Set(recallIds).size !== recallIds.length) problems.push("recall lists the same objective twice");
  for (const id of recallIds) if (!candidates.has(id)) problems.push(`recall objective ${id} is not one of the offered recall candidates`);

  if (plan.mode === "sub_index") {
    if (plan.conceptClusters.length < 2) problems.push("a sub_index needs at least two concept clusters");
    if (!plan.splitReason?.trim()) problems.push("a sub_index must give splitReason");
    if (plan.conceptClusters.length <= limits.maxConceptClusters) {
      problems.push(
        `${plan.conceptClusters.length} concept clusters fit in one lesson for ages ${band} (limit ${limits.maxConceptClusters}); return mode "single". Do not split just because there are many objectives.`,
      );
    }
    const proposals = plan.proposedChildTopics ?? [];
    if (proposals.length < 2) problems.push("a sub_index needs at least two proposedChildTopics");
    for (const p of proposals) if (!clusterIds.has(p.clusterId)) problems.push(`child topic "${p.title}" points at unknown cluster ${p.clusterId}`);
    for (const id of clusterIds) if (!proposals.some((p) => p.clusterId === id)) problems.push(`cluster ${id} has no proposed child topic`);
    return problems;
  }

  if (plan.conceptClusters.length > limits.maxConceptClusters) {
    problems.push(
      `${plan.conceptClusters.length} concept clusters exceed ${limits.maxConceptClusters} for ages ${band}; return mode "sub_index" with proposedChildTopics`,
    );
  }

  const sessions = plan.sessions;
  if (sessions.length !== limits.sessions) problems.push(`plan has ${sessions.length} sessions; ages ${band} need ${limits.sessions}`);
  const ids = new Set<string>();
  let biteTotal = 0;
  let taskTotal = 0;
  for (const s of sessions) {
    if (ids.has(s.id)) problems.push(`duplicate session id "${s.id}"`);
    ids.add(s.id);
    if (!s.id.startsWith("sess_")) problems.push(`session id "${s.id}" must start with sess_`);
    for (const code of s.objectiveCodes) if (!expected.has(code)) problems.push(`session "${s.id}" references unknown objective ${code}`);
    if (s.biteKinds.length < limits.bitesPerSessionMin || s.biteKinds.length > limits.bitesPerSessionMax) {
      problems.push(`session "${s.id}" has ${s.biteKinds.length} bites; each session needs ${limits.bitesPerSessionMin}-${limits.bitesPerSessionMax}`);
    }
    const tasks = s.biteKinds.filter((k) => TASK_TYPES.has(k)).length;
    if (s.taskCount !== tasks) problems.push(`session "${s.id}" taskCount ${s.taskCount} does not match ${tasks} task bites`);
    biteTotal += s.biteKinds.length;
    taskTotal += tasks;
  }
  if (biteTotal < limits.minBites) problems.push(`plan has ${biteTotal} bites; the minimum for ages ${band} is ${limits.minBites}`);
  if (biteTotal > 0 && taskTotal / biteTotal < limits.minTaskShare) {
    problems.push(`only ${taskTotal} of ${biteTotal} bites are tasks; at least ${Math.round(limits.minTaskShare * 100)}% should be`);
  }

  const final = plan.finalTest;
  if (!final) problems.push("a single lesson needs a finalTest");
  else {
    if (final.questionCount !== limits.finalTestQuestions) {
      problems.push(`finalTest.questionCount ${final.questionCount} must be ${limits.finalTestQuestions} for ages ${band}`);
    }
    for (const code of expected) if (!final.objectiveCodes.includes(code)) problems.push(`finalTest does not assess objective ${code}`);
  }

  const isTeaching = (kind: BiteType) => TEACHING_SECTION_TYPES.includes(kind);
  const isRepresentation = (kind: BiteType) => kind === "explore" || kind === "explain";
  const isExplanation = (kind: BiteType) => (EXPLANATION_TYPES as readonly string[]).includes(kind);
  const isApply = (kind: BiteType) => kind === "apply";

  for (const o of plan.objectives) {
    if (!covers(sessions, o.code, isTeaching)) problems.push(`objective ${o.code} has no teaching bite`);
    if (o.intent === "explain" || o.intent === "explain_process") {
      if (!covers(sessions, o.code, isRepresentation) || !covers(sessions, o.code, isExplanation)) {
        problems.push(`objective ${o.code} (${o.intent}) needs a representation (explore or explain) and an explanation bite`);
      }
    }
    if (o.intent === "apply" && !covers(sessions, o.code, isApply)) problems.push(`objective ${o.code} (apply) needs an apply bite before the final test`);
    if (o.depth === "transfer" && !covers(sessions, o.code, isApply)) {
      problems.push(`objective ${o.code} is planned at transfer depth; add an apply bite`);
    }
  }

  const applies = sessions.filter((s) => s.biteKinds.includes("apply")).length;
  if (plan.scope === "mastery") {
    if (!plan.objectives.some((o) => o.depth === "transfer") || applies === 0) {
      problems.push("mastery scope needs at least one transfer-depth objective with an apply bite");
    }
  }
  if (plan.scope === "overview") {
    if (plan.objectives.some((o) => o.depth === "transfer" && o.intent !== "apply")) {
      problems.push("overview scope cannot plan transfer depth except for apply objectives");
    }
  }
  if (plan.scope === "exam") {
    const practice = sessions.some((s) => s.biteKinds.includes("apply") || s.biteKinds.includes("quiz"));
    if (!practice) problems.push("exam scope needs a practice task before the final test");
  }

  return problems;
}

/**
 * The blueprint must implement the plan exactly: same sessions, same bite
 * kinds, and the planned final test.
 */
export function lintBlueprintAgainstPlan(bp: ArtifactBlueprint, plan: LessonPlan): string[] {
  if (plan.mode !== "single") return ["plan is a sub_index; there is no single lesson to implement"];
  if (!isGameBlueprint(bp)) return ["blueprint must be schemaVersion 3 to implement a session plan"];
  const problems: string[] = [];

  const bpCodes = bp.learningObjectives.map((o) => o.code).sort().join(",");
  const planCodes = plan.objectives.map((o) => o.code).sort().join(",");
  if (bpCodes !== planCodes) problems.push(`learningObjectives must be exactly ${planCodes} (found ${bpCodes})`);

  if (bp.sessions.length !== plan.sessions.length) {
    problems.push(`blueprint has ${bp.sessions.length} sessions but the plan has ${plan.sessions.length}`);
  }
  plan.sessions.forEach((p, i) => {
    const s = bp.sessions[i];
    if (!s) return;
    if (s.id !== p.id) problems.push(`session ${i + 1} must be "${p.id}" (found "${s.id}")`);
    const kinds = s.bites.map((b) => b.type);
    if (kinds.join(",") !== p.biteKinds.join(",")) {
      problems.push(`session "${s.id}" bite kinds must be ${p.biteKinds.join(", ")} (found ${kinds.join(", ")})`);
    }
    const taught = new Set(s.objectiveCodes);
    for (const code of p.objectiveCodes) if (!taught.has(code)) problems.push(`session "${s.id}" must list objective ${code} as planned`);
  });

  if (plan.finalTest && bp.finalTest.questions.length !== plan.finalTest.questionCount) {
    problems.push(`final test must have exactly ${plan.finalTest.questionCount} questions (found ${bp.finalTest.questions.length})`);
  }
  const allowed = new Set(plan.finalTest?.questionKinds ?? []);
  if (allowed.size) {
    for (const q of bp.finalTest.questions) {
      if (!allowed.has(q.kind)) problems.push(`final test question "${q.id}" uses ${q.kind}, which the plan did not choose`);
    }
  }

  const planned = new Set(plan.recall.map((r) => r.objectiveId));
  const used = new Set(collectQuestions(bp).flatMap(({ question }) => (question.recallObjectiveId ? [question.recallObjectiveId] : [])));
  for (const id of planned) if (!used.has(id)) problems.push(`planned recall of objective ${id} has no recall question`);
  for (const id of used) if (!planned.has(id)) problems.push(`recall question for ${id} was not planned`);

  return problems;
}

export function biteKindOf(bite: Bite): BiteType {
  return bite.type;
}
