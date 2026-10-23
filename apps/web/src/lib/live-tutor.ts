import "server-only";
import { GoogleGenAI, Modality } from "@google/genai";
import { boundedLiveCredits, buildTutorInstruction, type LiveUsage, type TutorProgress } from "@eco/ai";
import type { ChildRow, ParentRow, SessionRow, TopicProgressRow, TopicRow, TutorSessionRow } from "@eco/db";
import { chargeUsage, creditBalance } from "@/lib/credits";
import { liveTutorEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";

/** Window a minted token may be used to open its connection. */
const CONNECT_WINDOW_MS = 60_000;
/** How long one token keeps a connection alive; the browser renews before then. */
const TOKEN_LIFETIME_MS = 30 * 60_000;
/** A session with no tick for this long is treated as over (closed tab, lost network). */
const STALE_MS = 2 * 60_000;

export type LiveTutorError = "plan" | "disabled" | "credits" | "busy" | "unavailable";

export interface LiveTutorGrant {
  token: string;
  model: string;
  apiVersion: string;
  /** When this token stops working; the browser fetches a fresh one before. */
  expiresAt: string;
  tutorSessionId: string;
}

export interface LiveTutorTick {
  /** Set when the browser should end the conversation. */
  stop: "credits" | "ended" | null;
  creditsUsed: number;
  secondsUsed: number;
}

type Parent = Pick<ParentRow, "tutor_enabled" | "live_tutor_allowed">;
type MeterRow = Pick<TutorSessionRow, "id" | "child_id" | "parent_id" | "topic_id" | "status" | "started_at" | "last_seen_at" | "credits_used" | "input_tokens" | "output_tokens">;
const METER_COLUMNS = "id, child_id, parent_id, topic_id, status, started_at, last_seen_at, credits_used, input_tokens, output_tokens";

/** Whether this account can use the voice tutor at all. Max plan, the grown-up switch, and server config. */
export function liveTutorEntitled(parent: Parent | null | undefined): LiveTutorError | null {
  if (!liveTutorEnv.enabled) return "unavailable";
  if (!parent?.tutor_enabled) return "plan";
  if (!parent.live_tutor_allowed) return "disabled";
  return null;
}

let client: GoogleGenAI | null = null;
function gemini(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: liveTutorEnv.apiKey, httpOptions: { apiVersion: liveTutorEnv.apiVersion } });
  return client;
}

/**
 * Ephemeral token with the model, voice and system instruction locked in, so
 * the browser holds no API key and cannot change what the tutor is told.
 * Context compression keeps long conversations under the model's window;
 * resuming with a handle does not use the token up.
 */
async function mintToken(systemInstruction: string): Promise<{ token: string; expiresAt: string }> {
  const now = Date.now();
  const expiresAt = new Date(now + TOKEN_LIFETIME_MS).toISOString();
  const token = await gemini().authTokens.create({
    config: {
      uses: 1,
      newSessionExpireTime: new Date(now + CONNECT_WINDOW_MS).toISOString(),
      expireTime: expiresAt,
      liveConnectConstraints: {
        model: liveTutorEnv.model,
        config: {
          systemInstruction,
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: { slidingWindow: {} },
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: liveTutorEnv.voice } } },
        },
      },
      lockAdditionalFields: [],
      abortSignal: AbortSignal.timeout(15_000),
    },
  });
  if (!token.name) throw new Error("Gemini returned no token");
  return { token: token.name, expiresAt };
}

/** The tutor's instructions for this learner and lesson, rebuilt on every token so renewals see fresh progress. */
async function instructionFor(childId: string, topicId: string): Promise<string | null> {
  const db = createServiceClient();
  const [{ data: child }, { data: topic }, { data: objectives }, { data: progress }] = await Promise.all([
    db.from("children").select("age, reading_level").eq("id", childId).maybeSingle(),
    db.from("topics").select("title, description").eq("id", topicId).maybeSingle(),
    db.from("learning_objectives").select("code, text").eq("topic_id", topicId).order("position"),
    db.from("topic_progress").select("status, mastery, weak_objective_codes, sessions_completed").eq("child_id", childId).eq("topic_id", topicId).maybeSingle(),
  ]);
  if (!child || !topic) return null;
  const c = child as Pick<ChildRow, "age" | "reading_level">;
  const t = topic as Pick<TopicRow, "title" | "description">;
  const p = progress as Pick<TopicProgressRow, "status" | "mastery" | "weak_objective_codes" | "sessions_completed"> | null;
  const tutorProgress: TutorProgress | null = p
    ? { status: p.status, mastery: Number(p.mastery) || 0, weakObjectiveCodes: p.weak_objective_codes ?? [], sessionsCompleted: p.sessions_completed ?? 0 }
    : null;
  return buildTutorInstruction({
    age: c.age,
    readingLevel: c.reading_level,
    lessonTitle: t.title,
    lessonDescription: t.description,
    objectives: (objectives ?? []) as Array<{ code: string; text: string }>,
    progress: tutorProgress,
  });
}

/** Closes sessions that stopped ticking, at their last tick, so they no longer count as open. */
async function closeStale(childId: string): Promise<void> {
  const db = createServiceClient();
  const cutoff = Date.now() - STALE_MS;
  const { data } = await db.from("tutor_sessions").select("id, started_at, last_seen_at").eq("child_id", childId).eq("status", "issued");
  for (const row of (data ?? []) as Pick<TutorSessionRow, "id" | "started_at" | "last_seen_at">[]) {
    const seen = Date.parse(row.last_seen_at ?? row.started_at);
    if (seen > cutoff) continue;
    const seconds = Math.max(0, Math.round((seen - Date.parse(row.started_at)) / 1000));
    await db
      .from("tutor_sessions")
      .update({ status: "ended", ended_at: new Date(seen).toISOString(), seconds_used: seconds })
      .eq("id", row.id)
      .eq("status", "issued");
  }
}

/**
 * Starts a voice tutor session for a lesson the caller already proved access to
 * (the artifact session was read through RLS). Checks plan, switch, credits,
 * and that this learner has no other conversation open. There is no time cap:
 * the conversation runs until the learner ends it, goes quiet, or credits run out.
 */
export async function startLiveTutor(session: Pick<SessionRow, "id" | "child_id" | "topic_id">): Promise<{ ok: true; grant: LiveTutorGrant } | { ok: false; error: LiveTutorError }> {
  const db = createServiceClient();
  const { data: child } = await db.from("children").select("id, parent_id").eq("id", session.child_id).maybeSingle();
  if (!child) return { ok: false, error: "unavailable" };
  const c = child as Pick<ChildRow, "id" | "parent_id">;
  const { data: parent } = await db.from("parents").select("tutor_enabled, live_tutor_allowed, credit_balance").eq("id", c.parent_id).maybeSingle();
  const denied = liveTutorEntitled(parent as Parent | null);
  if (denied) return { ok: false, error: denied };
  if (((parent as { credit_balance?: number } | null)?.credit_balance ?? 0) <= 0) return { ok: false, error: "credits" };

  await closeStale(c.id);
  const { count: open } = await db.from("tutor_sessions").select("id", { count: "exact", head: true }).eq("child_id", c.id).eq("status", "issued");
  if ((open ?? 0) > 0) return { ok: false, error: "busy" };

  const instruction = await instructionFor(c.id, session.topic_id);
  if (!instruction) return { ok: false, error: "unavailable" };

  let minted: { token: string; expiresAt: string };
  try {
    minted = await mintToken(instruction);
  } catch (err) {
    console.error("[live-tutor] token mint failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "unavailable" };
  }

  const startedAt = new Date().toISOString();
  const { data: row, error } = await db
    .from("tutor_sessions")
    .insert({
      child_id: c.id,
      parent_id: c.parent_id,
      topic_id: session.topic_id,
      artifact_session_id: session.id,
      model: liveTutorEnv.model,
      status: "issued",
      started_at: startedAt,
      last_seen_at: startedAt,
      expires_at: minted.expiresAt,
    })
    .select("id")
    .single();
  if (error || !row) {
    console.error("[live-tutor] session insert failed:", error?.message);
    return { ok: false, error: "unavailable" };
  }

  return {
    ok: true,
    grant: { token: minted.token, model: liveTutorEnv.model, apiVersion: liveTutorEnv.apiVersion, expiresAt: minted.expiresAt, tutorSessionId: row.id as string },
  };
}

/** A fresh token for an open conversation, used when Gemini moves the connection or the old token nears expiry. */
export async function renewLiveTutor(tutorSessionId: string, childId: string): Promise<{ ok: true; grant: LiveTutorGrant } | { ok: false; error: LiveTutorError | "ended" }> {
  const db = createServiceClient();
  const { data } = await db.from("tutor_sessions").select(METER_COLUMNS).eq("id", tutorSessionId).eq("child_id", childId).maybeSingle();
  const row = data as MeterRow | null;
  if (!row || row.status !== "issued") return { ok: false, error: "ended" };

  const { data: parent } = await db.from("parents").select("tutor_enabled, live_tutor_allowed, credit_balance").eq("id", row.parent_id).maybeSingle();
  const denied = liveTutorEntitled(parent as Parent | null);
  if (denied) return { ok: false, error: denied };
  if (((parent as { credit_balance?: number } | null)?.credit_balance ?? 0) <= 0) return { ok: false, error: "credits" };

  const instruction = await instructionFor(row.child_id, row.topic_id);
  if (!instruction) return { ok: false, error: "unavailable" };
  let minted: { token: string; expiresAt: string };
  try {
    minted = await mintToken(instruction);
  } catch (err) {
    console.error("[live-tutor] token renew failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "unavailable" };
  }
  await db.from("tutor_sessions").update({ expires_at: minted.expiresAt, last_seen_at: new Date().toISOString() }).eq("id", row.id).eq("status", "issued");
  return {
    ok: true,
    grant: { token: minted.token, model: liveTutorEnv.model, apiVersion: liveTutorEnv.apiVersion, expiresAt: minted.expiresAt, tutorSessionId: row.id },
  };
}

/**
 * Records time and reported token use, and charges what the conversation has
 * cost since the last tick. Time is measured on the server clock; the reported
 * cost is held between a per-minute floor and ceiling for that time, so a
 * browser that under-reports still pays for the microphone stream. `final`
 * closes the session.
 */
export async function tickLiveTutor(tutorSessionId: string, childId: string, usage: LiveUsage, final = false): Promise<LiveTutorTick | null> {
  const db = createServiceClient();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await db.from("tutor_sessions").select(METER_COLUMNS).eq("id", tutorSessionId).eq("child_id", childId).maybeSingle();
    const row = data as MeterRow | null;
    if (!row) return null;
    if (row.status === "ended") return { stop: "ended", creditsUsed: row.credits_used, secondsUsed: 0 };

    const now = Date.now();
    const seconds = Math.max(0, Math.round((now - Date.parse(row.started_at)) / 1000));
    const target = Math.max(row.credits_used, boundedLiveCredits(usage, seconds));
    const delta = target - row.credits_used;

    // Claim the increment first, guarded on the last value, so a tick racing the end beacon cannot charge twice.
    const { data: claimed } = await db
      .from("tutor_sessions")
      .update({
        credits_used: target,
        seconds_used: seconds,
        input_tokens: Math.max(row.input_tokens, Math.round(usage.textIn + usage.audioIn)),
        output_tokens: Math.max(row.output_tokens, Math.round(usage.textOut + usage.audioOut)),
        last_seen_at: new Date(now).toISOString(),
        ...(final ? { status: "ended", ended_at: new Date(now).toISOString() } : {}),
      })
      .eq("id", row.id)
      .eq("status", "issued")
      .eq("credits_used", row.credits_used)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const balance =
      delta > 0
        ? await chargeUsage({ parentId: row.parent_id, category: "live", credits: delta, reason: "live_tutor", tutorSessionId: row.id, topicId: row.topic_id })
        : await creditBalance(row.parent_id);
    return { stop: final ? "ended" : balance <= 0 ? "credits" : null, creditsUsed: target, secondsUsed: seconds };
  }
  return null;
}
