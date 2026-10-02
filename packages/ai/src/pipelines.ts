import { Output, generateText } from "ai";
import { z } from "zod";
import {
  ArtifactBlueprint,
  GeneratedCurriculum,
  MemoryUpdate,
  lintBlueprint,
  type LearnerContext,
} from "@eco/contracts";
import { normalizeGeneratedHtml, renderBlueprintHtml, validateArtifactHtml, type HtmlValidationResult } from "@eco/learnkit";
import { mockBlueprint, mockCurriculum, mockFactcheck, mockReport } from "./mock";
import { PROMPT_VERSION, blueprintPrompt, codegenPrompt, curriculumPrompt, factcheckPrompt, memoryPrompt, reportPrompt } from "./prompts";
import { resolveModel, type AiTask, type Tier, type UsageRecord } from "./provider";
import { modelSchema, schemaProblems } from "./schema";

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

/* ------------------------------------------------------------------ */
/* Curriculum                                                           */
/* ------------------------------------------------------------------ */

export async function generateCurriculum(input: {
  goal: string;
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
    const { system, prompt } = curriculumPrompt(input.goal, input.learner);
    const repair = problems.length ? `\n\nYOUR PREVIOUS ATTEMPT WAS INVALID. Fix all of these and return the whole curriculum again:\n${problems.map((p) => `- ${p}`).join("\n")}` : "";
    const res = await timed("curriculum", r, () => generateText({ model: r.model, system, prompt: prompt + repair, output: Output.object({ schema }), temperature: 0.7 }), usage);
    const parsed = GeneratedCurriculum.safeParse(res.output);
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
        where: z.string().describe("section id, question id or 'general'"),
        problem: z.string(),
        suggestedFix: z.string().optional(),
      }),
    )
    .default([]),
});
export type FactcheckResult = z.infer<typeof FactcheckResult>;

/** Non-safety issues never block. Safety issues always do. */
export function isBlocking(issue: FactcheckResult["issues"][number]): boolean {
  return issue.severity === "safety";
}

export function blockingIssues(fc: FactcheckResult): FactcheckResult["issues"] {
  return fc.issues.filter(isBlocking);
}

export interface BlueprintInput {
  topic: { slug: string; title: string; description: string; objectives: string[]; difficulty: number };
  curriculum: { title: string; description: string; topicTitles: string[] };
  learner: LearnerContext;
  priorPerformance?: string;
  tier: Tier;
}

export async function generateBlueprint(input: BlueprintInput): Promise<{
  blueprint: ArtifactBlueprint;
  factcheck: FactcheckResult;
  lintProblems: string[];
  meta: PipelineMeta;
}> {
  const r = resolveModel("blueprint", input.tier);
  if (r.provider === "mock") {
    const blueprint = ArtifactBlueprint.parse(mockBlueprint({ topic: input.topic, learner: input.learner }));
    return { blueprint, factcheck: mockFactcheck(), lintProblems: lintBlueprint(blueprint), meta: meta("mock", "mock", []) };
  }

  const usage: UsageRecord[] = [];
  const schema = modelSchema(ArtifactBlueprint);
  let problems: string[] = [];
  let blueprint: ArtifactBlueprint | null = null;
  let bestEffort: ArtifactBlueprint | null = null;

  for (let attempt = 0; attempt < 3 && !blueprint; attempt++) {
    const { system, prompt } = blueprintPrompt({ ...input, repairProblems: problems });
    const res = await timed("blueprint", r, () => generateText({ model: r.model, system, prompt, output: Output.object({ schema }), temperature: 0.6 }), usage);
    // Shape-only schema for the model; bounds and patterns are enforced here.
    const parsed = ArtifactBlueprint.safeParse(res.output);
    if (!parsed.success) {
      problems = schemaProblems(parsed.error);
      continue;
    }
    const candidate = parsed.data;
    candidate.topicSlug = input.topic.slug;
    bestEffort = candidate;
    problems = lintBlueprint(candidate);
    if (problems.length === 0) blueprint = candidate;
  }
  // Keep the last structurally valid attempt; its lint problems are recorded.
  blueprint = blueprint ?? bestEffort;
  if (!blueprint) throw new Error(`blueprint did not match the schema: ${problems.join("; ")}`);

  // Independent factual review; one repair pass if anything critical or unsafe was found.
  // Critical == wrong facts/answer keys; those get one fix attempt but don't hard-block.
  // Safety == unsafe/inappropriate content; jobs.ts refuses to publish while any remain.
  let factcheck = await runFactcheck(blueprint, input.tier, usage);
  const needsRepair = (fc: FactcheckResult) => fc.issues.some((i) => i.severity === "critical" || i.severity === "safety");
  if (needsRepair(factcheck)) {
    const fixes = factcheck.issues
      .filter((i) => i.severity !== "minor")
      .map((i) => `${i.where}: ${i.problem}${i.suggestedFix ? ` (fix: ${i.suggestedFix})` : ""}`);
    const { system, prompt } = blueprintPrompt({ ...input, repairProblems: [...problems, ...fixes] });
    const res = await timed("blueprint", r, () => generateText({ model: r.model, system, prompt, output: Output.object({ schema }), temperature: 0.4 }), usage);
    const parsed = ArtifactBlueprint.safeParse(res.output);
    if (parsed.success) {
      const repaired = parsed.data;
      repaired.topicSlug = input.topic.slug;
      const repairedProblems = lintBlueprint(repaired);
      const recheck = await runFactcheck(repaired, input.tier, usage);
      const before = factcheck.issues.filter((i) => i.severity !== "minor").length;
      const after = recheck.issues.filter((i) => i.severity !== "minor").length;
      if (after < before || recheck.ok) {
        blueprint = repaired;
        problems = repairedProblems;
        factcheck = recheck;
      }
    }
  }

  return { blueprint, factcheck, lintProblems: problems, meta: meta(r.provider, r.modelId, usage) };
}

async function runFactcheck(bp: ArtifactBlueprint, tier: Tier, usage: UsageRecord[]): Promise<FactcheckResult> {
  const r = resolveModel("factcheck", tier);
  if (r.provider === "mock") return mockFactcheck();
  const { system, prompt } = factcheckPrompt(bp);
  try {
    const res = await timed("factcheck", r, () => generateText({ model: r.model, system, prompt, output: Output.object({ schema: modelSchema(FactcheckResult) }), temperature: 0 }), usage);
    const parsed = FactcheckResult.parse(res.output);
    // Normalise: ok must agree with the issue list. Safety and critical both count.
    parsed.ok = !parsed.issues.some((i) => i.severity === "safety" || i.severity === "critical");
    return parsed;
  } catch (err) {
    return { ok: true, issues: [{ severity: "minor", where: "general", problem: `fact-check unavailable: ${(err as Error).message}` }] };
  }
}

/* ------------------------------------------------------------------ */
/* Code generation                                                      */
/* ------------------------------------------------------------------ */

export interface CodegenResult {
  html: string;
  /** true when the deterministic blueprint player was used instead of generated code */
  usedFallback: boolean;
  validation: HtmlValidationResult;
  meta: PipelineMeta;
  attempts: number;
}

function extractHtml(text: string): string {
  const fenced = text.match(/```html\s*([\s\S]*?)```/i) ?? text.match(/```\s*(<!doctype[\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.search(/<!doctype html>|<html[\s>]/i);
  if (start >= 0) {
    const end = text.lastIndexOf("</html>");
    return end > start ? text.slice(start, end + "</html>".length) : text.slice(start);
  }
  return text.trim();
}

export async function generateArtifactHtml(input: { blueprint: ArtifactBlueprint; tier: Tier }): Promise<CodegenResult> {
  const r = resolveModel("codegen", input.tier);
  const fallbackHtml = renderBlueprintHtml(input.blueprint);
  if (r.provider === "mock") {
    return { html: fallbackHtml, usedFallback: true, validation: validateArtifactHtml(fallbackHtml), meta: meta("mock", "mock", []), attempts: 0 };
  }

  const usage: UsageRecord[] = [];
  const { system, prompt } = codegenPrompt(input.blueprint);
  let lastValidation: HtmlValidationResult | null = null;
  let attempts = 0;

  for (; attempts < 2; attempts++) {
    const repair =
      lastValidation && lastValidation.errors.length
        ? `\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED FOR THESE REASONS. Fix all of them and return the full document again:\n${lastValidation.errors.map((e) => `- ${e}`).join("\n")}`
        : "";
    const res = await timed("codegen", r, () => generateText({ model: r.model, system, prompt: prompt + repair, temperature: 0.5, maxOutputTokens: 32_000 }), usage);
    const html = normalizeGeneratedHtml(extractHtml(res.text));
    const validation = validateArtifactHtml(html);
    lastValidation = validation;
    if (validation.ok) {
      return { html, usedFallback: false, validation, meta: meta(r.provider, r.modelId, usage), attempts: attempts + 1 };
    }
  }

  // Section 28: learning continues even when generation fails.
  const validation = validateArtifactHtml(fallbackHtml);
  validation.warnings.unshift(`generated code rejected after ${attempts} attempts: ${lastValidation?.errors.join("; ") ?? "unknown"}`);
  return { html: fallbackHtml, usedFallback: true, validation, meta: meta(r.provider, r.modelId, usage), attempts };
}

/* ------------------------------------------------------------------ */
/* Parent report                                                        */
/* ------------------------------------------------------------------ */

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
    const parsed = MemoryUpdate.safeParse(res.output);
    if (parsed.success) update = parsed.data;
    else problems = schemaProblems(parsed.error);
  }
  if (!update) throw new Error(`memory update did not match the schema: ${problems.join("; ")}`);
  return { update, meta: meta(r.provider, r.modelId, usage) };
}

export async function generateReportText(input: { childName: string; stats: Record<string, unknown>; tier: Tier }): Promise<{ text: string; meta: PipelineMeta }> {
  const r = resolveModel("report", input.tier);
  if (r.provider === "mock") return { text: mockReport(input.childName, input.stats), meta: meta("mock", "mock", []) };
  const usage: UsageRecord[] = [];
  const { system, prompt } = reportPrompt(input);
  const res = await timed("report", r, () => generateText({ model: r.model, system, prompt, temperature: 0.3 }), usage);
  return { text: res.text.trim(), meta: meta(r.provider, r.modelId, usage) };
}
