import "server-only";
import {
  QuestionAnsweredPayload,
  collectQuestions,
  parseBlueprint,
  type EventBatch,
  type LearningEvent,
  type Question,
} from "@eco/contracts";
import type { ArtifactRow, ObjectiveMasteryRow, ObjectiveRow, SessionRow, TopicProgressRow } from "@eco/db";
import {
  EMPTY_MASTERY,
  applyEvidence,
  gradeAnswer,
  summarizeTopic,
  topicStatus,
  type ActivityType,
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

  await db.from("artifact_sessions").update({ last_event_at: new Date().toISOString() }).eq("id", session.id);

  // 2. Turn educationally meaningful events into graded responses and evidence.
  const questions = blueprint ? new Map(collectQuestions(blueprint).map((q) => [q.question.id, q])) : new Map<string, { sectionId: string; question: Question }>();
  const sectionType = new Map((blueprint?.sections ?? []).map((s) => [s.id, s.type]));
  const evidenceByCode = new Map<string, ObjectiveEvidence[]>();
  const responses: Array<Record<string, unknown>> = [];
  let reachedEnd = false;

  const push = (codes: string[], ev: ObjectiveEvidence) => {
    for (const code of codes) {
      const list = evidenceByCode.get(code) ?? [];
      list.push(ev);
      evidenceByCode.set(code, list);
    }
  };

  for (const e of fresh) {
    if (e.type === "topic_completed") reachedEnd = true;

    if (e.type === "question_answered") {
      const parsed = QuestionAnsweredPayload.safeParse(e.payload);
      if (!parsed.success) continue;
      const p = parsed.data;
      const found = questions.get(p.questionId);
      if (!found) continue;
      const { correct } = gradeAnswer(found.question, p.answer);
      const activityType: ActivityType = sectionType.get(found.sectionId) === "apply" ? "apply" : "quiz";
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
      push(found.question.objectiveCodes, {
        correct,
        difficulty: found.question.difficulty as 1 | 2 | 3,
        attempt: p.attempt,
        hintsUsed: p.hintsUsed,
        activityType,
      });
    }

    if (e.type === "answer_revealed") {
      const qid = typeof e.payload.questionId === "string" ? e.payload.questionId : null;
      const found = qid ? questions.get(qid) : undefined;
      if (found) {
        push(found.question.objectiveCodes, { correct: false, difficulty: found.question.difficulty as 1 | 2 | 3, attempt: 3, hintsUsed: 0, revealed: true, activityType: "quiz" });
      }
    }

  }

  if (responses.length) {
    const { error: rErr } = await db.from("responses").insert(responses);
    if (rErr) throw rErr;
  }

  // 3. Update per-objective mastery and topic progress.
  await recomputeTopic(session.child_id, session.topic_id, evidenceByCode, reachedEnd, fresh);
  return { inserted: fresh.length };
}

async function recomputeTopic(
  childId: string,
  topicId: string,
  evidenceByCode: Map<string, ObjectiveEvidence[]>,
  reachedEndNow: boolean,
  events: LearningEvent[],
) {
  const db = createServiceClient();
  const { data: objRows } = await db.from("learning_objectives").select("*").eq("topic_id", topicId);
  const objectives = (objRows ?? []) as ObjectiveRow[];
  if (objectives.length === 0) return;

  const { data: masteryRows } = await db
    .from("objective_mastery")
    .select("*")
    .eq("child_id", childId)
    .in("objective_id", objectives.map((o) => o.id));
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
  if (upserts.length) {
    const { error } = await db.from("objective_mastery").upsert(upserts, { onConflict: "child_id,objective_id" });
    if (error) throw error;
  }

  const { data: progressRow } = await db.from("topic_progress").select("*").eq("child_id", childId).eq("topic_id", topicId).maybeSingle();
  const prev = progressRow as TopicProgressRow | null;
  const summary = summarizeTopic(states);
  const reachedEnd = Boolean(prev?.reached_end) || reachedEndNow;
  const status = topicStatus(summary, reachedEnd, true);
  const earliest = events.reduce((min, e) => (e.occurredAt < min ? e.occurredAt : min), events[0]!.occurredAt);

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
    },
    { onConflict: "child_id,topic_id" },
  );
  if (pErr) throw pErr;

  if (upserts.length) {
    try {
      await enqueueMemoryJob(childId, topicId);
    } catch (err) {
      console.error("[memory] enqueue failed", err instanceof Error ? err.message : err);
    }
  }
}

export type { ArtifactRow };
