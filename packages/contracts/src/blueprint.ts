import { z } from "zod";
import { MAX_LESSON_IMAGES, countWords, limitsFor } from "./limits";

/**
 * ArtifactBlueprint is the durable, validated description of a lesson.
 *
 * It is produced before any code is generated, holds every answer key and
 * piece of feedback, and is what the server grades against. It also drives
 * the fallback renderer when code generation or validation fails.
 *
 * Version 1 is the old fixed intro → explore → review → quiz shape and still
 * loads. Version 2 implements a validated LessonPlan: any order of toolbox
 * blocks, a fact list every block cites, and a final check that closes it.
 */

export const LearningStage = z.enum([
  "discover",
  "understand",
  "recognize",
  "practice",
  "apply",
  "explain",
  "master",
]);
export type LearningStage = z.infer<typeof LearningStage>;

export const ObjectiveCode = z
  .string()
  .regex(/^lo[1-9]\d?$/, "objective codes look like lo1, lo2, ...");

export const LearningObjective = z.object({
  code: ObjectiveCode,
  text: z.string().min(5).max(200),
});
export type LearningObjective = z.infer<typeof LearningObjective>;

export const FactId = z.string().regex(/^f[1-9]\d?$/, "fact ids look like f1, f2, ...");

export const Fact = z.object({
  id: FactId,
  text: z.string().min(5).max(240).describe("One checkable statement. The only facts the lesson may teach or test."),
});
export type Fact = z.infer<typeof Fact>;

const Difficulty = z.number().int().min(1).max(3).describe("1 easy, 2 medium, 3 hard");

const ChoiceId = z.string().min(1).max(8);

const QuestionBase = {
  id: z.string().min(1).max(40),
  prompt: z.string().min(3).max(400),
  explanation: z
    .string()
    .min(10)
    .max(500)
    .describe("Teaching feedback shown after answering; explains WHY, never just 'wrong'"),
  hint: z.string().max(300).optional(),
  difficulty: Difficulty,
  objectiveCodes: z
    .array(ObjectiveCode)
    .max(6)
    .describe("Objectives of THIS lesson the question assesses. Empty only for recall questions."),
  factIds: z.array(FactId).max(6).optional().describe("Facts the question and its answer rely on"),
  recallObjectiveId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("Set only on a recall question: the id of the earlier lesson's objective it revisits"),
};

export const McqQuestion = z.object({
  kind: z.literal("mcq"),
  ...QuestionBase,
  options: z.array(z.object({ id: ChoiceId, text: z.string().min(1).max(200) })).min(3).max(5),
  correctOptionId: ChoiceId,
});

export const TrueFalseQuestion = z.object({
  kind: z.literal("true_false"),
  ...QuestionBase,
  answer: z.boolean(),
});

export const ShortAnswerQuestion = z.object({
  kind: z.literal("short_answer"),
  ...QuestionBase,
  acceptedAnswers: z
    .array(z.string().min(1).max(80))
    .min(1)
    .max(8)
    .describe("Exact answers (1 to 3 words each), matched case-insensitively; include common spellings"),
});

export const OrderingQuestion = z.object({
  kind: z.literal("ordering"),
  ...QuestionBase,
  items: z.array(z.object({ id: ChoiceId, text: z.string().min(1).max(120) })).min(3).max(7),
  correctOrder: z.array(ChoiceId).min(3).max(7),
});

export const FillBlankQuestion = z.object({
  kind: z.literal("fill_blank"),
  ...QuestionBase,
  text: z.string().min(5).max(300).describe("The sentence, with each blank written as ___ (three underscores)"),
  options: z.array(z.object({ id: ChoiceId, text: z.string().min(1).max(60) })).min(2).max(8),
  blanks: z.array(ChoiceId).min(1).max(4).describe("Correct option id for each blank, in order"),
});

export const MatchingQuestion = z.object({
  kind: z.literal("matching"),
  ...QuestionBase,
  left: z.array(z.object({ id: ChoiceId, text: z.string().min(1).max(120) })).min(2).max(6),
  right: z.array(z.object({ id: ChoiceId, text: z.string().min(1).max(120) })).min(2).max(8),
  pairs: z
    .array(z.object({ left: ChoiceId, right: ChoiceId }))
    .min(2)
    .max(6)
    .describe("Exactly one pair per left item"),
});

export const Question = z.discriminatedUnion("kind", [
  McqQuestion,
  TrueFalseQuestion,
  ShortAnswerQuestion,
  OrderingQuestion,
  FillBlankQuestion,
  MatchingQuestion,
]);
export type Question = z.infer<typeof Question>;
export type QuestionKind = Question["kind"];
export const QuestionKind = z.enum(["mcq", "true_false", "short_answer", "ordering", "fill_blank", "matching"]);

const SectionBase = {
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(80),
  stage: LearningStage,
  objectiveCodes: z.array(ObjectiveCode).max(6).optional().describe("Objectives this block teaches"),
  factIds: z.array(FactId).max(12).optional().describe("Facts this block states"),
};

export const IntroSection = z.object({
  type: z.literal("intro"),
  ...SectionBase,
  body: z.string().min(12).max(220),
  hook: z.string().min(5).max(140).describe("A curiosity question or surprising fact"),
});

export const VisualKind = z.enum(["comparison", "sequence", "parts", "timeline", "orbit", "simulation"]);
export type VisualKind = z.infer<typeof VisualKind>;

export const VisualItem = z.object({
  id: z.string().min(1).max(40).optional(),
  label: z.string().min(1).max(60),
  description: z.string().min(1).max(240),
  value: z.number().optional().describe("Optional magnitude for comparisons (e.g. size, distance)"),
  emoji: z.string().max(8).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe("Hex colour for this body or part, used by orbit/comparison visuals"),
});
export type VisualItem = z.infer<typeof VisualItem>;

export const VisualSpec = z.object({
  kind: VisualKind,
  purpose: z
    .string()
    .max(160)
    .optional()
    .describe("The instructional purpose, e.g. show_that_earth_rotation_changes_which_side_faces_the_sun"),
  caption: z.string().max(200),
  items: z.array(VisualItem).min(2).max(12),
});
export type VisualSpec = z.infer<typeof VisualSpec>;

export const ExplainSection = z.object({
  type: z.literal("explain"),
  ...SectionBase,
  paragraphs: z.array(z.string().min(10).max(280)).min(1).max(2),
  analogy: z
    .string()
    .max(240)
    .optional()
    .describe("Optional analogy bridging to the child's interests; never requires copyrighted characters"),
  visual: VisualSpec.optional(),
});

export const ExploreSection = z.object({
  type: z.literal("explore"),
  ...SectionBase,
  lead: z.string().min(8).max(180).describe("One short sentence. The visual does the teaching."),
  prompt: z.string().min(5).max(140).describe("What the child should do, e.g. 'Tap a planet'"),
  visual: VisualSpec,
});

export const QuizRole = z.enum(["formative", "final_check"]);
export type QuizRole = z.infer<typeof QuizRole>;

export const QuizSection = z.object({
  type: z.literal("quiz"),
  ...SectionBase,
  role: QuizRole.optional().describe("final_check closes the lesson and assesses every objective"),
  intro: z.string().max(300).optional(),
  questions: z.array(Question).min(1).max(12),
});

export const ApplySection = z.object({
  type: z.literal("apply"),
  ...SectionBase,
  scenario: z.string().min(20).max(600).describe("A new situation where the concept must be used"),
  questions: z.array(Question).min(1).max(4),
});

export const ReviewSection = z.object({
  type: z.literal("review"),
  ...SectionBase,
  bullets: z.array(z.string().min(5).max(200)).min(2).max(8),
  nextStep: z.string().max(200).optional(),
});

export const KeyPointsSection = z.object({
  type: z.literal("key_points"),
  ...SectionBase,
  lead: z.string().max(180).optional(),
  points: z.array(z.string().min(3).max(200)).min(2).max(7).describe("Point-wise teaching, one idea per point"),
});

export const ImageSection = z.object({
  type: z.literal("image"),
  ...SectionBase,
  prompt: z
    .string()
    .min(10)
    .max(600)
    .describe("Instruction for the image model: subject, labelled parts, child-friendly illustration style, no words in the picture"),
  alt: z.string().min(5).max(240).describe("Describes what the picture shows; read aloud when the image is missing"),
  caption: z.string().max(200),
  assetId: z.string().max(60).optional().describe("Set by the server after the image is generated"),
});

export const MnemonicSection = z.object({
  type: z.literal("mnemonic"),
  ...SectionBase,
  phrase: z.string().min(2).max(80).describe("The acronym or memory phrase"),
  lines: z
    .array(z.object({ cue: z.string().min(1).max(16), text: z.string().min(1).max(120) }))
    .min(2)
    .max(10)
    .describe("One line per letter or word: the cue and what it stands for"),
  tip: z.string().max(200).optional(),
});

export const AnalogySection = z.object({
  type: z.literal("analogy"),
  ...SectionBase,
  interest: z.string().min(1).max(60).describe("The learner interest this bridges from"),
  familiar: z.string().min(10).max(240).describe("Something the learner already knows from that interest"),
  bridge: z.string().min(10).max(280).describe("How the familiar thing maps onto the idea being taught"),
  limit: z.string().max(200).optional().describe("Where the comparison stops working"),
});

export const SimpleExplainSection = z.object({
  type: z.literal("simple_explain"),
  ...SectionBase,
  simple: z.string().min(10).max(280).describe("Explain it like the learner is five"),
  term: z.string().min(1).max(60),
  definition: z.string().min(10).max(280).describe("The real definition, in correct terms"),
});

export const Section = z.discriminatedUnion("type", [
  IntroSection,
  ExploreSection,
  ExplainSection,
  QuizSection,
  ApplySection,
  ReviewSection,
  KeyPointsSection,
  ImageSection,
  MnemonicSection,
  AnalogySection,
  SimpleExplainSection,
]);
export type Section = z.infer<typeof Section>;
export type SectionType = Section["type"];
export const SectionType = z.enum([
  "intro",
  "explore",
  "explain",
  "quiz",
  "apply",
  "review",
  "key_points",
  "image",
  "mnemonic",
  "analogy",
  "simple_explain",
]);

/** Blocks that teach. Every objective needs at least one of these. */
export const TEACHING_SECTION_TYPES: readonly SectionType[] = [
  "explore",
  "explain",
  "key_points",
  "image",
  "mnemonic",
  "analogy",
  "simple_explain",
];
/** Blocks that hold graded questions. */
export const GRADED_SECTION_TYPES: readonly SectionType[] = ["quiz", "apply"];

export const Theme = z.object({
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  mood: z.string().max(60).describe("e.g. 'cosmic and calm', 'sunny meadow'"),
  emoji: z.string().max(8),
});

const BlueprintShared = {
  topicSlug: z.string(),
  title: z.string().min(2).max(80),
  audience: z.object({
    age: z.number().int().min(3).max(120).nullable(),
    readingLevel: z.enum(["pre_reader", "early", "developing", "fluent", "advanced"]).nullable(),
  }),
  theme: Theme,
  learningObjectives: z.array(LearningObjective).min(1).max(6),
  stages: z.array(LearningStage).min(1),
  personalization: z
    .string()
    .max(400)
    .optional()
    .describe("How the learner's interest was used as a teaching bridge"),
  facts: z.array(Fact).max(30).optional().describe("Source of truth: every factual statement the lesson teaches or tests"),
};

export const ClassicBlueprint = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  ...BlueprintShared,
  sections: z.array(Section).min(2).max(12),
});
export type ClassicBlueprint = z.infer<typeof ClassicBlueprint>;

export const BiteType = z.enum(["explore", "explain", "simple_explain", "analogy", "mnemonic", "key_points", "quiz", "apply"]);
export type BiteType = z.infer<typeof BiteType>;

export const Bite = z.discriminatedUnion("type", [
  ExploreSection,
  ExplainSection,
  QuizSection,
  ApplySection,
  KeyPointsSection,
  MnemonicSection,
  AnalogySection,
  SimpleExplainSection,
]);
export type Bite = z.infer<typeof Bite>;

export const GameSession = z.object({
  id: z.string().min(3).max(40),
  title: z.string().min(1).max(80),
  emoji: z.string().min(1).max(8),
  opener: z.string().min(5).max(180).describe("One line spoken to the learner"),
  objectiveCodes: z.array(ObjectiveCode).min(1).max(6),
  bites: z.array(Bite).min(5).max(8),
});
export type GameSession = z.infer<typeof GameSession>;

export const FinalTest = z.object({
  intro: z.string().min(8).max(300).describe("Sets up the big challenge, talking to the learner"),
  questions: z.array(Question).min(4).max(12),
});
export type FinalTest = z.infer<typeof FinalTest>;

export const GameBlueprint = z.object({
  schemaVersion: z.literal(3),
  ...BlueprintShared,
  sessions: z.array(GameSession).min(3).max(5),
  finalTest: FinalTest,
});
export type GameBlueprint = z.infer<typeof GameBlueprint>;

export const ArtifactBlueprint = z.union([ClassicBlueprint, GameBlueprint]);
export type ArtifactBlueprint = z.infer<typeof ArtifactBlueprint>;

export function isGameBlueprint(bp: ArtifactBlueprint): bp is GameBlueprint {
  return bp.schemaVersion === 3;
}

/** Every question in a blueprint, flattened with its containing section id. */
export function collectQuestions(bp: ArtifactBlueprint): Array<{ sectionId: string; question: Question }> {
  const out: Array<{ sectionId: string; question: Question }> = [];
  if (isGameBlueprint(bp)) {
    for (const sess of bp.sessions) {
      for (const s of sess.bites) {
        if (s.type === "quiz" || s.type === "apply") {
          for (const q of s.questions) out.push({ sectionId: s.id, question: q });
        }
      }
    }
    for (const q of bp.finalTest.questions) out.push({ sectionId: "final_test", question: q });
    return out;
  }
  for (const s of bp.sections) {
    if (s.type === "quiz" || s.type === "apply") {
      for (const q of s.questions) out.push({ sectionId: s.id, question: q });
    }
  }
  return out;
}

export function allQuestions(bp: ArtifactBlueprint): Question[] {
  return collectQuestions(bp).map((x) => x.question);
}

export function gameBites(bp: GameBlueprint): Bite[] {
  return bp.sessions.flatMap((s) => s.bites);
}

export function isTeachingSection(s: Section): boolean {
  return TEACHING_SECTION_TYPES.includes(s.type);
}

/** Child-facing teaching text of a section, one entry per text block. Questions are excluded. */
export function sectionTextBlocks(s: Section): string[] {
  switch (s.type) {
    case "intro":
      return [s.body, s.hook];
    case "explore":
      return [s.lead, s.prompt, ...s.visual.items.map((i) => i.description)];
    case "explain":
      return [...s.paragraphs, s.analogy ?? "", ...(s.visual?.items.map((i) => i.description) ?? [])];
    case "review":
      return [...s.bullets, s.nextStep ?? ""];
    case "key_points":
      return [s.lead ?? "", ...s.points];
    case "image":
      return [s.caption];
    case "mnemonic":
      return [s.phrase, ...s.lines.map((l) => `${l.cue} ${l.text}`), s.tip ?? ""];
    case "analogy":
      return [s.familiar, s.bridge, s.limit ?? ""];
    case "simple_explain":
      return [s.simple, s.definition];
    case "apply":
      return [s.scenario];
    case "quiz":
      return [s.intro ?? ""];
  }
}

/** The text a correct answer consists of, used to check interests did not change the answer. */
export function answerKeyTexts(q: Question): string[] {
  switch (q.kind) {
    case "mcq":
      return q.options.filter((o) => o.id === q.correctOptionId).map((o) => o.text);
    case "true_false":
      return [];
    case "short_answer":
      return q.acceptedAnswers;
    case "ordering":
      return q.items.map((i) => i.text);
    case "fill_blank":
      return q.blanks.map((id) => q.options.find((o) => o.id === id)?.text ?? "");
    case "matching":
      return q.pairs.map((p) => q.right.find((r) => r.id === p.right)?.text ?? "");
  }
}

function questionProblems(q: Question): string[] {
  const problems: string[] = [];
  const dupes = (ids: string[]) => new Set(ids).size !== ids.length;
  switch (q.kind) {
    case "mcq": {
      const ids = q.options.map((o) => o.id);
      if (dupes(ids)) problems.push(`question "${q.id}" has duplicate option ids`);
      if (!ids.includes(q.correctOptionId)) problems.push(`question "${q.id}" correctOptionId not among options`);
      break;
    }
    case "ordering": {
      const ids = q.items.map((i) => i.id).sort();
      const order = [...q.correctOrder].sort();
      if (dupes(ids)) problems.push(`question "${q.id}" has duplicate item ids`);
      if (ids.join("|") !== order.join("|")) problems.push(`question "${q.id}" correctOrder must be a permutation of items`);
      break;
    }
    case "short_answer":
      if (q.acceptedAnswers.some((a) => a.trim().length === 0)) problems.push(`question "${q.id}" has an empty accepted answer`);
      break;
    case "fill_blank": {
      const ids = q.options.map((o) => o.id);
      if (dupes(ids)) problems.push(`question "${q.id}" has duplicate option ids`);
      const slots = q.text.split("___").length - 1;
      if (slots !== q.blanks.length) problems.push(`question "${q.id}" text has ${slots} blanks (___) but ${q.blanks.length} answers`);
      for (const b of q.blanks) if (!ids.includes(b)) problems.push(`question "${q.id}" blank answer "${b}" is not among options`);
      break;
    }
    case "matching": {
      const left = q.left.map((l) => l.id);
      const right = q.right.map((r) => r.id);
      if (dupes(left) || dupes(right)) problems.push(`question "${q.id}" has duplicate left or right ids`);
      const pairedLeft = q.pairs.map((p) => p.left);
      if (dupes(pairedLeft) || pairedLeft.length !== left.length || !left.every((id) => pairedLeft.includes(id))) {
        problems.push(`question "${q.id}" needs exactly one pair for every left item`);
      }
      for (const p of q.pairs) if (!right.includes(p.right)) problems.push(`question "${q.id}" pair points at unknown right item "${p.right}"`);
      break;
    }
    case "true_false":
      break;
  }
  return problems;
}

/**
 * Every teaching block and every question must cite facts from the
 * blueprint's fact list, and every cited fact must exist. A claim that is not
 * traceable to the fact list fails here before any model reviews it.
 */
function teachingBlocks(bp: ArtifactBlueprint): Array<{ id: string; type: string; factIds?: string[] }> {
  if (isGameBlueprint(bp)) return gameBites(bp);
  return bp.sections;
}

export function factTraceProblems(bp: ArtifactBlueprint): string[] {
  const problems: string[] = [];
  const facts = bp.facts ?? [];
  if (facts.length === 0) return ["blueprint has no facts list; every taught or tested statement must be in facts"];
  const known = new Set<string>();
  for (const f of facts) {
    if (known.has(f.id)) problems.push(`duplicate fact id "${f.id}"`);
    known.add(f.id);
  }
  for (const s of teachingBlocks(bp)) {
    const cites = s.factIds ?? [];
    const teaches = TEACHING_SECTION_TYPES.includes(s.type as SectionType) || s.type === "review";
    if (teaches && cites.length === 0) {
      problems.push(`section "${s.id}" (${s.type}) cites no facts; list the factIds it states`);
    }
    for (const id of cites) if (!known.has(id)) problems.push(`section "${s.id}" cites unknown fact ${id}`);
  }
  for (const { question: q } of collectQuestions(bp)) {
    const cites = q.factIds ?? [];
    if (cites.length === 0 && !q.recallObjectiveId) problems.push(`question "${q.id}" cites no facts; list the factIds its answer relies on`);
    for (const id of cites) if (!known.has(id)) problems.push(`question "${q.id}" cites unknown fact ${id}`);
  }
  return problems;
}

function interestTerms(interests: string[]): string[] {
  const out = new Set<string>();
  for (const phrase of interests) {
    for (const raw of phrase.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 4) continue;
      out.add(raw.endsWith("s") ? raw.slice(0, -1) : raw);
    }
  }
  return [...out];
}

/**
 * An interest may frame the lesson but never become the thing taught or the
 * answer. Flags answer keys that mention an interest term the objectives and
 * facts never mention.
 */
export function interestIntegrityProblems(bp: ArtifactBlueprint, interests: string[]): string[] {
  const terms = interestTerms(interests);
  if (terms.length === 0) return [];
  const source = [...bp.learningObjectives.map((o) => o.text), ...(bp.facts ?? []).map((f) => f.text), bp.title].join(" ").toLowerCase();
  const problems: string[] = [];
  for (const { question: q } of collectQuestions(bp)) {
    const answer = answerKeyTexts(q).join(" ").toLowerCase();
    for (const term of terms) {
      if (answer.includes(term) && !source.includes(term)) {
        problems.push(`question "${q.id}" answer depends on the interest "${term}"; interests may frame a question but never change its answer`);
      }
    }
  }
  return problems;
}

export interface BlueprintLintOptions {
  /** Learner interests used for framing. Answer keys must not depend on them. */
  interests?: string[];
}

/** Structural checks that Zod alone cannot express. Returns human-readable problems. */
export function lintBlueprint(bp: ArtifactBlueprint, opts: BlueprintLintOptions = {}): string[] {
  if (isGameBlueprint(bp)) return lintGameBlueprint(bp, opts);
  const problems: string[] = [];
  const objectiveCodes = new Set(bp.learningObjectives.map((o) => o.code));
  const sectionIds = new Set<string>();
  const questionIds = new Set<string>();

  for (const s of bp.sections) {
    if (sectionIds.has(s.id)) problems.push(`duplicate section id "${s.id}"`);
    sectionIds.add(s.id);
    for (const code of s.objectiveCodes ?? []) {
      if (!objectiveCodes.has(code)) problems.push(`section "${s.id}" references unknown objective ${code}`);
    }
  }

  for (const { question: q } of collectQuestions(bp)) {
    if (questionIds.has(q.id)) problems.push(`duplicate question id "${q.id}"`);
    questionIds.add(q.id);
    for (const code of q.objectiveCodes) {
      if (!objectiveCodes.has(code)) problems.push(`question "${q.id}" references unknown objective ${code}`);
    }
    if (q.recallObjectiveId && q.objectiveCodes.length > 0) {
      problems.push(`recall question "${q.id}" must not also claim objectives of this lesson`);
    }
    if (!q.recallObjectiveId && q.objectiveCodes.length === 0) problems.push(`question "${q.id}" assesses no objective`);
    problems.push(...questionProblems(q));
  }

  for (const s of bp.sections) {
    const visual = s.type === "explore" ? s.visual : s.type === "explain" ? s.visual : undefined;
    if (!visual) continue;
    const ids = visual.items.map((it) => it.id || it.label);
    if (new Set(ids).size !== ids.length) problems.push(`section "${s.id}" visual has duplicate item ids/labels`);
    if (visual.kind === "orbit" && visual.items.length < 3) {
      problems.push(`section "${s.id}" orbit visual needs at least 3 items (a centre plus two bodies)`);
    }
  }

  if (collectQuestions(bp).length === 0) problems.push("lesson has no graded questions");
  const covered = new Set<string>();
  for (const { question } of collectQuestions(bp)) question.objectiveCodes.forEach((c) => covered.add(c));
  for (const code of objectiveCodes) {
    if (!covered.has(code)) problems.push(`objective ${code} is never assessed`);
  }

  if (bp.schemaVersion === 2) problems.push(...lintV2(bp, opts));
  return problems;
}

function lintV2(bp: ClassicBlueprint, opts: BlueprintLintOptions): string[] {
  const problems: string[] = [];
  const limits = limitsFor(bp.audience.age);
  const questions = collectQuestions(bp);

  for (const s of bp.sections) {
    if (!s.id.startsWith("s_")) problems.push(`section id "${s.id}" must start with s_`);
  }
  for (const { question: q } of questions) {
    if (!q.id.startsWith("q_")) problems.push(`question id "${q.id}" must start with q_`);
    if (q.kind === "short_answer") {
      for (const a of q.acceptedAnswers) {
        if (countWords(a) > 3) problems.push(`question "${q.id}" accepted answer "${a}" is longer than 3 words; short answers must be exact`);
      }
    }
  }

  // Teaching and assessment coverage. Order is free; the final check closes the lesson.
  const taught = new Set<string>();
  for (const s of bp.sections) if (isTeachingSection(s)) (s.objectiveCodes ?? []).forEach((c) => taught.add(c));
  for (const o of bp.learningObjectives) {
    if (!taught.has(o.code)) problems.push(`objective ${o.code} has no teaching block (explore, explain, key_points, image, mnemonic, analogy or simple_explain)`);
  }
  const finals = bp.sections.filter((s) => s.type === "quiz" && s.role === "final_check");
  const last = bp.sections[bp.sections.length - 1];
  if (finals.length !== 1) problems.push(`lesson needs exactly one final_check quiz (found ${finals.length})`);
  if (!last || last.type !== "quiz" || last.role !== "final_check") problems.push("the final_check quiz must be the last section");
  const final = finals[0];
  if (final && final.type === "quiz") {
    const finalCovered = new Set(final.questions.filter((q) => !q.recallObjectiveId).flatMap((q) => q.objectiveCodes));
    for (const o of bp.learningObjectives) {
      if (!finalCovered.has(o.code)) problems.push(`final_check does not assess objective ${o.code}`);
    }
  }

  for (const s of bp.sections) {
    const visual = s.type === "explore" ? s.visual : s.type === "explain" ? s.visual : undefined;
    if (visual && !visual.purpose?.trim()) problems.push(`section "${s.id}" visual must declare its instructional purpose`);
  }
  const images = bp.sections.filter((s) => s.type === "image").length;
  if (images > MAX_LESSON_IMAGES) problems.push(`lesson has ${images} image blocks; at most ${MAX_LESSON_IMAGES} are allowed`);

  // Load and readability for the age band.
  if (bp.sections.length > limits.maxSections) problems.push(`lesson has ${bp.sections.length} sections; the limit for this age is ${limits.maxSections}`);
  if (questions.length > limits.maxGradedQuestions) {
    problems.push(`lesson has ${questions.length} graded questions; the limit for this age is ${limits.maxGradedQuestions}`);
  }
  for (const s of bp.sections) {
    const blocks = sectionTextBlocks(s);
    let total = 0;
    for (const text of blocks) {
      const words = countWords(text);
      total += words;
      if (words > limits.wordsPerBlock) problems.push(`section "${s.id}" has a ${words}-word text block; the limit for this age is ${limits.wordsPerBlock}`);
    }
    if (total > limits.wordsPerSection) problems.push(`section "${s.id}" has ${total} words; the limit for this age is ${limits.wordsPerSection}`);
  }
  for (const { question: q } of questions) {
    for (const text of [q.prompt, q.explanation]) {
      const words = countWords(text);
      if (words > limits.wordsPerBlock) problems.push(`question "${q.id}" has a ${words}-word text; the limit for this age is ${limits.wordsPerBlock}`);
    }
  }

  problems.push(...factTraceProblems(bp));
  if (opts.interests?.length) problems.push(...interestIntegrityProblems(bp, opts.interests));
  return problems;
}

/**
 * Parse a stored or model-produced blueprint. Strips legacy flashcard
 * sections so older artifacts still load after that type was removed.
 */
const VOICE_BANNED: Array<[RegExp, string]> = [
  [/\bin this lesson\b/i, "in this lesson"],
  [/\bthe learner\b/i, "the learner"],
  [/\binstructions\b/i, "instructions"],
  [/\bthis section\b/i, "this section"],
  [/\bstudents\b/i, "students"],
  [/\bclick the button\b/i, "click the button"],
  [/\blearning objective/i, "learning objective"],
];

/** Rejects meta or instruction wording so every line talks to the learner. */
export function voiceProblems(texts: Array<{ where: string; text: string }>): string[] {
  const problems: string[] = [];
  for (const { where, text } of texts) {
    if (!text?.trim()) continue;
    for (const [re, label] of VOICE_BANNED) {
      if (re.test(text)) problems.push(`${where} sounds like an instruction ("${label}"); talk to the learner`);
    }
  }
  return problems;
}

function gameVoiceTexts(bp: GameBlueprint): Array<{ where: string; text: string }> {
  const texts: Array<{ where: string; text: string }> = [{ where: "title", text: bp.title }];
  for (const sess of bp.sessions) {
    texts.push({ where: `session "${sess.id}" title`, text: sess.title }, { where: `session "${sess.id}" opener`, text: sess.opener });
    for (const bite of sess.bites) {
      texts.push({ where: `bite "${bite.id}" title`, text: bite.title });
      for (const block of sectionTextBlocks(bite as Section)) texts.push({ where: `bite "${bite.id}"`, text: block });
    }
  }
  texts.push({ where: "final test intro", text: bp.finalTest.intro });
  for (const q of collectQuestions(bp)) {
    texts.push({ where: `question "${q.question.id}"`, text: q.question.prompt }, { where: `question "${q.question.id}"`, text: q.question.explanation });
    if (q.question.hint) texts.push({ where: `question "${q.question.id}" hint`, text: q.question.hint });
  }
  return texts;
}

export function lintGameBlueprint(bp: GameBlueprint, opts: BlueprintLintOptions = {}): string[] {
  const problems: string[] = [];
  const limits = limitsFor(bp.audience.age);
  const objectiveCodes = new Set(bp.learningObjectives.map((o) => o.code));
  const sessionIds = new Set<string>();
  const biteIds = new Set<string>();
  const questionIds = new Set<string>();
  let taskBites = 0;
  let biteCount = 0;
  const taught = new Set<string>();
  const practised = new Set<string>();

  if (bp.sessions.length < limits.minSessions || bp.sessions.length > limits.maxSessions) {
    problems.push(`lesson has ${bp.sessions.length} sessions; ages ${limits.minSessions === limits.maxSessions ? limits.sessions : `${limits.minSessions}-${limits.maxSessions}`} need ${limits.sessions}`);
  }

  for (const sess of bp.sessions) {
    if (sessionIds.has(sess.id)) problems.push(`duplicate session id "${sess.id}"`);
    sessionIds.add(sess.id);
    if (!sess.id.startsWith("sess_")) problems.push(`session id "${sess.id}" must start with sess_`);
    for (const code of sess.objectiveCodes) if (!objectiveCodes.has(code)) problems.push(`session "${sess.id}" references unknown objective ${code}`);
    if (sess.bites.length < limits.bitesPerSessionMin || sess.bites.length > limits.bitesPerSessionMax) {
      problems.push(`session "${sess.id}" has ${sess.bites.length} bites; each session needs ${limits.bitesPerSessionMin}-${limits.bitesPerSessionMax}`);
    }
    for (const bite of sess.bites) {
      biteCount += 1;
      if (biteIds.has(bite.id)) problems.push(`duplicate bite id "${bite.id}"`);
      biteIds.add(bite.id);
      if (!bite.id.startsWith("s_")) problems.push(`bite id "${bite.id}" must start with s_`);
      for (const code of bite.objectiveCodes ?? []) if (!objectiveCodes.has(code)) problems.push(`bite "${bite.id}" references unknown objective ${code}`);
      if (TEACHING_SECTION_TYPES.includes(bite.type)) (bite.objectiveCodes ?? []).forEach((c) => taught.add(c));
      if (bite.type === "quiz" || bite.type === "apply") {
        taskBites += 1;
        if (bite.type === "quiz" && bite.role === "final_check") problems.push(`bite "${bite.id}" cannot be a final_check; that is the lesson's finalTest`);
        if (bite.questions.length > 2) problems.push(`bite "${bite.id}" has ${bite.questions.length} questions; a task bite holds 1 or 2`);
        for (const q of bite.questions) q.objectiveCodes.forEach((c) => practised.add(c));
      }
      if (bite.type === "explain" && bite.paragraphs.length > 1) problems.push(`bite "${bite.id}" should be one short paragraph`);
      const visual = bite.type === "explore" ? bite.visual : bite.type === "explain" ? bite.visual : undefined;
      if (visual) {
        if (!visual.purpose?.trim()) problems.push(`bite "${bite.id}" visual must declare its purpose`);
        const ids = visual.items.map((it) => it.id || it.label);
        if (new Set(ids).size !== ids.length) problems.push(`bite "${bite.id}" visual has duplicate item ids/labels`);
      }
      let total = 0;
      for (const text of sectionTextBlocks(bite as Section)) {
        const words = countWords(text);
        total += words;
        if (words > limits.wordsPerBite) problems.push(`bite "${bite.id}" has a ${words}-word text; the limit for this age is ${limits.wordsPerBite}`);
      }
      if (total > limits.wordsPerBite * 2) problems.push(`bite "${bite.id}" has ${total} words; keep it to one small step`);
    }
  }

  if (biteCount < limits.minBites) problems.push(`lesson has ${biteCount} bites; the minimum for this age is ${limits.minBites}`);
  if (biteCount > 0 && taskBites / biteCount < limits.minTaskShare) {
    problems.push(`only ${taskBites} of ${biteCount} bites are tasks; at least ${Math.round(limits.minTaskShare * 100)}% should be`);
  }

  for (const o of bp.learningObjectives) {
    if (!taught.has(o.code)) problems.push(`objective ${o.code} has no teaching bite before the final test`);
    if (!practised.has(o.code)) problems.push(`objective ${o.code} has no practice task before the final test`);
  }

  const finalCovered = new Set(bp.finalTest.questions.filter((q) => !q.recallObjectiveId).flatMap((q) => q.objectiveCodes));
  if (bp.finalTest.questions.length !== limits.finalTestQuestions) {
    problems.push(`final test has ${bp.finalTest.questions.length} questions; this age needs ${limits.finalTestQuestions}`);
  }
  for (const o of bp.learningObjectives) {
    if (!finalCovered.has(o.code)) problems.push(`final test does not assess objective ${o.code}`);
  }

  for (const { question: q } of collectQuestions(bp)) {
    if (questionIds.has(q.id)) problems.push(`duplicate question id "${q.id}"`);
    questionIds.add(q.id);
    if (!q.id.startsWith("q_")) problems.push(`question id "${q.id}" must start with q_`);
    for (const code of q.objectiveCodes) if (!objectiveCodes.has(code)) problems.push(`question "${q.id}" references unknown objective ${code}`);
    if (q.recallObjectiveId && q.objectiveCodes.length > 0) problems.push(`recall question "${q.id}" must not also claim objectives of this lesson`);
    if (!q.recallObjectiveId && q.objectiveCodes.length === 0) problems.push(`question "${q.id}" assesses no objective`);
    if (q.kind === "short_answer") {
      for (const a of q.acceptedAnswers) {
        if (countWords(a) > 3) problems.push(`question "${q.id}" accepted answer "${a}" is longer than 3 words`);
      }
    }
    problems.push(...questionProblems(q));
    for (const text of [q.prompt, q.explanation]) {
      if (countWords(text) > limits.wordsPerBite) problems.push(`question "${q.id}" has a ${countWords(text)}-word text; the limit for this age is ${limits.wordsPerBite}`);
    }
  }

  problems.push(...factTraceProblems(bp));
  problems.push(...voiceProblems(gameVoiceTexts(bp)));
  if (opts.interests?.length) problems.push(...interestIntegrityProblems(bp, opts.interests));
  return problems;
}

/**
 * Parse a stored or model-produced blueprint. Strips legacy flashcard
 * sections so older artifacts still load after that type was removed.
 */
export function parseBlueprint(data: unknown): ArtifactBlueprint {
  if (data && typeof data === "object" && "schemaVersion" in data && (data as { schemaVersion?: number }).schemaVersion === 3) {
    return GameBlueprint.parse(data);
  }
  if (data && typeof data === "object" && "sections" in data && Array.isArray((data as { sections: unknown }).sections)) {
    const raw = data as { sections: Array<{ type?: string }> };
    return ClassicBlueprint.parse({
      ...raw,
      sections: raw.sections.filter((s) => s && s.type !== "flashcards"),
    });
  }
  return ArtifactBlueprint.parse(data);
}
