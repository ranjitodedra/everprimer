import { NextResponse, after } from "next/server";
import type { LessonCharacterRow } from "@eco/db";
import { characterStatusOf, ensureCharacter } from "@/lib/lesson-art";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Status poll used by the player while the lesson's character is being drawn. RLS limits it to the learner's topics. */
export async function GET(_req: Request, ctx: RouteContext<"/api/topics/[topicId]/character">) {
  const { topicId } = await ctx.params;
  const supabase = await createClient();
  const headers = { "cache-control": "no-store" };
  let { data, error } = await supabase.from("lesson_characters").select("status, ready_at, seed, cutout").eq("topic_id", topicId).maybeSingle();
  if (error) {
    const fallback = await supabase.from("lesson_characters").select("status, ready_at, seed").eq("topic_id", topicId).maybeSingle();
    if (fallback.error) return NextResponse.json({ status: "off", version: null, cutout: false }, { headers });
    data = fallback.data ? { ...fallback.data, cutout: false } : null;
  }
  if (!data) {
    const { data: topic } = await supabase.from("topics").select("id").eq("id", topicId).maybeSingle();
    if (!topic) return NextResponse.json({ error: "not found" }, { status: 404, headers });
  }
  const status = characterStatusOf(data as Pick<LessonCharacterRow, "status" | "ready_at" | "seed" | "cutout"> | null);
  // The claim is atomic and respects the retry delay, so a poll can safely start a due run.
  if (status.status === "queued") after(() => ensureCharacter(topicId));
  return NextResponse.json(status, { headers });
}
