import "server-only";
import {
  QuestionAnsweredPayload,
  collectQuestions,
  isGameBlueprint,
  parseBlueprint,
  type EventBatch,
  type LearningEvent,
  type Question,
} from "@eco/contracts";
import type { ArtifactRow, ObjectiveMasteryRow, ObjectiveRow, SessionRow, TopicProgressRow } from "@eco/db";
import {
  EMPTY_MASTERY,
  applyEvidence,
  buildLessonFeedback,
  gradeAnswer,
  summarizeTopic,
  topicStatus,
  type ActivityType,
  type LessonFeedback,
  type ObjectiveEvidence,
  type ObjectiveMasteryState,
} from "@eco/mastery";
import { enqueueMemoryJob } from "@/lib/memory";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Event ingestion and the progress/mastery engine (rules.md sections 9, 21, 22).
 *
 * The caller has already verified that `session` belongs to the signed-in
 * parent's child. Everything here runs with the service role.
 */
export async function ingestEventBatch(session: SessionRow, batch: EventBatch): Promise<{ inserted: number }> {
  const db = createServiceClient();

  const { data: artifactRow } = await db.from("artifacts").select("id, blueprint").eq("id", session.artifact_id).single();
  const blueprint = artifactRow?.blueprint ? parseBlueprint(artifactRow.blueprint) : null;

  // 1. Append events; duplicates (retried batches) are ignored and not re-processed.
  const rows = batch.events.map((e) => ({
    session_id: session.id,
    child_id: session.child_id,
    topic_id: session.topic_id,
    artifact_id: session.artifact_id,
    client_event_id: e.clientEventId,
    type: e.type,
    section_id: e.sectionId ?? null,
    activity_id: e.activityId ?? null,
    payload: e.payload,
    occurred_at: e.occurredAt,
  }));
  const { data: insertedRows, error } = await db
    .from("learning_events")
    .upsert(rows, { onConflict: "client_event_id", ignoreDuplicates: true })
    .select("client_event_id");
  if (error) throw error;
  const insertedIds = new Set((insertedRows ?? []).map((r) => r.client_event_id as string));
  const fresh = batch.events.filter((e) => insertedIds.has(e.clientEventId));
  if (fresh.length === 0) return { inserted: 0 };

  // A retried batch is deduped on client_event_id, so if processing fails the
  // events must not stay behind looking handled. Undo this batch's rows so the
  // client's retry processes it again.
  const responseIds: string[] = [];
  try {
    await processEvents(session, blueprint, fresh, responseIds);
  } catch (err) {
    const { error: evErr } = await db
      .from("learning_events")
      .delete()
      .eq("session_id", session.id)
      .in("client_event_id", fresh.map((e) => e.clientEventId));
    if (evErr) console.error("[events] rollback of events failed", evErr.message);
    if (responseIds.length) {
      const { error: rErr } = await db.from("responses").delete().in("id", responseIds);
      if (rErr) console.error("[events] rollback of responses failed", rErr.message);
    }
    throw err;
  }
  return { inserted: fresh.length };
}

async function processEvents(
  session: SessionRow,
  blueprint: ReturnType<typeof parseBlueprint> | null,
  fresh: LearningEvent[],
  responseIds: string[],
): Promise<void> {
  const db = createServiceClient();
  await db.from("artifact_sessions").update({ last_event_at: new Date().toISOString() }).eq("id", session.id);

  // 2. Turn educationally meaningful events into graded responses and evidence.
  const questions = blueprint ? new Map(collectQuestions(blueprint).map((q) => [q.question.id, q])) : new Map<string, { sectionId: string; question: Question }>();
  const sectionType = new Map(
    blueprint
      ? isGameBlueprint(blueprint)
        ? [
            ...blueprint.sessions.flatMap((s) => s.bites.map((b) => [b.id, b.type] as const)),
            ["final_test", "quiz"] as const,
          ]
        : blueprint.sections.map((s) => [s.id, s.type] as const)
      : [],
  );
  const finalQuestionIds = blueprint && isGameBlueprint(blueprint) ? blueprint.finalTest.questions.map((q) => q.id) : [];
  const evidenceByCode = new Map<string, ObjectiveEvidence[]>();
  // Recall questions revisit an earlier lesson's objective, keyed by objective id.
  const recallEvidence = new Map<string, ObjectiveEvidence[]>();
  const responses: Array<Record<string, unknown>> = [];
  const { reachedEnd, sessionsCompletedHint } = progressSignals(fresh);

  const push = (question: Question, ev: ObjectiveEvidence) => {
    if (question.recallObjectiveId) {
      const list = recallEvidence.get(question.recallObjectiveId) ?? [];
      list.push(ev);
      recallEvidence.set(question.recallObjectiveId, list);
      return;
    }
    for (const code of question.objectiveCodes) {
      const list = evidenceByCode.get(code) ?? [];
      list.push(ev);
      evidenceByCode.set(code, list);
    }
  };

  for (const e of fresh) {
    if (e.type === "question_answered") {
      const parsed = QuestionAnsweredPayload.safeParse(e.payload);
      if (!parsed.success) continue;
      const p = parsed.data;
      const found = questions.get(p.questionId);
      if (!found) continue;
      const { correct } = gradeAnswer(found.question, p.answer);
      const activityType: ActivityType = sectionType.get(found.sectionId) === "apply" ? "apply" : "quiz";
      const onFinal = found.sectionId === "final_test" || finalQuestionIds.includes(p.questionId);
      responses.push({
        session_id: session.id,
        child_id: session.child_id,
        topic_id: session.topic_id,
        artifact_id: session.artifact_id,
        activity_id: p.activityId,
        activity_type: activityType,
        question_id: p.questionId,
        question_kind: found.question.kind,
        difficulty: found.question.difficulty,
        objective_codes: found.question.objectiveCodes,
        answer: p.answer,
        correct,
        attempt: p.attempt,
        hints_used: p.hintsUsed,
        occurred_at: e.occurredAt,
      });
      push(found.question, {
        correct,
        difficulty: found.question.difficulty as 1 | 2 | 3,
        attempt: p.attempt,
        hintsUsed: p.hintsUsed,
        activityType,
        finalTest: onFinal,
      });
    }

    if (e.type === "answer_revealed") {
      const qid = typeof e.payload.questionId === "string" ? e.payload.questionId : null;
      const found = qid ? questions.get(qid) : undefined;
      if (found) {
        push(found.question, { correct: false, difficulty: found.question.difficulty as 1 | 2 | 3, attempt: 3, hintsUsed: 0, revealed: true, activityType: "quiz" });
      }
    }

  }

  if (responses.length) {
    const { data: inserted, error: rErr } = await db.from("responses").insert(responses).select("id");
    if (rErr) throw rErr;
    for (const r of inserted ?? []) responseIds.push(r.id as string);
  }

  // 3. Update per-objective mastery and topic progress. Recall evidence first,
  // so the memory job queued last points at the lesson being played.
  if (recallEvidence.size) await applyRecallEvidence(session.child_id, recallEvidence, fresh);
  await recomputeTopic(session.child_id, session.topic_id, evidenceByCode, reachedEnd, fresh, {
    sessionsCompletedHint,
    finalQuestionIds,
  });
}

/** Whether the events reach the end of the lesson, and how many game rounds they finish. */
function progressSignals(events: LearningEvent[]): { reachedEnd: boolean; sessionsCompletedHint: number | null } {
  let reachedEnd = false;
  let sessionsCompletedHint: number | null = null;
  for (const e of events) {
    if (e.type === "topic_completed" || e.type === "final_test_completed") reachedEnd = true;
    if (e.type === "session_completed") {
      const index = typeof e.payload.index === "number" ? e.payload.index : Number(e.payload.index);
      if (Number.isFinite(index) && index >= 0) sessionsCompletedHint = Math.max(sessionsCompletedHint ?? 0, Math.floor(index) + 1);
    }
  }
  return { reachedEnd, sessionsCompletedHint };
}

/**
 * Rebuilds a topic's progress row from its stored events without applying
 * mastery evidence again. Recovers progress whose write failed after the
 * events themselves were saved.
 */
export async function rebuildTopicProgress(childId: string, topicId: string): Promise<boolean> {
  const db = createServiceClient();
  const rows: Array<{ client_event_id: string; type: string; payload: Record<string, unknown> | null; occurred_at: string; artifact_id: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("learning_events")
      .select("client_event_id, type, payload, occurred_at, artifact_id")
      .eq("child_id", childId)
      .eq("topic_id", topicId)
      .order("occurred_at")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  if (rows.length === 0) return false;

  const events = rows.map((r) => ({
    clientEventId: r.client_event_id,
    type: r.type,
    occurredAt: r.occurred_at,
    payload: r.payload ?? {},
  })) as LearningEvent[];
  const { reachedEnd, sessionsCompletedHint } = progressSignals(events);

  const { data: artifacts, error: aErr } = await db.from("artifacts").select("blueprint").in("id", [...new Set(rows.map((r) => r.artifact_id))]);
  if (aErr) throw aErr;
  const finalQuestionIds = new Set<string>();
  for (const a of artifacts ?? []) {
    const bp = a.blueprint ? parseBlueprint(a.blueprint) : null;
    if (bp && isGameBlueprint(bp)) for (const q of bp.finalTest.questions) finalQuestionIds.add(q.id);
  }

  await recomputeTopic(childId, topicId, new Map(), reachedEnd, events, {
    sessionsCompletedHint,
    finalQuestionIds: [...finalQuestionIds],
    enqueueMemory: false,
  });
  return true;
}

/** Credit recall answers to the earlier objective they revisit, only on this child's own curricula. */
async function applyRecallEvidence(childId: string, recall: Map<string, ObjectiveEvidence[]>, events: LearningEvent[]) {
  const db = createServiceClient();
  const { data, error } = await db
    .from("learning_objectives")
    .select("id, code, topic_id, topics!inner(curricula!inner(child_id))")
    .in("id", [...recall.keys()])
    .eq("topics.curricula.child_id", childId);
  if (error) throw error;
  const byTopic = new Map<string, Map<string, ObjectiveEvidence[]>>();
  for (const row of (data ?? []) as Array<{ id: string; code: string; topic_id: string }>) {
    const codes = byTopic.get(row.topic_id) ?? new Map<string, ObjectiveEvidence[]>();
    codes.set(row.code, recall.get(row.id) ?? []);
    byTopic.set(row.topic_id, codes);
  }
  for (const [topicId, codes] of byTopic) await recomputeTopic(childId, topicId, codes, false, events, { enqueueMemory: false });
}

async function recomputeTopic(
  childId: string,
  topicId: string,
  evidenceByCode: Map<string, ObjectiveEvidence[]>,
  reachedEndNow: boolean,
  events: LearningEvent[],
  opts: { enqueueMemory?: boolean; sessionsCompletedHint?: number | null; finalQuestionIds?: string[] } = {},
) {
  const db = createServiceClient();
  const { data: objRows } = await db.from("learning_objectives").select("*").eq("topic_id", topicId).order("position");
  const objectives = (objRows ?? []) as ObjectiveRow[];

  const { data: masteryRows } = objectives.length
    ? await db
        .from("objective_mastery")
        .select("*")
        .eq("child_id", childId)
        .in("objective_id", objectives.map((o) => o.id))
    : { data: [] };
  const current = new Map((masteryRows ?? []).map((m) => [m.objective_id as string, m as ObjectiveMasteryRow]));

  const upserts: Array<Record<string, unknown>> = [];
  const now = new Date().toISOString();
  const states: Array<{ code: string; state: ObjectiveMasteryState }> = [];

  for (const o of objectives) {
    const row = current.get(o.id);
    let state: ObjectiveMasteryState = row
      ? { score: Number(row.score), evidenceCount: row.evidence_count, activityTypes: row.activity_types as ActivityType[], status: row.status }
      : EMPTY_MASTERY;
    const evidence = evidenceByCode.get(o.code) ?? [];
    if (evidence.length) {
      const last = row?.last_evidence_at ? Date.now() - new Date(row.last_evidence_at).getTime() : undefined;
      for (const [i, ev] of evidence.entries()) state = applyEvidence(state, i === 0 ? { ...ev, msSinceLastEvidence: last } : ev);
      upserts.push({
        child_id: childId,
        objective_id: o.id,
        score: Number(state.score.toFixed(3)),
        evidence_count: state.evidenceCount,
        activity_types: state.activityTypes,
        status: state.status,
        last_evidence_at: now,
      });
    }
    states.push({ code: o.code, state });
  }

  const { data: progressRow, error: prevErr } = await db.from("topic_progress").select("*").eq("child_id", childId).eq("topic_id", topicId).maybeSingle();
  if (prevErr) throw prevErr;
  const prev = progressRow as TopicProgressRow | null;
  const summary = summarizeTopic(states);
  const reachedEnd = Boolean(prev?.reached_end) || reachedEndNow;
  const sessionsCompleted = Math.max(prev?.sessions_completed ?? 0, opts.sessionsCompletedHint ?? 0);
  let finalScore = prev?.final_score != null ? Number(prev.final_score) : null;
  if (opts.finalQuestionIds?.length) {
    const computed = await firstAttemptFinalScore(childId, topicId, opts.finalQuestionIds);
    if (computed != null) finalScore = computed;
  }
  const status = topicStatus(summary, reachedEnd, true, finalScore);
  const earliest = events.reduce((min, e) => (e.occurredAt < min ? e.occurredAt : min), events[0]!.occurredAt);

  let feedback: LessonFeedback | null = prev?.feedback ?? null;
  if (reachedEnd && states.length) {
    const { data: topic } = await db.from("topics").select("title").eq("id", topicId).maybeSingle();
    const textByCode = new Map(objectives.map((o) => [o.code, o.text]));
    feedback = buildLessonFeedback(
      (topic as { title: string } | null)?.title ?? "this lesson",
      states.map((s) => ({ code: s.code, text: textByCode.get(s.code) ?? s.code, state: s.state })),
    );
  }

  const { error: pErr } = await db.from("topic_progress").upsert(
    {
      child_id: childId,
      topic_id: topicId,
      status,
      mastery: Number(summary.mastery.toFixed(3)),
      reached_end: reachedEnd,
      weak_objective_codes: summary.weakObjectiveCodes,
      first_activity_at: prev?.first_activity_at ?? earliest,
      last_activity_at: now,
      completed_at: status === "completed" ? (prev?.completed_at ?? now) : prev?.completed_at ?? null,
      feedback,
      sessions_completed: sessionsCompleted,
      final_score: finalScore,
    },
    { onConflict: "child_id,topic_id" },
  );
  if (pErr) throw pErr;

  // Progress is written first: if it fails, mastery is untouched and a retry of the batch can't count evidence twice.
  if (upserts.length) {
    const { error } = await db.from("objective_mastery").upsert(upserts, { onConflict: "child_id,objective_id" });
    if (error) throw error;
  }

  // Memory updates after every lesson, and after a burst of answers.
  if (opts.enqueueMemory !== false && (upserts.length || reachedEndNow)) {
    try {
      await enqueueMemoryJob(childId, topicId);
    } catch (err) {
      console.error("[memory] enqueue failed", err instanceof Error ? err.message : err);
    }
  }
}

/** First-attempt mark on the final-test questions, or null until every item has a first attempt. */
async function firstAttemptFinalScore(childId: string, topicId: string, questionIds: string[]): Promise<number | null> {
  if (questionIds.length === 0) return null;
  const db = createServiceClient();
  const { data, error } = await db
    .from("responses")
    .select("question_id, correct, attempt")
    .eq("child_id", childId)
    .eq("topic_id", topicId)
    .in("question_id", questionIds)
    .eq("attempt", 1);
  if (error) {
    console.error("[progress] final score:", error.message);
    return null;
  }
  const first = new Map<string, boolean>();
  for (const row of data ?? []) {
    const id = row.question_id as string;
    if (!first.has(id)) first.set(id, Boolean(row.correct));
  }
  if (first.size < questionIds.length) return null;
  let correct = 0;
  for (const ok of first.values()) if (ok) correct += 1;
  return correct / questionIds.length;
}

export type { ArtifactRow };
