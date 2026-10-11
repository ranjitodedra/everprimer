import "server-only";
import { after } from "next/server";
import { ArtifactBlueprint, type ArtifactStage, type CurriculumStage, type LessonPlan } from "@eco/contracts";
import {
  blockingIssues,
  compactLearnerMemory,
  generateCurriculum,
  generateLesson,
  isPermanentAiError,
  type PipelineMeta,
  type RecallCandidate,
  type Tier,
} from "@eco/ai";
import { renderBlueprintHtml } from "@eco/learnkit";
import type { ArtifactRow, ChildRow, CurriculumRow, GenerationJobRow, JobKind, MemoryRow, ObjectiveRow, PersonalizationRow, TopicRow } from "@eco/db";
import { refundCredit, spendCredit, startArtifactJob, type CreditError } from "@/lib/credits";
import { learnerContextFrom } from "@/lib/learner";
import { applyMemoryUpdate, lessonMasterySummary } from "@/lib/memory";
import { buildDailyReport } from "@/lib/report";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Minimal Postgres-backed job queue.
 *
 * Jobs are enqueued by server actions, kicked immediately with `after()` by
 * the caller, and swept by /api/jobs/run for anything that was missed.
 * Billable jobs reserve a lesson credit in the same transaction as the insert.
 * Every handler is idempotent enough to be retried: a retry spends the same
 * reserve and does not take another credit.
 */

export type JobPayload =
  | { kind: "curriculum"; curriculumId: string }
  | { kind: "artifact"; topicId: string; reason?: "initial" | "prewarm" | "regenerate"; artifactId?: string }
  | { kind: "daily_report"; childId: string; date: string };

export async function enqueueJob(payload: JobPayload): Promise<string> {
  if (payload.kind !== "daily_report") throw new Error("Billable jobs must reserve a credit before they are enqueued");
  const db = createServiceClient();
  const { kind, ...rest } = payload;
  const { data, error } = await db
    .from("generation_jobs")
    .insert({ kind: kind satisfies JobKind, payload: rest })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/**
 * Start a job without blocking the current response. `after()` keeps the
 * serverless function alive until the job finishes; outside a request scope
 * (tests, scripts) it falls back to a plain detached promise.
 */
export function kickJob(jobId: string): void {
  try {
    after(() => runJob(jobId));
  } catch {
    void runJob(jobId);
  }
}

function refundOnSkip(result: unknown): boolean {
  return !!result && typeof result === "object" && (result as { skipped?: boolean }).skipped === true;
}

function isSplit(result: unknown): boolean {
  return !!result && typeof result === "object" && (result as { split?: boolean }).split === true;
}

/** Claim and run one job. Safe to call concurrently; the claim is atomic. */
export async function runJob(jobId: string): Promise<void> {
  const db = createServiceClient();
  const { data: claimed } = await db
    .from("generation_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (!claimed) return; // someone else has it, or it is done
  const job = claimed as GenerationJobRow;

  try {
    const usage = await dispatch(job);
    if (job.kind !== "memory") {
      if (refundOnSkip(usage)) await refundCredit(job.id);
      else await spendCredit(job.id);
    }
    await db
      .from("generation_jobs")
      .update({ status: "done", finished_at: new Date().toISOString(), usage: usage ?? null, attempts: job.attempts + 1, error: null })
      .eq("id", job.id);
    if (job.kind === "artifact" && isSplit(usage) && typeof job.payload.topicId === "string") {
      try {
        await prewarmFirstPart(job.payload.topicId);
      } catch (err) {
        console.error(`[jobs] first part after split ${job.id} failed:`, err);
      }
    }
    if (job.kind === "curriculum") {
      const curriculumId = job.payload.curriculumId;
      if (typeof curriculumId === "string") {
        try {
          await prewarmFirstTopics(curriculumId);
        } catch (err) {
          console.error(`[jobs] prewarm after curriculum ${job.id} failed:`, err);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = job.attempts + 1;
    const retry = attempts < job.max_attempts && !isPermanentAiError(err);
    if (retry) {
      try {
        await noteRetry(job, message);
      } catch (noteErr) {
        console.error(`[jobs] retry note ${job.id} failed:`, noteErr);
      }
    } else {
      try {
        await refundCredit(job.id);
      } catch (refundErr) {
        console.error(`[jobs] refund ${job.id} failed:`, refundErr);
      }
      try {
        await markJobFailed(job, message);
      } catch (markErr) {
        console.error(`[jobs] failure status ${job.id} failed:`, markErr);
      }
    }
    await db
      .from("generation_jobs")
      .update({
        status: retry ? "queued" : "failed",
        attempts,
        error: message.slice(0, 2000),
        finished_at: retry ? null : new Date().toISOString(),
        run_after: new Date(Date.now() + attempts * 30_000).toISOString(),
      })
      .eq("id", job.id);
    console.error(`[jobs] ${job.kind} ${job.id} failed (attempt ${attempts}):`, message);
  }
}

export async function runQueuedJobs(limit = 5): Promise<number> {
  const db = createServiceClient();
  // Reclaim jobs stuck in "running" for over 10 minutes (crashed worker).
  await db
    .from("generation_jobs")
    .update({ status: "queued" })
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 10 * 60_000).toISOString());

  const { data } = await db
    .from("generation_jobs")
    .select("id")
    .eq("status", "queued")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  const ids = (data ?? []).map((r) => r.id as string);
  await Promise.all(ids.map((id) => runJob(id)));
  return ids.length;
}

async function dispatch(job: GenerationJobRow): Promise<unknown> {
  switch (job.kind) {
    case "curriculum":
      return runCurriculumJob(job.payload.curriculumId as string);
    case "artifact":
      return runArtifactJob(job.payload.topicId as string, typeof job.payload.artifactId === "string" ? job.payload.artifactId : undefined);
    case "daily_report":
      return runDailyReportJob(job.payload.childId as string, job.payload.date as string);
    case "memory":
      return runMemoryJob(job.payload.childId as string, job.payload.topicId as string);
  }
}

async function markJobFailed(job: GenerationJobRow, message: string): Promise<void> {
  await updateJobTarget(job, { status: "failed" }, message);
}

/** The row stays generating; its error tells the waiting screens a retry is pending. */
async function noteRetry(job: GenerationJobRow, message: string): Promise<void> {
  await updateJobTarget(job, {}, message);
}

async function updateJobTarget(job: GenerationJobRow, patch: { status?: "failed" }, message: string): Promise<void> {
  const db = createServiceClient();
  const note = message.slice(0, 2000);
  if (job.kind === "curriculum" && typeof job.payload.curriculumId === "string") {
    await db.from("curricula").update({ ...patch, error: note.slice(0, 1000) }).eq("id", job.payload.curriculumId).eq("status", "generating");
  }
  if (job.kind === "artifact") {
    if (typeof job.payload.artifactId === "string") {
      await db.from("artifacts").update({ ...patch, error: note }).eq("id", job.payload.artifactId).eq("status", "generating");
    } else if (typeof job.payload.topicId === "string") {
      await db.from("artifacts").update({ ...patch, error: note }).eq("topic_id", job.payload.topicId).eq("status", "generating");
    }
  }
}

/**
 * Record the step a generation job is on for the waiting screens. Only rows
 * still generating move; a failure here never fails the job.
 */
async function setStage(table: "curricula", id: string, stage: CurriculumStage): Promise<void>;
async function setStage(table: "artifacts", id: string, stage: ArtifactStage): Promise<void>;
async function setStage(table: "curricula" | "artifacts", id: string, stage: CurriculumStage | ArtifactStage): Promise<void> {
  try {
    const db = createServiceClient();
    const { error } = await db.from(table).update({ stage, stage_at: new Date().toISOString(), error: null }).eq("id", id).eq("status", "generating");
    if (error) console.error(`[jobs] stage ${table} ${id} ${stage}:`, error.message);
  } catch (err) {
    console.error(`[jobs] stage ${table} ${id} ${stage}:`, err);
  }
}

/* ------------------------------------------------------------------ */

async function loadChildContext(childId: string) {
  const db = createServiceClient();
  const [{ data: child }, { data: ctx }, { data: parent }, { data: memories }] = await Promise.all([
    db.from("children").select("*").eq("id", childId).single(),
    db.from("personalization_context").select("*").eq("child_id", childId).eq("active", true),
    db.from("children").select("parent_id, parents!inner(tier)").eq("id", childId).single(),
    db.from("learner_memories").select("*").eq("child_id", childId).eq("active", true),
  ]);
  if (!child) throw new Error(`child ${childId} not found`);
  const tier = ((parent as { parents?: { tier?: Tier } } | null)?.parents?.tier ?? "free") as Tier;
  const row = child as ChildRow;
  return {
    child: row,
    learner: learnerContextFrom(row, (ctx ?? []) as PersonalizationRow[], (memories ?? []) as MemoryRow[], tier),
    tier,
  };
}

async function runCurriculumJob(curriculumId: string): Promise<PipelineMeta> {
  const db = createServiceClient();
  const { data: cur } = await db.from("curricula").select("*").eq("id", curriculumId).single();
  if (!cur) throw new Error(`curriculum ${curriculumId} not found`);
  const curriculum = cur as CurriculumRow;
  const { learner, tier } = await loadChildContext(curriculum.child_id);

  await setStage("curricula", curriculumId, "outlining");
  const { curriculum: generated, meta } = await generateCurriculum({
    goal: curriculum.goal_text,
    scope: curriculum.scope,
    scopeNote: curriculum.scope_note,
    interest: curriculum.interest,
    learner,
    tier,
  });

  await setStage("curricula", curriculumId, "saving");
  // Idempotency: if topics already exist for this curriculum, do not duplicate.
  const { count } = await db.from("topics").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId);
  if (!count) {
    const { data: topics, error } = await db
      .from("topics")
      .insert(
        generated.topics.map((t, i) => ({
          curriculum_id: curriculumId,
          slug: t.slug,
          title: t.title,
          description: t.description,
          position: i + 1,
          difficulty: t.difficulty,
          prerequisites: t.prerequisites,
        })),
      )
      .select("id, slug");
    if (error) throw error;
    const idBySlug = new Map((topics ?? []).map((t) => [t.slug as string, t.id as string]));
    const objectives = generated.topics.flatMap((t) =>
      t.learningObjectives.map((text, i) => ({ topic_id: idBySlug.get(t.slug)!, code: `lo${i + 1}`, text, position: i + 1 })),
    );
    const { error: objErr } = await db.from("learning_objectives").insert(objectives);
    if (objErr) throw objErr;
  }

  await db
    .from("curricula")
    .update({ title: generated.title, description: generated.description, status: "ready", error: null })
    .eq("id", curriculumId);

  return meta;
}

/** Pre-warm the first two lessons only while the account still has credits. */
async function prewarmFirstTopics(curriculumId: string): Promise<void> {
  const db = createServiceClient();
  const { data: firstTopics } = await db
    .from("topics")
    .select("id")
    .eq("curriculum_id", curriculumId)
    .eq("kind", "lesson")
    .order("position", { ascending: true })
    .limit(2);
  for (const t of firstTopics ?? []) {
    const started = await startArtifactJob(t.id as string, "prewarm");
    if (started.ok && started.jobId) kickJob(started.jobId);
  }
}

async function runArtifactJob(topicId: string, artifactId?: string): Promise<unknown> {
  const db = createServiceClient();
  const { data: topicRow } = await db.from("topics").select("*").eq("id", topicId).single();
  if (!topicRow) throw new Error(`topic ${topicId} not found`);
  const topic = topicRow as TopicRow;
  // A unit has no lesson of its own; its child topics do.
  if (topic.kind === "unit") return { skipped: true, unit: true };

  let target: ArtifactRow;
  if (artifactId) {
    const { data } = await db.from("artifacts").select("*").eq("id", artifactId).maybeSingle();
    if (!data) throw new Error(`artifact ${artifactId} not found`);
    target = data as ArtifactRow;
    if (target.status === "published") return { artifactId: target.id, alreadyDone: true };
    if (target.status === "split") return { skipped: true, artifactId: target.id };
    if (target.status === "failed") {
      await db.from("artifacts").update({ status: "generating", error: null }).eq("id", target.id);
      target = { ...target, status: "generating", error: null };
    }
  } else {
    // Jobs from before billing did not store an artifact id.
    const { data: existing } = await db.from("artifacts").select("*").eq("topic_id", topicId).order("version", { ascending: false }).limit(1).maybeSingle();
    const latest = existing as ArtifactRow | null;
    if (latest && latest.status === "generating") {
      target = latest;
    } else if (latest && latest.status === "published") {
      return { skipped: true, artifactId: latest.id };
    } else {
      const version = (latest?.version ?? 0) + 1;
      const { data, error } = await db.from("artifacts").insert({ topic_id: topicId, version, status: "generating" }).select("*").single();
      if (error) throw error;
      target = data as ArtifactRow;
    }
  }

  const [{ data: cur }, { data: siblings }, { data: objectiveRows }] = await Promise.all([
    db.from("curricula").select("*").eq("id", topic.curriculum_id).single(),
    db.from("topics").select("title, position, kind").eq("curriculum_id", topic.curriculum_id).order("position"),
    db.from("learning_objectives").select("*").eq("topic_id", topicId).order("position"),
  ]);
  const curriculum = cur as CurriculumRow;
  const objectives = (objectiveRows ?? []) as ObjectiveRow[];
  const { learner, tier } = await loadChildContext(curriculum.child_id);
  const [priorPerformance, recallCandidates] = await Promise.all([
    describePriorPerformance(curriculum.child_id, topic.curriculum_id),
    loadRecallCandidates(curriculum.child_id, topic.curriculum_id, topicId),
  ]);

  const lesson = await generateLesson({
    topic: { slug: topic.slug, title: topic.title, description: topic.description, objectives: objectives.map((o) => o.text), difficulty: topic.difficulty },
    curriculum: {
      title: curriculum.title,
      description: curriculum.description,
      topicTitles: (siblings ?? []).filter((s) => s.kind !== "unit").map((s) => s.title as string),
      scope: curriculum.scope,
      scopeNote: curriculum.scope_note,
    },
    learner,
    framingInterest: curriculum.interest,
    priorPerformance,
    recallCandidates,
    allowSplit: topic.parent_topic_id === null,
    tier,
    onStage: (stage) => setStage("artifacts", target.id, stage),
  });

  // Too big for one lesson: the topic becomes a unit, its child topics take
  // its place in the path, and the reserved credit is refunded.
  if (lesson.kind === "split") {
    await splitTopic(topic, target.id, lesson.plan);
    return { skipped: true, split: true, artifactId: target.id, usage: lesson.meta.usage };
  }

  const blueprint = ArtifactBlueprint.parse(lesson.blueprint);

  // Keep objective rows in sync with the blueprint (models occasionally add one).
  const known = new Set(objectives.map((o) => o.code));
  const missing = blueprint.learningObjectives.filter((o) => !known.has(o.code));
  if (missing.length) {
    await db.from("learning_objectives").insert(missing.map((o, i) => ({ topic_id: topicId, code: o.code, text: o.text, position: objectives.length + i + 1 })));
  }

  // Only safety issues block publishing. Critical factual issues went through
  // one automatic repair pass and any remaining ones are recorded on the
  // artifact's validation report so the parent (and dev) can see them.
  const blocked = blockingIssues(lesson.factcheck);
  if (blocked.length > 0) {
    throw new Error(`fact-check blocked publishing (safety): ${blocked.map((c) => `${c.where}: ${c.problem}`).join("; ")}`);
  }

  await setStage("artifacts", target.id, "building");
  const html = lesson.html ?? renderBlueprintHtml(blueprint);

  await db
    .from("artifacts")
    .update({
      status: "published",
      blueprint,
      lesson_plan: lesson.plan,
      html,
      used_fallback: true,
      provider: lesson.meta.provider,
      model: lesson.meta.modelId,
      prompt_version: lesson.meta.promptVersion,
      validation_report: {
        lint: lesson.lintProblems,
        plan: { usedDefault: lesson.usedDefaultPlan, problems: lesson.planProblems, replanned: lesson.replanned },
        factcheck: lesson.factcheck,
        blueprintModel: `${lesson.meta.provider}:${lesson.meta.modelId}`,
      },
      error: null,
      published_at: new Date().toISOString(),
    })
    .eq("id", target.id);

  return { artifactId: target.id, usage: lesson.meta.usage };
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "part"
  );
}

async function splitTopic(topic: TopicRow, artifactId: string, plan: LessonPlan): Promise<void> {
  const db = createServiceClient();
  const proposals = plan.proposedChildTopics ?? [];
  const { data: existing } = await db.from("topics").select("slug").eq("curriculum_id", topic.curriculum_id);
  const used = new Set((existing ?? []).map((r) => r.slug as string));
  const children = proposals.map((p) => {
    const base = `${topic.slug.slice(0, 40)}-${slugify(p.title)}`;
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return { slug, title: p.title, description: p.description, objectives: p.objectiveTexts };
  });

  const { error } = await db.rpc("split_topic_into_unit", { p_topic_id: topic.id, p_artifact_id: artifactId, p_plan: plan, p_children: children });
  if (error) throw new Error(error.message);
}

/** The learner was waiting on the unit; start its first part. Runs after the unit's credit is refunded. */
async function prewarmFirstPart(unitTopicId: string): Promise<void> {
  const db = createServiceClient();
  const { data: first } = await db.from("topics").select("id").eq("parent_topic_id", unitTopicId).order("position").limit(1).maybeSingle();
  if (!first) return;
  const started = await startArtifactJob(first.id as string, "prewarm");
  if (started.ok && started.jobId) kickJob(started.jobId);
}

/**
 * Earlier objectives in this curriculum the learner has attempted but not
 * secured, oldest evidence first, so the planner can space their recall.
 */
async function loadRecallCandidates(childId: string, curriculumId: string, topicId: string): Promise<RecallCandidate[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("objective_mastery")
    .select("objective_id, status, score, last_evidence_at, learning_objectives!inner(text, topic_id, topics!inner(title, curriculum_id))")
    .eq("child_id", childId)
    .in("status", ["unknown", "developing"])
    .gt("evidence_count", 0)
    .eq("learning_objectives.topics.curriculum_id", curriculumId)
    .neq("learning_objectives.topic_id", topicId)
    .order("last_evidence_at", { ascending: true, nullsFirst: false })
    .limit(6);
  if (error) {
    console.error("[jobs] recall candidates:", error.message);
    return [];
  }
  const rows = (data ?? []) as unknown as Array<{
    objective_id: string;
    status: string;
    score: number;
    learning_objectives: { text: string; topics: { title: string } };
  }>;
  return rows.map((r) => ({
    objectiveId: r.objective_id,
    text: r.learning_objectives.text,
    topicTitle: r.learning_objectives.topics.title,
    status: `${r.status}, score ${(Number(r.score) * 100).toFixed(0)}%`,
  }));
}

/** Short natural-language summary of how the child has done so far in this curriculum. */
async function describePriorPerformance(childId: string, curriculumId: string): Promise<string | undefined> {
  const db = createServiceClient();
  const { data } = await db
    .from("topic_progress")
    .select("status, mastery, weak_objective_codes, topics!inner(title, curriculum_id)")
    .eq("child_id", childId)
    .eq("topics.curriculum_id", curriculumId);
  const rows = (data ?? []) as unknown as Array<{ status: string; mastery: number; weak_objective_codes: string[]; topics: { title: string } }>;
  if (rows.length === 0) return undefined;
  return rows
    .map((r) => `${r.topics.title}: ${r.status.replace("_", " ")}, mastery ${(Number(r.mastery) * 100).toFixed(0)}%${r.weak_objective_codes.length ? ` (weak: ${r.weak_objective_codes.join(", ")})` : ""}`)
    .join("\n");
}

async function runMemoryJob(childId: string, topicId: string): Promise<unknown> {
  const { tier } = await loadChildContext(childId);
  if (tier === "free") return { skipped: true };
  const summary = await lessonMasterySummary(childId, topicId);
  if (!summary) return { skipped: true };
  const db = createServiceClient();
  const { data: cards, error } = await db
    .from("learner_memories")
    .select("kind, value, confidence")
    .eq("child_id", childId)
    .eq("source", "inferred")
    .eq("active", true)
    .order("confidence", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const existing = (cards ?? []).map((card) => ({
    kind: card.kind as string,
    value: card.value as string,
    confidence: Number(card.confidence),
  }));
  const { update, meta } = await compactLearnerMemory({ summary, cards: existing, tier });
  const applied = await applyMemoryUpdate(childId, tier, update);
  return { ...applied, usage: meta.usage };
}

async function runDailyReportJob(childId: string, date: string) {
  const report = await buildDailyReport(childId, date);
  return { summaryLength: report.summary.length };
}

/* ------------------------------------------------------------------ */

export type ArtifactEnsure = { ok: true; artifact: ArtifactRow } | { ok: false; error: CreditError };

/**
 * Called when a learner opens a topic. A published lesson is returned without
 * a new charge. Otherwise a credit is reserved before any generating row exists.
 */
export async function ensureArtifact(topicId: string, opts: { regenerate?: boolean } = {}): Promise<ArtifactEnsure> {
  const db = createServiceClient();
  const { data } = await db.from("artifacts").select("*").eq("topic_id", topicId).order("version", { ascending: false }).limit(1).maybeSingle();
  const latest = (data as ArtifactRow | null) ?? null;

  if (opts.regenerate && latest?.status === "generating") return { ok: true, artifact: latest };
  // A split topic is a unit now; it never gets a lesson of its own.
  if (latest?.status === "split") return { ok: true, artifact: latest };
  // A failed lesson stays failed until someone asks to try again. Refreshing
  // the page must not reserve another credit or call a model.
  if (!opts.regenerate && latest) return { ok: true, artifact: latest };

  const started = await startArtifactJob(topicId, opts.regenerate ? "regenerate" : "initial");
  if (!started.ok) return started;
  if (started.jobId) kickJob(started.jobId);

  const artifactId = started.artifactId ?? latest?.id;
  if (!artifactId) return { ok: false, error: "forbidden" };
  const { data: row, error } = await db.from("artifacts").select("*").eq("id", artifactId).maybeSingle();
  if (error || !row) return { ok: false, error: "forbidden" };
  return { ok: true, artifact: row as ArtifactRow };
}

/** Fire-and-forget pre-warm of the topic after the given one. Skips when the balance is empty. */
export async function prewarmNextTopic(topicId: string): Promise<void> {
  const db = createServiceClient();
  const { data: t } = await db.from("topics").select("curriculum_id, position").eq("id", topicId).single();
  if (!t) return;
  const { data: next } = await db
    .from("topics")
    .select("id")
    .eq("curriculum_id", t.curriculum_id)
    .eq("kind", "lesson")
    .gt("position", t.position)
    .order("position")
    .limit(1)
    .maybeSingle();
  if (!next) return;
  const { data: existing } = await db.from("artifacts").select("id").eq("topic_id", next.id).limit(1).maybeSingle();
  if (existing) return;
  const started = await startArtifactJob(next.id as string, "prewarm");
  if (started.ok && started.jobId) kickJob(started.jobId);
}
