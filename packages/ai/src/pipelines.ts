import { Output, generateText } from "ai";
import { z } from "zod";
import {
  ArtifactBlueprint,
  GameBlueprint,
  GeneratedCurriculum,
  LESSON_LIMITS,
  LessonPlan,
  MemoryUpdate,
  ageBandFor,
  lintBlueprint,
  lintBlueprintAgainstPlan,
  lintLessonPlan,
  type ArtifactStage,
  type LearnerContext,
  type LearningScope,
  type PlanLintContext,
} from "@eco/contracts";
import { renderBlueprintHtml } from "@eco/learnkit";
import { mockBlueprint, mockCurriculum, mockFactcheck, mockReport } from "./mock";
import { defaultLessonPlan, planFromBlueprint } from "./planDefaults";
import {
  PROMPT_VERSION,
  blueprintPrompt,
  curriculumPrompt,
  factcheckPrompt,
  lessonPlanPrompt,
  memoryPrompt,
  reportPrompt,
  type LessonPlanPromptInput,
  type RecallCandidate,
} from "./prompts";
import { resolveModel, type AiTask, type Tier, type UsageRecord } from "./provider";
import { dropBlank, modelSchema, schemaProblems } from "./schema";

export interface PipelineMeta {
  provider: string;
  modelId: string;
  promptVersion: string;
  usage: UsageRecord[];
}

function meta(provider: string, modelId: string, usage: UsageRecord[]): PipelineMeta {
  return { provider, modelId, promptVersion: PROMPT_VERSION, usage };
}

async function timed<T>(task: AiTask, r: { provider: string; modelId: string }, fn: () => Promise<T & { usage?: { inputTokens?: number; outputTokens?: number } }>, sink: UsageRecord[]): Promise<T> {
  const started = Date.now();
  const res = await fn();
  sink.push({
    task,
    provider: r.provider as UsageRecord["provider"],
    modelId: r.modelId,
    inputTokens: res.usage?.inputTokens ?? 0,
    outputTokens: res.usage?.outputTokens ?? 0,
    durationMs: Date.now() - started,
  });
  return res;
}

/**
 * Pull a single JSON object out of a model's text reply. Handles an optional
 * ```json fence and any lead-in prose by slicing from the first brace to the
 * last. The caller validates the result with Zod and repairs on failure.
 */
function parseModelJson(text: string): unknown {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  const json = start >= 0 && end > start ? body.slice(start, end + 1) : body;
  return JSON.parse(json);
}

/**
 * Structured output without a grammar: the model is asked for JSON matching a
 * schema and we parse the text ourselves.
 *
 * Grammar-constrained decoding (`Output.object`) cannot handle a schema as large
 * as the blueprint: Gemini rejects it as "too many states". Describing the
 * shape in the prompt and parsing the reply keeps the same schema without
 * hitting that limit. The caller's Zod validation and repair loop still
 * guards correctness.
 */
async function generateJsonObject(
  task: AiTask,
  r: { provider: string; modelId: string; model: Parameters<typeof generateText>[0]["model"] },
  schema: ReturnType<typeof modelSchema>,
  args: { system: string; prompt: string; temperature: number },
  usage: UsageRecord[],
): Promise<unknown> {
  const instruction = `\n\nReturn ONLY one JSON object and nothing else: no explanation, no markdown fence. It must match this JSON schema exactly:\n${JSON.stringify(schema.jsonSchema)}`;
  const res = await timed(
    task,
    r,
    () => generateText({ model: r.model, system: args.system, prompt: args.prompt + instruction, temperature: args.temperature, maxOutputTokens: 24_000 }),
    usage,
  );
  return parseModelJson(res.text);
}

/* ------------------------------------------------------------------ */
/* Curriculum                                                           */
/* ------------------------------------------------------------------ */

export async function generateCurriculum(input: {
  goal: string;
  scope: LearningScope;
  scopeNote?: string | null;
  interest?: string | null;
  learner: LearnerContext;
  tier: Tier;
}): Promise<{ curriculum: GeneratedCurriculum; meta: PipelineMeta }> {
  const r = resolveModel("curriculum", input.tier);
  if (r.provider === "mock") {
    return { curriculum: GeneratedCurriculum.parse(mockCurriculum(input.goal, input.learner)), meta: meta("mock", "mock", []) };
  }
  const usage: UsageRecord[] = [];
  const schema = modelSchema(GeneratedCurriculum);
  let problems: string[] = [];
  let curriculum: GeneratedCurriculum | null = null;

  // The model sees a shape-only schema, so bounds are checked here and sent
  // back as repair instructions rather than failing the job outright.
  for (let attempt = 0; attempt < 2 && !curriculum; attempt++) {
    const { system, prompt } = curriculumPrompt(input);
    const repair = problems.length ? `\n\nYOUR PREVIOUS ATTEMPT WAS INVALID. Fix all of these and return the whole curriculum again:\n${problems.map((p) => `- ${p}`).join("\n")}` : "";
    const res = await timed("curriculum", r, () => generateText({ model: r.model, system, prompt: prompt + repair, output: Output.object({ schema }), temperature: 0.7 }), usage);
    const parsed = GeneratedCurriculum.safeParse(dropBlank(res.output));
    if (parsed.success) curriculum = parsed.data;
    else problems = schemaProblems(parsed.error);
  }
  if (!curriculum) throw new Error(`curriculum did not match the schema: ${problems.join("; ")}`);

  // Slugs must be unique and prerequisites must resolve; fix silently rather than fail.
  const seen = new Set<string>();
  for (const t of curriculum.topics) {
    let slug = t.slug;
    let n = 2;
    while (seen.has(slug)) slug = `${t.slug}-${n++}`;
    t.slug = slug;
    seen.add(slug);
  }
  for (const t of curriculum.topics) t.prerequisites = t.prerequisites.filter((p) => seen.has(p) && p !== t.slug);
  return { curriculum, meta: meta(r.provider, r.modelId, usage) };
}

/* ------------------------------------------------------------------ */
/* Lesson plan                                                          */
/* ------------------------------------------------------------------ */

export interface LessonPlanInput extends LessonPlanPromptInput {
  tier: Tier;
}

export interface LessonPlanResult {
  plan: LessonPlan;
  /** true when the planner failed and the deterministic default was used */
  usedDefault: boolean;
  /** lint problems of the last rejected planner attempt, if any */
  problems: string[];
  meta: PipelineMeta;
}

/** Objectives beyond six are dropped everywhere, so codes are stable. */
function objectiveTexts(topic: { objectives: string[] }): string[] {
  return topic.objectives.slice(0, 6);
}

function misconceptionIds(learner: LearnerContext): string[] {
  return learner.misconceptions.map((_, i) => `m${i + 1}`);
}

export function planLintContext(input: LessonPlanPromptInput): PlanLintContext {
  return {
    objectiveCodes: objectiveTexts(input.topic).map((_, i) => `lo${i + 1}`),
    age: input.learner.age,
    scope: input.curriculum.scope,
    recallCandidateIds: input.recallCandidates.map((c) => c.objectiveId),
    misconceptionIds: misconceptionIds(input.learner),
  };
}

/** Fields the server already knows are overwritten rather than argued about. */
function normalizePlan(plan: LessonPlan, input: LessonPlanPromptInput, ctx: PlanLintContext): LessonPlan {
  const band = ageBandFor(input.learner.age);
  const known = new Set(ctx.misconceptionIds ?? []);
  return {
    ...plan,
    planVersion: 2,
    scope: input.curriculum.scope,
    learnerConstraints: {
      ...plan.learnerConstraints,
      ageBand: band,
      readingLevel: input.learner.readingLevel,
      textBudget: Math.min(plan.learnerConstraints.textBudget, LESSON_LIMITS[band].wordsPerBite),
      misconceptionIds: plan.learnerConstraints.misconceptionIds.filter((id) => known.has(id)),
    },
  };
}

export function lintPlanForInput(plan: LessonPlan, input: LessonPlanPromptInput): string[] {
  const problems = lintLessonPlan(plan, planLintContext(input));
  if (plan.mode === "sub_index" && input.allowSplit === false) {
    problems.push('this topic is already part of a unit and cannot be split; return mode "single"');
  }
  return problems;
}

export async function generateLessonPlan(input: LessonPlanInput): Promise<LessonPlanResult> {
  const objectives = objectiveTexts(input.topic);
  const fallback = () =>
    defaultLessonPlan({
      objectives,
      age: input.learner.age,
      readingLevel: input.learner.readingLevel,
      scope: input.curriculum.scope,
      framingInterest: input.framingInterest,
    });

  const r = resolveModel("planner", input.tier);
  if (r.provider === "mock") {
    const bp = ArtifactBlueprint.parse(mockBlueprint({ topic: input.topic, learner: input.learner }));
    return { plan: planFromBlueprint(bp, { scope: input.curriculum.scope, framingInterest: input.framingInterest }), usedDefault: false, problems: [], meta: meta("mock", "mock", []) };
  }

  const usage: UsageRecord[] = [];
  const schema = modelSchema(LessonPlan);
  const ctx = planLintContext(input);
  let problems: string[] = [...(input.repairProblems ?? [])];

  for (let attempt = 0; attempt < 3; attempt++) {
    const { system, prompt } = lessonPlanPrompt({ ...input, repairProblems: problems });
    let output: unknown;
    try {
      const res = await timed("planner", r, () => generateText({ model: r.model, system, prompt, output: Output.object({ schema }), temperature: 0.4 }), usage);
      output = dropBlank(res.output);
    } catch (err) {
      problems = [`the response could not be read: ${(err as Error).message}`];
      continue;
    }
    const parsed = LessonPlan.safeParse(output);
    if (!parsed.success) {
      problems = schemaProblems(parsed.error);
      continue;
    }
    const plan = normalizePlan(parsed.data, input, ctx);
    problems = lintPlanForInput(plan, input);
    if (problems.length === 0) return { plan, usedDefault: false, problems: [], meta: meta(r.provider, r.modelId, usage) };
  }

  // The lesson must still be generated; the default plan always lints clean.
  return { plan: fallback(), usedDefault: true, problems, meta: meta(r.provider, r.modelId, usage) };
}

/* ------------------------------------------------------------------ */
/* Blueprint                                                            */
/* ------------------------------------------------------------------ */

export const FactcheckResult = z.object({
  ok: z.boolean().describe("true when there are no critical problems"),
  issues: z
    .array(
      z.object({
        severity: z
          .enum(["safety", "critical", "minor"])
          .describe("safety = blocks publishing (unsafe/inappropriate). critical = wrong fact/answer key. minor = imprecise."),
        level: z
          .enum(["content", "plan"])
          .default("content")
          .describe("content = fixable in place. plan = the lesson structure itself cannot teach the objective correctly."),
        where: z.string().describe("section id, question id or 'general'"),
        problem: z.string(),
        suggestedFix: z.string().optional(),
      }),
    )
    .default([]),
});
export type FactcheckResult = z.infer<typeof FactcheckResult>;
export type FactcheckIssue = FactcheckResult["issues"][number];

/** Non-safety issues never block. Safety issues always do. */
export function isBlocking(issue: Omit<FactcheckIssue, "level"> & Partial<Pick<FactcheckIssue, "level">>): boolean {
  return issue.severity === "safety";
}

export function blockingIssues(fc: FactcheckResult): FactcheckResult["issues"] {
  return fc.issues.filter(isBlocking);
}

/** Issues that need the plan changed, not just the wording. */
export function planLevelIssues(fc: FactcheckResult): FactcheckResult["issues"] {
  return fc.issues.filter((i) => i.level === "plan" && i.severity !== "minor");
}

export interface BlueprintInput {
  plan: LessonPlan;
  topic: { slug: string; title: string; description: string; objectives: string[]; difficulty: number };
  curriculum: { title: string; description: string; topicTitles: string[] };
  learner: LearnerContext;
  /** Candidates the plan may have chosen; only the chosen ones reach the prompt. */
  recallCandidates: RecallCandidate[];
  tier: Tier;
  onStage?: LessonStageReporter;
}

/** Progress callback for the waiting screen. Must not throw. */
export type LessonStageReporter = (stage: Extract<ArtifactStage, "planning" | "writing" | "checking" | "building">) => void | Promise<void>;

export interface BlueprintResult {
  blueprint: ArtifactBlueprint;
  factcheck: FactcheckResult;
  lintProblems: string[];
  /** fact-check issues at plan level; the orchestrator may replan once */
  planIssues: FactcheckResult["issues"];
  meta: PipelineMeta;
}

function framingInterests(learner: LearnerContext, plan: LessonPlan): string[] {
  const out = [...learner.interests];
  const framing = plan.learnerConstraints.framingInterest;
  if (framing && !out.includes(framing)) out.push(framing);
  return out;
}

function forceBlueprintFields(bp: GameBlueprint, input: BlueprintInput): GameBlueprint {
  return {
    ...bp,
    schemaVersion: 3,
    topicSlug: input.topic.slug,
    audience: { age: input.learner.age, readingLevel: input.learner.readingLevel },
  };
}

/** Everything the blueprint must satisfy: its own lint and fidelity to the plan. */
export function lintBlueprintForPlan(bp: ArtifactBlueprint, plan: LessonPlan, learner: LearnerContext): string[] {
  return [...lintBlueprint(bp, { interests: framingInterests(learner, plan) }), ...lintBlueprintAgainstPlan(bp, plan)];
}

export async function generateBlueprint(input: BlueprintInput): Promise<BlueprintResult> {
  const r = resolveModel("blueprint", input.tier);
  if (r.provider === "mock") {
    const blueprint = ArtifactBlueprint.parse(mockBlueprint({ topic: input.topic, learner: input.learner }));
    return {
      blueprint,
      factcheck: mockFactcheck(),
      lintProblems: lintBlueprintForPlan(blueprint, input.plan, input.learner),
      planIssues: [],
      meta: meta("mock", "mock", []),
    };
  }

  const { plan } = input;
  const chosen = new Set(plan.recall.map((x) => x.objectiveId));
  const misconceptions = input.learner.misconceptions.map((text, i) => ({ id: `m${i + 1}`, text }));
  const promptFor = (repairProblems: string[]) =>
    blueprintPrompt({
      plan,
      topic: { ...input.topic, objectives: objectiveTexts(input.topic) },
      curriculum: input.curriculum,
      audience: { age: input.learner.age, readingLevel: input.learner.readingLevel },
      misconceptions: misconceptions.filter((m) => plan.learnerConstraints.misconceptionIds.includes(m.id)),
      analogies: input.learner.analogies,
      recall: input.recallCandidates.filter((c) => chosen.has(c.objectiveId)),
      repairProblems,
    });

  const usage: UsageRecord[] = [];
  const schema = modelSchema(GameBlueprint);
  let problems: string[] = [];
  let blueprint: ArtifactBlueprint | null = null;
  let bestEffort: ArtifactBlueprint | null = null;

  for (let attempt = 0; attempt < 3 && !blueprint; attempt++) {
    const { system, prompt } = promptFor(problems);
    let output: unknown;
    try {
      output = await generateJsonObject("blueprint", r, schema, { system, prompt, temperature: 0.6 }, usage);
    } catch {
      problems = ["Return a single valid JSON object that matches the schema exactly."];
      continue;
    }
    // Shape-only schema for the model; bounds and patterns are enforced here.
    const parsed = GameBlueprint.safeParse(dropBlank(output));
    if (!parsed.success) {
      problems = schemaProblems(parsed.error);
      continue;
    }
    const candidate = forceBlueprintFields(parsed.data, input);
    bestEffort = candidate;
    problems = lintBlueprintForPlan(candidate, plan, input.learner);
    if (problems.length === 0) blueprint = candidate;
  }
  // Keep the last structurally valid attempt; its lint problems are recorded.
  blueprint = blueprint ?? bestEffort;
  if (!blueprint) throw new Error(`blueprint did not match the schema: ${problems.join("; ")}`);

  // Independent review. Content-level critical or unsafe issues get one repair
  // pass. Safety issues block publishing in jobs.ts while any remain.
  await input.onStage?.("checking");
  let factcheck = await runFactcheck(blueprint, input.tier, usage);
  const fixable = factcheck.issues.filter((i) => i.severity !== "minor" && i.level === "content");
  if (fixable.length) {
    const fixes = fixable.map((i) => `${i.where}: ${i.problem}${i.suggestedFix ? ` (fix: ${i.suggestedFix})` : ""}`);
    const { system, prompt } = promptFor([...problems, ...fixes]);
    let output: unknown = null;
    try {
      output = await generateJsonObject("blueprint", r, schema, { system, prompt, temperature: 0.4 }, usage);
    } catch {
      output = null;
    }
    const parsed = GameBlueprint.safeParse(dropBlank(output));
    if (parsed.success) {
      const repaired = forceBlueprintFields(parsed.data, input);
      // A repair that breaks the plan is not a repair.
      if (lintBlueprintAgainstPlan(repaired, plan).length === 0) {
        const repairedProblems = lintBlueprintForPlan(repaired, plan, input.learner);
        const recheck = await runFactcheck(repaired, input.tier, usage);
        const serious = (fc: FactcheckResult) => fc.issues.filter((i) => i.severity !== "minor").length;
        if (serious(recheck) < serious(factcheck) || recheck.ok) {
          blueprint = repaired;
          problems = repairedProblems;
          factcheck = recheck;
        }
      }
    }
  }

  return { blueprint, factcheck, lintProblems: problems, planIssues: planLevelIssues(factcheck), meta: meta(r.provider, r.modelId, usage) };
}

async function runFactcheck(bp: ArtifactBlueprint, tier: Tier, usage: UsageRecord[]): Promise<FactcheckResult> {
  const r = resolveModel("factcheck", tier);
  if (r.provider === "mock") return mockFactcheck();
  const { system, prompt } = factcheckPrompt(bp);
  try {
    const res = await timed("factcheck", r, () => generateText({ model: r.model, system, prompt, output: Output.object({ schema: modelSchema(FactcheckResult) }), temperature: 0 }), usage);
    const parsed = FactcheckResult.parse(dropBlank(res.output));
    // Normalise: ok must agree with the issue list. Safety and critical both count.
    parsed.ok = !parsed.issues.some((i) => i.severity === "safety" || i.severity === "critical");
    return parsed;
  } catch (err) {
    return { ok: true, issues: [{ severity: "minor", level: "content", where: "general", problem: `fact-check unavailable: ${(err as Error).message}` }] };
  }
}

/* ------------------------------------------------------------------ */
/* Lesson orchestration                                                 */
/* ------------------------------------------------------------------ */

export interface LessonInput extends Omit<LessonPlanPromptInput, "repairProblems"> {
  tier: Tier;
  onStage?: LessonStageReporter;
}

export type LessonResult =
  | { kind: "split"; plan: LessonPlan; meta: PipelineMeta }
  | ({
      kind: "lesson";
      plan: LessonPlan;
      usedDefaultPlan: boolean;
      planProblems: string[];
      replanned: boolean;
      html: string;
    } & BlueprintResult);

function mergeMeta(a: PipelineMeta, b: PipelineMeta): PipelineMeta {
  return { ...b, usage: [...a.usage, ...b.usage] };
}

/**
 * Goal + scope + interest + memory + age → LessonPlan (linted) → blueprint
 * (linted against the plan) → fact and safety check → built-in player HTML.
 * A plan-level fact-check issue triggers one replan. A sub_index plan is
 * returned for the caller to split the topic; no lesson is generated for it.
 */
export async function generateLesson(input: LessonInput): Promise<LessonResult> {
  const { onStage, ...rest } = input;
  const planInput: LessonPlanInput = rest;
  await onStage?.("planning");
  const planned = await generateLessonPlan(planInput);
  if (planned.plan.mode === "sub_index") return { kind: "split", plan: planned.plan, meta: planned.meta };

  const bpInput = (plan: LessonPlan): BlueprintInput => ({
    plan,
    topic: input.topic,
    curriculum: input.curriculum,
    learner: input.learner,
    recallCandidates: input.recallCandidates,
    tier: input.tier,
  });
  let plan = planned.plan;
  await onStage?.("writing");
  // Only the first pass reports progress; a replan stays under "checking".
  let built = await generateBlueprint({ ...bpInput(plan), onStage });
  let usedDefaultPlan = planned.usedDefault;
  let planProblems = planned.problems;
  let replanned = false;
  let metaAll = mergeMeta(planned.meta, built.meta);

  if (built.planIssues.length) {
    const issues = built.planIssues.map((i) => `fact-check (${i.where}): ${i.problem}${i.suggestedFix ? ` (fix: ${i.suggestedFix})` : ""}`);
    const second = await generateLessonPlan({ ...planInput, allowSplit: false, repairProblems: issues });
    metaAll = mergeMeta(metaAll, second.meta);
    if (second.plan.mode === "single" && !second.usedDefault) {
      const rebuilt = await generateBlueprint(bpInput(second.plan));
      metaAll = mergeMeta(metaAll, rebuilt.meta);
      const serious = (fc: FactcheckResult) => fc.issues.filter((i) => i.severity !== "minor").length;
      if (serious(rebuilt.factcheck) <= serious(built.factcheck)) {
        plan = second.plan;
        built = rebuilt;
        usedDefaultPlan = false;
        planProblems = [];
        replanned = true;
      }
    }
  }

  await onStage?.("building");
  const html = renderBlueprintHtml(built.blueprint);
  return { kind: "lesson", plan, usedDefaultPlan, planProblems, replanned, html, ...built, meta: metaAll };
}

/* ------------------------------------------------------------------ */
/* Learner memory compaction                                            */
/* ------------------------------------------------------------------ */

export async function compactLearnerMemory(input: {
  summary: string;
  cards: { kind: string; value: string; confidence: number }[];
  tier: Tier;
}): Promise<{ update: MemoryUpdate; meta: PipelineMeta }> {
  const empty = MemoryUpdate.parse({ upserts: [], deactivate: [] });
  const r = resolveModel("memory", input.tier);
  if (r.provider === "mock") return { update: empty, meta: meta("mock", "mock", []) };

  const usage: UsageRecord[] = [];
  const schema = modelSchema(MemoryUpdate);
  let problems: string[] = [];
  let update: MemoryUpdate | null = null;

  for (let attempt = 0; attempt < 2 && !update; attempt++) {
    const { system, prompt } = memoryPrompt(input);
    const repair = problems.length ? `\n\nYOUR PREVIOUS ATTEMPT WAS INVALID. Fix all of these and return the update again:\n${problems.map((p) => `- ${p}`).join("\n")}` : "";
    const res = await timed(
      "memory",
      r,
      () => generateText({ model: r.model, system, prompt: prompt + repair, output: Output.object({ schema }), temperature: 0.2 }),
      usage,
    );
    const parsed = MemoryUpdate.safeParse(dropBlank(res.output));
    if (parsed.success) update = parsed.data;
    else problems = schemaProblems(parsed.error);
  }
  if (!update) throw new Error(`memory update did not match the schema: ${problems.join("; ")}`);
  return { update, meta: meta(r.provider, r.modelId, usage) };
}

/* ------------------------------------------------------------------ */
/* Parent report                                                        */
/* ------------------------------------------------------------------ */

export async function generateReportText(input: { childName: string; stats: Record<string, unknown>; tier: Tier }): Promise<{ text: string; meta: PipelineMeta }> {
  const r = resolveModel("report", input.tier);
  if (r.provider === "mock") return { text: mockReport(input.childName, input.stats), meta: meta("mock", "mock", []) };
  const usage: UsageRecord[] = [];
  const { system, prompt } = reportPrompt(input);
  const res = await timed("report", r, () => generateText({ model: r.model, system, prompt, temperature: 0.3 }), usage);
  return { text: res.text.trim(), meta: meta(r.provider, r.modelId, usage) };
}
