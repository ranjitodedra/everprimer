import "server-only";
import { after } from "next/server";
import { ApiError, createFalClient, type FalClient } from "@fal-ai/client";
import { creditsForCharacter, creditsForCutouts, pickCharacterConcept, talkPrompt, teachPrompt, type CharacterTheme } from "@eco/ai";
import type { CharacterPose, LessonCharacterRow } from "@eco/db";
import { chargeUsage, creditBalance } from "@/lib/credits";
import { lessonArtEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Per-lesson tutor character: one talking pose from FLUX.2 [klein] 9B, then
 * the teaching pose redrawn from it with the edit endpoint, so both share one
 * design. Each pose is then cut out of its white background so the character
 * stands on the lesson page. Stored once per topic in the private `lesson-art`
 * bucket and reused by every later version of the lesson.
 *
 * The lesson_characters row is its own small queue (claim, retry, give up).
 * The pictures are charged to the parent's credits as lesson usage. Every
 * failure leaves the lesson as it was, just without the character; a failed
 * cutout keeps the white-background poses and is retried by the sweep.
 */

export const LESSON_ART_BUCKET = "lesson-art";
export const CHARACTER_POSES: readonly CharacterPose[] = ["talk", "teach"];

const MAX_ATTEMPTS = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_SIZE = { width: 768, height: 768 };
const REQUEST_TIMEOUT_MS = 90_000;
/** How long a character waits before checking again when the account has no credits left. */
const CREDIT_RETRY_MS = 6 * 60 * 60 * 1000;
const IMAGE_MIMES: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

class PermanentArtError extends Error {}

let falInstance: FalClient | null = null;
function falClient(): FalClient {
  if (!falInstance) falInstance = createFalClient({ credentials: lessonArtEnv.falKey });
  return falInstance;
}

/** Queue a character for a lesson topic. Returns false when art is off or the topic has no lesson. */
export async function queueCharacter(topicId: string): Promise<boolean> {
  if (!lessonArtEnv.enabled) return false;
  const db = createServiceClient();
  const { data: topic } = await db
    .from("topics")
    .select("kind, curricula!inner(children!inner(parent_id))")
    .eq("id", topicId)
    .maybeSingle();
  if (!topic || (topic as { kind: string }).kind !== "lesson") return false;
  const parentId = (topic as unknown as { curricula: { children: { parent_id: string } } }).curricula.children.parent_id;
  const { error } = await db
    .from("lesson_characters")
    .upsert({ topic_id: topicId, parent_id: parentId }, { onConflict: "topic_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return true;
}

/** Run the character without blocking the response; the sweep picks up anything missed. */
export function kickCharacter(topicId: string): void {
  try {
    after(() => runCharacter(topicId));
  } catch {
    void runCharacter(topicId);
  }
}

/** Queue and start a character. Never throws: art must not break a lesson. */
export async function ensureCharacter(topicId: string): Promise<void> {
  try {
    if (await queueCharacter(topicId)) kickCharacter(topicId);
  } catch (err) {
    console.error(`[lesson-art] queue ${topicId} failed:`, err instanceof Error ? err.message : err);
  }
}

/** Sweep queued characters. Called from /api/jobs/run. */
export async function runQueuedCharacters(limit = 3): Promise<number> {
  if (!lessonArtEnv.enabled) return 0;
  const db = createServiceClient();
  await db
    .from("lesson_characters")
    .update({ status: "queued" })
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 10 * 60_000).toISOString());
  const { data } = await db
    .from("lesson_characters")
    .select("topic_id")
    .eq("status", "queued")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  const ids = (data ?? []).map((r) => r.topic_id as string);
  for (const id of ids) await runCharacter(id);
  return ids.length + (await runCutouts(2));
}

/** Cut out characters drawn before backgrounds were removed, or whose cutout failed. Least recently tried first. */
export async function runCutouts(limit = 2): Promise<number> {
  if (!lessonArtEnv.enabled) return 0;
  const { data } = await createServiceClient()
    .from("lesson_characters")
    .select("topic_id, parent_id, seed, talk_path, teach_path")
    .eq("status", "ready")
    .eq("cutout", false)
    .order("updated_at", { ascending: true })
    .limit(limit);
  const rows = (data ?? []) as Pick<LessonCharacterRow, "topic_id" | "parent_id" | "seed" | "talk_path" | "teach_path">[];
  for (const row of rows) await cutoutStored(row);
  return rows.length;
}

async function cutoutStored(row: Pick<LessonCharacterRow, "topic_id" | "parent_id" | "seed" | "talk_path" | "teach_path">): Promise<void> {
  const db = createServiceClient();
  try {
    if (!row.talk_path || !row.teach_path) return;
    if (row.parent_id && (await creditBalance(row.parent_id)) <= 0) {
      await db.from("lesson_characters").update({ error: "no credits for cutout" }).eq("topic_id", row.topic_id);
      return;
    }
    const seed = row.seed ?? 0;
    const signed = await Promise.all(
      [row.talk_path, row.teach_path].map(async (path) => {
        const { data, error } = await db.storage.from(LESSON_ART_BUCKET).createSignedUrl(path, 600);
        if (error || !data?.signedUrl) throw new Error(`sign ${path}: ${error?.message ?? "no url"}`);
        return data.signedUrl;
      }),
    );
    const [talk, teach] = await Promise.all(signed.map((url) => cutout(url)));
    const [talkPath, teachPath] = await Promise.all([store(row.topic_id, "talk", seed, talk!, "cut"), store(row.topic_id, "teach", seed, teach!, "cut")]);
    const { data: updated } = await db
      .from("lesson_characters")
      .update({ talk_path: talkPath, teach_path: teachPath, cutout: true, error: null, ready_at: new Date().toISOString() })
      .eq("topic_id", row.topic_id)
      .eq("cutout", false)
      .select("topic_id")
      .maybeSingle();
    if (updated && row.parent_id) {
      await chargeUsage({ parentId: row.parent_id, category: "lesson", credits: creditsForCutouts(2), reason: "art", topicId: row.topic_id });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("lesson_characters").update({ error: `cutout: ${message}`.slice(0, 1000) }).eq("topic_id", row.topic_id);
    console.error(`[lesson-art] cutout ${row.topic_id} failed:`, message);
  }
}

function nextUtcMidnight(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

async function overDailyLimit(row: LessonCharacterRow): Promise<boolean> {
  if (!row.parent_id) return false;
  const limit = lessonArtEnv.dailyLimit;
  if (limit <= 0) return true;
  const d = new Date();
  const midnight = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  const { count } = await createServiceClient()
    .from("lesson_characters")
    .select("topic_id", { count: "exact", head: true })
    .eq("parent_id", row.parent_id)
    .eq("status", "ready")
    .gte("ready_at", midnight);
  return (count ?? 0) >= limit;
}

async function lessonTheme(topicId: string): Promise<CharacterTheme | null> {
  const { data } = await createServiceClient()
    .from("artifacts")
    .select("theme:blueprint->theme")
    .eq("topic_id", topicId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const theme = (data as { theme?: CharacterTheme | null } | null)?.theme;
  return theme && typeof theme === "object" ? theme : null;
}

interface FalImageOutput {
  images?: Array<{ url?: string; content_type?: string }>;
  has_nsfw_concepts?: boolean[];
}

function isFalMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "fal.media" || u.hostname.endsWith(".fal.media"));
  } catch {
    return false;
  }
}

async function generateImage(endpoint: string, input: Record<string, unknown>): Promise<{ url: string; bytes: Uint8Array; mime: string }> {
  const result = await falClient().subscribe(endpoint, {
    input: { ...input, image_size: IMAGE_SIZE, num_images: 1, output_format: "webp", enable_safety_checker: true },
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = result.data as FalImageOutput;
  if (data.has_nsfw_concepts?.some(Boolean)) throw new PermanentArtError("image flagged by the safety checker");
  const url = data.images?.[0]?.url;
  if (!url || !isFalMediaUrl(url)) throw new Error("fal returned no usable image url");
  return download(url);
}

/** The same picture with its background removed, as a transparent webp. */
async function cutout(imageUrl: string): Promise<{ url: string; bytes: Uint8Array; mime: string }> {
  const result = await falClient().subscribe(lessonArtEnv.cutoutModel, {
    input: { image_url: imageUrl, model: "General Use (Light)", operating_resolution: "1024x1024", output_format: "webp", refine_foreground: true },
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const url = (result.data as { image?: { url?: string } }).image?.url;
  if (!url || !isFalMediaUrl(url)) throw new Error("fal returned no usable cutout url");
  return download(url);
}

async function download(url: string): Promise<{ url: string; bytes: Uint8Array; mime: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`image download ${res.status}`);
  const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!IMAGE_MIMES[mime]) throw new Error(`unexpected image type ${mime || "unknown"}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error("image too large");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("image empty or too large");
  return { url, bytes, mime };
}

async function store(topicId: string, pose: CharacterPose, seed: number, image: { bytes: Uint8Array; mime: string }, suffix = ""): Promise<string> {
  const path = `${topicId}/${pose}-${seed}${suffix ? `-${suffix}` : ""}.${IMAGE_MIMES[image.mime]}`;
  const { error } = await createServiceClient()
    .storage.from(LESSON_ART_BUCKET)
    .upload(path, image.bytes, { contentType: image.mime, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`storage upload: ${error.message}`);
  return path;
}

function permanent(err: unknown): boolean {
  if (err instanceof PermanentArtError) return true;
  // Bad key, bad input, or no balance: retrying the same request will not help.
  return err instanceof ApiError && [400, 401, 403, 404, 422].includes(err.status);
}

/** Claim and generate one character. Safe to call concurrently; the claim is atomic. */
export async function runCharacter(topicId: string): Promise<void> {
  if (!lessonArtEnv.enabled) return;
  const db = createServiceClient();
  const now = new Date().toISOString();
  const { data: claimed } = await db
    .from("lesson_characters")
    .update({ status: "running", started_at: now })
    .eq("topic_id", topicId)
    .eq("status", "queued")
    .lte("run_after", now)
    .select("*")
    .maybeSingle();
  if (!claimed) return;
  const row = claimed as LessonCharacterRow;

  try {
    if (await overDailyLimit(row)) {
      await db.from("lesson_characters").update({ status: "queued", run_after: nextUtcMidnight(), error: "daily limit" }).eq("topic_id", topicId);
      return;
    }
    if (row.parent_id && (await creditBalance(row.parent_id)) <= 0) {
      await db
        .from("lesson_characters")
        .update({ status: "queued", run_after: new Date(Date.now() + CREDIT_RETRY_MS).toISOString(), error: "no credits" })
        .eq("topic_id", topicId);
      return;
    }
    const { concept, seed } = pickCharacterConcept(topicId);
    const talk = await generateImage(lessonArtEnv.model, { prompt: talkPrompt(concept, await lessonTheme(topicId)), seed });
    // The edit model redraws from the white-background original, which keeps the design steadier than a cutout.
    const teach = await generateImage(lessonArtEnv.editModel, { prompt: teachPrompt(concept), seed, image_urls: [talk.url] });
    let poses = { talk, teach };
    let cut = false;
    try {
      const [talkCut, teachCut] = await Promise.all([cutout(talk.url), cutout(teach.url)]);
      poses = { talk: talkCut, teach: teachCut };
      cut = true;
    } catch (err) {
      console.error(`[lesson-art] ${topicId} cutout failed, keeping backgrounds:`, err instanceof Error ? err.message : err);
    }
    const suffix = cut ? "cut" : "";
    const [talkPath, teachPath] = await Promise.all([store(topicId, "talk", seed, poses.talk, suffix), store(topicId, "teach", seed, poses.teach, suffix)]);
    const ready = {
      status: "ready" as const,
      concept,
      seed,
      model: lessonArtEnv.model,
      talk_path: talkPath,
      teach_path: teachPath,
      cutout: cut,
      attempts: row.attempts + 1,
      error: null,
      ready_at: new Date().toISOString(),
    };
    let { error } = await db.from("lesson_characters").update(ready).eq("topic_id", topicId);
    // Hosted PostgREST can lag a new cutout column; keep the poses rather than fail the character.
    if (error && /cutout/i.test(error.message)) {
      const { cutout: _cutout, ...without } = ready;
      ({ error } = await db.from("lesson_characters").update(without).eq("topic_id", topicId));
    }
    if (error) throw new Error(error.message);
    if (row.parent_id) {
      const credits = creditsForCharacter() - (cut ? 0 : creditsForCutouts(2));
      try {
        await chargeUsage({ parentId: row.parent_id, category: "lesson", credits, reason: "art", topicId });
      } catch (chargeErr) {
        console.error(`[lesson-art] ${topicId} charge failed:`, chargeErr instanceof Error ? chargeErr.message : chargeErr);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = row.attempts + 1;
    const giveUp = permanent(err) || attempts >= MAX_ATTEMPTS;
    await db
      .from("lesson_characters")
      .update({
        status: giveUp ? "failed" : "queued",
        attempts,
        error: message.slice(0, 1000),
        run_after: new Date(Date.now() + attempts * 60_000).toISOString(),
      })
      .eq("topic_id", topicId);
    console.error(`[lesson-art] ${topicId} failed (attempt ${attempts}${giveUp ? ", giving up" : ""}):`, message);
  }
}

export interface CharacterStatus {
  status: LessonCharacterRow["status"] | "off";
  /** Changes whenever the stored images change; used as the cache key. */
  version: string | null;
  /** The poses have a transparent background; otherwise the player blends the white away. */
  cutout: boolean;
}

export function characterStatusOf(row: (Pick<LessonCharacterRow, "status" | "ready_at" | "seed"> & { cutout?: boolean | null }) | null): CharacterStatus {
  if (!lessonArtEnv.enabled && row?.status !== "ready") return { status: "off", version: null, cutout: false };
  if (!row) return { status: "queued", version: null, cutout: false };
  if (row.status !== "ready" || !row.ready_at) return { status: row.status, version: null, cutout: false };
  return { status: "ready", version: `${row.seed ?? 0}-${new Date(row.ready_at).getTime().toString(36)}`, cutout: !!row.cutout };
}

/** Service-role download. Callers must have checked access with an RLS read first. */
export async function downloadPose(row: Pick<LessonCharacterRow, "talk_path" | "teach_path">, pose: CharacterPose): Promise<Blob | null> {
  const path = pose === "talk" ? row.talk_path : row.teach_path;
  if (!path) return null;
  const { data, error } = await createServiceClient().storage.from(LESSON_ART_BUCKET).download(path);
  if (error || !data) return null;
  return data;
}
