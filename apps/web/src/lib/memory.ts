import "server-only";
import { isForbiddenMemory, type MemoryKind, type MemoryUpdate } from "@eco/contracts";
import type { JobKind, Tier } from "@eco/db";
import { inferredMemoryCap } from "@/lib/plans";
import { createServiceClient } from "@/lib/supabase/server";

const MEMORY_DEBOUNCE_MS = 2 * 60_000;

interface StoredCard {
  id: string;
  kind: MemoryKind;
  value: string;
  source: "parent" | "inferred";
  active: boolean;
}

function cardKey(kind: string, value: string): string {
  return `${kind}:${value.trim().toLowerCase()}`;
}

/**
 * Apply a compaction result. Parent cards are never deactivated to make room,
 * and proposals about health, family, address, school, religion, friends, or
 * emotions are dropped. Free accounts write nothing.
 */
export async function applyMemoryUpdate(childId: string, tier: Tier, update: MemoryUpdate): Promise<{ written: number; dropped: number }> {
  if (inferredMemoryCap(tier) === 0) return { written: 0, dropped: update.upserts.length };
  const db = createServiceClient();
  const { data, error } = await db.from("learner_memories").select("id, kind, value, source, active").eq("child_id", childId);
  if (error) throw new Error(error.message);
  const cards = (data ?? []) as StoredCard[];
  const byKey = new Map(cards.map((card) => [cardKey(card.kind, card.value), card]));
  let written = 0;
  let dropped = 0;
  const now = new Date().toISOString();

  for (const item of update.deactivate) {
    const card = byKey.get(cardKey(item.kind, item.value));
    if (!card || card.source !== "inferred" || !card.active) continue;
    const { error: updateError } = await db.from("learner_memories").update({ active: false }).eq("id", card.id).eq("source", "inferred");
    if (updateError) throw new Error(updateError.message);
    card.active = false;
    written += 1;
  }

  for (const item of update.upserts) {
    const value = item.value.trim();
    if (!value || value.length > 200 || isForbiddenMemory(value)) {
      dropped += 1;
      continue;
    }
    const confidence = Math.round(item.confidence * 100) / 100;
    const existing = byKey.get(cardKey(item.kind, value));
    if (existing?.source === "parent") continue;
    if (existing) {
      const reactivating = !existing.active;
      if (reactivating) await makeRoom(childId, tier);
      const { error: updateError } = await db
        .from("learner_memories")
        .update({ value, confidence, last_seen_at: now, active: true })
        .eq("id", existing.id)
        .eq("source", "inferred");
      if (updateError) throw new Error(updateError.message);
      existing.active = true;
      existing.value = value;
      written += 1;
      continue;
    }
    await makeRoom(childId, tier);
    const { data: inserted, error: insertError } = await db
      .from("learner_memories")
      .insert({
        child_id: childId,
        kind: item.kind,
        value,
        source: "inferred",
        confidence,
        last_seen_at: now,
        active: true,
      })
      .select("id, kind, value, source, active")
      .single();
    if (insertError) throw new Error(insertError.message);
    const row = inserted as StoredCard;
    byKey.set(cardKey(row.kind, row.value), row);
    written += 1;
  }

  return { written, dropped };
}

/** Deactivate the weakest inferred cards until one more active card will fit. */
async function makeRoom(childId: string, tier: Tier): Promise<void> {
  const cap = inferredMemoryCap(tier);
  if (cap <= 0) return;
  const db = createServiceClient();
  const { count, error } = await db
    .from("learner_memories")
    .select("id", { count: "exact", head: true })
    .eq("child_id", childId)
    .eq("source", "inferred")
    .eq("active", true);
  if (error) throw new Error(error.message);
  if ((count ?? 0) < cap) return;
  const { error: capError } = await db.rpc("enforce_memory_cap", { p_child_id: childId, p_cap: cap - 1 });
  if (capError) throw new Error(capError.message);
}

export function memoryRunAfter(now = Date.now()): string {
  return new Date(now + MEMORY_DEBOUNCE_MS).toISOString();
}

/**
 * One Gemini compaction for this learner. A burst of answers updates the
 * queued job instead of starting another call. The sweep runs it after
 * `run_after`; it is not kicked immediately, so the debounce can hold.
 * Free accounts are skipped. Published lessons are left as they are.
 */
export async function enqueueMemoryJob(childId: string, topicId: string): Promise<void> {
  const db = createServiceClient();
  const { data: parent } = await db.from("children").select("parent_id, parents!inner(tier)").eq("id", childId).maybeSingle();
  const tier = ((parent as { parents?: { tier?: Tier } } | null)?.parents?.tier ?? "free") as Tier;
  const parentId = (parent as { parent_id?: string } | null)?.parent_id;
  if (!parentId || tier === "free") return;

  const { data: open, error } = await db
    .from("generation_jobs")
    .select("id, status")
    .eq("kind", "memory")
    .eq("parent_id", parentId)
    .in("status", ["queued", "running"])
    .contains("payload", { childId });
  if (error) throw new Error(error.message);
  const rows = (open ?? []) as { id: string; status: "queued" | "running" }[];
  const queued = rows.find((row) => row.status === "queued");
  const runAfter = memoryRunAfter();
  const payload = { childId, topicId };
  if (queued) {
    const { error: updateError } = await db.from("generation_jobs").update({ payload, run_after: runAfter }).eq("id", queued.id).eq("status", "queued");
    if (updateError) throw new Error(updateError.message);
    return;
  }
  const { error: insertError } = await db.from("generation_jobs").insert({
    kind: "memory" satisfies JobKind,
    payload,
    parent_id: parentId,
    run_after: runAfter,
  });
  if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
  if (insertError?.code === "23505") {
    const { error: updateError } = await db
      .from("generation_jobs")
      .update({ payload, run_after: runAfter })
      .eq("kind", "memory")
      .eq("status", "queued")
      .contains("payload", { childId });
    if (updateError) throw new Error(updateError.message);
  }
}

/** Counts only. The answer text and event payloads stay out of the summary. */
export async function lessonMasterySummary(childId: string, topicId: string): Promise<string | null> {
  const db = createServiceClient();
  const [{ data: topic }, { data: objectives }, { data: progress }, { count: answered }, { count: correct }, { count: revealed }] = await Promise.all([
    db.from("topics").select("title").eq("id", topicId).maybeSingle(),
    db.from("learning_objectives").select("id, code, text").eq("topic_id", topicId).order("position"),
    db.from("topic_progress").select("status, mastery, weak_objective_codes").eq("child_id", childId).eq("topic_id", topicId).maybeSingle(),
    db.from("responses").select("id", { count: "exact", head: true }).eq("child_id", childId).eq("topic_id", topicId),
    db.from("responses").select("id", { count: "exact", head: true }).eq("child_id", childId).eq("topic_id", topicId).eq("correct", true),
    db.from("learning_events").select("id", { count: "exact", head: true }).eq("child_id", childId).eq("topic_id", topicId).eq("type", "answer_revealed"),
  ]);
  if (!topic) return null;
  const objectiveRows = (objectives ?? []) as { id: string; code: string; text: string }[];
  const masteryByObjective = new Map<string, { status: string; score: number }>();
  if (objectiveRows.length) {
    const { data: mastery, error } = await db
      .from("objective_mastery")
      .select("objective_id, status, score")
      .eq("child_id", childId)
      .in("objective_id", objectiveRows.map((row) => row.id));
    if (error) throw new Error(error.message);
    for (const row of mastery ?? []) {
      masteryByObjective.set(row.objective_id as string, { status: row.status as string, score: Number(row.score) });
    }
  }
  const lines = objectiveRows.map((row) => {
    const state = masteryByObjective.get(row.id);
    return state ? `${row.code}: ${row.text} — ${state.status}, score ${(state.score * 100).toFixed(0)}%` : `${row.code}: ${row.text} — no evidence yet`;
  });
  const progressRow = progress as { status: string; mastery: number; weak_objective_codes: string[] } | null;
  const weak = progressRow?.weak_objective_codes?.length ? progressRow.weak_objective_codes.join(", ") : "none";
  return [
    `Topic: ${(topic as { title: string }).title}`,
    progressRow ? `Topic status: ${progressRow.status}, mastery ${(Number(progressRow.mastery) * 100).toFixed(0)}%` : "Topic status: not started",
    `Weak objectives: ${weak}`,
    lines.length ? `Objectives:\n${lines.join("\n")}` : "Objectives: none",
    `Graded answers: ${answered ?? 0}. Correct: ${correct ?? 0}. Answers revealed: ${revealed ?? 0}. Answer text is omitted.`,
  ].join("\n");
}

export async function refreshLearnerMaintenance(): Promise<void> {
  const db = createServiceClient();
  const ages = await db.rpc("refresh_learner_ages");
  if (ages.error) throw new Error(ages.error.message);
  const traces = await db.rpc("purge_learning_traces");
  if (traces.error) throw new Error(traces.error.message);
}
